// public/js/page-chat.js (CLEANED)
// Single-source-of-truth RTC state. No inner re-definitions. No double bindings.
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
  function bindSocketChatEvents() {
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
  bindSocketChatEvents();
  window.addEventListener('socket:ready', bindSocketChatEvents, { once: true });

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

  // Single RTC state (do NOT re-declare these anywhere else)
  /** @type {RTCPeerConnection | null} */ let pc = null;
  /** @type {MediaStream | null}        */ let localStream = null;
  /** @type {boolean}                   */ let callActive = false;
  /** @type {string}                    */ let peerId = '';
  /** @type {any}                       */ let rtcCfg = null;

  function setStatus(t)     { if (rtc.status) rtc.status.textContent = t || ''; }
  function openRTCModal()   { try { rtc.modal?.showModal?.() } catch { rtc.modal?.classList?.remove?.('hidden'); } }
  function closeRTCModal()  { try { rtc.modal?.close?.() }     catch { rtc.modal?.classList?.add?.('hidden'); } }

  function flipUIToIdle() {
    callActive = false;
    if (btnCall) {
      btnCall.textContent = '📹 Video chat';
      btnCall.classList.remove('btn-error');
      btnCall.classList.add('btn-ghost');
      btnCall.removeAttribute('disabled');
      btnCall.dataset.state = 'idle';
    }
  }
  function flipUIToInCall() {
    callActive = true;
    if (btnCall) {
      btnCall.textContent = '⛔ End call';
      btnCall.classList.add('btn-error');
      btnCall.classList.remove('btn-ghost');
      btnCall.removeAttribute('disabled');
      btnCall.dataset.state = 'incall';
    }
    rtc.incomingUI?.classList?.add('hidden');
  }

  function getPeerId() {
    const hidden = document.getElementById('otherUserId')?.value?.trim();
    const data   = document.querySelector('.video-call-btn')?.dataset?.peerId?.trim();
    const id = hidden || data || '';
    return isMongoId(id) ? id : '';
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
      if (rtc.vLocal) {
        rtc.vLocal.srcObject = localStream;
        rtc.vLocal.muted = true;
        rtc.vLocal.playsInline = true;
        rtc.vLocal.play?.().catch(()=>{});
      }
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
      const [stream] = e.streams;
      if (rtc.vRemote && stream) {
        rtc.vRemote.srcObject = stream;
        rtc.vRemote.playsInline = true;
        rtc.vRemote.play?.().catch(()=>{});
      }
    };

    const ls = await ensureLocal(); if (!ls) return false;
    if (pc.getSenders().length === 0) {
      ls.getTracks().forEach(t => pc.addTrack(t, ls));
    }
    return true;
  }

  function teardownRTC() {
    try { pc?.getSenders?.().forEach(s => s.track && s.track.stop?.()); } catch {}
    try { localStream?.getTracks?.().forEach(t => t.stop?.()); } catch {}
    try { pc?.close?.(); } catch {}
    pc = null;
    localStream = null;
    if (rtc.vLocal)  rtc.vLocal.srcObject  = null;
    if (rtc.vRemote) rtc.vRemote.srcObject = null;
    setStatus('Idle');
    flipUIToIdle();
  }

  async function startCall() {
    const sock = getSocket();
    const isReady = await waitForSocketConnected(sock);
    if (!isReady) { alert('Connecting… try again in a moment.'); return; }
    if (!sock)    { alert('Socket not ready for call.'); return; }

    const rawPeer = getPeerId();
    if (!isMongoId(rawPeer)) { alert('Cannot start call: missing user id.'); return; }
    peerId = rawPeer;

    openRTCModal(); setStatus('Starting…');
    const inited = await initPC(); if (!inited) return;

    // Optional pre-offer ring
    try { sock.emit('rtc:call', { to: peerId, meta:{} }); } catch {}

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    sock.emit('rtc:offer', { to: peerId, sdp: offer });

    setStatus('Calling…');
    flipUIToInCall();
  }

  function endCall(reason = 'hangup') {
    const s = getSocket();
    const to = peerId || getPeerId();
    if (s && to) s.emit('rtc:end', { to, reason });
    teardownRTC();
    closeRTCModal();
  }

  // Socket RTC events
  function bindRTCEvents() {
    const s = getSocket(); if (!s || !isMongoId(otherUserId)) return;

    s.off?.('rtc:ring');
    s.off?.('rtc:offer');
    s.off?.('rtc:answer');
    s.off?.('rtc:candidate');
    s.off?.('rtc:end');
    s.off?.('rtc:error');

    s.on('rtc:ring', ({ from }) => {
      if (String(from) !== String(otherUserId)) return;
      rtc.incomingUI?.classList?.remove('hidden');
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

  // Single wiring for the call button (toggle)
  function wireCallButtons() {
    on(btnCall, 'click', (e) => {
      e.preventDefault();
      if (callActive) endCall('hangup');
      else startCall();
    });

    // Any explicit hangup buttons inside modal
    rtc.btnEnds && rtc.btnEnds.forEach(b => on(b, 'click', () => endCall('hangup')));

    // Debug click log (optional, keep or remove)
    on(btnCall, 'click', () => {
      const s = getSocket();
      console.log('[rtc] click; socket?', !!s, 'connected?', !!s?.connected);
    });
  }

  // Page init
  function initPage() {
    bindRTCEvents();
    wireCallButtons();
    flipUIToIdle();
  }

  // Kick off. If socket helper will fire 'socket:ready', re-init after reconnect as well.
  if (!getSocket()) {
    window.addEventListener('socket:ready', initPage, { once: true });
  } else {
    initPage();
  }
  window.addEventListener('socket:ready', bindRTCEvents, { once: true });
})();