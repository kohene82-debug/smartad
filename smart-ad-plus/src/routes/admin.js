const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/adminController');
const { authenticateAdmin } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');

router.post('/login', ctrl.login);

// All routes below require admin auth
router.use(authenticateAdmin);

router.get('/dashboard',         ctrl.getDashboard);
router.get('/ledger',            ctrl.getLedger);
router.get('/platform-earnings', ctrl.getPlatformEarnings);
router.get('/users',             ctrl.getUsers);
router.patch('/users/:id/flag',  ctrl.flagUser);
router.patch('/ads/:id/approve', validate(schemas.approveAd), ctrl.approveAd);

module.exports = router;
