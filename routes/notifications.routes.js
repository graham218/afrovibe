// routes/notifications.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const Notifs = require('../controllers/notifications.controller');

const router = express.Router();

const validateObjectIdParam = (param) => (req, res, next) => {
  const val = String(req.params[param] || '');
  if (!mongoose.Types.ObjectId.isValid(val)) {
    return res.status(400).json({ status: 'error', message: `Invalid ${param}` });
  }
  next();
};

// Page
router.get('/notifications', checkAuth, Notifs.notificationsPage);

// Feed (infinite scroll)
router.get('/api/notifications', checkAuth, Notifs.notificationsFeed);

// Actions
router.post('/notifications/:id/mark-read',
  checkAuth,
  validateObjectIdParam('id'),
  Notifs.markReadSingle
);

router.post('/notifications/mark-all-read', checkAuth, Notifs.markAllRead);

router.delete('/notifications/dismiss/:id',
  checkAuth,
  validateObjectIdParam('id'),
  Notifs.dismissOne
);

// Unread counter (for navbar badge)
router.get('/api/unread/notifications', checkAuth, Notifs.unreadCount);

module.exports = router;
