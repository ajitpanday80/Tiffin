// Browser tests: every page, every role, phone / tablet / laptop / desktop.
// Opt-in because it needs Playwright + Chromium:   UI_TESTS=1 npm test      (UI_SHOTS=dir also saves screenshots)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/logic.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium = null;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch { /* not installed */ }
const ENABLED = !!chromium && process.env.UI_TESTS === '1';

const PORT = 48000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.UI_SHOTS || '';
const VIEWPORTS = [
  ['phone', { width: 360, height: 740 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['tablet', { width: 768, height: 1024 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['laptop', { width: 1024, height: 700 }, {}],
  ['desktop', { width: 1440, height: 900 }, {}],
];
const today = L.todayStr();
const dir = ENABLED ? fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-ui-')) : '';
let proc, browser;
const cookies = {};
let tokenA = '';
let blogSlug = 'how-to-choose-a-tiffin-service';

const api = async (method, url, body, cookie) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  const out = { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  if (r.status >= 400) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(out.body)}`);
  return out;
};

before(async () => {
  if (!ENABLED) return;
  const mk = spawnSync(process.execPath, ['scripts/make-admin.js', '9000000000', 'adminpass1'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir } });
  assert.equal(mk.status, 0, String(mk.stderr));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: dir, GEOCODER: 'off', RATING_MIN_DAYS: '0', TELEGRAM_BOT_TOKEN: '1:x', TELEGRAM_API_BASE: 'http://127.0.0.1:9' } });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('running') && res());
    proc.on('exit', (c) => rej(new Error(`server exited ${c}`)));
  });

  // --- seed: two providers, a customer served by both, long text everywhere, a sponsored listing, an enquiry
  const a = await api('POST', '/api/signup', { role: 'provider', phone: '9811100001', password: 'abcdef', businessName: 'Annapurna Tiffins and Home Kitchen of Greater Baner' });
  const b = await api('POST', '/api/signup', { role: 'provider', phone: '9811100002', password: 'abcdef', businessName: 'Sai Home Tiffins' });
  cookies.A = a.cookie;
  cookies.B = b.cookie;
  await api('PUT', '/api/settings', { businessName: 'Annapurna Tiffins and Home Kitchen of Greater Baner', businessPhone: '9811100001', prices: { normal: 80, deluxe: 120 } }, a.cookie);
  const names = ['Dr. Venkata Subramanian Raghavendra Iyengar', 'Ramesh Sharma', 'Priya Nair', 'Amit Kulkarni', 'Sunita Rao', 'Kavita Joshi', 'Rahul Verma', 'Neha Gupta'];
  const custs = [];
  for (const [i, n] of names.entries()) {
    custs.push((await api('POST', '/api/customers', { name: n, phone: `98765432${10 + i}`, address: i === 0 ? 'Flat 1204, Building C-Wing, Sai Heights Co-operative Housing Society, Near Balewadi High Street Signal, Baner, Pune 411045' : `${i}-B, Lake View, Baner`, type: i % 3 === 0 ? 'deluxe' : 'normal', qty: i === 2 ? 2 : 1, note: i === 1 ? 'less spicy, no onion, ring the bell twice and leave at the door' : '' }, a.cookie)).body);
  }
  await api('POST', `/api/customers/${custs[3].id}/leaves`, { from: today, to: L.addDays(today, 1) }, a.cookie);
  tokenA = custs[1].token;
  // the same person is also a customer of provider B, and has a login
  const sunita = (await api('POST', '/api/customers', { name: 'Sunita Rao', phone: '9822200001', address: 'A-301 Orchid Residency', type: 'deluxe' }, a.cookie)).body;
  await api('POST', '/api/customers', { name: 'Sunita', phone: '9822200001', address: 'A-301 Orchid, Baner' }, b.cookie);
  cookies.C = (await api('POST', '/api/signup', { role: 'customer', phone: '9822200001', password: 'abcdef', code: sunita.code })).cookie;
  // Sai Home Tiffins was not proven at sign-up: the customer confirms it, then a third provider adds them (pending)
  const mine = (await api('GET', '/api/my', null, cookies.C)).body.subscriptions;
  const sai = mine.find((s) => s.businessName === 'Sai Home Tiffins');
  await api('POST', `/api/my/${sai.tid}/${sai.cid}/accept`, {}, cookies.C);
  await api('PUT', `/api/my/${sai.tid}/${sai.cid}/rating`, { stars: 4, comment: 'Always on time, tasty food' }, cookies.C);
  const d = await api('POST', '/api/signup', { role: 'provider', phone: '9811100003', password: 'abcdef', businessName: 'Pending Kitchen' });
  await api('POST', '/api/customers', { name: 'Sunita', phone: '9822200001' }, d.cookie);
  await api('POST', '/api/pauses', { from: L.addDays(today, 3), to: L.addDays(today, 5), note: 'Family wedding' }, a.cookie);
  for (const [ck, nm, lat, lng] of [[a.cookie, 'Annapurna Tiffins and Home Kitchen of Greater Baner', 18.56, 73.78], [b.cookie, 'Sai Home Tiffins', 18.57, 73.79]]) {
    await api('PUT', '/api/listing', { enabled: true, tagline: 'Fresh, hot, home-style meals delivered to your door every day', about: 'Lunch and dinner, six days a week.', tags: ['veg', 'home-style'], meals: ['lunch', 'dinner'], area: 'Baner', city: 'Pune', pincode: '411045', radiusKm: 8, lat, lng }, ck);
  }
  const admin = await api('POST', '/api/login', { role: 'admin', phone: '9000000000', password: 'adminpass1' });
  cookies.admin = admin.cookie;
  const plan = (await api('POST', '/api/admin/plans', { name: 'Local boost', days: 30, radiusKm: 3, price: 499 }, admin.cookie)).body.plans[0];
  const order = (await api('POST', '/api/ads/order', { planId: plan.id }, b.cookie)).body;
  await api('POST', `/api/admin/orders/${order.id}/paid`, {}, admin.cookie);
  const lid = (await api('GET', '/api/listing', null, a.cookie)).body.id;
  await api('POST', `/api/market/${lid}/enquire`, { name: 'Meera Joshi', phone: '9822200077', address: 'Flat 4, Lotus Apartments, Aundh', type: 'deluxe', note: 'veg only' });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  proc?.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the checks applied to every page
async function audit(page, label, { fixedNav = false } = {}) {
  const issues = [];
  const r = await page.evaluate(() => {
    const vw = innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((e) => {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return b.width > 0 && b.right > vw + 1 && cs.position !== 'fixed' && !e.closest('[hidden]') && cs.visibility !== 'hidden' && !e.closest('.bars, dialog:not([open]), .phone, .stage, .float');
    }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}`);
    const small = [...document.querySelectorAll('button, a.btn, summary, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea')].filter((e) => {
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !e.closest('dialog:not([open])') && !e.closest('[hidden]') && !e.disabled && b.height < 36 && !e.classList.contains('link') && !e.classList.contains('link-btn') && !e.closest('.faq, .faqitem, .stopbox, .pastbox, details > summary') && !(e.tagName === 'A' && !e.classList.contains('btn'));
    }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || e.placeholder || '').trim().slice(0, 24)}" ${Math.round(e.getBoundingClientRect().height)}px`);
    const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.closest('[hidden]')).map((i) => i.src.slice(-40));
    return { scrollW: document.documentElement.scrollWidth, vw, wide, small, broken };
  });
  if (r.scrollW > r.vw + 1) issues.push(`horizontal scroll: page ${r.scrollW}px wider than ${r.vw}px (${r.wide.join(', ')})`);
  if (r.broken.length) issues.push(`broken images: ${r.broken.join(', ')}`);
  if (r.small.length) issues.push(`tap targets under 36px: ${r.small.join('; ')}`);
  if (fixedNav) {
    // after scrolling to the end, the last control must not be hidden behind the fixed bottom bar
    const hidden = await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((res) => setTimeout(res, 150));
      const nav = document.querySelector('nav.tabs');
      if (!nav || getComputedStyle(nav).position !== 'fixed') return null;
      const nb = nav.getBoundingClientRect();
      if (nb.width > innerWidth * 0.6) { // a bottom bar (on desktop it is a left sidebar)
        const last = [...document.querySelectorAll('main button, main a.btn, main input, main summary')].filter((e) => e.getBoundingClientRect().height > 0).pop();
        if (last && last.getBoundingClientRect().bottom > nb.top + 1) return `${last.tagName} "${(last.textContent || '').trim().slice(0, 20)}" sits under the bottom bar`;
      }
      return null;
    });
    if (hidden) issues.push(hidden);
  }
  return issues.map((i) => `${label}: ${i}`);
}

