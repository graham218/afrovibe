// controllers/messages.controller.js
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// ---- external helpers you already use elsewhere (safe fallbacks here) ----
const createNotification = global.createNotification;
const isActiveUserQuery  = global.isActiveUserQuery || (() => ({}));
const isMutualMatch      = global.isMutualMatch     || (async () => true);
const isElite            = global.isElite           || ((u) => !!u?.stripePriceId || !!u?.subscriptionPriceId);

// ---- rate-limit / validators stubs (wire real ones later if you have them) ----
exports.messagesLimiter = (req, res, next) => next();
exports.vMessageSend    = (req, res, next) => next();

// ---- socket accessor (consistent across app) ----
function getIO(req) {
  return req.io || req.app?.get?.('io') || (typeof io !== 'undefined' ? io : null);
}

// -------------------------------------------------------------------------------------
// Core loader used by both /chat/:id page and “open with ?with=ID” on /messages
// -------------------------------------------------------------------------------------
async function loadThread(meId, otherId, opts = {}) {
  const limit  = Math.min(Math.max(parseInt(opts.limit || '50', 10), 1), 200);
  const before =
    (opts.before && !Number.isNaN(Date.parse(opts.before)))
      ? new Date(opts.before)
      : null;

  if (!ObjectId.isValid(meId) || !ObjectId.isValid(otherId)) {
    return { peer: null, initialHistory: [] };
  }
  const me    = new ObjectId(meId);
  const other = new ObjectId(otherId);

  const peer = await User.findById(other)
    .select('username verifiedAt profile.photos profile.age profile.city profile.country isPremium stripePriceId subscriptionPriceId videoChat')
    .lean();
  if (!peer) return { peer: null, initialHistory: [] };

  const baseThreadQuery = {
    $or: [
      { sender: me,    recipient: other },
      { sender: other, recipient: me   }
    ],
    deletedFor: { $nin: [me] }
  };
  if (before) baseThreadQuery.createdAt = { $lt: before };

  const initialHistory = await Message.find(baseThreadQuery)
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();

  // Mark unread peer->me as read
  await Message.updateMany(
    { sender: other, recipient: me, read: false, deletedFor: { $nin: [me] } },
    { $set: { read: true, readAt: new Date() } }
  );

  // Update my unread badge
  try {
    const unread = await Message.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });
    const io = getIO({ app: { get: () => null } }); // global fallback if available
    io?.to(me.toString()).emit('unread_update', { unread });
  } catch (e) { /* noop */ }

  // Read receipt to the other user
  try {
    const latest = await Message.findOne({
      sender: other, recipient: me, read: true, deletedFor: { $nin: [me] }
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    const io = getIO({ app: { get: () => null } });
    if (latest?.createdAt) {
      io?.to(other.toString()).emit('chat:read', { with: me.toString(), until: latest.createdAt });
    }
  } catch (e) { /* noop */ }

  return { peer, initialHistory };
}

// -------------------------------------------------------------------------------------
// Pages
// -------------------------------------------------------------------------------------
exports.chatPage = async (req, res) => {
  try {
    const meId    = String(req.session.userId);
    const otherId = String(req.params.id);

    const currentUser = await User.findById(meId)
      .select('_id username isPremium stripePriceId subscriptionPriceId profile.videoChat profile.photos')
      .lean();
    if (!currentUser) return res.redirect('/login');

    const { peer, initialHistory } = await loadThread(meId, otherId);
    if (!peer) return res.status(404).render('error', { status: 404, message: 'User not found.' });

    const safePeer = {
      _id:        peer._id,
      username:   peer.username,
      profile:    peer.profile || {},
      isPremium:  !!peer.isPremium,
      stripePriceId:       peer.stripePriceId || null,
      subscriptionPriceId: peer.subscriptionPriceId || null,
      videoChat:  peer.videoChat ?? peer?.profile?.videoChat ?? false,
      photos:     peer?.profile?.photos || [],
    };

    const isMatched = await isMutualMatch(meId, otherId);

    const meObj = new ObjectId(meId);
    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false }),
    ]);

    return res.render('chat', {
      currentUser,
      peer: safePeer,
      otherUser: safePeer,
      isMatched,
      messages: initialHistory,
      initialHistory,
      unreadMessages,
      unreadNotificationCount
    });
  } catch (e) {
    console.error('chat route err', e);
    return res.status(500).render('error', { status: 500, message: 'Failed to load chat.' });
  }
};

