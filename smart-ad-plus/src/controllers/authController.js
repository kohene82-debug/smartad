const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');
const { sendOtp, verifyOtp } = require('../services/otpService');
const response = require('../utils/response');
const logger = require('../utils/logger');

const sendOtpController = async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await sendOtp(phone);

    const data = { phone, message: `OTP sent to ${phone}` };
    if (result.mock) data.dev_otp = result.dev_otp; // only in mock/dev mode

    return response.success(res, data, 'OTP sent successfully');
  } catch (err) {
    logger.error('sendOtp error', { error: err.message });
    return response.error(res, err.message, 429);
  }
};

const verifyOtpController = async (req, res) => {
  try {
    const { phone, code, deviceId, consentGiven } = req.body;

    await verifyOtp(phone, code);

    // Upsert user
    const { rows: [user] } = await query(
      `INSERT INTO users (phone, device_id, consent_given, consent_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE
         SET device_id     = EXCLUDED.device_id,
             consent_given = CASE WHEN EXCLUDED.consent_given THEN TRUE ELSE users.consent_given END,
             consent_at    = CASE WHEN EXCLUDED.consent_given THEN NOW() ELSE users.consent_at END,
             updated_at    = NOW()
       RETURNING id, phone, consent_given, balance`,
      [phone, deviceId, consentGiven, consentGiven ? new Date() : null]
    );

    const token = jwt.sign(
      { userId: user.id, phone: user.phone, type: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info('User authenticated', { userId: user.id, phone: user.phone });

    return response.success(res, {
      token,
      user: {
        id: user.id,
        phone: user.phone,
        consentGiven: user.consent_given,
        balance: user.balance,
      },
    }, 'Login successful');
  } catch (err) {
    logger.error('verifyOtp error', { error: err.message });
    return response.error(res, err.message, 400);
  }
};

module.exports = { sendOtpController, verifyOtpController };
