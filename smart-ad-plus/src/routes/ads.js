const express = require('express');
const router  = express.Router();
const { getAd, trackImpression, trackClick } = require('../controllers/adsController');
const { authenticateUser } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');
const { adRequestLimiter, impressionLimiter } = require('../middlewares/rateLimiter');

router.post('/getAd',      authenticateUser, adRequestLimiter,  validate(schemas.getAd),      getAd);
router.post('/impression', authenticateUser, impressionLimiter, validate(schemas.impression),  trackImpression);
router.post('/click',      authenticateUser, impressionLimiter, validate(schemas.click),       trackClick);

module.exports = router;
