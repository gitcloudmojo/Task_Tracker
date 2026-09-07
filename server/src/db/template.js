/**
 * Write a blank workbook you can start typing into.
 *
 *   npm run template                 → data/A1K-Task-Tracker-Template.xlsx
 *   npm run template -- --out ~/x.xlsx
 *   npm run template -- --people     → with the two roles that must exist
 *
 * This is deliberately separate from `seed`, which fills a workbook with demo
 * data. The template is what you hand to somebody on day one: the right sheets,
 * the right headers, the dropdowns wired up, and a Read me that says which
 * columns are safe to type into.
 *
 * The layout comes from the same `SHEETS` definition the app reads, so the
 * template cannot drift from what the app expects.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SERVER_ROOT } from '../config.js';
import { WorkbookStore } from './workbook.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const out = path.resolve(
  SERVER_ROOT,
  value('out', './data/A1K-Task-Tracker-Template.xlsx')
);

// A scratch database, so the template is written by exactly the same code path
// that writes a live workbook — no second implementation to keep in step.
const scratch = new Database(':memory:');
scratch.pragma('foreign_keys = ON');

scratch.exec(fs.readFileSync(path.join(SERVER_ROOT, 'src/db/schema.sql'), 'utf8'));

const store = new WorkbookStore(scratch, {
  file: out,
  attachmentsDir: path.resolve(SERVER_ROOT, './data/attachments'),
  credentialsFile: path.resolve(SERVER_ROOT, './data/template-credentials.json'),
  log: { log: () => {}, warn: () => {} },
});

if (flag('people')) {
  // The two seats the approval chain cannot work without. No passwords: the
  // first manager sets those in the app, or you run `npm run seed` instead.
  const add = scratch.prepare(
    `INSERT INTO users (name, email, password_hash, role, team, title)
     VALUES (?,?,?,?,?,?)`
  );
  add.run('Your CEO', 'ceo@yourcompany.com', '', 'ceo', 'Operations', 'Chief Executive Officer');
  add.run('Your manager', 'manager@yourcompany.com', '', 'admin', 'Operations', 'Manager');
}

await store.save();
// The template must never carry credentials, even an empty file of them.
const stray = path.resolve(SERVER_ROOT, './data/template-credentials.json');
if (fs.existsSync(stray)) fs.rmSync(stray);

const size = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`
Wrote ${out} (${size} KB)

  Read me       what is safe to type into, and what to leave to the app
  Dashboard     live counts, as formulas — right even with the app closed
  Tasks         task name · client · owner email · completion date
  People        name · email · role (ceo/admin/user) · team
  Task history  written by the app
  Messages      chat, written by the app
  Alerts        the bell, written by the app
  Files         attachment index, written by the app

Point the app at it:

  STORE=workbook WORKBOOK_FILE=${path.relative(SERVER_ROOT, out)} npm start
`);
