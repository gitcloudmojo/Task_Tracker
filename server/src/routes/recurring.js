/**
 * Repeating tasks — the schedules. See services/recurring.js for how a
 * schedule turns into ordinary tasks; this file is only the screen's API:
 * list, create, change, pause/resume, remove.
 *
 * Who may do what mirrors one-off tasks exactly, so there is nothing new to
 * learn:
 *   - a Manager or Super Admin (`tasks.create`) sets one up for anyone, and
 *     may change or stop any of them;
 *   - a team member (`tasks.create_own`) sets one up for themselves only,
 *     and may only change or stop the ones they made for themselves;
 *   - the CEO (`tasks.view_all`) sees them all and changes none.
 */
import { Router } from 'express';
import { db, nowSql, today, withTransaction } from '../db/index.js';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { wrap, requireFields, oneOf, isoDate, bad } from '../lib/validate.js';
import { can } from '../access.js';
import {
  addDays,
  parseWeekdays,
  describeSchedule,
  nextOccurrence,
  generateRecurring,
} from '../services/recurring.js';

const router = Router();
router.use(requireAuth);

const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const PRIORITIES = ['high', 'normal'];

const SELECT = `
  SELECT r.*,
         o.name AS owner_name,
         c.name AS creator_name,
         l.name AS label_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.recurring_id = r.id) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.recurring_id = r.id
             AND t.status IN ('open','submitted','verified')) AS open_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.recurring_id = r.id
             AND t.status = 'open' AND t.completion_date < ?) AS late_count
    FROM recurring_tasks r
    JOIN users o ON o.id = r.owner_id
    JOIN users c ON c.id = r.created_by
    LEFT JOIN labels l ON l.id = r.label_id`;

/** May this person change or stop this schedule? */
function canManage(user, r) {
  if (can(user, 'tasks.create')) return true;
  return can(user, 'tasks.create_own') && r.owner_id === user.id && r.created_by === user.id;
}

function shape(r, user) {
  const stamp = today();
  return {
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    priority: r.priority,
    notes: r.notes,
    labelId: r.label_id,
    labelName: r.label_name,
    frequency: r.frequency,
    weekdays: parseWeekdays(r.weekdays),
    monthDay: r.month_day,
    dueAfterDays: r.due_after_days,
    startDate: r.start_date,
    endDate: r.end_date,
    active: Boolean(r.active),
    scheduleText: describeSchedule(r),
    // The next one still to come — "after today", since a schedule that falls
    // on today has already made today's task by the time anybody looks.
    nextDate: r.active ? nextOccurrence(r, stamp < r.start_date ? addDays(r.start_date, -1) : stamp) : null,
    createdByName: r.creator_name,
    taskCount: r.task_count,
    openCount: r.open_count,
    lateCount: r.late_count,
    canEdit: canManage(user, r),
  };
}

const load = (id) => db.prepare(`${SELECT} WHERE r.id = ?`).get(today(), id);

/** Validate the schedule part of a body, returning the columns it sets. */
function parseSchedule(body, existing) {
  const frequency = body.frequency ?? existing?.frequency;
  oneOf(frequency, FREQUENCIES, 'frequency');
  if (!frequency) bad('"frequency" is required');

  let weekdays = null;
  let monthDay = null;

  if (frequency === 'monthly') {
    const raw = body.monthDay ?? existing?.month_day;
    if (raw === 'last') monthDay = 'last';
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 31) bad('Pick a day of the month from 1 to 31, or the last day');
      monthDay = String(n);
    }
  } else {
    const raw =
      body.weekdays !== undefined
        ? Array.isArray(body.weekdays)
          ? body.weekdays.join(',')
          : String(body.weekdays)
        : existing?.weekdays;
    const days = parseWeekdays(raw);
    if (frequency === 'weekly' && days.length === 0) bad('Pick at least one day of the week');
    // Daily with nothing picked means every day.
    weekdays = days.length ? days.join(',') : null;
  }

  const dueAfter = body.dueAfterDays ?? existing?.due_after_days ?? 0;
  const dueAfterDays = Number(dueAfter);
  if (!Number.isInteger(dueAfterDays) || dueAfterDays < 0 || dueAfterDays > 365) {
    bad('The deadline must be between 0 and 365 days after each task appears');
  }

  return { frequency, weekdays, month_day: monthDay, due_after_days: dueAfterDays };
}

// --- list ------------------------------------------------------------------

router.get(
  '/',
  wrap(async (req, res) => {
    const seeAll = can(req.user, 'tasks.view_all');
    const rows = await db
      .prepare(
        `${SELECT} ${seeAll ? '' : 'WHERE (r.owner_id = ? OR r.created_by = ?)'}
          ORDER BY r.active DESC, r.name COLLATE NOCASE`
      )
      .all(...(seeAll ? [today()] : [today(), req.user.id, req.user.id]));
    res.json({
      schedules: rows.map((r) => shape(r, req.user)),
      canCreate: can(req.user, 'tasks.create') || can(req.user, 'tasks.create_own'),
      assignOthers: can(req.user, 'tasks.create'),
    });
  })
);

// --- create ----------------------------------------------------------------

