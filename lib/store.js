import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_SETTINGS = {
  businessName: 'My Tiffin Service',
  businessPhone: '',
  currency: '₹',
  prices: { normal: 0, deluxe: 0 }, // per box; 0 = not set
  closedDays: [], // weekdays with no service, 0 = Sunday
  cutoffHour: 0, // customers may cancel today's tiffin before this hour; 0 = tomorrow onwards only
  morningTime: '07:00', // Telegram "today" summary, '' to disable
  eveningTime: '20:00', // Telegram "tomorrow" summary, '' to disable
  telegramChatId: '',
  linkCode: '', // code the provider sends to the bot to connect Telegram
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newLinkCode = () => Array.from({ length: 8 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');

// Marketplace listing. Public coordinates are deliberately coarse (see lib/geo.js snap()).
export const newListing = () => ({
  id: crypto.randomBytes(6).toString('base64url'), // public id, different from the account id
  enabled: false,
  suspended: false, // set by the platform admin
  tagline: '',
  about: '',
  tags: [], // veg, non-veg, jain, ...
  meals: [], // breakfast, lunch, dinner
  area: '',
  city: '',
  pincode: '',
  servesPincodes: [],
  lat: null,
  lng: null,
  radiusKm: 5,
  approx: false, // location was worked out from the pincode, not set by the provider
});

// One tenant per provider: their settings, customers and delivery history.
export function newTenant(businessName) {
  return {
    listing: newListing(),
    enquiries: [], // { id, name, phone, address, type, note, at, status: 'new'|'added'|'dismissed' }
    settings: { ...DEFAULT_SETTINGS, businessName, prices: { ...DEFAULT_SETTINGS.prices }, linkCode: newLinkCode() },
    customers: [],
    deliveries: {}, // { 'YYYY-MM-DD': { customerId: deliveredAtMs } }
    notified: {}, // { morning: 'YYYY-MM-DD', evening: 'YYYY-MM-DD' }
  };
}

function normalizeTenant(t) {
  const base = newTenant('My Tiffin Service');
  return {
    listing: { ...base.listing, ...t.listing },
    enquiries: t.enquiries || [],
    settings: { ...base.settings, ...t.settings, prices: { ...base.settings.prices, ...t.settings?.prices } },
    customers: t.customers || [],
    deliveries: t.deliveries || {},
    notified: t.notified || {},
  };
}

// The whole database lives in one JSON file, written atomically on every change.
export class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'db.json');
    let raw = {};
    if (fs.existsSync(this.file)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (e) {
        throw new Error(`Cannot read ${this.file} (${e.message}). Fix it or restore db.backup.json.`);
      }
      fs.copyFileSync(this.file, path.join(dir, 'db.backup.json'));
    }
    this.db = {
      v: 2,
      users: raw.users || [], // { id, role: 'provider'|'customer', phone, key, name, pass }
      sessions: raw.sessions || {}, // { sha256(token): { userId, exp } }
      platform: {
        plans: [], // { id, name, days, radiusKm, price } - set by the admin
        orders: [], // ad orders, see lib/market.js
        payInstructions: '', // shown to providers when they order an ad (e.g. your UPI id)
        currency: '₹',
        geocache: {}, // query -> { lat, lng, label }
        resets: {}, // providerUserId -> { h: hash of Telegram reset code, exp, tries }
        resetTokens: {}, // sha256(token) -> { userId, exp } one-time password-reset links
        support: '', // contact text shown on the forgot-password page
        stats: {}, // tenantId -> { 'YYYY-MM-DD': { imp, spImp, enquiry } }
        ...raw.platform,
      },
      tenants: Object.fromEntries(Object.entries(raw.tenants || {}).map(([id, t]) => [id, normalizeTenant(t)])),
    };
    this.save();
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
}
