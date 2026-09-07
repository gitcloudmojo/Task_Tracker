/**
 * Who can do what, and to which tasks. Unchanged from the on-prem edition
 * except that the two functions which query the database (`assignableUsers`,
 * `chatPartners`) are now `async` and must be awaited — everything else here
 * is pure logic with no database call in it, so it did not need to change.
 */
import { db } from './db/index.js';

export const ROLES = ['ceo', 'admin', 'user'];

export const ROLE_LABEL = {
  ceo: 'CEO',
  admin: 'Manager',
  user: 'Team member',
};

export const ROLE_NOTE = {
  ceo: 'Sees every task and gives the final approval.',
  admin: 'Assigns work, checks it came back done, and manages people.',
  user: 'Sees their own tasks and marks them done for the manager to check.',
};

const GRANTS = {
  ceo: [
    'tasks.view_all',
    'tasks.approve',
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
    'tasks.verify',
    'tasks.export',
    'team.view',
    'team.manage',
    'reports.view',
  ],
  user: ['tasks.view_own', 'team.view'],
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

export function taskScope(user, alias = 't') {
  if (can(user, 'tasks.view_all')) return { sql: '1=1', params: [] };
  return {
    sql: `(${alias}.owner_id = ? OR ${alias}.created_by = ?)`,
    params: [user.id, user.id],
  };
}

export function canViewTask(user, task) {
  if (!task) return false;
  if (can(user, 'tasks.view_all')) return true;
  return task.owner_id === user.id || task.created_by === user.id;
}

/** Who a task may be handed to: any active person. */
export async function assignableUsers() {
  return db
    .prepare(`SELECT id, name, email, role, team, title FROM users WHERE is_active = 1 ORDER BY name`)
    .all();
}

export function scopeLabel(user) {
  if (can(user, 'tasks.approve')) return 'Every task across the company';
  if (can(user, 'tasks.view_all')) return 'Every task — yours to assign and check';
  return 'The tasks assigned to you';
}

// --- who may talk to whom --------------------------------------------------

export function canTalk(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const pair = [a.role, b.role].sort().join('+');
  return pair === 'admin+ceo' || pair === 'admin+user';
}

/** Everybody this person may open a thread with. */
export async function chatPartners(user) {
  const rows = await db
    .prepare(
      `SELECT id, name, email, role, team, title FROM users
        WHERE is_active = 1 AND id <> ? ORDER BY role = 'ceo' DESC, role = 'admin' DESC, name`
    )
    .all(user.id);
  return rows.filter((r) => canTalk(user, r));
}