async function visit(ctx, name, url, { prepare, fixedNav = false, wait = 'main, #root > *, .auth, .app' } = {}) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/status of (4\d\d)/.test(m.text()) && errs.push(`console ${m.text()}`));
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.waitForSelector(wait, { timeout: 8000 });
  await page.waitForTimeout(250);
  if (prepare) await prepare(page);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  await page.waitForTimeout(150);
  const issues = await audit(page, name, { fixedNav });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name.replace(/[^\w]+/g, '_')}.png`), fullPage: true }).catch(() => {});
  await page.close();
  return [...issues, ...errs.map((e) => `${name}: ${e}`)];
}

const authed = async (ctx, cookie) => {
  const v = cookie.split('=')[1];
  await ctx.addCookies([{ name: 'tiffin_session', value: v, url: BASE }]);
};

for (const [vp, size, extra] of VIEWPORTS) {
  test(`${vp} ${size.width}x${size.height}: public website, auth pages and marketplace`, { skip: !ENABLED && 'set UI_TESTS=1 (needs Playwright)' }, async () => {
    const ctx = await browser.newContext({ viewport: size, ...extra });
    const problems = [];
    const pages = [
      ['home', '/'], ['find', '/find'], ['help', '/help'], ['blog', '/blog'], ['post', `/blog/${blogSlug}`],
      ['login', '/login'], ['signup-provider', '/signup'], ['signup-customer', '/signup?role=customer'], ['forgot', '/forgot'], ['forgot-customer', '/forgot?role=customer'], ['reset-bad', '/reset?token=nope'], ['admin-login', '/login?role=admin'],
      ['personal-link', `/c/${tokenA}`],
    ];
    for (const [n, u] of pages) problems.push(...(await visit(ctx, `${vp}/${n}`, u)));
    problems.push(...(await visit(ctx, `${vp}/find-results`, '/find?q=411045', { wait: '.rcard' })));
    problems.push(...(await visit(ctx, `${vp}/find-join-dialog`, '/find?q=411045', { wait: '.rcard', prepare: async (p) => { await p.locator('.rcard button:has-text("Request to join")').first().click(); await p.waitForSelector('#sheet[open]'); } })));
    await ctx.close();
    assert.deepEqual(problems, []);
  });

  test(`${vp} ${size.width}x${size.height}: provider app (every tab, forms, dialogs) and Settings really saves`, { skip: !ENABLED && 'set UI_TESTS=1 (needs Playwright)' }, async () => {
    const ctx = await browser.newContext({ viewport: size, ...extra });
    await authed(ctx, cookies.A);
    const problems = [];
    for (const tab of ['today', 'customers', 'reports', 'grow', 'settings']) problems.push(...(await visit(ctx, `${vp}/app-${tab}`, `/app#/${tab}`, { fixedNav: true, wait: 'nav.tabs' })));
    problems.push(...(await visit(ctx, `${vp}/app-customer-sheet`, '/app#/customers', { wait: '.cust', prepare: async (p) => { await p.locator('.cust').first().click(); await p.waitForSelector('#sheet[open]'); } })));
    problems.push(...(await visit(ctx, `${vp}/app-add-customer`, '/app#/customers', { wait: '.fab', prepare: async (p) => { await p.click('.fab'); await p.waitForSelector('#sheet[open]'); } })));

    // regression: "Save settings" must actually send the form (a nested required field once blocked it silently)
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app#/settings`);
    await page.waitForSelector('text=Save settings');
    const name = `Annapurna ${vp}`;
    await page.fill('input[type=text] >> nth=0', name);
    await page.fill('input[type=number] >> nth=0', '85');
    const put = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT');
    await page.locator('button:has-text("Save settings")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Save settings")');
    assert.equal((await put).status(), 200, 'PUT /api/settings was sent and accepted');
    await page.waitForSelector('.toast.show:has-text("Settings saved")');
    assert.equal(await page.locator('#biz').innerText(), name);
    assert.equal((await api('GET', '/api/settings', null, cookies.A)).body.prices.normal, 85);
    // no browser popups: native dialogs fail the test, and drop-downs / confirmations / sheets stay in the page
    page.on('dialog', (d) => { throw new Error(`browser popup: ${d.type()} ${d.message()}`); });
    assert.equal(await page.locator('dialog, select').count(), 0, 'no <dialog> or native <select> in the provider app');
    assert.equal(await page.locator('input[type=date], input[type=time]').count(), 0, 'no native date/time inputs');
    await page.locator('.dp-btn').first().click();
    assert.ok(await page.locator('.dp-cal:visible .dp-day:not(:disabled)').count() > 2, 'the calendar opens inside the page');
    await page.locator('.dp-cal:visible .dp-day:not(:disabled)').nth(1).click();
    assert.equal(await page.locator('.dp-cal:visible').count(), 0, 'picking a day closes it');
    const cutoff = page.locator('.field:has-text("Customers can cancel") .pick-btn');
    await cutoff.click();
    await page.click('.pick-list li:has-text("Until 9:00 am")');
    assert.match(await cutoff.innerText(), /Until 9:00 am/);
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('.toast.show:has-text("Settings saved")');
    assert.equal((await api('GET', '/api/settings', null, cookies.A)).body.cutoffHour, 9);
    await page.goto(`${BASE}/app#/customers`);
    await page.locator('.cust').first().click();
    await page.waitForSelector('#sheet[open]');
    assert.equal(await page.locator('nav.tabs').isVisible(), false, 'the sheet replaces the page, it is not layered on top');
    await page.click('button:has-text("Delete customer")');
    assert.ok(await page.locator('.ask button:has-text("Cancel")').isVisible(), 'inline confirmation appears in the page');
    await page.click('.ask button:has-text("Cancel")');
    await page.click('#sheet .back');
    await page.waitForSelector('nav.tabs');
    await page.close();
    await ctx.close();
    assert.deepEqual(problems, []);
  });

  test(`${vp} ${size.width}x${size.height}: customer portal with two providers, and the admin console`, { skip: !ENABLED && 'set UI_TESTS=1 (needs Playwright)' }, async () => {
    const ctx = await browser.newContext({ viewport: size, ...extra });
    await authed(ctx, cookies.C);
    const problems = [];
    problems.push(...(await visit(ctx, `${vp}/me`, '/me', { wait: '.me-grid' })));
    problems.push(...(await visit(ctx, `${vp}/me-stop-open`, '/me', { wait: '.me-grid', prepare: async (p) => { await p.locator('details.stopbox summary').first().click(); } })));
    problems.push(...(await visit(ctx, `${vp}/find-as-customer`, '/find?q=411045', { wait: '.rcard' })));
    {
      const p = await ctx.newPage();
      await p.goto(`${BASE}/me`);
      await p.waitForSelector('.me-grid');
      const href = await p.locator('a:has-text("Switch to another provider")').first().getAttribute('href');
      await p.goto(`${BASE}${href}&q=411045`);
      await p.waitForSelector('#switchbar');
      await p.waitForSelector('.rcard');
      assert.ok(await p.locator('.joined').count(), 'services the customer already has are marked');
      await p.close();
    }
    const page = await ctx.newPage();
    await page.goto(`${BASE}/me`);
    await page.waitForSelector('.me-grid');
    assert.equal(await page.locator('article.card:not(.pendbox)').count(), 2, 'both confirmed providers are listed');
    assert.equal(await page.locator('.pendbox').count(), 1, 'the provider that has not been confirmed asks first');
    assert.equal(await page.locator('dialog, select, input[type=date], input[type=time]').count(), 0, 'no native pickers on the customer page');
    assert.ok(await page.locator('form:has-text("Mark leave for all 2 services")').count(), 'the all-providers leave form is shown');
    await page.close();
    await ctx.close();

    const actx = await browser.newContext({ viewport: size, ...extra });
    await authed(actx, cookies.admin);
    for (const tab of ['Orders', 'Plans', 'Providers', 'Reset login', 'Payment & support']) {
      problems.push(...(await visit(actx, `${vp}/admin-${tab}`, '/admin', { wait: '.seg', prepare: async (p) => { await p.click(`button:has-text("${tab}")`); } })));
    }
    await actx.close();
    assert.deepEqual(problems, []);
  });
}
