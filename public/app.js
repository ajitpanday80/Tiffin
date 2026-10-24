'use strict';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmt = (s) => pd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtS = (s) => pd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const rangeLabel = (l) => (l.from === l.to ? fmtS(l.from) : `${fmtS(l.from)} – ${fmtS(l.to)}`);
const nDays = (l) => Math.round((pd(l.to) - pd(l.from)) / 864e5) + 1;
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const monthName = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const addMonth = (m, n) => ymd(new Date(+m.slice(0, 4), +m.slice(5) - 1 + n, 1)).slice(0, 7);
const HUES = ['#e8590c', '#2f9e44', '#1c7ed6', '#9c36b5', '#d6336c', '#0c8599', '#f08c00'];
const hue = (s) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

const S = { settings: null, day: null, today: null, tab: 'pending', customers: [], q: '', month: null, report: null };

// ---------- api + feedback ----------
async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  if (r.status === 401 || r.status === 403) {
    location.href = '/login';
    throw new Error('login');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
let toastTimer;
function toast(msg, isBad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isBad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    if (e.message !== 'login') toast(e.message, true);
  }
}

// ---------- phone / link helpers ----------
function waNumber(phone) {
  let p = (phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p.slice(1);
  p = p.replace(/^0+/, '');
  return p.length <= 10 ? S.settings.countryCode + p : p;
}
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const custLink = (c) => `${location.origin}/c/${c.token}`;
const mapLink = (a) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
const money = (n) => S.settings.currency + Number(n).toLocaleString('en-IN');

// ---------- shell ----------
const ICONS = {
  today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
  customers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  reports: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  grow: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
};
const TABS = [['today', 'Today'], ['customers', 'Customers'], ['reports', 'Reports'], ['grow', 'Grow'], ['settings', 'Settings']];

function svgIcon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name]; // static strings above, no user data
  return s;
}

function buildShell() {
  $('#root').replaceChildren(
    h('div', { class: 'app' },
      h('header', { class: 'top' }, h('img', { class: 'logo', src: '/icon.svg', alt: '' }), h('h1', { id: 'biz' }, S.settings.businessName)),
      h('main', { id: 'view' }),
      h('nav', { class: 'tabs' }, TABS.map(([id, label]) => h('a', { href: `#/${id}`, 'data-tab': id }, svgIcon(id), label))),
    ),
  );
}

// ---------- router ----------
// Each screen = load (fetch data) + draw (build DOM from state).
const views = {
  today: { load: () => loadDay(), draw: () => renderToday() },
  customers: { load: loadCustomers, draw: () => renderCustomers() },
  reports: { load: loadReport, draw: () => renderReport() },
  grow: { load: loadGrow, draw: () => renderGrow() },
  settings: { load: loadSettings, draw: () => renderSettings() },
};
const current = () => ((location.hash.match(/^#\/(\w+)/) || [])[1] in views ? location.hash.slice(2) : 'today');

let renderSeq = 0;
async function render() {
  if (!S.settings || !$('#view')) return;
  const name = current();
  const seq = ++renderSeq; // ignore results of renders that were superseded
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  const view = $('#view');
  view.replaceChildren(h('div', { class: 'spinner' }, 'Loading…'));
  try {
    await views[name].load();
    if (seq !== renderSeq) return;
    view.replaceChildren(views[name].draw());
  } catch (e) {
    if (e.message !== 'login') view.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'big' }, '⚠️'), h('p', {}, e.message), h('button', { class: 'btn', onclick: render }, 'Try again')));
  }
  window.scrollTo(0, 0);
}
// Redraw the current screen in place (optionally re-fetching), keeping the scroll position.
async function refresh(reload = false) {
  const view = $('#view');
  if (!view) return;
  const name = current();
  const y = window.scrollY;
  try {
    if (reload) await views[name].load();
    if (current() !== name) return; // user already moved to another screen
    view.replaceChildren(views[name].draw());
    window.scrollTo(0, y);
  } catch (e) {
    if (e.message !== 'login') toast(e.message, true);
  }
}
window.addEventListener('hashchange', render);