exports.messagesPage = async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser) return res.redirect('/login');

    const likedSet   = new Set((currentUser.likes   || []).map(id => id.toString()));
    const likedBySet = new Set((currentUser.likedBy || []).map(id => id.toString()));
    const matchedUserIdsStr = [...likedSet].filter(id => likedBySet.has(id));

    const matches = matchedUserIdsStr.length
      ? await User.find({ _id: { $in: matchedUserIdsStr } }).lean()
      : [];

    const meId = new ObjectId(currentUser._id);
    const matchedIds = matchedUserIdsStr.map(id => new ObjectId(id));

    // unread per matched peer
    let unreadBy = {};
    if (matchedIds.length) {
      const rows = await Message.aggregate([
        { $match: {
            recipient: meId, read: false,
            sender: { $in: matchedIds },
            deletedFor: { $nin: [meId] }
        }},
        { $group: { _id: '$sender', count: { $sum: 1 } } }
      ]);
      unreadBy = Object.fromEntries(rows.map(r => [String(r._id), r.count]));
    }

    // last message preview (visible to me)
    const withLast = await Promise.all(matches.map(async (u) => {
      const lastMessage = await Message.findOne({
        $or: [
          { sender: currentUser._id, recipient: u._id },
          { sender: u._id,           recipient: currentUser._id }
        ],
        deletedFor: { $nin: [meId] }
      }).sort({ createdAt: -1 }).populate('sender', 'username').lean();
      return { ...u, lastMessage };
    }));

    const showAll = String(req.query.all || '') === '1';
    const listForView = showAll ? withLast : withLast.filter(u => !!u.lastMessage);

    // selected thread
    let peer = null;
    let initialHistory = [];
    const peerId = req.query.with || null;
    if (peerId) ({ peer, initialHistory } = await loadThread(currentUser._id, peerId));

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: currentUser._id, read: false, deletedFor: { $nin: [meId] } }),
      Notification.countDocuments({ recipient: currentUser._id, read: false })
    ]);

    return res.render('messages', {
      currentUser,
      matches: listForView,
      peer,
      initialHistory,
      unreadBy,
      unreadMessages,
      unreadNotificationCount,
      showAll
    });
  } catch (err) {
    console.error('Error fetching messages page:', err);
    return res.status(500).render('error', { status: 500, message: 'Failed to load messages.' });
  }
};

// -------------------------------------------------------------------------------------
// API: send / fetch / read
// -------------------------------------------------------------------------------------
exports.sendMessage = async (req, res) => {
  try {
    const sender = String(req.session.userId || '');
    const recipient = String((req.body.to || req.body.recipient || '').trim());
    let content = (req.body.content || '').trim();

    if (!sender) return res.status(401).json({ ok: false, error: 'auth' });
    if (!recipient || !mongoose.Types.ObjectId.isValid(recipient)) {
      return res.status(400).json({ ok: false, error: 'bad_recipient' });
    }
    if (recipient === sender) {
      return res.status(400).json({ ok: false, error: 'self' });
    }

    content = content.slice(0, 4000);
    if (!content) return res.status(400).json({ ok: false, error: 'empty' });

    // recipient must be active
    const recip = await User.findOne({ _id: recipient, ...isActiveUserQuery() }).select('_id').lean();
    if (!recip) {
      return res.status(410).json({ ok: false, code: 'recipient_unavailable', message: 'This account is not available.' });
    }

    // require mutual match (keep per your rules)
    const matched = await isMutualMatch(sender, recipient);
    if (!matched) {
      return res.status(403).json({ ok: false, code: 'not_matched', message: 'Chat requires a mutual match.' });
    }

    const message = await Message.create({ sender, recipient, content, read: false });

    const io = getIO(req);
    io?.to(String(recipient)).emit('chat:incoming', message);
    io?.to(String(sender)).emit('chat:sent', message);

    // recompute unread for recipient (exclude soft-deleted)
    const recipObj = new ObjectId(recipient);
    const unread = await Message.countDocuments({
      recipient: recipObj, read: false, deletedFor: { $nin: [recipObj] }
    });
    io?.to(String(recipient)).emit('unread_update', { unread });

    return res.json({ ok: true, message });
  } catch (err) {
    console.error('send message err', err);
    return res.status(500).json({ ok: false });
  }
};

