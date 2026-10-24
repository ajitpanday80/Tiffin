// Seeds a demo kitchen on a throwaway server and captures real app screenshots for the promo videos.
// Usage: node promo/build-assets.cjs   (needs Playwright + Chromium; uses a temp data dir and port 4600)
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'assets');
const PORT = 4600;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-promo-'));
fs.mkdirSync(OUT, { recursive: true });

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return ymd(x); };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body) {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const j = await r.json();
    if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
    return j;
  }
}

const CUSTOMERS = [
  ['Ramesh Sharma', '9000000001', 'B-402, Sai Heights, Baner', 'normal', 1],
  ['Priya Nair', '9000000002', '12 Lotus Apartments, Aundh', 'deluxe', 2],
  ['Amit Kulkarni', '9000000003', 'Flat 7, Green Park, Balewadi', 'normal', 1],
  ['Sunita Rao', '9000000004', 'A-301, Orchid Residency, Baner', 'deluxe', 1],
  ['Kavita Joshi', '9000000005', '5 Shivaji Nagar Lane, Pashan', 'normal', 1],
  ['Rahul Verma', '9000000006', 'C-12, Sky Towers, Aundh', 'normal', 1],
  ['Neha Gupta', '9000000007', '204 Rose Court, Baner', 'deluxe', 1],
  ['Vikram Patil', '9000000008', 'D-8, Palm Grove, Wakad', 'normal', 1],
  ['Anita Desai', '9000000009', 'Flat 3, Maple Heights, Baner', 'normal', 1],
  ['Sandeep More', '9000000010', 'B-105, Lake View, Balewadi', 'deluxe', 1],
  ['Meera Iyer', '9000000011', '9 Garden Residency, Aundh', 'normal', 1],
  ['Arjun Singh', '9000000012', 'F-2, Royal Palms, Baner', 'normal', 1],
  ['Pooja Shetty', '9000000013', '17 Hill Side, Pashan', 'normal', 1],
  ['Kiran Bhosale', '9000000014', 'E-6, Silver Oak, Wakad', 'normal', 1],
];

