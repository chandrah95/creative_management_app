const express    = require('express');
const router     = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { getStuck }     = require('../controllers/notificationController');

router.use(authenticate);
router.get('/stuck', getStuck);

module.exports = router;
