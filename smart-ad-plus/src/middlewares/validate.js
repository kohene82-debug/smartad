const Joi = require('joi');
const response = require('../utils/response');

const validate = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property], { abortEarly: false, stripUnknown: true });
  if (error) {
    const details = error.details.map((d) => d.message);
    return response.error(res, 'Validation failed', 422, details);
  }
  req[property] = value;
  next();
};

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

const schemas = {
  sendOtp: Joi.object({
    phone: Joi.string()
      .pattern(/^\+[1-9]\d{7,14}$/)
      .required()
      .messages({ 'string.pattern.base': 'Phone must be in E.164 format e.g. +233201234567' }),
  }),

  verifyOtp: Joi.object({
    phone: Joi.string().pattern(/^\+[1-9]\d{7,14}$/).required(),
    code: Joi.string().length(6).pattern(/^\d+$/).required(),
    deviceId: Joi.string().max(255).required(),
    consentGiven: Joi.boolean().required(),
  }),

  getAd: Joi.object({
    userId: Joi.string().uuid().required(),
    deviceId: Joi.string().max(255).required(),
    eventType: Joi.string().valid('CALL_ENDED', 'SMS_RECEIVED', 'APP_OPEN').required(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    country: Joi.string().max(10).optional(),
  }),

  impression: Joi.object({
    adId: Joi.string().uuid().required(),
    userId: Joi.string().uuid().required(),
    deviceId: Joi.string().max(255).required(),
    eventType: Joi.string().valid('CALL_ENDED', 'SMS_RECEIVED', 'APP_OPEN').required(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
  }),

  click: Joi.object({
    impressionId: Joi.string().uuid().required(),
    adId: Joi.string().uuid().required(),
    userId: Joi.string().uuid().required(),
    deviceId: Joi.string().max(255).required(),
  }),

  withdraw: Joi.object({
    amount: Joi.number().min(1).max(10000).precision(2).required(),
    network: Joi.string().valid('MTN', 'VODAFONE', 'AIRTELTIGO').required(),
    mobileNumber: Joi.string().pattern(/^\+[1-9]\d{7,14}$/).required(),
  }),

  advertiserRegister: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    companyName: Joi.string().min(2).max(255).required(),
    contactName: Joi.string().max(255).optional(),
    phone: Joi.string().pattern(/^\+[1-9]\d{7,14}$/).optional(),
  }),

  advertiserLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  createAd: Joi.object({
    title: Joi.string().min(3).max(255).required(),
    description: Joi.string().max(1000).optional(),
    mediaUrl: Joi.string().uri().required(),
    clickUrl: Joi.string().uri().optional(),
    adType: Joi.string().valid('IMAGE', 'VIDEO').default('IMAGE'),
    cpm: Joi.number().min(0.01).max(1000).required(),
    dailyBudget: Joi.number().min(1).optional(),
    totalBudget: Joi.number().min(1).required(),
    targetCountries: Joi.array().items(Joi.string().max(10)).optional(),
    targetLat: Joi.number().min(-90).max(90).optional(),
    targetLng: Joi.number().min(-180).max(180).optional(),
    targetRadiusKm: Joi.number().min(0.1).max(20000).optional(),
    frequencyCap: Joi.number().integer().min(1).max(100).default(3),
    frequencyCapHours: Joi.number().integer().min(1).max(168).default(24),
  }),

  fundAccount: Joi.object({
    amount: Joi.number().min(5).max(100000).precision(2).required(),
    currency: Joi.string().valid('GHS', 'USD', 'NGN').default('GHS'),
  }),

  approveAd: Joi.object({
    status: Joi.string().valid('APPROVED', 'REJECTED').required(),
    rejectedReason: Joi.string().max(500).optional(),
  }),
};

module.exports = { validate, schemas };
