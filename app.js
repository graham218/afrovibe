// app.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const bodyParser = require('body-parser'); // for Stripe webhook (raw)
const cookieParser = require('cookie-parser');

const { sessionMiddleware } = require('./session'); // keep as its own file

// DB connection bootstraps + index sync
require('./config/db');

const { planOf, isElite, isPremiumOrBetter } = require('./utils/plan');
const navbar = require('./middleware/navbar');

// Core route modules (already created/split)
const healthRoutes       = require('./routes/health.routes');
const staticRoutes       = require('./routes/static.routes');
const contactRoutes      = require('./routes/contact.routes');
const discoverRoutes     = require('./routes/discover.routes');
const interactionsRoutes = require('./routes/interactions.routes');
const analyticsRoutes    = require('./routes/analytics.routes');
const profileRoutes      = require('./routes/profile.routes');
const authRoutes         = require('./routes/auth.routes');         // (loginLimiter) if applicable
const usersRoutes        = require('./routes/users.routes');
const photosRoutes       = require('./routes/photos.routes');
const likesRoutes        = require('./routes/likes.routes');
const favoritesRoutes    = require('./routes/favorites.routes');
const matchesRoutes      = require('./routes/matches.routes');
const messagesRoutes     = require('./routes/messages.routes');     // (apiMsgLimiter) if applicable
const notificationsRoutes= require('./routes/notifications.routes');
const searchRoutes       = require('./routes/search.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const reportRoutes       = require('./routes/report.routes');
const boostsRoutes       = require('./routes/boosts.routes');
const settingsRoutes     = require('./routes/settings.routes');
const accountRoutes      = require('./routes/account.routes');
const ticketsRoutes      = require('./routes/tickets.routes');

const app = express();

app.set('trust proxy', 1);

// --- Slow request logger (handy in dev/prod) ---
app.use((req, res, next) => {
  const start = Date.now();
  const url = req.originalUrl;
  let flagged = false;
  const timer = setTimeout(() => { flagged = true; console.warn('[slow] >5s', req.method, url); }, 5000);
  res.on('finish', () => {
    clearTimeout(timer);
    const ms = Date.now() - start;
    console.log(`${req.method} ${url} -> ${res.statusCode} in ${ms}ms${flagged ? ' [SLOW]' : ''}`);
  });
  next();
});

// --- Security headers (CSP kept compatible with your nonce pattern) ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce || ''}'`],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
      "img-src": ["'self'", "data:", "https:"],
      "connect-src": ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "ws:", "wss:"],
      "media-src": ["'self'", "https:"]
    }
  }
}));

// --- Stripe webhook MUST be parsed as raw BEFORE express.json() ---
app.use('/webhook', bodyParser.raw({ type: '*/*' })); // your /webhook route will read req.body as Buffer

// --- Parsers ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Sessions (shared with Socket.IO via server.js) ---
app.use(sessionMiddleware);

// --- Views ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Static ---
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'))); // absolute uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/js',     express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/css',    express.static(path.join(__dirname, 'public/css')));

// --- Template helpers ---
app.use((req, res, next) => {
  res.locals.planOf = planOf;
  res.locals.isElite = isElite;
  res.locals.isPremiumOrBetter = isPremiumOrBetter;
  next();
});
app.use((req, res, next) => {
  res.locals.cspNonce = res.locals.cspNonce || req.cspNonce;
  next();
});

// --- Touch lastActive lightly (once/min) ---
const User = require('./models/User');
app.use((req, res, next) => {
  try {
    if (req.session?.userId) {
      const now = Date.now();
      const last = req.session._lastActiveTouch || 0;
      if (now - last > 60_000) {
        req.session._lastActiveTouch = now;
        User.updateOne({ _id: req.session.userId }, { $set: { lastActive: new Date() } }).catch(() => {});
      }
    }
  } catch {}
  next();
});

// --- Global navbar locals (currentUser + badges + likesRemaining) ---
app.use(navbar);

// --- Verbose hit log for like/fave/boost/etc. ---
app.use((req, res, next) => {
  if (req.method === 'POST' && (/^\/(like|dislike|interest|favorite|superlike|api\/(boost|favorites|interest|superlike))\b/.test(req.path))) {
    console.log(`[HIT] ${req.method} ${req.path} CT=${req.headers['content-type'] || '-'} UA=${req.headers['user-agent'] || '-'}`);
  }
  next();
});

// --- Routes (order matters: health/static open; feature routes below) ---
app.use(healthRoutes);
app.use(staticRoutes);
app.use(contactRoutes);
app.use(discoverRoutes);
app.use(interactionsRoutes);
app.use(analyticsRoutes);
app.use(profileRoutes);
app.use(authRoutes);
app.use(usersRoutes);
app.use(photosRoutes);
app.use(likesRoutes);
app.use(favoritesRoutes);
app.use(matchesRoutes);
app.use(messagesRoutes);
app.use(notificationsRoutes);
app.use(searchRoutes);
app.use(subscriptionRoutes);
app.use(reportRoutes);
app.use(boostsRoutes);
app.use(settingsRoutes);
app.use(accountRoutes);
app.use(ticketsRoutes);

// --- Favicon fast path ---
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Error handler (last) ---
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Unexpected server error';
  try { res.status(status).render('error', { status, message }); }
  catch { res.status(status).send(`${status} ${message}`); }
});

module.exports = app;
