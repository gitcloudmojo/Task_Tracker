/**
 * The workbook store — an Excel file as the system of record.
 *
 * WHY IT IS BUILT THIS WAY
 *
 * A spreadsheet is a fine *file format* and a poor *query engine*. It has no
 * transactions, no constraints, no joins and no way to stop two writers
 * trampling each other. So this mode does not rewrite the application to talk
 * to a spreadsheet. Instead:
 *
 *   the workbook is the durable store  ·  SQLite (in memory) is the engine
 *
 * At boot the sheets are read into an in-memory database that has the real
 * schema — same tables, same constraints, same rules. Every write the app makes
 * goes through the same routes and the same `transition()` as always, and a
 * moment later the whole workbook is written back out, atomically. Nothing in
 * `routes/` or `services/` knows this mode exists.
 *
 * WHAT THAT BUYS, AND WHAT IT COSTS
 *
 *   + The file people can open in Excel *is* the database. No export step, no
 *     sync, no second copy to reconcile.
 *   + Rows typed straight into the sheet are adopted on the next read: a task
 *     with no ID gets one, and the app takes it from there.
 *   + Everything the app itself does is still governed by the approval rules.
 *   − Anybody who can open the file can edit it, so the record is only as
 *     trustworthy as the people with access to the folder. The app cannot
 *     refuse what it did not do.
 *   − One process must own the file. Two servers pointed at one workbook will
 *     overwrite each other; that is a property of the format, not a bug here.
 *
 * Passwords are deliberately NOT in the workbook — see `credentials.json`
 * below. A workbook gets emailed around; a password hash should not.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Teams and roles, duplicated here only to drive the dropdowns in the sheet. */
export const TEAM_LIST = ['Sales', 'Pre-sales', 'Design', 'Delivery', 'IT', 'Finance', 'Operations'];
export const ROLE_LIST = ['ceo', 'admin', 'user'];
export const STATUS_LIST = ['open', 'submitted', 'verified', 'approved', 'cancelled'];
export const PRIORITY_LIST = ['high', 'normal'];

/**
 * How each table is laid out as a sheet.
 *
 * `type` decides the round trip:
 *   int/num    a number
 *   bool       TRUE / FALSE
 *   text       a string
 *   date       a real Excel date, stored as YYYY-MM-DD
 *   datetime   a real Excel date and time, stored as YYYY-MM-DD HH:MM:SS
 *   person     a person's *email* in the sheet, their id in the database —
 *              because "alfiya@cloudmojo.tech" is editable by a human and "2"
 *              is not.
 */
