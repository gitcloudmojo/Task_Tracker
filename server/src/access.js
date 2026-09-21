/**
 * Who can do what, and to which tasks. Unchanged from the on-prem edition
 * except that the functions which query the database (`assignableUsers`,
 * `chatPartners`, and — since the breakdown arrived — `ownsStepOf` and
 * `canViewTask`) are now `async` and must be awaited; everything else here is
 * pure logic with no database call in it, so it did not need to change.
 */
import { db } from './db/index.js';

export const ROLES = ['superadmin', 'ceo', 'admin', 'user'];

export const ROLE_LABEL = {
  superadmin: 'Super Admin',
  ceo: 'CEO',
  admin: 'Manager',
  user: 'Team member',
};

export const ROLE_NOTE = {
  superadmin: 'The one account above everything else — signs off work like the Manager, manages and permanently deletes people and tasks, and is the only role that can create another Super Admin.',
  ceo: 'Sees every task across the company — by label as well as by person — and can leave a comment on any of them. Approval itself now finishes with the Manager.',
  admin: 'Assigns work, checks it came back done — which is also the final sign-off — labels tasks by project, and manages people.',
  user: 'Sees their own tasks and marks them done for the manager to check.',
};

// Roles above this one on the appointment ladder (see routes/users.js): who
// may create or edit an account holding a given role. 'ceo' can be appointed
// by 'ceo' or 'superadmin'; 'superadmin' only by another 'superadmin'. This is
// the same idea as the pre-existing "only the CEO can appoint another CEO"
// rule, extended one level up rather than replaced.
export const APPOINTERS = {
  superadmin: ['superadmin'],
  ceo: ['ceo', 'superadmin'],
};

const GRANTS = {
  superadmin: [
    'tasks.view_all',
    // Kept as a defensive fallback only — see the note above `tasks.approve`
    // on `admin`, below. Nothing in normal use ever needs it.
    'tasks.approve',
    'tasks.verify',
    'tasks.reopen',
    'tasks.export',
    'tasks.create',
    'tasks.edit',
    'tasks.assign',
    'tasks.cancel',
    'tasks.delete',
    'labels.manage',
    'team.view',
    'team.manage',
    'users.delete',
    // Deliberately held by Super Admin only — not by Manager, even though
    // Manager also holds `team.manage`. Resetting somebody's password lets
    // you into their account without their consent; that is a narrower,
    // more sensitive power than the everyday people-management `team.manage`
    // covers, so it gets its own permission rather than riding on that one.
    'users.reset_password',
    'reports.view',
    'projects.view',
  ],
  // The CEO no longer approves — checking a task (`tasks.verify`, still held
  // by `admin` below) *is* the final sign-off now, so approval ends at the
  // Manager and never reaches the CEO's desk. What the CEO keeps: seeing
  // everything (`tasks.view_all`, including grouped by label), and leaving a
  // comment on a task — which needs no permission of its own, since anyone
  // who can see a task may add to its notes log (see routes/tasks.js).
  ceo: [
    'tasks.view_all',
    // Kept as the fallback checker for the rare case where a task's owner is
    // a manager and no *other* manager exists to check it (see
    // hasOtherChecker() in services/workflow.js). Normal use never reaches
    // this — a manager's own check is the everyday path, and is also the
    // final sign-off now, so this is not a second approval step.
    'tasks.verify',
    'tasks.reopen',
    'tasks.export',
    'team.view',
    'reports.view',
  ],
  admin: [
    'tasks.view_all',
    'tasks.create',
    'tasks.edit',
    'tasks.assign',
    'tasks.cancel',
    'tasks.delete',
    'tasks.verify',
    // Checking a submitted task (`tasks.verify`) now finishes it in the same
    // move — see the `/tasks/:id/verify` route — so this is never actually
    // reached in normal use; it stays only as a safety net for a task a
    // pre-existing installation left sitting at `verified`, until the
    // one-time data migration (db/index.js) sweeps it through.
    'tasks.approve',
    'tasks.reopen',
    'tasks.export',
    'labels.manage',
    'team.view',
    'team.manage',
    'users.delete',
    'reports.view',
    'projects.view',
  ],
  // A team member may create a task, but only for themselves — see the
  // ownerId check next to `tasks.create_own`'s one use, in the task-creation
  // route. `tasks.create` (above) still means "for anyone"; this is
  // deliberately a separate, narrower permission rather than a flag on the
  // same one, so the two can never be confused at a call site.
  user: ['tasks.view_own', 'tasks.create_own', 'team.view'],
};

