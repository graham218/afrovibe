const { STRIPE_PRICE_ID_ELITE, STRIPE_PRICE_ID_PREMIUM } = require('../config/constants');

function planOf(u = {}) {
  const price = String(u.stripePriceId || u.subscriptionPriceId || '');
  if (price && STRIPE_PRICE_ID_ELITE && price === STRIPE_PRICE_ID_ELITE) return 'elite';
  if (price && STRIPE_PRICE_ID_PREMIUM && price === STRIPE_PRICE_ID_PREMIUM) return 'premium';
  if (u.isPremium) return 'premium';
  return 'free';
}
function isElite(u) { return planOf(u) === 'elite'; }
function isPremiumOrBetter(u) { const p = planOf(u); return p === 'elite' || p === 'premium'; }

module.exports = { planOf, isElite, isPremiumOrBetter };
