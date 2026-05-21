const express    = require('express');
const router     = express.Router();
const { listLeads, transferDesigner, updateCapacity } = require('../controllers/userController');
const { authenticate } = require('../middleware/authenticate');

router.use(authenticate);
router.get('/leads', listLeads);
router.put('/:id/lead', transferDesigner);
router.put('/:id/capacity', updateCapacity);

module.exports = router;
