// middleware/limiters.js
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const DISABLE_LIMITERS = process.env.NO_LIMITS === '1';
const passthru = (_req, _res, next) => next();

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    // IMPORTANT: always wrap IP with ipKeyGenerator for IPv6 safety
    req.session?.userId
      ? `${ipKeyGenerator(req)}:${req.session.userId}`
      : ipKeyGenerator(req),
};

const siteLimiter     = DISABLE_LIMITERS ? passthru : rateLimit({ ...base, windowMs: 60_000, max: 300 });
const loginLimiter    = DISABLE_LIMITERS ? passthru : rateLimit({ ...base, windowMs: 60_000, max: 15 });
const apiMsgLimiter   = DISABLE_LIMITERS ? passthru : rateLimit({ ...base, windowMs: 60_000, max: 120 });
const likeLimiter     = DISABLE_LIMITERS ? passthru : rateLimit({ ...base, windowMs: 60_000, max: 40 });
const analyticsLimiter= DISABLE_LIMITERS ? passthru : rateLimit({ ...base, windowMs: 60_000, max: 120 });

module.exports = {
  siteLimiter,
  loginLimiter,
  apiMsgLimiter,
  likeLimiter,
  analyticsLimiter, // ← ensure this is exported
};
