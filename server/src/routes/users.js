/**
 * People. Same as the on-prem edition; every handler is `async` and every
 * database call in it is `await`ed now.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, nowSql } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap, requireFields, oneOf, bad } from '../lib/validate.js';
import {
  ROLES,
  ROLE_LABEL,
  ROLE_NOTE,
  can,
  permissionsFor,
  ALL_PERMISSIONS,
  APPOINTERS,
} from '../access.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('team.view'));

export const TEAMS = ['Sales', 'Pre-sales', 'Design', 'Delivery', 'IT', 'Finance', 'Operations'];

/** Whether `actorRole` may create or hold-the-keys-to an account of `role`. */
const canAppoint = (actorRole, role) => {
  const gate = APPOINTERS[role];
  return !gate || gate.includes(actorRole);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const shape = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  roleLabel: ROLE_LABEL[u.role],
  team: u.team,
  title: u.title,
  isActive: Boolean(u.is_active),
  hasPassword: Boolean(u.password_hash),
  openTasks: u.open_tasks ?? null,
  overdueTasks: u.overdue_tasks ?? null,
  awaitingReview: u.awaiting_review ?? null,
  approvedTasks: u.approved_tasks ?? null,
  createdAt: u.created_at,
});

router.get('/teams', (req, res) => res.json({ teams: TEAMS }));

