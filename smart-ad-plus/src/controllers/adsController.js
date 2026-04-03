const { query } = require('../utils/db');
const adEngine = require('../services/adEngine');
const ledgerService = require('../services/ledgerService');
const { broadcastToUser } = require('../sockets/wsServer');
const response = require('../utils/response');
const logger = require('../utils/logger');

// POST /ads/getAd
const getAd = async (req, res) => {
  try {
    const { userId, deviceId, eventType, lat, lng, country } = req.body;

    // Validate eventType — only serve after CALL_ENDED or allowed triggers
    const allowedEvents = ['CALL_ENDED', 'SMS_RECEIVED', 'APP_OPEN'];
    if (!allowedEvents.includes(eventType)) {
      return response.error(res, 'Invalid event type', 400);
    }

    const ad = await adEngine.selectAd({ userId, deviceId, lat, lng, eventType, country: country || 'GH' });

    if (!ad) {
      return response.success(res, null, 'No ads available at this time');
    }

    // Coarsen location before logging (GDPR: store only ~1km precision)
    const coarseLat = lat ? Math.round(lat * 10) / 10 : null;
    const coarseLng = lng ? Math.round(lng * 10) / 10 : null;

    // Update user's last known coarse location
    await query(
      `UPDATE users SET coarse_lat = $1, coarse_lng = $2 WHERE id = $3`,
      [coarseLat, coarseLng, userId]
    );

    logger.info('Ad selected', { userId, adId: ad.id, eventType });

    return response.success(res, {
      ad: {
        id:          ad.id,
        title:       ad.title,
        description: ad.description,
        mediaUrl:    ad.media_url,
        clickUrl:    ad.click_url,
        adType:      ad.ad_type,
        cpm:         ad.cpm,
      },
    }, 'Ad retrieved');
  } catch (err) {
    logger.error('getAd error', { error: err.message });
    if (err.message.includes('consent')) return response.error(res, err.message, 403);
    if (err.message.includes('Wait') || err.message.includes('limit')) {
      return response.error(res, err.message, 429);
    }
    return response.error(res, err.message, 400);
  }
};

// POST /ads/impression
const trackImpression = async (req, res) => {
  try {
    const { adId, userId, deviceId, eventType, lat, lng } = req.body;

    // Duplicate check
    const isDuplicate = await adEngine.isDuplicateImpression(userId, adId, deviceId);
    if (isDuplicate) {
      return response.error(res, 'Duplicate impression detected', 409);
    }

    // Fetch ad
    const { rows: [ad] } = await query(
      `SELECT id, cpm, advertiser_id, status FROM ads WHERE id = $1`,
      [adId]
    );
    if (!ad) return response.error(res, 'Ad not found', 404);
    if (ad.status !== 'APPROVED') return response.error(res, 'Ad is not active', 400);

    // Record impression
    const impression = await adEngine.recordImpression({
      adId,
      userId,
      advertiserId: ad.advertiser_id,
      deviceId,
      eventType,
      lat,
      lng,
      cpm: ad.cpm,
    });

    // Process financial transaction (atomic)
    const txResult = await ledgerService.processImpressionTransaction(impression.id);

    // Push real-time balance update to user
    broadcastToUser(userId, {
      type: 'BALANCE_UPDATE',
      balance: txResult.userBalAfter,
      earned:  txResult.userCredit,
      impressionId: impression.id,
    });

    logger.info('Impression tracked and rewarded', {
      impressionId: impression.id,
      userId,
      adId,
      reward: txResult.userCredit,
    });

    return response.success(res, {
      impressionId: impression.id,
      reward:       txResult.userCredit,
      balance:      txResult.userBalAfter,
    }, 'Impression recorded');
  } catch (err) {
    logger.error('trackImpression error', { error: err.message });
    if (err.message.includes('Duplicate')) return response.error(res, err.message, 409);
    if (err.message.includes('budget') || err.message.includes('balance')) {
      return response.error(res, err.message, 402);
    }
    return response.serverError(res, 'Failed to track impression');
  }
};

// POST /ads/click
const trackClick = async (req, res) => {
  try {
    const { impressionId, adId, userId, deviceId } = req.body;

    // Verify impression belongs to user
    const { rows: [imp] } = await query(
      `SELECT id FROM impressions WHERE id = $1 AND user_id = $2 AND ad_id = $3`,
      [impressionId, userId, adId]
    );
    if (!imp) return response.error(res, 'Impression not found or mismatch', 404);

    // Prevent duplicate clicks
    const { rows: existing } = await query(
      `SELECT id FROM clicks WHERE impression_id = $1 AND user_id = $2`,
      [impressionId, userId]
    );
    if (existing.length) return response.error(res, 'Click already recorded', 409);

    await query(
      `INSERT INTO clicks (impression_id, ad_id, user_id, device_id) VALUES ($1,$2,$3,$4)`,
      [impressionId, adId, userId, deviceId]
    );

    await query(
      `UPDATE ads SET clicks_count = clicks_count + 1 WHERE id = $1`,
      [adId]
    );

    return response.success(res, { impressionId }, 'Click recorded');
  } catch (err) {
    logger.error('trackClick error', { error: err.message });
    return response.serverError(res, 'Failed to track click');
  }
};

module.exports = { getAd, trackImpression, trackClick };
