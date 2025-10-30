// public/js/page-chat.js
(() => {
  if (window.__pageChatInit) return;
  window.__pageChatInit = true;

  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  function getIds() {
    const me   = $('#currentUserId')?.value || document.body?.dataset?.me || '';
    const peer = $('#otherUserId')?.value   || document.body?.dataset?.peerId || '';
    return { me, peer };
  }

  function ensureSocket() {
    if (window.__appSocket) return window.__appSocket;
    if (typeof io !== 'function') return null;
    window.__appSocket = io({
      path: '/socket.io',
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    try { window.dispatchEvent(new Event('socket:ready')); } catch {}
    return window.__appSocket;
  }

  // ---------- toast ----------
  function toast(msg, kind='default') {
    let wrap = $('#toast'); let inner = $('#toastInner');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast';
      wrap.className = 'fixed left-1/2 -translate-x-1/2 bottom-6 z-50';
      inner = document.createElement('div');
      inner.id = 'toastInner';
      inner.className = 'px-4 py-2 rounded-xl shadow-lg text-sm bg-neutral text-neutral-content';
      wrap.appendChild(inner);
      document.body.appendChild(wrap);
    }
    inner.textContent = msg;
    inner.className =
      'px-4 py-2 rounded-xl shadow-lg text-sm ' +
      (kind === 'ok'    ? 'bg-emerald-600 text-white' :
       kind === 'error' ? 'bg-red-600 text-white' :
                          'bg-neutral text-neutral-content');
    wrap.classList.remove('hidden');
    clearTimeout(wrap._t); wrap._t = setTimeout(()=>wrap.classList.add('hidden'), 1700);
  }

  // ---------- format date/time ----------
  function pad(n){ return String(n).padStart(2,'0'); }
  function formatStamp(ts) {
    const d = (ts instanceof Date) ? ts : new Date(ts);
    if (!isFinite(d)) return '';
    const now   = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return t; // today -> time only
    // else -> short date + time
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${t}`;
  }

  // ---------- video preview ----------
  const dlg      = $('#rtc-modal');
  const vLocal   = $('#rtc-local');
  const statusEl = $('#rtc-status');

  function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }
  function openModal() { if (dlg) { try { dlg.showModal?.(); } catch {} dlg.setAttribute('open',''); dlg.style.display='block'; } }
  function closeModal(){ if (dlg) { try { dlg.close?.(); } catch {} dlg.removeAttribute('open'); dlg.style.display=''; } }

  let localStream = null;
  async function startPreview() {
    if (!vLocal) return;
    vLocal.muted = true; vLocal.setAttribute('muted',''); vLocal.setAttribute('playsinline',''); vLocal.setAttribute('autoplay','');
    setStatus('Requesting camera/mic…');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      vLocal.srcObject = localStream; try { await vLocal.play(); } catch {}
      setStatus('Preview active');
    } catch (err) {
      console.warn('[rtc] getUserMedia failed', err);
      setStatus(err?.name || 'Camera/mic blocked');
      toast('Allow camera & mic. Close other apps using your camera.', 'error');
    }
  }
  function stopPreview() {
    try { localStream?.getTracks?.().forEach(t => t.stop()); } catch {}
    if (vLocal && vLocal.srcObject) vLocal.srcObject = null;
    localStream = null;
    setStatus('Ended');
  }

  // ---------- chat DOM helpers ----------
  const chatForm   = $('#chatForm');
  const chatInput  = $('#chatInput');
  const chatScroll = $('#chatScroll');
  const typingDot  = $('#typingDot');
  const clearBtn   = $('#clearThreadBtn');

  function scrollToBottom() {
    if (!chatScroll) return;
    const nearBottom = (chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight) < 160;
    chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: nearBottom ? 'smooth' : 'auto' });
  }

  function renderMessage(m, meId) {
    const mine = String(m.sender) === String(meId);
    const created = m.createdAt || Date.now();

    const wrap = document.createElement('div');
    wrap.className = mine ? 'chat chat-end' : 'chat chat-start';

    const bubble = document.createElement('div');
    bubble.className = mine ? 'chat-bubble chat-bubble-primary' : 'chat-bubble';
    bubble.textContent = (m.content || '').trim();
    bubble.dataset.created = new Date(created).toISOString();

    const meta = document.createElement('div');
    meta.className = 'text-[10px] opacity-60 mt-1';
    meta.textContent = formatStamp(created);
    meta.classList.add('msg-ts');

    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    chatScroll?.appendChild(wrap);
  }

  // Enhance server-rendered bubbles if they carry data-created
  function enhanceExisting() {
    if (!chatScroll) return;
    $$('.chat-bubble', chatScroll).forEach(bub => {
      if (bub.nextElementSibling?.classList?.contains('msg-ts')) return; // already has ts
      const iso = bub.getAttribute('data-created') || bub.dataset.created;
      if (!iso) return;
      const meta = document.createElement('div');
      meta.className = 'text-[10px] opacity-60 mt-1 msg-ts';
      meta.textContent = formatStamp(iso);
      bub.parentElement?.appendChild(meta);
    });
  }

  function wire() {
    const { me, peer } = getIds();

    const sock = ensureSocket();
    if (sock && me) {
      sock.on('connect', () => { try { sock.emit('register_for_notifications', me); } catch {} });
    }

    // video open
    [$('#videoBtn'), $('.video-call-btn')].filter(Boolean).forEach((btn) => {
      const fresh = btn.cloneNode(true); btn.replaceWith(fresh);
      fresh.addEventListener('click', async (e) => {
        e.preventDefault();
        openModal();
        await startPreview();
        if (sock && peer) { sock.emit('rtc:call', { to: peer, meta: { from: me, t: Date.now() } }); setStatus('Ringing…'); }
      });
    });

    // video end
    $$('.rtc-hangup, .video-end-btn', dlg || document).forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (sock && peer) sock.emit('rtc:end', { to: peer, reason: 'hangup' });
        stopPreview(); closeModal();
      });
    });
    dlg?.addEventListener('close', stopPreview);
    window.addEventListener('beforeunload', stopPreview);

    // send
    if (chatForm && chatInput && peer) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = (chatInput.value || '').trim();
        if (!content) return;

        const optimistic = { sender: me, recipient: peer, content, createdAt: Date.now(), _temp: true };
        renderMessage(optimistic, me); scrollToBottom();

        chatInput.disabled = true;
        try {
          const res = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ to: peer, content })
          });
          const j = await res.json().catch(()=>({}));
          if (!res.ok || !j?.ok) {
            chatScroll?.lastElementChild?.remove(); // remove optimistic
            toast(j?.message || (res.status===403 ? 'Chat requires a match' : 'Failed to send'), 'error');
            return;
          }
          toast('Message sent ✓', 'ok');
          chatInput.value = '';
          scrollToBottom();
        } catch {
          chatScroll?.lastElementChild?.remove();
          toast('Network error', 'error');
        } finally {
          chatInput.disabled = false;
          chatInput.focus();
        }
      });
    }

    // typing
    let typingTimer = null;
    if (chatInput && sock && peer) {
      chatInput.addEventListener('input', () => { try { sock.emit('chat:typing', { to: peer }); } catch {} });
      sock.on('chat:typing', (p={}) => {
        if (String(p.from) !== String(peer)) return;
        if (typingDot) typingDot.textContent = 'typing…';
        clearTimeout(typingTimer);
        typingTimer = setTimeout(()=> typingDot && (typingDot.textContent = '\u00A0'), 1200);
      });
    }

    // realtime
    if (sock && chatScroll) {
      sock.on('new_message', (m) => {
        if (!m) return;
        const { sender, recipient } = m;
        const okThread =
          (String(sender) === String(peer) && String(recipient) === String(me)) ||
          (String(sender) === String(me)   && String(recipient) === String(peer));
        if (!okThread) return;
        renderMessage(m, me);
        scrollToBottom();
      });
    }

    // clear
    if (clearBtn) {
      const otherId = clearBtn.getAttribute('data-other-id') || peer;
      const fresh = clearBtn.cloneNode(true); clearBtn.replaceWith(fresh);
      fresh.addEventListener('click', async () => {
        if (!otherId) return;
        if (!confirm('Clear this conversation for you?')) return;
        fresh.disabled = true;
        try {
          const res = await fetch(`/api/messages/${otherId}/clear`, { method:'POST', credentials:'same-origin' });
          const j = await res.json().catch(()=>({}));
          if (!res.ok || !j?.ok) { toast(j?.message || 'Could not clear', 'error'); return; }
          chatScroll && (chatScroll.innerHTML = '');
          toast('Conversation cleared', 'ok');
        } catch { toast('Network error', 'error'); }
        finally { fresh.disabled = false; }
      });
    }

    // add timestamps to any server-rendered bubbles (if they include data-created)
    enhanceExisting();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once:true });
  } else {
    wire();
  }
  window.addEventListener('socket:ready', wire);
})();
