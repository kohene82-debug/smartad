const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const ledgerService = require('../services/ledgerService');
const paymentGatewayService = require('../services/paymentGatewayService');
const response = require('../utils/response');
const logger = require('../utils/logger');

// POST /advertiser/register
const register = async (req, res) => {
  try {
    const { email, password, companyName, contactName, phone } = req.body;

    const { rows: existing } = await query(
      `SELECT id FROM advertisers WHERE email = $1`,
      [email]
    );
    if (existing.length) return response.error(res, 'Email already registered', 409);

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows: [advertiser] } = await query(
      `INSERT INTO advertisers (email, password_hash, company_name, contact_name, phone)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, email, company_name, balance`,
      [email, passwordHash, companyName, contactName || null, phone || null]
    );

    logger.info('Advertiser registered', { advertiserId: advertiser.id, email });

    return response.created(res, {
      id: advertiser.id,
      email: advertiser.email,
      companyName: advertiser.company_name,
    }, 'Advertiser account created. Please fund your account to run ads.');
  } catch (err) {
    logger.error('advertiser register error', { error: err.message });
    return response.serverError(res, 'Registration failed');
  }
};

// POST /advertiser/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows: [advertiser] } = await query(
      `SELECT id, email, password_hash, company_name, balance, is_active FROM advertisers WHERE email = $1`,
      [email]
    );

    if (!advertiser || !advertiser.is_active) {
      return response.unauthorized(res, 'Invalid credentials or inactive account');
    }

    const valid = await bcrypt.compare(password, advertiser.password_hash);
    if (!valid) return response.unauthorized(res, 'Invalid credentials');

    const token = jwt.sign(
      { advertiserId: advertiser.id, email: advertiser.email, type: 'advertiser' },
      process.env.ADVERTISER_JWT_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return response.success(res, {
      token,
      advertiser: {
        id: advertiser.id,
        email: advertiser.email,
        companyName: advertiser.company_name,
        balance: parseFloat(advertiser.balance),
      },
    }, 'Login successful');
  } catch (err) {
    logger.error('advertiser login error', { error: err.message });
    return response.serverError(res, 'Login failed');
  }
};

// POST /advertiser/createAd
const createAd = async (req, res) => {
  try {
    const advertiserId = req.advertiser.id;
    const {
      title, description, mediaUrl, clickUrl, adType, cpm,
      dailyBudget, totalBudget, targetCountries, targetLat, targetLng,
      targetRadiusKm, frequencyCap, frequencyCapHours,
    } = req.body;

    // Check advertiser has enough balance to run at least 1 impression
    const { rows: [adv] } = await query(
      `SELECT balance FROM advertisers WHERE id = $1`,
      [advertiserId]
    );

    if (parseFloat(adv.balance) < cpm / 1000) {
      return response.error(res, 'Insufficient balance to create ad. Please fund your account.', 402);
    }

    const { rows: [ad] } = await query(
      `INSERT INTO ads
         (advertiser_id, title, description, media_url, click_url, ad_type, cpm,
          daily_budget, total_budget, target_countries, target_lat, target_lng,
          target_radius_km, frequency_cap, frequency_cap_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        advertiserId, title, description || null, mediaUrl, clickUrl || null, adType, cpm,
        dailyBudget || null, totalBudget,
        targetCountries ? `{${targetCountries.join(',')}}` : '{GH}',
        targetLat || null, targetLng || null, targetRadiusKm || null,
        frequencyCap, frequencyCapHours,
      ]
    );

    logger.info('Ad created', { advertiserId, adId: ad.id });

    return response.created(res, {
      id: ad.id,
      title: ad.title,
      status: ad.status,
      cpm: ad.cpm,
      totalBudget: ad.total_budget,
    }, 'Ad submitted for review. It will go live once approved by an admin.');
  } catch (err) {
    logger.error('createAd error', { error: err.message });
    return response.serverError(res, 'Failed to create ad');
  }
};

// GET /advertiser/ads
const getAds = async (req, res) => {
  try {
    const advertiserId = req.advertiser.id;
    const { rows } = await query(
      `SELECT id, title, status, ad_type, cpm, total_budget, total_spent,
              impressions_count, clicks_count, created_at
       FROM ads WHERE advertiser_id = $1 ORDER BY created_at DESC`,
      [advertiserId]
    );
    return response.success(res, { ads: rows });
  } catch (err) {
    return response.serverError(res, 'Failed to fetch ads');
  }
};

// POST /advertiser/fundAccount
const fundAccount = async (req, res) => {
  try {
    const advertiserId = req.advertiser.id;
    const { amount, currency } = req.body;
    const paymentId = uuidv4();
    const reference = `SAP_${advertiserId.slice(0, 8)}_${paymentId.slice(0, 8)}`.toUpperCase();

    // Create pending payment record
    await query(
      `INSERT INTO payments (id, advertiser_id, amount, currency, gateway, gateway_ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [paymentId, advertiserId, amount, currency, process.env.PAYMENT_GATEWAY || 'paystack', reference]
    );

    const { rows: [adv] } = await query(
      `SELECT email, company_name FROM advertisers WHERE id = $1`,
      [advertiserId]
    );

    const result = await paymentGatewayService.initializePayment({
      email: adv.email,
      amountGHS: amount,
      amountUSD: amount,
      reference,
      advertiserId,
      name: adv.company_name,
    });

    return response.success(res, {
      paymentId,
      reference,
      authorizationUrl: result.authorizationUrl,
      gateway: result.gateway || process.env.PAYMENT_GATEWAY,
    }, 'Payment initialized. Complete payment at the authorization URL.');
  } catch (err) {
    logger.error('fundAccount error', { error: err.message });
    return response.serverError(res, 'Failed to initialize payment');
  }
};

// POST /advertiser/payment/init  (verify + credit)
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    const advertiserId = req.advertiser.id;

    const { rows: [payment] } = await query(
      `SELECT * FROM payments WHERE gateway_ref = $1 AND advertiser_id = $2`,
      [reference, advertiserId]
    );

    if (!payment) return response.error(res, 'Payment not found', 404);
    if (payment.status === 'SUCCESS') {
      return response.error(res, 'Payment already verified', 409);
    }

    const verifyResult = await paymentGatewayService.verifyPayment(reference);

    if (verifyResult.status !== 'success') {
      await query(
        `UPDATE payments SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [payment.id]
      );
      return response.error(res, 'Payment verification failed', 402);
    }

    // Credit advertiser account atomically
    const { balAfter } = await ledgerService.processAdvertiserDeposit(
      advertiserId,
      payment.amount,
      payment.id
    );

    return response.success(res, {
      amount: payment.amount,
      newBalance: balAfter,
    }, 'Account funded successfully');
  } catch (err) {
    logger.error('verifyPayment error', { error: err.message });
    return response.serverError(res, 'Payment verification failed');
  }
};

module.exports = { register, login, createAd, getAds, fundAccount, verifyPayment };
