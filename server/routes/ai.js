const express    = require('express');
const router     = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { getSettings, saveSettings, testConnection, workloadSummary } = require('../controllers/aiController');

router.use(authenticate);

router.get('/settings',          getSettings);
router.post('/settings',         saveSettings);
router.post('/test',             testConnection);
router.get('/workload-summary',  workloadSummary);

module.exports = router;
