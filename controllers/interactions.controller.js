// controllers/interactions.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');
const { createNotification } = require('../lib/notifications');

let WAVE_COOLDOWN_MS = 60 * 1000;
let lastWave = new Map();

module.exports.bindWaveState = (state) => {
  if (state?.WAVE_COOLDOWN_MS) WAVE_COOLDOWN_MS = state.WAVE_COOLDOWN_MS;
  if (state?.lastWave) lastWave = state.lastWave;
};

module.exports.wave = async function wave(req, res) {
  try {
    const me   = String(req.session.userId || '');
    const them = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(me) || !mongoose.Types.ObjectId.isValid(them) || me === them) {
      return res.status(400).json({ ok:false, error: 'bad_id' });
    }

    const meObj   = new mongoose.Types.ObjectId(me);
    const themObj = new mongoose.Types.ObjectId(them);

    // cooldown
    const key = `${me}:${them}`;
    const now = Date.now();
    if (lastWave.has(key) && (now - lastWave.get(key) < WAVE_COOLDOWN_MS)) {
      return res.status(429).json({ ok:false, error: 'cooldown' });
    }

    // idempotent write
    const [r1, r2] = await Promise.all([
      User.updateOne({ _id: meObj },   { $addToSet: { interests: themObj, waved: themObj } }),
      User.updateOne({ _id: themObj }, { $addToSet: { interestedBy: meObj } }),
    ]);

    const firstTime = (r1.modifiedCount > 0);
    if (firstTime) {
      lastWave.set(key, now);
      if (typeof createNotification === 'function') {
        const io = req.app.get('io');
        await createNotification({
          io,
          recipientId: themObj,
          senderId: meObj,
          type: 'wave',
          message: '👋 Someone waved at you!',
          extra: { link: `/users/${me}` }
        });
      }
    }

    return res.json({ ok:true, state: firstTime ? 'sent' : 'unchanged' });
  } catch (e) {
    console.error('wave err', e);
    return res.status(500).json({ ok:false });
  }
};
