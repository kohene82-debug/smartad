const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');
const response = require('../utils/response');
const logger = require('../utils/logger');

// POST /admin/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows: [admin] } = await query(
      `SELECT id, email, password_hash, name, is_active FROM admins WHERE email = $1`,
      [email]
    );
    if (!admin || !admin.is_active) return response.unauthorized(res, 'Invalid credentials');
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return response.unauthorized(res, 'Invalid credentials');

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, type: 'admin' },
      process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    return response.success(res, { token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    return response.serverError(res, 'Login failed');
  }
};

// GET /admin/dashboard
const getDashboard = async (req, res) => {
  try {
    const [users, advertisers, ads, impressions, revenue] = await Promise.all([
      query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN is_active THEN 1 END) AS active FROM users`),
      query(`SELECT COUNT(*) AS total, SUM(balance) AS total_balance FROM advertisers`),
      query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN status='APPROVED' THEN 1 END) AS approved, COUNT(CASE WHEN status='PENDING' THEN 1 END) AS pending FROM ads`),
      query(`SELECT COUNT(*) AS total, COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS today FROM impressions`),
      query(`SELECT COALESCE(SUM(amount),0) AS total FROM platform_revenue`),
    ]);

    return response.success(res, {
      users:       { total: parseInt(users.rows[0].total), active: parseInt(users.rows[0].active) },
      advertisers: { total: parseInt(advertisers.rows[0].total), totalBalance: parseFloat(advertisers.rows[0].total_balance || 0) },
      ads:         { total: parseInt(ads.rows[0].total), approved: parseInt(ads.rows[0].approved), pending: parseInt(ads.rows[0].pending) },
      impressions: { total: parseInt(impressions.rows[0].total), today: parseInt(impressions.rows[0].today) },
      platformRevenue: parseFloat(revenue.rows[0].total),
    });
  } catch (err) {
    logger.error('dashboard error', { error: err.message });
    return response.serverError(res, 'Failed to load dashboard');
  }
};

// GET /admin/ledger
const getLedger = async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT l.*, u.phone AS user_phone, a.company_name AS advertiser_name
       FROM ledger l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN advertisers a ON a.id = l.advertiser_id
       ORDER BY l.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: [count] } = await query(`SELECT COUNT(*) AS total FROM ledger`);

    return response.success(res, {
      ledger: rows,
      pagination: { page, limit, total: parseInt(count.total), pages: Math.ceil(count.total / limit) },
    });
  } catch (err) {
    return response.serverError(res, 'Failed to fetch ledger');
  }
};

// GET /admin/platform-earnings
const getPlatformEarnings = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         DATE(pr.created_at) AS date,
         COUNT(*) AS impressions,
         SUM(pr.amount) AS revenue
       FROM platform_revenue pr
       GROUP BY DATE(pr.created_at)
       ORDER BY date DESC
       LIMIT 30`
    );
    const { rows: [total] } = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM platform_revenue`);
    return response.success(res, { daily: rows, totalRevenue: parseFloat(total.total) });
  } catch (err) {
    return response.serverError(res, 'Failed to fetch platform earnings');
  }
};

// PATCH /admin/ads/:id/approve
const approveAd = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectedReason } = req.body;

    const { rows: [ad] } = await query(
      `UPDATE ads
       SET status = $1,
           approved_at = CASE WHEN $1 = 'APPROVED' THEN NOW() ELSE NULL END,
           approved_by = $2,
           rejected_reason = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, title, status`,
      [status, req.admin.id, rejectedReason || null, id]
    );

    if (!ad) return response.notFound(res, 'Ad not found');

    logger.info('Ad status updated', { adId: id, status, adminId: req.admin.id });
    return response.success(res, { ad }, `Ad ${status.toLowerCase()} successfully`);
  } catch (err) {
    return response.serverError(res, 'Failed to update ad status');
  }
};

// GET /admin/users (list + flag management)
const getUsers = async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT id, phone, balance, total_earned, consent_given, is_active, is_flagged, flag_reason, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: [count] } = await query(`SELECT COUNT(*) AS total FROM users`);
    return response.success(res, { users: rows, pagination: { page, limit, total: parseInt(count.total) } });
  } catch (err) {
    return response.serverError(res, 'Failed to fetch users');
  }
};

// PATCH /admin/users/:id/flag
const flagUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { flagged, reason } = req.body;
    await query(
      `UPDATE users SET is_flagged = $1, flag_reason = $2, updated_at = NOW() WHERE id = $3`,
      [flagged, reason || null, id]
    );
    return response.success(res, {}, `User ${flagged ? 'flagged' : 'unflagged'}`);
  } catch (err) {
    return response.serverError(res, 'Failed to flag user');
  }
};

module.exports = { login, getDashboard, getLedger, getPlatformEarnings, approveAd, getUsers, flagUser };
