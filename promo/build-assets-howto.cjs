// Captures the extra real-app screens used by the how-to (instruction) videos -> promo/assets/*.png + meta-howto.json
// Usage: node promo/build-assets-howto.cjs    (run build-assets.cjs first: the how-to videos also reuse its screens)
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'assets');
const PORT = 4601;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-howto-'));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body) {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json(); if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`); return j;
  }
}
const CUSTOMERS = [
  ['Ramesh Sharma', '9000000001', 'B-402, Sai Heights, Baner', 'normal', 1], ['Priya Nair', '9000000002', '12 Lotus Apartments, Aundh', 'deluxe', 2],
  ['Amit Kulkarni', '9000000003', 'Flat 7, Green Park, Balewadi', 'normal', 1], ['Sunita Rao', '9000000004', 'A-301, Orchid Residency, Baner', 'deluxe', 1],
  ['Kavita Joshi', '9000000005', '5 Shivaji Nagar Lane, Pashan', 'normal', 1], ['Rahul Verma', '9000000006', 'C-12, Sky Towers, Aundh', 'normal', 1],
  ['Neha Gupta', '9000000007', '204 Rose Court, Baner', 'deluxe', 1], ['Vikram Patil', '9000000008', 'D-8, Palm Grove, Wakad', 'normal', 1],
];

