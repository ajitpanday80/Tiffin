import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.TZ ||= 'Asia/Kolkata'; // "today" must match the provider's wall clock; override with TZ=...

import { Store, newTenant, newLinkCode } from './lib/store.js';
import { Limiter } from './lib/limiter.js';
import { dueReminders } from './lib/remind.js';
import { Telegram, leaveText, esc } from './lib/telegram.js';
import { phoneKey, validPhone, hashPassword, verifyPassword, createSession, lookupSession, destroySession, SESSION_MS } from './lib/auth.js';
import * as L from './lib/logic.js';
import * as M from './lib/market.js';
import { renderIndex, renderPost, findPost, postSlugs } from './lib/blog.js';
import { Geocoder, snap, validCoords } from './lib/geo.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // use 127.0.0.1 when a reverse proxy on the same machine terminates HTTPS
const COOKIE = 'tiffin_session';

const store = new Store(process.env.DATA_DIR || path.join(ROOT, 'data'));
const { db } = store;
const tg = new Telegram({ token: process.env.TELEGRAM_BOT_TOKEN, store });
// How the bot is shown on the website. TELEGRAM_BOT_USERNAME sets it (default tiffincrm_bot); once Telegram confirms the
// token's real username (getMe at startup) that one is used instead, so the pages can never point at the wrong bot.
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'tiffincrm_bot').replace(/^@/, '');
const botUser = () => tg.botName || BOT_USERNAME;
const botVars = () => ({
  '{{BOT}}': botUser(),
  '{{BOT_AT}}': `@${botUser()}`,
  '{{BOT_URL}}': `https://t.me/${botUser()}`,
});
const fillBot = (html, base = '') => (html.includes('{{') ? html.replace(/\{\{(?:BOT(?:_AT|_URL)?|BASE)\}\}/g, (m) => (m === '{{BASE}}' ? base : botVars()[m])) : html);
const geo = new Geocoder({
  store,
  country: (process.env.COUNTRY || 'in').toLowerCase(), // ISO country code used to bias address / pincode lookups
  enabled: process.env.GEOCODER !== 'off',
  userAgent: `mytiffin/1.0 ${process.env.GEOCODER_CONTACT || ''}`.trim(), // Nominatim asks for a contact
});

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m, status = 400) => new HttpError(status, m);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};
const newId = () => crypto.randomBytes(6).toString('base64url');
const loginLimiter = new Limiter(8, 10 * 60 * 1000);
const signupLimiter = new Limiter(10, 60 * 60 * 1000);
const codeLimiter = new Limiter(10, 60 * 60 * 1000); // wrong sign-up codes per phone number
const searchLimiter = new Limiter(40, 60 * 1000);
const enquiryLimiter = new Limiter(5, 60 * 60 * 1000);

const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2),
  );

// The site's public address: PUBLIC_URL if set, otherwise whatever the visitor used.
function publicBase(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return (process.env.PUBLIC_URL || `${proto}://${req.headers.host || `localhost:${PORT}`}`).replace(/\/$/, '');
}

const withToday = (o) => ({ ...o, today: L.todayStr() });
const day = (t, date) => withToday(L.daySummary(t, date));
const orNotFound = (v, msg) => v || (() => { throw bad(msg, 404); })();
const findCustomer = (t, id) => orNotFound(t.customers.find((c) => c.id === id), 'Customer not found');
const findByToken = (token) => {
  for (const t of Object.values(db.tenants)) {
    const c = t.customers.find((x) => x.token === token);
    if (c) return [t, c];
  }
  throw bad('This link is not valid. Please ask for a new one.', 404);
};

function settingsOut(t) {
  const { telegramChatId, linkCode, ...s } = t.settings;
  return { ...s, telegram: { configured: tg.configured, linked: tg.isLinked(t), bot: tg.botName, botAt: botVars()['{{BOT_AT}}'], botUrl: botVars()['{{BOT_URL}}'], code: linkCode } };
}

function cleanCustomer(b, old) {
  const name = str(b.name, 60);
  if (!name) throw bad('Please enter the customer name');
  const phone = str(b.phone, 20).replace(/[^\d+]/g, '');
  const startDate = L.isDate(b.startDate) ? b.startDate : old?.startDate || L.todayStr();
  const endDate = L.isDate(b.endDate) ? b.endDate : '';
  if (endDate && endDate < startDate) throw bad('Last day cannot be before the start date');
  return {
    name,
    phone,
    address: str(b.address, 200),
    type: b.type === 'deluxe' ? 'deluxe' : 'normal',
    qty: int(b.qty, 1, 20, 1),
    note: str(b.note, 200),
    startDate,
    endDate,
  };
}

function addLeave(c, from, to) {
  c.leaves = L.mergeLeaves([...c.leaves, { id: newId(), from, to }]);
}

function checkRange(from, to, min) {
  if (!L.isDate(from) || !L.isDate(to)) throw bad('Please pick valid dates');
  if (to < from) throw bad('"To" date cannot be before "From" date');
  if (from < min) throw bad(`Leave can start from ${L.fmtDate(min)} onwards`);
  if (L.dayCount(from, to) > 120) throw bad('Leave is too long. Please pick up to 120 days.');
}

// What a customer is allowed to see about their own subscription.
const isEnded = (c) => !!c.endDate && c.endDate < L.todayStr();

// One provider cannot hold the same phone number twice (an ended customer's number may be reused).
function assertPhoneFree(t, phone, exceptId) {
  const k = phoneKey(phone);
  if (!k) return;
  const dupe = t.customers.find((x) => x.id !== exceptId && x.phone && phoneKey(x.phone) === k && !isEnded(x));
  if (dupe) throw bad(`${dupe.name} already has this phone number. Edit that customer instead of adding a second one.`, 409);
}

const loginFor = (phone) => (phone ? db.users.find((u) => u.role === 'customer' && u.key === phoneKey(phone)) : null);
const newCode = () => String(crypto.randomInt(100000, 1000000)); // sign-up code a provider hands to the customer

// A person must never be signed up to a service without knowing. If the number already has a MyTiffin login,
// the new record waits for them to press Accept or "Not mine"; it is not counted until then.
function announceToCustomer(t, c, how) {
  const user = loginFor(c.phone);
  if (!(user?.telegramChatId && tg.configured)) return;
  const name = esc(t.settings.businessName);
  const text = how === 'accepted'
    ? `✅ <b>${name}</b> accepted your request. Your tiffin starts ${L.fmtDate(c.startDate)}.`
    : `🆕 <b>${name}</b> wants to add you as a tiffin customer (${c.type === 'deluxe' ? 'Deluxe' : 'Normal'}${c.qty > 1 ? ` ×${c.qty}` : ''}).\nOpen My tiffin and tap <b>Accept</b>, or <b>Not mine</b> if you do not know them.`;
  tg.send(user.telegramChatId, text);
}

// opts.requested: the customer asked for this (marketplace request), so no confirmation is needed
function addCustomer(t, fields, opts = {}) {
  assertPhoneFree(t, fields.phone);
  const consent = opts.requested || !loginFor(fields.phone) ? 'ok' : 'pending';
  const c = { id: newId(), token: crypto.randomBytes(12).toString('base64url'), code: newCode(), ...fields, consent, leaves: [], createdAt: Date.now() };
  t.customers.push(c);
  store.save();
  if (opts.requested) announceToCustomer(t, c, 'accepted');
  else if (consent === 'pending') announceToCustomer(t, c, 'pending');
  return c;
}

