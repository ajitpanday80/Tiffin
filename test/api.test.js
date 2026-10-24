import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../lib/logic.js';

const PORT = 41000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-'));
let proc;
let cookie = '';

const call = async (method, url, body, { auth = true, as } = {}) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(as ?? (auth && cookie) ? { Cookie: as ?? cookie } : {}) },
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT, DATA_DIR: dir, TELEGRAM_BOT_TOKEN: '' },
  });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('running') && res());
    proc.on('exit', (c) => rej(new Error(`server exited ${c}`)));
  });
});
after(() => {
  proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const sessionCookie = (r) => r.headers.get('set-cookie').split(';')[0];

test('provider signs up, gets a 30-day cookie, and can log in again', async () => {
  assert.equal((await call('GET', '/api/customers', null, { auth: false })).status, 401);
  assert.equal((await call('POST', '/api/signup', { role: 'provider', phone: '12', password: 'abcdef', businessName: 'X' })).status, 400);
  assert.equal((await call('POST', '/api/signup', { role: 'provider', phone: '9811100001', password: 'abc', businessName: 'X' })).status, 400);
  const up = await call('POST', '/api/signup', { role: 'provider', phone: '98111 00001', password: 'abcdef', businessName: 'Annapurna Tiffins' });
  assert.equal(up.status, 200);
  assert.match(up.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.match(up.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('POST', '/api/signup', { role: 'provider', phone: '+91 9811100001', password: 'abcdef', businessName: 'Dup' })).status, 409);
  assert.equal((await call('POST', '/api/login', { role: 'provider', phone: '9811100001', password: 'wrong1' })).status, 401);
  assert.equal((await call('POST', '/api/login', { role: 'customer', phone: '9811100001', password: 'abcdef' })).status, 401); // no such customer account
  const ok = await call('POST', '/api/login', { role: 'provider', phone: '09811100001', password: 'abcdef' });
  assert.equal(ok.status, 200);
  cookie = sessionCookie(ok);
  const me = (await call('GET', '/api/me')).body;
  assert.equal(me.user.role, 'provider');
  assert.equal(me.user.name, 'Annapurna Tiffins');
});

test('rejects non-JSON writes (CSRF guard)', async () => {
  const r = await fetch(`${BASE}/api/deliver`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

let a, b;
test('customers, counts, delivery, leave', async () => {
  const today = L.todayStr();
  const tomorrow = L.addDays(today, 1);
  a = (await call('POST', '/api/customers', { name: 'Asha <b>', phone: '98765 43210', address: '12 MG Road', type: 'normal', qty: 2 })).body;
  b = (await call('POST', '/api/customers', { name: 'Bharat', type: 'deluxe' })).body;
  assert.equal((await call('POST', '/api/customers', { name: '  ' })).status, 400);
  assert.equal(a.phone, '9876543210');

  let d = (await call('GET', '/api/day')).body;
  assert.deepEqual([d.counts.boxes, d.counts.normal, d.counts.deluxe, d.counts.pending], [3, 2, 1, 2]);

  d = (await call('POST', '/api/deliver', { date: today, customerId: a.id, delivered: true })).body;
  assert.deepEqual([d.counts.delivered, d.counts.pending], [1, 1]);
  assert.equal((await call('POST', '/api/deliver', { date: tomorrow, customerId: a.id, delivered: true })).status, 400);
  d = (await call('POST', '/api/deliver', { date: today, customerId: a.id, delivered: false })).body;
  assert.equal(d.counts.delivered, 0);

  // provider marks Bharat on leave for tomorrow..+2 ; overlapping range merges
  await call('POST', `/api/customers/${b.id}/leaves`, { from: tomorrow, to: L.addDays(today, 3) });
  const merged = (await call('POST', `/api/customers/${b.id}/leaves`, { from: L.addDays(today, 3), to: L.addDays(today, 5) })).body;
  assert.equal(merged.leaves.length, 1);
  d = (await call('GET', `/api/day?date=${tomorrow}`)).body;
  assert.deepEqual([d.counts.boxes, d.counts.deluxe, d.counts.leave], [2, 0, 1]);
  assert.equal((await call('POST', '/api/deliver', { date: today, customerId: b.id, delivered: true })).status, 200); // not on leave today
});

test('public customer link: leave rules and privacy', async () => {
  const v = (await call('GET', `/api/c/${a.token}`, null, { auth: false })).body;
  assert.equal(v.name, 'Asha <b>');
  assert.equal(v.phone, undefined);
  assert.equal(v.address, undefined);
  assert.equal(v.minDate, L.addDays(L.todayStr(), 1)); // cutoff 0 => tomorrow onwards
  const pub = (m, u, body) => call(m, `/api/c/${a.token}${u}`, body, { auth: false });
  assert.equal((await pub('POST', '/leaves', { from: L.todayStr(), to: L.todayStr() })).status, 400);
  assert.equal((await pub('POST', '/leaves', { from: v.minDate, to: L.addDays(v.minDate, -1) })).status, 400);
  const added = await pub('POST', '/leaves', { from: v.minDate, to: L.addDays(v.minDate, 2) });
  assert.equal(added.status, 200);
  assert.equal(added.body.leaves.length, 1);
  assert.equal((await call('GET', '/api/c/bogus', null, { auth: false })).status, 404);
  const gone = await pub('DELETE', `/leaves/${added.body.leaves[0].id}`);
  assert.equal(gone.body.leaves.length, 0);
});

let custCookie;
test('customer account: only numbers a provider added can sign up; sees and edits only own leave', async () => {
  assert.equal((await call('POST', '/api/signup', { role: 'customer', phone: '9000099999', password: 'abcdef' })).status, 400); // unknown number
  const up = await call('POST', '/api/signup', { role: 'customer', phone: '+91 98765-43210', password: 'custpass' });
  assert.equal(up.status, 200);
  custCookie = sessionCookie(up);
  assert.equal((await call('GET', '/api/customers', null, { as: custCookie })).status, 403); // not a provider
  const my = (await call('GET', '/api/my', null, { as: custCookie })).body;
  assert.equal(my.subscriptions.length, 1);
  const sub = my.subscriptions[0];
  assert.equal(sub.name, 'Asha <b>');
  assert.equal(sub.businessName, 'Annapurna Tiffins');
  const tomorrow = L.addDays(L.todayStr(), 1);
  const added = await call('POST', `/api/my/${sub.tid}/${sub.cid}/leaves`, { from: tomorrow, to: tomorrow }, { as: custCookie });
  assert.equal(added.status, 200);
  assert.equal(added.body.leaves.length, 1);
  // provider sees it
  const d = (await call('GET', `/api/day?date=${tomorrow}`)).body;
  assert.equal(d.rows.find((r) => r.id === a.id).status, 'leave');
  assert.equal((await call('POST', `/api/my/${sub.tid}/nope/leaves`, { from: tomorrow, to: tomorrow }, { as: custCookie })).status, 404);
  await call('DELETE', `/api/my/${sub.tid}/${sub.cid}/leaves/${added.body.leaves[0].id}`, null, { as: custCookie });
});

test('tenants are isolated', async () => {
  const up = await call('POST', '/api/signup', { role: 'provider', phone: '9811100002', password: 'abcdef', businessName: 'Other Kitchen' });
  const other = sessionCookie(up);
  assert.equal((await call('GET', '/api/customers', null, { as: other })).body.customers.length, 0);
  assert.equal((await call('PUT', `/api/customers/${a.id}`, { name: 'Hacked' }, { as: other })).status, 404);
  assert.equal((await call('GET', '/api/day', null, { as: other })).body.counts.boxes, 0);
});

test('logout kills the session; password change signs out other devices', async () => {
  const second = sessionCookie(await call('POST', '/api/login', { role: 'provider', phone: '9811100001', password: 'abcdef' }));
  assert.equal((await call('POST', '/api/password', { oldPassword: 'nope', newPassword: 'newpass1' })).status, 401);
  assert.equal((await call('POST', '/api/password', { oldPassword: 'abcdef', newPassword: 'newpass1' })).status, 200);
  assert.equal((await call('GET', '/api/customers', null, { as: second })).status, 401); // other device signed out
  assert.equal((await call('GET', '/api/customers')).status, 200); // this one stays
  assert.equal((await call('POST', '/api/login', { role: 'provider', phone: '9811100001', password: 'abcdef' })).status, 401);
  const re = await call('POST', '/api/login', { role: 'provider', phone: '9811100001', password: 'newpass1' });
  assert.equal(re.status, 200);
  const out = sessionCookie(re);
  await call('POST', '/api/logout', {}, { as: out });
  assert.equal((await call('GET', '/api/customers', null, { as: out })).status, 401);
});

test('wrong passwords are rate limited', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await call('POST', '/api/login', { role: 'provider', phone: '9811100777', password: 'x' });
  assert.equal(last.status, 429);
});

test('monthly report', async () => {
  await call('PUT', '/api/settings', { prices: { normal: 80, deluxe: 120 } });
  await call('POST', '/api/deliver', { date: L.todayStr(), customerId: a.id, delivered: true });
  const r = (await call('GET', '/api/report')).body;
  const asha = r.customers.find((c) => c.id === a.id);
  assert.equal(asha.delivered, 1);
  assert.equal(asha.amount, 160); // 2 boxes x 80
  assert.equal(r.daily.length, new Date(+r.month.slice(0, 4), +r.month.slice(5), 0).getDate());
});

test('closed weekday removes the day', async () => {
  const wd = L.parseDate(L.todayStr()).getDay();
  await call('PUT', '/api/settings', { closedDays: [wd] });
  const d = (await call('GET', '/api/day')).body;
  assert.equal(d.closed, true);
  assert.equal(d.rows.length, 0);
  assert.equal((await call('POST', '/api/deliver', { date: L.todayStr(), customerId: a.id, delivered: true })).status, 400);
  await call('PUT', '/api/settings', { closedDays: [] });
});

test('path traversal is blocked', async () => {
  const r = await fetch(`${BASE}/..%2Fserver.js`);
  assert.equal(r.status, 404);
});
