// middleware/fetchUserAndCounts.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

module.exports = async function fetchUserAndCounts(req, res, next) {
  try {
    if (!req.session.userId) return next();
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser) {
      req.session.destroy(() => {});
      return res.redirect('/login');
    }

    const meObj = new mongoose.Types.ObjectId(currentUser._id);
    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
    ]);

    req.currentUser = currentUser;
    req.unreadMessages = unreadMessages;
    req.unreadNotificationCount = unreadNotificationCount;
    next();
  } catch (error) {
    console.error('fetchUserAndCounts err', error);
    res.status(500).send('Server Error');
  }
};
