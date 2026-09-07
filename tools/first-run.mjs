/**
 * First-run housekeeping, as a file rather than a one-liner inside a script.
 *
 * `npm run setup` used to do this with `node -e "…"`, which relies on the shell
 * quoting survivng npm — and cmd.exe on Windows does not treat quotes the way
 * bash does. A plain script has no quoting to get wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = path.join(root, 'server', '.env');
const example = path.join(root, 'server', '.env.example');

if (fs.existsSync(env)) {
  console.log('server/.env already exists — left alone.');
} else {
  fs.copyFileSync(example, env);
  console.log('Wrote server/.env from .env.example. Set JWT_SECRET before going live.');
}

// The data folder is where the database, the workbook and the attachments live.
fs.mkdirSync(path.join(root, 'server', 'data', 'attachments'), { recursive: true });
