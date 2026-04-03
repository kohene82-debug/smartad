/**
 * LEDGER SERVICE
 * All financial operations MUST go through this service.
 * Every balance change is recorded as an immutable ledger entry.
 * Direct balance updates outside this service are forbidden.
 */

const { getClient } = require('../utils/db');
const logger = require('../utils/logger');

/**
 * Process an ad impression atomically:
 * 1. Debit advertiser  (AD_SPEND)
 * 2. Credit user       (USER_REWARD)
 * 3. Credit platform   (PLATFORM_REVENUE)
 * Rolls back entirely if any step fails.
 */
const processImpressionTransaction = async (impressionId) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Load impression with all needed data
    const { rows: [impression] } = await client.query(
      `SELECT i.*, a.cpm, a.advertiser_id,
              adv.balance AS advertiser_balance,
              u.balance   AS user_balance
       FROM impressions i
       JOIN ads        a ON a.id = i.ad_id
       JOIN advertisers adv ON adv.id = i.advertiser_id
       JOIN users      u ON u.id = i.user_id
       WHERE i.id = $1
       FOR UPDATE OF adv, u`,
      [impressionId]
    );

    if (!impression) throw new Error('Impression not found');
    if (impression.rewarded) throw new Error('Impression already rewarded');

    const userShare     = parseFloat(process.env.USER_REVENUE_SHARE     || '0.60');
    const platformShare = parseFloat(process.env.PLATFORM_REVENUE_SHARE || '0.40');
    const cpmUnit       = impression.cpm_charged / 1000; // CPM → per impression cost

    const advertiserDebit  = parseFloat(cpmUnit.toFixed(6));
    const userCredit       = parseFloat((cpmUnit * userShare).toFixed(6));
    const platformCredit   = parseFloat((cpmUnit * platformShare).toFixed(6));

    const advBalBefore  = parseFloat(impression.advertiser_balance);
    const userBalBefore = parseFloat(impression.user_balance);

    if (advBalBefore < advertiserDebit) {
      throw new Error('Insufficient advertiser balance');
    }

    const advBalAfter  = parseFloat((advBalBefore  - advertiserDebit).toFixed(6));
    const userBalAfter = parseFloat((userBalBefore + userCredit).toFixed(6));

    // 1. Debit advertiser
    await client.query(
      `UPDATE advertisers
       SET balance = $1, total_spent = total_spent + $2, updated_at = NOW()
       WHERE id = $3`,
      [advBalAfter, advertiserDebit, impression.advertiser_id]
    );

    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
       VALUES (NULL, $1, 'AD_SPEND', $2, $3, $4, $5, 'impression', 'Ad spend for impression')`,
      [impression.advertiser_id, advertiserDebit, advBalBefore, advBalAfter, impressionId]
    );

    // 2. Credit user
    await client.query(
      `UPDATE users
       SET balance = $1, total_earned = total_earned + $2, updated_at = NOW()
       WHERE id = $3`,
      [userBalAfter, userCredit, impression.user_id]
    );

    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
       VALUES ($1, NULL, 'USER_REWARD', $2, $3, $4, $5, 'impression', 'User reward for ad view')`,
      [impression.user_id, userCredit, userBalBefore, userBalAfter, impressionId]
    );

    // 3. Platform revenue record
    await client.query(
      `INSERT INTO platform_revenue (impression_id, amount) VALUES ($1, $2)`,
      [impressionId, platformCredit]
    );

    // Use a system ledger record for platform revenue (advertiser_id tracks the source)
    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
       VALUES (NULL, $1, 'PLATFORM_REVENUE', $2, 0, 0, $3, 'impression', 'Platform revenue share')`,
      [impression.advertiser_id, platformCredit, impressionId]
    );

    // 4. Mark impression as rewarded + update ad counters
    await client.query(
      `UPDATE impressions SET rewarded = TRUE WHERE id = $1`,
      [impressionId]
    );

    await client.query(
      `UPDATE ads
       SET impressions_count = impressions_count + 1,
           spent_today = spent_today + $1,
           total_spent = total_spent + $1
       WHERE id = $2`,
      [advertiserDebit, impression.ad_id]
    );

    // 5. Master transaction log
    await client.query(
      `INSERT INTO transactions
         (advertiser_id, user_id, impression_id, advertiser_debit, user_credit, platform_credit)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [impression.advertiser_id, impression.user_id, impressionId,
       advertiserDebit, userCredit, platformCredit]
    );

    await client.query('COMMIT');

    logger.info('Impression transaction committed', {
      impressionId,
      advertiserDebit,
      userCredit,
      platformCredit,
    });

    return { userCredit, userBalAfter, advertiserDebit, platformCredit };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Impression transaction rolled back', { error: err.message, impressionId });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Process a user withdrawal atomically.
 */
const processWithdrawal = async (userId, amount, withdrawalId) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [user] } = await client.query(
      `SELECT id, balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (!user) throw new Error('User not found');

    const balBefore = parseFloat(user.balance);
    const amt       = parseFloat(amount);

    if (balBefore < amt) throw new Error('Insufficient balance');

    const balAfter = parseFloat((balBefore - amt).toFixed(6));

    await client.query(
      `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [balAfter, userId]
    );

    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
       VALUES ($1, NULL, 'WITHDRAWAL', $2, $3, $4, $5, 'withdrawal', 'User withdrawal')`,
      [userId, amt, balBefore, balAfter, withdrawalId]
    );

    await client.query(
      `UPDATE withdrawals SET status = 'PROCESSING' WHERE id = $1`,
      [withdrawalId]
    );

    await client.query('COMMIT');

    logger.info('Withdrawal transaction committed', { userId, amount: amt, withdrawalId });
    return { balAfter, amt };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Withdrawal transaction rolled back', { error: err.message, userId });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Process an advertiser deposit atomically.
 */
const processAdvertiserDeposit = async (advertiserId, amount, paymentId) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [adv] } = await client.query(
      `SELECT id, balance FROM advertisers WHERE id = $1 FOR UPDATE`,
      [advertiserId]
    );

    if (!adv) throw new Error('Advertiser not found');

    const balBefore = parseFloat(adv.balance);
    const amt       = parseFloat(amount);
    const balAfter  = parseFloat((balBefore + amt).toFixed(6));

    await client.query(
      `UPDATE advertisers SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [balAfter, advertiserId]
    );

    await client.query(
      `INSERT INTO ledger
         (user_id, advertiser_id, type, amount, balance_before, balance_after, reference_id, reference_type, description)
       VALUES (NULL, $1, 'DEPOSIT', $2, $3, $4, $5, 'payment', 'Advertiser account funding')`,
      [advertiserId, amt, balBefore, balAfter, paymentId]
    );

    await client.query(
      `UPDATE payments SET status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
      [paymentId]
    );

    await client.query('COMMIT');

    logger.info('Advertiser deposit committed', { advertiserId, amount: amt, paymentId });
    return { balAfter, amt };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Advertiser deposit rolled back', { error: err.message, advertiserId });
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  processImpressionTransaction,
  processWithdrawal,
  processAdvertiserDeposit,
};
