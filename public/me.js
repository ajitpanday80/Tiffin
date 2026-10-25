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
const errToast = (err) => { if (err.message !== 'login') toast(err.message, true); };
const rangeText = (l) => (l.from === l.to ? fmt(l.from) : `${fmt(l.from)} → ${fmt(l.to)}`);

// one active tiffin service: status, leave, and the customer's own controls (stop / undo)
function subCard(sub) {
  const from = h('input', { type: 'date', value: sub.minDate, min: sub.minDate, required: true });
  const to = h('input', { type: 'date', value: sub.minDate, min: sub.minDate, required: true });
  from.addEventListener('change', () => { if (to.value < from.value) to.value = from.value; to.min = from.value; });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Mark my leave');
  const replace = (r) => { Object.assign(sub, r); draw(); };
  const [icon, label, cls] = STATUS[sub.status];
  const stopDate = h('input', { type: 'date', value: sub.stopMin, min: sub.stopMin, required: true });

  return h('article', { class: 'card stack' },
    h('div', { class: 'row-top' },
      h('div', { class: 'avatar', style: { background: '#e8590c' } }, (sub.businessName[0] || 'T').toUpperCase()),
      h('div', { class: 'row-main' }, h('strong', { style: { fontSize: '18px' } }, sub.businessName),
        h('div', { class: 'muted' }, h('span', { class: `badge ${sub.type}` }, sub.type === 'deluxe' ? '✨ Deluxe' : 'Normal'), sub.qty > 1 ? ` × ${sub.qty}` : ''),
        sub.addedAt && h('div', { class: 'muted small' }, `Added by this provider on ${new Date(sub.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`))),
    sub.stopping
      ? h('div', { class: 'note-area' }, sub.endedBy === 'customer'
          ? ['You will stop after ', h('b', {}, fmt(sub.endDate)), '. ', h('button', { class: 'link-btn', type: 'button', onclick: async () => { try { replace(await api('POST', `/api/my/${sub.tid}/${sub.cid}/resume`)); toast('Welcome back! Your provider has been told.'); } catch (err) { errToast(err); } } }, 'Undo')]
          : ['This service ends on ', h('b', {}, fmt(sub.endDate)), ' (set by your provider).'])
      : null,
    h('div', { class: `row-main ${cls}`, style: { fontWeight: 700 } }, `${icon} ${label}`),
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try { replace(await api('POST', `/api/my/${sub.tid}/${sub.cid}/leaves`, { from: from.value, to: to.value })); toast('Done! Your tiffin provider has been told ✓'); } catch (err) { errToast(err); btn.disabled = false; }
      },
    }, h('h2', { style: { margin: 0 } }, 'Going on leave?'), h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'From', from), h('label', { class: 'field' }, 'To', to)), btn),
    sub.leaves.length > 0 && h('div', { class: 'stack' }, h('h2', { style: { margin: 0 } }, 'Your leaves'),
      sub.leaves.map((l) => h('div', { class: 'row-top', style: { alignItems: 'center' } },
        h('div', { class: 'row-main' }, h('strong', {}, rangeText(l)), h('div', { class: 'muted' }, `${nDays(l)} day${nDays(l) > 1 ? 's' : ''}`)),
        l.to < sub.minDate ? null : h('button', { class: 'btn sm danger', onclick: (e) => ask(e.currentTarget, 'Cancel this leave?', async () => {
          try { replace(await api('DELETE', `/api/my/${sub.tid}/${sub.cid}/leaves/${l.id}`)); toast('Leave cancelled'); } catch (err) { errToast(err); }
        }, 'Yes, cancel') }, 'Cancel')))),
    sub.businessPhone && h('a', { class: 'btn block', href: `tel:${sub.businessPhone}` }, `📞 Call ${sub.businessName}`),
    !sub.stopping && h('details', { class: 'stopbox' }, h('summary', {}, 'Stop with this provider'),
      h('div', { class: 'stack' },
        h('p', { class: 'help' }, 'Not your tiffin service, or you moved on? You are not tied to any provider. Choose your last tiffin day and they are told straight away. You can undo this until that day.'),
        h('label', { class: 'field' }, 'Last tiffin day', stopDate),
        h('button', { class: 'btn danger', type: 'button', onclick: (e) => ask(e.currentTarget, `Stop your tiffin with ${sub.businessName} after ${fmt(stopDate.value)}?`, async () => {
          try { replace(await api('POST', `/api/my/${sub.tid}/${sub.cid}/stop`, { lastDay: stopDate.value })); toast('Done. Your provider has been told.'); } catch (err) { errToast(err); }
        }, 'Yes, stop') }, 'Stop after this day'))));
}

