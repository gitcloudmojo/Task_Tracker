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
  if (!taskColumns.includes('label_id')) {
    await client.execute('ALTER TABLE tasks ADD COLUMN label_id INTEGER REFERENCES labels(id) ON DELETE SET NULL');
  }
  // Deliberately not in schema.sql: on a database that already had `tasks`
  // before label_id existed, CREATE TABLE IF NOT EXISTS there is a no-op, so
  // an index on label_id would be asked for before the ALTER TABLE above ever
  // ran — which is exactly what broke production (SQL_INPUT_ERROR: no such
  // column: label_id). By construction, label_id exists by this line either
  // way, so the index is safe to create here instead, every time.
  await client.execute('CREATE INDEX IF NOT EXISTS idx_tasks_label ON tasks(label_id)');
  if (!(await columns('notifications')).includes('snoozed_until')) {
    await client.execute('ALTER TABLE notifications ADD COLUMN snoozed_until TEXT');
  }

  // The breakdown, projects, labels, the notes log. Whole tables rather than
  // columns, so each arrives by way of schema.sql's CREATE TABLE IF NOT
  // EXISTS on an existing database too — nothing to do here but say so, and
  // check, because a silent assumption about which tables exist is how a
  // migration goes wrong.
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

  // These two are one-time data backfills, not schema — the tables and
  // columns above are what a request actually needs to exist. A single bad
  // row in either backfill must never be able to take the whole app down:
  // this middleware runs in front of every request (see index.js), so an
  // uncaught rejection here would fail every login, not just the migration.
  // Logged loudly so it is not silently lost, but never rethrown.
  try {
    await closeOutStaleApprovals();
  } catch (err) {
    console.error('[migrate] closeOutStaleApprovals failed — continuing without it:', err);
  }
  try {
    await carryForwardLegacyNotes();
  } catch (err) {
    console.error('[migrate] carryForwardLegacyNotes failed — continuing without it:', err);
  }
}

/**
 * One-time data fix for the day the CEO approval gate was retired.
 *
 * Before that change, a task sat in `verified` — checked by a manager, still
 * waiting on the CEO — until somebody with `tasks.approve` clicked once more.
 * Any task still sitting there when this ships was caught mid-flight by a
 * rule that no longer applies, so it is closed out the same way the code now
 * closes out every new one: a manager's verification is the final word.
 * Attributed to whoever verified it (the only person who touched it), with a
 * note on the task and a line in its history explaining why an "approved"
 * entry appears with nobody having clicked "approve". Guarded by the WHERE
 * clause alone — once a row is moved to `approved` it no longer matches, so
 * this is safe to run on every boot, same as the rest of `patch()`.
 */
async function closeOutStaleApprovals() {
  const stale = (
    await client.execute(
      "SELECT id, verified_at, verified_by, created_by FROM tasks WHERE status = 'verified'"
    )
  ).rows;
  for (const t of stale) {
    try {
      const stamp = t.verified_at || nowSql();
      // task_events.actor_id is NOT NULL and has no sensible "the system did
      // this" value. Ordinarily verified_by is set — a task cannot reach
      // 'verified' without somebody checking it — but a row from far enough
      // back, or one edited by hand, might not have it. Falling back to
      // created_by (itself NOT NULL) keeps this migration from ever failing
      // on a row it cannot perfectly attribute; the note below says so.
      const actorId = t.verified_by ?? t.created_by;
      const attributionNote =
        t.verified_by == null
          ? 'Auto-approved: a manager’s verification is now the final sign-off, so this no longer waits on the CEO. (No verifier was recorded on this task, so it is logged against whoever created it.)'
          : 'Auto-approved: a manager’s verification is now the final sign-off, so this no longer waits on the CEO.';
      await client.execute({
        sql: `UPDATE tasks SET status = 'approved', approved_at = ?, approved_by = ?, approved_note = ? WHERE id = ?`,
        args: [stamp, t.verified_by ?? null, attributionNote, t.id],
      });
      await client.execute({
        sql: `INSERT INTO task_events (task_id, actor_id, action, from_status, to_status, note, created_at)
              VALUES (?,?,?,?,?,?,?)`,
        args: [
          t.id,
          actorId,
          'approved',
          'verified',
          'approved',
          'Workflow change: verification now completes a task, so this — caught mid-flight — was closed out rather than left waiting on an approval step that no longer exists.',
          nowSql(),
        ],
      });
    } catch (err) {
      // One row's worth of bad data must never stop the rest of the batch,
      // or the boot-time check that runs this at all — see patch()'s caller.
      console.error(`[migrate] closeOutStaleApprovals: skipped task ${t.id}:`, err);
    }
  }
}

/**
 * One-time data carry-forward for the day the single `notes` field became a
 * dated log (`task_notes`). A task's existing note is not discarded — it
 * becomes that task's first log entry, attributed to whoever created the
 * task (the only author a single free-text field ever recorded) and dated to
 * the task's last update, which is the closest fact the old column kept to
 * "when was this written". Guarded by the `NOT EXISTS` below rather than a
 * one-off flag: once a task has at least one log entry this no longer
 * matches it, so — like the rest of `patch()` — it is safe to run every boot.
 * The old `notes` column is left in place afterward (untouched, not read by
 * the app any more) rather than dropped, so nothing here is destructive.
 */
async function carryForwardLegacyNotes() {
  const legacy = (
    await client.execute(
      `SELECT t.id, t.notes, t.created_by, t.updated_at FROM tasks t
        WHERE t.notes IS NOT NULL AND trim(t.notes) <> ''
          AND NOT EXISTS (SELECT 1 FROM task_notes n WHERE n.task_id = t.id)`
    )
  ).rows;
  for (const t of legacy) {
    try {
      const stamp = t.updated_at || nowSql();
      const entryDate = String(stamp).slice(0, 10);
      await client.execute({
        sql: `INSERT INTO task_notes (task_id, author_id, body, entry_date, created_at)
              VALUES (?,?,?,?,?)`,
        args: [t.id, t.created_by, t.notes, entryDate, stamp],
      });
    } catch (err) {
      // Same reasoning as closeOutStaleApprovals: a single row must never be
      // able to stop the batch, let alone the request that triggered it.
      console.error(`[migrate] carryForwardLegacyNotes: skipped task ${t.id}:`, err);
    }
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
