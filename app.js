'use strict';
/* SECURE Parts Whiteboard — browser client, no framework required. */
(() => {
  const $ = selector => document.querySelector(selector);
  const state = {
    items: [], date: localDate(new Date()),
    month: startOfMonth(new Date()), kind: 'all', status: 'open',
    view: 'board', query: '', editingId: null, reschedulingId: null,
    settings: null, toastTimer: null
  };
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const svgCalendar = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>';

  function localDate(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function fromDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m-1, d, 12);
  }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 12); }
  function niceDate(str, opts) {
    return fromDate(str).toLocaleDateString('en-CA', opts || { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function escapeHTML(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function attr(value) { return escapeHTML(value); }
  function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function overdue(item) { return item.status !== 'completed' && item.date < localDate(new Date()); }
  function pending(item) { return item.status !== 'completed'; }
  function sortItems(a, b) {
    return (a.date.localeCompare(b.date) || Number(a.status === 'completed') - Number(b.status === 'completed') || a.vendor.localeCompare(b.vendor));
  }
  async function api(url, opts = {}) {
    const config = { credentials: 'same-origin', ...opts };
    if (config.body && typeof config.body !== 'string') {
      config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
      config.body = JSON.stringify(config.body);
    }
    const res = await fetch(url, config);
    let body = {};
    try { body = await res.json(); } catch { /* Network/platform failure handled below */ }
    if (!res.ok) {
      if (res.status === 401 && url !== '/api/login') {
        $('#app').hidden = true;
        $('#authView').hidden = false;
      }
      throw Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  }
  function notify(message, error = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('visible'), 3700);
  }
  function dialogOpen(selector) {
    const el = $(selector);
    if (!el.open) el.showModal();
  }
  function dialogClose(selector) {
    const el = $(selector);
    if (el.open) el.close();
  }
  async function loadItems() {
    const result = await api('/api/items');
    state.items = result.items;
    render();
  }
  async function initialize() {
    $('#liveDate').textContent = niceDate(localDate(new Date()), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    setupEvents();
    // A dedicated TV can remain on the page all day; refresh shared entries every 20 seconds.
    setInterval(async () => {
      if ($('#app').hidden || document.hidden || document.querySelector('dialog[open]')) return;
      try { await loadItems(); } catch {}
    }, 20000);
    try {
      const session = await api('/api/session');
      if (session.authenticated) {
        $('#app').hidden = false;
        $('#authView').hidden = true;
        await loadItems();
        try { state.settings = await api('/api/meta'); } catch {}
        renderSettings();
      } else {
        $('#app').hidden = true;
        $('#authView').hidden = false;
        if (session.configurationMissing) {
          $('#loginForm').querySelector('p').textContent = 'Railway setup needed: set SECURE_APP_PIN in service variables, then redeploy.';
          $('#loginPin').disabled = true;
          $('#loginForm button[type=submit]').disabled = true;
        }
      }
    } catch (err) { $('#authView').hidden = false; notify(err.message, true); }
  }
  function setupEvents() {
    document.addEventListener('click', async e => {
      const target = e.target.closest('[data-action], [data-kind], [data-view], [data-day]');
      if (!target) return;
      if (target.dataset.day) return chooseDate(target.dataset.day);
      if (target.dataset.kind) { state.kind = target.dataset.kind; render(); return; }
      if (target.dataset.view) { state.view = target.dataset.view; render(); return; }
      const action = target.dataset.action;
      const id = target.dataset.id;
      switch (action) {
        case 'add': return openForm(null);
        case 'add-pickup': return openForm(null, 'pickup');
        case 'add-delivery': return openForm(null, 'delivery');
        case 'edit': return openForm(id);
        case 'missed': return openForm(id, null, true);
        case 'complete': return toggleComplete(id);
        case 'delete': return deleteEntry();
        case 'close-entry': return dialogClose('#entryDialog');
        case 'close-detail': return dialogClose('#detailDialog');
        case 'close-settings': return dialogClose('#settingsDialog');
        case 'settings': return dialogOpen('#settingsDialog');
        case 'display': return toggleDisplay();
        case 'month-prev': return shiftMonth(-1);
        case 'month-next': return shiftMonth(1);
        case 'today': return chooseDate(localDate(new Date()));
        case 'day-prev': return shiftDay(-1);
        case 'day-next': return shiftDay(1);
        case 'unit': return showRelated('unit', target.dataset.value);
        case 'po': return showRelated('po', target.dataset.value);
        case 'clear-demo': return clearDemo();
        case 'export': return downloadCSV();
        case 'backup': return downloadJSON();
        case 'logout': return logout();
        case 'overdue': state.status = 'overdue'; $('#statusFilter').value = 'overdue'; return render();
        case 'view-example': return chooseDate('2026-11-06');
        case 'view-day': state.view = 'board'; return render();
        default: return;
      }
    });
    $('#search').addEventListener('input', e => { state.query = e.target.value.trim(); renderBoard(); });
    $('#statusFilter').addEventListener('change', e => { state.status = e.target.value; render(); });
    $('#entryForm').addEventListener('submit', submitEntry);
    $('#loginForm').addEventListener('submit', submitLogin);
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('click', e => {
        if (e.target === dialog) dialog.close();
      });
    }
    window.addEventListener('focus', async () => {
      if ($('#app').hidden) return;
      try { await loadItems(); } catch {}
    });
  }
  async function submitLogin(e) {
    e.preventDefault();
    const button = $('#loginForm button[type=submit]');
    button.disabled = true;
    $('#loginError').textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: { pin: $('#loginPin').value } });
      $('#loginPin').value = '';
      $('#authView').hidden = true;
      $('#app').hidden = false;
      await loadItems();
      try { state.settings = await api('/api/meta'); } catch {}
      renderSettings();
    } catch (err) { $('#loginError').textContent = err.message; }
    finally { button.disabled = false; }
  }
  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    dialogClose('#settingsDialog');
    $('#app').hidden = true;
    $('#authView').hidden = false;
  }
  function toggleDisplay() {
    const on = document.body.classList.toggle('display-mode');
    $('#displayLabel').textContent = on ? 'Exit TV board' : 'TV board';
    if (on) { state.kind = 'all'; state.view = 'board'; state.status = 'open'; state.query = ''; $('#statusFilter').value = 'open'; $('#search').value = ''; render(); }
  }
  function chooseDate(iso) {
    state.date = iso;
    state.month = startOfMonth(fromDate(iso));
    state.status = state.status === 'overdue' ? 'open' : state.status;
    $('#statusFilter').value = state.status;
    state.query = '';
    $('#search').value = '';
    render();
  }
  function shiftMonth(n) {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + n, 1, 12);
    render();
  }
  function shiftDay(n) {
    const d = fromDate(state.date);
    d.setDate(d.getDate() + n);
    chooseDate(localDate(d));
  }
  function render() {
    renderMetrics();
    renderCalendar();
    renderFilters();
    renderDemoBanner();
    renderBoard();
    renderSettings();
  }
  function dayItems(date) { return state.items.filter(i => i.date === date); }
  function renderMetrics() {
    const todayItems = dayItems(state.date).filter(pending);
    $('#metricDue').textContent = todayItems.length;
    $('#metricPickup').textContent = todayItems.filter(i => i.kind === 'pickup').length;
    $('#metricDelivery').textContent = todayItems.filter(i => i.kind === 'delivery').length;
    $('#metricOverdue').textContent = state.items.filter(overdue).length;
  }
  function renderCalendar() {
    $('#calendarMonth').textContent = `${monthNames[state.month.getMonth()]} ${state.month.getFullYear()}`;
    const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12);
    first.setDate(first.getDate() - first.getDay());
    const parts = dayNames.map(n => `<div class="cal-weekday">${n[0]}</div>`);
    const today = localDate(new Date());
    for (let k = 0; k < 42; k++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + k, 12);
      const date = localDate(d);
      const entries = dayItems(date);
      const dots = ['pickup','delivery'].filter(t => entries.some(i => i.kind === t && pending(i)));
      const classes = ['cal-day'];
      if (date === state.date) classes.push('selected');
      if (date === today) classes.push('today');
      if (d.getMonth() !== state.month.getMonth()) classes.push('outside');
      parts.push(`<button type="button" class="${classes.join(' ')}" data-day="${date}" aria-label="${escapeHTML(niceDate(date))}, ${entries.length} entries" title="${escapeHTML(niceDate(date))}">${d.getDate()}<span class="cal-dots">${dots.map(c=>`<i class="${c}"></i>`).join('')}</span></button>`);
    }
    $('#miniCalendar').innerHTML = parts.join('');
  }
  function renderFilters() {
    for (const node of document.querySelectorAll('[data-kind]')) node.classList.toggle('active', node.dataset.kind === state.kind);
    const items = dayItems(state.date).filter(pending);
    $('#totalCount').textContent = items.length;
    $('#pickupCount').textContent = items.filter(i => i.kind === 'pickup').length;
    $('#deliveryCount').textContent = items.filter(i => i.kind === 'delivery').length;
  }
  function renderDemoBanner() {
    const count = state.items.filter(i => i.demo).length;
    const el = $('#demoBanner');
    el.hidden = count === 0;
    if (!count) return;
    el.querySelector('span').textContent = ` ${count} illustrative entries from the November 6 planning notes; they are not live orders.`;
    if (!el.querySelector('[data-action="view-example"]')) {
      const view = document.createElement('button');
      view.className = 'btn btn-text';
      view.dataset.action = 'view-example';
      view.textContent = 'View example date';
      el.insertBefore(view, el.querySelector('[data-action="clear-demo"]'));
    }
  }
  function filteredItems() {
    const q = state.query.toLowerCase();
    let records;
    if (state.status === 'overdue') records = state.items.filter(overdue);
    else if (q) records = state.items;
    else records = dayItems(state.date);
    if (state.status === 'completed') records = records.filter(i => i.status === 'completed');
    else if (state.status === 'open') records = records.filter(pending);
    if (state.kind !== 'all') records = records.filter(i => i.kind === state.kind);
    if (q) records = records.filter(i => [i.vendor, i.po, i.unit, i.description, i.notes, i.date].some(v => String(v || '').toLowerCase().includes(q)));
    return records.sort(sortItems);
  }
  function renderBoard() {
    const countOverdue = state.items.filter(overdue).length;
    const banner = $('#overdueBanner');
    banner.hidden = countOverdue === 0 || state.status === 'overdue';
    if (!banner.hidden) {
      banner.innerHTML = `<span><strong>${countOverdue} overdue ${countOverdue === 1 ? 'entry' : 'entries'}</strong> awaiting pickup or delivery. Review the missed items and update their new expected dates.</span><button type="button" data-action="overdue">Review overdue</button>`;
    }
    const heading = state.status === 'overdue' ? 'Overdue entries' : state.query ? 'Search results' : niceDate(state.date);
    $('#selectedDateLabel').textContent = heading;
    $('#selectedDateMeta').textContent = state.query ? 'SEARCH / ALL DATES' : state.status === 'overdue' ? 'ACTION REQUIRED / ALL DATES' : 'DAILY PARTS SCHEDULE';
    $('#boardViewBtn').classList.toggle('active', state.view === 'board');
    $('#monthViewBtn').classList.toggle('active', state.view === 'month');
    $('#boardView').hidden = state.view !== 'board';
    $('#monthView').hidden = state.view !== 'month';
    const items = filteredItems();
    $('#resultsCount').textContent = `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;
    const pickups = items.filter(i => i.kind === 'pickup');
    const deliveries = items.filter(i => i.kind === 'delivery');
    $('#lanePickupCount').textContent = pickups.length;
    $('#laneDeliveryCount').textContent = deliveries.length;
    $('#pickupItems').innerHTML = pickups.length ? pickups.map(itemCard).join('') : emptyCard('pickup');
    $('#deliveryItems').innerHTML = deliveries.length ? deliveries.map(itemCard).join('') : emptyCard('delivery');
    const isPickupOnly = state.kind === 'pickup';
    const isDeliveryOnly = state.kind === 'delivery';
    $('.lane-pickup').hidden = isDeliveryOnly;
    $('.lane-delivery').hidden = isPickupOnly;
    $('#boardView').classList.toggle('one-column', state.kind !== 'all');
    if (state.view === 'month') renderMonth();
  }
  function emptyCard(type) {
    return `<div class="empty-lane"><div class="empty-icon">${type==='pickup'?'↗':'↘'}</div><strong>Nothing ${type==='pickup'?'to collect':'arriving'} here</strong><p>Entries scheduled for this date will appear in this column.</p></div>`;
  }
  function itemCard(item) {
    const done = item.status === 'completed';
    const late = overdue(item);
    const badge = done ? 'Completed' : late ? 'Past due' : item.status === 'delayed' ? 'Revised ETA' : 'Scheduled';
    const badgeClass = done ? 'completed' : late ? 'overdue' : item.status === 'delayed' ? 'delayed' : 'scheduled';
    const classes = ['item-card'];
    if (done) classes.push('is-complete');
    else if (late) classes.push('is-overdue');
    else if (item.status === 'delayed') classes.push('is-delayed');
    return `<article class="${classes.join(' ')}">
      <div class="item-card-top"><span class="vendor-name">${escapeHTML(item.vendor)}</span><span class="tag tag-${badgeClass}">${badge}</span></div>
      <div class="part-desc">${escapeHTML(item.description)}${item.quantity?` <span style="color:#8591a4;font-weight:500">· ${escapeHTML(item.quantity)}</span>`:''}</div>
      <div class="card-chips">${item.unit ? `<button type="button" class="card-chip clickable" data-action="unit" data-value="${attr(item.unit)}" title="All vendors supplying unit ${attr(item.unit)}">Unit ${escapeHTML(item.unit)} ↗</button>` : ''}${item.po ? `<button type="button" class="card-chip clickable" data-action="po" data-value="${attr(item.po)}" title="All entries for PO ${attr(item.po)}">PO ${escapeHTML(item.po)} ↗</button>` : ''}</div>
      ${item.notes ? `<div class="card-notes">${escapeHTML(item.notes)}</div>` : ''}
      <div class="card-date">${svgCalendar}<span>${escapeHTML(niceDate(item.date, { month:'short', day:'numeric', year:'numeric' }))}${item.demo ? ' · SAMPLE' : ''}</span></div>
      <div class="card-actions"><button class="card-action complete" data-action="complete" data-id="${item.id}">${done?'↶ Reopen':'✓ Complete'}</button>${!done?`<button class="card-action missed" data-action="missed" data-id="${item.id}">↻ Reschedule</button>`:''}<button class="card-action" data-action="edit" data-id="${item.id}">Edit</button></div>
    </article>`;
  }
  function renderMonth() {
    const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12);
    const lead = new Date(first.getFullYear(), first.getMonth(), 1-first.getDay(), 12);
    const parts = dayNames.map(name => `<div class="month-label">${name}</div>`);
    const today = localDate(new Date());
    for (let i=0; i<42; i++) {
      const d = new Date(lead.getFullYear(), lead.getMonth(), lead.getDate()+i, 12);
      const date = localDate(d);
      const items = dayItems(date);
      const pickups = items.filter(x => pending(x) && x.kind === 'pickup').length;
      const deliveries = items.filter(x => pending(x) && x.kind === 'delivery').length;
      const completed = items.filter(x => !pending(x)).length;
      const classes = ['month-cell'];
      if (d.getMonth() !== first.getMonth()) classes.push('outside');
      if (date === state.date) classes.push('selected');
      if (date === today) classes.push('today');
      parts.push(`<button class="${classes.join(' ')}" data-day="${date}" title="${attr(niceDate(date))}"><span class="month-num">${d.getDate()}</span>${pickups?`<span class="month-count pickup">${pickups} pickup${pickups!==1?'s':''}</span>`:''}${deliveries?`<span class="month-count delivery">${deliveries} deliver${deliveries!==1?'ies':'y'}</span>`:''}${completed?`<span class="month-completed">${completed} completed</span>`:''}</button>`);
    }
    $('#monthView').innerHTML = `<div class="month-view-grid">${parts.join('')}</div><div class="month-actions">${monthNames[state.month.getMonth()]} ${state.month.getFullYear()} · Select any date to open its pickup and delivery whiteboard.</div>`;
  }
  function openForm(id, kind = null, reschedule = false) {
    const item = id ? state.items.find(i => i.id === id) : null;
    if (id && !item) return notify('That entry no longer exists.', true);
    // Close the vendor overview before opening an editable form.
    dialogClose('#detailDialog');
    state.editingId = id;
    state.reschedulingId = reschedule ? id : null;
    $('#formTitle').textContent = reschedule ? 'Reschedule expected date' : item ? 'Edit parts entry' : 'New parts entry';
    $('#fieldKind').value = item?.kind || kind || 'pickup';
    $('#fieldDate').value = item?.date || state.date;
    $('#fieldVendor').value = item?.vendor || '';
    $('#fieldUnit').value = item?.unit || '';
    $('#fieldPO').value = item?.po || '';
    $('#fieldQuantity').value = item?.quantity || '';
    $('#fieldDescription').value = item?.description || '';
    $('#fieldNotes').value = item?.notes || '';
    $('#fieldStatus').value = reschedule ? 'delayed' : item?.status || 'scheduled';
    $('#formError').textContent = '';
    $('#deleteBtn').hidden = !item;
    const old = $('#rescheduleTip');
    if (old) old.remove();
    if (reschedule) {
      const tip = document.createElement('div');
      tip.id = 'rescheduleTip';
      tip.className = 'form-tip';
      tip.innerHTML = `<strong>Vendor did not arrive or parts were not ready?</strong> Contact the vendor, enter the new expected date below and save the revised ETA. Original date: <strong>${escapeHTML(niceDate(item.date, {month:'long',day:'numeric',year:'numeric'}))}</strong>.`;
      $('#entryDialog .dialog-body').prepend(tip);
    }
    dialogOpen('#entryDialog');
    if (reschedule) $('#fieldDate').focus();
  }
  async function submitEntry(e) {
    e.preventDefault();
    const item = state.editingId && state.items.find(i => i.id === state.editingId);
    const record = {
      kind: $('#fieldKind').value,
      date: $('#fieldDate').value,
      vendor: $('#fieldVendor').value.trim(),
      unit: $('#fieldUnit').value.trim(),
      po: $('#fieldPO').value.trim(),
      quantity: $('#fieldQuantity').value.trim(),
      description: $('#fieldDescription').value.trim(),
      notes: $('#fieldNotes').value.trim(),
      status: $('#fieldStatus').value
    };
    if (state.reschedulingId) {
      if (item.date === record.date) { $('#formError').textContent = 'Choose a new expected date before rescheduling.'; return; }
      record.status = 'delayed';
      record.notes = `${record.notes}${record.notes ? '\n' : ''}Revised ETA from ${item.date} to ${record.date} (${localDate(new Date())}).`;
    }
    const submit = $('#entryForm button[type=submit]');
    submit.disabled = true;
    $('#formError').textContent = '';
    try {
      if (item) await api(`/api/items/${item.id}`, { method: 'PUT', body: record });
      else await api('/api/items', { method: 'POST', body: record });
      dialogClose('#entryDialog');
      if (state.reschedulingId) notify('New expected date saved.');
      else notify(item ? 'Parts entry updated.' : 'Parts entry added.');
      // On a newly created entry, jump to its scheduled day.
      if ((!item || state.reschedulingId) && !state.query) { state.date = record.date; state.month = startOfMonth(fromDate(record.date)); }
      await loadItems();
    } catch (err) { $('#formError').textContent = err.message; }
    finally { submit.disabled = false; }
  }
  async function deleteEntry() {
    const id = state.editingId;
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    if (!window.confirm(`Delete ${item.description} from ${item.vendor}? This cannot be undone.`)) return;
    try {
      await api(`/api/items/${id}`, { method: 'DELETE' });
      dialogClose('#entryDialog');
      await loadItems();
      notify('Entry deleted.');
    } catch (err) { notify(err.message, true); }
  }
  async function toggleComplete(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    try {
      await api(`/api/items/${id}`, { method: 'PUT', body: { status: item.status === 'completed' ? 'scheduled' : 'completed' } });
      await loadItems();
      notify(item.status === 'completed' ? 'Entry reopened.' : `${item.kind==='pickup'?'Pickup':'Delivery'} marked complete.`);
    } catch (err) { notify(err.message, true); }
  }
  function showRelated(by, value) {
    const match = state.items.filter(i => same(i[by], value)).sort(sortItems);
    $('#detailEyebrow').textContent = by === 'unit' ? 'UNIT / VENDOR OVERVIEW' : 'PURCHASE ORDER / VENDOR OVERVIEW';
    $('#detailTitle').textContent = by === 'unit' ? `Unit ${value}` : `PO ${value}`;
    const vendors = new Set(match.map(i => i.vendor.toLowerCase()));
    const open = match.filter(pending).length;
    $('#detailBody').innerHTML = `<div class="detail-summary"><span><strong>${match.length}</strong> part ${match.length===1?'entry':'entries'}</span><span><strong>${vendors.size}</strong> ${vendors.size===1?'vendor':'vendors'}</span><span><strong>${open}</strong> outstanding</span></div>${match.map(i => `<div class="related-row"><div class="related-top"><h3>${escapeHTML(i.vendor)}</h3><span class="tag tag-${i.status==='completed'?'completed':overdue(i)?'overdue':i.status==='delayed'?'delayed':'scheduled'}">${i.status==='completed'?'Completed':overdue(i)?'Past due':i.status==='delayed'?'Revised ETA':'Scheduled'}</span></div><div class="related-info"><strong>${escapeHTML(i.description)}</strong>${i.quantity?` · ${escapeHTML(i.quantity)}`:''}<div>${i.kind==='pickup'?'Pickup':'Delivery'} · ${escapeHTML(niceDate(i.date, { month:'long', day:'numeric', year:'numeric' }))}${i.po?` · PO ${escapeHTML(i.po)}`:''}${i.unit?` · Unit ${escapeHTML(i.unit)}`:''}</div>${i.notes?`<div>${escapeHTML(i.notes)}</div>`:''}</div><div class="related-actions"><button class="btn btn-ghost" data-action="edit" data-id="${i.id}">Edit entry</button></div></div>`).join('')}`;
    dialogOpen('#detailDialog');
  }
  async function clearDemo() {
    const number = state.items.filter(i => i.demo).length;
    if (!number) return notify('No sample entries remain.');
    if (!window.confirm(`Remove the ${number} sample entries? Any real entries you added will be kept.`)) return;
    try { await api('/api/clear-demo', { method:'POST' }); await loadItems(); notify('Sample entries removed. Your whiteboard is ready.'); }
    catch (err) { notify(err.message, true); }
  }
  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function csvCell(input) {
    let value = String(input ?? '');
    // Prevent spreadsheets from interpreting user-supplied content as formulas.
    if (/^[\s]*[=+@-]/.test(value)) value = `'${value}`;
    return `"${value.replace(/"/g, '""')}"`;
  }
  function downloadCSV() {
    const keys = ['date','kind','status','vendor','unit','po','description','quantity','notes','completedAt','createdAt'];
    const headings = ['Date','Pickup or delivery','Status','Vendor','Unit','PO number','Parts expected','Quantity','Notes','Completed at','Created at'];
    const rows = [headings.map(csvCell).join(','), ...[...state.items].sort(sortItems).map(i => keys.map(k => csvCell(i[k])).join(','))];
    downloadFile(`SECURE-parts-${localDate(new Date())}.csv`, '\ufeff'+rows.join('\r\n'), 'text/csv;charset=utf-8');
    notify('CSV report downloaded.');
  }
  async function downloadJSON() {
    try {
      const result = await api('/api/export');
      downloadFile(`SECURE-parts-backup-${localDate(new Date())}.json`, JSON.stringify(result,null,2), 'application/json');
      notify('JSON backup downloaded.');
    } catch (err) { notify(err.message, true); }
  }
  function renderSettings() {
    const demoButton = $('#settingsDialog [data-action="clear-demo"]');
    demoButton.disabled = !state.items.some(i => i.demo);
    const protectedApp = state.settings?.protected;
    const path = state.settings?.dataDirectory || 'Loading…';
    $('#storageInfo').textContent = `${protectedApp ? 'Shared access code enabled.' : 'No access code configured (local use only).'} Data directory: ${path}. On Railway, mount a persistent volume at /data and set DATA_DIR=/data.`;
    $('#logoutBtn').hidden = !protectedApp;
  }
  initialize();
})();
