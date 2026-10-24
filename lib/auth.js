import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // stay logged in for 30 days

// Phones are compared on their last 10 digits so "+91 98765 43210" == "09876543210".
export const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const validPhone = (p) => {
  const n = String(p || '').replace(/\D/g, '').length;
  return n >= 7 && n <= 15;
};

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
const DUMMY = hashPassword('dummy-password'); // equalises timing when the phone is unknown
export async function verifyPassword(pw, stored) {
  const [salt, hash] = (stored || (await DUMMY)).split(':');
  const got = await scrypt(String(pw), Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex')) && !!stored;
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, userId) {
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k];
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { userId, exp: now + SESSION_MS };
  return token;
}

// Returns { user, renewed } or null. Sessions slide: any use more than a day after
// the last renewal pushes the expiry out to a fresh 30 days.
export function lookupSession(db, token) {
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s) return null;
  if (s.exp < Date.now()) {
    delete db.sessions[sha(token)];
    return null;
  }
  const user = db.users.find((u) => u.id === s.userId);
  if (!user) return null;
  const renewed = s.exp - Date.now() < SESSION_MS - 24 * 60 * 60 * 1000;
  if (renewed) s.exp = Date.now() + SESSION_MS;
  return { user, renewed };
}

export const destroySession = (db, token) => {
  if (token) delete db.sessions[sha(token)];
};