function customerView(t, c) {
  const today = L.todayStr();
  let status = 'none';
  if (L.isScheduled(c, today) && !L.isClosed(t, today)) status = L.leaveOn(c, today) ? 'leave' : t.deliveries[today]?.[c.id] ? 'delivered' : 'pending';
  return {
    name: c.name,
    type: c.type,
    qty: c.qty,
    businessName: t.settings.businessName,
    businessPhone: t.settings.businessPhone,
    today,
    status,
    minDate: L.leaveMinDate(t),
    addedAt: c.createdAt || null,
    endDate: c.endDate || '',
    ended: isEnded(c), // finished: shown under "Past"
    stopping: !!c.endDate && !isEnded(c), // will end on endDate
    endedBy: c.endedBy || '', // 'customer' when they stopped it themselves
    stopMin: L.addDays(L.leaveMinDate(t), -1), // earliest allowed last tiffin day
    leaves: c.leaves.filter((l) => l.to >= today).map(({ id, from, to }) => ({ id, from, to })),
    consent: c.consent || 'ok', // 'pending' until the customer confirms a provider-added record
    closures: (t.settings.pauses || []).filter((p) => p.to >= today).map(({ from, to, note }) => ({ from, to, note })),
  };
}

// ---------- ratings ----------
const RATING_MIN_DAYS = Number(process.env.RATING_MIN_DAYS ?? 7); // a customer can rate after this many days with a provider
const visibleRatings = (t) => t.ratings.filter((r) => !r.hidden);
function ratingSummary(t) {
  const list = visibleRatings(t);
  return { count: list.length, avg: list.length ? Math.round((list.reduce((a, r) => a + r.stars, 0) / list.length) * 10) / 10 : 0 };
}
const rateFrom = (c) => new Date((c.createdAt || 0) + RATING_MIN_DAYS * 864e5);

// What a customer sees for one of their services (view + their own rating).
function subOut(user, t, c) {
  const mine = t.ratings.find((r) => r.uid === user.id);
  return {
    ...customerView(t, c),
    canRate: (c.consent || 'ok') === 'ok' && Date.now() >= rateFrom(c).getTime(),
    rateFrom: L.ymd(rateFrom(c)),
    myRating: mine ? { stars: mine.stars, comment: mine.comment, hidden: !!mine.hidden } : null,
  };
}

// Customer-initiated leave changes (shared by the personal link and logged-in accounts).
function customerAddLeave(t, c, body) {
  if ((c.consent || 'ok') !== 'ok') throw bad('Please accept this service first.');
  checkRange(body.from, body.to, L.leaveMinDate(t));
  addLeave(c, body.from, body.to);
  store.save();
  tg.notify(t, leaveText(t, c, body.from, body.to, 'add'));
  return customerView(t, c);
}

function customerRemoveLeave(t, c, lid) {
  const l = c.leaves.find((x) => x.id === lid);
  const min = L.leaveMinDate(t);
  if (!l) throw bad('Leave not found', 404);
  if (l.to < min) throw bad('This leave has already started. Please call to change it.');
  const from = l.from < min ? min : l.from; // days already started stay as they are
  const to = l.to;
  if (l.from >= min) c.leaves = c.leaves.filter((x) => x !== l);
  else l.to = L.addDays(min, -1);
  store.save();
  tg.notify(t, leaveText(t, c, from, to, 'cancel'));
  return customerView(t, c);
}

// Every customer record (across providers) that carries this phone number.
const subscriptionsFor = (user) =>
  Object.entries(db.tenants).flatMap(([tid, t]) =>
    t.customers.filter((c) => c.phone && phoneKey(c.phone) === user.key).map((c) => ({ tid, t, c })),
  );

const activeSubs = (user) => subscriptionsFor(user).filter(({ c }) => !isEnded(c) && (c.consent || 'ok') === 'ok');
const visibleSubs = (user) => subscriptionsFor(user).filter(({ c }) => c.consent !== 'declined');

// ---------- routes ----------
const routes = [];
// auth: 'provider' | 'customer' | 'any' | null (public)
const route = (method, pattern, auth, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth });

const publicUser = (u) => ({ role: u.role, name: u.name, phone: u.phone });

route('GET', '/api/me', null, (ctx) => ({ user: ctx.user ? publicUser(ctx.user) : null }));

route('POST', '/api/signup', null, async (ctx) => {
  const { role } = ctx.body;
  const phone = str(ctx.body.phone, 20);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (signupLimiter.blocked(ctx.ip)) throw bad('Too many sign-ups from this device. Please try again later.', 429);
  signupLimiter.fail(ctx.ip); // counts every attempt, successful or not
  if (role !== 'provider' && role !== 'customer') throw bad('Please choose provider or customer');
  if (!validPhone(phone)) throw bad('Please enter a valid phone number');
  if (password.length < 6) throw bad('Password must be at least 6 characters');
  if (password.length > 200) throw bad('Password is too long');
  const key = phoneKey(phone);
  if (db.users.some((u) => u.role === role && u.key === key)) throw bad('This phone number already has an account. Please log in instead.', 409);

  let name;
  let proven = [];
  if (role === 'provider') {
    name = str(ctx.body.businessName, 60);
    if (!name) throw bad('Please enter your tiffin service name');
  } else {
    // Knowing a phone number is not proof it is yours: the sign-up needs the code (or personal link) a provider gave you.
    if (codeLimiter.blocked(key)) throw bad('Too many wrong codes for this number. Please try again in an hour.', 429);
    const subs = subscriptionsFor({ key });
    const code = str(ctx.body.code, 12).replace(/\s/g, '');
    const token = str(ctx.body.token, 40);
    proven = subs.filter(({ c }) => (token && c.token === token) || (code && c.code === code));
    if (!proven.length) {
      codeLimiter.fail(key);
      throw bad('Please enter the sign-up code your tiffin provider gave you, or open your personal link and tap “Create login”.', 403);
    }
    name = proven[0].c.name;
  }
  const user = { id: newId(), role, phone, key, name, pass: await hashPassword(password) };
  db.users.push(user);
  if (role === 'provider') db.tenants[user.id] = newTenant(name);
  else {
    // services the person did not prove: they decide, nothing is counted until then
    for (const { c } of subscriptionsFor({ key })) if (!proven.some((p) => p.c === c) && !isEnded(c) && (c.consent || 'ok') === 'ok') c.consent = 'pending';
  }
  return startSession(ctx, user);
});

route('POST', '/api/login', null, async (ctx) => {
  const { role } = ctx.body;
  const key = phoneKey(ctx.body.phone);
  const limitKeys = [`ip:${ctx.ip}`, `ph:${key}`];
  if (limitKeys.some((k) => loginLimiter.blocked(k))) throw bad('Too many wrong attempts. Please try again in 10 minutes.', 429);
  const user = db.users.find((u) => u.role === role && u.key === key && key);
  const ok = await verifyPassword(typeof ctx.body.password === 'string' ? ctx.body.password : '', user?.pass);
  if (!ok) {
    limitKeys.forEach((k) => loginLimiter.fail(k));
    throw bad('Wrong phone number or password', 401);
  }
  limitKeys.forEach((k) => loginLimiter.reset(k));
  return startSession(ctx, user);
});

function startSession(ctx, user) {
  const token = createSession(db, user.id);
  store.save();
  ctx.setCookie(token);
  return { user: publicUser(user) };
}

