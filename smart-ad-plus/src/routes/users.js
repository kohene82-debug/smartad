const express = require('express');
const router  = express.Router();
const { getDashboardStats, getRewards, withdraw, deleteData } = require('../controllers/userController');
const { authenticateUser } = require('../middlewares/auth');
const { validate, schemas } = require('../middlewares/validate');

router.get('/dashboard/stats', authenticateUser, getDashboardStats);
router.get('/rewards',         authenticateUser, getRewards);
router.post('/withdraw',       authenticateUser, validate(schemas.withdraw), withdraw);
router.delete('/delete-data',  authenticateUser, deleteData);

module.exports = router;
