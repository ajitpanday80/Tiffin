import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_SETTINGS = {
  businessName: 'My Tiffin Service',
  businessPhone: '',
  currency: '₹',
  countryCode: '91', // used to build WhatsApp numbers from 10-digit phones
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

// One tenant per provider: their settings, customers and delivery history.
export function newTenant(businessName) {
  return {
    settings: { ...DEFAULT_SETTINGS, businessName, prices: { ...DEFAULT_SETTINGS.prices }, linkCode: newLinkCode() },
    customers: [],
    deliveries: {}, // { 'YYYY-MM-DD': { customerId: deliveredAtMs } }
    notified: {}, // { morning: 'YYYY-MM-DD', evening: 'YYYY-MM-DD' }
  };
}

function normalizeTenant(t) {
  const base = newTenant('My Tiffin Service');
  return {
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
