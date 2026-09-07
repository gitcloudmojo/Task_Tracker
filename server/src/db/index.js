import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vercel/Turso edition.
 *
 * Same schema, same SQL, same business rules as the on-prem Standard edition —
 * the only thing that changed is that better-sqlite3 (a synchronous, local
 * file) became @libsql/client (an async call over the network to Turso, a
 * hosted SQLite-compatible database). Everywhere the original code called
 * `db.prepare(sql).get()/.all()/.run()`, this file returns the same shape, just
 * behind a Promise — every route in this app already goes through `wrap()`,
 * so an `async` handler was already a supported code path, not a new one.
 *
 * Excel Edition (the in-memory-SQLite-plus-workbook-file mode) needs local
 * disk to hold the .xlsx file and is not offered here — Vercel's filesystem is
 * read-only outside /tmp and does not persist between invocations. This
 * deployment is Standard/SQLite-compatible only.
 */
if ((config.store || 'sqlite').toLowerCase() === 'workbook') {
  console.error(
    'FATAL: STORE=workbook is not supported on this (Vercel/Turso) deployment. ' +
      'Excel Edition needs a persistent local disk; Vercel does not provide one. ' +
      'Use the on-prem Standard build for the workbook edition, or leave STORE unset here.'
  );
  process.exit(1);
}
if (!config.tursoUrl) {
  console.error('FATAL: TURSO_DATABASE_URL must be set (see server/.env.example).');
  process.exit(1);
}

export const client = createClient({
  url: config.tursoUrl,
  authToken: config.tursoAuthToken, // undefined is fine for a local file:./... URL
});

/** Turn `.run/.get/.all(a, b, c)` or `.run/.get/.all({named: 1})` into libsql args. */
function normalizeArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

class Stmt {
  constructor(sql, exec) {
    this.sql = sql;
    this._exec = exec; // either the top-level client or a live transaction
  }
  async get(...args) {
    const rs = await this._exec.execute({ sql: this.sql, args: normalizeArgs(args) });
    return rs.rows[0] ?? undefined;
  }
  async all(...args) {
    const rs = await this._exec.execute({ sql: this.sql, args: normalizeArgs(args) });
    return rs.rows;
  }
  async run(...args) {
    const rs = await this._exec.execute({ sql: this.sql, args: normalizeArgs(args) });
    return {
      changes: Number(rs.rowsAffected ?? 0),
      lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
    };
  }
}

/**
 * The async drop-in for better-sqlite3's `db`. Every call site that used to
 * read `db.prepare(sql).get(id)` now reads `await db.prepare(sql).get(id)` —
 * same statement objects, same argument style, one keyword added at each use.
 */
export const db = {
  prepare(sql) {
    return new Stmt(sql, client);
  },
  async exec(sql) {
    await client.executeMultiple(sql);
  },
};

/**
 * A real transaction, for the one place atomicity actually matters: a task
 * transition writing its new status and its history row together. Pass an
 * async function that receives a transaction-scoped `db`-shaped object (same
 * `.prepare().get/all/run()` surface, routed through the open transaction
 * instead of a one-off connection) and either both statements land or neither
 * does.
 */
export async function withTransaction(fn) {
  const t = await client.transaction('write');
  const txDb = { prepare: (sql) => new Stmt(sql, t) };
  try {
    const result = await fn(txDb);
    await t.commit();
    return result;
  } catch (err) {
    try {
      await t.rollback();
    } catch {
      // the transaction may already be closed by the failed statement — fine.
    }
    throw err;
  }
}

/** Create anything missing. Safe to run on every boot. */
export async function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await client.executeMultiple(schema);
  await patch();
}

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` cannot
 * add a column to a table that already exists, so each one is applied here,
 * guarded by what the database already has. Idempotent either way.
 */
async function patch() {
  const columns = async (table) =>
    (await client.execute(`PRAGMA table_info(${table})`)).rows.map((c) => c.name);
  const taskColumns = await columns('tasks');

  if (!taskColumns.includes('reassigned_at')) {
    await client.execute('ALTER TABLE tasks ADD COLUMN reassigned_at TEXT');
  }
  if (!taskColumns.includes('reassign_count')) {
    await client.execute('ALTER TABLE tasks ADD COLUMN reassign_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await columns('notifications')).includes('snoozed_until')) {
    await client.execute('ALTER TABLE notifications ADD COLUMN snoozed_until TEXT');
  }
}

/** What the app reports about where its data lives. */
export function storeStatus() {
  return {
    edition: 'Standard (Turso)',
    mode: 'turso',
    file: config.tursoUrl,
    exists: true,
    unsaved: false,
    problems: [],
    conflicts: [],
    attachmentsDir: config.blobPrefix,
  };
}

export const EDITION = 'Standard (Turso)';

/** `now()` in the format the schema stores: 'YYYY-MM-DD HH:MM:SS', UTC. */
export function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Today as 'YYYY-MM-DD' in server local time. */
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * A serverless function starts cold and must not serve a request before the
 * schema exists. Call and await this once per cold start (see api/index.js) —
 * cheap and idempotent on a warm one, since `migrate()` is all
 * `IF NOT EXISTS`/guarded `ALTER TABLE`.
 */
let migrated = null;
export function ensureMigrated() {
  if (!migrated) migrated = migrate();
  return migrated;
}
