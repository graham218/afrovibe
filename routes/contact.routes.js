const express = require('express');
const { clean } = require('../utils/strings');
const { ticketThrottle, pickTrim } = require('../utils/tickets');
const Ticket = require('../models/Ticket');

const router = express.Router();

router.get('/contact', (req, res) => {
  const sent = String(req.query.sent || '') === '1';
  res.render('contact', { pageTitle: 'Contact', currentUser: req.user || null, sent });
});

router.post('/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
    await Ticket.create({
      user: req.session?.userId || undefined,
      name: clean(name).slice(0, 120),
      email: clean(email).slice(0, 180),
      details: clean(message),
      subject: 'Contact form',
      type: 'contact'
    });
    return res.redirect('/contact?sent=1');
  } catch (e) {
    console.error('contact POST error', e);
    return res.status(500).render('error', { status: 500, message: 'Could not send your message.' });
  }
});

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
    const doc = await Ticket.create({
      type: kind, ...base, reporter: req.session?.userId || undefined,
      meta: { ua: req.headers['user-agent'], ip: req.ip, referer: req.headers['referer'] }
    });
    return res.json({ ok: true, id: String(doc._id) });
  } catch (e) {
    console.error('ticket create error', e);
    return res.status(500).json({ ok: false, message: 'Could not submit right now.' });
  }
});

module.exports = router;

