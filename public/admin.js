'use strict';
// Platform admin: confirm ad payments, manage ad plans, moderate listings.

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
  if (r.status === 401 || r.status === 403) { location.href = '/login?role=admin'; throw new Error('login'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
const date = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
let data;
let tab = 'orders';
const act = async (fn, ok) => { try { data = await fn(); if (ok) toast(ok); draw(); } catch (e) { if (e.message !== 'login') toast(e.message, true); } };

function ordersView() {
  const money = (n) => `${data.currency}${Number(n).toLocaleString('en-IN')}`;
  if (!data.orders.length) return h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🧾'), h('p', { class: 'muted' }, 'No ad orders yet.'));
  return data.orders.map((o) => h('div', { class: 'card stack' },
    h('div', { class: 'rowline' }, h('b', {}, o.provider), h('span', { class: `st ${o.status}` }, o.status)),
    h('div', { class: 'muted' }, `${o.planName} · ${o.days} days · ${o.radiusKm} km · ${money(o.price)} · ref ${o.ref}`),
    h('div', { class: 'muted' }, `Ordered ${date(o.createdAt)}${o.phone ? ` · ${o.phone}` : ''}${o.endsAt ? ` · runs ${date(o.startsAt)} → ${date(o.endsAt)}` : ''}`),
    o.status === 'pending' && h('div', { class: 'grid2' },
      h('button', { class: 'btn ok sm', onclick: (e) => ask(e.currentTarget, `Payment of ${money(o.price)} for ${o.provider} received?`, () => act(() => api('POST', `/api/admin/orders/${o.id}/paid`), 'Ad activated'), 'Yes, received') }, 'Payment received'),
      h('button', { class: 'btn sm danger', onclick: () => act(() => api('POST', `/api/admin/orders/${o.id}/reject`), 'Rejected') }, 'Reject'))));
}

function plansView() {
  const f = { name: h('input', { type: 'text', placeholder: 'e.g. Local boost', maxLength: 40 }), days: h('input', { type: 'number', value: 30, min: 1, max: 365 }), radius: h('input', { type: 'number', value: 3, min: 1, max: 25 }), price: h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Price' }) };
  return [
    h('div', { class: 'card stack' }, h('h2', {}, 'Ad plans'),
      h('p', { class: 'help' }, 'Providers choose from these. “Radius” is how far from the kitchen the ad is shown, so an ad only ever reaches nearby customers. You set the prices; there are no defaults.'),
      data.plans.length ? data.plans.map((p) => h('div', { class: 'plan' }, h('div', {}, h('b', {}, p.name), h('div', { class: 'muted' }, `${p.days} days · ${p.radiusKm} km`)),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'price-big' }, `${data.currency}${p.price}`), h('button', { class: 'btn sm danger', onclick: (e) => ask(e.currentTarget, 'Delete this plan? Existing orders are not affected.', () => act(() => api('DELETE', `/api/admin/plans/${p.id}`)), 'Delete') }, 'Delete')))) : h('p', { class: 'muted' }, 'No plans yet. Add one below.')),
    h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); act(() => api('POST', '/api/admin/plans', { name: f.name.value, days: f.days.value, radiusKm: f.radius.value, price: f.price.value }), 'Plan added'); } },
      h('h2', {}, 'Add a plan'), h('label', { class: 'field' }, 'Name', f.name),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Days', f.days), h('label', { class: 'field' }, 'Radius (km)', f.radius)),
      h('label', { class: 'field' }, `Price (${data.currency})`, f.price), h('button', { class: 'btn primary', type: 'submit' }, 'Add plan'))];
}