exports.fetchThreadPage = async (req, res) => {
  try {
    const me     = new ObjectId(req.session.userId);
    const other  = new ObjectId(req.params.otherUserId);
    const before = isNaN(Date.parse(req.query.before)) ? new Date() : new Date(req.query.before);
    const limit  = Math.min(parseInt(req.query.limit || '30', 10), 100);

    const items = await Message.find({
      $or: [
        { sender: me,    recipient: other },
        { sender: other, recipient: me    }
      ],
      deletedFor: { $nin: [me] },
      createdAt: { $lt: before }
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

    return res.json({ items });
  } catch (e) {
    console.error('fetch thread err', e);
    return res.status(500).json({ items: [] });
  }
};

exports.markThreadRead = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);
    const other = new ObjectId(req.params.otherUserId);

    const visibleFromOtherToMe = {
      sender: other, recipient: me, deletedFor: { $nin: [me] }
    };

    await Message.updateMany(
      { ...visibleFromOtherToMe, read: { $ne: true } },
      { $set: { read: true, readAt: new Date() } }
    );

    const latest = await Message.findOne(visibleFromOtherToMe)
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();

    const unread = await Message.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });

    const io = getIO(req);
    io?.to(me.toString()).emit('unread_update', { unread });

    if (latest?.createdAt) {
      io?.to(other.toString()).emit('chat:read', { with: me.toString(), until: latest.createdAt });
    }

    return res.json({ ok: true, unread, until: latest?.createdAt || null });
  } catch (e) {
    console.error('mark read err', e);
    return res.status(500).json({ ok: false });
  }
};

// -------------------------------------------------------------------------------------
// API: clear / bulk
// -------------------------------------------------------------------------------------
exports.clearThreadForMe = async (req, res) => {
  try {
    const me    = new ObjectId(req.session.userId);
    const other = new ObjectId(req.params.otherUserId);

    const visibility = {
      $or: [
        { sender: me,    recipient: other },
        { sender: other, recipient: me   },
      ],
      deletedFor: { $nin: [me] },
    };

    const result = await Message.updateMany(visibility, { $addToSet: { deletedFor: me } });

    const unread = await Message.countDocuments({
      recipient: me, read: false, deletedFor: { $nin: [me] }
    });

    const io = getIO(req);
    io?.to(me.toString()).emit('unread_update', { unread });

    return res.json({ ok: true, cleared: result.modifiedCount || 0 });
  } catch (e) {
    console.error('clear thread err', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

exports.bulkMessages = async (req, res) => {
  try {
    const meId  = String(req.session.userId || '');
    if (!mongoose.Types.ObjectId.isValid(meId)) return res.status(401).json({ ok: false });

    const meObj = new ObjectId(meId);
    const body  = req.body || {};
    const action = String(body.action || 'deleteThreads'); // 'deleteThreads' | 'deleteMessages' | 'report'
    const threadUserIds = Array.isArray(body.threadUserIds) ? body.threadUserIds : [];
    const messageIds    = Array.isArray(body.messageIds)    ? body.messageIds    : [];

    let modified = 0;

    if (action === 'deleteThreads' && threadUserIds.length) {
      const peers = threadUserIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new ObjectId(id));

      if (peers.length) {
        const result = await Message.updateMany(
          {
            deletedFor: { $nin: [meObj] },
            $or: peers.map(pid => ({
              $or: [
                { sender: meObj, recipient: pid },
                { sender: pid,   recipient: meObj },
              ]
            }))
          },
          { $addToSet: { deletedFor: meObj } }
        );
        modified += Number(result.modifiedCount || 0);
      }
    }

    if (action === 'deleteMessages' && messageIds.length) {
      const ids = messageIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new ObjectId(id));

      if (ids.length) {
        const result = await Message.updateMany(
          { _id: { $in: ids }, deletedFor: { $nin: [meObj] } },
          { $addToSet: { deletedFor: meObj } }
        );
        modified += Number(result.modifiedCount || 0);
      }
    }

    if (action === 'report' && (messageIds.length || threadUserIds.length)) {
      // plug your Moderation model here if needed
    }

    return res.json({ ok: true, modified });
  } catch (err) {
    console.error('/api/messages/bulk err', err);
    return res.status(500).json({ ok: false });
  }
};

// -------------------------------------------------------------------------------------
// API: unread counters
// -------------------------------------------------------------------------------------
exports.unreadByThread = async (req, res) => {
  try {
    const me = req.session.userId;
    const meId = new ObjectId(me);

    const meDoc = await User.findById(meId).select('likes likedBy').lean();
    if (!meDoc) return res.status(401).json({ ok: false, by: {}, total: 0 });

    const likedSet   = new Set((meDoc.likes   || []).map(id => id.toString()));
    const likedBySet = new Set((meDoc.likedBy || []).map(id => id.toString()));
    const matchedIdsStr = [...likedSet].filter(id => likedBySet.has(id));
    if (!matchedIdsStr.length) return res.json({ ok: true, by: {}, total: 0 });

    const matchedIds = matchedIdsStr.map(id => new ObjectId(id));

    const rows = await Message.aggregate([
      { $match: {
          recipient: meId,
          read: false,
          sender: { $in: matchedIds },
          deletedFor: { $nin: [meId] }
      }},
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]);

    const by = Object.fromEntries(rows.map(r => [String(r._id), r.count]));
    const total = rows.reduce((acc, r) => acc + r.count, 0);
    return res.json({ ok: true, by, total });
  } catch (e) {
    console.error('unread threads err', e);
    return res.status(500).json({ ok: false, by: {}, total: 0 });
  }
};

exports.unreadTotal = async (req, res) => {
  try {
    const meObj = new ObjectId(req.session.userId);
    const count = await Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } });
    return res.json({ ok: true, count });
  } catch (e) {
    return res.json({ ok: false, count: 0 });
  }
};

