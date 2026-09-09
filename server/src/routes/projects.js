/**
 * Projects — one screen for the manager: every client name that has ever had
 * a task, and who is currently on it.
 *
 * There is no `projects` table. A project here is `tasks.client_name`, and
 * "who is on it" is found the same way the rest of the app finds that:
 * whoever owns a task for that client. Cancelled tasks do not count — a
 * cancelled task never happened, so it puts nobody "on" anything.
 */
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('projects.view'));

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT DISTINCT t.client_name AS project,
                u.id, u.name, u.role, u.team, u.title, u.is_active
           FROM tasks t
           JOIN users u ON u.id = t.owner_id
          WHERE t.status <> 'cancelled'
          ORDER BY t.client_name, u.name`
      )
      .all();

    const byProject = new Map();
    for (const r of rows) {
      if (!byProject.has(r.project)) byProject.set(r.project, []);
      byProject.get(r.project).push({
        id: r.id,
        name: r.name,
        role: r.role,
        team: r.team,
        title: r.title,
        isActive: Boolean(r.is_active),
      });
    }

    const projects = [...byProject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, people]) => ({ name, people }));

    res.json({ projects });
  })
);

export default router;
