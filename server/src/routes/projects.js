/**
 * Projects — a manager's own reference list, kept entirely by hand.
 *
 * This is deliberately NOT derived from tasks.client_name. A task's "Client"
 * field is billing information; a project here is just the manager's note of
 * who is on which engagement — created, renamed and staffed by hand, and read
 * by nobody else in the app. Deleting a project touches nothing but its own
 * two rows.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap, requireFields, bad } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('projects.view'));

const MAX_NAME = 120;

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (n.length < 2) bad('Give the project a name');
  if (n.length > MAX_NAME) bad(`Keep the name under ${MAX_NAME} characters`);
  return n;
}

/** Only active people can be added — same rule as assigning a task. */
async function cleanMemberIds(memberIds) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(Number))].filter((n) =>
    Number.isInteger(n)
  );
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT id FROM users WHERE is_active = 1 AND id IN (${placeholders})`)
    .all(...ids);
  return rows.map((r) => r.id);
}

async function replaceMembers(projectId, memberIds) {
  await db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId);
  for (const uid of memberIds) {
    await db
      .prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)')
      .run(projectId, uid);
  }
}

/** Attach each project's members, one extra query for the whole list. */
async function withMembers(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const members = await db
    .prepare(
      `SELECT pm.project_id AS project_id, u.id, u.name, u.role, u.team, u.title, u.is_active
         FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN (${placeholders})
        ORDER BY u.name`
    )
    .all(...ids);
  const byProject = new Map(ids.map((id) => [id, []]));
  for (const m of members) {
    byProject.get(m.project_id).push({
      id: m.id,
      name: m.name,
      role: m.role,
      team: m.team,
      title: m.title,
      isActive: Boolean(m.is_active),
    });
  }
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, people: byProject.get(r.id) || [] }));
}

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db.prepare('SELECT * FROM projects ORDER BY name').all();
    res.json({ projects: await withMembers(rows) });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    requireFields(req.body, ['name']);
    const name = cleanName(req.body.name);
    if (await db.prepare('SELECT 1 FROM projects WHERE lower(name) = lower(?)').get(name)) {
      return res.status(409).json({ error: 'A project with that name already exists' });
    }

    const memberIds = await cleanMemberIds(req.body.memberIds);
    const info = await db
      .prepare('INSERT INTO projects (name, created_by) VALUES (?, ?)')
      .run(name, req.user.id);
    const projectId = info.lastInsertRowid;
    await replaceMembers(projectId, memberIds);

    const [project] = await withMembers([{ id: projectId, name }]);
    res.status(201).json({ project });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    let name = project.name;
    if (req.body.name !== undefined) {
      name = cleanName(req.body.name);
      const clash = await db
        .prepare('SELECT 1 FROM projects WHERE lower(name) = lower(?) AND id <> ?')
        .get(name, project.id);
      if (clash) return res.status(409).json({ error: 'A project with that name already exists' });
      await db
        .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, nowSql(), project.id);
    }

    if (req.body.memberIds !== undefined) {
      await replaceMembers(project.id, await cleanMemberIds(req.body.memberIds));
    }

    const [updated] = await withMembers([{ id: project.id, name }]);
    res.json({ project: updated });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const project = await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    res.json({ ok: true });
  })
);

export default router;
