// controllers/favorites.controller.js
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// If you already import this from a helper, swap this line to that import.
const createNotification = global.createNotification;

/** POST /favorite/:id  (add) */
exports.addFavorite = async (req, res) => {
  try {
    const me   = String(req.session.userId || '');
    const them = String(req.params.id || '');

    if (!ObjectId.isValid(me) || !ObjectId.isValid(them) || me === them) {
      return res.status(400).json({ ok: false, error: 'bad_id' });
    }

    const meObj   = new ObjectId(me);
    const themObj = new ObjectId(them);

    const result = await User.updateOne(
      { _id: meObj },
      { $addToSet: { favorites: themObj } }
    );

    // Notify only on first-time add
    if (result.modifiedCount > 0 && typeof createNotification === 'function') {
      const io = req.app.get('io');
      await createNotification({
        io,
        recipientId: themObj,
        senderId: meObj,
        type: 'favorite',
        message: 'Someone favorited you ⭐',
        extra: { link: `/users/${me}` },
      });
    }

    return res.json({ ok: true, state: result.modifiedCount > 0 ? 'added' : 'unchanged' });
  } catch (e) {
    console.error('favorite add err', e);
    return res.status(500).json({ ok: false });
  }
};

/** DELETE /favorite/:id  (remove) */
exports.removeFavorite = async (req, res) => {
  try {
    const me   = String(req.session.userId || '');
    const them = String(req.params.id || '');

    if (!ObjectId.isValid(me) || !ObjectId.isValid(them)) {
      return res.status(400).json({ ok: false, error: 'bad_id' });
    }

    const meObj   = new ObjectId(me);
    const themObj = new ObjectId(them);

    const result = await User.updateOne(
      { _id: meObj },
      { $pull: { favorites: themObj } }
    );

    return res.json({ ok: true, state: result.modifiedCount > 0 ? 'removed' : 'unchanged' });
  } catch (e) {
    console.error('favorite del err', e);
    return res.status(500).json({ ok: false });
  }
};

/** GET /favorites  (hub page) */
exports.favoritesPage = async (req, res) => {
  try {
    const meId  = String(req.session.userId);
    const meObj = new mongoose.Types.ObjectId(meId);

    const currentUser = await User.findById(meId)
      .select('favorites waved isPremium plan profile username')
      .lean();

    if (!currentUser) return res.redirect('/login');

    // Helper used by favorites.ejs (kept identical to your snippet)
    const planOf = (u) => {
      if (u?.plan && u.plan !== 'free') return String(u.plan).toLowerCase();
      return u?.isPremium ? 'emerald' : 'free';
    };

    const favoriteSet = new Set((currentUser.favorites || []).map(String));
    const wavedSet    = new Set((currentUser.waved || []).map(String));

    const projection = {
      username: 1,
      verifiedAt: 1,
      lastActive: 1,
      'profile.age': 1,
      'profile.city': 1,
      'profile.country': 1,
      'profile.photos': 1,
    };

    // --- My favorites (I starred them)
    let myFavorites = [];
    if ((currentUser.favorites || []).length) {
      const ids = currentUser.favorites
        .filter(Boolean)
        .map(id => new mongoose.Types.ObjectId(id));

      const list = await User.find({ _id: { $in: ids } })
        .select(projection)
        .lean();

      // Keep original order by ids
      const pos = new Map(ids.map((id, i) => [String(id), i]));
      list.sort((a, b) => (pos.get(String(a._id)) ?? 0) - (pos.get(String(b._id)) ?? 0));

      myFavorites = list.map(u => ({
        ...u,
        isFavorite: true,
        iWaved: wavedSet.has(String(u._id)),
      }));
    }

    // --- Favorited me (people who starred me)
    const whoFavoritedMe = await User.find({ favorites: meObj })
      .select(projection)
      .lean();

    const favoritedMe = (whoFavoritedMe || []).map(u => ({
      ...u,
      isFavorite: favoriteSet.has(String(u._id)),
      iWaved:     wavedSet.has(String(u._id)),
    }));

    // Navbar badges
    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false }),
    ]);

    // ✅ Note: the stray block that referenced favIds + isActiveUserQuery() (which caused a 500) is intentionally omitted.

    return res.render('favorites', {
      currentUser,
      myFavorites,
      favoritedMe,
      unreadMessages,
      unreadNotificationCount,
      query: req.query || {},
      planOf, // exposed for favorites.ejs to call
    });
  } catch (err) {
    console.error('favorites page err', err);
    return res.status(500).render('error', { status: 500, message: 'Failed to load favorites.' });
  }
};
