// lib/notifications.js
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');

// Allowed notification types (keep in sync with your schema enum)
const ALLOWED_TYPES = new Set([
  'like', 'match', 'message', 'favorite', 'wave', 'system', 'superlike'
]);

/**
 * createNotification({ io, recipientId, senderId, type, message, extra })
 * - Persists a Notification document
 * - Emits `new_notification` to the recipient’s userId room
 * - Emits `notif_update` with unread count
 */
async function createNotification({
  io,
  recipientId,
  senderId = null,
  type = 'system',
  message = '',
  extra = {}
}) {
  try {
    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) return null;
    const rec = new mongoose.Types.ObjectId(recipientId);

    const safeType = ALLOWED_TYPES.has(type) ? type : 'system';

    // Minimal sender payload (nullable)
    let senderDoc = null;
    if (senderId && mongoose.Types.ObjectId.isValid(senderId)) {
      senderDoc = await User.findById(senderId)
        .select('_id username profile.photos')
        .lean();
    }

    // Persist
    const doc = await Notification.create({
      recipient: rec,
      sender: senderDoc ? senderDoc._id : null, // keep null for system notices
      type: safeType,
      message,
      extra: extra || {}
    });

    // Build socket payload
    const payload = {
      _id: String(doc._id),
      type: safeType,
      message,
      sender: senderDoc
        ? {
            _id: String(senderDoc._id),
            username: senderDoc.username,
            avatar: senderDoc?.profile?.photos?.[0] || null
          }
        : null,
      createdAt: doc.createdAt,
      extra: extra || {}
    };

    // Realtime fan-out
    if (io) {
      io.to(String(rec)).emit('new_notification', payload);

      // Unread badge (prefer excluding soft-deleted if your schema supports it)
      let unread = 0;
      try {
        unread = await Notification.countDocuments({
          recipient: rec,
          read: false,
          deletedFor: { $nin: [rec] } // remove this line if your schema has no deletedFor
        });
      } catch {
        unread = await Notification.countDocuments({ recipient: rec, read: false });
      }
      io.to(String(rec)).emit('notif_update', { unread });
    }

    return doc;
  } catch (err) {
    console.error('[notifications] createNotification error:', err);
    return null;
  }
}

module.exports = { createNotification };
