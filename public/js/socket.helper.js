// public/js/socket.helper.js
(() => {
  // Prevent double-load
  if (window.__socketHelperLoaded) return;
  window.__socketHelperLoaded = true;

  // Create (or reuse) one global Socket.IO connection
  // path defaults to "/socket.io" – set explicitly for clarity
  const socket = window.__appSocket = window.__appSocket || io({
    path: '/socket.io',
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  // Optional global alias
  window.socket = socket;

  // Let pages wait for us
  function announceReady() {
    try { window.dispatchEvent(new Event('socket:ready')); } catch {}
  }
  if (socket.connected) announceReady();
  socket.on('connect', announceReady);

  // -------- utility: register to user room ----------
  function getCurrentUserId() {
    return (
      document.getElementById('currentUserId')?.value ||
      window.currentUserId ||
      ''
    );
  }
  function registerOnce(userId) {
    const uid = String(userId || '');
    if (!uid) return;
    if (window.__notifRegisteredFor === uid) return;
    socket.emit('register_for_notifications', uid);
    window.__notifRegisteredFor = uid;
  }

  document.addEventListener('DOMContentLoaded', () => registerOnce(getCurrentUserId()));
  socket.on('connect', () => registerOnce(getCurrentUserId()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registerOnce(getCurrentUserId());
  });

  // -------- generic badge updates ----------
  socket.on('unread_update', (data) => {
    const count = Number(data?.unread || 0);
    const el =
      document.querySelector('[data-nav-msg]') ||
      document.getElementById('msgBadge') ||
      document.querySelector('.msg-badge');
    if (el) {
      el.textContent = String(count);
      el.classList.toggle('hidden', count <= 0);
    }
  });

  socket.on('notif_update', (data) => {
    const count = Number(data?.unread || 0);
    const el =
      document.querySelector('[data-nav-notif]') ||
      document.getElementById('notifBadge') ||
      document.querySelector('.notif-badge');
    if (el) {
      el.textContent = String(count);
      el.classList.toggle('hidden', count <= 0);
    }
  });

  // (Optional) if your server blocks RTC by plan, redirect
  socket.on('connect_error', (err) => {
    if (String(err?.message).includes('upgrade-required')) {
      location.href = '/upgrade?reason=video';
    }
  });
})();
