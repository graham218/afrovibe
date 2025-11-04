// Central app constants & feature toggles
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',

  // Uploads / media
  MAX_PHOTOS: Number(process.env.MAX_PHOTOS || 5),

  // Freemium
  DAILY_LIKE_LIMIT: Number(process.env.DAILY_LIKE_LIMIT || 10),

  // Background jobs
  HARD_DELETE_DAYS: Number(process.env.HARD_DELETE_DAYS || 30),
  HARD_DELETE_INTERVAL_MS: Number(process.env.HARD_DELETE_INTERVAL_MS || 6 * 60 * 60 * 1000),

  // Rate-limits
  DISABLE_LIMITERS: process.env.NO_LIMITS === '1',

  // Stripe plans
  STRIPE_PRICE_ID_ELITE:   process.env.STRIPE_PRICE_ID_ELITE   || process.env.STRIPE_PRICE_ID_EMERALD || '',
  STRIPE_PRICE_ID_PREMIUM: process.env.STRIPE_PRICE_ID_PREMIUM || process.env.STRIPE_PRICE_ID_SILVER  || '',

  // Email OTP / security
  EMAIL_OTP_TTL_MIN: Number(process.env.EMAIL_OTP_TTL_MIN || 10),
  EMAIL_OTP_LEN: Number(process.env.EMAIL_OTP_LEN || 6),
  EMAIL_OTP_MAX_ATTEMPTS: Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5),
  EMAIL_OTP_RESEND_COOLDOWN_SEC: Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SEC || 60),
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'change-me',
};
