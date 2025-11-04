// controllers/likes.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// ====== Env & small helpers (inlined to keep this self-contained) ======
const DAILY_LIKE_LIMIT             = Number(process.env.DAILY_LIKE_LIMIT || 50);
const FREE_SUPERLIKES_PER_DAY      = Number(process.env.FREE_SUPERLIKES_PER_DAY    || 1);
const PREMIUM_SUPERLIKES_PER_DAY   = Number(process.env.PREMIUM_SUPERLIKES_PER_DAY || 5);
const SUPERLIKE_COOLDOWN_SEC       = Number(process.env.SUPERLIKE_COOLDOWN_SEC || 30);

// Optional createNotification (if you have a global helper wired)
const createNotification = global.createNotification;

// If you already have these helpers elsewhere, replace these stubs by importing them.
const isActiveUserQuery = () => ({ /* e.g., deactivatedAt: { $exists:false } */ });
const isPremiumOrBetter = (u) => !!(u?.isPremium || (u?.plan && u.plan !== 'free'));

// Track “reveal likes” once per day for free plans (session-based)
function markRevealedLikesToday(req) {
  req.session._revealedLikesAt = Date.now();
}
function canRevealLikesToday(req, isPremium) {
  if (isPremium) return true;
  const last = req.session._revealedLikesAt || 0;
  const lastDay = new Date(last).toDateString();
  const nowDay  = new Date().toDateString();
  return lastDay !== nowDay; // allow once per day on free
}

// Cooldown memory for superlikes (process memory)
const __lastSuperLike = global.__lastSuperLike || (global.__lastSuperLike = new Map());

// ====== Shared middleware: reset daily counters ======
exports.resetDailyLikes = async (req, res, next) => {
  try {
    if (!req.session.userId) return next();
    const user = await User.findById(req.session.userId);
    if (!user) return next();

    const now = new Date();

    // Likes (free only)
    if (!user.isPremium) {
      const lastLike = user.lastLikeDate;
      const likeNewDay = !lastLike ||
        now.getDate()      !== lastLike.getDate() ||
        now.getMonth()     !== lastLike.getMonth() ||
        now.getFullYear()  !== lastLike.getFullYear();

      if (likeNewDay) {
        user.likesToday   = 0;
        user.lastLikeDate = now;
      } else {
        user.likesToday   = user.likesToday || 0;
        user.lastLikeDate = user.lastLikeDate || now;
      }
    }

    // Superlikes (all users)
    const lastSL = user.lastSuperLikeDate;
    const slNewDay = !lastSL ||
      now.getDate()      !== lastSL.getDate() ||
      now.getMonth()     !== lastSL.getMonth() ||
      now.getFullYear()  !== lastSL.getFullYear();

    if (slNewDay) {
      user.superLikesToday   = 0;
      user.lastSuperLikeDate = now;
    } else {
      user.superLikesToday   = user.superLikesToday || 0;
      user.lastSuperLikeDate = user.lastSuperLikeDate || now;
    }

    await user.save();
    next();
  } catch (err) {
    console.error('Error resetting daily likes:', err);
    next(err);
  }
};

// ====== Likes-you ======
exports.likesYouView = async (req, res) => {
  try {
    const meId = req.session.userId;

    const currentUser = await User.findById(meId)
      .select('isPremium plan likes likedBy blockedUsers')
      .lean();

    if (!currentUser) return res.redirect('/login');

    const isPremium = isPremiumOrBetter(currentUser);

    const myLikesSet = new Set((currentUser.likes || []).map(String));
    const blockedSet = new Set((currentUser.blockedUsers || []).map(String));

    const likerIds = (currentUser.likedBy || [])
      .map(String)
      .filter((uid) => !myLikesSet.has(uid))
      .filter((uid) => !blockedSet.has(uid))
      .reverse();

    // paging
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 48);
    const skip  = (page - 1) * limit;
    const total = likerIds.length;
    const slice = likerIds.slice(skip, skip + limit);

    const projection = {
      username: 1, verifiedAt: 1, lastActive: 1,
      'profile.age': 1, 'profile.city': 1, 'profile.country': 1, 'profile.photos': 1
    };

    const activeCond = isActiveUserQuery();

    const peopleDocs = slice.length
      ? await User.find({ _id: { $in: slice }, ...activeCond })
          .select(projection)
          .lean()
      : [];

    // Preserve original order
    const order = new Map(slice.map((id, i) => [String(id), i]));
    const people = peopleDocs.sort(
      (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
    );

    const revealed = canRevealLikesToday(req, isPremium);

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({
        recipient: meId,
        read: false,
        deletedFor: { $nin: [new mongoose.Types.ObjectId(meId)] }
      }),
      Notification.countDocuments({ recipient: meId, read: false }),
    ]);

    const justRevealed = !!req.session.justRevealedLikes;
    req.session.justRevealedLikes = undefined;

    return res.render('likes-you', {
      pageTitle: 'Who Liked You',
      currentUser: { _id: meId, isPremium },
      people,
      usersWhoLikedMe: people, // legacy alias used in EJS
      blurred: !revealed,
      justRevealed: req.query.revealed === '1' || justRevealed,
      pageMeta: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
      unreadMessages,
      unreadNotificationCount,
    });
  } catch (e) {
    console.error('likes-you err', e);
    return res.status(500).render('error', { status: 500, message: 'Failed to load Liked You.' });
  }
};

