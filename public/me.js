'use strict';
// Logged-in customer portal: see today's status and mark / cancel leave for each tiffin service.

const $ = (s) => document.querySelector(s);
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
const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (s) => pd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const nDays = (l) => Math.round((pd(l.to) - pd(l.from)) / 864e5) + 1;
let timer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(timer);
  timer = setTimeout(() => (t.className = 'toast'), 3000);
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  if (r.status === 401 || r.status === 403) { location.href = '/login?role=customer'; throw new Error('login'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const STATUS = {
  delivered: ['✅', 'Delivered today', 'ok-txt'],
  pending: ['🍱', 'Today’s tiffin is being prepared', 'muted'],
  leave: ['🏖', 'You are on leave today', 'muted'],
  none: ['🌴', 'No tiffin scheduled today', 'muted'],
};

let data;
function subCard(sub) {
  const from = h('input', { type: 'date', value: sub.minDate, min: sub.minDate, required: true });
  const to = h('input', { type: 'date', value: sub.minDate, min: sub.minDate, required: true });
  from.addEventListener('change', () => { if (to.value < from.value) to.value = from.value; to.min = from.value; });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Mark my leave');
  const replace = (r) => { Object.assign(sub, r); draw(); };
  const [icon, label, cls] = STATUS[sub.status];

  return h('article', { class: 'card stack' },
    h('div', { class: 'row-top' },
      h('div', { class: 'avatar', style: { background: '#e8590c' } }, (sub.businessName[0] || 'T').toUpperCase()),
      h('div', { class: 'row-main' }, h('strong', { style: { fontSize: '18px' } }, sub.businessName),
        h('div', { class: 'muted' }, h('span', { class: `badge ${sub.type}` }, sub.type === 'deluxe' ? '✨ Deluxe' : 'Normal'), sub.qty > 1 ? ` × ${sub.qty}` : ''))),
    h('div', { class: `row-main ${cls}`, style: { fontWeight: 700 } }, `${icon} ${label}`),
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try { replace(await api('POST', `/api/my/${sub.tid}/${sub.cid}/leaves`, { from: from.value, to: to.value })); toast('Done! Your tiffin provider has been told ✓'); } catch (err) { if (err.message !== 'login') toast(err.message, true); btn.disabled = false; }
      },
    }, h('h2', { style: { margin: 0 } }, 'Going on leave?'), h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'From', from), h('label', { class: 'field' }, 'To', to)), btn),
    sub.leaves.length > 0 && h('div', { class: 'stack' }, h('h2', { style: { margin: 0 } }, 'Your leaves'),
      sub.leaves.map((l) => h('div', { class: 'row-top', style: { alignItems: 'center' } },
        h('div', { class: 'row-main' }, h('strong', {}, l.from === l.to ? fmt(l.from) : `${fmt(l.from)} → ${fmt(l.to)}`), h('div', { class: 'muted' }, `${nDays(l)} day${nDays(l) > 1 ? 's' : ''}`)),
        l.to < sub.minDate ? null : h('button', { class: 'btn sm danger', onclick: async (e) => {
          if (!confirm('Cancel this leave?')) return;
          e.currentTarget.disabled = true;
          try { replace(await api('DELETE', `/api/my/${sub.tid}/${sub.cid}/leaves/${l.id}`)); toast('Leave cancelled'); } catch (err) { if (err.message !== 'login') toast(err.message, true); e.currentTarget.disabled = false; }
        } }, 'Cancel')))),
    sub.businessPhone && h('a', { class: 'btn block', href: `tel:${sub.businessPhone}` }, `📞 Call ${sub.businessName}`));
}

function passwordCard() {
  const oldP = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newP = h('input', { type: 'password', autocomplete: 'new-password', minLength: 6, required: true });
  return h('details', { class: 'card' }, h('summary', {}, 'Change password'),
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/password', { oldPassword: oldP.value, newPassword: newP.value }); toast('Password changed'); e.target.reset(); } catch (err) { if (err.message !== 'login') toast(err.message, true); }
      },
    }, h('label', { class: 'field' }, 'Current password', oldP), h('label', { class: 'field' }, 'New password', newP), h('button', { class: 'btn', type: 'submit' }, 'Save password')));
}

function draw() {
  $('#root').replaceChildren(
    h('header', { class: 'top' }, h('img', { class: 'logo', src: '/icon.svg', alt: '' }), h('h1', {}, 'My tiffin'),
      h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; } }, 'Log out')),
    h('main', { class: 'stack' },
      h('p', {}, 'Hi ', h('b', {}, data.name), '! 👋'),
      data.subscriptions.length ? data.subscriptions.map(subCard) : h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🍽'), h('p', {}, 'No tiffin service found for your number right now. Please ask your provider to check it.')),
      passwordCard(),
      h('p', { class: 'help', style: { textAlign: 'center' } }, 'For anything urgent or same-day, please call your provider.'),
      h('p', { class: 'help', style: { textAlign: 'center' } }, h('a', { href: '/find' }, 'Find another tiffin service'), ' · ', h('a', { href: '/help#customers' }, 'Help'))));
}

api('GET', '/api/my').then((d) => { data = d; draw(); }).catch((e) => { if (e.message !== 'login') $('#root').replaceChildren(h('main', {}, h('div', { class: 'card empty' }, h('p', {}, e.message)))); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
