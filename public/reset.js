'use strict';
// Opened from a one-time link (made by a provider for their customer, or by the administrator).

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
const token = new URLSearchParams(location.search).get('token') || '';
const head = h('a', { class: 'brand mobile-brand', href: '/' }, h('img', { src: '/icon.svg', alt: '', width: 36, height: 36 }), h('span', { class: 'wm' }, h('b', {}, 'My'), 'Tiffin'));

function show(...kids) { $('#box').replaceChildren(head, ...kids); }

fetch(`/api/reset-link/${encodeURIComponent(token)}`).then(async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return show(h('h1', {}, 'Link not working'), h('div', { class: 'note-box' }, d.error || 'This reset link is not valid or has expired.'), h('a', { class: 'btn lg block', href: '/forgot' }, 'Forgot password help'));
  const pw = h('input', { type: 'password', placeholder: 'New password (6+ characters)', autocomplete: 'new-password', minLength: 6, required: true });
  const go = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Save new password');
  show(h('h1', {}, 'Choose a new password'), h('p', { class: 'help' }, 'For ', h('b', {}, d.name), '. This link works once.'),
    h('form', {
      class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true;
        try {
          const res = await fetch('/api/reset-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw.value }) });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out.error || 'Could not save');
          show(h('h1', {}, 'Password changed ✅'), h('p', { class: 'help' }, 'You can log in with your new password now.'), h('a', { class: 'btn primary lg block', href: `/login${out.role === 'customer' ? '?role=customer' : ''}` }, 'Log in'));
        } catch (err) { toast(err.message, true); go.disabled = false; }
      },
    }, h('label', { class: 'field' }, 'New password', pw), go));
  pw.focus({ preventScroll: true });
}).catch(() => show(h('h1', {}, 'Could not load'), h('div', { class: 'note-box' }, 'Please check your internet connection and try again.')));
