const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { HARD_DELETE_DAYS, HARD_DELETE_INTERVAL_MS } = require('../config/constants');

let started = false;
let timer = null;

async function runHardDeleteJob() {
  try {
    const DAYS = HARD_DELETE_DAYS;
    if (!DAYS || DAYS <= 0) {
      console.log('[hard-delete] skipped (HARD_DELETE_DAYS <= 0)');
      return;
    }
    const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

    const msgResult = await Message.deleteMany({
      createdAt: { $lt: cutoff },
      $expr: { $gte: [ { $size: { $ifNull: ["$deletedFor", []] } }, 2 ] }
    });

    let notifResult = { deletedCount: 0 };
    if (Notification && typeof Notification.deleteMany === 'function') {
      notifResult = await Notification.deleteMany({
        createdAt: { $lt: cutoff },
        $expr: { $gt: [ { $size: { $ifNull: ["$deletedFor", []] } }, 0 ] }
      });
    }
    console.log(
      `[hard-delete] cutoff=${cutoff.toISOString()} messages=${msgResult.deletedCount || 0} notifications=${notifResult.deletedCount || 0}`
    );
  } catch (err) {
    console.error('[hard-delete] error', err);
  }
}

function startHardDeleteJob() {
  if (started) return;
  started = true;
  runHardDeleteJob();
  timer = setInterval(runHardDeleteJob, HARD_DELETE_INTERVAL_MS);
}

module.exports = { startHardDeleteJob };
