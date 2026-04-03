const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis } = require('../utils/redis');

const makeStore = (prefix) => {
  try {
    return new RedisStore({
      sendCommand: (...args) => getRedis().call(...args),
      prefix,
    });
  } catch {
    return undefined; // fall back to memory store if Redis unavailable
  }
};

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:global:'),
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const otpLimiter = rateLimit({
  windowMs: 3600000, // 1 hour
  max: parseInt(process.env.OTP_RATE_LIMIT || '5'),
  keyGenerator: (req) => req.body?.phone || req.ip,
  store: makeStore('rl:otp:'),
  message: { success: false, message: 'Too many OTP requests. Please wait.' },
});

const adRequestLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: parseInt(process.env.AD_REQUEST_RATE_LIMIT || '10'),
  keyGenerator: (req) => req.body?.userId || req.ip,
  store: makeStore('rl:ad:'),
  message: { success: false, message: 'Ad request rate limit exceeded.' },
});

const impressionLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  keyGenerator: (req) => req.body?.userId || req.ip,
  store: makeStore('rl:imp:'),
  message: { success: false, message: 'Impression rate limit exceeded.' },
});

module.exports = { globalLimiter, otpLimiter, adRequestLimiter, impressionLimiter };
