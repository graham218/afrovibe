// controllers/photos.controller.js
const path = require('path');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

const MAX_PHOTOS = Number(process.env.MAX_PHOTOS || 5);
exports.MAX_PHOTOS = MAX_PHOTOS;

/** GET /photos */
exports.photosView = async (req, res) => {
  try {
    const meId = req.session.userId;
    const me = await User.findById(meId).select('profile.photos').lean();
    const userPhotos = Array.isArray(me?.profile?.photos) ? me.profile.photos : [];

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meId, read: false }),
      Notification.countDocuments({ recipient: meId, read: false }),
    ]);

    return res.render('photos', {
      pageTitle: 'Manage Photos',
      userPhotos,
      unreadMessages,
      unreadNotificationCount,
    });
  } catch (err) {
    console.error('GET /photos', err);
    return res.status(500).render('error', { status: 500, message: 'Failed to load photos.' });
  }
};

/** POST /photos  (form field: "photos") */
exports.photosAdd = async (req, res) => {
  try {
    const meId = req.session.userId;
    const me = await User.findById(meId).select('profile.photos').lean();

    const uploaded = (req.files || []).map((file) => '/uploads/' + file.filename);
    const existing = Array.isArray(me?.profile?.photos) ? me.profile.photos : [];
    const merged = Array.from(new Set([...uploaded, ...existing])).slice(0, MAX_PHOTOS);

    await User.updateOne({ _id: meId }, { $set: { 'profile.photos': merged } });
    return res.redirect('/photos?updated=1');
  } catch (e) {
    console.error('POST /photos error', e);
    return res.status(500).render('error', { status: 500, message: 'Could not upload photos.' });
  }
};

/** POST /photos/upload  (AJAX; field: "profilePhotos") */
exports.uploadPhotos = async (req, res) => {
  try {
    const meId = req.session.userId;
    const me = await User.findById(meId).select('profile.photos').lean();
    const existing = Array.isArray(me?.profile?.photos) ? me.profile.photos : [];

    const newOnes = (req.files || []).map((f) => '/uploads/' + path.basename(f.filename));
    const merged = Array.from(new Set([...newOnes, ...existing])).slice(0, MAX_PHOTOS);

    await User.updateOne({ _id: meId }, { $set: { 'profile.photos': merged } });
    return res.json({ status: 'success', message: 'Photos uploaded.', count: merged.length });
  } catch (err) {
    console.error('POST /photos/upload', err);
    return res.status(500).json({ status: 'error', message: 'Upload failed.' });
  }
};

/** POST /photos/set-primary/:idx */
exports.setPrimary = async (req, res) => {
  try {
    const me = await User.findById(req.session.userId).select('profile.photos').exec();
    if (!me || !me.profile || !Array.isArray(me.profile.photos)) {
      return res.status(400).json({ ok: false, message: 'No photos to update.' });
    }

    const idx = Math.max(0, Math.min(Number(req.params.idx || 0), me.profile.photos.length - 1));
    if (!me.profile.photos[idx]) {
      return res.status(404).json({ ok: false, message: 'Photo not found.' });
    }

    const arr = me.profile.photos.slice();
    const [chosen] = arr.splice(idx, 1);
    arr.unshift(chosen);
    me.profile.photos = arr;
    await me.save();

    return res.json({ ok: true, message: 'Profile photo set.', primary: chosen });
  } catch (e) {
    console.error('set-primary err', e);
    return res.status(500).json({ ok: false, message: 'Failed to set profile photo.' });
  }
};

/** POST /photos/delete/:photoIndex  (index-based) */
exports.deleteByIndex = async (req, res) => {
  try {
    const idx = parseInt(req.params.photoIndex, 10);
    if (Number.isNaN(idx)) {
      return res.status(400).json({ status: 'error', message: 'Bad index' });
    }

    const meId = req.session.userId;
    const me = await User.findById(meId).select('profile.photos').lean();
    const arr = Array.isArray(me?.profile?.photos) ? me.profile.photos.slice() : [];

    if (idx < 0 || idx >= arr.length) {
      return res.status(404).json({ status: 'error', message: 'Photo not found' });
    }

    arr.splice(idx, 1);
    await User.updateOne({ _id: meId }, { $set: { 'profile.photos': arr } });
    return res.json({ status: 'success', message: 'Photo deleted.', count: arr.length });
  } catch (err) {
    console.error('POST /photos/delete/:photoIndex', err);
    return res.status(500).json({ status: 'error', message: 'Delete failed.' });
  }
};

/** POST /photos/delete  (body.photoUrl) */
exports.deleteByUrl = async (req, res) => {
  try {
    const photoUrl = (req.body.photoUrl || '').toString().trim();
    if (!photoUrl) {
      return res.status(400).json({ status: 'error', message: 'Missing photoUrl' });
    }

    const meId = req.session.userId;
    const me = await User.findById(meId).select('profile.photos').lean();
    const arr = Array.isArray(me?.profile?.photos) ? me.profile.photos.slice() : [];

    const next = arr.filter((p) => p !== photoUrl);
    if (next.length === arr.length) {
      return res.status(404).json({ status: 'error', message: 'Photo not found' });
    }

    await User.updateOne({ _id: meId }, { $set: { 'profile.photos': next } });
    return res.json({ status: 'success', message: 'Photo deleted.', count: next.length });
  } catch (err) {
    console.error('POST /photos/delete', err);
    return res.status(500).json({ status: 'error', message: 'Delete failed.' });
  }
};