route('POST', '/api/logout', null, (ctx) => {
  destroySession(db, cookies(ctx.req)[COOKIE]);
  store.save();
  ctx.setCookie('', 0);
  return { ok: true };
});

route('POST', '/api/password', 'any', async (ctx) => {
  const pw = typeof ctx.body.newPassword === 'string' ? ctx.body.newPassword : '';
  if (!(await verifyPassword(String(ctx.body.oldPassword || ''), ctx.user.pass))) throw bad('Current password is wrong', 401);
  if (pw.length < 6 || pw.length > 200) throw bad('New password must be at least 6 characters');
  ctx.user.pass = await hashPassword(pw);
  // sign out every other device
  const keep = cookies(ctx.req)[COOKIE];
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === ctx.user.id && k !== sha(keep)) delete db.sessions[k];
  store.save();
  return { ok: true };
});
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');


// ---------- password recovery ----------
// Providers: a 6-digit code sent to their connected Telegram. Customers: a one-time link made by their provider.
// Anyone: a one-time link made by the platform admin after checking who they are.
const forgotLimiter = new Limiter(5, 60 * 60 * 1000);
const resetLimiter = new Limiter(10, 60 * 60 * 1000);
const CODE_MS = 10 * 60 * 1000;
const LINK_MS = 24 * 60 * 60 * 1000;

function killSessions(userId) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
}
const checkNewPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 6) throw bad('Password must be at least 6 characters');
  if (pw.length > 200) throw bad('Password is too long');
};
async function setPassword(user, pw) {
  checkNewPassword(pw);
  user.pass = await hashPassword(pw);
  killSessions(user.id); // everyone is signed out and must use the new password
  store.save();
}
function makeResetLink(req, user, ms) {
  const now = Date.now();
  for (const [k, r] of Object.entries(db.platform.resetTokens)) if (r.exp < now) delete db.platform.resetTokens[k];
  const token = crypto.randomBytes(24).toString('base64url');
  db.platform.resetTokens[sha(token)] = { userId: user.id, exp: now + ms };
  store.save();
  return `${publicBase(req)}/reset?token=${token}`;
}
const tokenUser = (token) => {
  const rec = db.platform.resetTokens[sha(token || '')];
  const user = rec && rec.exp > Date.now() && db.users.find((u) => u.id === rec.userId);
  return user ? { rec, user } : null;
};

route('GET', '/api/support', null, () => ({ support: db.platform.support }));

route('POST', '/api/forgot', null, (ctx) => {
  const key = phoneKey(ctx.body.phone);
  const role = ctx.body.role === 'customer' ? 'customer' : 'provider';
  if (forgotLimiter.blocked(`ip:${ctx.ip}`) || forgotLimiter.blocked(`ph:${key}`)) throw bad('Too many requests. Please try again in an hour.', 429);
  forgotLimiter.fail(`ip:${ctx.ip}`);
  forgotLimiter.fail(`ph:${key}`);
  const user = key && db.users.find((u) => u.role === role && u.key === key);
  // where the code goes: a provider's connected kitchen chat, or the chat a customer connected on their account page
  const chat = !user ? '' : role === 'provider' ? db.tenants[user.id]?.settings.telegramChatId : user.telegramChatId;
  if (user && chat && tg.configured) {
    const code = String(crypto.randomInt(100000, 1000000));
    db.platform.resets[user.id] = { h: sha(`${user.id}:${code}`), exp: Date.now() + CODE_MS, tries: 0 };
    store.save();
    tg.send(chat, `🔑 Your MyTiffin password reset code: <b>${code}</b>\nIt works for 10 minutes. If you did not ask for this, ignore it.`);
  }
  return { ok: true }; // identical answer whether or not the number exists or has Telegram
});

route('POST', '/api/reset', null, async (ctx) => {
  if (resetLimiter.blocked(`ip:${ctx.ip}`)) throw bad('Too many attempts. Please try again in an hour.', 429);
  resetLimiter.fail(`ip:${ctx.ip}`);
  checkNewPassword(ctx.body.password); // check first so a typo does not use up the code
  const key = phoneKey(ctx.body.phone);
  const role = ctx.body.role === 'customer' ? 'customer' : 'provider';
  const user = key && db.users.find((u) => u.role === role && u.key === key);
  const rec = user && db.platform.resets[user.id];
  if (!rec || rec.exp < Date.now()) throw bad('That code is not valid or has expired. Ask for a new one.');
  if (++rec.tries > 5) {
    delete db.platform.resets[user.id];
    store.save();
    throw bad('Too many wrong tries. Ask for a new code.');
  }
  const given = Buffer.from(sha(`${user.id}:${String(ctx.body.code || '').replace(/\s/g, '')}`));
  if (!crypto.timingSafeEqual(given, Buffer.from(rec.h))) {
    store.save();
    throw bad('That code is not right.');
  }
  delete db.platform.resets[user.id];
  await setPassword(user, ctx.body.password);
  return { ok: true };
});

route('GET', '/api/reset-link/:token', null, ({ params }) => {
  const f = tokenUser(params.token);
  if (!f) throw bad('This reset link is not valid or has expired. Please ask for a new one.', 404);
  return { role: f.user.role, name: f.user.name };
});

route('POST', '/api/reset-link', null, async (ctx) => {
  if (resetLimiter.blocked(`ip:${ctx.ip}`)) throw bad('Too many attempts. Please try again in an hour.', 429);
  resetLimiter.fail(`ip:${ctx.ip}`);
  checkNewPassword(ctx.body.password);
  const f = tokenUser(ctx.body.token);
  if (!f) throw bad('This reset link is not valid or has expired. Please ask for a new one.', 404);
  delete db.platform.resetTokens[sha(ctx.body.token)]; // one use only
  await setPassword(f.user, ctx.body.password);
  return { ok: true, role: f.user.role };
});

// A provider helps one of their own customers who forgot the password. Allowed only when that login belongs to this
// provider alone, so a provider can never take over an account that also holds other providers' subscriptions.
route('POST', '/api/customers/:id/reset-link', 'provider', (ctx) => {
  const c = findCustomer(ctx.t, ctx.params.id);
  const user = c.phone && db.users.find((u) => u.role === 'customer' && u.key === phoneKey(c.phone));
  if (!user) throw bad('This customer has not created a login yet.');
  if (!subscriptionsFor(user).every((s) => s.tid === ctx.user.id)) {
    throw bad('This person also uses another tiffin service, so only the MyTiffin administrator can reset this password. Ask them to contact support.', 403);
  }
  return { link: makeResetLink(ctx.req, user, LINK_MS), name: user.name };
});

// ----- provider -----
route('GET', '/api/settings', 'provider', ({ t }) => settingsOut(t));

route('PUT', '/api/settings', 'provider', ({ t, body: b }) => {
  const s = t.settings;
  s.businessName = str(b.businessName, 60) || s.businessName;
  s.businessPhone = str(b.businessPhone, 20);
  s.currency = str(b.currency, 4) || '₹';
  s.prices = {
    normal: int(b.prices?.normal, 0, 1e6, s.prices.normal),
    deluxe: int(b.prices?.deluxe, 0, 1e6, s.prices.deluxe),
  };
  if (Array.isArray(b.closedDays)) s.closedDays = [...new Set(b.closedDays.map(Number).filter((n) => n >= 0 && n <= 6))];
  s.cutoffHour = int(b.cutoffHour, 0, 23, s.cutoffHour);
  for (const k of ['morningTime', 'eveningTime']) if (b[k] === '' || /^\d{2}:\d{2}$/.test(b[k])) s[k] = b[k];
  store.save();
  return settingsOut(t);
});

