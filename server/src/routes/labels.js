/**
 * Labels — a Manager's own tag for a task, usually the wider project several
 * different people's tasks belong to.
 *
 * Read is open to anyone signed in: a team member's own task carries a label
 * they should be able to see, and the picker on Task Detail needs the list
 * to show it. Write — creating a label, renaming or recoloring one, deleting
 * one, or putting one on a task (that last part lives in routes/tasks.js,
 * since it is really an edit to a task) — is `labels.manage` only: Manager
 * or Super Admin. The CEO reads by label; a Manager decides what the labels
 * are.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap, requireFields, bad } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);

const MAX_NAME = 60;

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (n.length < 2) bad('Give the label a name');
  if (n.length > MAX_NAME) bad(`Keep the name under ${MAX_NAME} characters`);
  return n;
}

const SELECT = `
  SELECT l.*, (SELECT COUNT(*) FROM tasks t WHERE t.label_id = l.id) AS task_count
    FROM labels l`;

const shape = (l) => ({
  id: l.id,
  name: l.name,
  color: l.color,
  taskCount: l.task_count,
  createdAt: l.created_at,
});

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db.prepare(`${SELECT} ORDER BY l.name`).all();
    res.json({ labels: rows.map(shape) });
  })
);

router.post(
  '/',
  requirePermission('labels.manage'),
  wrap(async (req, res) => {
    requireFields(req.body, ['name']);
    const name = cleanName(req.body.name);
    if (await db.prepare('SELECT 1 FROM labels WHERE lower(name) = lower(?)').get(name)) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    const color = req.body.color ? String(req.body.color).trim().slice(0, 20) : null;
    const info = await db
      .prepare('INSERT INTO labels (name, color, created_by) VALUES (?, ?, ?)')
      .run(name, color, req.user.id);
    const row = await db.prepare(`${SELECT} WHERE l.id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ label: shape(row) });
  })
);

router.patch(
  '/:id',
  requirePermission('labels.manage'),
  wrap(async (req, res) => {
    const label = await db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });

    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      const name = cleanName(req.body.name);
      const clash = await db
        .prepare('SELECT 1 FROM labels WHERE lower(name) = lower(?) AND id <> ?')
        .get(name, label.id);
      if (clash) return res.status(409).json({ error: 'A label with that name already exists' });
      sets.push('name = ?');
      params.push(name);
    }
    if (req.body.color !== undefined) {
      sets.push('color = ?');
      params.push(req.body.color ? String(req.body.color).trim().slice(0, 20) : null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = ?');
    params.push(nowSql(), label.id);
    await db.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const row = await db.prepare(`${SELECT} WHERE l.id = ?`).get(label.id);
    res.json({ label: shape(row) });
  })
);

/**
 * `tasks.label_id` is `ON DELETE SET NULL`, so removing a label just clears
 * it from whatever it was on rather than refusing — a label is a reading
 * aid, not a record worth protecting the way a person or a task itself is.
 */
router.delete(
  '/:id',
  requirePermission('labels.manage'),
  wrap(async (req, res) => {
    const label = await db.prepare('SELECT id FROM labels WHERE id = ?').get(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    await db.prepare('DELETE FROM labels WHERE id = ?').run(label.id);
    res.json({ ok: true });
  })
);

export default router;
