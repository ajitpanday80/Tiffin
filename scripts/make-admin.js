// Usage: node scripts/make-admin.js <phone> <password> [name]
// Creates (or resets) a platform admin. Admins sign in at /login?role=admin and use /admin.
// Run on the server with the same DATA_DIR as the app, then restart the app.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.js';
import { hashPassword, phoneKey, validPhone } from '../lib/auth.js';

const [phone, password, name = 'Admin'] = process.argv.slice(2);
if (!validPhone(phone) || !password || password.length < 8) {
  console.error('Usage: node scripts/make-admin.js <phone> <password (8+ chars)> [name]');
  process.exit(1);
}
const store = new Store(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));
const key = phoneKey(phone);
let user = store.db.users.find((u) => u.role === 'admin' && u.key === key);
if (!user) store.db.users.push((user = { id: crypto.randomBytes(6).toString('base64url'), role: 'admin', phone, key, name }));
user.pass = await hashPassword(password);
for (const [k, s] of Object.entries(store.db.sessions)) if (s.userId === user.id) delete store.db.sessions[k];
store.save();
console.log(`Admin ready: sign in at /login?role=admin with ${phone}`);
