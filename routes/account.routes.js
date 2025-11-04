// routes/account.routes.js
const express = require('express');
const checkAuth = require('../middleware/checkAuth');
const User = require('../models/User');

const router = express.Router();

// Deactivate (reversible) – account namespace
router.post('/account/deactivate', checkAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { reason = '', details = '' } = req.body || {};

    const update = {
      active: false,
      deactivatedAt: new Date(),
      'account.deactivation': { reason, details }
    };
    await User.updateOne({ _id: userId }, { $set: update });

    req.session.destroy(() => {
      res.json({ ok: true, redirect: '/login?deactivated=1' });
    });
  } catch (e) {
    console.error('deactivate err', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Delete (soft/anonymize) – account namespace
router.post('/account/delete', checkAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { reason = '', details = '' } = req.body || {};
    const UserModel = require('../models/User');

    const u = await UserModel.findById(userId).select('_id username email').lean();
    if (!u) return res.status(404).json({ ok: false, message: 'User not found' });

    const anonName = 'deleted_' + String(u._id).slice(-6);

    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          deletedAt: new Date(),
          isDeleted: true,
          active: false,
          username: anonName,
          email: `deleted_${u._id}@example.invalid`,
          'profile.bio': '',
          'profile.photos': [],
          'account.deletion': { reason, details }
        }
      }
    );

    // Remove this user from others’ lists
    await Promise.all([
      UserModel.updateMany({ likes: userId },        { $pull: { likes: userId } }),
      UserModel.updateMany({ likedBy: userId },      { $pull: { likedBy: userId } }),
      UserModel.updateMany({ favorites: userId },    { $pull: { favorites: userId } }),
      UserModel.updateMany({ blockedUsers: userId }, { $pull: { blockedUsers: userId } }),
    ]);

    req.session.destroy(() => {
      res.json({ ok: true, redirect: '/goodbye' });
    });
  } catch (e) {
    console.error('delete account err', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