exports.likesYouReveal = async (req, res) => {
  const me = await User.findById(req.session.userId).select('isPremium plan').lean();
  if (!me) return res.redirect('/login');

  const premium = isPremiumOrBetter(me);
  if (!premium) markRevealedLikesToday(req); // mark today in session

  req.session.justRevealedLikes = true;       // flash for UI
  req.session.save(() => res.redirect(303, '/likes-you?revealed=1'));
};

// ====== Dislike ======
exports.dislikeUser = async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const dislikedUserId = req.params.id;

    await User.findByIdAndUpdate(
      currentUserId,
      { $addToSet: { dislikes: dislikedUserId }, $pull: { likes: dislikedUserId } }
    );

    return res.json({ status: 'success', message: 'User disliked successfully.' });
  } catch (err) {
    console.error('Error disliking user:', err);
    return res.status(500).json({ status: 'error', message: 'Server Error' });
  }
};

// ====== Like (with freemium daily limit + match/notify) ======
exports.likeUser = async (req, res) => {
  try {
    const userIdToLike = String(req.params.id || '');
    const currentUserId = String(req.session.userId || '');

    if (!userIdToLike) {
      return res.status(400).json({ status: 'error', message: 'Missing user id.' });
    }
    if (userIdToLike === currentUserId) {
      return res.status(400).json({ status: 'error', message: 'You cannot like your own profile.' });
    }

    const [currentUser, likedUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userIdToLike),
    ]);
    if (!currentUser || !likedUser) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    // Reset day & enforce daily like limit (free only)
    if (!currentUser.isPremium) {
      const today = new Date().toDateString();
      const lastLikeDay = currentUser.lastLikeDate ? new Date(currentUser.lastLikeDate).toDateString() : null;
      if (today !== lastLikeDay) currentUser.likesToday = 0;

      if ((currentUser.likesToday || 0) >= DAILY_LIKE_LIMIT) {
        return res.status(429).json({
          status: 'error',
          message: `You have reached your daily limit of ${DAILY_LIKE_LIMIT} likes. Upgrade to premium for unlimited likes!`,
          likesRemaining: 0,
        });
      }
    }

    const hasId = (arr, id) => Array.isArray(arr) && arr.some(x => String(x) === String(id));

    currentUser.likes   = currentUser.likes   || [];
    currentUser.matches = currentUser.matches || [];
    likedUser.likes     = likedUser.likes     || [];
    likedUser.matches   = likedUser.matches   || [];
    likedUser.likedBy   = likedUser.likedBy   || [];

    // Already liked
    if (hasId(currentUser.likes, userIdToLike)) {
      let likesRemaining = -1;
      if (!currentUser.isPremium) {
        likesRemaining = Math.max(DAILY_LIKE_LIMIT - (currentUser.likesToday || 0), 0);
      }
      return res.json({
        status: 'already-liked',
        message: 'You have already liked this user.',
        alreadyLiked: true,
        likesRemaining,
      });
    }

    // Apply like
    currentUser.likes.push(likedUser._id);
    if (!hasId(likedUser.likedBy, currentUserId)) {
      likedUser.likedBy.push(currentUser._id);
    }

    // Mutual match?
    let matchFound = false;
    if (hasId(likedUser.likes, currentUserId)) {
      if (!hasId(currentUser.matches, likedUser._id)) currentUser.matches.push(likedUser._id);
      if (!hasId(likedUser.matches, currentUser._id))  likedUser.matches.push(currentUser._id);
      matchFound = true;
    }

    // Increment daily count for free
    if (!currentUser.isPremium) {
      currentUser.likesToday = (currentUser.likesToday || 0) + 1;
      currentUser.lastLikeDate = new Date();
    }

    await Promise.all([currentUser.save(), likedUser.save()]);

    // remaining likes (freemium only)
    let likesRemaining = -1;
    if (!currentUser.isPremium) {
      likesRemaining = Math.max(DAILY_LIKE_LIMIT - (currentUser.likesToday || 0), 0);
    }

    const io = req.app.get('io');

    if (matchFound) {
      if (typeof createNotification === 'function') {
        await createNotification({
          io,
          recipientId: likedUser._id,
          senderId: currentUser._id,
          type: 'match',
          message: 'It is a match',
          extra: { threadUrl: `/messages?with=${currentUser._id}` },
        });
      }

      return res.json({
        status: 'match',
        message: `${likedUser.username} is also a match!`,
        likesRemaining,
        threadUrl: `/messages?with=${userIdToLike}`,
      });
    } else {
      if (typeof createNotification === 'function') {
        await createNotification({
          io,
          recipientId: likedUser._id,
          senderId: currentUser._id,
          type: 'like',
          message: 'liked you',
        });
      }

      return res.json({ status: 'success', message: 'User liked!', likesRemaining });
    }
  } catch (err) {
    console.error('[LIKE] Error liking user:', err);
    return res.status(500).json({ status: 'error', message: 'Server error. ' + (err?.message || '') });
  }
};

