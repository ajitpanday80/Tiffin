import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/logic.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 47500 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-cust-'));
let proc;
const call = async (method, url, body, cookie) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const signup = async (role, phone, extra = {}) => (await call('POST', '/api/signup', { role, phone, password: 'first-pass', ...extra })).cookie;
const today = L.todayStr();
const tomorrow = L.addDays(today, 1);

before(async () => {
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

let A, B, custA, custB, cust;
test('one provider cannot hold the same phone number twice', async () => {
  A = await signup('provider', '9811100301', { businessName: 'Kitchen A' });
  B = await signup('provider', '9811100302', { businessName: 'Kitchen B' });
  const first = await call('POST', '/api/customers', { name: 'Asha', phone: '98765 43210' }, A);
  assert.equal(first.status, 200);
  assert.ok(first.body.createdAt > 0);
  custA = first.body;
  const dup = await call('POST', '/api/customers', { name: 'Asha again', phone: '+91 9876543210' }, A);
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /Asha already has this phone number/);
  const other = (await call('POST', '/api/customers', { name: 'Ravi', phone: '9000000001' }, A)).body;
  assert.equal((await call('PUT', `/api/customers/${other.id}`, { name: 'Ravi', phone: '9876543210' }, A)).status, 409); // editing into a duplicate
  assert.equal((await call('PUT', `/api/customers/${other.id}`, { name: 'Ravi K', phone: '9000000001' }, A)).status, 200); // same number is fine
  assert.equal((await call('POST', '/api/customers', { name: 'No phone 1' }, A)).status, 200);
  assert.equal((await call('POST', '/api/customers', { name: 'No phone 2' }, A)).status, 200); // blank numbers never clash
});

test('two providers may add the same person; the customer sees both and is bound to neither', async () => {
  const b = await call('POST', '/api/customers', { name: 'Asha K', phone: '9876543210', type: 'deluxe' }, B); // same person, other provider: allowed
  assert.equal(b.status, 200);
  custB = b.body;
  cust = await signup('customer', '9876543210');
  const my = (await call('GET', '/api/my', null, cust)).body;
  assert.equal(my.subscriptions.length, 2);
  assert.deepEqual(my.subscriptions.map((s) => s.businessName).sort(), ['Kitchen A', 'Kitchen B']);
  assert.ok(my.subscriptions.every((s) => s.ended === false && s.stopping === false && s.addedAt > 0));
});

test('customer can mark leave with all providers at once', async () => {
  const r = await call('POST', '/api/my/leaves', { from: L.addDays(today, 3), to: L.addDays(today, 4) }, cust);
  assert.equal(r.status, 200);
  assert.equal(r.body.applied, 2);
  assert.deepEqual(r.body.skipped, []);
  for (const [cookie, c] of [[A, custA], [B, custB]]) {
    const d = (await call('GET', `/api/day?date=${L.addDays(today, 3)}`, null, cookie)).body;
    assert.equal(d.rows.find((x) => x.id === c.id).status, 'leave');
  }
  assert.equal((await call('POST', '/api/my/leaves', { from: today, to: today }, cust)).status, 400); // before everyone's cut-off
  assert.equal((await call('POST', '/api/my/leaves', { from: '2026-13-40', to: '2026-13-41' }, cust)).status, 400);
});

test('customer can stop with one provider, which is told; the other is untouched; undo works until the last day', async () => {
  const subA = (await call('GET', '/api/my', null, cust)).body.subscriptions.find((s) => s.businessName === 'Kitchen A');
  assert.equal(subA.stopMin, today); // with the default cut-off, today is the earliest "last day"
  assert.equal((await call('POST', `/api/my/${subA.tid}/${subA.cid}/stop`, { lastDay: L.addDays(today, -1) }, cust)).status, 400);
  assert.equal((await call('POST', `/api/my/${subA.tid}/${subA.cid}/stop`, { lastDay: L.addDays(today, 400) }, cust)).status, 400);
  const last = L.addDays(today, 5);
  const stopped = await call('POST', `/api/my/${subA.tid}/${subA.cid}/stop`, { lastDay: last }, cust);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.stopping, true);
  assert.equal(stopped.body.endedBy, 'customer');
  // provider A sees who ended it and when; provider B sees nothing changed
  const listA = (await call('GET', '/api/customers', null, A)).body.customers.find((c) => c.id === custA.id);
  assert.equal(listA.endDate, last);
  assert.equal(listA.endedBy, 'customer');
  const listB = (await call('GET', '/api/customers', null, B)).body.customers.find((c) => c.id === custB.id);
  assert.equal(listB.endDate, '');
  // today's count still includes them until the last day; afterwards they are gone
  assert.ok((await call('GET', `/api/day?date=${last}`, null, A)).body.rows.some((r) => r.id === custA.id));
  assert.ok(!(await call('GET', `/api/day?date=${L.addDays(last, 1)}`, null, A)).body.rows.some((r) => r.id === custA.id));
  // undo
  const back = await call('POST', `/api/my/${subA.tid}/${subA.cid}/resume`, {}, cust);
  assert.equal(back.status, 200);
  assert.equal(back.body.stopping, false);
  assert.equal((await call('GET', '/api/customers', null, A)).body.customers.find((c) => c.id === custA.id).endDate, '');
  assert.equal((await call('POST', `/api/my/${subA.tid}/${subA.cid}/resume`, {}, cust)).status, 400); // nothing left to undo
});