export const SHEETS = [
  {
    sheet: 'People',
    table: 'users',
    // People come first on import: everything else refers to them by email.
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 6 },
      { header: 'Name', col: 'name', type: 'text', width: 24, required: true },
      { header: 'Email', col: 'email', type: 'text', width: 30, required: true },
      { header: 'Role', col: 'role', type: 'text', width: 10, list: ROLE_LIST, default: 'user' },
      { header: 'Team', col: 'team', type: 'text', width: 14, list: TEAM_LIST },
      { header: 'Job title', col: 'title', type: 'text', width: 26 },
      { header: 'Active', col: 'is_active', type: 'bool', width: 9, default: 1 },
      { header: 'Remind days before', col: 'reminder_days_before', type: 'int', width: 19, default: 2 },
      { header: 'Added', col: 'created_at', type: 'datetime', width: 19 },
      { header: 'Updated', col: 'updated_at', type: 'datetime', width: 19 },
    ],
  },
  {
    sheet: 'Tasks',
    table: 'tasks',
    columns: [
      { header: 'Task ID', col: 'id', type: 'int', width: 8 },
      { header: 'Task name', col: 'name', type: 'text', width: 46, required: true },
      { header: 'Client', col: 'client_name', type: 'text', width: 22, required: true },
      { header: 'Owner', col: 'owner_id', type: 'person', width: 28, required: true },
      { header: 'Completion date', col: 'completion_date', type: 'date', width: 16, required: true },
      { header: 'Priority', col: 'priority', type: 'text', width: 10, list: PRIORITY_LIST, default: 'normal' },
      { header: 'Status', col: 'status', type: 'text', width: 12, list: STATUS_LIST, default: 'open' },
      { header: 'Notes', col: 'notes', type: 'text', width: 50 },
      // Left blank by anybody typing a row in by hand, so it falls back to the
      // owner: if nobody says who assigned it, they gave it to themselves.
      { header: 'Assigned by', col: 'created_by', type: 'person', width: 28, fallback: 'owner_id' },
      { header: 'Marked done at', col: 'submitted_at', type: 'datetime', width: 19 },
      { header: 'Marked done note', col: 'submitted_note', type: 'text', width: 34 },
      { header: 'Checked at', col: 'verified_at', type: 'datetime', width: 19 },
      { header: 'Checked by', col: 'verified_by', type: 'person', width: 28 },
      { header: 'Checked note', col: 'verified_note', type: 'text', width: 34 },
      { header: 'Approved at', col: 'approved_at', type: 'datetime', width: 19 },
      { header: 'Approved by', col: 'approved_by', type: 'person', width: 28 },
      { header: 'Approved note', col: 'approved_note', type: 'text', width: 34 },
      { header: 'Sent back at', col: 'returned_at', type: 'datetime', width: 19 },
      { header: 'Sent back by', col: 'returned_by', type: 'person', width: 28 },
      { header: 'Sent back reason', col: 'return_reason', type: 'text', width: 40 },
      { header: 'Times sent back', col: 'return_count', type: 'int', width: 15, default: 0 },
      { header: 'Cancelled at', col: 'cancelled_at', type: 'datetime', width: 19 },
      { header: 'Cancel reason', col: 'cancel_reason', type: 'text', width: 30 },
      { header: 'Reassigned at', col: 'reassigned_at', type: 'datetime', width: 19 },
      { header: 'Times reassigned', col: 'reassign_count', type: 'int', width: 16, default: 0 },
      { header: 'Created', col: 'created_at', type: 'datetime', width: 19 },
      { header: 'Updated', col: 'updated_at', type: 'datetime', width: 19 },
    ],
  },
  {
    // Excel reserves the sheet name "History" for its own use, so this one
    // spells it out.
    sheet: 'Task history',
    table: 'task_events',
    note: 'Append-only. The app writes this; editing it rewrites the past.',
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 7 },
      { header: 'Task ID', col: 'task_id', type: 'int', width: 8, required: true },
      { header: 'Who', col: 'actor_id', type: 'person', width: 28, required: true },
      { header: 'Did', col: 'action', type: 'text', width: 16, required: true },
      { header: 'From', col: 'from_status', type: 'text', width: 11 },
      { header: 'To', col: 'to_status', type: 'text', width: 11 },
      { header: 'Note', col: 'note', type: 'text', width: 60 },
      { header: 'When', col: 'created_at', type: 'datetime', width: 19 },
    ],
  },
  {
    sheet: 'Messages',
    table: 'chat_messages',
    note: 'Chat, up and down the line only.',
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 7 },
      { header: 'From', col: 'author_id', type: 'person', width: 28, required: true },
      { header: 'To', col: 'partner_id', type: 'person', width: 28, required: true },
      { header: 'Message', col: 'body', type: 'text', width: 70, required: true },
      { header: 'About task', col: 'task_id', type: 'int', width: 11 },
      { header: 'Read at', col: 'read_at', type: 'datetime', width: 19 },
      { header: 'Sent', col: 'created_at', type: 'datetime', width: 19 },
    ],
  },
  {
    sheet: 'Alerts',
    table: 'notifications',
    note: 'What the bell shows. Safe to clear; the sweep refills it.',
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 7 },
      { header: 'For', col: 'user_id', type: 'person', width: 28, required: true },
      { header: 'Type', col: 'type', type: 'text', width: 18, required: true },
      { header: 'Severity', col: 'severity', type: 'text', width: 10, default: 'info' },
      { header: 'Title', col: 'title', type: 'text', width: 44, required: true },
      { header: 'Body', col: 'body', type: 'text', width: 60 },
      { header: 'Task ID', col: 'task_id', type: 'int', width: 9 },
      { header: 'Key', col: 'dedupe_key', type: 'text', width: 34, required: true },
      { header: 'Read at', col: 'read_at', type: 'datetime', width: 19 },
      { header: 'Snoozed until', col: 'snoozed_until', type: 'datetime', width: 19 },
      { header: 'Created', col: 'created_at', type: 'datetime', width: 19 },
    ],
  },
  {
    sheet: 'Chat files',
    table: 'chat_attachments',
    note: 'Files sent in a message. The bytes live in the attachments folder.',
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 7 },
      { header: 'Message ID', col: 'message_id', type: 'int', width: 12, required: true },
      { header: 'File name', col: 'filename', type: 'text', width: 40, required: true },
      { header: 'Stored as', col: 'stored_name', type: 'text', width: 40, required: true },
      { header: 'Type', col: 'mime_type', type: 'text', width: 22 },
      { header: 'Bytes', col: 'size_bytes', type: 'int', width: 11, default: 0 },
      { header: 'Sent by', col: 'uploaded_by', type: 'person', width: 28, required: true },
      { header: 'Sent', col: 'created_at', type: 'datetime', width: 19 },
    ],
  },
  {
    sheet: 'Files',
    table: 'attachments',
    note: 'The files themselves live in the attachments folder next to this workbook.',
    columns: [
      { header: 'ID', col: 'id', type: 'int', width: 7 },
      { header: 'Task ID', col: 'task_id', type: 'int', width: 8, required: true },
      { header: 'File name', col: 'filename', type: 'text', width: 40, required: true },
      { header: 'Stored as', col: 'stored_name', type: 'text', width: 40, required: true },
      { header: 'Type', col: 'mime_type', type: 'text', width: 22 },
      { header: 'Bytes', col: 'size_bytes', type: 'int', width: 11, default: 0 },
      { header: 'Uploaded by', col: 'uploaded_by', type: 'person', width: 28, required: true },
      { header: 'Uploaded', col: 'created_at', type: 'datetime', width: 19 },
    ],
  },
];

