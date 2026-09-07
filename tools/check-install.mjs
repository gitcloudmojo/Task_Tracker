/**
 * Refuse to run before the dependencies are installed, and say so in English.
 *
 *   node tools/check-install.mjs server   (or client, or both)
 *
 * This is three packages in one folder — the root holds only the scripts that
 * drive the other two — so `npm install` at the root is never enough. Without
 * this guard the first thing anybody sees is
 *
 *     Cannot find package 'express' imported from …/server/src/index.js
 *
 * which is a true statement and a useless one. It is wired to the `pre` hooks of
 * every script that needs a real install, so the message arrives before the
 * stack trace instead of after it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = (process.argv[2] || 'both').toLowerCase();

/** One well-known package per half — enough to know the install really ran. */
const halves = [
  { name: 'server', probe: 'express', install: 'npm --prefix server install' },
  { name: 'client', probe: 'vite', install: 'npm --prefix client install' },
];

const missing = halves
  .filter((h) => which === 'both' || which === h.name)
  .filter((h) => !fs.existsSync(path.join(root, h.name, 'node_modules', h.probe)));

if (missing.length) {
  const one = missing.length === 1;
  console.error(`
  ────────────────────────────────────────────────────────────────────
  The ${missing.map((m) => m.name).join(' and ')} ${one ? 'half has' : 'halves have'} not been installed yet.

  This project is three packages in one folder: the root holds the
  scripts, and the server and the client each have their own
  dependencies. Running "npm install" at the root only installs the
  scripts — which is why nothing works yet.

  Fix it with one command:

      npm run setup

  (that installs both halves, writes server/.env and seeds the demo
   data — it is safe to run again on an existing folder)

  Or install by hand:

${missing.map((m) => `      ${m.install}`).join('\n')}
  ────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}