route('POST', '/api/telegram/test', 'provider', async ({ t }) => {
  if (!tg.configured) throw bad('Telegram is not set up on the server yet (TELEGRAM_BOT_TOKEN).');
  if (!tg.isLinked(t)) throw bad('Not connected yet. Send /start and your code to the bot first.');
  if (!(await tg.notify(t, '✅ Test message from your MyTiffin app. Alerts are working!'))) throw bad('Telegram did not accept the message. Check the server log.', 502);
  return { ok: true };
});

route('POST', '/api/telegram/unlink', 'provider', ({ t }) => {
  t.settings.telegramChatId = '';
  t.settings.linkCode = newLinkCode(); // old code stops working
  store.save();
  return settingsOut(t);
});

route('GET', '/api/day', 'provider', ({ t, query }) => day(t, L.isDate(query.date) ? query.date : L.todayStr()));

route('POST', '/api/deliver', 'provider', ({ t, body }) => {
  const { date, customerId } = body;
  if (!L.isDate(date)) throw bad('Invalid date');
  if (date > L.todayStr()) throw bad('You cannot mark a future day as delivered');
  const c = findCustomer(t, customerId);
  if (!L.isScheduled(c, date) || L.isClosed(t, date)) throw bad('This customer has no tiffin on that day');
  if (L.leaveOn(c, date)) throw bad('This customer is on leave that day');
  const dl = (t.deliveries[date] ||= {});
  if (body.delivered) dl[c.id] = Date.now();
  else delete dl[c.id];
  if (!Object.keys(dl).length) delete t.deliveries[date];
  store.save();
  return day(t, date);
});

route('GET', '/api/customers', 'provider', ({ t }) => ({
  today: L.todayStr(),
  customers: t.customers.map((c) => ({ ...c, hasAccount: !!c.phone && db.users.some((u) => u.role === 'customer' && u.key === phoneKey(c.phone)) })),
}));

route('POST', '/api/customers', 'provider', ({ t, body }) => addCustomer(t, cleanCustomer(body)));

route('PUT', '/api/customers/:id', 'provider', ({ t, params, body }) => {
  const c = findCustomer(t, params.id);
  const fields = cleanCustomer(body, c);
  if (phoneKey(fields.phone) !== phoneKey(c.phone)) assertPhoneFree(t, fields.phone, c.id);
  if (fields.endDate !== c.endDate) c.endedBy = ''; // the provider changed the last day, so it is no longer "stopped by customer"
  Object.assign(c, fields);
  store.save();
  return c;
});

route('DELETE', '/api/customers/:id', 'provider', ({ t, params }) => {
  const c = findCustomer(t, params.id);
  t.customers = t.customers.filter((x) => x !== c);
  for (const d of Object.keys(t.deliveries)) {
    delete t.deliveries[d][c.id];
    if (!Object.keys(t.deliveries[d]).length) delete t.deliveries[d];
  }
  store.save();
  return { ok: true };
});

route('POST', '/api/customers/:id/leaves', 'provider', ({ t, params, body }) => {
  const c = findCustomer(t, params.id);
  checkRange(body.from, body.to, '0000-00-00');
  addLeave(c, body.from, body.to);
  store.save();
  return c;
});

route('DELETE', '/api/customers/:id/leaves/:lid', 'provider', ({ t, params }) => {
  const c = findCustomer(t, params.id);
  c.leaves = c.leaves.filter((l) => l.id !== params.lid);
  store.save();
  return c;
});

route('GET', '/api/report', 'provider', ({ t, query }) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : L.todayStr().slice(0, 7);
  return withToday(L.monthReport(t, month));
});


// ---------- marketplace ----------
const TAGS = ['veg', 'non-veg', 'jain', 'vegan', 'home-style', 'healthy'];
const MEALS = ['breakfast', 'lunch', 'dinner'];
const PIN_RE = /^\d{4,8}$/;
const findListing = (lid) => {
  for (const [tid, t] of Object.entries(db.tenants)) if (t.listing.id === lid && M.isListed(t)) return { tid, t };
  throw bad('This listing is not available', 404);
};

route('GET', '/api/market/search', null, async ({ query, ip, user }) => {
  if (searchLimiter.blocked(ip)) throw bad('Too many searches. Please wait a minute.', 429);
  searchLimiter.fail(ip);
  const q = str(query.q, 200);
  let origin = null;
  let label = '';
  let pin = '';
  if (query.lat !== undefined && validCoords(Number(query.lat), Number(query.lng))) {
    origin = { lat: Number(query.lat), lng: Number(query.lng) };
    label = 'your location';
  } else if (q) {
    const compact = q.replace(/\s/g, '');
    pin = PIN_RE.test(compact) ? compact : (q.match(/\b\d{6}\b/) || [''])[0];
    const g = await geo.lookup(PIN_RE.test(compact) ? compact : q);
    if (g) {
      origin = { lat: g.lat, lng: g.lng };
      label = g.label;
    }
  }
  if (!origin && !pin) throw bad(q ? 'We could not find that place. Try your pincode.' : 'Enter your pincode or address, or use your location.');
  const found = M.search(db, { origin, pin });
  for (const f of found) {
    M.track(db, f.tid, 'imp');
    if (f.sponsored) M.track(db, f.tid, 'spImp');
  }
  if (found.length) store.save();
  // A signed-in customer sees which services they already have (and which they left).
  const mine = user?.role === 'customer' ? subscriptionsFor(user) : [];
  const joined = (tid) => {
    const subs = mine.filter((s) => s.tid === tid);
    return subs.some((s) => !isEnded(s.c)) ? 'active' : subs.length ? 'ended' : '';
  };
  return { mode: origin ? 'distance' : 'pincode', label, pin, results: found.map((f) => ({
    ...M.card(f),
    joined: joined(f.tid),
    rating: ratingSummary(f.t),
    reviews: visibleRatings(f.t).filter((r) => r.comment).sort((a, b) => b.at - a.at).slice(0, 3).map((r) => ({ stars: r.stars, comment: r.comment, who: r.who, reply: r.reply })),
  })) };
});

route('POST', '/api/market/:lid/enquire', null, ({ params, body, ip, user }) => {
  const { tid, t } = findListing(params.lid);
  if (enquiryLimiter.blocked(ip)) throw bad('Too many requests. Please try again later.', 429);
  const name = str(body.name, 60);
  const phone = str(body.phone, 20).replace(/[^\d+]/g, '');
  if (!name) throw bad('Please enter your name');
  if (!validPhone(phone)) throw bad('Please enter a valid phone number');
  enquiryLimiter.fail(ip);
  const mine = user?.role === 'customer' ? subscriptionsFor(user) : [];
  if (mine.some((s) => s.tid === tid && !isEnded(s.c))) throw bad(`You are already with ${t.settings.businessName}.`, 409);
  let switchFrom = null;
  if (user?.role === 'customer' && body.switchFrom) {
    const from = mine.find((s) => s.tid === body.switchFrom.tid && s.c.id === body.switchFrom.cid && !isEnded(s.c));
    if (!from) throw bad('The service you want to switch from was not found.');
    if (from.tid === tid) throw bad('Pick a different provider to switch to.');
    switchFrom = { tid: from.tid, cid: from.c.id };
  }
  const today = L.todayStr();
  const startDate = L.isDate(body.startDate) && body.startDate >= today && body.startDate <= L.addDays(today, 120) ? body.startDate : '';
  if (t.enquiries.some((e) => e.status === 'new' && phoneKey(e.phone) === phoneKey(phone))) return { ok: true }; // already waiting; don't spam
  t.enquiries.unshift({ id: newId(), name, phone, address: str(body.address, 200), type: body.type === 'deluxe' ? 'deluxe' : 'normal', note: str(body.note, 200), at: Date.now(), status: 'new', uid: user?.role === 'customer' ? user.id : '', startDate, switchFrom });
  if (t.enquiries.length > 200) t.enquiries = t.enquiries.filter((e, i) => i < 200 || e.status === 'new');
  M.track(db, tid, 'enquiry');
  store.save();
  tg.notify(t, `📩 <b>New ${switchFrom ? 'switch request' : 'enquiry'}</b> from the marketplace${startDate ? ` (wants to start ${L.fmtDate(startDate)})` : ''}\n${esc(name)} · ${esc(phone)}${body.address ? `\n📍 ${esc(str(body.address, 200))}` : ''}\nOpen the app → Grow to add them.`);
  return { ok: true };
});

