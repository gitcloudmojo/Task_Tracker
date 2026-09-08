/**
 * The breakdown — a task's steps, and the rules about them.
 *
 * A step is a lighter thing than a task on purpose. It has no approval chain:
 * it is done when the person doing it says so. The eyes are still on the parent
 * task, which is the thing the client actually receives, and putting the chain
 * on every fragment would fill the review queues with "call the client back".
 *
 * Two kinds, and the difference is not cosmetic:
 *
 *   step       a piece of the work. Past its date, it is LATE.
 *   follow_up  a check-back. Past its date, it is WAITING ON YOU — which is a
 *              different sentence, a different colour and a different alert.
 *              "Chase the client on the 12th" is not a missed deadline on the
 *              13th.
 *
 * One consequence worth stating, because it drove several decisions below: a
 * follow-up can legitimately outlive its task. "Deliver the report by the 1st;
 * follow up with the client on the 15th" is approved on the 2nd and still has
 * something to do on the 15th. So approval does NOT freeze the breakdown the
 * way it freezes the evidence — otherwise that follow-up could never be ticked
 * and its alert would nag forever.
 *
 * TWO HARD RULES
 *
 * Both were softer once — a warning and an allowed override — and both were
 * tightened after seeing it used:
 *
 *   1. A task cannot be marked done while a step is still open.
 *   2. A step's deadline cannot fall after the task's completion date.
 *
 * Both apply to STEPS ONLY. A follow-up is exempt from both, and has to be:
 * a check-back is by definition not part of finishing the work, and its whole
 * purpose is often to sit *after* delivery. Applying either rule to follow-ups
 * would make them unusable, which is why the two kinds exist at all.
 *
 * Vercel/Turso edition: same rules as the on-prem edition. What changed —
 * every function that touches the database is `async` now and every query is
 * `await`ed, the same conversion `routes/tasks.js` already carries.
 */
import { db, nowSql, today } from '../db/index.js';
import { daysToDue } from './workflow.js';

export const KINDS = ['step', 'follow_up'];

export const KIND_LABEL = {
  step: 'Step',
  follow_up: 'Follow-up',
};

export const KIND_NOTE = {
  step: 'A piece of the work. Late once its date has passed.',
  follow_up: 'A check-back — not late when the date arrives, just your turn.',
};

/**
 * Where a step stands, in one word.
 *
 * `late` and `waiting` are the same arithmetic and deliberately different
 * words: one is a broken promise, the other is a reminder coming due.
 */
export function stepState(s, lead = 2) {
  if (s.done_at) return { state: 'done', days: null };
  const days = s.due_date ? daysToDue(s.due_date) : null;
  if (days === null) return { state: 'open', days: null };
  if (s.kind === 'follow_up') {
    return { state: days <= 0 ? 'waiting' : days <= lead ? 'soon' : 'open', days };
  }
  return { state: days < 0 ? 'late' : days <= lead ? 'soon' : 'open', days };
}

/**
 * Who may do what to a step.
 *
 * Ticking is the step's owner or the manager, and nobody else — not even the
 * person who owns the parent task. A tick is somebody saying "I did this", and
 * once anyone accountable for the whole can tick anybody's part, the ticks stop
 * meaning anything. The manager is the exception because somebody has to be
 * able to tidy up after a person on leave.
 *
 * Changing a step — its name, date, kind or owner — belongs to whoever planned
 * the work: the task's owner or the manager. A person moving their own deadline
 * would rather defeat the purpose of having one.
 */
export function stepActions(s, task, user, can) {
  const isManager = can(user, 'tasks.edit');
  const planner = isManager || task.owner_id === user.id;
  // Cancelled is the one state where nothing more happens. Approved is not:
  // see the note at the top of this file about follow-ups outliving the task.
  const open = task.status !== 'cancelled';

  return {
    canTick: open && !s.done_at && (s.owner_id === user.id || isManager),
    canUntick: open && Boolean(s.done_at) && (s.owner_id === user.id || isManager),
    canEditStep: open && planner,
    canRemoveStep: open && planner,
  };
}

/** Whether this person may add steps to this task at all. */
export const canAddSteps = (task, user, can) =>
  task.status !== 'cancelled' && (can(user, 'tasks.edit') || task.owner_id === user.id);

const SELECT = `
  SELECT s.*, o.name AS owner_name, o.reminder_days_before AS owner_lead,
         d.name AS done_by_name, c.name AS creator_name
    FROM task_steps s
    JOIN users o      ON o.id = s.owner_id
    LEFT JOIN users d ON d.id = s.done_by
    LEFT JOIN users c ON c.id = s.created_by`;

