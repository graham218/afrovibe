// routes/boosts.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const { boost } = require('../controllers/boosts.controller');

const router = express.Router();

/**
 * Lightweight per-user cooldown to avoid spam-tapping the button.
 * Default: 1 boost request / 10s (adjust as you wish).
 */
const BOOST_COOLDOWN_MS = Number(process.env.BOOST_COOLDOWN_MS || 10_000);
const lastBoostByUser = new Map(); // userId -> timestamp

function boostLimiter(req, res, next) {
  const uid = String(req.session.userId || '');
  const now = Date.now();
  const last = lastBoostByUser.get(uid) || 0;
  if (now - last < BOOST_COOLDOWN_MS) {
    // 429 so the client can show a small toast/cooldown UI
    const remaining = Math.ceil((BOOST_COOLDOWN_MS - (now - last)) / 1000);
    return res.status(429).json({ ok: false, message: `Please wait ${remaining}s` });
  }
  lastBoostByUser.set(uid, now);
  next();
}

// POST /api/boost – stacks 30 minutes (handled in controller)
router.post('/api/boost', checkAuth, boostLimiter, boost);

module.exports = router;


