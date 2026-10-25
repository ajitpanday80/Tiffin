'use strict';
// Customer-facing page: opened from a personal link, lets a customer mark / cancel their own leave.

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
const fmtS = (s) => pd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const nDays = (l) => Math.round((pd(l.to) - pd(l.from)) / 864e5) + 1;

const token = location.pathname.split('/')[2];
let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3000);
}

async function api(method, path, body) {
  const r = await fetch(`/api/c/${encodeURIComponent(token)}${path}`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: r.status });
  return data;
}

function draw(v) {
  document.title = `${v.businessName} – tiffin leave`;
  const from = h('input', { type: 'date', value: v.minDate, min: v.minDate, required: true });
  const to = h('input', { type: 'date', value: v.minDate, min: v.minDate, required: true });
  from.addEventListener('change', () => { if (to.value < from.value) to.value = from.value; to.min = from.value; });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Mark my leave');

  const form = h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        draw(await api('POST', '/leaves', { from: from.value, to: to.value }));
        toast('Done! Your tiffin provider has been told ✓');
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    },
  },
    h('h2', {}, 'Going on leave?'),
    h('p', { class: 'help' }, 'Pick the first and last day you do not need tiffin.'),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'From', from), h('label', { class: 'field' }, 'To', to)),
    btn);

  const list = h('div', { class: 'card stack' },
    h('h2', {}, 'Your leaves'),
    v.leaves.length
      ? v.leaves.map((l) => h('div', { class: 'row-top', style: { alignItems: 'center' } },
          h('div', { class: 'row-main' }, h('strong', {}, l.from === l.to ? fmtS(l.from) : `${fmtS(l.from)} → ${fmtS(l.to)}`), h('div', { class: 'muted' }, `${nDays(l)} day${nDays(l) > 1 ? 's' : ''}`)),
          l.to < v.minDate ? null : h('button', { class: 'btn sm danger', onclick: (e) => ask(e.currentTarget, 'Cancel this leave?', async () => {
            try { draw(await api('DELETE', `/leaves/${l.id}`)); toast('Leave cancelled'); } catch (err) { toast(err.message, true); }
          }, 'Yes, cancel') }, 'Cancel')))
      : h('p', { class: 'muted' }, 'No leave marked.'));

  $('#root').replaceChildren(h('main', { class: 'stack', style: { paddingTop: '28px' } },
    h('div', { style: { textAlign: 'center' } },
      h('img', { class: 'logo', src: '/icon.svg', alt: '', style: { width: '56px', height: '56px', borderRadius: '16px' } }),
      h('h1', { style: { fontSize: '22px', marginTop: '10px' } }, v.businessName),
      h('p', { class: 'muted' }, `Hi ${v.name}! Your plan: `, h('b', {}, v.type === 'deluxe' ? '✨ Deluxe' : 'Normal'), v.qty > 1 ? ` × ${v.qty}` : '')),
    form, list,
    v.businessPhone && h('a', { class: 'btn block', href: `tel:${v.businessPhone}` }, `📞 Call ${v.businessName}`),
    h('p', { class: 'help', style: { textAlign: 'center' } }, 'To change something that has already started, please call.'),
    h('p', { class: 'help', style: { textAlign: 'center' } }, 'Want to log in with your phone number? ', h('a', { href: '/signup?role=customer' }, 'Create a login'))));
}

api('GET', '')
  .then(draw)
  .catch((e) => {
    $('#root').replaceChildren(h('main', { class: 'stack', style: { paddingTop: '60px', textAlign: 'center' } },
      h('div', { style: { fontSize: '48px' } }, '🔗'), h('h1', {}, 'Link not working'), h('p', { class: 'muted' }, e.status === 404 ? 'This link is not valid any more. Please ask your tiffin provider for a new one.' : 'Could not load. Please check your internet and try again.')));
  });
