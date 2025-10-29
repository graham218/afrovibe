// public/js/global.js
(() => {
  if (window.__globalInit) return;
  window.__globalInit = true;

  const $ = (s, r = document) => r.querySelector(s);
  const isMongoId = (v) => /^[a-f0-9]{24}$/i.test(String(v || '').trim());

  const me = document.documentElement.getAttribute('data-me') || '';
  const userId = isMongoId(me) ? me : '';

  function getSocket() {
    return window.__appSocket || window.socket || (window.io ? io({ path: '/socket.io' }) : null);
  }

  function setBadge(sel, n) {
    const el = $(sel);
    if (!el) return;
    const num = Number(n) || 0;
    if (num <= 0) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = String(num);
  }

  function bindSocketEvents(sock) {
    if (!sock) return;

    // de-dup old handlers
    sock.off?.('unread_update');
    sock.off?.('notif_update');
    sock.off?.('connect');

    // (re)register on connect
    sock.on('connect', () => {
      if (userId) sock.emit('register_for_notifications', userId);
    });

    // live counters
    sock.on('unread_update', (p) => setBadge('[data-role="nav-unread-msgs"]', p?.unread || 0));
    sock.on('notif_update',  (p) => setBadge('[data-role="nav-unread-notifs"]', p?.unread || 0));

    // kick an initial registration if already connected
    if (sock.connected && userId) {
      sock.emit('register_for_notifications', userId);
    }
  }

  function init() {
    const sock = getSocket();
    if (sock) {
      bindSocketEvents(sock);
    } else {
      // wait for your helper to announce readiness, then bind
      window.addEventListener('socket:ready', () => {
        const s2 = getSocket();
        bindSocketEvents(s2);
      }, { once: true });
    }

    // image fallback without inline attrs (CSP-safe)
window.addEventListener('error', (e) => {
  const el = e?.target;
  if (el && el.tagName === 'IMG' && el.dataset && el.dataset.fallback) {
    el.src = el.dataset.fallback;
  }
}, true);

    // Normalize on load (SSR may be stale)
    fetch('/api/unread/messages', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setBadge('[data-role="nav-unread-msgs"]', j.count || 0))
      .catch(() => {});
    fetch('/api/unread/notifications', { credentials: 'same-origin' })
      .then(r => r.json()).then(j => setBadge('[data-role="nav-unread-notifs"]', j.count || 0))
      .catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
