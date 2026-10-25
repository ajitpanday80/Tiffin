'use strict';
// Public marketplace: find tiffin services near a location / pincode / address.

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
  timer = setTimeout(() => (t.className = 'toast'), 3500);
}
const post = (url, body, keepalive) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive });

let lastQuery = '';
let me = null;

function waLink(r) {
  let p = r.phone.replace(/[^\d+]/g, '');
  p = p.startsWith('+') ? p.slice(1) : p.replace(/^0+/, '');
  if (p.length <= 10) p = r.countryCode + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(`Hi ${r.name}, I found you on MyTiffin. Do you deliver to my area?`)}`;
}

function resultCard(r) {
  const click = (type) => post(`/api/market/${r.id}/click`, { type }, true).catch(() => {});
  const price = [r.priceFrom.normal && `Normal ${r.priceFrom.currency}${r.priceFrom.normal}`, r.priceFrom.deluxe && `✨ Deluxe ${r.priceFrom.currency}${r.priceFrom.deluxe}`].filter(Boolean).join(' · ');
  const about = r.about ? h('p', { hidden: true, class: 'muted' }, r.about) : null;
  const more = about && h('button', { class: 'more-btn', type: 'button', onclick: (e) => { about.hidden = !about.hidden; e.currentTarget.textContent = about.hidden ? 'About ▾' : 'Hide ▴'; if (!about.hidden) click('view'); } }, 'About ▾');
  return h('article', { class: `rcard${r.sponsored ? ' sp' : ''}` },
    r.sponsored && h('span', { class: 'spon' }, 'Sponsored'),
    h('h3', {}, r.name),
    r.tagline && h('p', {}, r.tagline),
    h('div', { class: 'rmeta' },
      h('span', {}, `📍 ${[r.area, r.city].filter(Boolean).join(', ') || r.pincode}`),
      r.distanceKm != null && h('span', {}, `~${r.distanceKm} km away`),
      r.match === 'pincode' && r.distanceKm == null && h('span', {}, `Delivers to ${r.pincode}`),
      r.match === 'area' && h('span', {}, 'Nearby area')),
    (r.tags.length > 0 || r.meals.length > 0) && h('div', { class: 'tagrow' }, r.meals.map((m) => h('span', { class: 'tag meal' }, m)), r.tags.map((t) => h('span', { class: 'tag' }, t))),
    price && h('div', { class: 'price' }, `From: ${price}`),
    more, about,
    h('div', { class: 'ractions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => openEnquiry(r) }, 'Request to join'),
      r.phone && h('a', { class: 'btn', href: waLink(r), target: '_blank', rel: 'noopener', onclick: () => click('whatsapp') }, 'WhatsApp'),
      r.phone && h('a', { class: 'btn', href: `tel:${r.phone}`, onclick: () => click('call') }, '📞 Call')));
}

function show(data, q) {
  const out = $('#out');
  const n = data.results.length;
  if (!n) {
    out.replaceChildren(h('div', { class: 'empty-box card' }, h('div', { class: 'big' }, '🍽'), h('h2', {}, 'No tiffin service listed here yet'),
      h('p', { class: 'muted' }, 'Nobody delivers to this spot on our list right now. Try a nearby pincode, or ask a tiffin service near you to list their kitchen.'),
      h('a', { class: 'btn primary', href: '/signup' }, 'I run a tiffin service')));
    return;
  }
  out.replaceChildren(
    ...[
      h('div', { class: 'res-head' }, h('h2', {}, `${n} tiffin service${n === 1 ? '' : 's'} near ${data.label && data.label !== 'your location' ? data.label : data.mode === 'pincode' ? data.pin : 'you'}`)),
      data.mode === 'pincode' && h('p', { class: 'note-area' }, 'We could not work out exact distances, so these are services that deliver to your pincode or nearby ones.'),
      data.results.map(resultCard),
    ].flat().filter(Boolean));
  window.scrollTo({ top: $('.results').offsetTop - 80, behavior: 'smooth' });
}

async function run(params, label) {
  const out = $('#out');
  out.replaceChildren(h('p', { class: 'muted', style: { textAlign: 'center', padding: '30px' } }, 'Searching…'));
  try {
    const r = await fetch(`/api/market/search?${new URLSearchParams(params)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');
    show(data, label);
  } catch (e) {
    out.replaceChildren(h('p', { class: 'note-area' }, e.message));
  }
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return $('#q').focus();
  lastQuery = q;
  history.replaceState(null, '', `/find?q=${encodeURIComponent(q)}`);
  try { localStorage.setItem('tiffin_last_q', q); } catch { /* private mode */ }
  run({ q }, q);
});

