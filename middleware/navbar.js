const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { DAILY_LIKE_LIMIT } = require('../config/constants');

module.exports = async function navbar(req, res, next) {
  try {
    res.locals.currentUser = res.locals.currentUser || null;
    res.locals.avatarUrl = '/images/default-avatar.png';
    res.locals.unreadMessages = 0;
    res.locals.unreadNotificationCount = 0;
    res.locals.likesRemaining = -1;
    res.locals.streak = { day: 0, target: 7, percentage: 0 };

    if (!req.session?.userId) return next();

    const meId  = req.session.userId;
    const meObj = new mongoose.Types.ObjectId(meId);

    const u = await User.findById(meId)
      .select('username profile.photos profile.city profile.country verifiedAt plan isPremium likesToday lastLikeDate streakDay boostExpiresAt')
      .lean();

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false }),
    ]);

    let likesRemaining = -1;
    if (u && !u.isPremium) {
      const todayKey = new Date().toDateString();
      const lastKey  = u.lastLikeDate ? new Date(u.lastLikeDate).toDateString() : null;
      const used     = todayKey !== lastKey ? 0 : Number(u.likesToday || 0);
      likesRemaining = Math.max(DAILY_LIKE_LIMIT - used, 0);
    }

    const raw = u?.profile?.photos?.[0] || '';
    const url = raw ? (raw.startsWith('/') ? raw : '/' + raw) : '/images/default-avatar.png';

    const streak = {
      day: Number(u?.streakDay || 0),
      target: 7,
      percentage: Math.max(0, Math.min(100, ((Number(u?.streakDay || 0)) / 7) * 100)),
    };

    res.locals.currentUser = u || null;
    res.locals.avatarUrl = url;
    res.locals.unreadMessages = unreadMessages || 0;
    res.locals.unreadNotificationCount = unreadNotificationCount || 0;
    res.locals.likesRemaining = likesRemaining;
    res.locals.streak = streak;

    next();
  } catch (e) { console.error('[navbar] err', e); next(); }
};