// ----- provider: listing, enquiries, ads -----
// Why a provider is (or is not) found by customers, in words they can act on.
function visibility(t) {
  const l = t.listing;
  if (l.suspended) return { level: 'off', text: 'Hidden by the platform. Contact support.' };
  if (!l.enabled) return { level: 'off', text: 'Not visible. Switch on “Show my kitchen in the marketplace” and save.' };
  if (l.lat == null && !l.pincode) return { level: 'off', text: 'Not visible. Add your pincode or set your location.' };
  if (l.lat == null) return { level: 'warn', text: 'Customers are found only by pincode. Set your location so people searching by address or GPS find you too.' };
  return { level: 'ok', text: `Visible to customers within ${l.radiusKm} km${l.approx ? ' of your pincode area' : ''}.` };
}
const listingOut = (t) => ({ ...t.listing, listed: M.isListed(t), visibility: visibility(t), tags: t.listing.tags, options: { tags: TAGS, meals: MEALS } });

// A listed provider with a pincode but no coordinates would be invisible to anyone searching by address or GPS.
// Work the position out from the pincode (once; results are cached).
async function ensureCoords(t) {
  const l = t.listing;
  if (!l.enabled || l.lat != null || !l.pincode) return false;
  const g = await geo.lookup(l.pincode);
  if (!g || l.lat != null) return false;
  l.lat = snap(g.lat);
  l.lng = snap(g.lng);
  l.approx = true;
  store.save();
  return true;
}

route('GET', '/api/listing', 'provider', ({ t, user }) => ({
  ...listingOut(t),
  stats: M.statsFor(db, user.id),
  newEnquiries: t.enquiries.filter((e) => e.status === 'new').length,
  hasPhone: !!t.settings.businessPhone,
}));

route('PUT', '/api/listing', 'provider', async ({ t, body: b }) => {
  const l = t.listing;
  const pin = str(b.pincode, 8);
  if (pin && !PIN_RE.test(pin)) throw bad('Pincode should be 4 to 8 digits');
  const serves = [...new Set((Array.isArray(b.servesPincodes) ? b.servesPincodes : []).map((x) => str(String(x), 8)).filter((x) => PIN_RE.test(x)))].slice(0, 20);
  const next = {
    tagline: str(b.tagline, 80),
    about: str(b.about, 400),
    tags: (Array.isArray(b.tags) ? b.tags : []).filter((x) => TAGS.includes(x)),
    meals: (Array.isArray(b.meals) ? b.meals : []).filter((x) => MEALS.includes(x)),
    area: str(b.area, 60),
    city: str(b.city, 60),
    pincode: pin,
    servesPincodes: serves,
    radiusKm: int(b.radiusKm, 1, 25, l.radiusKm),
    lat: l.lat,
    lng: l.lng,
  };
  if (l.approx && pin !== l.pincode && !(b.lat != null && validCoords(Number(b.lat), Number(b.lng)))) next.lat = next.lng = null; // pincode changed: recompute
  if (b.clearLocation) { next.lat = next.lng = null; next.approx = false; }
  else if (b.lat != null && validCoords(Number(b.lat), Number(b.lng))) {
    next.lat = snap(Number(b.lat));
    next.lng = snap(Number(b.lng));
    next.approx = false;
  }
  const enabled = !!b.enabled;
  if (enabled && !next.area) throw bad('Please add your area or locality so customers know where you are');
  if (enabled && next.lat == null && !next.pincode) throw bad('Add your pincode or set your location to be listed');
  Object.assign(l, next, { enabled });
  store.save();
  await ensureCoords(t);
  return listingOut(t);
});

route('POST', '/api/listing/locate', 'provider', async ({ body }) => {
  const q = str(body.q, 200);
  if (!q) throw bad('Type your pincode or address first');
  const g = await geo.lookup(q);
  if (!g) throw bad('Could not find that place. You can use your phone’s location instead.');
  return { lat: snap(g.lat), lng: snap(g.lng), label: g.label };
});

// The provider never learns which other provider a switching customer is leaving.
const enquiryOut = (e) => ({ id: e.id, name: e.name, phone: e.phone, address: e.address, type: e.type, note: e.note, at: e.at, startDate: e.startDate || '', switching: !!e.switchFrom, hasAccount: !!e.uid });
route('GET', '/api/enquiries', 'provider', ({ t }) => ({ enquiries: t.enquiries.filter((e) => e.status === 'new').map(enquiryOut) }));

route('POST', '/api/enquiries/:id/accept', 'provider', ({ t, params }) => {
  const e = orNotFound(t.enquiries.find((x) => x.id === params.id && x.status === 'new'), 'Enquiry not found');
  const today = L.todayStr();
  const start = e.startDate && e.startDate > today ? e.startDate : today;
  const c = addCustomer(t, cleanCustomer({ name: e.name, phone: e.phone, address: e.address, type: e.type, note: e.note, startDate: start }), { requested: true });
  e.status = 'added';
  // A customer who is switching leaves the old provider the day before the new one starts, but only now that
  // the new provider has said yes, so they are never left without a tiffin.
  const from = e.switchFrom && db.tenants[e.switchFrom.tid];
  const old = from?.customers.find((x) => x.id === e.switchFrom.cid);
  if (old && !isEnded(old) && phoneKey(old.phone) === phoneKey(e.phone)) {
    const last = L.addDays(start, -1);
    if (!old.endDate || old.endDate > last) {
      old.endDate = last;
      old.endedBy = 'customer';
      old.endedAt = Date.now();
      tg.notify(from, `🔀 <b>${esc(old.name)}</b> is moving to another tiffin service. Last tiffin day: <b>${L.fmtDate(last)}</b>.`);
    }
  }
  store.save();
  return c;
});

route('POST', '/api/enquiries/:id/dismiss', 'provider', ({ t, params }) => {
  orNotFound(t.enquiries.find((x) => x.id === params.id && x.status === 'new'), 'Enquiry not found').status = 'dismissed';
  store.save();
  return { ok: true };
});

route('GET', '/api/ads', 'provider', ({ t, user }) => {
  const ad = M.activeAd(db, user.id);
  return {
    currency: db.platform.currency,
    payInstructions: db.platform.payInstructions,
    plans: db.platform.plans,
    orders: db.platform.orders.filter((o) => o.tid === user.id).sort((a, b) => b.createdAt - a.createdAt).map(M.adView),
    active: ad ? M.adView(ad) : null,
    stats: M.statsFor(db, user.id),
    canAdvertise: t.listing.enabled && !t.listing.suspended && t.listing.lat != null,
  };
});