router.post(
  '/',
  requireAnyPermission('tasks.create', 'tasks.create_own'),
  wrap(async (req, res) => {
    requireFields(req.body, ['name', 'clientName', 'ownerId', 'frequency']);
    oneOf(req.body.priority, PRIORITIES, 'priority');

    const name = String(req.body.name).trim();
    if (name.length < 3) bad('Give the task a name somebody will recognise later');

    const owner = await db
      .prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1')
      .get(req.body.ownerId);
    if (!owner) return res.status(400).json({ error: 'Pick an active person to own this' });
    if (!can(req.user, 'tasks.create') && owner.id !== req.user.id) {
      return res.status(403).json({ error: 'You can only set up a repeating task for yourself.' });
    }

    const schedule = parseSchedule(req.body, null);

    const startDate = isoDate(req.body.startDate, 'startDate') || today();
    if (startDate < today()) bad('A repeating task cannot start in the past');
    const endDate = isoDate(req.body.endDate, 'endDate');
    if (endDate && endDate < startDate) bad('The end date cannot be before the start date');

    let labelId = null;
    if (req.body.labelId !== undefined && req.body.labelId !== null && can(req.user, 'labels.manage')) {
      const label = await db.prepare('SELECT id FROM labels WHERE id = ?').get(req.body.labelId);
      if (!label) return res.status(400).json({ error: 'Pick a label that exists' });
      labelId = label.id;
    }

    const stamp = nowSql();
    const info = await db
      .prepare(
        `INSERT INTO recurring_tasks
           (name, client_name, owner_id, priority, notes, label_id,
            frequency, weekdays, month_day, due_after_days,
            start_date, end_date, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        name,
        String(req.body.clientName).trim(),
        owner.id,
        req.body.priority || 'normal',
        req.body.notes ? String(req.body.notes).trim() : null,
        labelId,
        schedule.frequency,
        schedule.weekdays,
        schedule.month_day,
        schedule.due_after_days,
        startDate,
        endDate,
        req.user.id,
        stamp,
        stamp
      );

    // A schedule that starts today should show its first task now, not
    // tomorrow morning.
    const made = await generateRecurring({ ruleId: info.lastInsertRowid });

    res.status(201).json({
      schedule: shape(await load(info.lastInsertRowid), req.user),
      created: made.created,
    });
  })
);

// --- change / pause / resume ------------------------------------------------

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const existing = await load(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such repeating task' });
    if (!canManage(req.user, existing)) {
      return res.status(403).json({ error: 'You cannot change this repeating task.' });
    }

    const b = req.body;
    const sets = [];
    const params = [];
    const set = (col, val) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length < 3) bad('Give the task a name somebody will recognise later');
      set('name', name);
    }
    if (b.clientName !== undefined) {
      const c = String(b.clientName).trim();
      if (!c) bad('"clientName" is required');
      set('client_name', c);
    }
    if (b.priority !== undefined) {
      oneOf(b.priority, PRIORITIES, 'priority');
      set('priority', b.priority);
    }
    if (b.notes !== undefined) set('notes', b.notes ? String(b.notes).trim() : null);

    if (b.ownerId !== undefined && Number(b.ownerId) !== existing.owner_id) {
      const owner = await db
        .prepare('SELECT id FROM users WHERE id = ? AND is_active = 1')
        .get(b.ownerId);
      if (!owner) return res.status(400).json({ error: 'Pick an active person to own this' });
      if (!can(req.user, 'tasks.create') && owner.id !== req.user.id) {
        return res.status(403).json({ error: 'You can only keep a repeating task for yourself.' });
      }
      set('owner_id', owner.id);
    }

    if (b.labelId !== undefined) {
      if (!can(req.user, 'labels.manage')) {
        return res.status(403).json({ error: 'Only a manager can set a label.' });
      }
      if (b.labelId === null) set('label_id', null);
      else {
        const label = await db.prepare('SELECT id FROM labels WHERE id = ?').get(b.labelId);
        if (!label) return res.status(400).json({ error: 'Pick a label that exists' });
        set('label_id', label.id);
      }
    }

    const scheduleTouched = ['frequency', 'weekdays', 'monthDay', 'dueAfterDays'].some(
      (k) => b[k] !== undefined
    );
    if (scheduleTouched) {
      const s = parseSchedule(b, existing);
      set('frequency', s.frequency);
      set('weekdays', s.weekdays);
      set('month_day', s.month_day);
      set('due_after_days', s.due_after_days);
    }

    if (b.endDate !== undefined) {
      const endDate = isoDate(b.endDate, 'endDate');
      if (endDate && endDate < existing.start_date) bad('The end date cannot be before the start date');
      set('end_date', endDate);
    }

    // Where generation picks up from. Editing the schedule only ever changes
    // what happens from today on, so anything already made stays exactly as
    // it is — but "today" itself is reopened, because a schedule edited to
    // fall on today should make today's task. Resuming skips the whole
    // paused stretch rather than back-filling it with late tasks.
    const yesterday = addDays(today(), -1);
    const resuming = b.active !== undefined && Boolean(b.active) && !existing.active;
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    if (resuming) {
      if (existing.start_date <= today()) set('generated_through', yesterday);
    } else if (scheduleTouched && existing.generated_through && existing.generated_through > yesterday) {
      set('generated_through', yesterday);
    }

    if (!sets.length) return res.json({ schedule: shape(existing, req.user) });
    set('updated_at', nowSql());
    await db.prepare(`UPDATE recurring_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, existing.id);

    await generateRecurring({ ruleId: existing.id });
    res.json({ schedule: shape(await load(existing.id), req.user) });
  })
);

// --- remove ------------------------------------------------------------------

// Removes the schedule only. Every task it already made stays, as an ordinary
// one-off — history and all — because those are real work that was assigned
// to real people.
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const existing = await load(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such repeating task' });
    if (!canManage(req.user, existing)) {
      return res.status(403).json({ error: 'You cannot remove this repeating task.' });
    }
    await withTransaction(async (tx) => {
      await tx
        .prepare('UPDATE tasks SET recurring_id = NULL, occurrence_date = NULL WHERE recurring_id = ?')
        .run(existing.id);
      await tx.prepare('DELETE FROM recurring_tasks WHERE id = ?').run(existing.id);
    });
    res.json({ ok: true, keptTasks: existing.task_count });
  })
);

export default router;
