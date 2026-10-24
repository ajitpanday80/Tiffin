import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.TZ ||= 'Asia/Kolkata'; // "today" must match the provider's wall clock; override with TZ=...

import { Store, newTenant, newLinkCode } from './lib/store.js';
import { Limiter } from './lib/limiter.js';
import { Telegram, leaveText, esc } from './lib/telegram.js';
import { phoneKey, validPhone, hashPassword, verifyPassword, createSession, lookupSession, destroySession, SESSION_MS } from './lib/auth.js';
import * as L from './lib/logic.js';
import * as M from './lib/market.js';
import { Geocoder, snap, validCoords } from './lib/geo.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const COOKIE = 'tiffin_session';

const store = new Store(process.env.DATA_DIR || path.join(ROOT, 'data'));
const { db } = store;
const tg = new Telegram({ token: process.env.TELEGRAM_BOT_TOKEN, store });
const geo = new Geocoder({
  store,
  country: (process.env.COUNTRY || 'in').toLowerCase(), // ISO country code used to bias address / pincode lookups
  enabled: process.env.GEOCODER !== 'off',
  userAgent: `tiffin-manager/1.0 ${process.env.GEOCODER_CONTACT || ''}`.trim(), // Nominatim asks for a contact
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
const searchLimiter = new Limiter(40, 60 * 1000);
const enquiryLimiter = new Limiter(5, 60 * 60 * 1000);

const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2),
  );

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
  return { ...s, telegram: { configured: tg.configured, linked: tg.isLinked(t), bot: tg.botName, code: linkCode } };
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
    leaves: c.leaves.filter((l) => l.to >= today).map(({ id, from, to }) => ({ id, from, to })),
  };
}

