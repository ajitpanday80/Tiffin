import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Geocoder, haversineKm, snap } from '../lib/geo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 43000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-market-'));
let proc;

const call = async (method, url, body, cookie) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const signup = async (phone, name) => (await call('POST', '/api/signup', { role: 'provider', phone, password: 'abcdef', businessName: name })).cookie;

before(async () => {
  const mk = spawnSync(process.execPath, ['scripts/make-admin.js', '9000000000', 'adminpass1'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir } });
  assert.equal(mk.status, 0, String(mk.stderr));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: dir, GEOCODER: 'off', TELEGRAM_BOT_TOKEN: '' } });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('running') && res());
    proc.on('exit', (c) => rej(new Error(`server exited ${c}`)));
  });
});
after(() => {
  proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const list = (cookie, body) => call('PUT', '/api/listing', { enabled: true, area: 'Baner', city: 'Pune', tagline: 'Home food', tags: ['veg'], meals: ['lunch'], radiusKm: 5, ...body }, cookie);
const search = async (q) => (await call('GET', `/api/market/search?${new URLSearchParams(q)}`)).body;

let A, B, C, admin;
test('geo helpers', () => {
  assert.ok(Math.abs(haversineKm({ lat: 18.56, lng: 73.78 }, { lat: 18.57, lng: 73.78 }) - 1.11) < 0.05);
  assert.equal(snap(18.566468), 18.57);
});

test('listing validation + coarse location', async () => {
  A = await signup('9811100011', 'Kitchen A');
  assert.equal((await call('PUT', '/api/listing', { enabled: true, area: '' }, A)).status, 400); // no area
  assert.equal((await call('PUT', '/api/listing', { enabled: true, area: 'Baner' }, A)).status, 400); // no location / pincode
  assert.equal((await list(A, { pincode: '41x' })).status, 400);
  const ok = await list(A, { pincode: '411045', lat: 18.5604321, lng: 73.7801234 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lat, 18.56); // snapped to ~1km, exact spot is never stored
  assert.equal(ok.body.lng, 73.78);
  B = await signup('9811100012', 'Kitchen B');
  await list(B, { pincode: '411045', lat: 18.57, lng: 73.78, radiusKm: 8 });
  C = await signup('9811100013', 'Kitchen C Mumbai');
  await list(C, { pincode: '400001', lat: 19.07, lng: 72.87, radiusKm: 25 });
});

test('search is nearest-first, radius-limited and never leaks coordinates', async () => {
  const r = await search({ lat: 18.561, lng: 73.78 });
  assert.deepEqual(r.results.map((x) => x.name), ['Kitchen A', 'Kitchen B']); // Mumbai kitchen is far outside its radius
  assert.equal(r.results[0].distanceKm, 0.5);
  assert.ok(!JSON.stringify(r).includes('18.56'));
  assert.ok(!('lat' in r.results[0]));
  assert.equal((await search({ lat: 12.9, lng: 77.6 })).results.length, 0);
  assert.equal((await call('GET', '/api/market/search')).status, 400);
});

test('pincode search works without the geocoder', async () => {
  const r = await search({ q: '411045' });
  assert.equal(r.mode, 'pincode');
  assert.deepEqual(r.results.map((x) => x.name).sort(), ['Kitchen A', 'Kitchen B']);
  assert.equal((await search({ q: '411099' })).results.length, 2); // same 3-digit area, labelled as area match
  assert.equal((await search({ q: '411099' })).results[0].match, 'area');
  assert.equal((await search({ q: '560001' })).results.length, 0);
});

test('plans, ad orders and admin approval', async () => {
  const login = await call('POST', '/api/login', { role: 'admin', phone: '9000000000', password: 'adminpass1' });
  assert.equal(login.status, 200);
  admin = login.cookie;
  assert.equal((await call('GET', '/api/admin/overview', null, A)).status, 403); // providers are not admins
  assert.equal((await call('POST', '/api/signup', { role: 'admin', phone: '9111111111', password: 'abcdef' })).status, 400);
  assert.equal((await call('GET', '/api/ads', null, B)).body.plans.length, 0);
  assert.equal((await call('POST', '/api/ads/order', { planId: 'nope' }, B)).status, 404);

  const plans = (await call('POST', '/api/admin/plans', { name: 'Local 30 days', days: 30, radiusKm: 2, price: 499 }, admin)).body.plans;
  assert.equal(plans.length, 1);
  const order = (await call('POST', '/api/ads/order', { planId: plans[0].id }, B)).body;
  assert.equal(order.status, 'pending');
  assert.match(order.ref, /^AD-/);
  // not sponsored until the admin confirms payment
  assert.equal((await search({ lat: 18.561, lng: 73.78 })).results.some((x) => x.sponsored), false);
  assert.equal((await call('POST', `/api/admin/orders/${order.id}/paid`, {}, A)).status, 403);
  await call('POST', `/api/admin/orders/${order.id}/paid`, {}, admin);
  const mine = (await call('GET', '/api/ads', null, B)).body;
  assert.equal(mine.active.status, 'paid');
  assert.ok(mine.active.endsAt - mine.active.startsAt === 30 * 864e5);
});

test('ads only show to customers near the advertiser', async () => {
  // 1) customer ~1km from B (inside the 2 km ad radius): B is sponsored and ranks first even though A is nearer
  const near = await search({ lat: 18.561, lng: 73.78 });
  assert.deepEqual(near.results.map((x) => [x.name, x.sponsored]), [['Kitchen B', true], ['Kitchen A', false]]);
  // 2) customer ~5 km from B (inside B's service radius but outside the 2 km ad radius): no sponsored boost
  const mid = await search({ lat: 18.52, lng: 73.78 });
  assert.deepEqual(mid.results.map((x) => [x.name, x.sponsored]), [['Kitchen A', false], ['Kitchen B', false]]);
  // 3) the Mumbai kitchen can never be shown to a Pune customer, ad or not
  assert.ok(![...near.results, ...mid.results].some((x) => x.name.includes('Mumbai')));
  // 4) pincode-only mode: ads need an exact pincode match
  assert.equal((await search({ q: '411099' })).results.some((x) => x.sponsored), false);
  assert.equal((await search({ q: '411045' })).results[0].sponsored, true);
});

test('stats, clicks and suspension', async () => {
  const lid = (await call('GET', '/api/listing', null, B)).body.id;
  assert.equal((await call('POST', `/api/market/${lid}/click`, { type: 'call' })).status, 200);
  await call('POST', `/api/market/${lid}/click`, { type: 'call' }); // same person within the hour: not double counted
  assert.equal((await call('POST', `/api/market/${lid}/click`, { type: 'hack' })).status, 400);
  const st = (await call('GET', '/api/ads', null, B)).body.stats;
  assert.equal(st.call, 1);
  assert.ok(st.imp > 0 && st.spImp > 0);

  const tid = (await call('GET', '/api/admin/overview', null, admin)).body.listings.find((l) => l.name === 'Kitchen B').tid;
  await call('POST', `/api/admin/listings/${tid}/suspend`, { suspended: true }, admin);
  assert.ok(!(await search({ lat: 18.561, lng: 73.78 })).results.some((x) => x.name === 'Kitchen B'));
  assert.equal((await call('POST', `/api/market/${lid}/click`, { type: 'view' })).status, 404);
  await call('POST', `/api/admin/listings/${tid}/suspend`, { suspended: false }, admin);
});

test('enquiries flow into the provider CRM', async () => {
  const lid = (await call('GET', '/api/listing', null, A)).body.id;
  assert.equal((await call('POST', `/api/market/${lid}/enquire`, { name: '', phone: '9822200001' })).status, 400);
  assert.equal((await call('POST', `/api/market/${lid}/enquire`, { name: 'Meera', phone: '12' })).status, 400);
  assert.equal((await call('POST', `/api/market/${lid}/enquire`, { name: 'Meera <b>', phone: '98222 00001', address: 'Flat 4, Baner', type: 'deluxe' })).status, 200);
  await call('POST', `/api/market/${lid}/enquire`, { name: 'Meera again', phone: '9822200001' }); // duplicate is ignored
  const inbox = (await call('GET', '/api/enquiries', null, A)).body.enquiries;
  assert.equal(inbox.length, 1);
  assert.equal((await call('GET', '/api/enquiries', null, B)).body.enquiries.length, 0);
  const cust = (await call('POST', `/api/enquiries/${inbox[0].id}/accept`, {}, A)).body;
  assert.equal(cust.type, 'deluxe');
  assert.equal((await call('GET', '/api/customers', null, A)).body.customers.length, 1);
  assert.equal((await call('GET', '/api/enquiries', null, A)).body.enquiries.length, 0);
});

test('geocoder caches and survives failures', async () => {
  const store = { db: { platform: { geocache: {} } }, save() {} };
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => [{ lat: '18.5', lon: '73.8', display_name: 'Baner, Pune, Maharashtra, India' }] }; };
  const g = new Geocoder({ store, fetchImpl, minGapMs: 0 });
  assert.deepEqual(await g.lookup('411045'), { lat: 18.5, lng: 73.8, label: 'Baner, Pune, Maharashtra' });
  await g.lookup('411045');
  assert.equal(calls, 1);
  const bad = new Geocoder({ store: { db: { platform: { geocache: {} } }, save() {} }, fetchImpl: async () => { throw new Error('down'); }, minGapMs: 0 });
  assert.equal(await bad.lookup('x'), null);
  assert.equal(await new Geocoder({ store, enabled: false }).lookup('zzz'), null);
});

test('blog, help, sitemap and robots', async () => {
  const get = async (u) => { const r = await fetch(BASE + u); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const index = await get('/blog');
  assert.equal(index.status, 200);
  assert.match(index.text, /Stop cooking for empty doorsteps/);
  const prov = await get('/blog?for=customers');
  assert.match(prov.text, /How to choose a tiffin service/);
  assert.doesNotMatch(prov.text, /Stop cooking for empty doorsteps/);
  const post = await get('/blog/telegram-alerts-for-your-tiffin-business');
  assert.equal(post.status, 200);
  assert.match(post.text, /<h2 id="connect-in-five-steps">/);
  assert.match(post.text, /<code>\/start YOURCODE<\/code>/);
  assert.match(post.text, /rel="canonical"/);
  assert.equal((await get('/blog/nope')).status, 404);
  assert.equal((await get('/blog/..%2Fserver')).status, 404);
  const help = await get('/help');
  assert.equal(help.status, 200);
  assert.match(help.text, /id="telegram-owner"/);
  const sm = await get('/sitemap.xml');
  assert.match(sm.type, /xml/);
  assert.match(sm.text, /\/blog\/how-to-choose-a-tiffin-service/);
  assert.match((await get('/robots.txt')).text, /Disallow: \/admin/);
});

test('blog renderer escapes HTML and ignores unsafe links', async () => {
  const { md } = await import('../lib/blog.js');
  const out = md('Hello <script>alert(1)</script> **bold** [ok](/find) [bad](javascript:alert(1))');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<a href="\/find">ok<\/a>/);
  assert.doesNotMatch(out, /href="javascript/);
});

test('videos are served with Range support (needed for seeking / Safari)', async () => {
  const head = await fetch(`${BASE}/videos/provider.mp4`);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const total = Number(head.headers.get('content-length'));
  await head.arrayBuffer();
  const part = await fetch(`${BASE}/videos/provider.mp4`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-99/${total}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await fetch(`${BASE}/videos/provider.mp4`, { headers: { Range: 'bytes=-50' } });
  assert.equal((await tail.arrayBuffer()).byteLength, 50);
  const bad = await fetch(`${BASE}/videos/provider.mp4`, { headers: { Range: `bytes=${total + 5}-` } });
  assert.equal(bad.status, 416);
});

test('without a Telegram token the pages still show @tiffincrm_bot, never a raw placeholder', async () => {
  const help = await (await fetch(`${BASE}/help`)).text();
  assert.doesNotMatch(help, /\{\{BOT/);
  assert.match(help, /search for <b>@tiffincrm_bot<\/b>/);
  assert.match(help, /href="https:\/\/t\.me\/tiffincrm_bot">open it directly/);
  const post = await (await fetch(`${BASE}/blog/telegram-alerts-for-your-tiffin-business`)).text();
  assert.match(post, /<strong>@tiffincrm_bot<\/strong>/);
});

test('brand assets: favicon set, manifest icons and social image tags are all present and served', async () => {
  const bin = async (u) => { const r = await fetch(BASE + u); return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; };
  const ico = await bin('/favicon.ico');
  assert.equal(ico.status, 200);
  assert.equal(ico.type, 'image/x-icon');
  assert.deepEqual([...ico.buf.subarray(0, 4)], [0, 0, 1, 0]); // ICO header
  assert.ok(ico.buf.readUInt16LE(4) >= 3); // 16, 32 and 48 px
  for (const f of ['/favicon.svg', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/brand/logo.svg', '/brand/logo-reversed.svg', '/og-image.png']) {
    assert.equal((await bin(f)).status, 200, f);
  }
  const png = (await bin('/apple-touch-icon.png')).buf;
  assert.equal(png.readUInt32BE(16), 180); // width
  const manifest = JSON.parse((await bin('/manifest.webmanifest')).buf.toString());
  assert.equal(manifest.name, 'MyTiffin');
  for (const i of manifest.icons) assert.equal((await bin(i.src)).status, 200, i.src);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  const home = await (await fetch(`${BASE}/`)).text();
  assert.match(home, /rel="icon" href="\/favicon\.svg"/);
  assert.match(home, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(home, /property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/og-image\.png"/); // {{BASE}} filled in
  const post = await (await fetch(`${BASE}/blog/how-to-choose-a-tiffin-service`)).text();
  assert.match(post, /property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/og-image\.png"/);
});
