const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const { communityPage, createPost, likePost, commentOnPost } = require('../controllers/community.controller');

const router = express.Router();
router.get('/community', checkAuth, communityPage);
router.post('/community/post', checkAuth, createPost);
router.post('/community/post/:id/like', checkAuth, likePost);
router.post('/community/post/:id/comment', checkAuth, commentOnPost);
module.exports = router;
