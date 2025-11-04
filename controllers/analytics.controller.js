// controllers/analytics.controller.js
const AnalyticsEvent = require('../models/AnalyticsEvent');

module.exports.ingest = async function ingest(req, res) {
  try {
    const { event, payload, ts, path } = req.body || {};
    if (!event || typeof event !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing event name' });
    }
    const doc = {
      user: req.session?.userId || null,
      event,
      payload: (payload && typeof payload === 'object') ? payload : {},
      path: path || req.originalUrl,
      ua: req.get('user-agent') || '',
      ip: (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim(),
      at: ts ? new Date(ts) : new Date(),
    };
    await AnalyticsEvent.create(doc);
    return res.json({ ok: true });
  } catch (e) {
    console.error('analytics err', e);
    return res.status(200).json({ ok: true }); // don’t break UX
  }
};