(async () => {
  const mk = spawnSync(process.execPath, ['scripts/make-admin.js', '9111111111', 'promo-admin-pass'], { cwd: ROOT, env: { ...process.env, DATA_DIR: DATA } });
  if (mk.status) throw new Error(String(mk.stderr));
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, TZ: 'Asia/Kolkata' } });
  await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('running') && res()); server.on('exit', rej); });
  const meta = {};
  try {
    // ---- main demo provider
    const A = new Client();
    await A.call('POST', '/api/signup', { role: 'provider', phone: '9811100001', password: 'demo-pass-1', businessName: 'Annapurna Tiffins' });
    await A.call('PUT', '/api/settings', { businessName: 'Annapurna Tiffins', businessPhone: '9811100001', prices: { normal: 80, deluxe: 120 } });
    const today = (await A.call('GET', '/api/day')).today;
    const ids = {};
    for (const [name, phone, address, type, qty] of CUSTOMERS) {
      const c = await A.call('POST', '/api/customers', { name, phone, address, type, qty, startDate: addDays(today, -30) });
      ids[name] = c.id;
    }
    // two customers on leave today and tomorrow; a few historic leaves
    for (const n of ['Anita Desai', 'Pooja Shetty']) await A.call('POST', `/api/customers/${ids[n]}/leaves`, { from: today, to: addDays(today, 1) });
    await A.call('POST', `/api/customers/${ids['Kavita Joshi']}/leaves`, { from: addDays(today, -12), to: addDays(today, -9) });
    await A.call('POST', `/api/customers/${ids['Vikram Patil']}/leaves`, { from: addDays(today, -6), to: addDays(today, -5) });
    // history for the month so reports look real: deliver every day except leave days, with a rare miss
    const monthStart = today.slice(0, 8) + '01';
    let i = 0;
    for (let d = monthStart; d < today; d = addDays(d, 1)) {
      for (const [name] of CUSTOMERS) {
        i++;
        if (i % 37 === 0) continue; // an occasional missed delivery
        try { await A.call('POST', '/api/deliver', { date: d, customerId: ids[name], delivered: true }); } catch { /* on leave that day */ }
      }
    }
    // today: deliver to every other customer (not on leave) so the list is half done
    const day0 = await A.call('GET', '/api/day');
    const pendingNow = day0.rows.filter((r) => r.status === 'pending');
    for (const r of pendingNow.filter((_, k) => k % 2 === 1)) await A.call('POST', '/api/deliver', { date: today, customerId: r.id, delivered: true });

    // ---- other providers in the marketplace
    const others = [
      ['Sai Home Tiffins', '9811100022', 'Baner', '411045', 18.57, 73.79, 8, ['veg', 'home-style'], ['lunch', 'dinner'], 'Hot, home-style thalis for working people', 90, 140],
      ['Maa Ki Rasoi', '9811100033', 'Balewadi', '411045', 18.58, 73.77, 6, ['veg', 'jain'], ['lunch'], 'Pure veg and Jain meals, less oil', 85, 130],
      ['Spice Route Tiffins', '9811100044', 'Pashan', '411021', 18.54, 73.79, 8, ['veg', 'non-veg'], ['lunch', 'dinner'], 'Variety every day, veg and non-veg', 95, 150],
    ];
    const clients = {};
    for (const [name, phone, area, pin, lat, lng, radius, tags, meals, tag, pn, pd] of others) {
      const c = new Client();
      await c.call('POST', '/api/signup', { role: 'provider', phone, password: 'demo-pass-1', businessName: name });
      await c.call('PUT', '/api/settings', { businessName: name, businessPhone: phone, prices: { normal: pn, deluxe: pd } });
      await c.call('PUT', '/api/listing', { enabled: true, tagline: tag, about: '', tags, meals, area, city: 'Pune', pincode: pin, radiusKm: radius, lat, lng });
      clients[name] = c;
    }
    await A.call('PUT', '/api/listing', { enabled: true, tagline: 'Fresh veg meals delivered hot', tags: ['veg'], meals: ['lunch'], area: 'Baner', city: 'Pune', pincode: '411045', radiusKm: 6, lat: 18.56, lng: 73.78 });
    // one advertiser (Sai Home Tiffins): plan -> order -> admin confirms payment
    const admin = new Client();
    await admin.call('POST', '/api/login', { role: 'admin', phone: '9111111111', password: 'promo-admin-pass' });
    const plan = (await admin.call('POST', '/api/admin/plans', { name: 'Local boost', days: 30, radiusKm: 3, price: 499 })).plans[0];
    const order = await clients['Sai Home Tiffins'].call('POST', '/api/ads/order', { planId: plan.id });
    await admin.call('POST', `/api/admin/orders/${order.id}/paid`);

    // ---- numbers for the Telegram bubble (real values from the app)
    const tomorrow = addDays(today, 1);
    // the leave starts tomorrow, because the real bot message only includes a box count for today/tomorrow
    const before = (await A.call('GET', `/api/day?date=${tomorrow}`)).counts;
    meta.leave = { from: tomorrow, to: addDays(today, 3) };
    const S = new Client();
    await S.call('POST', '/api/signup', { role: 'customer', phone: '9000000004', password: 'demo-pass-2' });

    // ---- screenshots
    const browser = await chromium.launch();
    const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata' };
    const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
    const box = async (page, sel, nth = 0) => { const b = await page.locator(sel).nth(nth).boundingBox(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2)); };
    const login = async (page, role, phone, pass) => {
      await page.goto(`${BASE}/login?role=${role}`);
      await page.fill('input[type=tel]', phone); await page.fill('input[type=password]', pass);
      await page.click('button.primary');
    };
    meta.boxes = {};

    // provider screens
    const pc = await browser.newContext(mobile); const p = await pc.newPage();
    await login(p, 'provider', '9811100001', 'demo-pass-1');
    await p.waitForSelector('.hero-num');
    await shot(p, 'today');
    meta.boxes.todayHero = await box(p, '.hero');
    meta.boxes.todayProgress = await box(p, '.progress-txt');
    meta.boxes.deliverBtn = await box(p, '.row button:has-text("Delivered ✓")');
    meta.boxes.firstCard = await box(p, 'article.row');
    meta.today = { ...(await A.call('GET', '/api/day')).counts };
    await p.locator('.row button:has-text("Delivered ✓")').first().click();
    await p.waitForTimeout(3300); // the app's toast lasts ~2.8 s; keep it out of the screenshots
    await shot(p, 'today-after');
    meta.todayAfter = { ...(await A.call('GET', '/api/day')).counts };
    await p.click('nav.tabs >> text=Reports'); await p.waitForSelector('.stats');
    await shot(p, 'reports');
    meta.boxes.reportsStats = await box(p, '.stats');
    meta.boxes.reportsBars = await box(p, '.bars');
    meta.boxes.reportsFirst = await box(p, 'article.rep');
    await p.click('nav.tabs >> text=Customers'); await p.waitForSelector('.cust');
    await shot(p, 'customers');

    // customer portal (Sunita) marks leave for real
    const cc = await browser.newContext(mobile); const c = await cc.newPage();
    await login(c, 'customer', '9000000004', 'demo-pass-2');
    await c.waitForSelector('text=Going on leave?');
    await c.fill('input[type=date] >> nth=0', meta.leave.from); await c.fill('input[type=date] >> nth=1', meta.leave.to);
    await c.evaluate(() => document.activeElement && document.activeElement.blur());
    await shot(c, 'portal');
    meta.boxes.portalForm = await box(c, 'form');
    meta.boxes.portalBtn = await box(c, 'button:has-text("Mark my leave")');
    meta.boxes.portalDates = await box(c, '.grid2');
    await c.click('text=Mark my leave'); await c.waitForSelector('text=Your leaves');
    await c.waitForTimeout(2800); // let the toast disappear
    await shot(c, 'portal-after');
    meta.boxes.portalLeaves = await box(c, 'text=Your leaves');
    const after = (await A.call('GET', `/api/day?date=${meta.leave.from}`)).counts;
    meta.today.date = today;
    meta.tomorrow = { before: before.boxes, after: after.boxes, normal: after.normal, deluxe: after.deluxe, from: meta.leave.from, to: meta.leave.to, leaveDays: 3 };

    // marketplace
    const fc = await browser.newContext(mobile); const f = await fc.newPage();
    await f.goto(`${BASE}/find`); await f.fill('#q', '411045'); await shot(f, 'find-start');
    meta.boxes.findSearch = await box(f, '#form');
    await f.click('#form button'); await f.waitForSelector('.rcard');
    await f.waitForTimeout(1500);
    await shot(f, 'find-results');
    meta.boxes.findFirstCard = await box(f, '.rcard');
    meta.boxes.findSponsored = await box(f, '.spon');
    meta.boxes.findJoinBtn = await box(f, '.rcard >> nth=0 >> button:has-text("Request to join")');
    meta.boxes.findActions = await box(f, '.rcard >> nth=0 >> .ractions');
    meta.findOrder = await f.$$eval('.rcard', (els) => els.map((e) => [e.querySelector('h3').textContent, !!e.querySelector('.spon')]));
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
    console.log(JSON.stringify({ today: meta.today, todayAfter: meta.todayAfter, tomorrow: meta.tomorrow, find: meta.findOrder }, null, 1));
  } finally {
    server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
