// controllers/notifications.controller.js
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

function getIO(req) {
  return req.io || req.app?.get?.('io') || (typeof io !== 'undefined' ? io : null);
}

// ---------------------- PAGE ----------------------
exports.notificationsPage = async (req, res) => {
  try {
    const me = await User.findById(req.session.userId).lean();
    if (!me) { req.session.destroy(() => {}); return res.redirect('/login'); }

    const meObj = new ObjectId(me._id);
    const notifications = await Notification.find({
      recipient: meObj,
      deletedFor: { $nin: [meObj] }
    })
      .populate('sender', 'username profile.photos')
      .sort({ createdAt: -1 })
      .lean();

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
    ]);

    return res.render('notifications', {
      currentUser: me,
      notifications,
      unreadMessages,
      unreadNotificationCount
    });
  } catch (error) {
    console.error('notifications page err', error);
    return res.status(500).send('Server error');
  }
};

// ---------------------- FEED (infinite scroll) ----------------------
exports.notificationsFeed = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 50);
    const before = req.query.before ? new Date(req.query.before) : null;

    const q = { recipient: me, deletedFor: { $nin: [me] } };
    if (before) q.createdAt = { $lt: before };

    const items = await Notification.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, items });
  } catch (e) {
    console.error('api/notifications err', e);
    return res.status(500).json({ ok: false });
  }
};

// ---------------------- ACTIONS ----------------------
exports.markReadSingle = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const id = String(req.params.id);

    const n = await Notification.findOne({ _id: id, recipient: me });
    if (!n) return res.status(404).send('Notification not found');

    if (!n.read) { n.read = true; await n.save(); }

    // live badge update (respect soft-deletes)
    const unread = await Notification.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });
    const io = getIO(req);
    io && io.to(String(me)).emit('notif_update', { unread });

    return res.redirect('/notifications');
  } catch (error) {
    console.error('mark-read err', error);
    return res.status(500).send('Server error');
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);

    await Notification.updateMany(
      { recipient: me, read: false, deletedFor: { $nin: [me] } },
      { $set: { read: true } }
    );

    const io = getIO(req);
    io && io.to(String(me)).emit('notif_update', { unread: 0 });

    return res.json({ ok: true });
  } catch (e) {
    console.error('mark-all-read err', e);
    return res.status(500).json({ ok: false });
  }
};

exports.dismissOne = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const id = String(req.params.id);

    const result = await Notification.updateOne(
      { _id: id, recipient: me },
      { $addToSet: { deletedFor: me } } // soft delete for me only
    );

    if (!result.modifiedCount) {
      return res.status(404).json({ status: 'error', message: 'Notification not found' });
    }

    // recompute unread after dismiss (respect soft-deletes)
    const unread = await Notification.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });
    const io = getIO(req);
    io && io.to(String(me)).emit('notif_update', { unread });

    return res.json({ status: 'success', message: 'Notification dismissed.', unread });
  } catch (error) {
    console.error('dismiss err', error);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
};

// ---------------------- UNREAD COUNTER ----------------------
exports.unreadCount = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const count = await Notification.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });
    return res.json({ ok: true, count });
  } catch (e) {
    console.error('unread notifs err', e);
    return res.status(500).json({ ok: false });
  }
};
