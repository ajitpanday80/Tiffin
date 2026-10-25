'use strict';
// Forgot password. Providers get a code on their connected Telegram; customers are pointed to their provider.

const $ = (s) => document.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
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
  timer = setTimeout(() => (t.className = 'toast'), 4000);
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}

const state = { role: new URLSearchParams(location.search).get('role') === 'customer' ? 'customer' : 'provider', step: 1, phone: '', support: '' };

function supportLine() {
  return state.support ? h('div', { class: 'note-box' }, 'Still stuck? Contact support: ', h('b', {}, state.support)) : null;
}

function draw() {
  const { role, step } = state;
  const tabs = h('div', { class: 'seg two', role: 'tablist' },
    ['provider', 'customer'].map((r) => h('button', { type: 'button', role: 'tab', class: role === r ? 'on' : '', onclick: () => { state.role = r; state.step = 1; draw(); } }, r === 'provider' ? '👨‍🍳 Tiffin provider' : '🍽 Customer')));
  let body;

  if (role === 'customer') {
    body = [
      h('div', { class: 'note-box' }, 'Customers do not get a code. Your tiffin provider can send you a reset link:'),
      h('ol', { class: 'help', style: { paddingLeft: '20px', display: 'grid', gap: '6px' } },
        h('li', {}, 'Message or call your tiffin provider.'),
        h('li', {}, 'They open your name in their MyTiffin app and tap “Create reset link”, then send it to you on WhatsApp.'),
        h('li', {}, 'Open the link and choose a new password.')),
      h('p', { class: 'help' }, 'In the meantime, the personal link your provider sent you still lets you mark leave without a password.'),
      supportLine(),
    ];
  } else if (step === 1) {
    const phone = h('input', { type: 'tel', placeholder: 'Mobile number', inputMode: 'tel', autocomplete: 'tel', required: true, value: state.phone });
    const go = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Send code to my Telegram');
    body = [h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true;
        try { state.phone = phone.value; await post('/api/forgot', { phone: phone.value }); state.step = 2; draw(); } catch (err) { toast(err.message, true); go.disabled = false; }
      },
    }, h('p', { class: 'help' }, 'We send a 6-digit code to the Telegram chat you connected to MyTiffin (Settings → Telegram alerts).'), h('label', { class: 'field' }, 'Phone number', phone), go), supportLine()];
  } else {
    const code = h('input', { type: 'text', placeholder: '6-digit code', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 8, required: true });
    const pw = h('input', { type: 'password', placeholder: 'New password (6+ characters)', autocomplete: 'new-password', minLength: 6, required: true });
    const go = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Set new password');
    body = [h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true;
        try { await post('/api/reset', { phone: state.phone, code: code.value, password: pw.value }); state.step = 3; draw(); } catch (err) { toast(err.message, true); go.disabled = false; }
      },
    }, h('p', { class: 'help' }, `If ${state.phone} has Telegram connected, a code is on its way. It works for 10 minutes.`),
    h('label', { class: 'field' }, 'Code from Telegram', code), h('label', { class: 'field' }, 'New password', pw), go,
    h('p', { class: 'auth-foot' }, 'No message? ', h('button', { type: 'button', onclick: () => { state.step = 1; draw(); } }, 'Try again'))),
    h('div', { class: 'note-box' }, 'No Telegram connected for this number? The code cannot be sent. Contact support to get a reset link.'), supportLine()];
    if (step === 3) body = null;
  }
  if (role === 'provider' && step === 3) {
    body = [h('div', { class: 'note-box' }, '✅ Your password was changed. You were signed out everywhere.'), h('a', { class: 'btn primary lg block', href: '/login' }, 'Log in')];
  }

  $('#box').replaceChildren(
    h('a', { class: 'brand mobile-brand', href: '/' }, h('img', { src: '/icon.svg', alt: '', width: 36, height: 36 }), 'MyTiffin'),
    h('h1', {}, 'Forgot your password?'), tabs, ...body.filter(Boolean),
    h('p', { class: 'auth-foot' }, h('a', { href: `/login${role === 'customer' ? '?role=customer' : ''}` }, '← Back to log in')));
}

fetch('/api/support').then((r) => r.json()).then((d) => { state.support = d.support || ''; draw(); }).catch(() => {});
draw();
