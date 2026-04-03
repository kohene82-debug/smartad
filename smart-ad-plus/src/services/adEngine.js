const { query } = require('../utils/db');
const { get, set } = require('../utils/redis');
const logger = require('../utils/logger');

const MIN_IMPRESSION_INTERVAL = parseInt(process.env.MIN_IMPRESSION_INTERVAL_SECONDS || '30');
const MAX_IMPRESSIONS_PER_DAY = parseInt(process.env.MAX_IMPRESSIONS_PER_DAY || '50');

/**
 * Select the best ad for a user based on:
 * - User consent verified
 * - Approved status
 * - Advertiser has sufficient budget
 * - Frequency cap not exceeded
 * - Location targeting
 * - Highest CPM (priority)
 */
const selectAd = async ({ userId, deviceId, lat, lng, eventType, country }) => {
  // Check user consent
  const { rows: [user] } = await query(
    `SELECT id, consent_given, is_active, is_flagged, balance FROM users WHERE id = $1`,
    [userId]
  );

  if (!user) throw new Error('User not found');
  if (!user.consent_given) throw new Error('User has not given consent');
  if (!user.is_active) throw new Error('User account is inactive');
  if (user.is_flagged) throw new Error('User account is flagged for suspicious activity');

  // Check device-level rate: min interval between impressions
  const lastImpKey = `last_imp:${userId}:${deviceId}`;
  const lastImp = await get(lastImpKey);
  if (lastImp) {
    const secondsAgo = (Date.now() - lastImp) / 1000;
    if (secondsAgo < MIN_IMPRESSION_INTERVAL) {
      throw new Error(`Too soon. Wait ${Math.ceil(MIN_IMPRESSION_INTERVAL - secondsAgo)}s`);
    }
  }

  // Check daily impression cap
  const dailyKey = `daily_imp:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const dailyCount = (await get(dailyKey)) || 0;
  if (dailyCount >= MAX_IMPRESSIONS_PER_DAY) {
    throw new Error('Daily impression limit reached');
  }

  // Build targeting query
  // Priority: highest CPM, approved, budget available, frequency cap
  const adsQuery = `
    SELECT a.id, a.title, a.description, a.media_url, a.click_url, a.ad_type,
           a.cpm, a.advertiser_id, a.frequency_cap, a.frequency_cap_hours,
           a.target_lat, a.target_lng, a.target_radius_km, a.target_countries,
           adv.balance AS advertiser_balance,
           (a.cpm / 1000.0) AS cost_per_impression,
           (
             SELECT COUNT(*)
             FROM impressions imp
             WHERE imp.ad_id = a.id
               AND imp.user_id = $1
               AND imp.created_at > NOW() - (a.frequency_cap_hours || ' hours')::INTERVAL
           ) AS user_impression_count
    FROM ads a
    JOIN advertisers adv ON adv.id = a.advertiser_id
    WHERE a.status = 'APPROVED'
      AND adv.is_active = TRUE
      AND adv.balance >= (a.cpm / 1000.0)
      AND ($2::varchar[] IS NULL OR a.target_countries @> ARRAY[$3::varchar]
           OR a.target_countries = '{}')
      AND (a.daily_budget IS NULL OR a.spent_today < a.daily_budget)
      AND (a.total_budget IS NULL OR a.total_spent < a.total_budget)
    ORDER BY a.cpm DESC
    LIMIT 20
  `;

  const { rows: candidates } = await query(adsQuery, [
    userId,
    country ? [country] : null,
    country || 'GH',
  ]);

  if (!candidates.length) return null;

  // Filter by frequency cap and location
  let selected = null;
  for (const ad of candidates) {
    // Frequency cap
    if (parseInt(ad.user_impression_count) >= ad.frequency_cap) continue;

    // Location targeting (if set)
    if (ad.target_lat && ad.target_lng && ad.target_radius_km && lat && lng) {
      const dist = haversineKm(lat, lng, ad.target_lat, ad.target_lng);
      if (dist > ad.target_radius_km) continue;
    }

    selected = ad;
    break;
  }

  return selected;
};

/**
 * Haversine distance in km between two lat/lng points
 */
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Record an impression (before financial processing)
 */
const recordImpression = async ({ adId, userId, advertiserId, deviceId, eventType, lat, lng, cpm }) => {
  const userShare     = parseFloat(process.env.USER_REVENUE_SHARE     || '0.60');
  const platformShare = parseFloat(process.env.PLATFORM_REVENUE_SHARE || '0.40');
  const cpmUnit       = cpm / 1000;
  const userReward    = parseFloat((cpmUnit * userShare).toFixed(6));
  const platformFee   = parseFloat((cpmUnit * platformShare).toFixed(6));

  const { rows: [impression] } = await query(
    `INSERT INTO impressions
       (ad_id, user_id, advertiser_id, device_id, event_type, cpm_charged,
        user_reward, platform_fee, lat, lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [adId, userId, advertiserId, deviceId, eventType, cpm, userReward, platformFee,
     lat ? parseFloat(lat).toFixed(4) : null,
     lng ? parseFloat(lng).toFixed(4) : null]
  );

  // Update rate limiting cache
  const lastImpKey = `last_imp:${userId}:${deviceId}`;
  await set(lastImpKey, Date.now(), MIN_IMPRESSION_INTERVAL * 2);

  const dailyKey = `daily_imp:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const redis = require('../utils/redis').getRedis();
  const pipeline = redis.pipeline();
  pipeline.incr(dailyKey);
  pipeline.expire(dailyKey, 86400);
  await pipeline.exec();

  return impression;
};

/**
 * Check for duplicate impression (fraud prevention)
 */
const isDuplicateImpression = async (userId, adId, deviceId) => {
  const { rows } = await query(
    `SELECT id FROM impressions
     WHERE user_id = $1 AND ad_id = $2 AND device_id = $3
       AND created_at > NOW() - INTERVAL '${MIN_IMPRESSION_INTERVAL} seconds'`,
    [userId, adId, deviceId]
  );
  return rows.length > 0;
};

module.exports = { selectAd, recordImpression, isDuplicateImpression };
