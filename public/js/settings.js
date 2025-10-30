// public/js/settings.js
(() => {
  const $ = (s, r=document)=>r.querySelector(s);

  const deactivateBtn = $('#deactivateBtn');
  const deleteBtn     = $('#deleteBtn');
  const dlgDeact      = $('#deactivateDialog');
  const dlgDelete     = $('#deleteDialog');
  const formDeact     = $('#deactivateForm');
  const formDelete    = $('#deleteForm');

  // open dialogs
  deactivateBtn?.addEventListener('click', () => { try { dlgDeact.showModal(); } catch {} });
  deleteBtn?.addEventListener('click',     () => { try { dlgDelete.showModal(); } catch {} });

  // close buttons
  $('#deactivateCancel')?.addEventListener('click', () => { try { dlgDeact.close(); } catch {} });
  $('#deleteCancel')?.addEventListener('click', () => { try { dlgDelete.close(); } catch {} });

  // POST /account/deactivate
  formDeact?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(formDeact);
    const payload = { reason: fd.get('reason') || '', details: fd.get('details') || '' };
    try {
      const r = await fetch('/account/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j?.ok) {
        location.href = j.redirect || '/login?deactivated=1';
      } else {
        alert(j?.message || 'Failed to deactivate');
      }
    } catch {
      alert('Network error');
    }
  });

  // POST /account/delete
  formDelete?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(formDelete);
    if ((fd.get('confirm') || '').trim().toUpperCase() !== 'DELETE') {
      alert('Type DELETE to confirm');
      return;
    }
    const payload = { reason: fd.get('reason') || '', details: fd.get('details') || '' };
    try {
      const r = await fetch('/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j?.ok) {
        location.href = j.redirect || '/goodbye';
      } else {
        alert(j?.message || 'Failed to delete account');
      }
    } catch {
      alert('Network error');
    }
  });
})();
