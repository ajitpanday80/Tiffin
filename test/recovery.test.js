import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/logic.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = 46000 + Math.floor(Math.random() * 1500);
const TG_PORT = 44000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffin-recovery-'));
let proc;
let tgServer;
const sent = []; // messages the bot "sent" to Telegram
const queue = []; // updates the fake Telegram hands to the bot

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error('timed out waiting');
};
const call = async (method, url, body, cookie, headers = {}) => {
  const r = await fetch(BASE + url, {
    method,
    // every call looks like a different visitor unless a test pins the address (the limiters are per address)
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers },
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};
const signup = async (role, phone, extra = {}) => (await call('POST', '/api/signup', { role, phone, password: 'first-pass', ...extra })).cookie;
const login = (role, phone, password) => call('POST', '/api/login', { role, phone, password }, null, { 'X-Forwarded-For': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
let updateId = 1;
const say = (chat, text) => queue.push({ update_id: updateId++, message: { message_id: updateId, chat: { id: chat, type: 'private' }, text } });
const lastTo = (chat) => [...sent].reverse().find((m) => String(m.chat_id) === String(chat));

before(async () => {
  tgServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const method = req.url.split('/').pop();
      const body = raw ? JSON.parse(raw) : {};
      const out = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getMe') return out({ username: 'MyTiffinTestBot' });
      if (method === 'sendMessage') { sent.push(body); return out({ message_id: 1 }); }
      if (method === 'getUpdates') { if (!queue.length) await sleep(150); return out(queue.splice(0)); }
      return out(true);
    });
  });
  await new Promise((r) => tgServer.listen(TG_PORT, '127.0.0.1', r));
  const mk = spawnSync(process.execPath, ['scripts/make-admin.js', '9000000000', 'adminpass1'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir } });
  assert.equal(mk.status, 0, String(mk.stderr));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: APP_PORT, DATA_DIR: dir, GEOCODER: 'off', TELEGRAM_BOT_TOKEN: '123:test', TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`, PUBLIC_URL: 'https://mytiffin.online' },
  });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('running') && res());
    proc.on('exit', (c) => rej(new Error(`server exited ${c}`)));
  });
});
after(() => {
  proc.kill();
  tgServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let prov, code;
test('provider connects Telegram with their personal code; bot answers commands', async () => {
  prov = await signup('provider', '9811100050', { businessName: 'Annapurna Tiffins' });
  const st = (await call('GET', '/api/settings', null, prov)).body.telegram;
  assert.equal(st.configured, true);
  assert.equal(st.linked, false);
  assert.equal(st.bot, 'MyTiffinTestBot');
  code = st.code;
  say(777, '/start WRONG123');
  await waitFor(() => lastTo(777));
  assert.match(lastTo(777).text, /not right/);
  say(777, `/start ${code.toLowerCase()}`); // codes are case-insensitive
  await waitFor(() => /Connected to <b>Annapurna Tiffins<\/b>/.test(lastTo(777)?.text || ''));
  assert.equal((await call('GET', '/api/settings', null, prov)).body.telegram.linked, true);
  say(777, '/today');
  await waitFor(() => /Prepare <b>0<\/b>/.test(lastTo(777)?.text || ''));
  say(555, '/today'); // a stranger's chat gets nothing about this kitchen
  await waitFor(() => /private/.test(lastTo(555)?.text || ''));
});

test('forgot password: unknown numbers get the same answer and no message', async () => {
  const before = sent.length;
  const a = await call('POST', '/api/forgot', { phone: '9000012345' });
  const b = await call('POST', '/api/forgot', { phone: '9811100050' });
  assert.deepEqual(a.body, b.body);
  assert.equal(a.status, 200);
  await waitFor(() => sent.length === before + 1); // only the real, connected provider was messaged
  assert.match(lastTo(777).text, /reset code: <b>\d{6}<\/b>/);
});

test('reset with the Telegram code: wrong code, weak password, then success', async () => {
  const realCode = lastTo(777).text.match(/<b>(\d{6})<\/b>/)[1];
  const wrong = realCode === '000000' ? '111111' : '000000';
  assert.equal((await call('POST', '/api/reset', { phone: '9811100050', code: wrong, password: 'brand-new-1' })).status, 400);
  assert.equal((await call('POST', '/api/reset', { phone: '9811100050', code: realCode, password: '123' })).status, 400); // too short, and the code must survive this
  const ok = await call('POST', '/api/reset', { phone: '98111 00050', code: realCode, password: 'brand-new-1' });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/settings', null, prov)).status, 401); // signed out everywhere
  assert.equal((await login('provider', '9811100050', 'first-pass')).status, 401);
  assert.equal((await login('provider', '9811100050', 'brand-new-1')).status, 200);
  assert.equal((await call('POST', '/api/reset', { phone: '9811100050', code: realCode, password: 'again-again' })).status, 400); // single use
});

test('five wrong guesses burn the code', async () => {
  await call('POST', '/api/forgot', { phone: '9811100050' });
  const n = sent.length;
  await waitFor(() => lastTo(777) && sent.length >= n);
  const realCode = lastTo(777).text.match(/<b>(\d{6})<\/b>/)[1];
  const wrong = realCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/reset', { phone: '9811100050', code: wrong, password: 'brand-new-2' })).status, 400);
  const r = await call('POST', '/api/reset', { phone: '9811100050', code: wrong, password: 'brand-new-2' });
  assert.match(r.body.error, /Too many wrong tries/);
  assert.equal((await call('POST', '/api/reset', { phone: '9811100050', code: realCode, password: 'brand-new-2' })).status, 400); // even the right code is dead now
});

test('customers: a provider can create a one-time reset link, once, only for their own customers', async () => {
  const pc = (await login('provider', '9811100050', 'brand-new-1')).cookie;
  const c1 = (await call('POST', '/api/customers', { name: 'Sunita Rao', phone: '9822200001', type: 'deluxe' }, pc)).body;
  assert.equal((await call('POST', `/api/customers/${c1.id}/reset-link`, {}, pc)).status, 400); // no login yet
  const cust = await signup('customer', '9822200001');
  const link = (await call('POST', `/api/customers/${c1.id}/reset-link`, {}, pc)).body;
  assert.match(link.link, /^https:\/\/mytiffin\.online\/reset\?token=[\w-]{20,}$/);
  const token = new URL(link.link).searchParams.get('token');
  assert.equal((await call('GET', `/api/reset-link/${token}`)).body.name, 'Sunita Rao');
  assert.equal((await call('POST', '/api/reset-link', { token, password: 'abc' })).status, 400); // weak: link not consumed
  const done = await call('POST', '/api/reset-link', { token, password: 'customer-new-1' });
  assert.equal(done.status, 200);
  assert.equal(done.body.role, 'customer');
  assert.equal((await call('GET', '/api/my', null, cust)).status, 401);
  assert.equal((await login('customer', '9822200001', 'customer-new-1')).status, 200);
  assert.equal((await call('POST', '/api/reset-link', { token, password: 'customer-new-2' })).status, 404); // single use
  assert.equal((await call('GET', '/api/reset-link/not-a-token')).status, 404);

  // a second provider adds the same person: now only the administrator may reset it
  const other = await signup('provider', '9811100051', { businessName: 'Other Kitchen' });
  await call('POST', '/api/customers', { name: 'Sunita R', phone: '9822200001' }, other);
  assert.equal((await call('POST', `/api/customers/${c1.id}/reset-link`, {}, pc)).status, 403);
  // and a provider cannot touch somebody else's customer
  assert.equal((await call('POST', `/api/customers/${c1.id}/reset-link`, {}, other)).status, 404);
});

test('administrator can create a reset link for anyone and set a support contact', async () => {
  const admin = (await call('POST', '/api/login', { role: 'admin', phone: '9000000000', password: 'adminpass1' })).cookie;
  assert.equal((await call('POST', '/api/admin/reset-link', { role: 'provider', phone: '9811100050' }, prov)).status, 401);
  assert.equal((await call('POST', '/api/admin/reset-link', { role: 'provider', phone: '9811100999' }, admin)).status, 404);
  const r = (await call('POST', '/api/admin/reset-link', { role: 'provider', phone: '9811100050' }, admin)).body;
  const token = new URL(r.link).searchParams.get('token');
  assert.equal((await call('POST', '/api/reset-link', { token, password: 'by-admin-1' })).status, 200);
  assert.equal((await login('provider', '9811100050', 'by-admin-1')).status, 200);
  await call('PUT', '/api/admin/platform', { payInstructions: '', support: 'WhatsApp +91 90000 00000' }, admin);
  assert.equal((await call('GET', '/api/support')).body.support, 'WhatsApp +91 90000 00000');
});

test('customer leave reaches the provider on Telegram', async () => {
  const cust = (await login('customer', '9822200001', 'customer-new-1')).cookie;
  const sub = (await call('GET', '/api/my', null, cust)).body.subscriptions[0];
  const tomorrow = L.addDays(L.todayStr(), 1);
  const n = sent.length;
  assert.equal((await call('POST', `/api/my/${sub.tid}/${sub.cid}/leaves`, { from: tomorrow, to: tomorrow }, cust)).status, 200);
  await waitFor(() => sent.length > n);
  assert.match(lastTo(777).text, /Sunita Rao<\/b> \(Deluxe\) is on leave/);
});

test('forgot-password requests are rate limited', async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await call('POST', '/api/forgot', { phone: `98000${i}0000` }, null, { 'X-Forwarded-For': '203.0.113.77' });
  assert.equal(last.status, 429);
});

test('bot name on the website: the username Telegram reports wins, with a link', async () => {
  const get = async (u) => (await fetch(BASE + u)).text();
  const help = await get('/help');
  assert.doesNotMatch(help, /\{\{BOT/);
  assert.match(help, /<b>@MyTiffinTestBot<\/b>/);
  assert.match(help, /href="https:\/\/t\.me\/MyTiffinTestBot"/);
  assert.match(help, /this site uses <b>@MyTiffinTestBot<\/b>/); // what Telegram reports wins over the default
  const post = await get('/blog/telegram-alerts-for-your-tiffin-business');
  assert.doesNotMatch(post, /\{\{BOT/);
  assert.match(post, /<strong>@MyTiffinTestBot<\/strong>/);
  const s = (await call('GET', '/api/settings', null, (await login('provider', '9811100050', 'by-admin-1')).cookie)).body.telegram;
  assert.equal(s.botAt, '@MyTiffinTestBot');
  assert.equal(s.botUrl, 'https://t.me/MyTiffinTestBot');
});
