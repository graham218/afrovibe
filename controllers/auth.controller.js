// controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

/** =========================================================
 *  Config / helpers (inlined now for fastest migration)
 *  =======================================================*/
const EMAIL_OTP_TTL_MIN = Number(process.env.EMAIL_OTP_TTL_MIN || 10);
const EMAIL_OTP_MAX_ATTEMPTS = Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5);
const EMAIL_OTP_RESEND_COOLDOWN_SEC = Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SEC || 60);

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'change-me';
function makeOtp(len = Number(process.env.EMAIL_OTP_LEN || 6)) {
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 10);
  return s.slice(0, len);
}
function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_HASH_SECRET).update(String(otp)).digest('hex');
}

// minimal mailer (fails soft if not configured)
const transporter = (process.env.SMTP_HOST && process.env.SMTP_FROM)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

async function sendEmail(to, subject, html) {
  if (!transporter) return false;
  await transporter.sendMail({
    to,
    from: process.env.SMTP_FROM,
    subject,
    html,
  });
  return true;
}

/** =========================================================
 *  Controllers
 *  =======================================================*/
exports.indexView = (req, res) => {
  res.render('index');
};

// -------- Signup --------
exports.signupView = (req, res) => {
  res.render('signup', { error: null });
};

exports.signupPost = async (req, res) => {
  const { username, email, password, age, gender, bio, location } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.json({ success: false, message: 'User with that email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user = new User({
      username,
      email,
      password: hashedPassword,
      profile: { age, gender, bio, location, photos: [] }
    });
    await user.save();

    req.session.userId = user._id;
    return res.json({ success: true, message: 'Account created successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// -------- Login / Logout --------
exports.loginView = (req, res) => {
  res.render('login', { error: null });
};

exports.loginPost = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }
    req.session.userId = user._id;
    return res.redirect(303, '/dashboard');
  } catch (err) {
    console.error(err);
    return res.status(500).render('login', { error: 'Server error. Try again.' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Could not log out.');
    return res.redirect('/');
  });
};

// -------- Verify Email flow --------
exports.verifyEmailView = async (req, res) => {
  const me = await User.findById(req.session.userId).lean();
  if (!me) return res.redirect('/login');

  const [unreadMessages, unreadNotificationCount] = await Promise.all([
    Message.countDocuments({ recipient: me._id, read: false, deletedFor: { $nin: [me._id] } }),
    Notification.countDocuments({ recipient: me._id, read: false }),
  ]);

  // if already have an email, jump to "code" step by default
  const state = req.query.state || (me.email ? 'code' : 'enter');
  return res.render('verify-email', {
    currentUser: me,
    unreadMessages,
    unreadNotificationCount,
    state,
    flash: req.query.msg || null,
  });
};

exports.requestVerify = async (req, res) => {
  try {
    const me = await User.findById(req.session.userId);
    if (!me) return res.redirect('/login');

    const rawEmail = String(req.body.email || me.email || '').trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
    if (!valid) return res.redirect('/verify-email?state=enter&msg=Invalid+email');

    // cooldown
    const now = Date.now();
    const last = me.emailOtpRequestedAt ? me.emailOtpRequestedAt.getTime() : 0;
    if (now - last < EMAIL_OTP_RESEND_COOLDOWN_SEC * 1000) {
      return res.redirect('/verify-email?state=code&msg=Please+wait+before+resending');
    }

    const otp = makeOtp();
    const ok = await sendEmail(
      rawEmail,
      'Your verification code',
      `<p>Your verification code is:</p>
       <p style="font-size:20px"><b>${otp}</b></p>
       <p>This code expires in ${EMAIL_OTP_TTL_MIN} minutes.</p>`
    );
    if (!ok) return res.redirect('/verify-email?state=enter&msg=Failed+to+send+email');

    me.email = rawEmail; // save email if not set
    me.emailOtpHash = hashOtp(otp);
    me.emailOtpExpiresAt = new Date(now + EMAIL_OTP_TTL_MIN * 60 * 1000);
    me.emailOtpAttempts = 0;
    me.emailOtpRequestedAt = new Date(now);
    me.emailOtpLastIP = req.ip;
    await me.save();

    return res.redirect('/verify-email?state=code&msg=Code+sent');
  } catch (e) {
    console.error('email otp request err', e);
    return res.redirect('/verify-email?state=enter&msg=Server+error');
  }
};

exports.confirmVerify = async (req, res) => {
  try {
    const me = await User.findById(req.session.userId);
    if (!me) return res.redirect('/login');

    if (!me.email || !me.emailOtpHash) {
      return res.redirect('/verify-email?state=enter&msg=Please+request+a+code+first');
    }

    if ((me.emailOtpAttempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS) {
      return res.redirect('/verify-email?state=code&msg=Too+many+attempts.+Request+a+new+code');
    }

    const now = Date.now();
    if (!me.emailOtpExpiresAt || now > me.emailOtpExpiresAt.getTime()) {
      return res.redirect('/verify-email?state=code&msg=Code+expired.+Request+new+code');
    }

    const code = String(req.body.code || '').replace(/[^\d]/g, '');
    if (!code || code.length < 4) {
      me.emailOtpAttempts = (me.emailOtpAttempts || 0) + 1;
      await me.save();
      return res.redirect('/verify-email?state=code&msg=Invalid+code');
    }

    if (me.emailOtpHash !== hashOtp(code)) {
      me.emailOtpAttempts = (me.emailOtpAttempts || 0) + 1;
      await me.save();
      return res.redirect('/verify-email?state=code&msg=Incorrect+code');
    }

    // success
    me.emailVerifiedAt = new Date();
    me.emailOtpHash = null;
    me.emailOtpExpiresAt = null;
    me.emailOtpAttempts = 0;
    await me.save();

    return res.redirect('/verify-email?state=done&msg=Email+verified');
  } catch (e) {
    console.error('email otp confirm err', e);
    return res.redirect('/verify-email?state=code&msg=Server+error');
  }
};