// ====== Superlike (with daily caps + cooldown + notify) ======
async function applyDailySuperlike(userId, consumeNow) {
  const u = await User.findById(userId).select('isPremium lastSuperLikeDate superLikesToday');
  if (!u) return { ok: false };

  const todayKey = new Date().toDateString();
  const lastKey  = u.lastSuperLikeDate ? new Date(u.lastSuperLikeDate).toDateString() : null;

  if (todayKey !== lastKey) {
    u.superLikesToday   = 0;
    u.lastSuperLikeDate = new Date();
  }
  if (consumeNow) u.superLikesToday = (u.superLikesToday || 0) + 1;
  await u.save();

  const cap = u.isPremium ? PREMIUM_SUPERLIKES_PER_DAY : FREE_SUPERLIKES_PER_DAY;
  return { ok: true, used: u.superLikesToday, cap, remaining: Math.max(cap - u.superLikesToday, 0), isPremium: !!u.isPremium };
}

exports.superLike = async (req, res) => {
  try {
    const me   = String(req.session.userId || '');
    const them = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(me) || !mongoose.Types.ObjectId.isValid(them) || me === them) {
      return res.status(400).json({ ok: false, error: 'bad_id' });
    }

    // Cooldown per (me:them)
    const key = `${me}:${them}`;
    const nowMs = Date.now();
    const last  = __lastSuperLike.get(key) || 0;
    if (nowMs - last < SUPERLIKE_COOLDOWN_SEC * 1000) {
      return res.status(429).json({ ok: false, error: 'cooldown' });
    }

    const meObj   = new mongoose.Types.ObjectId(me);
    const themObj = new mongoose.Types.ObjectId(them);

    // Check daily quota BEFORE writing
    const usage = await applyDailySuperlike(meObj, false);
    if (!usage.ok) return res.status(401).json({ ok: false });
    const cap = usage.isPremium ? PREMIUM_SUPERLIKES_PER_DAY : FREE_SUPERLIKES_PER_DAY;
    if (usage.used >= cap) {
      return res.status(402).json({ ok: false, error: 'limit', cap });
    }

    // Idempotent writes; superlike implies a normal like
    const [r1, r2] = await Promise.all([
      User.updateOne({ _id: meObj },   { $addToSet: { superLiked: themObj, likes: themObj } }),
      User.updateOne({ _id: themObj }, { $addToSet: { superLikedBy: meObj, likedBy: meObj } }),
    ]);
    const changed = (r1.modifiedCount + r2.modifiedCount) > 0;

    if (changed) {
      await applyDailySuperlike(meObj, true); // consume one
      __lastSuperLike.set(key, nowMs);

      const io = req.app.get('io');
      if (typeof createNotification === 'function') {
        await createNotification({
          io,
          recipientId: themObj,
          senderId: meObj,
          type: 'superlike',
          message: '⚡ Someone super-liked you!',
          extra: { link: `/users/${me}` }
        });
      }
    }

    return res.json({
      ok: true,
      state: changed ? 'sent' : 'unchanged',
      remaining: Math.max(cap - (usage.used + (changed ? 1 : 0)), 0),
      cap
    });
  } catch (e) {
    console.error('superlike err', e);
    return res.status(500).json({ ok: false });
  }
};
