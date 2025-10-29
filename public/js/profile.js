// public/js/profile.js — client logic for views/profile.ejs (CSP-safe)
(function () {
  const VIEWED_ID   = (document.querySelector('main')?.dataset?.viewedId) || (window.VIEWED_ID) || null; // optional
  const iconLike    = document.getElementById('iconLike');
  const btnLike     = document.getElementById('btnLike');
  const btnSL       = document.getElementById('btnSuperlike');
  const btnWave     = document.getElementById('btnWave');
  const btnFav      = document.getElementById('btnFavorite');
  const btnCall     = document.getElementById('btnCall');
  const btnBlock    = document.getElementById('btnBlock');
  const btnReport   = document.getElementById('btnReport');
  const reportDlg   = document.getElementById('reportDialog');
  const reportForm  = document.getElementById('reportForm');
  const reportCancelBtn = document.getElementById('reportCancelBtn');

  // read the user id from server-rendered HTML safely
  const uid = (function(){
    const el = document.querySelector('a[href^="/chat/"]');
    if (el) { const m = el.getAttribute('href').match(/\/chat\/([a-f0-9]{24})/i); if (m) return m[1]; }
    const hero = document.getElementById('heroPhoto');
    return hero?.getAttribute('data-user-id') || null;
  })();

  function $(s, r=document){ return r.querySelector(s); }
  function $$(s, r=document){ return Array.from(r.querySelectorAll(s)); }

  function toast(msg, kind='default') {
    const el = $('#toast'), inner = $('#toastInner');
    if (!el || !inner) return alert(msg);
    inner.textContent = msg;
    inner.className = 'px-4 py-2 rounded-xl shadow-lg text-sm ' + (kind==='error' ? 'bg-red-700 text-white' :
                                                                    kind==='ok'    ? 'bg-emerald-700 text-white' :
                                                                                     'bg-neutral text-neutral-content');
    el.classList.remove('hidden');
    clearTimeout(el._t); el._t = setTimeout(()=>el.classList.add('hidden'), 2000);
  }

  // Photo thumb -> hero
  $$('.thumbBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const src = btn.getAttribute('data-photo');
      const hero = $('#heroPhoto');
      if (src && hero) hero.src = src;
    });
  });

  // LIKE / UNLIKE
  if (btnLike) {
    btnLike.addEventListener('click', async ()=>{
      if (!uid) return;
      btnLike.disabled = true;
      try {
        const isLikedNow = iconLike?.classList.contains('text-rose-600');
        const path = isLikedNow ? `/dislike/${uid}` : `/like/${uid}`;
        const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'} });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) {
          toast(data?.message || (res.status===429?'Daily like limit reached':'Failed'), 'error');
          return;
        }
        iconLike?.classList.toggle('text-rose-600', !isLikedNow);
        toast(!isLikedNow ? 'Liked ❤️' : 'Removed like', 'ok');
        if (data?.status === 'match' || data?.threadUrl) toast('It’s a match! 🎉', 'ok');
      } catch { toast('Network error', 'error'); }
      finally { btnLike.disabled = false; }
    });
  }

  // SUPER-LIKE
  if (btnSL) {
    btnSL.addEventListener('click', async ()=>{
      if (!uid) return;
      btnSL.disabled = true;
      try {
        const res = await fetch(`/superlike/${uid}`, { method:'POST' });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) {
          toast(data?.error==='limit'?'Out of super-likes for today':
               data?.error==='cooldown'?'Please wait before super-liking again':'Super-like failed','error');
          return;
        }
        iconLike?.classList.add('text-rose-600');
        toast('Sent a Super-like ⚡','ok');
      } catch { toast('Network error','error'); }
      finally { btnSL.disabled = false; }
    });
  }

  // WAVE / INTEREST
  if (btnWave) {
    btnWave.addEventListener('click', async ()=>{
      if (!uid) return;
      btnWave.disabled = true;
      try {
        const res = await fetch(`/interest/${uid}`, { method:'POST' });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) {
          toast(data?.error==='cooldown'?'You recently waved — try again soon':'Wave failed','error');
          return;
        }
        toast(data?.state==='sent'?'Waved 👋':'Already waved','ok');
      } catch { toast('Network error','error'); }
      finally { btnWave.disabled = false; }
    });
  }

  // FAVORITE toggle
  if (btnFav) {
    btnFav.addEventListener('click', async ()=>{
      if (!uid) return;
      btnFav.disabled = true;
      try {
        const res = await fetch(`/favorite/${uid}`, { method:'POST' });
        const data = await res.json().catch(()=>({}));
        if (data?.state === 'unchanged') {
          const r2 = await fetch(`/favorite/${uid}`, { method:'DELETE' });
          const d2 = await r2.json().catch(()=>({}));
          toast(d2?.state==='removed'?'Removed from favorites':'Favorite updated','ok');
        } else {
          toast('Added to favorites ⭐','ok');
        }
      } catch { toast('Favorite failed','error'); }
      finally { btnFav.disabled = false; }
    });
  }

  // CALL REQUEST
  if (btnCall) {
    btnCall.addEventListener('click', async ()=>{
      if (!uid) return;
      btnCall.disabled = true;
      try {
        const res = await fetch(`/api/call/request/${uid}`, { method:'POST' });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) {
          toast(
            res.status===402 || data?.error==='elite_required' ? 'Elite required for video chat' :
            data?.error==='not_allowed' ? 'Both users must be verified & opted-in' :
            data?.error==='cooldown' ? 'You can request again later' : 'Call request failed',
            'error'
          );
          return;
        }
        toast('Ringing… 📲','ok');
      } catch { toast('Network error','error'); }
      finally { btnCall.disabled = false; }
    });
  }

  // REPORT
  if (btnReport && reportDlg && reportForm) {
    btnReport.addEventListener('click', () => { try { reportDlg.showModal(); } catch { /* no-op */ } });
    if (reportCancelBtn) reportCancelBtn.addEventListener('click', () => { try { reportDlg.close(); } catch {} });

    reportForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if (!uid) return;
      const fd = new FormData(reportForm);
      const payload = {
        reportedUserId: uid,
        reason: fd.get('reason') || '',
        details: fd.get('details') || ''
      };
      try {
        const res = await fetch('/report-user', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(()=>({}));
        if (res.ok && data?.status === 'success') {
          toast('Report submitted. Thank you 🙏','ok');
          try { reportDlg.close(); } catch {}
        } else {
          toast(data?.message || 'Report failed','error');
        }
      } catch { toast('Network error','error'); }
    });
  }

  if (btnBlock) btnBlock.addEventListener('click', async () => {
  if (!uid) return;
  if (!confirm('Block this user? You won’t see each other.')) return;

  btnBlock.disabled = true;
  try {
    const res = await fetch(`/block/${uid}`, {
      method: 'POST',
      credentials: 'same-origin',           // <-- ensure session cookie is sent
      headers: { 'Accept': 'application/json' }
    });

    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? (await res.json().catch(()=>({}))) : null;

    if (!res.ok) {
      // if you got bounced to login (HTML), show a helpful message
      const msg = data?.message || (res.status === 401 || res.status === 403
                  ? 'Please log in again.' : 'Could not block');
      toast(msg, 'error');
      btnBlock.disabled = false;
      return;
    }

    toast('User blocked', 'ok');
    // Optional: disable all action buttons after block
    ['btnLike','btnSuperlike','btnWave','btnFavorite','btnCall','btnBlock','btnReport']
      .forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
  } catch {
    toast('Network error', 'error');
    btnBlock.disabled = false;
  }
});
})();