const HEADER_ROW = 1;

// --- value conversion ------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** A JS date → the string the schema stores, read in UTC so nothing shifts. */
const toSqlDateTime = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const toSqlDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Excel gives dates back as Date objects; people type them as text. Take both. */
function readCell(cell, column, people) {
  let v = cell?.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result; // a formula's value
  if (v && typeof v === 'object' && 'text' in v) v = v.text; // rich text or a hyperlink
  if (v === null || v === undefined || v === '') return null;

  switch (column.type) {
    case 'int':
    case 'num': {
      const n = Number(v);
      return Number.isFinite(n) ? (column.type === 'int' ? Math.round(n) : n) : null;
    }
    case 'bool': {
      if (typeof v === 'boolean') return v ? 1 : 0;
      const s = String(v).trim().toLowerCase();
      return ['true', 'yes', 'y', '1', 'active'].includes(s) ? 1 : 0;
    }
    case 'date':
      if (v instanceof Date) return toSqlDate(v);
      return String(v).trim().slice(0, 10);
    case 'datetime':
      if (v instanceof Date) return toSqlDateTime(v);
      return String(v).trim().replace('T', ' ').slice(0, 19);
    case 'person': {
      const email = String(v).trim().toLowerCase();
      return people.byEmail.get(email) ?? null;
    }
    default:
      return String(v).trim();
  }
}

/** The database value → what goes in the cell. */
function writeCell(value, column, people) {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'bool':
      return Boolean(value);
    case 'date':
      return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    case 'datetime':
      return new Date(`${String(value).replace(' ', 'T')}Z`);
    case 'person':
      return people.byId.get(Number(value)) ?? null;
    default:
      return value;
  }
}