export const ALL_PERMISSIONS = [...new Set(Object.values(GRANTS).flat())].sort();

export function can(user, permission) {
  if (!user) return false;
  return (GRANTS[user.role] || []).includes(permission);
}

export const permissionsFor = (role) =>
  Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, (GRANTS[role] || []).includes(p)]));

export const clientPermissions = (user) => permissionsFor(user.role);

// --- scope -----------------------------------------------------------------

export const ownOnly = (user) => !can(user, 'tasks.view_all');

/**
 * SQL fragment limiting a task query to what this user may read.
 *
 * A user sees tasks they own or created, and — the one deliberate widening
 * here — a task they hold a **step** of. If the manager breaks a task down and
 * hands one step to somebody who does not own the parent, that person cannot
 * do their part blind: they need the client, the deadline and what the task
 * actually is. Seeing the task is not the same as being able to move it;
 * `actionsFor` still refuses them every transition, because they are not the
 * owner.
 */
const STEP_OF_MINE = (alias) =>
  `EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = ${alias}.id AND s.owner_id = ?)`;

export function taskScope(user, alias = 't') {
  if (can(user, 'tasks.view_all')) return { sql: '1=1', params: [] };
  return {
    sql: `(${alias}.owner_id = ? OR ${alias}.created_by = ? OR ${STEP_OF_MINE(alias)})`,
    params: [user.id, user.id, user.id],
  };
}

/** True when this person holds a step of this task. */
export async function ownsStepOf(user, taskId) {
  if (!user || !taskId) return false;
  const row = await db
    .prepare('SELECT 1 FROM task_steps WHERE task_id = ? AND owner_id = ? LIMIT 1')
    .get(taskId, user.id);
  return row !== undefined;
}

export async function canViewTask(user, task) {
  if (!task) return false;
  if (can(user, 'tasks.view_all')) return true;
  if (task.owner_id === user.id || task.created_by === user.id) return true;
  return ownsStepOf(user, task.id);
}

/** Who a task may be handed to: any active person. */
export async function assignableUsers() {
  return db
    .prepare(`SELECT id, name, email, role, team, title FROM users WHERE is_active = 1 ORDER BY name`)
    .all();
}

export function scopeLabel(user) {
  // Role-based rather than permission-based: the CEO no longer holds
  // `tasks.approve` (checking a task is the final word now, and that stays
  // with the Manager), but the CEO's view of the company is still its own
  // thing — everything, grouped and commentable — not the Manager's
  // assign-and-check job.
  if (user.role === 'ceo') return 'Every task across the company — yours to review by label and comment on';
  if (can(user, 'tasks.view_all')) return 'Every task — yours to assign and check';
  return 'The tasks assigned to you';
}

// --- who may talk to whom --------------------------------------------------

export function canTalk(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const pair = [a.role, b.role].sort().join('+');
  return (
    pair === 'admin+ceo' ||
    pair === 'admin+user' ||
    // Super Admin sits above the whole chain and can reach anyone on it.
    pair === 'ceo+superadmin' ||
    pair === 'admin+superadmin' ||
    pair === 'superadmin+user'
  );
}

/** Everybody this person may open a thread with. */
export async function chatPartners(user) {
  const rows = await db
    .prepare(
      `SELECT id, name, email, role, team, title FROM users
        WHERE is_active = 1 AND id <> ?
        ORDER BY role = 'superadmin' DESC, role = 'ceo' DESC, role = 'admin' DESC, name`
    )
    .all(user.id);
  return rows.filter((r) => canTalk(user, r));
}
