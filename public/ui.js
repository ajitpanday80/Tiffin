'use strict';
// Shared in-page UI: no browser popups.
//  - #sheet is an in-page panel (replaces the page content, with a Back button), not a modal dialog
//  - ask(): inline "Are you sure?" instead of confirm()
//  - pick(): styled dropdown instead of the native <select>
(() => {
  const mk = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.filter((k) => k != null && k !== false));
    return el;
  };

  // ----- in-page panel with the old dialog API (open / showModal / close / 'close' event)
  const panel = document.getElementById('sheet');
  if (panel) {
    let scrollY = 0;
    Object.defineProperty(panel, 'open', { get: () => panel.hasAttribute('open') });
    panel.showModal = () => {
      if (panel.open) return;
      scrollY = window.scrollY;
      panel.hidden = false;
      panel.setAttribute('open', '');
      document.body.classList.add('panel-open');
      window.scrollTo(0, 0);
    };
    panel.close = () => {
      if (!panel.open) return;
      panel.removeAttribute('open');
      panel.hidden = true;
      document.body.classList.remove('panel-open');
      window.scrollTo(0, scrollY);
      panel.dispatchEvent(new Event('close'));
    };
    document.addEventListener('keydown', (e) => e.key === 'Escape' && panel.open && !document.querySelector('.pick.open') && panel.close());
  }

  // ----- inline confirmation: ask(buttonEl, 'Delete?', () => ..., 'Delete')
  window.ask = (btn, message, onYes, yesLabel = 'Yes') => {
    if (btn.nextElementSibling?.classList.contains('ask')) return;
    const box = mk('div', { class: 'ask', role: 'alertdialog' });
    const yes = mk('button', { type: 'button', class: 'btn sm danger' }, yesLabel);
    const no = mk('button', { type: 'button', class: 'btn sm' }, 'Cancel');
    const done = () => { box.remove(); btn.hidden = false; };
    yes.addEventListener('click', () => { done(); onYes(); });
    no.addEventListener('click', done);
    box.append(mk('p', {}, message), mk('div', { class: 'grid2' }, no, yes));
    btn.hidden = true;
    btn.after(box);
    yes.focus();
  };

  // ----- styled dropdown. pick([[value,label],...], value, onchange?) -> element with .value
  document.addEventListener('click', (e) => document.querySelectorAll('.pick.open').forEach((p) => !p.contains(e.target) && p.close()));
  window.pick = (options, value, onchange) => {
    const root = mk('div', { class: 'pick' });
    const label = mk('span', { class: 'pick-label' });
    const btn = mk('button', { type: 'button', class: 'pick-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, label, mk('span', { class: 'pick-arrow', 'aria-hidden': 'true' }));
    const list = mk('ul', { class: 'pick-list', role: 'listbox', tabindex: '-1', hidden: true });
    let cur = options.find(([v]) => String(v) === String(value)) || options[0];
    const items = options.map((o) => {
      const li = mk('li', { role: 'option', tabindex: '-1' }, o[1]);
      li.addEventListener('click', () => { set(o); root.close(); btn.focus(); });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (li.nextElementSibling || li).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling || li).focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); }
        else if (e.key === 'Escape' || e.key === 'Tab') { root.close(); btn.focus(); }
      });
      list.append(li);
      return [o, li];
    });
    const set = (o, quiet) => {
      cur = o;
      label.textContent = o[1];
      for (const [x, li] of items) li.setAttribute('aria-selected', x === o ? 'true' : 'false');
      if (!quiet) onchange?.(o[0]);
    };
    root.close = () => { root.classList.remove('open'); list.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    root.open = () => {
      document.querySelectorAll('.pick.open').forEach((p) => p !== root && p.close());
      root.classList.add('open'); list.hidden = false; btn.setAttribute('aria-expanded', 'true');
      (items.find(([x]) => x === cur)?.[1] || list.firstChild).focus();
    };
    btn.addEventListener('click', () => (root.classList.contains('open') ? root.close() : root.open()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); root.open(); } });
    Object.defineProperty(root, 'value', { get: () => cur[0], set: (v) => set(options.find(([x]) => String(x) === String(v)) || cur, true) });
    set(cur, true);
    root.append(btn, list);
    return root;
  };
})();
