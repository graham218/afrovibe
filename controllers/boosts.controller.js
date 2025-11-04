// controllers/boosts.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');

function ensureComputeBoostActive() {
  if (typeof global.computeBoostActive !== 'function') {
    global.computeBoostActive = function computeBoostActive(u, nowMs = Date.now()) {
      if (!u || !u.boostExpiresAt) return false;
      const t = new Date(u.boostExpiresAt).getTime();
      return Number.isFinite(t) && t > nowMs;
    };
  }
}
ensureComputeBoostActive();

/**
 * POST /api/boost
 * - Adds 30 minutes to the user's boost (stacks if already active)
 * - Returns { ok, boostActive, boostExpiresAt }
 */
exports.boost = async function boost(req, res) {
  try {
    const meId = req.session.userId;
    const user = await User.findById(meId);
    if (!user) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const nowMs = Date.now();
    const durationMs = 30 * 60 * 1000; // 30 minutes
    const currentExpiryMs = user.boostExpiresAt ? new Date(user.boostExpiresAt).getTime() : 0;
    const baseMs = (currentExpiryMs > nowMs) ? currentExpiryMs : nowMs;

    user.boostExpiresAt = new Date(baseMs + durationMs);
    await user.save();

    return res.json({
      ok: true,
      boostActive: global.computeBoostActive(user),
      boostExpiresAt: user.boostExpiresAt
    });
  } catch (e) {
    console.error('Boost error:', e);
    return res.status(500).json({ ok: false, message: 'Could not activate boost' });
  }
};
