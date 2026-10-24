'use strict';
// Landing page extras: show "Open app" if already logged in, and fade sections in on scroll.
fetch('/api/me').then((r) => r.json()).then(({ user }) => {
  if (!user) return;
  const box = document.getElementById('navcta');
  const a = document.createElement('a');
  a.className = 'btn primary sm';
  a.href = user.role === 'provider' ? '/app' : '/me';
  a.textContent = user.role === 'provider' ? 'Open my kitchen' : 'Open my tiffin';
  box.replaceChildren(a);
}).catch(() => {});

const items = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { threshold: 0.15 });
  items.forEach((el) => io.observe(el));
} else items.forEach((el) => el.classList.add('in'));
