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
    list.addEventListener('click', (e) => e.preventDefault()); // inside a <label>: do not re-trigger the button
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
  // ----- in-page calendar: dateInput({ value, min, max, clearable, placeholder }) -> element with .value / .min / .max
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const nice = (s) => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  window.dateInput = ({ value = '', min = '', max = '', clearable = false, placeholder = 'Pick a date' } = {}) => {
    const root = mk('div', { class: 'dp' });
    const label = mk('span', { class: 'dp-label' });
    const btn = mk('button', { type: 'button', class: 'dp-btn', 'aria-expanded': 'false' }, label, mk('span', { class: 'dp-ic', 'aria-hidden': 'true' }, '📅'));
    const cal = mk('div', { class: 'dp-cal', hidden: true });
    let val = value;
    let shown = null; // first day of the month being looked at
    const paintLabel = () => { label.textContent = val ? nice(val) : placeholder; label.classList.toggle('empty', !val); };
    const pickDay = (s) => { val = s; paintLabel(); close(); root.dispatchEvent(new Event('change')); };
    const draw = () => {
      const first = shown;
      const todayS = ymd(new Date());
      const prev = mk('button', { type: 'button', class: 'dp-nav', 'aria-label': 'Previous month' }, '‹');
      const next = mk('button', { type: 'button', class: 'dp-nav', 'aria-label': 'Next month' }, '›');
      prev.addEventListener('click', () => { shown = new Date(first.getFullYear(), first.getMonth() - 1, 1); draw(); });
      next.addEventListener('click', () => { shown = new Date(first.getFullYear(), first.getMonth() + 1, 1); draw(); });
      const lastOfPrev = ymd(new Date(first.getFullYear(), first.getMonth(), 0));
      const firstOfNext = ymd(new Date(first.getFullYear(), first.getMonth() + 1, 1));
      prev.disabled = !!min && lastOfPrev < min;
      next.disabled = !!max && firstOfNext > max;
      const grid = mk('div', { class: 'dp-grid' });
      for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(mk('span', { class: 'dp-wd' }, d));
      for (let i = 0; i < first.getDay(); i++) grid.append(mk('span'));
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const s = ymd(new Date(first.getFullYear(), first.getMonth(), d));
        const b = mk('button', { type: 'button', class: `dp-day${s === val ? ' sel' : ''}${s === todayS ? ' today' : ''}`, 'aria-label': nice(s), 'aria-pressed': s === val ? 'true' : 'false' }, String(d));
        b.disabled = (!!min && s < min) || (!!max && s > max);
        b.addEventListener('click', () => pickDay(s));
        grid.append(b);
      }
      const foot = mk('div', { class: 'dp-foot' });
      const t = mk('button', { type: 'button', class: 'link-btn' }, 'Today');
      t.disabled = (!!min && todayS < min) || (!!max && todayS > max);
      t.addEventListener('click', () => pickDay(todayS));
      foot.append(t);
      if (clearable) { const c = mk('button', { type: 'button', class: 'link-btn' }, 'Clear'); c.addEventListener('click', () => pickDay('')); foot.append(c); }
      cal.replaceChildren(mk('div', { class: 'dp-head' }, prev, mk('strong', {}, `${MONTHS[first.getMonth()]} ${first.getFullYear()}`), next), grid, foot);
    };
    const open = () => {
      document.querySelectorAll('.dp.open').forEach((p) => p !== root && p.close());
      const base = val ? parse(val) : min ? parse(min) : new Date();
      shown = new Date(base.getFullYear(), base.getMonth(), 1);
      draw();
      cal.hidden = false; root.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    };
    const close = () => { cal.hidden = true; root.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    root.close = close;
    btn.addEventListener('click', () => (root.classList.contains('open') ? close() : open()));
    cal.addEventListener('click', (e) => e.preventDefault()); // inside a <label>: do not re-trigger the button
    Object.defineProperties(root, {
      value: { get: () => val, set: (v) => { val = v || ''; paintLabel(); } },
      min: { get: () => min, set: (v) => { min = v || ''; if (root.classList.contains('open')) draw(); } },
      max: { get: () => max, set: (v) => { max = v || ''; if (root.classList.contains('open')) draw(); } },
    });
    paintLabel();
    root.append(btn, cal);
    return root;
  };
  document.addEventListener('click', (e) => document.querySelectorAll('.dp.open').forEach((p) => !p.contains(e.target) && p.close()));

  // ----- in-page time chooser: timeInput({ value: '07:00', clearable }) -> element with .value ('HH:MM' or '')
  window.timeInput = ({ value = '', clearable = false } = {}) => {
    const opts = [];
    if (clearable) opts.push(['', 'Off']);
    for (let m = 0; m < 24 * 60; m += 15) {
      const h24 = Math.floor(m / 60);
      const hh = h24 % 12 || 12;
      opts.push([`${pad2(h24)}:${pad2(m % 60)}`, `${hh}:${pad2(m % 60)} ${h24 < 12 ? 'am' : 'pm'}`]);
    }
    if (value && !opts.some(([v]) => v === value)) {
      const [h24, mm] = value.split(':').map(Number);
      opts.push([value, `${h24 % 12 || 12}:${pad2(mm)} ${h24 < 12 ? 'am' : 'pm'}`]);
      opts.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return window.pick(opts, value);
  };
})();