test('an end date set by the provider cannot be undone by the customer; ended services move to "past" and free the number', async () => {
  const subB = (await call('GET', '/api/my', null, cust)).body.subscriptions.find((s) => s.businessName === 'Kitchen B');
  await call('PUT', `/api/customers/${custB.id}`, { name: 'Asha K', phone: '9876543210', type: 'deluxe', endDate: L.addDays(today, 2) }, B);
  assert.equal((await call('POST', `/api/my/${subB.tid}/${subB.cid}/resume`, {}, cust)).status, 400);
  // a service whose last day has passed is "ended"
  await call('PUT', `/api/customers/${custB.id}`, { name: 'Asha K', phone: '9876543210', type: 'deluxe', startDate: L.addDays(today, -30), endDate: L.addDays(today, -1) }, B);
  const sub = (await call('GET', '/api/my', null, cust)).body.subscriptions.find((s) => s.businessName === 'Kitchen B');
  assert.equal(sub.ended, true);
  assert.equal((await call('POST', `/api/my/${subB.tid}/${subB.cid}/stop`, {}, cust)).status, 400);
  assert.equal((await call('POST', '/api/customers', { name: 'Asha (again)', phone: '9876543210' }, B)).status, 200); // the old, ended record no longer blocks the number
  // leave-for-all now only reaches the active ones
  const r = await call('POST', '/api/my/leaves', { from: L.addDays(today, 9), to: L.addDays(today, 9) }, cust);
  assert.equal(r.body.applied, 2); // Kitchen A + Kitchen B's new record
});

test('customers cannot touch another customer\'s subscription', async () => {
  const C = await signup('provider', '9811100303', { businessName: 'Kitchen C' });
  await call('POST', '/api/customers', { name: 'Someone else', phone: '9876500000' }, C);
  const other = await signup('customer', '9876500000'); // a different person, subscribed only to Kitchen C
  const subA = (await call('GET', '/api/my', null, cust)).body.subscriptions[0];
  assert.equal((await call('POST', `/api/my/${subA.tid}/${subA.cid}/stop`, {}, other)).status, 404);
  const mine = (await call('POST', '/api/my/leaves', { from: L.addDays(today, 8), to: L.addDays(today, 8) }, other)).body;
  assert.equal(mine.applied, 1); // only their own service, never Kitchen A or B
});

