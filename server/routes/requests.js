const express = require('express');
const router = express.Router();
const { list, get, create, update } = require('../controllers/requestController');
const { authenticate } = require('../middleware/authenticate');

router.use(authenticate);
router.get('/', list);
router.get('/:id', get);
router.post('/', create);
router.put('/:id', update);

module.exports = router;
