/**
 * Chat, on the same line as the approvals. Same rules as the on-prem
 * edition; every handler is `async`, every query `await`ed, and file uploads
 * go through the Vercel Blob helpers in lib/uploads.js instead of local disk.
 */
import { Router } from 'express';
import { db, nowSql } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap, bad } from '../lib/validate.js';
import { canTalk, chatPartners, ROLE_LABEL } from '../access.js';
import { notifyTask } from '../services/alerts.js';
import { acceptFiles, sendStoredFile, removeStoredFile, storeFile } from '../lib/uploads.js';

const router = Router();
router.use(requireAuth);

const MAX = 4000;

const loadPerson = (id) =>
  db.prepare('SELECT id, name, email, role, team, title, is_active FROM users WHERE id = ?').get(id);

const conversation = (a, b) =>
  db
    .prepare(
      `SELECT m.*, u.name AS author_name, u.role AS author_role, t.name AS task_name
         FROM chat_messages m
         JOIN users u ON u.id = m.author_id
         LEFT JOIN tasks t ON t.id = m.task_id
        WHERE (m.author_id = ? AND m.partner_id = ?)
           OR (m.author_id = ? AND m.partner_id = ?)
        ORDER BY m.created_at, m.id`
    )
    .all(a, b, b, a);

const filesFor = async (messageId, meId) => {
  const rows = await db
    .prepare(
      `SELECT a.*, u.name AS uploader_name FROM chat_attachments a
         JOIN users u ON u.id = a.uploaded_by
        WHERE a.message_id = ? ORDER BY a.id`
    )
    .all(messageId);
  return rows.map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    uploaderName: a.uploader_name,
    createdAt: a.created_at,
    canDelete: a.uploaded_by === meId,
  }));
};

const shape = async (m, meId) => ({
  id: m.id,
  body: m.body,
  authorId: m.author_id,
  authorName: m.author_name,
  authorRole: m.author_role,
  authorRoleLabel: ROLE_LABEL[m.author_role],
  mine: m.author_id === meId,
  taskId: m.task_id,
  taskName: m.task_name,
  readAt: m.read_at,
  createdAt: m.created_at,
  files: await filesFor(m.id, meId),
});

// --- who can I talk to, and what is waiting --------------------------------

router.get(
  '/threads',
  wrap(async (req, res) => {
    const me = req.user;
    const partners = await chatPartners(me);

    const threads = await Promise.all(
      partners.map(async (p) => {
        const last = await db
          .prepare(
            `SELECT m.body, m.created_at, m.author_id, u.name AS author_name
               FROM chat_messages m JOIN users u ON u.id = m.author_id
              WHERE (m.author_id = ? AND m.partner_id = ?)
                 OR (m.author_id = ? AND m.partner_id = ?)
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1`
          )
          .get(me.id, p.id, p.id, me.id);

        const unreadRow = await db
          .prepare(
            `SELECT COUNT(*) AS c FROM chat_messages
              WHERE author_id = ? AND partner_id = ? AND read_at IS NULL`
          )
          .get(p.id, me.id);

        return {
          partnerId: p.id,
          name: p.name,
          role: p.role,
          roleLabel: ROLE_LABEL[p.role],
          team: p.team,
          title: p.title,
          relation:
            p.role === 'ceo'
              ? 'The CEO'
              : p.role === 'admin'
                ? me.role === 'ceo'
                  ? 'Your manager'
                  : 'Your manager — everything you submit comes here'
                : 'Reports to you',
          lastBody: last ? last.body : null,
          lastAt: last ? last.created_at : null,
          lastFromMe: last ? last.author_id === me.id : null,
          unread: unreadRow.c,
        };
      })
    );

    threads.sort(
      (a, b) =>
        b.unread - a.unread ||
        String(b.lastAt || '').localeCompare(String(a.lastAt || '')) ||
        a.name.localeCompare(b.name)
    );

    res.json({
      threads,
      unreadTotal: threads.reduce((n, t) => n + t.unread, 0),
      rule:
        me.role === 'admin'
          ? 'You are the middle of the line: the CEO above, your team below.'
          : me.role === 'ceo'
            ? 'You talk to your manager. Their team talks to them.'
            : 'You talk to your manager. They take it up from there.',
    });
  })
);

// --- one thread ------------------------------------------------------------