// -------------------------------------------------------------------------------------
// API: request video call (ring)
// -------------------------------------------------------------------------------------
const CALL_COOLDOWN_MS = Number(process.env.CALL_COOLDOWN_MS || 20_000);
const __lastCallTry = global.__lastCallTry || (global.__lastCallTry = new Map());

exports.requestCall = async (req, res) => {
  try {
    const me    = await User.findById(req.session.userId)
      .select('_id username createdAt verifiedAt stripePriceId subscriptionPriceId isPremium videoChat')
      .lean();
    const other = await User.findById(req.params.id)
      .select('_id username verifiedAt videoChat')
      .lean();

    if (!me || !other) return res.status(404).json({ ok:false });

    // Only Elite initiates
    if (!isElite(me)) return res.status(402).json({ ok:false, error:'elite_required' });

    // Safety: verified, 48h old account, recipient opted-in
    const ageOk = me.createdAt && (Date.now() - new Date(me.createdAt).getTime() > 48*3600*1000);
    if (!ageOk || !me.verifiedAt || !other.verifiedAt || !other?.videoChat) {
      return res.status(400).json({ ok:false, error:'not_allowed' });
    }

    const key = `${me._id}:${other._id}`;
    const now = Date.now();
    if (__lastCallTry.has(key) && now - __lastCallTry.get(key) < CALL_COOLDOWN_MS) {
      return res.status(429).json({ ok:false, error:'cooldown' });
    }
    __lastCallTry.set(key, now);

    const io = getIO(req);

    if (typeof createNotification === 'function') {
      await createNotification({
        io,
        recipientId: other._id,
        senderId: me._id,
        type: 'system',
        message: 'wants to start a video chat 📹',
        extra: { link: `/messages?with=${me._id}` }
      });
    }

    io?.to(String(other._id)).emit('rtc:ring', {
      from: { _id: String(me._id), username: me.username }
    });

    return res.json({ ok:true });
  } catch (e) {
    console.error('call request err', e);
    return res.status(500).json({ ok:false });
  }
};

// -------------------------------------------------------------------------------------
// Optional export if you need it elsewhere
// -------------------------------------------------------------------------------------
exports._loadThread = loadThread;
