/**
 * The approval chain — the one piece of logic this product exists for.
 *
 *   open ──submit──▶ submitted ──verify──▶ approved
 *                        │
 *                        └──── return ────▶ back to open, with a reason
 *
 * A manager's verification used to be the middle of three gates, with the
 * CEO's separate approval as the last one. That last gate was retired: a
 * task no longer waits on the CEO once the person who is supposed to check
 * it has done so. The CEO keeps full visibility (see labels, for how they
 * find their way to a particular slice of the work) and can comment on
 * anything, but does not hold up the chain — see `verifyCompletesTask` below,
 * which is the one function that changed, and `db/index.js`'s `patch()` for
 * the one-time fix that closed out tasks caught mid-flight when this shipped.
 *
 * `verified` stays a legal status and the verified_ and approved_ columns
 * stay exactly as they were, both because a manager's check is still a real,
 * separately-recorded fact and because old rows read exactly as they always
 * did — nothing here rewrites history, it only stops adding a state nobody
 * needs to sit in any more.
 *
 * Same one rule as ever: nobody signs off their own work. The only change for
 * the Vercel/Turso edition: every function that queries the database is
 * `async` now, which cascades to `actionsFor` (it calls `canCheck`) and
 * therefore to every route that shapes a task — those all `await
 * actionsFor(...)` now instead of calling it plain.
 */
import { db, nowSql, today } from '../db/index.js';

export const STATUSES = ['open', 'submitted', 'verified', 'approved', 'cancelled'];

export const STATUS_LABEL = {
  open: 'Open',
  submitted: 'Submitted for completion',
  verified: 'Verified — awaiting approval',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

export const WAITING_ON = {
  open: 'the owner',
  submitted: 'the manager to check — checking it is the final sign-off',
  verified: 'the CEO to approve',
  approved: 'nobody — signed off',
  cancelled: 'nobody — cancelled',
};

export const OPEN_STATUSES = ['open', 'submitted', 'verified'];

export const isLive = (t) => OPEN_STATUSES.includes(t.status);

export function daysToDue(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = today().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

export function overdueState(t) {
  const days = daysToDue(t.completion_date);
  if (!isLive(t) || days === null || days >= 0) return { overdue: false, days, lateSide: null };
  return {
    overdue: true,
    days,
    lateSide: t.status === 'open' ? 'owner' : t.status === 'submitted' ? 'verifier' : 'approver',
  };
}

/** Is there a manager, other than this task's owner, who could check it? */
export async function hasOtherChecker(ownerId) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND role = 'admin' AND id <> ?`)
    .get(ownerId);
  return row.c > 0;
}

/** Whether this person may check this particular task. */
export async function canCheck(task, user, can) {
  if (task.owner_id === user.id) return false;
  if (!can(user, 'tasks.verify')) return false;
  if (user.role === 'ceo') return hasOtherChecker(task.owner_id).then((v) => !v);
  return true;
}

/**
 * Verification is always the last gate now.
 *
 * This used to check whether anybody was left to approve after the manager
 * (true only for the CEO's own tasks, where there was nobody left) and leave
 * every other task sitting in `verified` for the CEO to separately sign off.
 * That second gate is gone: a manager's check completes the task outright, so
 * this is unconditional. Kept as a named function rather than inlined at its
 * one call site (tasks.js's `/verify` route) so the one thing that changed
 * when the CEO approval step was retired reads as one small, obviously-true
 * function instead of a fact buried in a route.
 */
export async function verifyCompletesTask() {
  return true;
}

/**
 * What this user may do to this task right now. `await`ed by every caller —
 * it now touches the database (via `canCheck`) instead of being pure.
 *
 * `canApprove` (and the `verified` half of `returnOk`) are left exactly as
 * they were rather than deleted: since `verifyCompletesTask` is now always
 * true, no task reaches `status === 'verified'` any more, so both are dead in
 * the ordinary flow — but they cost nothing to keep, and they are the one
 * thing standing ready should a task ever end up there again (a manual data
 * fix, a future rule change) instead of that case being unhandled.
 */
export async function actionsFor(task, user, can) {
  const isOwner = task.owner_id === user.id;
  const isCreator = task.created_by === user.id;
  const live = isLive(task);
  const [verifyOk, approveOk] = await Promise.all([
    task.status === 'submitted' ? canCheck(task, user, can) : Promise.resolve(false),
    Promise.resolve(task.status === 'verified' && !isOwner && can(user, 'tasks.approve')),
  ]);
  const returnOk =
    (task.status === 'submitted' && (await canCheck(task, user, can))) ||
    (task.status === 'verified' && !isOwner && can(user, 'tasks.approve'));

  return {
    canSubmit: live && isOwner && task.status === 'open',
    canVerify: verifyOk,
    canApprove: approveOk,
    canReturn: returnOk,
    canEdit: live && can(user, 'tasks.edit'),
    // A team member holds no general `tasks.edit`, but a task they both own
    // *and* created — one they made for themselves, via `tasks.create_own` —
    // is theirs to fix a typo or push the date on. This never reaches to a
    // task somebody else assigned them: `isCreator` is what keeps the two
    // apart, and it never grants reassignment (that stays `tasks.assign`).
    canEditOwn: live && !can(user, 'tasks.edit') && isOwner && isCreator && can(user, 'tasks.create_own'),
    canReassign: live && can(user, 'tasks.assign'),
    canCancel: live && can(user, 'tasks.cancel'),
    canReopen: task.status === 'approved' && can(user, 'tasks.reopen'),
    canAttach: live && (isOwner || can(user, 'tasks.edit')),
    canDeleteOthersAttachments: can(user, 'tasks.edit'),
  };
}

/** Append to the history. Never updates, never deletes. */
export async function record({ taskId, actorId, action, from = null, to = null, note = null }, execDb = db) {
  await execDb
    .prepare(
      `INSERT INTO task_events (task_id, actor_id, action, from_status, to_status, note, created_at)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(taskId, actorId, action, from, to, note || null, nowSql());
}

export async function history(taskId) {
  const rows = await db
    .prepare(
      `SELECT e.*, u.name AS actor_name, u.role AS actor_role
         FROM task_events e JOIN users u ON u.id = e.actor_id
        WHERE e.task_id = ? ORDER BY e.created_at, e.id`
    )
    .all(taskId);
  return rows.map((e) => ({
    id: e.id,
    action: e.action,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    note: e.note,
    actorName: e.actor_name,
    actorRole: e.actor_role,
    createdAt: e.created_at,
  }));
}
