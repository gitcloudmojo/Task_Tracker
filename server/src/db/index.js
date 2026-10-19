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
  await migrateApprovalToManager();
  await migrateNotesToLog();
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

  // The breakdown, and labels. Whole tables rather than columns, so they
  // arrive by way of schema.sql's CREATE TABLE IF NOT EXISTS on an existing
  // database too — nothing to do here but say so, and check, because a silent
  // assumption about which tables exist is how a migration goes wrong.
  const tables = (
    await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
  ).rows.map((t) => t.name);
  if (!tables.includes('task_steps')) {
    throw new Error('task_steps is missing — schema.sql did not run. The database may be read-only.');
  }
  if (!tables.includes('projects')) {
    throw new Error('projects is missing — schema.sql did not run. The database may be read-only.');
  }
  if (!tables.includes('labels')) {
    throw new Error('labels is missing — schema.sql did not run. The database may be read-only.');
  }
  if (!tables.includes('task_notes')) {
    throw new Error('task_notes is missing — schema.sql did not run. The database may be read-only.');
  }

  // Which task a label sits on. Needs `labels` to already exist, which the
  // schema.sql pass just above guarantees.
  if (!taskColumns.includes('label_id')) {
    await client.execute('ALTER TABLE tasks ADD COLUMN label_id INTEGER REFERENCES labels(id) ON DELETE SET NULL');
  }

  // Which repeating schedule a task came from, and which occurrence of it.
  // Existing tasks get NULL for both — they are one-offs, which is exactly
  // what they are. The unique index is what makes generation safe to run
  // from several places (cron, cold start, the save that created the
  // schedule) without ever doubling a task up; it only covers rows that
  // actually came from a schedule.
  if (!tables.includes('recurring_tasks')) {
    throw new Error('recurring_tasks is missing — schema.sql did not run. The database may be read-only.');
  }
  if (!taskColumns.includes('recurring_id')) {
    await client.execute(
      'ALTER TABLE tasks ADD COLUMN recurring_id INTEGER REFERENCES recurring_tasks(id) ON DELETE SET NULL'
    );
  }
  if (!taskColumns.includes('occurrence_date')) {
    await client.execute('ALTER TABLE tasks ADD COLUMN occurrence_date TEXT');
  }
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_recurring_occurrence
       ON tasks(recurring_id, occurrence_date) WHERE recurring_id IS NOT NULL`
  );
}

/**
 * Approval used to end with the CEO; now it ends with whoever checks the
 * work (the Manager, almost always — see services/workflow.js and the
 * `/tasks/:id/verify` route). Nothing written after that change ever leaves
 * a task sitting in `verified` — the check completes it in one move — so
 * this only ever has anything to do on a database that has tasks left over
 * from before the change, and it does nothing at all once it has swept them,
 * which is what makes it safe to run on every boot rather than once by hand.
 *
 * Each row keeps its own history rather than a blanket note: the person who
 * did the actual checking is credited as the approver too, on the day they
 * checked it — not "migrated on <today>" — because that is what actually
 * happened; the approval step just stopped being a separate wait after that.
 */
async function migrateApprovalToManager() {
  const stuck = await client.execute({
    sql: "SELECT id, verified_at, verified_by FROM tasks WHERE status = 'verified'",
    args: [],
  });
  if (!stuck.rows.length) return;

  const note =
    'Auto-approved: sign-off now completes as soon as the manager checks it, ' +
    'so this no longer waits on a separate CEO approval.';
  const stamp = nowSql();

  for (const t of stuck.rows) {
    const approverId = t.verified_by ?? null;
    await client.execute({
      sql: `UPDATE tasks
               SET status = 'approved', approved_at = ?, approved_by = ?, approved_note = ?, updated_at = ?
             WHERE id = ?`,
      args: [t.verified_at ?? stamp, approverId, note, stamp, t.id],
    });
    if (approverId) {
      await client.execute({
        sql: `INSERT INTO task_events (task_id, actor_id, action, from_status, to_status, note, created_at)
              VALUES (?,?,?,?,?,?,?)`,
        args: [t.id, approverId, 'approved', 'verified', 'approved', note, t.verified_at ?? stamp],
      });
      await client.execute({
        sql: `INSERT OR IGNORE INTO notifications
                (user_id, type, severity, title, body, task_id, dedupe_key, created_at)
              SELECT owner_id, 'task_approved', 'info', 'Approved: ' || name, ?, id, 'approved:' || id, ?
                FROM tasks WHERE id = ?`,
        args: [note, stamp, t.id],
      });
    }
  }
  console.log(`[migrate] moved ${stuck.rows.length} task(s) stuck at "verified" straight to "approved"`);
}

/**
 * Carry a task's original `notes` field into the new dated log as its first
 * entry, so a task that already had notes on it does not start the log
 * looking emptier than the task's actual history. Guarded by "no log entry
 * yet" rather than a one-off flag: a fresh task created with notes on it
 * gets logged the same way the next time this runs, and a task that already
 * has entries — migrated or written by hand — is never touched again.
 */
async function migrateNotesToLog() {
  const rows = await client.execute({
    sql: `SELECT id, notes, created_by, created_at FROM tasks
           WHERE notes IS NOT NULL AND trim(notes) <> ''
             AND NOT EXISTS (SELECT 1 FROM task_notes n WHERE n.task_id = tasks.id)`,
    args: [],
  });
  if (!rows.rows.length) return;

  for (const t of rows.rows) {
    const entryDate = String(t.created_at || nowSql()).slice(0, 10);
    await client.execute({
      sql: `INSERT INTO task_notes (task_id, author_id, body, entry_date, created_at)
            VALUES (?,?,?,?,?)`,
      args: [t.id, t.created_by, t.notes, entryDate, t.created_at || nowSql()],
    });
  }
  console.log(`[migrate] logged the original notes on ${rows.rows.length} task(s) as their first update`);
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
