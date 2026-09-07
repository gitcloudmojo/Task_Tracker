/**
 * The approval chain — the one piece of logic this product exists for.
 *
 *   open ──submit──▶ submitted ──verify──▶ verified ──approve──▶ approved
 *                        │                    │
 *                        └──── return ────────┴──▶ back to open, with a reason
 *
 * Same three rules as the on-prem edition (nobody signs off their own work).
 * The only change for the Vercel/Turso edition: every function that queries
 * the database is `async` now, which cascades to `actionsFor` (it calls
 * `canCheck`) and therefore to every route that shapes a task — those all
 * `await actionsFor(...)` now instead of calling it plain.
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
  submitted: 'the manager to check',
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

/** Somebody other than this person who could approve. */
export async function hasOtherApprover(ownerId) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND role = 'ceo' AND id <> ?`)
    .get(ownerId);
  return row.c > 0;
}

/**
 * When the owner is the only person who could approve — the CEO's own tasks —
 * verification is the last gate.
 */
export async function verifyCompletesTask(task) {
  return !(await hasOtherApprover(task.owner_id));
}

/**
 * What this user may do to this task right now. `await`ed by every caller —
 * it now touches the database (via `canCheck`) instead of being pure.
 */
export async function actionsFor(task, user, can) {
  const isOwner = task.owner_id === user.id;
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
