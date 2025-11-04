// controllers/report.controller.js
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

// Both exist in your repo; if you later remove one, keep the other.
const Report = require('../models/Report');
const Ticket = require('../models/Ticket');

// --- helpers -------------------------------------------------------------

async function navbarCounts(meId) {
  const meObj = new ObjectId(meId);
  const [unreadMessages, unreadNotificationCount] = await Promise.all([
    Message.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
    Notification.countDocuments({ recipient: meObj, read: false, deletedFor: { $nin: [meObj] } }),
  ]);
  return { unreadMessages, unreadNotificationCount };
}

function wantJson(req) {
  const h = (req.headers['x-requested-with'] || '').toLowerCase();
  const a = (req.headers['accept'] || '').toLowerCase();
  return h === 'xmlhttprequest' || a.includes('application/json');
}

// --- controllers ---------------------------------------------------------

// GET /report
exports.reportPage = async (req, res) => {
  try {
    const sent = req.query.sent === '1';
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser) return res.redirect('/login');

    const counts = await navbarCounts(currentUser._id);

    return res.render('report', {
      pageTitle: 'Report a Concern',
      currentUser,
      sent,
      ...counts,
    });
  } catch (err) {
    console.error('GET /report err', err);
    return res.status(500).render('error', { status: 500, message: 'Could not open report page.' });
  }
};

// POST /report  (general report from the page form)
exports.submitReport = async (req, res) => {
  try {
    const me = new ObjectId(req.session.userId);

    const subject = String(req.body.subject || '').slice(0, 200);
    const details = String(req.body.details || '').slice(0, 5000);
    const category = String(req.body.category || 'report');

    // Save to either Ticket or Report (both models exist in your tree)
    const payload = {
      type: 'report',
      user: me,
      subject,
      details,
      category,
      status: 'open',
      createdAt: new Date(),
    };

    // Prefer Ticket (moderation pipeline), else fallback to Report
    try {
      await Ticket.create(payload);
    } catch {
      await Report.create({
        reporter: me,
        subject,
        details,
        category,
        createdAt: new Date(),
      });
    }

    return res.redirect('/report?sent=1');
  } catch (e) {
    console.error('POST /report err', e);
    return res.status(500).render('error', { status: 500, message: 'Could not submit report.' });
  }
};

// POST /report-user  (Ajax from cards/profile; includes targetId)
exports.reportUser = async (req, res) => {
  try {
    const me = String(req.session.userId || '');
    if (!ObjectId.isValid(me)) {
      return res.status(401).json({ status: 'error', message: 'Auth required' });
    }

    const targetId = String(req.body.targetId || req.body.userId || req.params.id || '');
    const reason   = String(req.body.reason || '').slice(0, 100);
    const details  = String(req.body.details || '').slice(0, 2000);

    if (!ObjectId.isValid(targetId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid targetId' });
    }
    if (!reason && !details) {
      return res.status(400).json({ status: 'error', message: 'Please include a reason or details.' });
    }

    // Ensure target exists & is active-ish (best effort)
    const target = await User.findById(targetId).select('_id username').lean();
    if (!target) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Persist (prefer Ticket; fallback to Report)
    const ticketData = {
      type: 'user_report',
      user: new ObjectId(me),
      target: new ObjectId(targetId),
      subject: reason || 'User report',
      details,
      status: 'open',
      createdAt: new Date(),
    };

    let created = null;
    try {
      created = await Ticket.create(ticketData);
    } catch {
      created = await Report.create({
        reporter: new ObjectId(me),
        target: new ObjectId(targetId),
        reason,
        details,
        createdAt: new Date(),
      });
    }

    // Optionally notify staff via Notification or a webhook.
    // Skipped here to avoid noise; add if you have an admin channel.

    return res.json({ status: 'success', id: String(created._id) });
  } catch (e) {
    console.error('POST /report-user err', e);
    if (wantJson(req)) {
      return res.status(500).json({ status: 'error', message: 'Could not submit report.' });
    }
    return res.status(500).render('error', { status: 500, message: 'Could not submit report.' });
  }
};