test('marketplace marks services the customer already has, and a switch only happens once the new provider accepts', async () => {
  const P = await signup('provider', '9811100401', { businessName: 'Old Kitchen' });
  const Q = await signup('provider', '9811100402', { businessName: 'New Kitchen' });
  const listing = { enabled: true, area: 'Baner', city: 'Pune', pincode: '411045', radiusKm: 8, lat: 18.56, lng: 73.78 };
  assert.equal((await call('PUT', '/api/listing', listing, P)).body.visibility.level, 'ok');
  const q = (await call('PUT', '/api/listing', listing, Q)).body;
  await call('POST', '/api/customers', { name: 'Mina', phone: '9123400001' }, P);
  const me = await signup('customer', '9123400001');
  const near = { lat: 18.56, lng: 73.78 };
  const find = (cookie) => call('GET', `/api/market/search?lat=${near.lat}&lng=${near.lng}`, null, cookie);

  const anon = (await find()).body.results;
  assert.ok(anon.every((r) => r.joined === ''), 'anonymous visitors see no "joined" marks');
  const mine = (await find(me)).body.results;
  assert.equal(mine.find((r) => r.name === 'Old Kitchen').joined, 'active');
  assert.equal(mine.find((r) => r.name === 'New Kitchen').joined, '');
  const sub = (await call('GET', '/api/my', null, me)).body.subscriptions[0];

  // already with them: refused. Switching to the same provider: refused
  const oldLid = mine.find((r) => r.name === 'Old Kitchen').id;
  assert.equal((await call('POST', `/api/market/${oldLid}/enquire`, { name: 'Mina', phone: '9123400001' }, me)).status, 409);

  const start = L.addDays(today, 5);
  const req = await call('POST', `/api/market/${q.id}/enquire`, { name: 'Mina', phone: '9123400001', startDate: start, switchFrom: { tid: sub.tid, cid: sub.cid } }, me);
  assert.equal(req.status, 200);
  assert.equal((await call('GET', '/api/my', null, me)).body.requests[0].businessName, 'New Kitchen');
  // the old provider is untouched while the request is pending, and the new one cannot see who they are leaving
  assert.equal((await call('GET', '/api/customers', null, P)).body.customers[0].endDate, '');
  const enq = (await call('GET', '/api/enquiries', null, Q)).body.enquiries[0];
  assert.equal(enq.switching, true);
  assert.equal(enq.startDate, start);
  assert.equal(JSON.stringify(enq).includes(sub.tid), false);

  assert.equal((await call('POST', `/api/enquiries/${enq.id}/accept`, {}, Q)).status, 200);
  assert.equal((await call('GET', '/api/customers', null, P)).body.customers[0].endDate, L.addDays(start, -1));
  const subs = (await call('GET', '/api/my', null, me)).body;
  assert.equal(subs.requests.length, 0);
  assert.deepEqual(subs.subscriptions.map((s) => s.businessName).sort(), ['New Kitchen', 'Old Kitchen']);
  assert.equal((await call('GET', '/api/customers', null, Q)).body.customers[0].startDate, start);
});

test('a join request can be cancelled by the customer; a provider listed by pincode only is flagged', async () => {
  const R = await signup('provider', '9811100403', { businessName: 'Pin Kitchen' });
  const only = (await call('PUT', '/api/listing', { enabled: true, area: 'Aundh', pincode: '411007', radiusKm: 5 }, R)).body;
  assert.equal(only.visibility.level, 'warn'); // no coordinates (geocoder is off in tests): found by pincode only
  assert.equal((await call('PUT', '/api/listing', { enabled: false, area: 'Aundh', pincode: '411007' }, R)).body.visibility.level, 'off');
  const S = await signup('provider', '9811100404', { businessName: 'Cancel Kitchen' });
  const lid = (await call('PUT', '/api/listing', { enabled: true, area: 'Kothrud', pincode: '411038', radiusKm: 5, lat: 18.5, lng: 73.8 }, S)).body.id;
  await call('POST', '/api/customers', { name: 'Zed', phone: '9123400002' }, R);
  const me = await signup('customer', '9123400002');
  await call('POST', `/api/market/${lid}/enquire`, { name: 'Zed', phone: '9123400002' }, me);
  const r = (await call('GET', '/api/my', null, me)).body.requests[0];
  assert.equal((await call('DELETE', `/api/my/requests/${r.tid}/${r.id}`, {}, me)).body.requests.length, 0);
  assert.equal((await call('GET', '/api/enquiries', null, S)).body.enquiries.length, 0);
});
