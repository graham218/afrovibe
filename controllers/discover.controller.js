// controllers/discover.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');

async function list(req, res) {
  try {
    const meId  = String(req.session.userId || '');
    const limit = Math.min(parseInt(req.query.limit || '32', 10), 60);
    const cursor = (req.query.cursor || '').trim();

    const q = { _id: { $ne: meId } };

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      q._id = { ...(q._id || {}), $lt: new mongoose.Types.ObjectId(cursor) };
    }
    if (req.query.onlineNow === '1') q.isOnline = true;
    if (req.query.verifiedOnly === '1') q.verifiedAt = { $exists: true, $ne: null };
    if (req.query.hasPhoto === '1') q['profile.photos.0'] = { $exists: true };
    if (['2','3','4'].includes(String(req.query.minPhotos))) {
      const n = parseInt(req.query.minPhotos, 10);
      for (let i = 0; i < n; i++) q[`profile.photos.${i}`] = { $exists: true };
    }
    const minAge = parseInt(req.query.minAge || '', 10);
    const maxAge = parseInt(req.query.maxAge || '', 10);
    if (!Number.isNaN(minAge) || !Number.isNaN(maxAge)) {
      q['profile.age'] = {};
      if (!Number.isNaN(minAge)) q['profile.age'].$gte = minAge;
      if (!Number.isNaN(maxAge)) q['profile.age'].$lte = maxAge;
    }
    if (req.query.country)       q['profile.country']       = new RegExp(String(req.query.country).trim(), 'i');
    if (req.query.stateProvince) q['profile.stateProvince'] = new RegExp(String(req.query.stateProvince).trim(), 'i');
    if (req.query.city)          q['profile.city']          = new RegExp(String(req.query.city).trim(), 'i');
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).trim(), 'i');
      q.$or = [{ username: rx }, { 'profile.bio': rx }];
    }

    const items = await User.find(q)
      .select('_id username memberLevel verifiedAt isOnline boostActive profile.photos profile.age profile.city profile.stateProvince profile.country')
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const slice   = hasMore ? items.slice(0, limit) : items;
    const next    = hasMore ? String(slice[slice.length - 1]._id) : null;

    res.json({ ok: true, items: slice, next });
  } catch (err) {
    console.error('discover err', err);
    res.status(500).json({ ok: false, items: [], next: null });
  }
}

module.exports = {
  discoverApi: list,
  page: null, // or export a real page renderer if you have one
};