// ---------- TODAY ----------
async function loadDay(date) {
  const d = await api('GET', `/api/day${date ? `?date=${date}` : ''}`);
  S.day = d;
  S.today = d.today;
}

function dayLabel(date) {
  if (date === S.today) return 'Today';
  if (date === addDays(S.today, 1)) return 'Tomorrow';
  if (date === addDays(S.today, -1)) return 'Yesterday';
  return pd(date).toLocaleDateString('en-GB', { weekday: 'long' });
}

function renderToday() {
  const d = S.day, c = d.counts, future = d.date > S.today;
  const goDay = async (date) => { await act(() => loadDay(date)); refresh(); };
  const chip = (label, n) => h('span', { class: 'chip' }, `${label} `, h('b', {}, n));
  const rows = d.rows.filter((r) => r.status === S.tab);
  const tabBtn = (id, label, n) => h('button', { class: S.tab === id ? 'on' : '', onclick: () => { S.tab = id; refresh(); } }, label, h('small', {}, n));

  return h('div', { class: 'stack' },
    h('div', { class: 'datebar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => goDay(addDays(d.date, -1)) }, '‹'),
      h('div', { class: 'datebar-mid' }, h('strong', {}, dayLabel(d.date)), h('span', { class: 'muted' }, fmt(d.date))),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => goDay(addDays(d.date, 1)) }, '›')),
    d.date !== S.today && h('button', { class: 'link', onclick: () => goDay(S.today) }, '↩ Back to today'),

    d.closed
      ? h('div', { class: 'hero closed' }, h('div', { class: 'hero-lbl' }, 'No service'), h('div', { class: 'hero-num' }, '🌴'), h('div', { class: 'chips' }, chip('Closed this day', '')))
      : h('div', { class: 'hero' },
          h('div', { class: 'hero-lbl' }, 'Tiffin boxes to prepare'),
          h('div', { class: 'hero-num' }, c.boxes),
          h('div', { class: 'chips' }, chip('Normal', c.normal), chip('✨ Deluxe', c.deluxe), c.leave > 0 && chip('🏖 On leave', c.leave))),

    !d.closed && !future && c.stops > 0 && h('div', { class: 'card' },
      h('div', { class: 'progress-txt' }, h('span', {}, h('b', {}, `${c.delivered} of ${c.stops}`), ' delivered'), c.pending > 0 ? h('span', { class: 'muted' }, `${c.pending} left`) : h('b', { class: 'ok-txt' }, 'All done 🎉')),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.round((c.delivered / c.stops) * 100)}%` } }))),

    !d.closed && d.rows.length > 0 && h('div', { class: 'seg', role: 'tablist' },
      tabBtn('pending', future ? 'Delivering' : 'To deliver', c.pending),
      tabBtn('delivered', 'Delivered', c.delivered),
      tabBtn('leave', 'On leave', c.leave)),

    !d.closed && rows.length === 0 && h('div', { class: 'card empty' }, ...emptyState(d, c)),
    rows.map((r) => rowCard(r, future)),
  );
}

function emptyState(d, c) {
  if (!d.rows.length) return [h('div', { class: 'big' }, '👋'), h('p', {}, 'No customers for this day yet.'), h('a', { class: 'btn primary', href: '#/customers', style: { marginTop: '14px' } }, 'Add your first customer')];
  if (S.tab === 'pending') return c.stops ? [h('div', { class: 'big' }, '🎉'), h('p', {}, h('b', {}, 'All tiffins delivered!'))] : [h('div', { class: 'big' }, '🏖'), h('p', {}, 'Everyone is on leave.')];
  if (S.tab === 'delivered') return [h('div', { class: 'big' }, '📦'), h('p', { class: 'muted' }, 'Nothing delivered yet.')];
  return [h('div', { class: 'big' }, '✅'), h('p', { class: 'muted' }, 'Nobody is on leave.')];
}

const avatar = (r) => h('div', { class: 'avatar', style: { background: hue(r.name) } }, (r.name[0] || '?').toUpperCase());
const typeBadge = (r) => h('span', { class: `badge ${r.type}` }, r.type === 'deluxe' ? '✨ Deluxe' : 'Normal');

function rowCard(r, future) {
  const deliver = async (val, btn) => {
    const ok = await act(async () => { S.day = await api('POST', '/api/deliver', { date: S.day.date, customerId: r.id, delivered: val }); S.today = S.day.today; return true; }, val ? `${r.name} ✓` : 'Undone');
    if (ok) refresh();
    else if (btn) btn.disabled = false;
  };
  return h('article', { class: `card row ${r.status}` },
    h('div', { class: 'row-top' }, avatar(r),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, h('strong', {}, r.name), typeBadge(r), r.qty > 1 && h('span', { class: 'qty' }, `×${r.qty}`)),
        r.address && h('div', { class: 'muted addr' }, r.address),
        r.note && h('div', { class: 'note' }, `📝 ${r.note}`),
        r.status === 'leave' && h('div', { class: 'muted' }, `🏖 On leave till ${fmtS(r.leaveUntil)}`),
        r.status === 'delivered' && h('div', { class: 'ok-txt' }, `✓ Delivered at ${time(r.deliveredAt)}`))),
    r.status === 'pending' && h('div', { class: 'row-actions' },
      r.phone && h('a', { class: 'btn sm', href: `tel:${r.phone}`, 'aria-label': `Call ${r.name}` }, '📞 Call'),
      r.address && h('a', { class: 'btn sm', href: mapLink(r.address), target: '_blank', rel: 'noopener' }, '📍 Map'),
      !future && h('button', { class: 'btn ok grow', onclick: (e) => { e.currentTarget.disabled = true; deliver(true, e.currentTarget); } }, 'Delivered ✓')),
    r.status === 'delivered' && h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: (e) => deliver(false, e.currentTarget) }, '↩ Undo')),
  );
}

// ---------- CUSTOMERS ----------
async function loadCustomers() {
  const r = await api('GET', '/api/customers');
  S.customers = r.customers;
  S.today = r.today;
}

function leaveStatus(c) {
  if (c.endDate && c.endDate < S.today) return h('span', { class: 'badge off' }, 'Stopped');
  const now = c.leaves.find((l) => l.from <= S.today && S.today <= l.to);
  if (now) return h('span', { class: 'badge leave' }, `🏖 On leave till ${fmtS(now.to)}`);
  const next = c.leaves.filter((l) => l.from > S.today).sort((a, b) => a.from.localeCompare(b.from))[0];
  return next ? h('span', { class: 'badge leave' }, `📅 Leave ${fmtS(next.from)}`) : null;
}

function renderCustomers() {
  const box = h('div', { class: 'stack', id: 'custlist' });
  const fill = () => {
    const qq = S.q.trim().toLowerCase();
    const items = S.customers.filter((c) => !qq || `${c.name} ${c.phone} ${c.address}`.toLowerCase().includes(qq)).sort((a, b) => a.name.localeCompare(b.name));
    box.replaceChildren(...(items.length ? items.map(custCard) : [h('div', { class: 'card empty' }, h('div', { class: 'big' }, S.customers.length ? '🔍' : '🍽️'), h('p', {}, S.customers.length ? 'No match.' : 'No customers yet. Tap “Add customer” to begin.'))]));
  };
  fill();
  return h('div', { class: 'stack' },
    h('div', { class: 'section-title' }, `${S.customers.length} customer${S.customers.length === 1 ? '' : 's'}`),
    S.customers.length > 6 && h('input', { type: 'search', placeholder: '🔍 Search name, phone or address', value: S.q, oninput: (e) => { S.q = e.target.value; fill(); } }),
    box,
    h('button', { class: 'btn primary fab', onclick: () => openCustomer(null) }, '＋ Add customer'),
    h('div', { style: { height: '56px' } }));
}

function custCard(c) {
  return h('article', { class: 'card cust', onclick: () => openCustomer(c), role: 'button', tabindex: 0, onkeydown: (e) => e.key === 'Enter' && openCustomer(c) },
    avatar(c),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, h('strong', {}, c.name), typeBadge(c), c.qty > 1 && h('span', { class: 'qty' }, `×${c.qty}`)),
      c.phone && h('div', { class: 'muted' }, c.phone),
      c.address && h('div', { class: 'muted addr' }, c.address),
      leaveStatus(c) && h('div', { style: { marginTop: '6px' } }, leaveStatus(c))));
}

function sheet(title, ...body) {
  const dlg = $('#sheet');
  dlg.replaceChildren(
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'sheet-body' }, ...body));
  if (!dlg.open) dlg.showModal();
}
$('#sheet').addEventListener('click', (e) => e.target === e.currentTarget && e.currentTarget.close());
$('#sheet').addEventListener('close', () => { if (current() === 'customers' && S.settings) refresh(true); });

function openCustomer(existing) {
  const c = existing ? structuredClone(existing) : { name: '', phone: '', address: '', type: 'normal', qty: 1, note: '', startDate: S.today, endDate: '', leaves: [] };
  const name = h('input', { type: 'text', value: c.name, placeholder: 'e.g. Ramesh Sharma', autocomplete: 'off', maxLength: 60 });
  const phone = h('input', { type: 'tel', value: c.phone, placeholder: 'Mobile number', inputMode: 'tel', autocomplete: 'off' });
  const address = h('textarea', { rows: 2, placeholder: 'Flat / building / area', maxLength: 200 }, c.address);
  const note = h('input', { type: 'text', value: c.note, placeholder: 'e.g. less spicy, no onion (optional)', maxLength: 200 });
  const start = h('input', { type: 'date', value: c.startDate });
  const end = h('input', { type: 'date', value: c.endDate });
  let qty = c.qty;
  const qtyEl = h('b', {}, qty);
  const step = (n) => () => { qty = Math.min(20, Math.max(1, qty + n)); qtyEl.textContent = qty; };
  const typeInput = (v, label) => h('label', {}, h('input', { type: 'radio', name: 'ctype', value: v, checked: c.type === v }), h('span', {}, label));

  const save = h('button', { class: 'btn primary block', type: 'submit' }, existing ? 'Save changes' : 'Add customer');
  const form = h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      const body = { name: name.value, phone: phone.value, address: address.value, note: note.value, type: form.ctype.value, qty, startDate: start.value, endDate: end.value };
      const r = await act(() => api(existing ? 'PUT' : 'POST', existing ? `/api/customers/${existing.id}` : '/api/customers', body), existing ? 'Saved' : 'Customer added ✓');
      save.disabled = false;
      if (!r) return;
      if (existing) $('#sheet').close();
      else { S.customers.push(r); refresh(); openCustomer(r); } // reopen so the leave link is right there
    },
  },
    h('label', { class: 'field' }, 'Name', name),
    h('label', { class: 'field' }, 'Phone', phone),
    h('label', { class: 'field' }, 'Address', address),
    h('div', { class: 'field' }, h('span', { class: 'muted', style: { fontWeight: 600, fontSize: '14px' } }, 'Tiffin type'), h('div', { class: 'pills' }, typeInput('normal', 'Normal'), typeInput('deluxe', '✨ Deluxe'))),
    h('div', { class: 'field' }, h('span', {}, 'Boxes per day'), h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'icon-btn', onclick: step(-1), 'aria-label': 'Fewer' }, '−'), qtyEl, h('button', { type: 'button', class: 'icon-btn', onclick: step(1), 'aria-label': 'More' }, '＋'))),
    h('label', { class: 'field' }, 'Note for kitchen', note),
    h('details', {}, h('summary', {}, 'More options'), h('div', { class: 'stack' },
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Start date', start), h('label', { class: 'field' }, 'Last day (if stopping)', end)))),
    save);

  const parts = [form];
  if (existing) {
    const leaveBox = h('div', { class: 'card stack' });
    drawLeaves(leaveBox, c);
    const link = custLink(existing);
    const msg = `Hi ${existing.name}, if you need to skip tiffin on any day, please mark your leave here: ${link}`;
    parts.push(
      leaveBox,
      h('div', { class: 'card stack' },
        h('h2', {}, 'Customer’s own leave link'),
        h('p', { class: 'help' }, 'Send this once. The customer can mark their own leave days, and you get a Telegram alert.'),
        existing.phone && h('p', { class: 'help' }, existing.hasAccount ? '✓ Has a login (phone + password).' : `They can also create a login at ${location.origin}/signup using ${existing.phone}.`),
        h('div', { class: 'grid2' },
          existing.phone ? h('a', { class: 'btn ok sm', href: waLink(existing.phone, msg), target: '_blank', rel: 'noopener' }, 'WhatsApp') : h('a', { class: 'btn ok sm', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
          h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { prompt('Copy this link', link); } } }, 'Copy link'))),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm(`Delete ${existing.name} permanently? Their delivery history will be removed too.\n\nTip: use “Last day” under More options to just stop service.`)) return;
        if (await act(() => api('DELETE', `/api/customers/${existing.id}`), 'Deleted')) { $('#sheet').close(); }
      } }, 'Delete customer'));
  }
  sheet(existing ? 'Edit customer' : 'New customer', ...parts);
  if (!existing) name.focus();
}

function drawLeaves(box, c) {
  const from = h('input', { type: 'date', value: S.today });
  const to = h('input', { type: 'date', value: S.today });
  from.addEventListener('change', () => { if (to.value < from.value) to.value = from.value; });
  const live = c.leaves.filter((l) => l.to >= S.today).sort((a, b) => a.from.localeCompare(b.from));
  box.replaceChildren(
    h('h2', {}, '🏖 Leave / holiday'),
    h('p', { class: 'help' }, 'Pick the days this customer does not need tiffin.'),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'From', from), h('label', { class: 'field' }, 'To', to)),
    h('button', { class: 'btn primary', onclick: async () => {
      const r = await act(() => api('POST', `/api/customers/${c.id}/leaves`, { from: from.value, to: to.value }), 'Leave added');
      if (r) { c.leaves = r.leaves; sync(c); drawLeaves(box, c); }
    } }, 'Add leave'),
    live.length ? h('div', { class: 'chiprow' }, live.map((l) => h('span', { class: 'leave-chip' }, `${rangeLabel(l)}${nDays(l) > 1 ? ` · ${nDays(l)} days` : ''}`, h('button', { 'aria-label': 'Remove leave', onclick: async () => {
      const r = await act(() => api('DELETE', `/api/customers/${c.id}/leaves/${l.id}`), 'Leave removed');
      if (r) { c.leaves = r.leaves; sync(c); drawLeaves(box, c); }
    } }, '✕')))) : h('p', { class: 'muted' }, 'No upcoming leave.'));
}
const sync = (c) => { const i = S.customers.findIndex((x) => x.id === c.id); if (i >= 0) S.customers[i] = { ...S.customers[i], leaves: c.leaves }; };

// ---------- REPORTS ----------
async function loadReport() {
  S.report = await api('GET', `/api/report${S.month ? `?month=${S.month}` : ''}`);
  S.today = S.report.today;
  S.month = S.report.month;
}

function renderReport() {
  const r = S.report, t = r.totals;
  const priced = S.settings.prices.normal > 0 || S.settings.prices.deluxe > 0;
  const go = (n) => { S.month = addMonth(S.month, n); refresh(true); };
  const max = Math.max(1, ...r.daily.map((d) => d.boxes));
  const csv = () => {
    const rows = [['Name', 'Type', 'Boxes per day', 'Days delivered', 'Boxes delivered', 'Leave days', 'Not delivered', ...(priced ? ['Amount'] : [])],
      ...r.customers.map((c) => [c.name, c.type, c.qty, c.delivered, c.boxes, c.leave, c.missed, ...(priced ? [c.amount] : [])])];
    const text = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: `tiffin-${r.month}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));

  return h('div', { class: 'stack' },
    h('div', { class: 'datebar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(-1) }, '‹'),
      h('div', { class: 'datebar-mid' }, h('strong', {}, monthName(r.month))),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(1) }, '›')),
    h('div', { class: 'stats' }, stat(t.boxes, 'Boxes delivered'), priced ? stat(money(t.amount), 'Amount') : stat(t.delivered, 'Deliveries'), stat(t.leave, 'Leave days'), stat(t.missed, 'Not delivered')),
    h('div', { class: 'card' },
      h('h2', {}, 'Boxes delivered per day'),
      h('div', { class: 'bars' }, r.daily.map((d) => h('div', { class: `${d.boxes ? '' : 'zero'} ${d.date === r.today ? 'today' : ''}`, title: `${fmtS(d.date)}: ${d.boxes}`, style: { height: `${d.boxes ? Math.max(6, (d.boxes / max) * 100) : 3}%` } }))),
      h('div', { class: 'axis' }, h('span', {}, '1'), h('span', {}, String(r.daily.length)))),
    r.customers.length ? h('div', { class: 'section-title' }, 'By customer') : null,
    r.customers.length ? r.customers.map((c) => h('article', { class: 'card rep' },
      h('div', { class: 'rep-head' }, h('div', { class: 'row-title' }, h('strong', {}, c.name), typeBadge(c)), priced && h('b', {}, money(c.amount))),
      h('div', { class: 'rep-nums' }, h('div', {}, h('b', {}, c.delivered), h('span', {}, 'Delivered')), h('div', {}, h('b', {}, c.leave), h('span', {}, 'On leave')), h('div', { class: c.missed ? 'miss' : '' }, h('b', {}, c.missed), h('span', {}, 'Missed'))),
      c.phone && h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: waLink(c.phone, `Hi ${c.name}, tiffin summary for ${monthName(r.month)}: ${c.delivered} days delivered${c.leave ? `, ${c.leave} days leave` : ''}${priced ? `. Amount: ${money(c.amount)}` : ''}. Thank you! – ${S.settings.businessName}`) }, '💬 Send summary on WhatsApp')))
      : h('div', { class: 'card empty' }, h('div', { class: 'big' }, '📊'), h('p', { class: 'muted' }, 'No deliveries recorded this month yet.')),
    r.customers.length > 0 && h('button', { class: 'btn', onclick: csv }, '⬇ Download as spreadsheet (CSV)'),
    r.customers.length > 0 && priced && h('p', { class: 'help' }, 'Amounts use your current prices from Settings.'));
}

