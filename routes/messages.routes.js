// routes/messages.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const Messages = require('../controllers/messages.controller');

const router = express.Router();

// --- tiny param validator ---
const validateObjectIdParam = (param) => (req, res, next) => {
  const val = String(req.params[param] || '');
  if (!mongoose.Types.ObjectId.isValid(val)) {
    return res.status(400).json({ ok: false, error: `bad_${param}` });
  }
  next();
};

// --- pages ---
router.get('/messages',  checkAuth, Messages.messagesPage);
router.get('/chat/:id',  checkAuth, validateObjectIdParam('id'), Messages.chatPage);

// --- send / fetch / read ---
router.post('/api/messages', checkAuth, Messages.messagesLimiter, Messages.vMessageSend, Messages.sendMessage);
router.get('/api/messages/:otherUserId', checkAuth, validateObjectIdParam('otherUserId'), Messages.fetchThreadPage);
router.post('/api/messages/:otherUserId/read', checkAuth, validateObjectIdParam('otherUserId'), Messages.markThreadRead);

// --- clear / bulk ---
router.delete('/api/messages/:otherUserId', checkAuth, validateObjectIdParam('otherUserId'), Messages.clearThreadForMe);
router.post('/api/messages/:otherUserId/clear', checkAuth, validateObjectIdParam('otherUserId'), Messages.clearThreadForMe);
router.post('/api/messages/bulk', checkAuth, Messages.bulkMessages);

// --- unread counters ---
router.get('/api/unread/threads',  checkAuth, Messages.unreadByThread);
router.get('/api/unread/messages', checkAuth, Messages.unreadTotal);

// --- rtc / call request ---
router.post('/api/call/request/:id', checkAuth, validateObjectIdParam('id'), Messages.requestCall);

module.exports = router;

