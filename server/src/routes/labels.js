/**
 * Labels — a manager's own grouping of tasks, so five tasks for four
 * different people can still answer to one project. See schema.sql's comment
 * on the `labels` table for the reasoning; this file is just the CRUD around
 * it, and the one query (`GET /`) that lets the CEO see the whole company's
 * work sliced by label with each task's own status, which is the entire
 * point of the feature.
 *
 * Managing a label (creating, renaming, deleting) is `tasks.edit` — the same
 * permission that already gates every other change to a task, since putting
 * a label on one is exactly that. Seeing the list is `team.view`, which every
 * role holds, so a team member browsing their own tasks can still tell what
 * project one belongs to even though they cannot change it.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap, requireFields, bad } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);

const shape = (l) => ({
  id: l.id,
  name: l.name,
  color: l.color,
  taskCount: l.task_count ?? 0,
  liveCount: l.live_count ?? 0,
  createdAt: l.created_at,
});

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT lb.*,
                COUNT(t.id) AS task_count,
                SUM(CASE WHEN t.status IN ('open','submitted','verified') THEN 1 ELSE 0 END) AS live_count
           FROM labels lb
           LEFT JOIN tasks t ON t.label_id = lb.id
          GROUP BY lb.id
          ORDER BY lb.name`
      )
      .all();
    res.json({ labels: rows.map(shape) });
  })
);

router.post(
  '/',
  requirePermission('tasks.edit'),
  wrap(async (req, res) => {
    requireFields(req.body, ['name']);
    const name = String(req.body.name).trim();
    if (name.length < 2) bad('Give the label a name somebody will recognise');

    if (await db.prepare('SELECT 1 FROM labels WHERE lower(name) = lower(?)').get(name)) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }

    const stamp = nowSql();
    const info = await db
      .prepare('INSERT INTO labels (name, color, created_by, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(name, req.body.color || null, req.user.id, stamp, stamp);

    res.status(201).json({
      label: shape(await db.prepare('SELECT * FROM labels WHERE id = ?').get(info.lastInsertRowid)),
    });
  })
);

router.patch(
  '/:id',
  requirePermission('tasks.edit'),
  wrap(async (req, res) => {
    const existing = await db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Label not found' });

    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2) bad('Give the label a name somebody will recognise');
      const clash = await db
        .prepare('SELECT 1 FROM labels WHERE lower(name) = lower(?) AND id <> ?')
        .get(name, existing.id);
      if (clash) return res.status(409).json({ error: 'A label with that name already exists' });
      sets.push('name = ?');
      params.push(name);
    }
    if (req.body.color !== undefined) {
      sets.push('color = ?');
      params.push(req.body.color || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('updated_at = ?');
    params.push(nowSql(), existing.id);
    await db.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ label: shape(await db.prepare('SELECT * FROM labels WHERE id = ?').get(existing.id)) });
  })
);

/**
 * Deletes the label, never the tasks under it — `label_id` is `ON DELETE SET
 * NULL` in schema.sql, so every task that was filed under this label simply
 * goes back to having none.
 */
router.delete(
  '/:id',
  requirePermission('tasks.edit'),
  wrap(async (req, res) => {
    const existing = await db.prepare('SELECT id FROM labels WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Label not found' });
    await db.prepare('DELETE FROM labels WHERE id = ?').run(existing.id);
    res.json({ ok: true });
  })
);

export default router;