route('POST', '/api/ads/order', 'provider', ({ t, user, body }) => {
  const plan = orNotFound(db.platform.plans.find((p) => p.id === body.planId), 'That plan is not available');
  if (!(t.listing.enabled && !t.listing.suspended && t.listing.lat != null)) throw bad('Turn on your marketplace listing and set your location first.');
  const mine = db.platform.orders.filter((o) => o.tid === user.id && o.status === 'pending');
  if (mine.length >= 3) throw bad('You already have pending orders. Please finish or cancel them first.');
  const o = { id: newId(), ref: `AD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, tid: user.id, planId: plan.id, planName: plan.name, days: plan.days, radiusKm: plan.radiusKm, price: plan.price, status: 'pending', createdAt: Date.now() };
  db.platform.orders.push(o);
  store.save();
  return M.adView(o);
});

route('POST', '/api/ads/orders/:id/cancel', 'provider', ({ user, params }) => {
  const o = orNotFound(db.platform.orders.find((x) => x.id === params.id && x.tid === user.id && x.status === 'pending'), 'Order not found');
  db.platform.orders = db.platform.orders.filter((x) => x !== o);
  store.save();
  return { ok: true };
});

// ----- platform admin (accounts are created with scripts/make-admin.js) -----
const adminOverview = () => ({
  reviews: adminReviews(),
  currency: db.platform.currency,
  payInstructions: db.platform.payInstructions,
  support: db.platform.support,
  plans: db.platform.plans,
  orders: db.platform.orders
    .map((o) => ({ ...M.adView(o), tid: o.tid, provider: db.tenants[o.tid]?.settings.businessName || '(deleted)', phone: db.tenants[o.tid]?.settings.businessPhone || '' }))
    .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || b.createdAt - a.createdAt),
  listings: Object.entries(db.tenants).map(([tid, t]) => ({
    tid, name: t.settings.businessName, phone: t.settings.businessPhone, enabled: t.listing.enabled, suspended: t.listing.suspended,
    area: t.listing.area, city: t.listing.city, pincode: t.listing.pincode, located: t.listing.lat != null, customers: t.customers.length,
    adUntil: M.activeAd(db, tid)?.endsAt || null, stats: M.statsFor(db, tid),
  })),
});

route('GET', '/api/admin/overview', 'admin', () => adminOverview());

route('PUT', '/api/admin/platform', 'admin', ({ body }) => {
  db.platform.payInstructions = str(body.payInstructions, 500);
  db.platform.support = str(body.support, 300);
  db.platform.currency = str(body.currency, 4) || db.platform.currency;
  store.save();
  return adminOverview();
});

route('POST', '/api/admin/reset-link', 'admin', ({ req, body }) => {
  const role = body.role === 'customer' ? 'customer' : 'provider';
  const key = phoneKey(body.phone);
  const user = key && db.users.find((u) => u.role === role && u.key === key);
  if (!user) throw bad('No such account.', 404);
  return { link: makeResetLink(req, user, 60 * 60 * 1000), name: user.name, role };
});

route('POST', '/api/admin/plans', 'admin', ({ body }) => {
  const name = str(body.name, 40);
  if (!name) throw bad('Plan name is required');
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e7) throw bad('Please enter a valid price');
  const plan = { id: body.id || newId(), name, days: int(body.days, 1, 365, 30), radiusKm: int(body.radiusKm, 1, 25, 3), price };
  const i = db.platform.plans.findIndex((p) => p.id === plan.id);
  if (i >= 0) db.platform.plans[i] = plan;
  else db.platform.plans.push(plan);
  store.save();
  return adminOverview();
});

route('DELETE', '/api/admin/plans/:id', 'admin', ({ params }) => {
  db.platform.plans = db.platform.plans.filter((p) => p.id !== params.id);
  store.save();
  return adminOverview();
});

route('POST', '/api/admin/orders/:id/paid', 'admin', ({ params }) => {
  const o = orNotFound(db.platform.orders.find((x) => x.id === params.id && x.status === 'pending'), 'Pending order not found');
  M.activateOrder(db, o);
  store.save();
  const t = db.tenants[o.tid];
  if (t) tg.notify(t, `📣 Your marketplace ad <b>${esc(o.planName)}</b> is live until ${new Date(o.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`);
  return adminOverview();
});

route('POST', '/api/admin/orders/:id/reject', 'admin', ({ params }) => {
  orNotFound(db.platform.orders.find((x) => x.id === params.id && x.status === 'pending'), 'Pending order not found').status = 'rejected';
  store.save();
  return adminOverview();
});

route('POST', '/api/admin/listings/:tid/suspend', 'admin', ({ params, body }) => {
  const t = orNotFound(db.tenants[params.tid], 'Provider not found');
  t.listing.suspended = !!body.suspended;
  store.save();
  return adminOverview();
});

// ----- customer account -----
const customerTelegram = (user) => {
  if (!user.linkCode) {
    user.linkCode = newLinkCode();
    store.save();
  }
  return { configured: tg.configured, linked: tg.configured && !!user.telegramChatId, botAt: botVars()['{{BOT_AT}}'], botUrl: botVars()['{{BOT_URL}}'], code: user.linkCode };
};

const myRequests = (user) =>
  Object.entries(db.tenants).flatMap(([tid, t]) =>
    t.enquiries.filter((e) => e.status === 'new' && e.uid === user.id).map((e) => ({ tid, id: e.id, businessName: t.settings.businessName, startDate: e.startDate || '', switching: !!e.switchFrom, at: e.at })));

route('DELETE', '/api/my/requests/:tid/:id', 'customer', ({ user, params }) => {
  const e = db.tenants[params.tid]?.enquiries.find((x) => x.id === params.id && x.uid === user.id && x.status === 'new');
  if (!e) throw bad('Request not found', 404);
  e.status = 'cancelled';
  store.save();
  return { requests: myRequests(user) };
});

route('GET', '/api/my', 'customer', ({ user }) => ({
  requests: myRequests(user),
  name: user.name,
  telegram: customerTelegram(user),
  subscriptions: visibleSubs(user).map(({ tid, t, c }) => ({ tid, cid: c.id, ...subOut(user, t, c) })),
}));

route('POST', '/api/my/telegram/unlink', 'customer', ({ user }) => {
  user.telegramChatId = '';
  user.linkCode = newLinkCode(); // the old code stops working
  store.save();
  return customerTelegram(user);
});

// what the bot answers a connected customer who sends /status
const STATUS_TEXT = { delivered: 'Delivered today ✅', pending: 'Being prepared 🍱', leave: 'On leave today 🏖', none: 'No tiffin today 🌴' };
tg.customerStatus = (user) => {
  const subs = activeSubs(user);
  if (!subs.length) return 'No active tiffin service is linked to your number right now.';
  return subs.map(({ t, c }) => `<b>${esc(t.settings.businessName)}</b>: ${STATUS_TEXT[customerView(t, c).status]}`).join('\n');
};

const mySubAny = (user, params) =>
  orNotFound(visibleSubs(user).find((s) => s.tid === params.tid && s.c.id === params.cid), 'Subscription not found');
const mySub = (user, params) => {
  const s = mySubAny(user, params);
  if ((s.c.consent || 'ok') !== 'ok') throw bad('Please accept this service first.');
  return s;
};

route('POST', '/api/my/:tid/:cid/accept', 'customer', ({ user, params }) => {
  const { t, c } = mySubAny(user, params);
  c.consent = 'ok';
  store.save();
  tg.notify(t, `✅ <b>${esc(c.name)}</b> confirmed they are your customer.`);
  return { tid: params.tid, cid: c.id, ...subOut(user, t, c) };
});
route('POST', '/api/my/:tid/:cid/decline', 'customer', ({ user, params }) => {
  const { t, c } = mySubAny(user, params);
  c.consent = 'declined';
  store.save();
  tg.notify(t, `🚫 The person with <b>${esc(c.name)}</b>'s number says they are not your customer. They are not counted. Please check the number, or delete the record.`);
  return { ok: true };
});

route('POST', '/api/my/leaves', 'customer', ({ user, body }) => {
  const subs = activeSubs(user).filter(({ c }) => !c.endDate || c.endDate >= body.from);
  if (!subs.length) throw bad('You have no active tiffin service to mark leave for.');
  const skipped = [];
  let applied = 0;
  for (const { t, c } of subs) {
    try {
      customerAddLeave(t, c, body);
      applied++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      skipped.push({ name: t.settings.businessName, error: e.message }); // e.g. that provider's cut-off time has passed
    }
  }
  if (!applied) throw bad(skipped.map((x) => `${x.name}: ${x.error}`).join(' '));
  return { applied, skipped, subscriptions: visibleSubs(user).map(({ tid, t, c }) => ({ tid, cid: c.id, ...subOut(user, t, c) })) };
});

route('POST', '/api/my/:tid/:cid/stop', 'customer', ({ user, params, body }) => {
  const { t, c } = mySub(user, params);
  if (isEnded(c)) throw bad('This tiffin service has already ended.');
  const min = L.addDays(L.leaveMinDate(t), -1);
  const last = L.isDate(body.lastDay) ? body.lastDay : min;
  if (last < min) throw bad(`The last tiffin day can be ${L.fmtDate(min)} or later.`);
  if (last > L.addDays(L.todayStr(), 120)) throw bad('Please choose a last day within the next 4 months.');
  c.endDate = last;
  c.endedBy = 'customer';
  c.endedAt = Date.now();
  store.save();
  tg.notify(t, `👋 <b>${esc(c.name)}</b> is stopping their tiffin. Last tiffin day: <b>${L.fmtDate(last)}</b>.`);
  return { tid: params.tid, cid: c.id, ...customerView(t, c) };
});

route('POST', '/api/my/:tid/:cid/resume', 'customer', ({ user, params }) => {
  const { t, c } = mySub(user, params);
  if (c.endedBy !== 'customer' || !c.endDate) throw bad('There is nothing to undo here.');
  if (isEnded(c)) throw bad('This service has already ended. Use “Find a tiffin service” to join again.');
  c.endDate = '';
  c.endedBy = '';
  store.save();
  tg.notify(t, `↩️ <b>${esc(c.name)}</b> changed their mind and is continuing their tiffin.`);
  return { tid: params.tid, cid: c.id, ...customerView(t, c) };
});

route('POST', '/api/my/:tid/:cid/leaves', 'customer', ({ user, params, body }) => {
  const { t, c } = mySub(user, params);
  return { tid: params.tid, cid: c.id, ...customerAddLeave(t, c, body) };
});

route('DELETE', '/api/my/:tid/:cid/leaves/:lid', 'customer', ({ user, params }) => {
  const { t, c } = mySub(user, params);
  return { tid: params.tid, cid: c.id, ...customerRemoveLeave(t, c, params.lid) };
});

route('PUT', '/api/my/:tid/:cid/rating', 'customer', ({ user, params, body }) => {
  const { t, c } = mySub(user, params);
  if (Date.now() < rateFrom(c).getTime()) throw bad(`You can rate this service after ${L.fmtDate(L.ymd(rateFrom(c)))}.`);
  const stars = int(body.stars, 1, 5, 0);
  if (!stars) throw bad('Please choose 1 to 5 stars.');
  let r = t.ratings.find((x) => x.uid === user.id);
  if (!r) t.ratings.push((r = { id: newId(), uid: user.id, who: str(user.name, 40).split(/\s+/)[0] || 'Customer', hidden: false, flagged: false, reply: '', replyAt: 0 }));
  Object.assign(r, { stars, comment: str(body.comment, 200), at: Date.now() });
  store.save();
  return { tid: params.tid, cid: c.id, ...subOut(user, t, c) };
});

// ----- provider: reviews and holiday closures -----
const reviewOut = (r) => ({ id: r.id, stars: r.stars, comment: r.comment, who: r.who, at: r.at, hidden: r.hidden, flagged: r.flagged, reply: r.reply });
route('GET', '/api/reviews', 'provider', ({ t }) => ({ ...ratingSummary(t), items: [...t.ratings].sort((a, b) => b.at - a.at).map(reviewOut) }));
route('POST', '/api/reviews/:id/reply', 'provider', ({ t, params, body }) => {
  const r = orNotFound(t.ratings.find((x) => x.id === params.id && !x.hidden), 'Review not found');
  r.reply = str(body.text, 300);
  r.replyAt = Date.now();
  store.save();
  return reviewOut(r);
});
route('POST', '/api/reviews/:id/report', 'provider', ({ t, params }) => {
  const r = orNotFound(t.ratings.find((x) => x.id === params.id), 'Review not found');
  r.flagged = true;
  store.save();
  return reviewOut(r);
});

const MAX_PAUSES = 20;
function pauseCustomers(t, text) {
  for (const c of t.customers) {
    if (isEnded(c) || (c.consent || 'ok') !== 'ok') continue;
    const u = loginFor(c.phone);
    if (u?.telegramChatId && tg.configured) tg.send(u.telegramChatId, text);
  }
}
route('POST', '/api/pauses', 'provider', ({ t, body }) => {
  const today = L.todayStr();
  if (!L.isDate(body.from) || !L.isDate(body.to)) throw bad('Please pick the first and last closed day.');
  if (body.to < body.from) throw bad('The last closed day cannot be before the first.');
  if (body.from < today) throw bad('Closures start today or later.');
  if (L.dayCount(body.from, body.to) > 120) throw bad('A closure can be up to 120 days.');
  t.settings.pauses = (t.settings.pauses || []).filter((p) => p.to >= today);
  if (t.settings.pauses.length >= MAX_PAUSES) throw bad('Too many closures. Remove an old one first.');
  const p = { id: newId(), from: body.from, to: body.to, note: str(body.note, 100) };
  t.settings.pauses.push(p);
  t.settings.pauses.sort((a, b) => a.from.localeCompare(b.from));
  store.save();
  const range = p.from === p.to ? L.fmtDate(p.from) : `${L.fmtDate(p.from)} to ${L.fmtDate(p.to)}`;
  pauseCustomers(t, `🏖 <b>${esc(t.settings.businessName)}</b> is closed ${range}.${p.note ? `\n${esc(p.note)}` : ''}\nNo tiffin on those days.`);
  return settingsOut(t);
});
route('DELETE', '/api/pauses/:id', 'provider', ({ t, params }) => {
  const p = orNotFound((t.settings.pauses || []).find((x) => x.id === params.id), 'Closure not found');
  t.settings.pauses = t.settings.pauses.filter((x) => x !== p);
  store.save();
  if (p.to >= L.todayStr()) pauseCustomers(t, `✅ <b>${esc(t.settings.businessName)}</b> will deliver as usual after all (closure ${L.fmtDate(p.from)}${p.from === p.to ? '' : ` to ${L.fmtDate(p.to)}`} cancelled).`);
  return settingsOut(t);
});

// ----- admin: reviews that were reported or need hiding -----
const adminReviews = () => Object.entries(db.tenants).flatMap(([tid, t]) => t.ratings.map((r) => ({ tid, provider: t.settings.businessName, ...reviewOut(r) })))
  .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.at - a.at).slice(0, 200);
route('GET', '/api/admin/reviews', 'admin', () => ({ items: adminReviews() }));
route('POST', '/api/admin/reviews/:tid/:id', 'admin', ({ params, body }) => {
  const r = orNotFound(db.tenants[params.tid]?.ratings.find((x) => x.id === params.id), 'Review not found');
  r.hidden = !!body.hidden;
  r.flagged = false;
  store.save();
  return adminOverview();
});

// ----- passwordless personal link (the secret token is the only credential) -----
route('POST', '/api/c/:token/accept', null, ({ params }) => {
  const [t, c] = findByToken(params.token);
  c.consent = 'ok';
  store.save();
  tg.notify(t, `✅ <b>${esc(c.name)}</b> confirmed they are your customer.`);
  return customerView(t, c);
});
route('GET', '/api/c/:token', null, ({ params }) => customerView(...findByToken(params.token)));
route('POST', '/api/c/:token/leaves', null, ({ params, body }) => {
  const [t, c] = findByToken(params.token);
  return customerAddLeave(t, c, body);
});
route('DELETE', '/api/c/:token/leaves/:lid', null, ({ params }) => {
  const [t, c] = findByToken(params.token);
  return customerRemoveLeave(t, c, params.lid);
});

// ---------- http plumbing ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', // customer links carry a secret token
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(bad('Request too large', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(bad('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  let setCookie = null;
  const send = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY,
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    });
    res.end(JSON.stringify(data));
  };
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw bad('Not found', 404);
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const cookieFor = (token, maxAge = SESSION_MS / 1000) => `${COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;

    const token = cookies(req)[COOKIE];
    const session = lookupSession(db, token);
    if (session?.renewed) {
      store.save();
      setCookie = cookieFor(token); // keep the browser cookie in step with the 30-day sliding window
    }
    const user = session?.user || null;
    if (r.auth && !user) throw bad('Please log in', 401);
    if (r.auth !== 'any' && r.auth && user.role !== r.auth) throw bad('This page is not for your account type', 403);

    const mutating = req.method !== 'GET';
    // JSON-only writes + SameSite cookie = no cross-site form posts
    if (mutating && !(req.headers['content-type'] || '').startsWith('application/json')) throw bad('Content-Type must be application/json', 415);
    const ctx = {
      req,
      user,
      t: user?.role === 'provider' ? db.tenants[user.id] : null,
      params: r.re.exec(url.pathname).groups || {},
      query: Object.fromEntries(url.searchParams),
      body: mutating ? await readBody(req) : {},
      ip: String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress, // last entry = the one our own proxy added; earlier ones can be forged
      setCookie: (tok, maxAge) => (setCookie = cookieFor(tok, maxAge)),
    };
    send(200, (await r.handler(ctx)) ?? {});
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server' });
  }
}

// clean URLs -> html files
const PAGES = { '/forgot': 'forgot.html', '/reset': 'reset.html', '/help': 'help.html', '/find': 'find.html', '/admin': 'admin.html', '/': 'index.html', '/login': 'login.html', '/signup': 'login.html', '/app': 'app.html', '/me': 'me.html' };

function serveGenerated(req, res, url) {
  const base = publicBase(req);
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...SECURITY });
    res.end(req.method === 'HEAD' ? undefined : fillBot(body, base));
  };
  const path_ = url.pathname.replace(/(.)\/$/, '$1');
  if (path_ === '/blog') return send(200, 'text/html; charset=utf-8', renderIndex(url.searchParams.get('for'), base)), true;
  const m = /^\/blog\/([a-z0-9-]+)$/.exec(path_);
  if (m) {
    const post = findPost(m[1]);
    return send(post ? 200 : 404, 'text/html; charset=utf-8', post ? renderPost(post, base) : '<h1>Post not found</h1><p><a href="/blog">Back to the blog</a></p>'), true;
  }
  if (path_ === '/sitemap.xml') {
    const urls = ['/', '/find', '/help', '/blog', ...postSlugs().map((s) => `/blog/${s}`)];
    return send(200, 'application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`), true;
  }
  if (path_ === '/robots.txt') return send(200, 'text/plain; charset=utf-8', `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /me\nDisallow: /admin\nDisallow: /api/\nDisallow: /c/\nSitemap: ${base}/sitemap.xml\n`), true;
  return false;
}

