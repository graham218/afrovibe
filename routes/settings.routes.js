// routes/settings.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const checkAuth = require('../middleware/checkAuth');
const fetchUserAndCounts = require('../middleware/fetchUserAndCounts');

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

const router = express.Router();

// --- SETTINGS PAGE ---
router.get('/settings', checkAuth, async (req, res) => {
  const me = await User.findById(req.session.userId).lean();
  if (!me) return res.redirect('/login');

  const [unreadMessages, unreadNotificationCount] = await Promise.all([
    Message.countDocuments({ recipient: me._id, read: false, deletedFor: { $nin: [me._id] } }),
    Notification.countDocuments({ recipient: me._id, read: false, deletedFor: { $nin: [me._id] } }),
  ]);

  res.render('settings', {
    pageTitle: 'Settings',
    currentUser: me,
    unreadMessages,
    unreadNotificationCount,
  });
});

// --- DEACTIVATE (soft pause; reversible) ---
router.post('/settings/deactivate', checkAuth, async (req, res) => {
  try {
    const { reason = '', note = '' } = req.body || {};
    await User.updateOne(
      { _id: req.session.userId },
      {
        $set: {
          isDeactivated: true,
          active: false,
          deactivatedAt: new Date(),
          deactivateReason: reason,
          deactivateNote: note,
        },
      }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('deactivate err', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// --- REACTIVATE ---
router.post('/settings/reactivate', checkAuth, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.session.userId },
      {
        $unset: {
          isDeactivated: '',
          deactivatedAt: '',
          deactivateReason: '',
          deactivateNote: '',
        },
        $set: { active: true },
      }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('reactivate err', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// --- DELETE (soft-anonymize immediately; disappears from product) ---
router.post('/settings/delete', checkAuth, async (req, res) => {
  try {
    const { reason = '', note = '' } = req.body || {};
    const u = await User.findById(req.session.userId).select('_id username email').lean();
    if (!u) return res.status(404).json({ ok: false, message: 'User not found' });

    const anonName = 'deleted_' + String(u._id).slice(-6);

    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          isDeleted: true,
          active: false,
          deletedAt: new Date(),
          username: anonName,
          email: `deleted_${u._id}@example.invalid`,
          'profile.bio': '',
          'profile.photos': [],
          deleteReason: reason,
          deleteNote: note,
        },
      }
    );

    req.session.destroy(() => res.json({ ok: true, redirect: '/goodbye' }));
  } catch (e) {
    console.error('delete account err', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// --- Goodbye page ---
router.get('/goodbye', (req, res) => {
  res.render('error', {
    status: 200,
    message: 'Your account was deleted. We’re sad to see you go 💛'
  });
});

// ---- Email & Password Settings pages (reuse counts middleware) ----
router.get('/settings/email',  checkAuth, fetchUserAndCounts, (req, res) => {
  res.render('email-settings', {
    unreadMessages: req.unreadMessages,
    unreadNotificationCount: req.unreadNotificationCount,
    currentUser: req.currentUser
  });
});

router.get('/settings/password', checkAuth, fetchUserAndCounts, (req, res) => {
  res.render('password-settings', {
    unreadMessages: req.unreadMessages,
    unreadNotificationCount: req.unreadNotificationCount,
    currentUser: req.currentUser
  });
});

// ---- POST: Update password (used by password-settings.ejs) ----
router.post('/update-password', checkAuth, async (req, res) => {
  try {
    const userId          = req.session.userId;
    const currentPassword = String(req.body.currentPassword || '').trim();
    const newPassword     = String(req.body.newPassword || '').trim();
    const confirmPassword = String(req.body.confirmPassword || '').trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ ok: false, message: 'Please fill in all fields.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ ok: false, message: 'Passwords do not match.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, message: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(userId).select('+passwordHash +password').lean();
    if (!user) return res.status(401).json({ ok: false, message: 'Not authenticated.' });

    const storedHash = user.passwordHash || user.password; // adapt to your schema
    if (!storedHash) {
      return res.status(400).json({ ok: false, message: 'Password not set on this account.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, storedHash);
    if (!isMatch) {
      return res.status(400).json({ ok: false, message: 'Current password is incorrect.' });
    }

    const SALT_ROUNDS = 10;
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // save back (use updateOne so we didn’t need a non-lean doc)
    const $set = (user.passwordHash !== undefined)
      ? { passwordHash: newHash }
      : { password: newHash };

    await User.updateOne({ _id: userId }, { $set });

    return res.json({ ok: true, success: true, message: 'Password updated.' });
  } catch (e) {
    console.error('update-password err', e);
    return res.status(500).json({ ok: false, message: 'Server error while updating password.' });
  }
});

module.exports = router;
