/**
 * Attachments — Vercel Blob edition. Same rules as the on-prem edition:
 * downloads only ever go through this authenticated route, and the stored
 * name is generated rather than the name the file arrived with. The one
 * mechanical change: uploading is now an explicit `await storeFile(f)` per
 * file (multer just buffers the bytes into memory now; nothing writes them
 * anywhere until this route says so), and every database call is awaited.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../lib/validate.js';
import { can, canViewTask } from '../access.js';
import { actionsFor, record } from '../services/workflow.js';
import { acceptFiles, sendStoredFile, removeStoredFile, storeFile } from '../lib/uploads.js';

const router = Router();
router.use(requireAuth);

// --- upload ----------------------------------------------------------------

router.post(
  '/task/:taskId',
  acceptFiles(),
  wrap(async (req, res) => {
    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (!(await canViewTask(req.user, task))) {
      return res.status(403).json({ error: 'No access to that task' });
    }
    const a = await actionsFor(task, req.user, can);
    if (!a.canAttach) {
      return res.status(403).json({
        error:
          task.status === 'approved'
            ? 'This task is approved — reopen it to add anything else'
            : 'You cannot add files to that task',
      });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No file came through' });
    }

    const stamp = nowSql();
    const added = [];
    for (const f of req.files) {
      const storedName = await storeFile(f);
      const info = await db
        .prepare(
          `INSERT INTO attachments
             (task_id, filename, stored_name, mime_type, size_bytes, uploaded_by, created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(task.id, f.originalname || storedName, storedName, f.mimetype || null, f.size, req.user.id, stamp);
      added.push({ id: info.lastInsertRowid, filename: f.originalname, sizeBytes: f.size });
    }

    await record({
      taskId: task.id,
      actorId: req.user.id,
      action: 'attached',
      from: task.status,
      to: task.status,
      note: added.map((x) => x.filename).join(', '),
    });

    res.status(201).json({ attachments: added });
  })
);

// --- download --------------------------------------------------------------

router.get(
  '/:id',
  wrap(async (req, res) => {
    const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.task_id);
    if (!(await canViewTask(req.user, task))) {
      return res.status(403).json({ error: 'No access to that file' });
    }

    return sendStoredFile(res, row, { inline: req.query.inline === 'true' });
  })
);

// --- remove ----------------------------------------------------------------

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.task_id);
    if (!(await canViewTask(req.user, task))) {
      return res.status(403).json({ error: 'No access to that file' });
    }
    if (row.uploaded_by !== req.user.id && !can(req.user, 'tasks.edit')) {
      return res.status(403).json({ error: 'Only whoever uploaded it, or the manager, can remove it' });
    }
    if (task.status === 'approved') {
      return res
        .status(409)
        .json({ error: 'This task is approved — its evidence stays as it was signed off' });
    }

    await db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
    await removeStoredFile(row.stored_name);
    await record({
      taskId: task.id,
      actorId: req.user.id,
      action: 'removed_attachment',
      from: task.status,
      to: task.status,
      note: row.filename,
    });
    res.json({ ok: true });
  })
);

export default router;
