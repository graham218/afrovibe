// routes/tickets.routes.js
const express = require('express');
const Ticket = require('../models/Ticket'); // ensure model exists

// Optional throttle middleware you referenced
let ticketThrottle = (req, res, next) => next(); // replace if you have a real one

const clean = (s) => String(s || '').trim();
const pickTrim = (obj, keys) => {
  const out = {};
  (keys || []).forEach(k => { if (obj && obj[k] != null) out[k] = clean(obj[k]); });
  return out;
};

const router = express.Router();

router.post('/api/tickets', ticketThrottle, async (req, res) => {
  try {
    const kind = String(req.body.type || '').toLowerCase();
    if (!['contact','report','help'].includes(kind)) {
      return res.status(400).json({ ok: false, message: 'Invalid ticket type.' });
    }

    const base = pickTrim(req.body, [
      'subject', 'category', 'message', 'reporterEmail', 'reporterName',
      'targetUser', 'targetUsername', 'targetUrl'
    ]);

    if (!base.message || base.message.length < 5) {
      return res.status(400).json({ ok: false, message: 'Please include a brief message.' });
    }

    const doc = new Ticket({
      type: kind,
      ...base,
      reporter: req.session?.userId || undefined,
      meta: {
        ua: req.headers['user-agent'],
        ip: req.ip,
        referer: req.headers['referer'],
      }
    });

    await doc.save();
    return res.json({ ok: true, id: String(doc._id) });
  } catch (e) {
    console.error('ticket create error', e);
    return res.status(500).json({ ok: false, message: 'Could not submit right now.' });
  }
});

module.exports = router;
