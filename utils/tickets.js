const ticketHits = new Map();

function ticketThrottle(req, res, next) {
  const key = (req.ip || 'ip') + '|' + (req.session?.userId || 'guest');
  const now = Date.now();
  const windowMs = 60_000;
  const max = 4;

  const arr = ticketHits.get(key)?.filter(t => now - t < windowMs) || [];
  arr.push(now);
  ticketHits.set(key, arr);
  if (arr.length > max) return res.status(429).json({ ok: false, message: 'Too many requests. Try again shortly.' });
  next();
}

function pickTrim(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

module.exports = { ticketThrottle, pickTrim };
