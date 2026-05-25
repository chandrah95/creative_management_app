const express = require('express');
const router = express.Router();
const { list, get, create, update, remove, removeChild, postComment, postChildComment, updateChild, getTeamMembers } = require('../controllers/requestController');
const { authenticate } = require('../middleware/authenticate');

router.use(authenticate);

router.get('/team-members', getTeamMembers);
router.get('/', list);
router.get('/:id', get);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/comments', postComment);
router.put('/:id/children/:childId', updateChild);
router.delete('/:id/children/:childId', removeChild);
router.post('/:id/children/:childId/comments', postChildComment);

module.exports = router;