const NUM_FMT = { date: 'dd mmm yyyy', datetime: 'dd mmm yyyy hh:mm' };

// --- the store -------------------------------------------------------------

export class WorkbookStore {
  /**
   * @param {import('better-sqlite3').Database} db  an in-memory database
   * @param {object} options  file paths and timings
   */
  constructor(db, { file, attachmentsDir, credentialsFile, flushMs = 800, pollMs = 2000, log = console }) {
    this.db = db;
    this.file = file;
    this.attachmentsDir = attachmentsDir;
    this.credentialsFile = credentialsFile;
    this.flushMs = flushMs;
    this.pollMs = pollMs;
    this.log = log;

    this.dirty = false;
    this.flushing = false;
    this.timer = null;
    this.poller = null;
    /** The stamp of the file as *we* last left it, to tell our writes from theirs. */
    this.ours = null;
    this.lastSavedAt = null;
    this.lastLoadedAt = null;
    /** Set when Excel (or anything else) is holding the file open for writing. */
    this.blocked = null;
    this.problems = [];
    /** Copies kept when the app's work and somebody's edit collided. */
    this.conflicts = [];
    this.pendingFile = `${file}.pending`;
  }

  // --- reading ------------------------------------------------------------

  /** Everybody, both ways round, so person columns can be translated. */
  people() {
    const rows = this.db.prepare('SELECT id, email FROM users').all();
    return {
      byId: new Map(rows.map((r) => [r.id, r.email])),
      byEmail: new Map(rows.map((r) => [String(r.email).toLowerCase(), r.id])),
    };
  }