// Customer-initiated leave changes (shared by the personal link and logged-in accounts).
function customerAddLeave(t, c, body) {
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
  if (role === 'provider') {
    name = str(ctx.body.businessName, 60);
    if (!name) throw bad('Please enter your tiffin service name');
  } else {
    const subs = subscriptionsFor({ key });
    if (!subs.length) throw bad('We could not find this number. Ask your tiffin provider to add you with this phone number first.');
    name = subs[0].c.name;
  }
  const user = { id: newId(), role, phone, key, name, pass: await hashPassword(password) };
  db.users.push(user);
  if (role === 'provider') db.tenants[user.id] = newTenant(name);
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

// ----- provider -----
route('GET', '/api/settings', 'provider', ({ t }) => settingsOut(t));

route('PUT', '/api/settings', 'provider', ({ t, body: b }) => {
  const s = t.settings;
  s.businessName = str(b.businessName, 60) || s.businessName;
  s.businessPhone = str(b.businessPhone, 20);
  s.currency = str(b.currency, 4) || '₹';
  s.countryCode = str(b.countryCode, 4).replace(/\D/g, '') || s.countryCode;
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
  if (!(await tg.notify(t, '✅ Test message from your Tiffin app. Alerts are working!'))) throw bad('Telegram did not accept the message. Check the server log.', 502);
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

route('POST', '/api/customers', 'provider', ({ t, body }) => {
  const c = { id: newId(), token: crypto.randomBytes(12).toString('base64url'), ...cleanCustomer(body), leaves: [] };
  t.customers.push(c);
  store.save();
  return c;
});

route('PUT', '/api/customers/:id', 'provider', ({ t, params, body }) => {
  const c = findCustomer(t, params.id);
  Object.assign(c, cleanCustomer(body, c));
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
const seenClicks = new Map(); // "ip|lid|type" -> time, so one person cannot inflate counts

route('GET', '/api/market/search', null, async ({ query, ip }) => {
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
  return { mode: origin ? 'distance' : 'pincode', label, pin, results: found.map(M.card) };
});

route('POST', '/api/market/:lid/click', null, ({ params, body, ip }) => {
  const { tid } = findListing(params.lid);
  const type = ['call', 'whatsapp', 'view'].includes(body.type) ? body.type : null;
  if (!type) throw bad('Invalid click');
  const key = `${ip}|${params.lid}|${type}`;
  if (Date.now() - (seenClicks.get(key) || 0) > 3600e3) {
    if (seenClicks.size > 10000) seenClicks.clear();
    seenClicks.set(key, Date.now());
    M.track(db, tid, type);
    store.save();
  }
  return { ok: true };
});

route('POST', '/api/market/:lid/enquire', null, ({ params, body, ip }) => {
  const { tid, t } = findListing(params.lid);
  if (enquiryLimiter.blocked(ip)) throw bad('Too many requests. Please try again later.', 429);
  const name = str(body.name, 60);
  const phone = str(body.phone, 20).replace(/[^\d+]/g, '');
  if (!name) throw bad('Please enter your name');
  if (!validPhone(phone)) throw bad('Please enter a valid phone number');
  enquiryLimiter.fail(ip);
  if (t.enquiries.some((e) => e.status === 'new' && phoneKey(e.phone) === phoneKey(phone))) return { ok: true }; // already waiting; don't spam
  t.enquiries.unshift({ id: newId(), name, phone, address: str(body.address, 200), type: body.type === 'deluxe' ? 'deluxe' : 'normal', note: str(body.note, 200), at: Date.now(), status: 'new' });
  if (t.enquiries.length > 200) t.enquiries = t.enquiries.filter((e, i) => i < 200 || e.status === 'new');
  M.track(db, tid, 'enquiry');
  store.save();
  tg.notify(t, `📩 <b>New enquiry</b> from the marketplace\n${esc(name)} · ${esc(phone)}${body.address ? `\n📍 ${esc(str(body.address, 200))}` : ''}\nOpen the app → Grow to add them.`);
  return { ok: true };
});

// ----- provider: listing, enquiries, ads -----
const listingOut = (t) => ({ ...t.listing, listed: M.isListed(t), tags: t.listing.tags, options: { tags: TAGS, meals: MEALS } });

route('GET', '/api/listing', 'provider', ({ t, user }) => ({
  ...listingOut(t),
  stats: M.statsFor(db, user.id),
  newEnquiries: t.enquiries.filter((e) => e.status === 'new').length,
  hasPhone: !!t.settings.businessPhone,
}));

route('PUT', '/api/listing', 'provider', ({ t, body: b }) => {
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
  if (b.clearLocation) next.lat = next.lng = null;
  else if (b.lat != null && validCoords(Number(b.lat), Number(b.lng))) {
    next.lat = snap(Number(b.lat));
    next.lng = snap(Number(b.lng));
  }
  const enabled = !!b.enabled;
  if (enabled && !next.area) throw bad('Please add your area or locality so customers know where you are');
  if (enabled && next.lat == null && !next.pincode) throw bad('Add your pincode or set your location to be listed');
  Object.assign(l, next, { enabled });
  store.save();
  return listingOut(t);
});

route('POST', '/api/listing/locate', 'provider', async ({ body }) => {
  const q = str(body.q, 200);
  if (!q) throw bad('Type your pincode or address first');
  const g = await geo.lookup(q);
  if (!g) throw bad('Could not find that place. You can use your phone’s location instead.');
  return { lat: snap(g.lat), lng: snap(g.lng), label: g.label };
});

route('GET', '/api/enquiries', 'provider', ({ t }) => ({ enquiries: t.enquiries.filter((e) => e.status === 'new') }));

route('POST', '/api/enquiries/:id/accept', 'provider', ({ t, params }) => {
  const e = orNotFound(t.enquiries.find((x) => x.id === params.id && x.status === 'new'), 'Enquiry not found');
  const c = { id: newId(), token: crypto.randomBytes(12).toString('base64url'), ...cleanCustomer({ name: e.name, phone: e.phone, address: e.address, type: e.type, note: e.note }), leaves: [] };
  t.customers.push(c);
  e.status = 'added';
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
  currency: db.platform.currency,
  payInstructions: db.platform.payInstructions,
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
  db.platform.currency = str(body.currency, 4) || db.platform.currency;
  store.save();
  return adminOverview();
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
route('GET', '/api/my', 'customer', ({ user }) => ({
  name: user.name,
  subscriptions: subscriptionsFor(user).map(({ tid, t, c }) => ({ tid, cid: c.id, ...customerView(t, c) })),
}));

const mySub = (user, params) =>
  orNotFound(subscriptionsFor(user).find((s) => s.tid === params.tid && s.c.id === params.cid), 'Subscription not found');

route('POST', '/api/my/:tid/:cid/leaves', 'customer', ({ user, params, body }) => {
  const { t, c } = mySub(user, params);
  return { tid: params.tid, cid: c.id, ...customerAddLeave(t, c, body) };
});

route('DELETE', '/api/my/:tid/:cid/leaves/:lid', 'customer', ({ user, params }) => {
  const { t, c } = mySub(user, params);
  return { tid: params.tid, cid: c.id, ...customerRemoveLeave(t, c, params.lid) };
});

// ----- passwordless personal link (the secret token is the only credential) -----
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
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress,
      setCookie: (tok, maxAge) => (setCookie = cookieFor(tok, maxAge)),
    };
    send(200, (await r.handler(ctx)) ?? {});
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server' });
  }
}

// clean URLs -> html files
const PAGES = { '/find': 'find.html', '/admin': 'admin.html', '/': 'index.html', '/login': 'login.html', '/signup': 'login.html', '/app': 'app.html', '/me': 'me.html' };

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (/^\/c\/[^/]+\/?$/.test(rel)) rel = '/c.html';
  else if (PAGES[rel.replace(/(.)\/$/, '$1')]) rel = `/${PAGES[rel.replace(/(.)\/$/, '$1')]}`;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) handleApi(req, res, url);
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
  else {
    res.writeHead(405, SECURITY);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Tiffin app running on http://localhost:${PORT}  (timezone: ${process.env.TZ})`);
  if (!tg.configured) console.log('Telegram alerts are off (set TELEGRAM_BOT_TOKEN to enable).');
  tg.start();
  setInterval(() => tg.tick(), 30_000).unref();
});
