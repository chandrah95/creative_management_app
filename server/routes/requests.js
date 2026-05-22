const express = require('express');
const router = express.Router();
const { list, get, create, update, postComment, postChildComment, updateChild, getTeamMembers } = require('../controllers/requestController');
const { authenticate } = require('../middleware/authenticate');

router.use(authenticate);

router.get('/team-members', getTeamMembers);
router.get('/', list);
router.get('/:id', get);
router.post('/', create);
router.put('/:id', update);
router.post('/:id/comments', postComment);
router.put('/:id/children/:childId', updateChild);
router.post('/:id/children/:childId/comments', postChildComment);

module.exports = router;
