// controllers/matches.controller.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// ---------- small helpers (inlined so this file is self-contained) ----------
const isActiveUserQuery = () => ({ /* e.g., deactivatedAt: { $exists:false } */ });

function buildLikeSets(currentUser) {
  const likedSet   = new Set((currentUser.likes   || []).map(String));
  const likedBySet = new Set((currentUser.likedBy || []).map(String));
  return { likedSet, likedBySet };
}
function isMutualBySets(idStr, likedSet, likedBySet) {
  return likedSet.has(idStr) && likedBySet.has(idStr);
}

/** Returns the last message per peer (sender or recipient == me) for a set of peer ids */
async function getLastMessagesByPeer({ meObj, allIds }) {
  if (!allIds || !allIds.length) return {};
  const rows = await Message.aggregate([
    { $match: {
        $or: [
          { sender: meObj,     recipient: { $in: allIds } },
          { recipient: meObj,  sender:    { $in: allIds } },
        ]
    }},
    { $sort: { createdAt: -1, _id: -1 } },
    // project “peer” as the other party
    { $addFields: {
        peer: {
          $cond: [{ $eq: ["$sender", meObj] }, "$recipient", "$sender"]
        }
    }},
    // group by peer -> first doc is last message
    { $group: {
        _id: "$peer",
        content:   { $first: "$content" },
        createdAt: { $first: "$createdAt" },
        sender:    { $first: "$sender" },
        recipient: { $first: "$recipient" }
    }}
  ]);
  const out = {};
  for (const r of rows) out[String(r._id)] = r;
  return out;
}

/** Lightweight “new” badge: no last message yet AND user created within recent days */
function isNewBadge({ lastMessage, userCreatedAt }) {
  if (lastMessage) return false;
  try {
    const created = new Date(userCreatedAt).getTime();
    return (Date.now() - created) <= (7 * 24 * 60 * 60 * 1000); // 7 days
  } catch { return false; }
}

// controllers/matches.controller.js  (append below existing code)
const { Types: { ObjectId } } = mongoose;

// --- helper: detect if client prefers JSON (XHR/fetch) or HTML redirect
function wantJson(req) {
  const h = (req.headers['x-requested-with'] || '').toLowerCase();
  const a = (req.headers['accept'] || '').toLowerCase();
  return h === 'xmlhttprequest' || a.includes('application/json');
}

// --- helper: compute "is online" from lastActive (5m window) (kept for future use)
function isOnlineFrom(lastActive) {
  if (!lastActive) return false;
  return (Date.now() - new Date(lastActive).getTime()) < 5 * 60 * 1000;
}

/** POST /unblock/:id  — JSON or redirect per wantJson() */
exports.unblockUser = async (req, res) => {
  try {
    const meId = String(req.session.userId || '');
    const unblockedId = String(req.params.id || '');

    if (!ObjectId.isValid(unblockedId)) {
      return wantJson(req)
        ? res.status(400).json({ status: 'error', message: 'Invalid user id' })
        : res.redirect('/blocked?msg=invalid');
    }
    if (meId === unblockedId) {
      return wantJson(req)
        ? res.status(400).json({ status: 'error', message: 'Cannot unblock yourself' })
        : res.redirect('/blocked?msg=self');
    }

    const result = await User.updateOne(
      { _id: meId },
      { $pull: { blockedUsers: unblockedId } }
    );

    const ok = result.modifiedCount > 0;

    if (wantJson(req)) {
      return res.json({ status: ok ? 'success' : 'unchanged' });
    }
    return res.redirect('/blocked?msg=' + (ok ? 'unblocked' : 'unchanged'));
  } catch (err) {
    console.error('unblock error', err);
    return wantJson(req)
      ? res.status(500).json({ status: 'error', message: 'Server error' })
      : res.redirect('/blocked?msg=error');
  }
};

