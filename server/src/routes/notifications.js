/**
 * The bell. Same three states (unread / read / snoozed) as the on-prem
 * edition; every handler is `async` and every query `await`ed.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap, bad } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);

export const SNOOZE_PRESETS = [
  { key: '1h', label: 'in an hour' },
  { key: '3h', label: 'in three hours' },
  { key: 'tomorrow', label: 'tomorrow morning' },
  { key: '3d', label: 'in three days' },
  { key: 'nextweek', label: 'next Monday' },
];

function snoozeUntil(preset) {
  const when = new Date();
  switch (preset) {
    case '1h':
      when.setHours(when.getHours() + 1);
      break;
    case '3h':
      when.setHours(when.getHours() + 3);
      break;
    case '3d':
      when.setDate(when.getDate() + 3);
      when.setHours(9, 0, 0, 0);
      break;
    case 'nextweek':
      when.setDate(when.getDate() + (((8 - when.getDay()) % 7) || 7));
      when.setHours(9, 0, 0, 0);
      break;
    case 'tomorrow':
    default:
      when.setDate(when.getDate() + 1);
      when.setHours(9, 0, 0, 0);
      break;
  }
  return when.toISOString().slice(0, 19).replace('T', ' ');
}

const shape = (n) => ({
  id: n.id,
  type: n.type,
  severity: n.severity,
  title: n.title,
  body: n.body,
  taskId: n.task_id,
  taskName: n.task_name || null,
  taskStatus: n.task_status || null,
  readAt: n.read_at,
  snoozedUntil: n.snoozed_until,
  createdAt: n.created_at,
});

const SELECT = `
  SELECT n.*, t.name AS task_name, t.status AS task_status
    FROM notifications n
    LEFT JOIN tasks t ON t.id = n.task_id`;

router.get(
  '/',
  wrap(async (req, res) => {
    const now = nowSql();
    const wantSnoozed = req.query.snoozed === 'true';
    const where = ['n.user_id = ?'];
    const params = [req.user.id];

    where.push(
      wantSnoozed
        ? 'n.snoozed_until IS NOT NULL AND n.snoozed_until > ?'
        : '(n.snoozed_until IS NULL OR n.snoozed_until <= ?)'
    );
    params.push(now);

    if (req.query.unread === 'true') where.push('n.read_at IS NULL');

    const limit = Number(req.query.limit);
    const rows = await db
      .prepare(
        `${SELECT} WHERE ${where.join(' AND ')}
          ORDER BY n.read_at IS NOT NULL,
                   CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                   n.created_at DESC
          LIMIT ?`
      )
      .all(...params, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 60);

    const counts = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)
                    THEN 1 ELSE 0 END) AS unread,
           SUM(CASE WHEN read_at IS NULL AND severity = 'critical'
                     AND (snoozed_until IS NULL OR snoozed_until <= ?)
                    THEN 1 ELSE 0 END) AS critical,
           SUM(CASE WHEN snoozed_until IS NOT NULL AND snoozed_until > ? THEN 1 ELSE 0 END) AS snoozed
         FROM notifications WHERE user_id = ?`
      )
      .get(now, now, now, req.user.id);

    res.json({
      notifications: rows.map(shape),
      unread: counts.unread || 0,
      critical: counts.critical || 0,
      snoozed: counts.snoozed || 0,
      presets: SNOOZE_PRESETS,
    });
  })
);

const mine = (id, userId) =>
  db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, userId);

router.post(
  '/:id/read',
  wrap(async (req, res) => {
    const n = await mine(req.params.id, req.user.id);
    if (!n) return res.status(404).json({ error: 'No such alert' });
    await db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowSql(), n.id);
    res.json({ ok: true });
  })
);

router.post(
  '/read-all',
  wrap(async (req, res) => {
    const info = await db
      .prepare(
        `UPDATE notifications SET read_at = ?
          WHERE user_id = ? AND read_at IS NULL
            AND (snoozed_until IS NULL OR snoozed_until <= ?)`
      )
      .run(nowSql(), req.user.id, nowSql());
    res.json({ ok: true, marked: info.changes });
  })
);

router.post(
  '/:id/snooze',
  wrap(async (req, res) => {
    const n = await mine(req.params.id, req.user.id);
    if (!n) return res.status(404).json({ error: 'No such alert' });

    const preset = String(req.body.preset || 'tomorrow');
    if (!SNOOZE_PRESETS.some((p) => p.key === preset)) bad('Unknown snooze option');

    const until = snoozeUntil(preset);
    await db
      .prepare('UPDATE notifications SET snoozed_until = ?, read_at = NULL WHERE id = ?')
      .run(until, n.id);
    res.json({
      ok: true,
      snoozedUntil: until,
      label: SNOOZE_PRESETS.find((p) => p.key === preset).label,
    });
  })
);

router.post(
  '/:id/unsnooze',
  wrap(async (req, res) => {
    const n = await mine(req.params.id, req.user.id);
    if (!n) return res.status(404).json({ error: 'No such alert' });
    await db.prepare('UPDATE notifications SET snoozed_until = NULL WHERE id = ?').run(n.id);
    res.json({ ok: true });
  })
);

export default router;
