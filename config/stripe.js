const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET || '', { apiVersion: '2024-06-20' });

const PRICE_PREMIUM = String(process.env.STRIPE_PRICE_ID_PREMIUM || '');
const PRICE_ELITE   = String(process.env.STRIPE_PRICE_ID_ELITE || '');

function planOf(user){
  const price = String(user?.stripePriceId || user?.subscriptionPriceId || '');
  if (price && PRICE_ELITE && price === PRICE_ELITE) return 'elite';
  if (price && PRICE_PREMIUM && price === PRICE_PREMIUM) return 'premium';
  return user?.isPremium ? 'premium' : 'free';
}
const isElite = (u)=> planOf(u) === 'elite';
const isPremiumOrBetter = (u)=> ['premium','elite'].includes(planOf(u));

module.exports = { stripe, PRICE_PREMIUM, PRICE_ELITE, planOf, isElite, isPremiumOrBetter };
