const express = require('express');
const router  = express.Router();
const { sendOtpController, verifyOtpController } = require('../controllers/authController');
const { validate, schemas } = require('../middlewares/validate');
const { otpLimiter } = require('../middlewares/rateLimiter');

router.post('/send-otp',   otpLimiter, validate(schemas.sendOtp),   sendOtpController);
router.post('/verify-otp', otpLimiter, validate(schemas.verifyOtp), verifyOtpController);

module.exports = router;