function serveStatic(req, res, url) {
  if (serveGenerated(req, res, url)) return;
  let rel = decodeURIComponent(url.pathname);
  if (/^\/c\/[^/]+\/?$/.test(rel)) rel = '/c.html';
  else if (PAGES[rel.replace(/(.)\/$/, '$1')]) rel = `/${PAGES[rel.replace(/(.)\/$/, '$1')]}`;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY });
    return res.end('Not found');
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (path.extname(file) === '.html') {
    const html = Buffer.from(fillBot(fs.readFileSync(file, 'utf8'), publicBase(req)));
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': html.length, 'Cache-Control': 'no-cache', ...SECURITY });
    return res.end(req.method === 'HEAD' ? undefined : html);
  }
  const size = fs.statSync(file).size;
  // Range support: browsers need it to play and seek video (Safari insists on it)
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...SECURITY });
      return res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...SECURITY });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...SECURITY });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // Behind an HTTPS-terminating proxy: send plain-http visitors to https, and tell browsers to stay on https.
  if (req.headers['x-forwarded-proto'] === 'http' && process.env.FORCE_HTTPS && req.headers.host) {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    return res.end();
  }
  if (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (url.pathname.startsWith('/api/')) handleApi(req, res, url);
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
  else {
    res.writeHead(405, SECURITY);
    res.end();
  }
});

