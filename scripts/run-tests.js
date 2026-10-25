// Runs every test/*.test.js with Node's built-in runner. Lists the files itself because
// `node --test "glob"` only works on newer Node versions (not on Node 18/20).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