router.get(
  '/with/:userId',
  wrap(async (req, res) => {
    const other = await loadPerson(req.params.userId);
    if (!other) return res.status(404).json({ error: 'No such person' });
    if (!canTalk(req.user, other)) {
      return res.status(403).json({
        error:
          other.role === req.user.role
            ? 'Messages travel up and down the line, not sideways. Send this to your manager.'
            : 'That would skip a rung. Send it to your manager and they will carry it up.',
      });
    }

    await db
      .prepare(
        `UPDATE chat_messages SET read_at = ?
          WHERE author_id = ? AND partner_id = ? AND read_at IS NULL`
      )
      .run(nowSql(), other.id, req.user.id);

    const messages = await conversation(req.user.id, other.id);
    res.json({
      partner: {
        id: other.id,
        name: other.name,
        role: other.role,
        roleLabel: ROLE_LABEL[other.role],
        team: other.team,
        title: other.title,
        isActive: Boolean(other.is_active),
      },
      messages: await Promise.all(messages.map((m) => shape(m, req.user.id))),
    });
  })
);

router.post(
  '/with/:userId',
  wrap(async (req, res) => {
    const other = await loadPerson(req.params.userId);
    if (!other) return res.status(404).json({ error: 'No such person' });
    if (!canTalk(req.user, other)) {
      return res.status(403).json({ error: 'You cannot open a thread with that person' });
    }
    if (!other.is_active) {
      return res.status(400).json({ error: `${other.name}'s account is deactivated` });
    }

    const body = String(req.body.body ?? '').trim();
    if (!body && !req.body.willAttach) bad('Write something first');
    if (body.length > MAX) bad(`Keep it under ${MAX} characters`);

    let taskId = null;
    if (req.body.taskId) {
      const t = await db.prepare('SELECT id, owner_id, created_by FROM tasks WHERE id = ?').get(req.body.taskId);
      if (!t) return res.status(400).json({ error: 'That task does not exist' });
      taskId = t.id;
    }

    const stamp = nowSql();
    const info = await db
      .prepare(
        `INSERT INTO chat_messages (author_id, partner_id, body, task_id, created_at)
         VALUES (?,?,?,?,?)`
      )
      .run(req.user.id, other.id, body, taskId, stamp);

    await notifyTask({
      userId: other.id,
      type: 'chat_message',
      severity: 'info',
      title: `Message from ${req.user.name}`,
      body: body ? (body.length > 140 ? `${body.slice(0, 137)}…` : body) : 'Sent you a file.',
      taskId,
      dedupeKey: `chat:${req.user.id}:${other.id}:${stamp.slice(0, 16)}`,
    });

    const row = await db
      .prepare(
        `SELECT m.*, u.name AS author_name, u.role AS author_role, t.name AS task_name
           FROM chat_messages m JOIN users u ON u.id = m.author_id
           LEFT JOIN tasks t ON t.id = m.task_id
          WHERE m.id = ?`
      )
      .get(info.lastInsertRowid);

    res.status(201).json({ message: await shape(row, req.user.id) });
  })
);

// --- files in a conversation ----------------------------------------------

const loadMessage = (id) => db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);

const partyTo = (message, user) =>
  message && (message.author_id === user.id || message.partner_id === user.id);

router.post(
  '/messages/:id/attachments',
  acceptFiles(),
  wrap(async (req, res) => {
    const message = await loadMessage(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'No such message' });
    }
    if (message.author_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only add files to your own messages' });
    }
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No file came through' });
    }

    const stamp = nowSql();
    for (const f of req.files) {
      const storedName = await storeFile(f);
      await db
        .prepare(
          `INSERT INTO chat_attachments
             (message_id, filename, stored_name, mime_type, size_bytes, uploaded_by, created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(message.id, f.originalname || storedName, storedName, f.mimetype || null, f.size, req.user.id, stamp);
    }

    const row = await db
      .prepare(
        `SELECT m.*, u.name AS author_name, u.role AS author_role, t.name AS task_name
           FROM chat_messages m JOIN users u ON u.id = m.author_id
           LEFT JOIN tasks t ON t.id = m.task_id
          WHERE m.id = ?`
      )
      .get(message.id);
    res.status(201).json({ message: await shape(row, req.user.id) });
  })
);

router.get(
  '/attachments/:id',
  wrap(async (req, res) => {
    const file = await db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const message = await loadMessage(file.message_id);
    if (!partyTo(message, req.user)) {
      return res.status(403).json({ error: 'That file is not in one of your conversations' });
    }
    return sendStoredFile(res, file, { inline: req.query.inline === 'true' });
  })
);

router.delete(
  '/attachments/:id',
  wrap(async (req, res) => {
    const file = await db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the person who sent it can remove it' });
    }
    await db.prepare('DELETE FROM chat_attachments WHERE id = ?').run(file.id);
    await removeStoredFile(file.stored_name);
    res.json({ ok: true });
  })
);

export default router;
