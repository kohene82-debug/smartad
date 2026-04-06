const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const ledgerService = require('../services/ledgerService');
const paymentGatewayService = require('../services/paymentGatewayService');
const { broadcastToUser } = require('../sockets/wsServer');
const response = require('../utils/response');
const logger = require('../utils/logger');

// GET /dashboard/stats
const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows: [user] } = await query(
      `SELECT id, phone, balance, total_earned FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return response.notFound(res, 'User not found');
    }

    const { rows: [impressionStats] } = await query(
      `SELECT COUNT(*) AS ads_viewed FROM impressions WHERE user_id = $1`,
      [userId]
    );

    const { rows: [clickStats] } = await query(
      `SELECT COUNT(*) AS ads_clicked FROM clicks WHERE user_id = $1`,
      [userId]
    );

    const { rows: [rewardStats] } = await query(
      `SELECT COALESCE(SUM(user_reward), 0) AS total_rewards
       FROM impressions
       WHERE user_id = $1 AND rewarded = TRUE`,
      [userId]
    );

    const { rows: [withdrawalStats] } = await query(
      `SELECT COUNT(*) AS pending_withdrawals
       FROM withdrawals
       WHERE user_id = $1 AND status = 'PENDING'`,
      [userId]
    );

    return response.success(res, {
      userId: user.id,
      phone: user.phone,
      balance: parseFloat(user.balance),
      totalEarned: parseFloat(user.total_earned),
      adsViewed: parseInt(impressionStats.ads_viewed),
      adsClicked: parseInt(clickStats.ads_clicked),
      totalRewards: parseFloat(rewardStats.total_rewards),
      pendingWithdrawals: parseInt(withdrawalStats.pending_withdrawals),
    });
  } catch (err) {
    logger.error('getDashboardStats error', { error: err.message, stack: err.stack });
    return response.serverError(res, 'Failed to fetch dashboard stats');
  }
};

// GET /users/rewards
const getRewards = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows: [user] } = await query(
      `SELECT id, phone, balance, total_earned, consent_given, created_at FROM users WHERE id = $1`,
      [userId]
    );

    const { rows: ledger } = await query(
      `SELECT type, amount, balance_before, balance_after, description, created_at
       FROM ledger
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    const { rows: stats } = await query(
      `SELECT
         COUNT(*) AS total_impressions,
         SUM(user_reward) AS total_earned_raw,
         COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS today_impressions
       FROM impressions
       WHERE user_id = $1 AND rewarded = TRUE`,
      [userId]
    );

    return response.success(res, {
      user: {
        id: user.id,
        phone: user.phone,
        balance: parseFloat(user.balance),
        totalEarned: parseFloat(user.total_earned),
        consentGiven: user.consent_given,
        memberSince: user.created_at,
      },
      stats: {
        totalImpressions: parseInt(stats[0].total_impressions),
        todayImpressions: parseInt(stats[0].today_impressions),
      },
      ledger,
    });
  } catch (err) {
    logger.error('getRewards error', { error: err.message });
    return response.serverError(res, 'Failed to fetch rewards');
  }
};

// POST /users/withdraw
const withdraw = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, network, mobileNumber } = req.body;

    // Check balance
    const { rows: [user] } = await query(
      `SELECT balance FROM users WHERE id = $1`,
      [userId]
    );

    if (parseFloat(user.balance) < parseFloat(amount)) {
      return response.error(res, 'Insufficient balance', 402);
    }

    const MIN_WITHDRAWAL = 5;
    if (parseFloat(amount) < MIN_WITHDRAWAL) {
      return response.error(res, `Minimum withdrawal is ${MIN_WITHDRAWAL}`, 400);
    }

    // Create withdrawal record
    const withdrawalId = uuidv4();
    await query(
      `INSERT INTO withdrawals (id, user_id, amount, network, mobile_number)
       VALUES ($1,$2,$3,$4,$5)`,
      [withdrawalId, userId, amount, network, mobileNumber]
    );

    // Atomic ledger deduction
    const { balAfter } = await ledgerService.processWithdrawal(userId, amount, withdrawalId);

    // Initiate payout
    const payoutResult = await paymentGatewayService.initiateMobileMoneyPayout({
      amount,
      network,
      mobileNumber,
      reference: withdrawalId,
    });

    // Update withdrawal with gateway ref
    await query(
      `UPDATE withdrawals SET gateway_ref = $1, gateway_response = $2 WHERE id = $3`,
      [payoutResult.transferCode, JSON.stringify(payoutResult), withdrawalId]
    );

    // Real-time balance push
    broadcastToUser(userId, {
      type: 'BALANCE_UPDATE',
      balance: balAfter,
      event: 'WITHDRAWAL',
      amount,
    });

    logger.info('Withdrawal initiated', { userId, amount, withdrawalId });

    return response.success(res, {
      withdrawalId,
      amount,
      network,
      mobileNumber,
      status: 'PROCESSING',
      newBalance: balAfter,
    }, 'Withdrawal initiated successfully');
  } catch (err) {
    logger.error('withdraw error', { error: err.message });
    return response.error(res, err.message, 400);
  }
};

// DELETE /users/delete-data  (GDPR)
const deleteData = async (req, res) => {
  try {
    const userId = req.user.id;

    // Anonymize — retain financial records for audit, remove PII
    await query(
      `UPDATE users
       SET phone = 'DELETED_' || id,
           device_id = NULL,
           coarse_lat = NULL,
           coarse_lng = NULL,
           consent_given = FALSE,
           is_active = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    logger.info('User data deleted (GDPR)', { userId });

    return response.success(res, {}, 'Your data has been deleted in compliance with GDPR');
  } catch (err) {
    logger.error('deleteData error', { error: err.message });
    return response.serverError(res, 'Failed to delete data');
  }
};

module.exports = { getDashboardStats, getRewards, withdraw, deleteData };