/**
 * Was it finished by the day it was promised?
 *
 * Compared on dates, not timestamps: a step ticked off at 11pm on its own due
 * date was done on time, and saying otherwise over a few hours would be both
 * pedantic and wrong. Null when there was no date to keep.
 */
export function doneOnTime(s) {
  if (!s.done_at || !s.due_date) return null;
  return String(s.done_at).slice(0, 10) <= s.due_date;
}

export function shapeStep(s, task, user, can) {
  const st = stepState(s, s.owner_lead ?? 2);
  return {
    id: s.id,
    taskId: s.task_id,
    name: s.name,
    kind: s.kind,
    kindLabel: KIND_LABEL[s.kind],
    ownerId: s.owner_id,
    ownerName: s.owner_name,
    dueDate: s.due_date,
    note: s.note,
    position: s.position,
    doneAt: s.done_at,
    doneByName: s.done_by_name,
    // Green or red on the row: kept on the server so the interface and the
    // spreadsheet cannot disagree about whether something landed on time.
    doneOnTime: doneOnTime(s),
    creatorName: s.creator_name,
    createdAt: s.created_at,
    state: st.state,
    daysToDue: st.days,
    mine: s.owner_id === user.id,
    ...stepActions(s, task, user, can),
  };
}

/** Every step on one task, in the order somebody arranged them. */
export async function stepsFor(task, user, can) {
  const rows = await db.prepare(`${SELECT} WHERE s.task_id = ? ORDER BY s.position, s.id`).all(task.id);
  return rows.map((s) => shapeStep(s, task, user, can));
}

export const loadStep = (id) => db.prepare(`${SELECT} WHERE s.id = ?`).get(id);

/**
 * How many pieces of work are still open on a task.
 *
 * Follow-ups are excluded on purpose. A check-back scheduled for a fortnight
 * after delivery is not a reason to hesitate before marking the work done, and
 * counting it would make the rule unusable.
 */
