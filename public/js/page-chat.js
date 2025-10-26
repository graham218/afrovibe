// public/js/page-chat.js
(function () {
  // ---------- tiny utils ----------
  const $  = (s, r=document) => r.querySelector(s);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const isMongoId = (s) => /^[a-f0-9]{24}$/i.test(String(s || '').trim());

  // always re-resolve the socket (do NOT capture once)
  const getSocket = () => window.__appSocket || window.socket || null;

  async function waitForSocketConnected(sock, ms = 5000) {
  if (!sock) return false;
  if (sock.connected) return true;
  return await new Promise((resolve) => {
    const onConnect = () => { cleanup(); resolve(true); };
    const t = setTimeout(() => { cleanup(); resolve(false); }, ms);
    function cleanup() { sock.off('connect', onConnect); clearTimeout(t); }
    sock.once('connect', onConnect);
  });
}
  // ---------- DOM refs ----------
  const currentUserId = ($('#currentUserId')?.value || '').trim();
  const otherUserId   = ($('#otherUserId')?.value   || '').trim();

  const form      = $('#chatForm');
  const input     = $('#chatInput');
  const scrollBox = $('#chatScroll');
  const typingDot = $('#typingDot');

  const btnBlock  = $('#blockUser');
  const btnReport = $('#reportUser');
  const btnClear  = $('#clearThreadBtn');   // has data-other-id in EJS
  const btnCall   = document.querySelector('.video-call-btn');

  // ---------- Basic guards ----------
  if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
  if (!isMongoId(otherUserId)) {
    console.warn('[chat] invalid otherUserId, disabling composer');
    if (input) input.disabled = true;
    form?.querySelector('button')?.setAttribute('disabled', 'disabled');
  }

  // ---------- Chat UI helpers ----------
  function appendBubble({ _id, sender, content, createdAt }) {
    const mine = String(sender) === String(currentUserId);
    const wrap = document.createElement('div');
    wrap.className = `flex ${mine ? 'justify-end' : 'justify-start'}`;

    const bubble = document.createElement('div');
    bubble.className =
      `max-w-[85%] md:max-w-[75%] rounded-2xl px-3 py-2 ` +
      (mine ? 'bg-primary text-white' : 'bg-gray-100');
    bubble.dataset.id   = _id || '';
    bubble.dataset.mine = mine ? '1' : '0';
    const ts = new Date(createdAt || Date.now());
    bubble.dataset.ts   = String(ts.getTime());

    const text = document.createElement('div');
    text.className = 'whitespace-pre-wrap break-words text-sm';
    text.textContent = content;

    const meta = document.createElement('div');
    meta.className = 'text-[10px] opacity-70 mt-1';
    meta.innerHTML = mine ? `${ts.toLocaleString()} <span class="delivery">✓</span>`
                          : ts.toLocaleString();

    bubble.appendChild(text);
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    scrollBox?.appendChild(wrap);
    if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
  }

  function removeTemp(tempId) {
    const node = scrollBox?.querySelector(`[data-id="${tempId}"]`);
    node?.parentElement?.remove();
  }

  function updateSeenMarker(untilTs) {
    if (!scrollBox) return;
    const mine = [...scrollBox.querySelectorAll('[data-mine="1"]')];
    if (!mine.length) return;

    let target = null;
    for (const b of mine) {
      const ts = Number(b.dataset.ts || 0);
      if (ts <= untilTs) target = b;
    }
    if (!target) return;

    scrollBox.querySelectorAll('[data-mine="1"] .delivery').forEach(el => el.textContent = '✓');
    $('#seenRow')?.remove();

    const mark = target.querySelector('.delivery');
    if (mark) mark.textContent = '✓✓';

    const seenRow = document.createElement('div');
    seenRow.id = 'seenRow';
    seenRow.className = 'text-[11px] text-gray-500 mt-1 text-right';
    seenRow.textContent = 'Seen';
    target.parentElement.appendChild(seenRow);
  }

  // ---------- Send message ----------
  if (form && input && scrollBox && isMongoId(otherUserId)) {
    let sending = false;
    on(form, 'submit', async (e) => {
      e.preventDefault();
      if (sending) return;

      let content = (input.value || '').trim();
      if (!content) return;

      sending = true;
      const tempId = 'tmp_' + Math.random().toString(36).slice(2);
      appendBubble({ _id: tempId, sender: currentUserId, content, createdAt: Date.now() });
      input.value = '';

      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ to: otherUserId, recipient: otherUserId, content })
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || json?.ok === false) {
          removeTemp(tempId);
          const msg = json?.message || json?.error ||
                      (Array.isArray(json?.errors) && json.errors[0]?.msg) ||
                      'Failed to send.';
          alert(msg);
          return;
        }
        // final bubble will arrive via socket events
      } catch (err) {
        removeTemp(tempId);
        alert('Network error sending message.');
      } finally {
        sending = false;
      }
    });
  }

  // ---------- Typing indicator ----------
  if (input && isMongoId(otherUserId)) {
    let lastTypeAt = 0;
    on(input, 'input', () => {
      const s = getSocket();
      if (!s) return;
      const now = Date.now();
      if (now - lastTypeAt > 900) {
        lastTypeAt = now;
        s.emit('chat:typing', { to: otherUserId });
      }
    });
  }

  // ---------- Incoming messages + read receipts ----------
  function onIncoming(m) {
    if (String(m.sender) !== String(otherUserId)) return;
    appendBubble(m);
    fetch(`/api/messages/${encodeURIComponent(otherUserId)}/read`, { method:'POST', credentials:'include' })
      .catch(()=>{});
  }

  // bind socket events when available
  function bindSocketEvents() {
    const s = getSocket();
    if (!s) return;

    s.off?.('chat:incoming', onIncoming);
    s.off?.('new_message', onIncoming);

    s.on('chat:incoming', onIncoming);
    s.on('new_message',   onIncoming);

    s.on('chat:typing', (p) => {
      if (!p || String(p.from) !== String(otherUserId)) return;
      if (typingDot) {
        typingDot.style.opacity = '1';
        setTimeout(() => typingDot.style.opacity = '0', 1200);
      }
    });

    s.on('connect', () => {
      const uid = ($('#currentUserId')?.value || '').trim();
      if (uid) s.emit('register_for_notifications', uid);
      if (isMongoId(otherUserId)) {
        fetch(`/api/messages/${encodeURIComponent(otherUserId)}/read`, { method:'POST', credentials:'include' })
          .catch(()=>{});
      }
    });

    s.on('chat:read', (payload) => {
      if (!payload || String(payload.with) !== String(currentUserId)) return;
      const t = new Date(payload.until).getTime();
      updateSeenMarker(t);
    });

    s.on('connect_error', (err) => {
      if (String(err?.message).includes('upgrade-required')) {
        window.location.href = '/upgrade?reason=video';
      }
    });
  }

  // initial attempt + listen for helper’s ping
  bindSocketEvents();
  window.addEventListener('socket:ready', bindSocketEvents, { once: true });

  // ---------- Block / Report ----------
  on(btnBlock, 'click', async () => {
    if (!confirm('Block this user? They won’t be able to contact you.')) return;
    try {
      const r = await fetch(`/api/users/${encodeURIComponent(otherUserId)}/block`, {
        method: 'POST', credentials: 'include'
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok || d.ok === false) throw 0;
      alert('User blocked.');
      location.href = '/messages';
    } catch { alert('Could not block.'); }
  });

  on(btnReport, 'click', async () => {
    const reason = prompt('Describe the issue (spam, harassment, fake profile, etc.)');
    if (!reason) return;
    try {
      const r = await fetch('/api/report', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otherUserId, reason })
      });
      const d = await r.json().catch(()=>({}));
      if (!r.ok || d.ok === false) throw 0;
      alert('Thanks for your report. We’ll review.');
    } catch { alert('Report failed.'); }
  });

  // ---------- Clear conversation (CSP-safe) ----------
  on(btnClear, 'click', async () => {
    const otherId = btnClear?.dataset.otherId || ($('#otherUserId')?.value || '');
    if (!isMongoId(otherId)) { alert('Missing peer id — cannot clear this thread.'); return; }
    if (!confirm('Clear this conversation for you? (This does not delete for the other person.)')) return;

    btnClear.disabled = true;
    try {
      let res = await fetch(`/api/messages/${encodeURIComponent(otherId)}/clear`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        res = await fetch(`/api/messages/${encodeURIComponent(otherId)}`, {
          method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        alert(json.message || json.error || 'Could not clear chat.');
        btnClear.disabled = false;
        return;
      }
      if (scrollBox) {
        scrollBox.innerHTML = '<div class="text-center text-sm opacity-70 py-6">Conversation cleared.</div>';
      }
      const badge = document.querySelector('[data-nav-msg], #msgBadge, .msg-badge');
      if (badge) badge.textContent = '0';
    } catch (e) {
      console.warn('clear thread error', e);
      alert('Could not clear chat right now.');
    } finally {
      btnClear.disabled = false;
    }
  });

  // ========== RTC (Video chat) ==========
  const rtc = {
    modal:   $('#rtc-modal'),
    vLocal:  $('#rtc-local'),
    vRemote: $('#rtc-remote'),
    status:  $('#rtc-status'),
    incomingUI: $('#rtc-incoming'),
    btnMute:  null,
    btnVideo: null,
    btnEnds:  null
  };
  if (rtc.modal) {
    rtc.btnMute  = rtc.modal.querySelector('.rtc-mute');
    rtc.btnVideo = rtc.modal.querySelector('.rtc-video');
    rtc.btnEnds  = rtc.modal.querySelectorAll('.rtc-hangup');
  }

  let pc = null;
  let localStream = null;
  let peerId = null;
  let rtcCfg = null;
  let callActive = false;

  function setStatus(t)     { if (rtc.status) rtc.status.textContent = t || ''; }
  function openRTCModal()   { try { rtc.modal?.showModal(); } catch {} }
  function closeRTCModal()  { try { rtc.modal?.close(); } catch {} }

  function flipUIToIdle() {
    callActive = false;
    if (btnCall) {
      btnCall.textContent = '📹 Video chat';
      btnCall.classList.remove('btn-error');
      btnCall.classList.add('btn-ghost');
      btnCall.disabled = false;
    }
  }
  function flipUIToInCall() {
    callActive = true;
    if (btnCall) {
      btnCall.textContent = '⛔ End call';
      btnCall.classList.add('btn-error');
      btnCall.classList.remove('btn-ghost');
      btnCall.disabled = false;
    }
  }

  async function fetchRTCConfig() {
    if (rtcCfg) return rtcCfg;
    try {
      const r = await fetch('/api/rtc/config', { credentials: 'include' });
      const j = await r.json().catch(()=>({}));
      rtcCfg = j?.rtc || { iceServers:[{ urls:['stun:stun.l.google.com:19302'] }] };
    } catch {
      rtcCfg = { iceServers:[{ urls:['stun:stun.l.google.com:19302'] }] };
    }
    return rtcCfg;
  }

  async function ensureLocal() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:true });
      if (rtc.vLocal) rtc.vLocal.srcObject = localStream;
      return localStream;
    } catch {
      setStatus('Camera/mic blocked.');
      return null;
    }
  }

  async function initPC() {
    const cfg = await fetchRTCConfig();
    pc = new RTCPeerConnection(cfg);

    pc.onicecandidate = (e) => {
      const s = getSocket();
      if (e.candidate && peerId && s) {
        s.emit('rtc:candidate', { to: peerId, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      if (rtc.vRemote) rtc.vRemote.srcObject = e.streams[0];
    };

    const ls = await ensureLocal(); if (!ls) return false;
    ls.getTracks().forEach(t => pc.addTrack(t, ls));
    return true;
  }

  function teardownRTC() {
    try { pc?.getSenders()?.forEach(s => s.track && s.track.stop()); } catch {}
    try { localStream?.getTracks()?.forEach(t => t.stop()); } catch {}
    try { pc?.close(); } catch {}
    pc = null;
    localStream = null;
    if (rtc.vLocal)  rtc.vLocal.srcObject  = null;
    if (rtc.vRemote) rtc.vRemote.srcObject = null;
    flipUIToIdle();
  }

  (function initChatPage() {
  // If helper hasn't created the socket yet, wait for it once.
  if (!window.__appSocket && !window.socket) {
    window.addEventListener('socket:ready', initChatPage, { once: true });
    return;
  }
  const socket = window.__appSocket || window.socket;
  if (!socket) return; // hard guard

  // --- bind your rtc listeners here to `socket` (offer/answer/candidate/end) ---

  // Wire call buttons
  const btnCall = document.querySelector('.video-call-btn');
  const btnEnd  = document.querySelector('.video-end-btn');
  btnCall?.addEventListener('click', (e) => { e.preventDefault(); startCall(); });
  btnEnd?.addEventListener('click', (e) => { e.preventDefault(); endCall(); });

  // Also listen for remote end
  socket.on('rtc:end', () => teardownRTC());
})();

  async function startCall() {
    const s = getSocket();
    if (!s) { alert('Socket not ready for call.'); return; }

    const ok = await waitForSocketConnected(4000);
    if (!ok) { alert('Connecting… try again in a moment.'); return; }

    const rawPeer =
      (document.getElementById('otherUserId')?.value || '').trim() ||
      (btnCall?.dataset?.peerId || '').trim();

    if (!isMongoId(rawPeer)) { alert('Cannot start call: missing user id.'); return; }
    peerId = rawPeer;

    try {
      openRTCModal();
      setStatus('Starting…');

      const ready = await initPC(); if (!ready) return;

      s.emit('rtc:call', { to: peerId, meta: {} });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      s.emit('rtc:offer', { to: peerId, sdp: offer });

      setStatus('Calling…');
      flipUIToInCall();
    } catch (err) {
      console.error('[rtc] startCall error', err);
      alert('Could not start the call.');
      teardownRTC();
    }
  }

  function endCall(reason = 'hangup') {
    const s = getSocket();
    if (s && peerId) s.emit('rtc:end', { to: peerId, reason });
    teardownRTC();
    closeRTCModal();
  }

  on(btnCall, 'click', () => {
  const s = window.__appSocket || window.socket;
  console.log('[rtc] click; socket?', !!s, 'connected?', !!s?.connected);
});

  // Button: toggle start/end
  on(btnCall, 'click', (e) => {
    e.preventDefault();
    if (callActive) endCall('hangup');
    else startCall();
  });

  // Modal controls
  if (rtc.modal) {
    on(rtc.modal, 'close', () => teardownRTC());

    rtc.btnMute && on(rtc.btnMute, 'click', () => {
      const t = localStream?.getAudioTracks?.()[0]; if (!t) return;
      t.enabled = !t.enabled;
      rtc.btnMute.classList.toggle('btn-active', !t.enabled);
      rtc.btnMute.textContent = t.enabled ? 'Mute' : 'Unmute';
    });

    rtc.btnVideo && on(rtc.btnVideo, 'click', () => {
      const t = localStream?.getVideoTracks?.()[0]; if (!t) return;
      t.enabled = !t.enabled;
      rtc.btnVideo.classList.toggle('btn-active', !t.enabled);
      rtc.btnVideo.textContent = t.enabled ? 'Video' : 'Video On';
    });

    rtc.btnEnds && rtc.btnEnds.forEach(b => on(b, 'click', () => endCall('hangup')));
  }

  // Socket RTC events
  function bindRTCEvents() {
    const s = getSocket(); if (!s || !isMongoId(otherUserId)) return;

    let pc;                 // your RTCPeerConnection
let localStream;        // your local MediaStream
let peerId = '';        // filled when starting
const rtcModal   = document.getElementById('rtc-modal');
const statusEl   = document.getElementById('rtc-status');
const localVideo = document.getElementById('rtc-local');
const remoteVideo= document.getElementById('rtc-remote');

function setStatus(s){ if (statusEl) statusEl.textContent = s; }
function openRTCModal(){ try { rtcModal?.showModal(); } catch {} }
function flipUIToInCall(){
  document.querySelector('.video-call-btn')?.setAttribute('disabled','true');
  document.querySelector('.video-end-btn')?.classList.remove('hidden');
  document.querySelector('.video-end-btn')?.removeAttribute('disabled');
}
function flipUIToIdle(){
  document.querySelector('.video-call-btn')?.removeAttribute('disabled');
  const endBtn = document.querySelector('.video-end-btn');
  if (endBtn){ endBtn.classList.add('hidden'); endBtn.setAttribute('disabled','true'); }
}

function stopStream(stream){ try { stream?.getTracks()?.forEach(t => t.stop()); } catch{} }
function teardownRTC(){
  try { if (pc) { pc.ontrack = pc.onicecandidate = null; pc.close(); } } catch{}
  pc = null;
  stopStream(localStream); localStream = null;
  if (localVideo)  localVideo.srcObject  = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  setStatus('Idle');
  flipUIToIdle();
}

async function initPC() {
  // your existing RTCPeerConnection setup; make sure you set ontrack to remoteVideo
  pc = new RTCPeerConnection(await fetch('/api/rtc/config').then(r=>r.json()).then(j => j.rtc || {}));
  pc.ontrack = (e) => { if (remoteVideo) remoteVideo.srcObject = e.streams[0]; };
  pc.onicecandidate = (e) => {
    if (e.candidate && peerId && (window.__appSocket || window.socket)) {
      (window.__appSocket || window.socket).emit('rtc:candidate', { to: peerId, candidate: e.candidate });
    }
  };
  // getUserMedia
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (localVideo) localVideo.srcObject = localStream;
  } catch (err) {
    alert('Camera/mic permission denied.'); return false;
  }
  return true;
}

function getPeerId() {
  const hidden = document.getElementById('otherUserId')?.value?.trim();
  const data   = document.querySelector('.video-call-btn')?.dataset?.peerId?.trim();
  return (hidden && /^[a-f0-9]{24}$/i.test(hidden)) ? hidden
       : (data   && /^[a-f0-9]{24}$/i.test(data))   ? data
       : '';
}

async function startCall() {
  const sock = window.__appSocket || window.socket;
  const ready = await waitForSocketConnected(sock);
  if (!ready) { alert('Connecting… try again in a moment.'); return; }
  if (!sock)  { alert('Socket not ready for call.'); return; }

  const rawPeer = getPeerId();
  if (!/^[a-f0-9]{24}$/i.test(rawPeer)) { alert('Cannot start call: missing user id.'); return; }
  peerId = rawPeer;

  openRTCModal(); setStatus('Starting…');

  const okInit = await initPC();
  if (!okInit) return;

  // notify peer and send offer
  sock.emit('rtc:call', { to: peerId, meta:{} });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sock.emit('rtc:offer', { to: peerId, sdp: offer });
  setStatus('Calling…');
  flipUIToInCall();
}

function endCall() {
  const sock = window.__appSocket || window.socket;
  if (sock && peerId) sock.emit('rtc:end', { to: peerId, reason: 'hangup' });
  teardownRTC();
}


    s.off?.('rtc:incoming'); s.off?.('rtc:offer'); s.off?.('rtc:answer');
    s.off?.('rtc:candidate'); s.off?.('rtc:end'); s.off?.('rtc:error');

    s.on('rtc:incoming', ({ from }) => {
      if (String(from) !== String(otherUserId)) return;
      peerId = from;
      openRTCModal();
      setStatus('Incoming call…');
      rtc.incomingUI?.classList?.remove('hidden');
      flipUIToInCall();
    });

    const btnAccept  = $('#rtc-accept');
    const btnDecline = $('#rtc-decline');

    on(btnAccept, 'click', async () => {
      rtc.incomingUI?.classList?.add('hidden');
      setStatus('Connecting…');
      const ok = await initPC(); if (!ok) return;
    });

    on(btnDecline, 'click', () => {
      rtc.incomingUI?.classList?.add('hidden');
      endCall('declined');
    });

    s.on('rtc:offer', async ({ from, sdp }) => {
      if (String(from) !== String(otherUserId)) return;
      peerId = from;
      if (!pc) {
        openRTCModal();
        setStatus('Connecting…');
        const ok = await initPC(); if (!ok) return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit('rtc:answer', { to: peerId, sdp: answer });
      flipUIToInCall();
    });

    s.on('rtc:answer', async ({ from, sdp }) => {
      if (String(from) !== String(otherUserId)) return;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      setStatus('Connected');
      flipUIToInCall();
    });

    s.on('rtc:candidate', async ({ from, candidate }) => {
      if (String(from) !== String(otherUserId)) return;
      if (!pc || !candidate) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    });

    s.on('rtc:end', ({ from /*, reason*/ }) => {
      if (String(from) !== String(otherUserId)) return;
      setStatus('Call ended');
      endCall('remote-hangup');
    });

    s.on('rtc:error', (e) => {
      if (String(e?.code) === 'upgrade-required') {
        window.location.href = '/upgrade?reason=video';
      } else {
        alert(e?.message || 'Video call is not available.');
      }
      flipUIToIdle();
    });
  }

  bindRTCEvents();
  window.addEventListener('socket:ready', bindRTCEvents, { once: true });
})();
