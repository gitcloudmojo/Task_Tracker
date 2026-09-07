import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, nowSql } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { wrap, requireFields, num } from '../lib/validate.js';
import { ROLE_LABEL, clientPermissions, scopeLabel } from '../access.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  roleLabel: ROLE_LABEL[u.role],
  team: u.team,
  title: u.title,
  reminderDaysBefore: u.reminder_days_before,
  scopeLabel: scopeLabel(u),
  permissions: clientPermissions(u),
});

router.post(
  '/login',
  wrap(async (req, res) => {
    requireFields(req.body, ['email', 'password']);
    const user = await db
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(String(req.body.email).trim());

    if (user && !user.password_hash) {
      return res.status(401).json({
        error: 'This account has no password yet. Ask your manager to set one for you.',
      });
    }
    if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const sets = [];
    const params = [];

    if (req.body.name) {
      sets.push('name = ?');
      params.push(String(req.body.name).trim());
    }
    const days = num(req.body.reminderDaysBefore, 'reminderDaysBefore', { min: 0, max: 30 });
    if (days !== undefined) {
      sets.push('reminder_days_before = ?');
      params.push(days);
    }
    if (req.body.newPassword) {
      const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!bcrypt.compareSync(req.body.currentPassword || '', row.password_hash)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      if (String(req.body.newPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      sets.push('password_hash = ?');
      params.push(bcrypt.hashSync(String(req.body.newPassword), 10));
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('updated_at = ?');
    params.push(nowSql(), req.user.id);
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ user: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

export default router;