export async function openStepCount(taskId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM task_steps
        WHERE task_id = ? AND done_at IS NULL AND kind = 'step'`
    )
    .get(taskId);
  return row.c;
}

/** The open steps themselves, for a refusal that can name them. */
export async function openStepNames(taskId, limit = 4) {
  const rows = await db
    .prepare(
      `SELECT name FROM task_steps
        WHERE task_id = ? AND done_at IS NULL AND kind = 'step'
        ORDER BY position, id LIMIT ?`
    )
    .all(taskId, limit);
  return rows.map((r) => r.name);
}

/**
 * The sentence a refusal uses. One place, so the API, the interface and the
 * tests cannot describe the rule differently.
 */
export async function blockedByStepsMessage(taskId) {
  const open = await openStepCount(taskId);
  if (!open) return null;
  const names = await openStepNames(taskId);
  return (
    `${open} step${open === 1 ? '' : 's'} in the breakdown ${open === 1 ? 'is' : 'are'} still open: ` +
    `${names.join(', ')}${open > names.length ? `, and ${open - names.length} more` : ''}. ` +
    `Tick ${open === 1 ? 'it' : 'them'} off first, or remove what turned out not to be needed. ` +
    `Follow-ups do not count.`
  );
}

/**
 * The latest date a step may carry: the task's own completion date.
 *
 * A piece of the work cannot honestly be due after the whole is due. Returned
 * as a value rather than enforced here so the caller can name the task's date
 * in its refusal.
 */
export const stepDateCap = (task, kind) => (kind === 'follow_up' ? null : task.completion_date);

/** Open steps whose deadline would fall outside a proposed task date. */
export async function stepsBeyond(taskId, date) {
  return db
    .prepare(
      `SELECT name, due_date FROM task_steps
        WHERE task_id = ? AND done_at IS NULL AND kind = 'step'
          AND due_date IS NOT NULL AND due_date > ?
        ORDER BY due_date`
    )
    .all(taskId, date);
}

/**
 * The counts and the next thing due, for a page of tasks at once.
 *
 * Two queries for the whole list rather than two per row: a list of 200 tasks
 * would otherwise be 400 round trips to answer a question — "3 of 5" — that
 * nobody would miss enough to pay for.
 */
export async function summariesFor(taskIds) {
  const out = new Map();
  if (!taskIds.length) return out;
  const holes = taskIds.map(() => '?').join(',');

  const totals = await db
    .prepare(
      `SELECT task_id,
              COUNT(*) AS total,
              SUM(CASE WHEN done_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN done_at IS NULL AND kind = 'step' THEN 1 ELSE 0 END) AS open_steps,
              SUM(CASE WHEN done_at IS NULL AND kind = 'follow_up' THEN 1 ELSE 0 END) AS open_follow_ups
         FROM task_steps WHERE task_id IN (${holes}) GROUP BY task_id`
    )
    .all(...taskIds);
  for (const r of totals) {
    out.set(r.task_id, {
      total: r.total,
      done: r.done,
      openSteps: r.open_steps,
      openFollowUps: r.open_follow_ups,
      late: 0,
      soon: 0,
      next: null,
    });
  }

  // The soonest unfinished dated item per task, plus a count of how many have
  // slipped — ordered so the first row seen for a task is the one to show.
  const dated = await db
    .prepare(
      `SELECT s.task_id, s.id, s.name, s.kind, s.due_date, s.owner_id, o.name AS owner_name
         FROM task_steps s JOIN users o ON o.id = s.owner_id
        WHERE s.task_id IN (${holes}) AND s.done_at IS NULL AND s.due_date IS NOT NULL
        ORDER BY s.task_id, s.due_date, s.position, s.id`
    )
    .all(...taskIds);
  for (const r of dated) {
    const sum = out.get(r.task_id);
    if (!sum) continue;
    const st = stepState(r);
    if (st.state === 'late') sum.late += 1;
    // "waiting" is a follow-up whose day has come, which wants attention just
    // as much as a step that is nearly due.
    if (st.state === 'soon' || st.state === 'waiting') sum.soon += 1;
    if (!sum.next) {
      sum.next = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        dueDate: r.due_date,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
        state: st.state,
        daysToDue: st.days,
      };
    }
  }
  return out;
}

/**
 * Attach a summary to a shaped task. Absent when there is no breakdown.
 *
 * `blockedBySteps` is the flag the interface reads: with it set, marking done
 * is not on offer, and the reason is one sentence away rather than a mystery.
 */
export function withSteps(shaped, summary) {
  const s = summary || null;
  const open = s ? s.openSteps : 0;
  return {
    ...shaped,
    stepTotal: s ? s.total : 0,
    stepsDone: s ? s.done : 0,
    stepsOpen: open,
    followUpsOpen: s ? s.openFollowUps : 0,
    stepsLate: s ? s.late : 0,
    stepsDueSoon: s ? s.soon : 0,
    nextStep: s ? s.next : null,
    blockedBySteps: open > 0 && shaped.status === 'open',
    // A move the breakdown is holding up is not a move this person lacks the
    // standing to make, so the two are reported separately.
    canSubmit: shaped.canSubmit && open === 0,
  };
}

// --- writes ----------------------------------------------------------------

/** Next position on a task, so a new step lands at the bottom. */
export async function nextPosition(taskId) {
  const row = await db.prepare('SELECT MAX(position) AS p FROM task_steps WHERE task_id = ?').get(taskId);
  return (row.p ?? -1) + 1;
}

/**
 * Move the open steps that belonged to one person to another.
 *
 * Used when a whole task changes hands. Only their *open* ones move: a step
 * somebody actually finished stays theirs, because the record of who did it is
 * the point. Steps already assigned to a third person are left alone — they
 * were a deliberate choice, not an inheritance.
 */
export async function handOverSteps(taskId, fromId, toId, stamp = nowSql()) {
  const info = await db
    .prepare(
      `UPDATE task_steps SET owner_id = ?, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND done_at IS NULL`
    )
    .run(toId, stamp, taskId, fromId);
  return info.changes;
}

/** Everything on this person's plate that is a step rather than a whole task. */
export async function myOpenSteps(userId, { limit = 25 } = {}) {
  const rows = await db
    .prepare(
      `SELECT s.*, o.reminder_days_before AS owner_lead,
              t.name AS task_name, t.client_name, t.status AS task_status, t.owner_id AS task_owner_id
         FROM task_steps s
         JOIN tasks t ON t.id = s.task_id
         JOIN users o ON o.id = s.owner_id
        WHERE s.owner_id = ? AND s.done_at IS NULL AND t.status <> 'cancelled'
        ORDER BY s.due_date IS NULL, s.due_date, s.position, s.id
        LIMIT ?`
    )
    .all(userId, limit);
  return rows.map((s) => {
    const st = stepState(s, s.owner_lead ?? 2);
    return {
      id: s.id,
      taskId: s.task_id,
      taskName: s.task_name,
      clientName: s.client_name,
      taskStatus: s.task_status,
      // Says why this is on their list at all, which is the thing that makes
      // a step on somebody else's task make sense.
      onSomebodyElsesTask: s.task_owner_id !== userId,
      name: s.name,
      kind: s.kind,
      kindLabel: KIND_LABEL[s.kind],
      dueDate: s.due_date,
      note: s.note,
      state: st.state,
      daysToDue: st.days,
      canTick: true,
    };
  });
}

export { today };