(async () => {
  const mk = spawnSync(process.execPath, ['scripts/make-admin.js', '9111111111', 'promo-admin-pass'], { cwd: ROOT, env: { ...process.env, DATA_DIR: DATA } });
  if (mk.status) throw new Error(String(mk.stderr));
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, TZ: 'Asia/Kolkata' } });
  await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('running') && res()); server.on('exit', rej); });
  const meta = { boxes: {} };
  try {
    const A = new Client();
    await A.call('POST', '/api/signup', { role: 'provider', phone: '9811100001', password: 'demo-pass-1', businessName: 'Annapurna Tiffins' });
    await A.call('PUT', '/api/settings', { businessName: 'Annapurna Tiffins', businessPhone: '9811100001', prices: { normal: 80, deluxe: 120 }, closedDays: [] });
    const today = (await A.call('GET', '/api/day')).today;
    const ids = {};
    for (const [name, phone, address, type, qty] of CUSTOMERS) ids[name] = (await A.call('POST', '/api/customers', { name, phone, address, type, qty, startDate: addDays(today, -30) })).id;
    await A.call('PUT', '/api/listing', { enabled: true, tagline: 'Fresh veg meals delivered hot', tags: ['veg', 'home-style'], meals: ['lunch', 'dinner'], area: 'Baner', city: 'Pune', pincode: '411045', radiusKm: 6, lat: 18.56, lng: 73.78 });
    const sai = new Client();
    await sai.call('POST', '/api/signup', { role: 'provider', phone: '9811100022', password: 'demo-pass-1', businessName: 'Sai Home Tiffins' });
    await sai.call('PUT', '/api/settings', { businessPhone: '9811100022', prices: { normal: 90, deluxe: 140 } });
    await sai.call('PUT', '/api/listing', { enabled: true, tagline: 'Hot, home-style thalis for working people', tags: ['veg', 'home-style'], meals: ['lunch', 'dinner'], area: 'Baner', city: 'Pune', pincode: '411045', radiusKm: 8, lat: 18.57, lng: 73.79 });
    const admin = new Client();
    await admin.call('POST', '/api/login', { role: 'admin', phone: '9111111111', password: 'promo-admin-pass' });
    const plan = (await admin.call('POST', '/api/admin/plans', { name: 'Local boost', days: 30, radiusKm: 3, price: 499 })).plans[0];
    await admin.call('PUT', '/api/admin/platform', { payInstructions: 'Pay by UPI and quote your reference. We activate your ad within a day.' });
    for (let i = 0; i < 14; i++) await fetch(`${BASE}/api/market/search?q=411045`); // real impressions for the Grow screen
    const S = new Client();
    await S.call('POST', '/api/signup', { role: 'customer', phone: '9000000004', password: 'demo-pass-2' });

    const browser = await chromium.launch();
    const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata' };
    const shot = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
    const box = async (page, sel, nth = 0) => { const b = await page.locator(sel).nth(nth).boundingBox(); if (!b) throw new Error(`no box for ${sel}`); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)); };
    const prodUrl = (page) => page.evaluate((o) => { const w = document.createTreeWalker(document.querySelector('#sheet'), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) n.textContent = n.textContent.split(o).join('https://mytiffin.online'); }, new URL(page.url()).origin);
    const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur());

    // ----- provider: sign-up page, filled but not submitted
    const c1 = await browser.newContext(mobile); const sp = await c1.newPage();
    await sp.goto(`${BASE}/signup`);
    await sp.fill('input[placeholder^="e.g."]', 'Annapurna Tiffins'); await sp.fill('input[type=tel]', '98111 00001'); await sp.fill('input[type=password]', 'my-secret-pass');
    await blur(sp);
    await shot(sp, 'signup-provider');
    meta.boxes.signupFields = await box(sp, 'form.stack'); meta.boxes.signupBtn = await box(sp, 'button:has-text("Create account")');
    meta.boxes.signupTabs = await box(sp, '.seg');

    // ----- provider app
    const pc = await browser.newContext(mobile); const p = await pc.newPage();
    await p.goto(`${BASE}/login`); await p.fill('input[type=tel]', '9811100001'); await p.fill('input[type=password]', 'demo-pass-1'); await p.click('button.primary');
    await p.waitForSelector('.hero-num');
    await p.click('nav.tabs >> text=Customers'); await p.waitForSelector('.cust');
    await p.click('.fab'); await p.waitForSelector('#sheet form');
    await p.fill('#sheet input[type=text] >> nth=0', 'Meera Iyer'); await p.fill('#sheet input[type=tel]', '90000 00020'); await p.fill('#sheet textarea', '9 Garden Residency, Aundh');
    await blur(p); await shot(p, 'form-top');
    meta.boxes.formFields = await box(p, '#sheet label.field >> nth=0'); meta.boxes.formAddress = await box(p, '#sheet textarea');
    await p.click('#sheet .pills >> text=Deluxe');
    await p.click('#sheet [aria-label=More]');
    await p.locator('#sheet button:has-text("Add customer")').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    await shot(p, 'form-bottom');
    meta.boxes.formType = await box(p, '#sheet .pills'); meta.boxes.formAddBtn = await box(p, '#sheet button:has-text("Add customer")');
    await p.click('#sheet [aria-label=Close]');

    // leave + link inside a customer
    await p.click('.cust >> text=Neha Gupta'); await p.waitForSelector('#sheet h2:has-text("Leave / holiday")');
    const scrollSheetTo = (title) => p.evaluate((t) => { const b = document.querySelector('#sheet .sheet-body'); const c = [...document.querySelectorAll('#sheet h2')].find((x) => x.textContent.includes(t)).closest('.card'); b.scrollTop += c.getBoundingClientRect().top - b.getBoundingClientRect().top - 14; }, title);
    await scrollSheetTo('Leave / holiday');
    await p.fill('#sheet input[type=date] >> nth=2', addDays(today, 3)); await p.fill('#sheet input[type=date] >> nth=3', addDays(today, 5)); await blur(p);
    await prodUrl(p);
    await shot(p, 'sheet-leave');
    meta.boxes.sheetLeaveCard = await box(p, '#sheet .card:has(h2:has-text("Leave / holiday"))'); meta.boxes.sheetAddLeave = await box(p, '#sheet button:has-text("Add leave")');
    await p.click('#sheet button:has-text("Add leave")'); await p.waitForTimeout(3300);
    await scrollSheetTo('own leave link');
    await prodUrl(p);
    await shot(p, 'sheet-link');
    meta.boxes.sheetLinkCard = await box(p, '#sheet .card:has(h2:has-text("own leave link"))'); meta.boxes.sheetWhatsapp = await box(p, '#sheet a:has-text("WhatsApp")');
    await p.click('#sheet [aria-label=Close]');

    // settings: prices/closed days, then Telegram (the server has no real bot here, so show the connected-bot view with a placeholder name)
    await p.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const r = await route.fetch(); const j = await r.json();
      j.telegram = { configured: true, linked: false, bot: 'YourTiffinBot', code: 'K7QM4X2P' };
      route.fulfill({ response: r, json: j });
    });
    await p.click('nav.tabs >> text=Settings'); await p.waitForSelector('text=Save settings'); await p.waitForTimeout(300);
    await shot(p, 'settings-top');
    meta.boxes.settingsPrices = await box(p, '.card:has(h2:has-text("Price per box"))'); meta.boxes.settingsBusiness = await box(p, '.card:has(h2:has-text("Your business"))');
    await p.locator('.card:has(h2:has-text("Days you are closed"))').scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
    await p.evaluate(() => window.scrollBy(0, -120)); await p.click('.days label >> nth=0'); await blur(p);
    await shot(p, 'settings-days');
    meta.boxes.settingsDays = await box(p, '.card:has(h2:has-text("Days you are closed"))');
    await p.click('.days label >> nth=0'); // un-tick again
    await p.locator('.card:has(h2:has-text("Telegram alerts"))').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, 40));
    await shot(p, 'settings-tg');
    meta.boxes.tgCard = await box(p, '.card:has(h2:has-text("Telegram alerts"))'); meta.boxes.tgCode = await box(p, '.card:has(h2:has-text("Telegram alerts")) code');
    await p.unroute('**/api/settings');

    // grow: listing + ads
    await p.click('nav.tabs >> text=Grow'); await p.waitForSelector('text=Your marketplace listing'); await p.waitForTimeout(300);
    await shot(p, 'grow');
    meta.boxes.growToggle = await box(p, '.tagpick label >> nth=0'); meta.boxes.growListing = await box(p, 'form.card');
    await p.locator('.card:has(h2:has-text("Advertise"))').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    await shot(p, 'grow-ads');
    meta.boxes.growKpis = await box(p, '.kpis'); meta.boxes.growPlan = await box(p, '.plan');

    // ----- Telegram conversation (illustration built with the app's real bot wording)
    const cnt = (await A.call('GET', '/api/day')).counts;
    const rows = (await A.call('GET', '/api/day')).rows;
    const dateTxt = new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const html = `<!doctype html><meta name=viewport content="width=device-width"><style>
      body{margin:0;font:15px/1.4 -apple-system,Inter,system-ui,sans-serif;background:#c6d9b8;height:100vh;display:flex;flex-direction:column}
      .hd{background:#517da2;color:#fff;padding:12px 14px;display:flex;gap:12px;align-items:center}.av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#f76707,#f59f00);display:grid;place-items:center}
      .hd b{display:block;font-size:16px}.hd span{font-size:12px;opacity:.8}.chat{flex:1;padding:12px;display:flex;flex-direction:column;gap:8px;justify-content:flex-end}
      .m{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.12)}.me{align-self:flex-end;background:#e1ffc7;border-bottom-right-radius:4px}.bot{align-self:flex-start;background:#fff;border-bottom-left-radius:4px}
      .sys{align-self:center;background:rgba(0,0,0,.18);color:#fff;border-radius:99px;padding:3px 12px;font-size:12px}code{background:#f0f0f0;padding:0 4px;border-radius:4px}.bar{background:#fff;padding:12px 14px;color:#999}
    </style><div class=hd><div class=av>🍱</div><div><b>Tiffin Manager bot</b><span>bot</span></div></div>
    <div class=chat>
      <div class="m me">/start K7QM4X2P</div>
      <div class="m bot">✅ Connected to <b>Annapurna Tiffins</b>! You will get leave alerts and daily summaries here.\n\n/today — what to cook today\n/tomorrow — tomorrow's count\n/pending — left to deliver</div>
      <div class="m me">/today</div>
      <div class="m bot">🍱 Today — <b>${dateTxt}</b>\n\n🍱 Prepare <b>${cnt.boxes}</b> boxes\n• Normal: ${cnt.normal}\n• Deluxe: ${cnt.deluxe}</div>
    </div><div class=bar>Message</div>`;
    const tc = await browser.newContext(mobile); const t = await tc.newPage(); await t.setContent(html);
    await shot(t, 'tg-chat');
    meta.boxes.tgStart = await box(t, '.me >> nth=0'); meta.boxes.tgConnected = await box(t, '.bot >> nth=0'); meta.boxes.tgToday = await box(t, '.bot >> nth=1');

    // ----- customer: sign-up page (filled, not submitted), cancel leave, join-request dialog
    const c2 = await browser.newContext(mobile); const cs = await c2.newPage();
    await cs.goto(`${BASE}/signup?role=customer`);
    await cs.fill('input[type=tel]', '+91 90000 00004'); await cs.fill('input[type=password]', 'my-secret-pass'); await blur(cs);
    await shot(cs, 'signup-customer');
    meta.boxes.csFields = await box(cs, 'form.stack'); meta.boxes.csNote = await box(cs, '.note-box'); meta.boxes.csTabs = await box(cs, '.seg'); meta.boxes.csBtn = await box(cs, 'button:has-text("Create account")');

    const c3 = await browser.newContext(mobile); const cp = await c3.newPage();
    await cp.goto(`${BASE}/login?role=customer`); await cp.fill('input[type=tel]', '9000000004'); await cp.fill('input[type=password]', 'demo-pass-2'); await cp.click('button.primary');
    await cp.waitForSelector('text=Going on leave?');
    await cp.fill('input[type=date] >> nth=0', addDays(today, 1)); await cp.fill('input[type=date] >> nth=1', addDays(today, 3));
    await cp.click('text=Mark my leave'); await cp.waitForSelector('text=Your leaves'); await cp.waitForTimeout(3300);
    await shot(cp, 'portal-cancel');
    meta.boxes.cancelBtn = await box(cp, 'button:has-text("Cancel")'); meta.boxes.leavesList = await box(cp, '.card.stack >> text=Your leaves');

    const c4 = await browser.newContext(mobile); const f = await c4.newPage();
    await f.goto(`${BASE}/find?q=411045`); await f.waitForSelector('.rcard'); await f.waitForTimeout(1200);
    await f.locator('.rcard:has(h3:has-text("Sai Home Tiffins")) button:has-text("Request to join")').click();
    await f.fill('#sheet input[type=text] >> nth=0', 'Sunita Rao'); await f.fill('#sheet input[type=tel]', '9000000004'); await blur(f);
    await shot(f, 'enquiry');
    meta.boxes.enqSend = await box(f, '#sheet button:has-text("Send request")'); meta.boxes.enqForm = await box(f, '#sheet form');
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'meta-howto.json'), JSON.stringify(meta, null, 1));
    console.log('howto assets ok', Object.keys(meta.boxes).length, 'boxes');
  } finally {
    server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
