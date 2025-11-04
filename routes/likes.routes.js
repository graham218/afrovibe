// routes/likes.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');

const Likes = require('../controllers/likes.controller');

const router = express.Router();

// Tiny inline validator so we don't depend on external modules
const validateObjectIdParam = (param) => (req, res, next) => {
  const val = String(req.params[param] || '');
  if (!mongoose.Types.ObjectId.isValid(val)) {
    return res.status(400).json({ status: 'error', message: `Invalid ${param}` });
  }
  next();
};

// Apply the daily reset for like/superlike counters on these routes
router.use(Likes.resetDailyLikes);

// Who liked you
router.get('/likes-you', checkAuth, Likes.likesYouView);
router.post('/likes-you/reveal', checkAuth, Likes.likesYouReveal);

// Like / Dislike
router.post('/like/:id', checkAuth, validateObjectIdParam('id'), Likes.likeUser);
router.post('/dislike/:id', checkAuth, validateObjectIdParam('id'), Likes.dislikeUser);

// Superlike (both aliases)
router.post('/superlike/:id', checkAuth, validateObjectIdParam('id'), Likes.superLike);
router.post('/api/superlike/:id', checkAuth, validateObjectIdParam('id'), Likes.superLike);

module.exports = router;
