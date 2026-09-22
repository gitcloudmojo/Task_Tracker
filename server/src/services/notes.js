/**
 * The notes log — a task's running record of daily updates and comments.
 *
 * See schema.sql's comment on `task_notes` for why this is a log rather than
 * the single overwritable field it used to be. This module is the small
 * amount of logic around that table; the routes that call it live in
 * routes/tasks.js, right next to the rest of a task's detail payload.
 */
import { db, nowSql, today } from '../db/index.js';

const MAX_BODY = 4000;

/** Every entry for a task, oldest first — same order as the history feed. */
export async function notesFor(taskId) {
  const rows = await db
    .prepare(
      `SELECT n.*, u.name AS author_name
         FROM task_notes n JOIN users u ON u.id = n.author_id
        WHERE n.task_id = ?
        ORDER BY n.entry_date, n.created_at`
    )
    .all(taskId);
  return rows.map((n) => ({
    id: n.id,
    body: n.body,
    entryDate: n.entry_date,
    authorId: n.author_id,
    authorName: n.author_name,
    createdAt: n.created_at,
  }));
}

/**
 * Add one entry. `entryDate` is the date the update is *about* — left to
 * default to today, but the caller may pick an earlier one from a calendar
 * (catching up on yesterday's progress, say). `created_at` is never taken
 * from the caller: it is always the moment this function actually ran, so
 * the one fact nobody can backdate is when the entry was really typed in.
 */
export async function addNote({ taskId, authorId, body, entryDate }) {
  const text = String(body || '').trim();
  if (!text) return { error: 'Write something before adding it to the log' };
  if (text.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters` };

  let date = today();
  if (entryDate !== undefined && entryDate !== null && entryDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return { error: 'That date does not look right' };
    date = entryDate;
  }

  const stamp = nowSql();
  const info = await db
    .prepare(
      `INSERT INTO task_notes (task_id, author_id, body, entry_date, created_at)
       VALUES (?,?,?,?,?)`
    )
    .run(taskId, authorId, text, date, stamp);
  return { id: info.lastInsertRowid };
}
