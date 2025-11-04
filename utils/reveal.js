const { isPremiumOrBetter } = require('./plan');

function dayKeyUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function canRevealLikesToday(req, isPremium) {
  if (isPremium) return true;
  return req.session?.likesYouRevealDay === dayKeyUTC();
}
function markRevealedLikesToday(req) {
  req.session.likesYouRevealDay = dayKeyUTC();
}

function requirePremiumOrDailyReveal(limit = 1, { graceHours = 72, verifiedBonus = 1 } = {}) {
  const User = require('../models/User');
  return async (req, res, next) => {
    const u = await User.findById(req.session.userId);
    if (!u) return res.redirect('/login');

    if (isPremiumOrBetter(u)) return next();

    const createdAt = u.createdAt ? new Date(u.createdAt).getTime() : 0;
    const graceOk = createdAt && (Date.now() - createdAt) <= graceHours * 3600 * 1000;
    if (graceOk) return next();

    const today = dayKeyUTC();
    if (u.likesYouRevealDay !== today) {
      u.likesYouRevealDay = today;
      u.likesYouRevealCount = 0;
    }
    const allowance = limit + (u.verifiedAt ? verifiedBonus : 0);

    if ((u.likesYouRevealCount || 0) < allowance) {
      u.likesYouRevealCount = (u.likesYouRevealCount || 0) + 1;
      await u.save();
      req.session.likesYouRevealDay = today;
      return next();
    }
    return res.status(402).render('paywall', { feature: 'Who liked you', allowance, used: u.likesYouRevealCount });
  };
}

module.exports = { dayKeyUTC, canRevealLikesToday, markRevealedLikesToday, requirePremiumOrDailyReveal };
