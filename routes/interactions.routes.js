// routes/interactions.routes.js
const express = require('express');
const mongoose = require('mongoose');
const checkAuth = require('../middleware/checkAuth');
const { likeLimiter } = require('../middleware/limiters');
const { validateObjectId, validate } = require('../middleware/validator');
const { createNotification } = require('../utils/notifications');
const User = require('../models/User');

const router = express.Router();
const WAVE_COOLDOWN_MS = 60 * 1000;
const lastWave = new Map();

async function waveHandler(req, res) {
  try {
    const me = String(req.session.userId || '');
    const them = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(me) || !mongoose.Types.ObjectId.isValid(them) || me === them) {
      return res.status(400).json({ ok: false, error: 'bad_id' });
    }

    const meObj = new mongoose.Types.ObjectId(me);
    const themObj = new mongoose.Types.ObjectId(them);

    const key = `${me}:${them}`;
    const now = Date.now();
    if (lastWave.has(key) && now - lastWave.get(key) < WAVE_COOLDOWN_MS) {
      return res.status(429).json({ ok: false, error: 'cooldown' });
    }

    const [r1] = await Promise.all([
      User.updateOne({ _id: meObj }, { $addToSet: { interests: themObj, waved: themObj } }),
      User.updateOne({ _id: themObj }, { $addToSet: { interestedBy: meObj } }),
    ]);

    const firstTime = r1.modifiedCount > 0;
    if (firstTime) {
      lastWave.set(key, now);
      const io = req.app.get('io');
      await createNotification({
        io,
        recipientId: themObj,
        senderId: meObj,
        type: 'wave',
        message: '👋 Someone waved at you!',
        extra: { link: `/users/${me}` },
      });
    }

    return res.json({ ok: true, state: firstTime ? 'sent' : 'unchanged' });
  } catch (e) {
    console.error('wave err', e);
    return res.status(500).json({ ok: false });
  }
}

router.post(
  '/interest/:id',
  checkAuth,
  likeLimiter,
  validateObjectId('id'),
  validate,
  waveHandler
);

module.exports = router;
