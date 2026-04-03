const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const { set, get, del } = require('../utils/redis');
const logger = require('../utils/logger');

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

// Generate a 6-digit OTP
const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP via Twilio or mock
const sendOtp = async (phone) => {
  // Rate-limit check: max OTP_RATE_LIMIT sends per hour
  const rateLimitKey = `otp_rate:${phone}`;
  const currentCount = await get(rateLimitKey) || 0;
  const maxSends = parseInt(process.env.OTP_RATE_LIMIT || '5');

  if (currentCount >= maxSends) {
    throw new Error('Too many OTP requests. Please wait before trying again.');
  }

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate old OTPs for this phone
  await query(
    `UPDATE otp_codes SET used = TRUE WHERE phone = $1 AND used = FALSE`,
    [phone]
  );

  // Store new OTP
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [phone, codeHash, expiresAt]
  );

  // Increment rate limit counter
  const pipeline = require('../utils/redis').getRedis().pipeline();
  pipeline.incr(rateLimitKey);
  pipeline.expire(rateLimitKey, 3600);
  await pipeline.exec();

  // Send via Twilio or mock
  if (process.env.OTP_MOCK_MODE === 'true' || process.env.NODE_ENV === 'test') {
    logger.info('Mock OTP generated', { phone, otp });
    return { mock: true, dev_otp: otp };
  }

  // Production: send via Twilio
  try {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    await twilio.messages.create({
      body: `Your Smart Ad+ verification code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    logger.info('OTP sent via Twilio', { phone });
    return { mock: false };
  } catch (err) {
    logger.error('Twilio send failed', { phone, error: err.message });
    throw new Error('Failed to send OTP. Please try again.');
  }
};

// Verify OTP and return result
const verifyOtp = async (phone, code) => {
  const { rows } = await query(
    `SELECT * FROM otp_codes
     WHERE phone = $1 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );

  if (!rows.length) {
    throw new Error('OTP expired or not found. Please request a new one.');
  }

  const otpRecord = rows[0];

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otpRecord.id]);
    throw new Error('Too many failed attempts. Please request a new OTP.');
  }

  const valid = await bcrypt.compare(code, otpRecord.code_hash);

  if (!valid) {
    await query(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`,
      [otpRecord.id]
    );
    throw new Error('Invalid OTP code.');
  }

  // Mark as used
  await query(`UPDATE otp_codes SET used = TRUE WHERE id = $1`, [otpRecord.id]);

  return true;
};

module.exports = { sendOtp, verifyOtp };
