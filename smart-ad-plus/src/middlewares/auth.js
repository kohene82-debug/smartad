const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');
const response = require('../utils/response');

// User JWT middleware
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized(res, 'Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return response.unauthorized(res, 'Invalid or expired token');
    }

    if (decoded.type !== 'user') {
      return response.unauthorized(res, 'Invalid token type');
    }

    const { rows: [user] } = await query(
      `SELECT id, phone, consent_given, is_active, balance FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!user || !user.is_active) {
      return response.unauthorized(res, 'User not found or inactive');
    }

    req.user = user;
    next();
  } catch (err) {
    return response.serverError(res, 'Authentication error', err.message);
  }
};

// Advertiser JWT middleware
const authenticateAdvertiser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized(res, 'Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADVERTISER_JWT_SECRET || process.env.JWT_SECRET);
    } catch {
      return response.unauthorized(res, 'Invalid or expired token');
    }

    if (decoded.type !== 'advertiser') {
      return response.unauthorized(res, 'Invalid token type');
    }

    const { rows: [advertiser] } = await query(
      `SELECT id, email, company_name, is_active, balance FROM advertisers WHERE id = $1`,
      [decoded.advertiserId]
    );

    if (!advertiser || !advertiser.is_active) {
      return response.unauthorized(res, 'Advertiser not found or inactive');
    }

    req.advertiser = advertiser;
    next();
  } catch (err) {
    return response.serverError(res, 'Authentication error', err.message);
  }
};

// Admin JWT middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized(res);
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    } catch {
      return response.unauthorized(res, 'Invalid or expired token');
    }

    if (decoded.type !== 'admin') {
      return response.unauthorized(res, 'Admin access required');
    }

    const { rows: [admin] } = await query(
      `SELECT id, email, name, is_active FROM admins WHERE id = $1`,
      [decoded.adminId]
    );

    if (!admin || !admin.is_active) {
      return response.unauthorized(res, 'Admin not found or inactive');
    }

    req.admin = admin;
    next();
  } catch (err) {
    return response.serverError(res, 'Authentication error', err.message);
  }
};

module.exports = { authenticateUser, authenticateAdvertiser, authenticateAdmin };
