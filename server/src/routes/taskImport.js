/**
 * Bulk task import — an Excel sheet in, a batch of tasks out.
 *
 * Two routes:
 *   GET  /api/task-import/template  — anybody signed in can download the
 *        blank sheet. A team member with no "assign tasks" rights of their
 *        own still needs this: the point is they fill it in and hand it to
 *        their manager, who imports the compiled sheet — an offline path
 *        that never touches this software until the very last step.
 *   POST /api/task-import           — gated the same as creating a single
 *        task (`tasks.create`), since this *is* creating tasks, just many at
 *        once.
 *
 * Only main tasks come through here. A task's breakdown (its steps) is
 * deliberately left out of the sheet — that gets added afterward by whoever
 * ends up owning the task, the same way it already works for a task created
 * one at a time. Keeping the sheet to "who, what, for whom, by when" is what
 * keeps it fillable by hand.
 *
 * A row that fails validation does not stop the batch — it is held, with a
 * plain-English reason, and reported back alongside whatever did go through.
 * Nothing here is "somebody else's" work: an import batch of 50 tasks that
 * fails on row 12 because of one bad email is 49 wasted tasks if the whole
 * thing gets rejected instead.
 */
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db, nowSql, today } from '../db/index.js';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { wrap } from '../lib/validate.js';
import { record } from '../services/workflow.js';
import { notifyTask } from '../services/alerts.js';
import { can } from '../access.js';
import { PRIORITIES } from './tasks.js';

const router = Router();
router.use(requireAuth);

const SHEET_NAME = 'Tasks';
const COLUMNS = ['Task name', 'Client', 'Assign to (email)', 'Due date (YYYY-MM-DD)', 'Priority (High/Normal)', 'Notes'];
const COL = { NAME: 1, CLIENT: 2, EMAIL: 3, DUE: 4, PRIORITY: 5, NOTES: 6 };

// A serverless function here has 30s (see vercel.json) and the database is a
// continent away from where the function runs (see the Mumbai/US note in
// project history) — every row is a network round trip, so the batch is
// capped well short of that ceiling rather than timing out midway with some
// tasks created and no clean report of which.
const MAX_ROWS = 300;
const INSERT_CONCURRENCY = 20;

// --- the template ------------------------------------------------------------

