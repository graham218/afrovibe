// routes/matches.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const Matches = require('../controllers/matches.controller');

const router = express.Router();

const validateObjectIdParam = (param) => (req, res, next) => {
  const val = String(req.params[param] || '');
  if (!mongoose.Types.ObjectId.isValid(val)) {
    return res.status(400).json({ status: 'error', message: `Invalid ${param}` });
  }
  next();
};

// Page
router.get('/matches', checkAuth, Matches.matchesPage);

// Actions
router.post('/unmatch/:id', checkAuth, validateObjectIdParam('id'), Matches.unmatchUser);
router.post('/block/:id',   checkAuth, validateObjectIdParam('id'), Matches.blockUser);
router.post('/unblock/:id', checkAuth, validateObjectIdParam('id'), Matches.unblockUser);

// Block list / confirm views
router.get('/block/:id', checkAuth, Matches.blockConfirm);
router.get('/blocked',   checkAuth, Matches.blockedList);

module.exports = router;