function providersView() {
  return data.listings.map((l) => h('div', { class: 'card stack' },
    h('div', { class: 'rowline' }, h('b', {}, l.name), h('span', { class: `st ${l.suspended ? 'rejected' : l.enabled ? 'paid' : 'pending'}` }, l.suspended ? 'suspended' : l.enabled ? 'listed' : 'not listed')),
    h('div', { class: 'muted' }, `${[l.area, l.city, l.pincode].filter(Boolean).join(', ') || 'No area'} · ${l.customers} customers${l.phone ? ` · ${l.phone}` : ''}${l.located ? '' : ' · no location'}`),
    h('div', { class: 'muted' }, `30 days: shown ${l.stats.imp}, sponsored ${l.stats.spImp}, join requests ${l.stats.enquiry}${l.adUntil ? ` · ad until ${date(l.adUntil)}` : ''}`),
    h('button', { class: `btn sm ${l.suspended ? '' : 'danger'}`, onclick: () => act(() => api('POST', `/api/admin/listings/${l.tid}/suspend`, { suspended: !l.suspended }), l.suspended ? 'Restored' : 'Suspended') }, l.suspended ? 'Restore listing' : 'Suspend listing')));
}

function resetView() {
  const role = pick([['provider', 'Tiffin provider'], ['customer', 'Customer']], 'provider');
  const phone = h('input', { type: 'tel', id: 'rphone', placeholder: 'Their phone number', inputMode: 'tel' });
  const out = h('div', { class: 'stack' });
  return h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/admin/reset-link', { role: role.value, phone: phone.value });
      const link = h('input', { type: 'text', readOnly: true, value: r.link, onclick: (ev) => ev.target.select() });
      out.replaceChildren(h('p', { class: 'help' }, `One-time link for ${r.name} (${r.role}). It works once and expires in 1 hour. Send it only to that person.`), link,
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(r.link); toast('Copied'); } catch { link.select(); } } }, 'Copy link'));
    } catch (err) { out.replaceChildren(); if (err.message !== 'login') toast(err.message, true); }
  } },
  h('h2', {}, 'Reset a login'), h('p', { class: 'help' }, 'Make sure you are really talking to the account owner first (a phone call, or a Telegram chat from the number on the account).'),
  h('div', { class: 'field' }, 'Account type', role), h('label', { class: 'field' }, 'Phone', phone), h('button', { class: 'btn primary', type: 'submit' }, 'Create reset link'), out);
}

function settingsView() {
  const pay = h('textarea', { rows: 4, maxLength: 500, placeholder: 'e.g. Pay by UPI to yourname@bank, then we activate your ad within a day.' }, data.payInstructions);
  const cur = h('input', { type: 'text', value: data.currency, maxLength: 4 });
  const sup = h('textarea', { rows: 2, maxLength: 300, id: 'support', placeholder: 'e.g. Telegram @yourhandle or phone +91 98xxxxxx' }, data.support || '');
  return h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); act(() => api('PUT', '/api/admin/platform', { payInstructions: pay.value, currency: cur.value, support: sup.value }), 'Saved'); } },
    h('h2', {}, 'Payment'), h('p', { class: 'help' }, 'Shown to a provider when they order an ad. Payments are collected outside the app; you confirm them under Orders.'),
    h('label', { class: 'field' }, 'How to pay', pay), h('label', { class: 'field' }, 'Currency symbol', cur),
    h('label', { class: 'field' }, 'Support contact (shown on the forgot-password page)', sup), h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}

function draw() {
  const pend = data.orders.filter((o) => o.status === 'pending').length;
  const tabs = [['orders', `Orders${pend ? ` (${pend})` : ''}`], ['plans', 'Plans'], ['providers', 'Providers'], ['reset', 'Reset login'], ['settings', 'Payment & support']];
  const view = { orders: ordersView, plans: plansView, providers: providersView, reset: resetView, settings: settingsView }[tab]();
  $('#root').replaceChildren(h('div', { class: 'seg' }, tabs.map(([id, l]) => h('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; draw(); } }, l))), ...[view].flat());
}

$('#out').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.href = '/'; });
api('GET', '/api/admin/overview').then((d) => { data = d; draw(); }).catch(() => {});
