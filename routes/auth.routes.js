// routes/auth.routes.js
const express = require('express');
const { body } = require('express-validator');

const requireAnon = require('../middleware/requireAnon');
const checkAuth   = require('../middleware/checkAuth');
const { validate } = require('../middleware/validator');
const { loginLimiter } = require('../middleware/limiters');

const Auth = require('../controllers/auth.controller');
// expected exports in controller:
// indexView, signupView, signupPost, loginView, loginPost, logout,
// verifyEmailView, requestVerify, confirmVerify,
// (optional) forgotGet, forgotPost – or inline handlers below.

const router = express.Router();

// Home
router.get('/', Auth.indexView);

// Signup
router.get('/signup', requireAnon, Auth.signupView);
router.post(
  '/signup',
  requireAnon,
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Min 6 chars'),
  validate,
  Auth.signupPost
);

// Login / Logout
router.get('/login', requireAnon, Auth.loginView);
router.post(
  '/login',
  requireAnon,
  loginLimiter,             // ← now a proper middleware function
  body('email').isEmail(),
  body('password').notEmpty(),
  validate,
  Auth.loginPost
);
router.get('/logout', Auth.logout);

// Verify email
router.get('/verify-email', checkAuth, Auth.verifyEmailView);
router.post('/verify-email/request', checkAuth, Auth.requestVerify);
router.post('/verify-email/confirm', checkAuth, Auth.confirmVerify);

// Forgot password (use your controller if you exposed it; else keep simple stubs)
router.get('/forgot', Auth.forgotGet || (async (req, res) => {
  res.render('forgot', { pageTitle: 'Forgot Password', message: req.query.message || '' });
}));
router.post('/forgot', Auth.forgotPost || (async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).render('forgot', {
        pageTitle: 'Forgot Password',
        message: 'Please enter your email.'
      });
    }
    return res.render('forgot', {
      pageTitle: 'Forgot Password',
      message: 'If an account exists for that email, we just sent a reset link.'
    });
  } catch (e) {
    console.error('forgot post err', e);
    return res.status(500).render('forgot', {
      pageTitle: 'Forgot Password',
      message: 'Something went wrong. Please try again.'
    });
  }
}));

module.exports = router;