// A join request nobody answered for a day (and again after three) gets a Telegram nudge to the provider.
function remindPending() {
  const due = dueReminders(Object.values(db.tenants));
  if (!due.length) return;
  store.save();
  for (const { tenant: t, late } of due) {
    tg.notify(t, `⏳ ${late.length} join request${late.length > 1 ? 's are' : ' is'} still waiting for your answer (${late.slice(0, 3).map((e) => esc(e.name)).join(', ')}). Open the app → Grow to accept or dismiss.`);
  }
}
for (const t of Object.values(db.tenants)) for (const c of t.customers) if (!c.code) c.code = newCode(); // older records get a sign-up code
store.save();

server.listen(PORT, HOST, () => {
  console.log(`MyTiffin app running on http://localhost:${PORT}  (timezone: ${process.env.TZ})`);
  if (!tg.configured) console.log('Telegram alerts are off (set TELEGRAM_BOT_TOKEN to enable).');
  tg.start();
  setInterval(() => tg.tick(), 30_000).unref();
  remindPending();
  setInterval(remindPending, 60 * 60 * 1000).unref();
  // Providers listed before this fix (pincode but no position) become findable by address / GPS search.
  (async () => { for (const t of Object.values(db.tenants)) await ensureCoords(t).catch(() => {}); })();
});
