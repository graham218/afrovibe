const clean = s => String(s || '').trim().slice(0, 5000);

function toTrimmed(v) {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}
function normalizeArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}
function toInt(v, def = null) {
  if (v == null || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function toIntOrNull(v, min, max) {
  if (v == null || v === '') return null;
  let n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}

module.exports = { clean, toTrimmed, normalizeArray, toInt, toIntOrNull };