router.get('/roles', (req, res) =>
  res.json({
    roles: ROLES.map((r) => ({
      key: r,
      label: ROLE_LABEL[r],
      note: ROLE_NOTE[r],
      permissions: permissionsFor(r),
    })),
    permissions: ALL_PERMISSIONS,
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id
                   AND t.status IN ('open','submitted','verified')) AS open_tasks,
                (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id
                   AND t.status IN ('open','submitted','verified')
                   AND t.completion_date < date('now')) AS overdue_tasks,
                (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id
                   AND t.status IN ('submitted','verified')) AS awaiting_review,
                (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id
                   AND t.status = 'approved') AS approved_tasks
           FROM users u
          ORDER BY u.is_active DESC, u.name`
      )
      .all();
    res.json({ users: rows.map(shape), canManage: can(req.user, 'team.manage'), teams: TEAMS });
  })
);

router.post(
  '/',
  requirePermission('team.manage'),
  wrap(async (req, res) => {
    requireFields(req.body, ['name', 'email', 'password', 'role']);
    oneOf(req.body.role, ROLES, 'role');
    if (!canAppoint(req.user.role, req.body.role)) {
      return res.status(403).json({
        error: `Only ${req.body.role === 'superadmin' ? 'a Super Admin' : 'the CEO or a Super Admin'} can create a ${ROLE_LABEL[req.body.role]} account`,
      });
    }
    if (req.body.team) oneOf(req.body.team, TEAMS, 'team');
    if (String(req.body.password).length < 8) bad('Password must be at least 8 characters');

    const email = String(req.body.email).trim().toLowerCase();
    if (await db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email)) {
      return res.status(409).json({ error: 'Somebody already has that email' });
    }

    const stamp = nowSql();
    const info = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, team, title, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        String(req.body.name).trim(),
        email,
        bcrypt.hashSync(String(req.body.password), 10),
        req.body.role,
        req.body.team || null,
        req.body.title ? String(req.body.title).trim() : null,
        stamp,
        stamp
      );
    res
      .status(201)
      .json({ user: shape(await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
  })
);

router.patch(
  '/:id',
  requirePermission('team.manage'),
  wrap(async (req, res) => {
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (APPOINTERS[target.role] && !APPOINTERS[target.role].includes(req.user.role)) {
      return res.status(403).json({ error: `The ${ROLE_LABEL[target.role]} account cannot be edited here` });
    }

    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      sets.push('name = ?');
      params.push(String(req.body.name).trim());
    }
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!email) bad('Email cannot be empty');
      if (!EMAIL_RE.test(email)) bad('That does not look like a valid email');
      const clash = await db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?').get(email, target.id);
      if (clash) return res.status(409).json({ error: 'Somebody already has that email' });
      sets.push('email = ?');
      params.push(email);
    }
    if (req.body.title !== undefined) {
      sets.push('title = ?');
      params.push(req.body.title || null);
    }
    if (req.body.team !== undefined) {
      if (req.body.team) oneOf(req.body.team, TEAMS, 'team');
      sets.push('team = ?');
      params.push(req.body.team || null);
    }
    if (req.body.role !== undefined) {
      oneOf(req.body.role, ROLES, 'role');
      if (!canAppoint(req.user.role, req.body.role)) {
        return res.status(403).json({
          error: `Only ${req.body.role === 'superadmin' ? 'a Super Admin' : 'the CEO or a Super Admin'} can appoint ${ROLE_LABEL[req.body.role]}`,
        });
      }
      sets.push('role = ?');
      params.push(req.body.role);
    }
    if (req.body.isActive !== undefined) {
      if (req.body.isActive === false) {
        if (target.id === req.user.id) {
          return res.status(400).json({ error: 'You cannot deactivate your own account.' });
        }
        const liveRow = await db
          .prepare(
            `SELECT COUNT(*) AS c FROM tasks
              WHERE owner_id = ? AND status IN ('open','submitted','verified')`
          )
          .get(target.id);
        if (liveRow.c > 0) {
          return res.status(409).json({
            error: `${target.name} still owns ${liveRow.c} live task${liveRow.c === 1 ? '' : 's'}. Reassign them first.`,
          });
        }
      }
      sets.push('is_active = ?');
      params.push(req.body.isActive ? 1 : 0);
    }
    const newPassword = req.body.newPassword ?? req.body.password;
    if (newPassword !== undefined) {
      if (String(newPassword).length < 8) bad('A password needs at least 8 characters');
      sets.push('password_hash = ?');
      params.push(bcrypt.hashSync(String(newPassword), 10));
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = ?');
    params.push(nowSql(), target.id);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ user: shape(await db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
  })
);

/**
 * Permanently remove a person. Separate from `isActive: false` above:
 * deactivating keeps every record of what they did; this erases the account
 * itself. It only works when nothing historical still points at them —
 * schema.sql marks a task's owner/creator, a step's owner/creator, an
 * uploaded file, and a history entry's actor all `ON DELETE RESTRICT` on
 * purpose, so "who did what" can never quietly lose a name. Rather than let
 * that surface as a raw database error, this checks first and says plainly
 * what is still attached.
 */
router.delete(
  '/:id',
  requirePermission('users.delete'),
  wrap(async (req, res) => {
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    if (APPOINTERS[target.role] && !APPOINTERS[target.role].includes(req.user.role)) {
      return res.status(403).json({ error: `The ${ROLE_LABEL[target.role]} account cannot be deleted here` });
    }

    const blocks = [];
    const count = async (sql, ...args) => (await db.prepare(sql).get(...args)).c;

    const tasks = await count(
      'SELECT COUNT(*) AS c FROM tasks WHERE owner_id = ? OR created_by = ?',
      target.id,
      target.id
    );
    if (tasks > 0) blocks.push(`${tasks} task${tasks === 1 ? '' : 's'} they own or created`);

    const steps = await count(
      'SELECT COUNT(*) AS c FROM task_steps WHERE owner_id = ? OR created_by = ?',
      target.id,
      target.id
    );
    if (steps > 0) blocks.push(`${steps} step${steps === 1 ? '' : 's'} they own or added`);

    const files = await count('SELECT COUNT(*) AS c FROM attachments WHERE uploaded_by = ?', target.id);
    if (files > 0) blocks.push(`${files} file${files === 1 ? '' : 's'} they uploaded to a task`);

    const chatFiles = await count(
      'SELECT COUNT(*) AS c FROM chat_attachments WHERE uploaded_by = ?',
      target.id
    );
    if (chatFiles > 0) blocks.push(`${chatFiles} file${chatFiles === 1 ? '' : 's'} they sent in chat`);

    const events = await count('SELECT COUNT(*) AS c FROM task_events WHERE actor_id = ?', target.id);
    if (events > 0) blocks.push(`${events} entr${events === 1 ? 'y' : 'ies'} in a task's history`);

    const projects = await count('SELECT COUNT(*) AS c FROM projects WHERE created_by = ?', target.id);
    if (projects > 0) blocks.push(`${projects} project${projects === 1 ? '' : 's'} they created`);

    if (blocks.length) {
      return res.status(409).json({
        error: `${target.name} can't be deleted yet — they still have ${blocks.join(', ')}. Reassign or remove those first.`,
      });
    }

    // Whatever is left (chat messages, notifications, project membership) is
    // marked ON DELETE CASCADE in schema.sql and goes with them.
    await db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    res.json({ ok: true });
  })
);

export default router;