/** POST /block/:id  — your JSON flow (we already had a block; this version matches your pasted behavior) */
exports.blockUser = async (req, res) => {
  try {
    const currentUserId = String(req.session.userId || '');
    const blockUserId   = String(req.params.id || '');

    if (!ObjectId.isValid(blockUserId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid user id' });
    }
    if (currentUserId === blockUserId) {
      return res.status(400).json({ status: 'error', message: 'Cannot block yourself' });
    }

    // 1) Add to blockedUsers once
    await User.updateOne(
      { _id: currentUserId },
      { $addToSet: { blockedUsers: blockUserId } }
    );

    // 2) Remove likes/favorites both directions to avoid stale match/favorite
    await Promise.all([
      User.updateOne({ _id: currentUserId }, { $pull: { likes: blockUserId, favorites: blockUserId, likedBy: blockUserId } }),
      User.updateOne({ _id: blockUserId },   { $pull: { likes: currentUserId, favorites: currentUserId, likedBy: currentUserId } }),
    ]);

    // 3) (Optional) close threads — if you want to fully wipe, uncomment:
    // await Message.deleteMany({ $or: [
    //   { sender: currentUserId, recipient: blockUserId },
    //   { sender: blockUserId,  recipient: currentUserId }
    // ]});

    return res.json({ status: 'success', message: 'User blocked successfully.' });
  } catch (err) {
    console.error('block error', err);
    return res.status(500).json({ status: 'error', message: 'Server Error' });
  }
};

/** GET /block/:id — confirm screen (renders blocked.ejs with target + current list) */
exports.blockConfirm = async (req, res) => {
  const meId = req.session.userId;
  const id   = req.params.id;

  const [currentUser, targetUser, me] = await Promise.all([
    User.findById(meId).select('username profile.photos').lean(),
    User.findById(id).lean(),
    User.findById(meId).select('blockedUsers').lean(),
  ]);

  const blockedUsers = me?.blockedUsers?.length
    ? await User.find({ _id: { $in: me.blockedUsers } })
        .select('username profile.photos profile.city profile.country').lean()
    : [];

  return res.render('blocked', {
    pageTitle: 'Blocked users',
    currentUser,
    targetUser,
    blockedUsers
  });
};

/** GET /blocked — list of blocked accounts */
exports.blockedList = async (req, res) => {
  const me = await User.findById(req.session.userId).select('blockedUsers').lean();
  const blockedUsers = me?.blockedUsers?.length
    ? await User.find({ _id: { $in: me.blockedUsers } })
        .select('username profile.photos profile.city profile.country').lean()
    : [];
  const currentUser = await User.findById(req.session.userId).select('username profile.photos').lean();

  return res.render('blocked', {
    pageTitle: 'Blocked users',
    currentUser,
    targetUser: null,
    blockedUsers
  });
};

// --------------------------------- Controllers ---------------------------------
exports.matchesPage = async (req, res) => {
  try {
    const meId  = String(req.session.userId);
    const meObj = new mongoose.Types.ObjectId(meId);

    const currentUser = await User.findById(meId)
      .select('likes likedBy')
      .lean();
    if (!currentUser) return res.redirect('/login');

    const { likedSet, likedBySet } = buildLikeSets(currentUser);

    // union so the page can also show "likedMeOnly / iLikedOnly" tiles
    const unionIdsStr = [...new Set([...likedSet, ...likedBySet])];

    let cards = [];
    if (unionIdsStr.length) {
      const unionIds = unionIdsStr.map(id => new mongoose.Types.ObjectId(id));
      const activeUsers = await User.find({ _id: { $in: unionIds }, ...isActiveUserQuery() })
        .select('username createdAt verifiedAt lastActive profile.photos profile.age profile.city profile.country')
        .lean();

      const activeIds = activeUsers.map(u => new mongoose.Types.ObjectId(u._id));

      // unread counts per active peer (exclude my soft-deletes)
      const unreadRows = await Message.aggregate([
        { $match: {
            recipient: meObj,
            read: false,
            sender: { $in: activeIds },
            deletedFor: { $nin: [meObj] }
        }},
        { $group: { _id: '$sender', count: { $sum: 1 } } }
      ]);
      const unreadBy = Object.fromEntries(unreadRows.map(r => [String(r._id), r.count]));

      // last message per peer
      const lastBy = await getLastMessagesByPeer({ meObj, allIds: activeIds });

      // cards + flags
      cards = activeUsers.map(u => {
        const idStr = String(u._id);
        const last  = lastBy[idStr] || null;

        const isMutual    = isMutualBySets(idStr, likedSet, likedBySet);
        const likedMeOnly = !likedSet.has(idStr) && likedBySet.has(idStr);
        const iLikedOnly  = likedSet.has(idStr) && !likedBySet.has(idStr);

        const lastMessage = last ? {
          content:   last.content,
          createdAt: last.createdAt,
          mine:      String(last.sender) === meId,
        } : null;

        const isNew = isNewBadge({ lastMessage, userCreatedAt: u.createdAt });

        return {
          ...u,
          isMutual,
          likedMeOnly,
          iLikedOnly,
          isNew,
          unreadCount: unreadBy[idStr] || 0,
          lastMessage
        };
      }).sort((a, b) => {
        const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
        const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
        return (tb - ta) || ((b.isMutual ? 1 : 0) - (a.isMutual ? 1 : 0)) || a.username.localeCompare(b.username);
      });
    }

    const [unreadMessages, unreadNotificationCount] = await Promise.all([
      Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
      Notification.countDocuments({ recipient: meObj, read: false }),
    ]);

    return res.render('matches', {
      currentUser,
      matches: cards,
      unreadMessages,
      unreadNotificationCount
    });
  } catch (err) {
    console.error('matches page err', err);
    return res.status(500).render('error', { status: 500, message: 'Failed to load matches.' });
  }
};

exports.unmatchUser = async (req, res) => {
  try {
    const currentUserId = String(req.session.userId);
    const chatUserId    = String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(chatUserId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
    }

    const [currentUser, chatUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(chatUserId),
    ]);

    if (!currentUser || !chatUser) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // remove the “like” / “likedBy” relationship (match will dissolve naturally)
    currentUser.likes = (currentUser.likes || []).filter(id => String(id) !== chatUserId);
    chatUser.likedBy  = (chatUser.likedBy  || []).filter(id => String(id) !== currentUserId);

    await Promise.all([currentUser.save(), chatUser.save()]);

    // delete chat history between both
    await Message.deleteMany({
      $or: [
        { sender: currentUserId, recipient: chatUserId },
        { sender: chatUserId,    recipient: currentUserId },
      ],
    });

    return res.json({ status: 'success', message: 'Unmatched successfully!' });
  } catch (err) {
    console.error('Error unmatching:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to unmatch.' });
  }
};

