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