$('#geo').addEventListener('click', (e) => {
  if (!navigator.geolocation) return toast('Your browser cannot share location. Please type your pincode.', true);
  e.currentTarget.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => { $('#geo').disabled = false; lastQuery = ''; history.replaceState(null, '', '/find'); run({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'you'); },
    (err) => { $('#geo').disabled = false; toast(err.code === 1 ? 'Location is blocked. Please type your pincode instead.' : 'Could not get your location. Please type your pincode.', true); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});

function openEnquiry(r) {
  const dlg = $('#sheet');
  const name = h('input', { type: 'text', value: me?.name || '', maxLength: 60, autocomplete: 'name', required: true });
  const phone = h('input', { type: 'tel', value: me?.phone || '', inputMode: 'tel', autocomplete: 'tel', required: true });
  const address = h('textarea', { rows: 2, maxLength: 200, placeholder: 'Flat / building / area' }, /\d{6}|[a-z]/i.test(lastQuery) ? lastQuery : '');
  const note = h('input', { type: 'text', maxLength: 200, placeholder: 'e.g. veg only (optional)' });
  const type = (v, l, on) => h('label', {}, h('input', { type: 'radio', name: 't', value: v, checked: on }), h('span', {}, l));
  const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Send request');
  const form = h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const res = await post(`/api/market/${r.id}/enquire`, { name: name.value, phone: phone.value, address: address.value, note: note.value, type: form.t.value });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Could not send');
        dlg.replaceChildren(h('div', { class: 'sheet-head' }, h('h2', {}, 'Request sent ✓'), h('button', { class: 'icon-btn', onclick: () => dlg.close(), 'aria-label': 'Close' }, '✕')),
          h('div', { class: 'sheet-body' }, h('p', {}, `${r.name} will contact you on ${phone.value}.`), h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Done')));
      } catch (err) { toast(err.message, true); go.disabled = false; }
    },
  },
    h('p', { class: 'muted' }, `Your details go only to ${r.name}.`),
    h('label', { class: 'field' }, 'Your name', name), h('label', { class: 'field' }, 'Phone number', phone),
    h('label', { class: 'field' }, 'Delivery address', address),
    h('div', { class: 'pills' }, type('normal', 'Normal', true), type('deluxe', '✨ Deluxe', false)),
    h('label', { class: 'field' }, 'Note', note), go);
  dlg.replaceChildren(h('div', { class: 'sheet-head' }, h('h2', {}, `Join ${r.name}`), h('button', { class: 'icon-btn', onclick: () => dlg.close(), 'aria-label': 'Close' }, '✕')), h('div', { class: 'sheet-body' }, form));
  dlg.showModal();
}
$('#sheet').addEventListener('click', (e) => e.target === e.currentTarget && e.currentTarget.close());

fetch('/api/me').then((r) => r.json()).then(({ user }) => {
  if (!user) return;
  if (user.role === 'customer') me = user;
  const box = $('#navcta');
  const a = h('a', { class: 'btn primary sm', href: user.role === 'provider' ? '/app' : user.role === 'admin' ? '/admin' : '/me' }, user.role === 'provider' ? 'My kitchen' : user.role === 'admin' ? 'Admin' : 'My tiffin');
  box.replaceChildren(a);
}).catch(() => {});

const qs = new URLSearchParams(location.search).get('q');
let saved = '';
try { saved = localStorage.getItem('tiffin_last_q') || ''; } catch { /* ignore */ }
if (qs || saved) $('#q').value = qs || saved;
if (qs) { lastQuery = qs; run({ q: qs }, qs); }