/** POST /block/:id
 *  Adds target to blockedUsers, and (optionally) scrubs relations + messages for safety.
 *  Keeps JSON shape simple: {status:'success'} | errors.
 */
exports.blockUser = async (req, res) => {
  try {
    const meId   = String(req.session.userId || '');
    const themId = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(themId) || meId === themId) {
      return res.status(400).json({ status: 'error', message: 'Invalid user ID' });
    }

    const [me, them] = await Promise.all([ User.findById(meId), User.findById(themId) ]);
    if (!me || !them) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // 1) add to my block list
    me.blockedUsers = me.blockedUsers || [];
    const already = me.blockedUsers.some(id => String(id) === themId);
    if (!already) me.blockedUsers.push(them._id);

    // 2) detach likes/matches in both directions
    me.likes    = (me.likes    || []).filter(id => String(id) !== themId);
    me.likedBy  = (me.likedBy  || []).filter(id => String(id) !== themId);
    me.matches  = (me.matches  || []).filter(id => String(id) !== themId);

    them.likes   = (them.likes   || []).filter(id => String(id) !== meId);
    them.likedBy = (them.likedBy || []).filter(id => String(id) !== meId);
    them.matches = (them.matches || []).filter(id => String(id) !== meId);

    await Promise.all([me.save(), them.save()]);

    // 3) wipe messages between both (optional but safer)
    await Message.deleteMany({
      $or: [
        { sender: meId,  recipient: themId },
        { sender: themId, recipient: meId  },
      ]
    });

    return res.json({ status: 'success', message: 'User blocked.' });
  } catch (err) {
    console.error('block user err:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to block user.' });
  }
};
