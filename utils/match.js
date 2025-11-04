const mongoose = require('mongoose');
const Message = require('../models/Message');

function buildLikeSets(currentUser) {
  return {
    likedSet:   new Set((currentUser.likes   || []).map(String)),
    likedBySet: new Set((currentUser.likedBy || []).map(String)),
  };
}
function isMutualBySets(userIdStr, likedSet, likedBySet) {
  return likedSet.has(userIdStr) && likedBySet.has(userIdStr);
}
function isNewBadge({ lastMessage, userCreatedAt }) {
  const now = Date.now();
  const lastTs = lastMessage ? new Date(lastMessage.createdAt).getTime() : 0;
  const newByMsg = lastTs && (now - lastTs) < 48 * 3600e3;
  const newByJoin = userCreatedAt && (now - new Date(userCreatedAt).getTime()) < 7 * 24 * 3600e3;
  return Boolean(newByMsg || newByJoin);
}
async function getLastMessagesByPeer({ meObj, allIds }) {
  const rows = await Message.aggregate([
    {
      $match: {
        deletedFor: { $nin: [meObj] },
        $or: [
          { sender: meObj, recipient: { $in: allIds } },
          { sender: { $in: allIds }, recipient: meObj },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $addFields: {
        other: { $cond: [{ $eq: ['$sender', meObj] }, '$recipient', '$sender'] }
      }
    },
    { $group: { _id: '$other', last: { $first: '$$ROOT' } } },
  ]);
  return Object.fromEntries(rows.map(r => [String(r._id), r.last]));
}

function isActiveUserQuery() {
  return {
    $and: [
      { $or: [{ isDeleted: { $ne: true } }, { isDeleted: { $exists: false } }] },
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
      { $or: [{ active: { $ne: false } }, { active: { $exists: false } }] },
      { $or: [{ isDeactivated: { $ne: true } }, { isDeactivated: { $exists: false } }] },
    ]
  };
}

module.exports = { buildLikeSets, isMutualBySets, isNewBadge, getLastMessagesByPeer, isActiveUserQuery };