  /** Password hashes, kept beside the workbook rather than inside it. */
  readCredentials() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.credentialsFile, 'utf8'));
      return new Map(Object.entries(raw).map(([email, hash]) => [String(email).toLowerCase(), hash]));
    } catch {
      return new Map();
    }
  }

  writeCredentials() {
    const rows = this.db.prepare('SELECT email, password_hash FROM users').all();
    const out = {};
    for (const r of rows) if (r.password_hash) out[String(r.email).toLowerCase()] = r.password_hash;
    fs.mkdirSync(path.dirname(this.credentialsFile), { recursive: true });
    fs.writeFileSync(this.credentialsFile, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  }

  exists() {
    return fs.existsSync(this.file);
  }

  stamp() {
    try {
      const s = fs.statSync(this.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  }

  /**
   * Read the workbook into the database, replacing whatever is there.
   *
   * Rows are adopted rather than validated to death: a task with no ID gets the
   * next one, a missing priority becomes normal, and a row that cannot be
   * placed at all (no owner, no name) is skipped and reported rather than
   * bringing the boot down. The report is visible in the app.
   */
  async load() {
    this.problems = [];
    if (!this.exists()) {
      this.log.warn?.(`[workbook] ${this.file} does not exist yet — starting empty`);
      return { rows: 0 };
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(this.file);

    const credentials = this.readCredentials();
    let total = 0;

    this.db.transaction(() => {
      // Children first, so foreign keys never complain mid-wipe.
      for (const spec of [...SHEETS].reverse()) this.db.prepare(`DELETE FROM ${spec.table}`).run();

      for (const spec of SHEETS) {
        const ws = wb.getWorksheet(spec.sheet);
        if (!ws) {
          this.problems.push(`Sheet "${spec.sheet}" is missing — treated as empty.`);
          continue;
        }

        // Match by header text, so a reordered or extra column is harmless.
        const headerRow = ws.getRow(HEADER_ROW);
        const indexByHeader = new Map();
        headerRow.eachCell((cell, n) => {
          const label = String(cell.value ?? '').trim().toLowerCase();
          if (label) indexByHeader.set(label, n);
        });
        const missing = spec.columns
          .filter((c) => c.required && !indexByHeader.has(c.header.toLowerCase()))
          .map((c) => c.header);
        if (missing.length) {
          this.problems.push(`Sheet "${spec.sheet}" has no ${missing.join(', ')} column.`);
          continue;
        }

        const people = this.people(); // refreshed per sheet: People loads first
        const cols = spec.columns.map((c) => ({ ...c, at: indexByHeader.get(c.header.toLowerCase()) }));
        /**
         * People carry one column that is not in the sheet: their password
         * hash, which lives in `credentials.json` beside the workbook. An empty
         * string means "no password yet" — the state of anybody typed into the
         * People sheet by hand, who can be given work but cannot sign in until
         * a manager sets one.
         */
        const insertCols = [...spec.columns.map((c) => c.col)];
        if (spec.table === 'users') insertCols.push('password_hash');
        const insert = this.db.prepare(
          `INSERT OR REPLACE INTO ${spec.table} (${insertCols.join(', ')})
           VALUES (${insertCols.map((c) => `@${c}`).join(', ')})`
        );
        const maxId = () =>
          this.db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${spec.table}`).get().m;

        /**
         * Read every row first, then insert.
         *
         * Rows that already have an ID go in as they are. Rows typed in by hand
         * have none, and they are numbered *after* the others — otherwise the
         * first blank-ID row would be handed id 1 and quietly overwrite
         * whatever already had it.
         */
        const records = [];
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber <= HEADER_ROW) return;
          const record = {};
          let blank = true;
          for (const c of cols) {
            const value = c.at ? readCell(row.getCell(c.at), c, people) : null;
            record[c.col] = value === null && c.default !== undefined ? c.default : value;
            if (value !== null && c.col !== 'id') blank = false;
          }
          if (blank) return;

          // Columns nobody would think to fill in, filled in from one they did.
          for (const c of spec.columns) {
            if (c.fallback && (record[c.col] === null || record[c.col] === undefined)) {
              record[c.col] = record[c.fallback] ?? null;
            }
          }

          const bad = spec.columns.filter(
            (c) => c.required && (record[c.col] === null || record[c.col] === '')
          );
          if (bad.length) {
            this.problems.push(
              `${spec.sheet} row ${rowNumber}: no ${bad.map((c) => c.header).join(', ')} — skipped.`
            );
            return;
          }

          if (spec.table === 'users') {
            record.email = String(record.email).trim().toLowerCase();
            record.password_hash = credentials.get(record.email) || '';
          }
          if (!record.created_at) record.created_at = nowSql();
          if ('updated_at' in record && !record.updated_at) record.updated_at = record.created_at;

          records.push({ record, rowNumber });
        });

        const put = ({ record, rowNumber }) => {
          try {
            insert.run(record);
            total += 1;
          } catch (err) {
            this.problems.push(`${spec.sheet} row ${rowNumber}: ${err.message}`);
          }
        };

        records.filter((r) => r.record.id).forEach(put);
        let nextId = maxId() + 1;
        for (const r of records.filter((x) => !x.record.id)) {
          r.record.id = nextId++;
          put(r);
        }
      }
    })();

    this.ours = this.stamp();
    this.lastLoadedAt = new Date().toISOString();
    const counts = SHEETS.map(
      (s) => `${this.db.prepare(`SELECT COUNT(*) AS c FROM ${s.table}`).get().c} ${s.sheet.toLowerCase()}`
    ).join(', ');
    this.log.log?.(`[workbook] read ${this.file} — ${counts}`);
    for (const p of this.problems.slice(0, 8)) this.log.warn?.(`[workbook] ${p}`);
    if (this.problems.length > 8) {
      this.log.warn?.(`[workbook] …and ${this.problems.length - 8} more — see Settings in the app`);
    }
    return { rows: total, problems: this.problems };
  }

  // --- writing ------------------------------------------------------------

  /**
   * Write the database back out.
   *
   * Sheets the app does not own are left exactly as they were, so anybody can
   * keep their own pivot or notes tab in the same file. Ours are rebuilt.
   */
  async save() {
    const wb = new ExcelJS.Workbook();
    if (this.exists()) {
      try {
        await wb.xlsx.readFile(this.file);
      } catch (err) {
        this.log.warn?.(`[workbook] could not read the existing file (${err.message}) — writing fresh`);
      }
    }
    wb.creator = 'A1K Task Tracker';
    wb.lastModifiedBy = 'A1K Task Tracker';

    const people = this.people();
    for (const spec of SHEETS) {
      const existing = wb.getWorksheet(spec.sheet);
      if (existing) wb.removeWorksheet(existing.id);
      const ws = wb.addWorksheet(spec.sheet, {
        views: [{ state: 'frozen', ySplit: HEADER_ROW }],
      });
      styleSheet(ws, spec);

      const rows = this.db.prepare(`SELECT * FROM ${spec.table} ORDER BY id`).all();
      for (const r of rows) {
        ws.addRow(spec.columns.map((c) => writeCell(r[c.col], c, people)));
      }
      applyFormats(ws, spec, rows.length);
    }

    buildReadMe(wb);
    buildDashboard(wb, this.db);
    orderSheets(wb);

    // Atomic: write beside the target, then move it into place. A half-written
    // workbook is not a workbook, and this is somebody's only copy.
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    await wb.xlsx.writeFile(tmp);
    try {
      fs.renameSync(tmp, this.file);
      if (fs.existsSync(this.pendingFile)) fs.rmSync(this.pendingFile);
      this.blocked = null;
    } catch (err) {
      // Excel on Windows holds an exclusive lock while the file is open. Keep
      // the write next to it and say so, rather than losing it.
      fs.renameSync(tmp, this.pendingFile);
      this.blocked = {
        since: this.blocked?.since || new Date().toISOString(),
        reason: err.code || err.message,
        pending: this.pendingFile,
      };
      this.log.warn?.(
        `[workbook] cannot replace ${path.basename(this.file)} (${err.code}) — ` +
          `saved to ${path.basename(this.pendingFile)} and will retry`
      );
      this.dirty = true;
      return false;
    }

    this.writeCredentials();
    this.ours = this.stamp();
    this.lastSavedAt = new Date().toISOString();
    return true;
  }

  // --- keeping the two in step -------------------------------------------

  /** Called after anything that changed data. Coalesces a burst into one write. */
  touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((err) => this.log.error?.('[workbook] save failed', err));
    }, this.flushMs);
  }

  async flush() {
    if (this.flushing || !this.dirty) return;
    this.flushing = true;
    this.dirty = false;
    try {
      await this.save();
    } catch (err) {
      this.dirty = true;
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Watch for somebody editing the workbook in Excel.
   *
   * Polling rather than fs.watch: the whole point of this mode is that the file
   * often lives in a OneDrive or SharePoint folder, and change notifications on
   * a synced network folder are not something to bet on.
   *
   * Our own unsaved work wins. If the app has changes it has not written yet,
   * it writes them; otherwise it reloads what the person typed.
   */
  watch() {
    if (this.poller) return;
    this.poller = setInterval(() => {
      const now = this.stamp();
      if (!now || now === this.ours) {
        // Nothing changed on disk. If a previous save was blocked, try again.
        if (this.dirty && !this.flushing) this.flush().catch(() => {});
        return;
      }
      if (this.dirty || this.flushing) {
        // Both sides moved. The app's version wins, because losing somebody's
        // click is worse than losing a spreadsheet edit — but their version is
        // kept beside the file rather than thrown away, so the two can be
        // compared afterwards.
        const keep = this.file.replace(/\.xlsx$/i, '') +
          `.conflict-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.xlsx`;
        try {
          fs.copyFileSync(this.file, keep);
          this.conflicts.push(path.basename(keep));
        } catch (err) {
          this.log.warn?.(`[workbook] could not keep a copy of the edited file: ${err.message}`);
        }
        this.log.warn?.(
          '[workbook] the file changed while the app had unsaved work — the app wins, ' +
            `their version kept as ${path.basename(keep)}`
        );
        this.flush().catch(() => {});
        return;
      }
      this.log.log?.('[workbook] the file changed on disk — reloading');
      this.load().catch((err) => this.log.error?.('[workbook] reload failed', err));
    }, this.pollMs);
    this.poller.unref?.();
  }

  stop() {
    if (this.poller) clearInterval(this.poller);
    if (this.timer) clearTimeout(this.timer);
    this.poller = null;
    this.timer = null;
  }

  /** What the app shows on its Settings screen. */
  status() {
    return {
      mode: 'workbook',
      file: this.file,
      exists: this.exists(),
      lastSavedAt: this.lastSavedAt,
      lastLoadedAt: this.lastLoadedAt,
      unsaved: this.dirty || this.flushing,
      blocked: this.blocked,
      problems: this.problems,
      conflicts: this.conflicts,
      attachmentsDir: this.attachmentsDir,
    };
  }
}

// --- presentation ----------------------------------------------------------

function styleSheet(ws, spec) {
  ws.columns = spec.columns.map((c) => ({ header: c.header, width: c.width || 18 }));
  const header = ws.getRow(HEADER_ROW);
  header.font = { bold: true, size: 10, color: { argb: 'FF1B1B1B' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEEF0' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFC3C8' } } };
  });
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: spec.columns.length },
  };
}

/** Number formats, wrapped text and the dropdowns, applied down each column. */
function applyFormats(ws, spec, rowCount) {
  // Leave room to type: the dropdowns cover the rows that exist plus a few
  // hundred more, so pasting a batch in still gets validated.
  const last = rowCount + HEADER_ROW + 400;
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type];
    if (c.type === 'text' && (c.width || 0) >= 40) col.alignment = { wrapText: true, vertical: 'top' };
    if (c.list) {
      const letter = ws.getColumn(i + 1).letter;
      ws.dataValidations.add(`${letter}${HEADER_ROW + 1}:${letter}${last}`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${c.list.join(',')}"`],
        showErrorMessage: true,
        errorTitle: c.header,
        error: `Use one of: ${c.list.join(', ')}`,
      });
    }
  });
}

const README_LINES = [
  ['A1K Task Tracker · Excel Edition — this workbook is the database.', 'title'],
  ['', ''],
  ['The app reads these sheets when it starts and writes them back after every change.', ''],
  ['You can type into them. You can also break them. Both of those are true on purpose.', ''],
  ['', ''],
  ['SAFE TO DO BY HAND', 'head'],
  ['Add a person on the People sheet — name, email, role, team. The manager sets their', ''],
  ['password in the app afterwards; passwords are never stored in this file.', ''],
  ['Add tasks on the Tasks sheet — task name, client, owner email and completion date are', ''],
  ['enough. Leave Task ID blank and the app will number it.', ''],
  ['Fix a typo in a name, a client or a note. Sort and filter as much as you like.', ''],
  ['Add your own extra sheet. The app leaves sheets it does not own alone.', ''],
  ['', ''],
  ['BEST LEFT TO THE APP', 'head'],
  ['Status, and the four "at / by / note" groups. Those are the approval chain, and the', ''],
  ['app is what keeps them honest — it will not let somebody approve their own work.', ''],
  ['Typing "approved" into a cell bypasses every one of those checks.', ''],
  ['The Task history sheet. It is the record of what happened; editing it rewrites the past.', ''],
  ['', ''],
  ['HOUSE RULES', 'head'],
  ['One app instance owns this file. Two servers pointed at the same workbook will', ''],
  ['overwrite each other.', ''],
  ['If you have the file open in Excel when the app saves, the app writes alongside it', ''],
  ['as "...xlsx.pending" and retries until you close it. Nothing is lost.', ''],
  ['Attachments are files on disk, in the attachments folder beside this workbook.', ''],
  ['Keep a backup. It is one file — that is the appeal and the risk.', ''],
];

function buildReadMe(wb) {
  const existing = wb.getWorksheet('Read me');
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet('Read me', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 104;
  README_LINES.forEach(([text, kind], i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    if (kind === 'title') row.getCell(1).font = { bold: true, size: 14 };
    else if (kind === 'head') row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF2A78D6' } };
    else row.getCell(1).font = { size: 10.5, color: { argb: 'FF3A3A3A' } };
    row.height = kind === 'title' ? 26 : 15;
  });
}

/**
 * A live summary, written as formulas rather than values — so the numbers are
 * still right when somebody opens the workbook a week later with the app off.
 */
function buildDashboard(wb, db) {
  const existing = wb.getWorksheet('Dashboard');
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 46;

  const title = ws.getRow(1);
  title.getCell(1).value = 'Where the work is';
  title.getCell(1).font = { bold: true, size: 14 };
  title.height = 26;
  ws.getRow(2).getCell(1).value = 'Counted from the Tasks sheet, so these stay true with the app closed.';
  ws.getRow(2).getCell(1).font = { size: 10, color: { argb: 'FF7A7A7A' } };

  const statusRows = [
    ['To do', 'open'],
    ['Marked done — waiting to be checked', 'submitted'],
    ['Checked — waiting for approval', 'verified'],
    ['Approved', 'approved'],
    ['Cancelled', 'cancelled'],
  ];
  let r = 4;
  ws.getRow(r).getCell(1).value = 'By status';
  ws.getRow(r).getCell(1).font = { bold: true, size: 11 };
  r += 1;
  for (const [label, status] of statusRows) {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 2).value = { formula: `COUNTIF(Tasks!G:G,"${status}")` };
    ws.getCell(r, 2).alignment = { horizontal: 'right' };
    r += 1;
  }
  ws.getCell(r, 1).value = 'Past its completion date and not approved';
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = {
    formula: 'COUNTIFS(Tasks!E:E,"<"&TODAY(),Tasks!G:G,"<>approved",Tasks!G:G,"<>cancelled",Tasks!E:E,">0")',
  };
  ws.getCell(r, 2).alignment = { horizontal: 'right' };
  r += 2;

  ws.getCell(r, 1).value = 'By person';
  ws.getCell(r, 1).font = { bold: true, size: 11 };
  ws.getCell(r, 2).value = 'Live';
  ws.getCell(r, 3).value = 'Late';
  ws.getRow(r).getCell(2).font = { bold: true, size: 10 };
  ws.getRow(r).getCell(3).font = { bold: true, size: 10 };
  r += 1;
  for (const p of db.prepare('SELECT name, email FROM users WHERE is_active = 1 ORDER BY name').all()) {
    ws.getCell(r, 1).value = p.name;
    ws.getCell(r, 2).value = {
      formula: `COUNTIFS(Tasks!D:D,"${p.email}",Tasks!G:G,"<>approved",Tasks!G:G,"<>cancelled")`,
    };
    ws.getCell(r, 3).value = {
      formula: `COUNTIFS(Tasks!D:D,"${p.email}",Tasks!E:E,"<"&TODAY(),Tasks!G:G,"<>approved",Tasks!G:G,"<>cancelled",Tasks!E:E,">0")`,
    };
    ws.getCell(r, 2).alignment = { horizontal: 'right' };
    ws.getCell(r, 3).alignment = { horizontal: 'left' };
    r += 1;
  }
}

/** Read me first, then the sheets people actually use, then the machinery. */
function orderSheets(wb) {
  const order = [
    'Read me', 'Dashboard', 'Tasks', 'People', 'Task history',
    'Messages', 'Chat files', 'Alerts', 'Files',
  ];
  wb.worksheets
    .slice()
    .sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .forEach((ws, i) => {
      ws.orderNo = i;
    });
}