// ---------- SETTINGS ----------
async function loadSettings() {
  S.settings = await api('GET', '/api/settings');
}

function renderSettings() {
  const s = S.settings, tg = s.telegram;
  const f = {
    businessName: h('input', { type: 'text', value: s.businessName, maxLength: 60 }),
    businessPhone: h('input', { type: 'tel', value: s.businessPhone, placeholder: 'Shown to customers', inputMode: 'tel' }),
    normal: h('input', { type: 'number', value: s.prices.normal, min: 0, inputMode: 'numeric' }),
    deluxe: h('input', { type: 'number', value: s.prices.deluxe, min: 0, inputMode: 'numeric' }),
    currency: h('input', { type: 'text', value: s.currency, maxLength: 4 }),
    countryCode: h('input', { type: 'tel', value: s.countryCode, maxLength: 4, inputMode: 'numeric' }),
    morningTime: h('input', { type: 'time', value: s.morningTime }),
    eveningTime: h('input', { type: 'time', value: s.eveningTime }),
    cutoffHour: h('select', {}, [[0, 'Not allowed — from tomorrow only']].concat([6, 7, 8, 9, 10, 11, 12].map((n) => [n, `Until ${n > 12 ? n - 12 : n}:00 ${n >= 12 ? 'pm' : 'am'}`])).map(([v, l]) => h('option', { value: v, selected: v === s.cutoffHour }, l))),
  };
  const closed = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => h('label', {}, h('input', { type: 'checkbox', value: i, checked: s.closedDays.includes(i) }), h('span', { title: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] }, l)));
  const save = h('button', { class: 'btn primary block', type: 'submit' }, 'Save settings');

  const tgBlock = !tg.configured
    ? h('div', { class: 'help' }, h('p', {}, 'Telegram alerts are not switched on yet. Whoever installed this app needs to add the bot token on the server. Steps are in the README file (takes about 5 minutes).'))
    : h('div', { class: 'stack' },
        h('div', { class: 'status' }, h('span', { class: `dot ${tg.linked ? 'on' : ''}` }), tg.linked ? 'Connected to your Telegram' : 'Not connected yet'),
        !tg.linked && h('div', { class: 'help' }, 'Connect in 3 steps:', h('ol', {}, h('li', {}, 'Open Telegram and search for ', h('b', {}, `@${tg.bot}`)), h('li', {}, 'Tap Start, then send: ', h('code', {}, `/start ${tg.code}`)), h('li', {}, 'Come back here and refresh this page'))),
        tg.linked && h('div', { class: 'grid2' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => act(() => api('POST', '/api/telegram/test'), 'Test message sent') }, 'Send test'),
          h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { if (confirm('Disconnect Telegram alerts?')) { S.settings = (await act(() => api('POST', '/api/telegram/unlink'))) || S.settings; refresh(); } } }, 'Disconnect')),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Morning summary', f.morningTime), h('label', { class: 'field' }, 'Evening: tomorrow', f.eveningTime)),
        h('p', { class: 'help' }, 'You also get an instant alert whenever a customer marks leave. Clear a time to turn that summary off.'));

  return h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      const r = await act(() => api('PUT', '/api/settings', {
        businessName: f.businessName.value, businessPhone: f.businessPhone.value, currency: f.currency.value, countryCode: f.countryCode.value,
        prices: { normal: f.normal.value, deluxe: f.deluxe.value }, closedDays: closed.map((l) => l.firstChild).filter((i) => i.checked).map((i) => Number(i.value)),
        cutoffHour: f.cutoffHour.value, morningTime: f.morningTime.value, eveningTime: f.eveningTime.value,
      }), 'Settings saved ✓');
      save.disabled = false;
      if (r) { S.settings = r; $('#biz').textContent = r.businessName; }
    },
  },
    h('div', { class: 'card stack' }, h('h2', {}, 'Your business'),
      h('label', { class: 'field' }, 'Business name', f.businessName), h('label', { class: 'field' }, 'Your phone', f.businessPhone)),
    h('div', { class: 'card stack' }, h('h2', {}, 'Price per box'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Normal', f.normal), h('label', { class: 'field' }, '✨ Deluxe', f.deluxe)),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Currency', f.currency), h('label', { class: 'field' }, 'Country code', f.countryCode)),
      h('p', { class: 'help' }, 'Used for monthly amounts. Leave 0 if you do not want amounts shown. Country code is used to open WhatsApp.')),
    h('div', { class: 'card stack' }, h('h2', {}, 'Days you are closed'), h('div', { class: 'days' }, closed), h('p', { class: 'help' }, 'No tiffin is counted on these days (for example Sunday).')),
    h('div', { class: 'card stack' }, h('h2', {}, 'Customer leave'),
      h('label', { class: 'field' }, 'Customers can cancel today’s tiffin', f.cutoffHour),
      h('p', { class: 'help' }, 'Customers can always mark leave from tomorrow onwards using their personal link.')),
    h('div', { class: 'card stack' }, h('h2', {}, '✈️ Telegram alerts'), tgBlock),
    save,
    passwordCard(),
    h('button', { type: 'button', class: 'btn', onclick: async () => { await act(() => api('POST', '/api/logout')); location.href = '/'; } }, 'Log out'));
}

function passwordCard() {
  const oldP = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newP = h('input', { type: 'password', autocomplete: 'new-password', minLength: 6, required: true });
  const form = h('div', { class: 'stack' },
    h('label', { class: 'field' }, 'Current password', oldP),
    h('label', { class: 'field' }, 'New password (6+ characters)', newP),
    h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (await act(() => api('POST', '/api/password', { oldPassword: oldP.value, newPassword: newP.value }), 'Password changed. Other devices were logged out.')) { oldP.value = ''; newP.value = ''; }
    } }, 'Change password'));
  return h('details', { class: 'card' }, h('summary', {}, 'Change password'), form);
}

// ---------- boot ----------
async function boot() {
  const { user } = await fetch('/api/me').then((r) => r.json());
  if (!user) return location.replace('/login');
  if (user.role !== 'provider') return location.replace('/me');
  S.settings = await api('GET', '/api/settings');
  S.day = null;
  buildShell();
  if (!location.hash) history.replaceState(null, '', '#/today'); // no hashchange event, so only one render
  await render();
  updateBadge();
}
boot().catch((e) => e.message !== 'login' && $('#root').replaceChildren(h('div', { class: 'card empty' }, h('p', {}, 'Could not reach the server.'), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'))));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
