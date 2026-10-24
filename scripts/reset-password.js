// Usage: node scripts/reset-password.js <provider|customer> <phone> <new-password>
// Run on the server (same DATA_DIR as the app). Stop/restart the app afterwards so it reloads the file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.js';
import { hashPassword, phoneKey } from '../lib/auth.js';

const [role, phone, password] = process.argv.slice(2);
if (!['provider', 'customer'].includes(role) || !phone || !password || password.length < 6) {
  console.error('Usage: node scripts/reset-password.js <provider|customer> <phone> <new-password (6+ chars)>');
  process.exit(1);
}
const store = new Store(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));
const user = store.db.users.find((u) => u.role === role && u.key === phoneKey(phone));
if (!user) {
  console.error('No such account.');
  process.exit(1);
}
user.pass = await hashPassword(password);
for (const [k, s] of Object.entries(store.db.sessions)) if (s.userId === user.id) delete store.db.sessions[k];
store.save();
console.log(`Password reset for ${user.name}. They were logged out everywhere. Restart the app to pick this up.`);
