const express = require('express');
const router = express.Router();
const { login, register, getLeads, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');

router.post('/login', login);
router.post('/register', register);
router.get('/leads', getLeads);          // public — used on register page
router.get('/me', authenticate, me);

module.exports = router;
