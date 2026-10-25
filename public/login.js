'use strict';
// Log in / sign up for providers and customers (phone number + password, 30-day session).

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
  timer = setTimeout(() => (t.className = 'toast'), 3500);
}

const q = new URLSearchParams(location.search);
const state = {
  mode: location.pathname.startsWith('/signup') ? 'signup' : 'login',
  role: ['customer', 'admin'].includes(q.get('role')) ? q.get('role') : 'provider',
};
const home = (role) => ({ provider: '/app', admin: '/admin' }[role] || '/me');

function draw() {
  const { mode, role } = state;
  const isAdmin = role === 'admin';
  const isUp = mode === 'signup' && !isAdmin;
  const business = h('input', { type: 'text', placeholder: 'e.g. Annapurna Tiffins', maxLength: 60, autocomplete: 'organization' });
  const phone = h('input', { type: 'tel', placeholder: 'Mobile number', inputMode: 'tel', autocomplete: 'tel', required: true });
  const pass = h('input', { type: 'password', placeholder: isUp ? 'Choose a password (6+ characters)' : 'Your password', autocomplete: isUp ? 'new-password' : 'current-password', required: true, minLength: isUp ? 6 : 1 });
  const go = h('button', { class: 'btn primary lg block', type: 'submit' }, isUp ? 'Create account' : 'Log in');

  const form = h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const r = await fetch(isUp ? '/api/signup' : '/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, phone: phone.value, password: pass.value, businessName: business.value }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Something went wrong');
        location.href = home(data.user.role);
      } catch (err) {
        toast(err.message, true);
        go.disabled = false;
      }
    },
  },
    role === 'provider' && isUp && h('label', { class: 'field' }, 'Tiffin service name', business),
    h('label', { class: 'field' }, 'Phone number', phone),
    h('label', { class: 'field' }, 'Password', pass),
    isUp && role === 'customer' && h('div', { class: 'note-box' }, 'Use the same phone number your tiffin provider has saved for you. Not working? Ask them to add or correct your number.'),
    go);

  $('#box').replaceChildren(
    h('a', { class: 'brand mobile-brand', href: '/' }, h('img', { src: '/icon.svg', alt: '', width: 36, height: 36 }), h('span', { class: 'wm' }, h('b', {}, 'My'), 'Tiffin')),
    h('h1', {}, isAdmin ? 'Admin sign-in' : isUp ? 'Create your account' : 'Welcome back'),
    !isAdmin && h('div', { class: 'seg two', role: 'tablist' },
      ['provider', 'customer'].map((r) => h('button', { type: 'button', role: 'tab', class: role === r ? 'on' : '', onclick: () => { state.role = r; draw(); } }, r === 'provider' ? '👨‍🍳 Tiffin provider' : '🍽 Customer'))),
    form,
    !isAdmin && !isUp && h('p', { class: 'auth-foot' }, h('a', { href: `/forgot?role=${role}` }, 'Forgot password?')),
    !isAdmin && h('p', { class: 'auth-foot' }, isUp ? 'Already have an account? ' : 'New here? ',
      h('button', { type: 'button', onclick: () => { state.mode = isUp ? 'login' : 'signup'; history.replaceState(null, '', state.mode === 'signup' ? '/signup' : '/login'); draw(); } }, isUp ? 'Log in' : 'Create an account')),
    h('p', { class: 'auth-foot' }, h('a', { href: '/' }, '← Back to website')));
  (isUp && role === 'provider' ? business : phone).focus({ preventScroll: true });
}

// already logged in? go straight to the right place
fetch('/api/me').then((r) => r.json()).then(({ user }) => { if (user) location.replace(home(user.role)); }).catch(() => {});
draw();