router.get(
  '/template',
  wrap(async (req, res) => {
    const people = await db
      .prepare('SELECT name, email, role, team FROM users WHERE is_active = 1 ORDER BY name')
      .all();
    const roleLabel = { superadmin: 'Super Admin', ceo: 'CEO', admin: 'Manager', user: 'Team member' };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'A1K Task Tracker';
    wb.created = new Date();

    const tasks = wb.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
    tasks.columns = COLUMNS.map((header) => ({ header, key: header, width: 26 }));
    tasks.getRow(1).font = { bold: true };
    tasks.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } };
    tasks.columns[3].width = 22;
    tasks.columns[5].width = 34;

    // One illustrative row, not real data — italic so it reads as an example,
    // and even if somebody forgets to delete it, "e.g. …" is not a real email
    // so it will come back held rather than quietly creating a bogus task.
    const example = tasks.addRow([
      'e.g. Renew the SSL certificate',
      'e.g. Acme Corp',
      'e.g. jane@yourcompany.com',
      'e.g. 2026-12-01',
      'Normal',
      'e.g. Any context the owner needs',
    ]);
    example.font = { italic: true, color: { argb: 'FF898781' } };

    // Dropdowns for the two columns worth constraining — priority has exactly
    // two valid values, and an owner has to be somebody active.
    const priorityList = PRIORITIES.map((p) => p[0].toUpperCase() + p.slice(1));
    for (let r = 2; r <= 200; r++) {
      tasks.getCell(r, COL.PRIORITY).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${priorityList.join(',')}"`],
      };
    }

    if (people.length) {
      const ref = wb.addWorksheet('People', { state: 'visible' });
      ref.columns = [
        { header: 'Name', key: 'name', width: 26 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Role', key: 'role', width: 16 },
        { header: 'Team', key: 'team', width: 16 },
      ];
      ref.getRow(1).font = { bold: true };
      for (const p of people) {
        ref.addRow([p.name, p.email, roleLabel[p.role] || p.role, p.team || '']);
      }
      ref.getColumn('email').alignment = { wrapText: false };
    }

    const info = wb.addWorksheet('Instructions');
    info.columns = [{ width: 100 }];
    const lines = [
      'How to use this sheet',
      '',
      `1. Fill in the "${SHEET_NAME}" sheet — one row per task. Delete the example row first.`,
      '2. "Assign to (email)" must match an active person’s email exactly — see the "People" sheet for the current list.',
      '3. "Due date" must be in YYYY-MM-DD form and cannot be in the past.',
      '4. "Priority" is optional — leave it blank for Normal, or pick High.',
      '5. Only the task itself goes in this sheet. Once it is imported, its breakdown (steps/follow-ups) is added by whoever now owns it, from that task’s own page.',
      '',
      'If you can only assign tasks to yourself: leave "Assign to" blank, or use your own email — every row imports as yours. A row naming somebody else is held, not reassigned.',
      '',
      'If you are filling this in for yourself rather than importing it: save the file and hand it to your manager. They import the compiled sheet — this file never has to touch the software for that to work.',
      '',
      'After import, anything that could not be created is reported back with the reason — fix it in the sheet and import just those rows again if you like.',
    ];
    lines.forEach((line, i) => {
      const row = info.addRow([line]);
      if (i === 0) row.font = { bold: true, size: 13 };
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="task-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  })
);

// --- reading a workbook back out ---------------------------------------------

/** Cell text, allowing for the handful of shapes ExcelJS hands back besides
 * a plain string — rich text, a formula's cached result, a date. */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

function parseDueDate(rawValue) {
  if (rawValue instanceof Date) {
    // A date-typed cell arrives in local time at midnight; reading it back
    // through toISOString can roll it to the previous day west of UTC, so
    // the calendar date is built from its own fields instead.
    const y = rawValue.getFullYear();
    const m = String(rawValue.getMonth() + 1).padStart(2, '0');
    const d = String(rawValue.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = cellText(rawValue).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
});

router.post(
  '/',
  // Same split as single-task creation: `tasks.create` may import for anyone,
  // `tasks.create_own` (a team member) may only ever import rows for
  // themselves — enforced per-row below, not by refusing the route.
  requireAnyPermission('tasks.create', 'tasks.create_own'),
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over 3 MB' });
      return res.status(400).json({ error: err.message });
    }),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Attach the filled-in template to import it' });

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(req.file.buffer);
    } catch {
      return res.status(400).json({ error: "That doesn't look like an Excel file (.xlsx)" });
    }

    const ws =
      wb.worksheets.find((s) => s.name.trim().toLowerCase() === SHEET_NAME.toLowerCase()) ||
      wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ error: `No "${SHEET_NAME}" sheet found in that file` });
    }

    // Active users, loaded once — every row's owner lookup is then free (no
    // per-row query), which is what makes checking every row before writing
    // anything cheap enough to always do.
    const activeUsers = await db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();
    const byEmail = new Map(activeUsers.map((u) => [u.email.toLowerCase(), u]));

    // A team member holds `tasks.create_own`, not `tasks.create` — the same
    // split as the single-task route. They may still import a batch, but
    // every row in it has to end up owned by them; the "Assign to" column is
    // read only to *check* that, never to hand a row to somebody else.
    const selfOnly = !can(req.user, 'tasks.create');

    const rawRows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header
      rawRows.push({ rowNumber, row });
    });

    if (rawRows.length > MAX_ROWS) {
      return res.status(413).json({
        error: `That's ${rawRows.length} rows — import at most ${MAX_ROWS} at a time and do the rest in a second batch.`,
      });
    }

    const held = [];
    const toCreate = [];

    for (const { rowNumber, row } of rawRows) {
      const name = cellText(row.getCell(COL.NAME).value).trim();
      const clientName = cellText(row.getCell(COL.CLIENT).value).trim();
      const email = cellText(row.getCell(COL.EMAIL).value).trim();
      const dueRaw = row.getCell(COL.DUE).value;
      const priorityRaw = cellText(row.getCell(COL.PRIORITY).value).trim();
      const notes = cellText(row.getCell(COL.NOTES).value).trim();

      // A fully blank row (trailing rows left over from the template) is
      // simply skipped — it is not a task somebody meant to create, so it is
      // not a validation failure either.
      if (!name && !clientName && !email && !dueRaw) continue;

      const label = name || `Row ${rowNumber}`;
      const failHere = (reason) => held.push({ row: rowNumber, name: label, reason });

      if (name.length < 3) {
        failHere('Task name needs at least 3 characters');
        continue;
      }
      if (!clientName) {
        failHere('Client is required');
        continue;
      }

      let owner;
      if (selfOnly) {
        // Blank or their own email both mean "me" — a name that resolves to
        // somebody else is the one thing this importer is not allowed to do,
        // so that row is held rather than quietly reassigned or dropped.
        if (email && email.toLowerCase() !== req.user.email.toLowerCase()) {
          failHere('You can only import tasks for yourself — this row names someone else');
          continue;
        }
        owner = { id: req.user.id, name: req.user.name };
      } else {
        if (!email) {
          failHere('"Assign to" email is required');
          continue;
        }
        owner = byEmail.get(email.toLowerCase());
        if (!owner) {
          failHere(`No active person with the email "${email}"`);
          continue;
        }
      }

      const completionDate = parseDueDate(dueRaw);
      if (!completionDate) {
        failHere('Due date must be in YYYY-MM-DD form');
        continue;
      }
      if (completionDate < today()) {
        failHere('Due date is in the past');
        continue;
      }
      let priority = 'normal';
      if (priorityRaw) {
        const norm = priorityRaw.toLowerCase();
        if (!PRIORITIES.includes(norm)) {
          failHere('Priority must be High or Normal (leave blank for Normal)');
          continue;
        }
        priority = norm;
      }

      toCreate.push({ rowNumber, name, clientName, owner, completionDate, priority, notes: notes || null });
    }

    // Independent inserts — a chunk at a time rather than one at a time, since
    // each row is its own task with nothing to serialise against the others.
    const created = [];
    for (let i = 0; i < toCreate.length; i += INSERT_CONCURRENCY) {
      const chunk = toCreate.slice(i, i + INSERT_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (t) => {
          try {
            const stamp = nowSql();
            const info = await db
              .prepare(
                `INSERT INTO tasks
                   (name, client_name, owner_id, completion_date, priority, notes,
                    created_by, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?)`
              )
              .run(t.name, t.clientName, t.owner.id, t.completionDate, t.priority, t.notes, req.user.id, stamp, stamp);
            const id = info.lastInsertRowid;
            await record({
              taskId: id,
              actorId: req.user.id,
              action: 'created',
              to: 'open',
              note: `Assigned to ${t.owner.name}, due ${t.completionDate} (bulk import)`,
            });
            if (t.owner.id !== req.user.id) {
              await notifyTask({
                userId: t.owner.id,
                type: 'task_assigned',
                severity: t.priority === 'high' ? 'warning' : 'info',
                title: `New task: ${t.name}`,
                body: `${req.user.name} assigned this to you for ${t.clientName}. Due ${t.completionDate}.`,
                taskId: id,
                dedupeKey: `assigned:${id}:${t.owner.id}`,
              });
            }
            return { row: t.rowNumber, id, name: t.name, ownerName: t.owner.name, completionDate: t.completionDate };
          } catch (err) {
            held.push({ row: t.rowNumber, name: t.name, reason: 'Could not be saved — try importing this row again' });
            return null;
          }
        })
      );
      created.push(...results.filter(Boolean));
    }

    held.sort((a, b) => a.row - b.row);
    res.json({
      totalRows: rawRows.length,
      createdCount: created.length,
      heldCount: held.length,
      created,
      held,
    });
  })
);

export default router;
