const express    = require('express');
const router     = express.Router();
const { listLeads, transferDesigner } = require('../controllers/userController');
const { authenticate } = require('../middleware/authenticate');

router.use(authenticate);
router.get('/leads', listLeads);
router.put('/:id/lead', transferDesigner);

module.exports = router;