// services that have ended, kept out of the way
function pastSection(past) {
  if (!past.length) return null;
  return h('details', { class: 'card pastbox' }, h('summary', {}, `Past tiffin services (${past.length})`),
    h('div', { class: 'stack' }, past.map((p) => h('div', { class: 'row-top', style: { alignItems: 'center' } },
      h('div', { class: 'row-main' }, h('strong', {}, p.businessName), h('div', { class: 'muted' }, `Ended ${fmt(p.endDate)}${p.endedBy === 'customer' ? ' (you stopped it)' : ''}`))))),
    h('p', { class: 'help' }, 'Want to start again? ', h('a', { href: '/find' }, 'Find a tiffin service'), ' and send a request to join.'));
}

// shown only when you have 2+ active services: one form for all of them
function allLeaveCard(active) {
  if (active.length < 2) return null;
  const min = active.map((s) => s.minDate).sort().pop(); // the latest cut-off among them; stricter ones are reported back
  const from = h('input', { type: 'date', value: min, min, required: true });
  const to = h('input', { type: 'date', value: min, min, required: true });
  from.addEventListener('change', () => { if (to.value < from.value) to.value = from.value; to.min = from.value; });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, `Mark leave for all ${active.length} services`);
  return h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        const r = await api('POST', '/api/my/leaves', { from: from.value, to: to.value });
        data.subscriptions = r.subscriptions; draw();
        toast(r.skipped.length ? `Marked for ${r.applied}. Not for: ${r.skipped.map((x) => x.name).join(', ')} (call them).` : `Done! All ${r.applied} providers have been told ✓`, !!r.skipped.length);
      } catch (err) { errToast(err); btn.disabled = false; }
    },
  }, h('h2', { style: { margin: 0 } }, 'Going away from everything?'), h('p', { class: 'help' }, `You use ${active.length} tiffin services. Mark leave with all of them at once.`),
  h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'From', from), h('label', { class: 'field' }, 'To', to)), btn);
}

function telegramCard(tg) {
  if (!tg || !tg.configured) return null;
  const box = h('div', { class: 'card stack' });
  const draw = (t) => box.replaceChildren(
    h('h2', {}, '✈️ Telegram (optional)'),
    t.linked
      ? h('div', { class: 'stack' },
          h('p', { class: 'ok-txt' }, '✅ Connected. If you forget your password, the reset code is sent to your Telegram.'),
          h('p', { class: 'help' }, 'Send /status to the bot any time to see today’s tiffin.'),
          h('button', { class: 'btn sm danger', onclick: async () => { try { draw(await api('POST', '/api/my/telegram/unlink')); toast('Telegram disconnected'); } catch (e) { if (e.message !== 'login') toast(e.message, true); } } }, 'Disconnect'))
      : h('div', { class: 'stack' },
          h('p', { class: 'help' }, 'Connect once and you can reset a forgotten password yourself, with a code sent to Telegram.'),
          h('ol', { class: 'help', style: { paddingLeft: '20px', display: 'grid', gap: '4px' } },
            h('li', {}, 'Open ', h('a', { href: t.botUrl, target: '_blank', rel: 'noopener' }, h('b', {}, t.botAt)), ' in Telegram and tap Start'),
            h('li', {}, 'Send: ', h('code', {}, `/start ${t.code}`)),
            h('li', {}, 'Come back here and tap “I did it”')),
          h('button', { class: 'btn sm', onclick: async () => { try { const d = await api('GET', '/api/my'); data.telegram = d.telegram; draw(d.telegram); if (!d.telegram.linked) toast('Not connected yet. Send the code to the bot first.', true); } catch (e) { if (e.message !== 'login') toast(e.message, true); } } }, 'I did it')));
  draw(tg);
  return box;
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
  const subs = data.subscriptions;
  const active = subs.filter((s) => !s.ended);
  const past = subs.filter((s) => s.ended);
  $('#root').replaceChildren(
    h('header', { class: 'top' }, h('img', { class: 'logo', src: '/icon.svg', alt: '' }), h('h1', {}, 'My tiffin'),
      h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; } }, 'Log out')),
    h('main', { class: 'me-wrap' },
      h('p', { class: 'me-hi' }, 'Hi ', h('b', {}, data.name), '! 👋'),
      h('div', { class: 'me-grid' },
        h('div', { class: 'stack' },
          allLeaveCard(active),
          active.length ? active.map(subCard) : h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🍽'), h('p', {}, past.length ? 'You have no active tiffin service right now.' : 'No tiffin service found for your number right now.'), h('a', { class: 'btn primary', href: '/find', style: { marginTop: '12px' } }, 'Find a tiffin service')),
          pastSection(past)),
        h('aside', { class: 'stack' },
          telegramCard(data.telegram),
          passwordCard(),
          h('p', { class: 'help', style: { textAlign: 'center' } }, 'For anything urgent or same-day, please call your provider.'),
          h('p', { class: 'help', style: { textAlign: 'center' } }, h('a', { href: '/find' }, 'Find another tiffin service'), ' · ', h('a', { href: '/help#customers' }, 'Help'))))));
}

api('GET', '/api/my').then((d) => { data = d; draw(); }).catch((e) => { if (e.message !== 'login') $('#root').replaceChildren(h('main', {}, h('div', { class: 'card empty' }, h('p', {}, e.message)))); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
