// utils/notifications.js
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');

async function createNotification({ io, recipientId, senderId, type, message, extra = {} }) {
  try {
    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) return null;
    const rec = new mongoose.Types.ObjectId(recipientId);

    const ALLOWED = new Set(['like','match','message','favorite','wave','system','superlike']);
    const safeType = ALLOWED.has(type) ? type : 'system';

    let sender = null;
    if (senderId && mongoose.Types.ObjectId.isValid(senderId)) {
      sender = await User.findById(senderId).select('_id username profile.photos').lean();
    }

    const doc = await Notification.create({
      recipient: rec,
      sender: sender ? sender._id : null,
      type: safeType,
      message,
      extra: extra || {}
    });

    const payload = {
      _id: String(doc._id),
      type: safeType,
      message,
      sender: sender
        ? { _id: String(sender._id), username: sender.username, avatar: sender.profile?.photos?.[0] || null }
        : null,
      createdAt: doc.createdAt,
      extra: extra || {}
    };

    if (io) {
      io.to(String(rec)).emit('new_notification', payload);
      const unread = await Notification.countDocuments({ recipient: rec, read: false }).catch(() => 0);
      io.to(String(rec)).emit('notif_update', { unread });
    }

    return doc;
  } catch (err) {
    console.error('createNotification err', err);
    return null;
  }
}

module.exports = { createNotification };
