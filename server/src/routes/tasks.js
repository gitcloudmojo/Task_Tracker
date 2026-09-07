/**
 * Tasks, and the four moves that carry one through its life:
 * submit, verify, approve, return.
 *
 * Same logic as the on-prem edition. What changed for Vercel/Turso: every
 * handler is `async`, every query is `await`ed, `shape()` is now `async`
 * (because `actionsFor` touches the database), and the one place atomicity
 * actually matters — a transition's status update landing together with its
 * history row — uses `withTransaction` from db/index.js instead of
 * better-sqlite3's synchronous `db.transaction()`.
 */
import { Router } from 'express';
import { db, nowSql, today, withTransaction } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap, requireFields, oneOf, isoDate, bad } from '../lib/validate.js';
import { can, taskScope, canViewTask, ownOnly } from '../access.js';
import {
  STATUS_LABEL,
  WAITING_ON,
  OPEN_STATUSES,
  actionsFor,
  daysToDue,
  overdueState,
  verifyCompletesTask,
  hasOtherChecker,
  record,
  history,
} from '../services/workflow.js';
import { notifyTask } from '../services/alerts.js';

const router = Router();
router.use(requireAuth);

const PRIORITIES = ['high', 'normal'];

const SELECT = `
  SELECT t.*,
         o.name AS owner_name, o.team AS owner_team, o.role AS owner_role,
         c.name AS creator_name,
         v.name AS verifier_name,
         a.name AS approver_name,
         r.name AS returner_name,
         (SELECT COUNT(*) FROM attachments x WHERE x.task_id = t.id) AS attachment_count
    FROM tasks t
    JOIN users o      ON o.id = t.owner_id
    JOIN users c      ON c.id = t.created_by
    LEFT JOIN users v ON v.id = t.verified_by
    LEFT JOIN users a ON a.id = t.approved_by
    LEFT JOIN users r ON r.id = t.returned_by`;

async function shape(t, user) {
  const od = overdueState(t);
  return {
    id: t.id,
    name: t.name,
    clientName: t.client_name,
    ownerId: t.owner_id,
    ownerName: t.owner_name,
    ownerTeam: t.owner_team,
    completionDate: t.completion_date,
    priority: t.priority,
    notes: t.notes,
    status: t.status,
    statusLabel: STATUS_LABEL[t.status],
    waitingOn: WAITING_ON[t.status],
    createdById: t.created_by,
    creatorName: t.creator_name,
    submittedAt: t.submitted_at,
    submittedNote: t.submitted_note,
    verifiedAt: t.verified_at,
    verifierName: t.verifier_name,
    verifiedNote: t.verified_note,
    approvedAt: t.approved_at,
    approverName: t.approver_name,
    approvedNote: t.approved_note,
    returnedAt: t.returned_at,
    returnerName: t.returner_name,
    returnReason: t.return_reason,
    returnCount: t.return_count,
    cancelledAt: t.cancelled_at,
    cancelReason: t.cancel_reason,
    reassignedAt: t.reassigned_at,
    reassignCount: t.reassign_count,
    attachmentCount: t.attachment_count,
    daysToDue: daysToDue(t.completion_date),
    isOverdue: od.overdue,
    lateSide: od.lateSide,
    mine: t.owner_id === user.id,
    createdAt: t.created_at,
    ...(await actionsFor(t, user, can)),
  };
}

const load = (id) => db.prepare(`${SELECT} WHERE t.id = ?`).get(id);

// --- list ------------------------------------------------------------------

router.get(
  '/',
  wrap(async (req, res) => {
    const S = taskScope(req.user);
    const where = [S.sql];
    const params = [...S.params];

    if (req.query.mine === 'true') {
      where.push('t.owner_id = ?');
      params.push(req.user.id);
    }
    if (req.query.ownerId) {
      where.push('t.owner_id = ?');
      params.push(Number(req.query.ownerId));
    }
    if (req.query.status) {
      const list = String(req.query.status).split(',');
      for (const s of list) oneOf(s, Object.keys(STATUS_LABEL), 'status');
      where.push(`t.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (req.query.open === 'true') {
      where.push(`t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
      params.push(...OPEN_STATUSES);
    }
    if (req.query.priority) {
      oneOf(req.query.priority, PRIORITIES, 'priority');
      where.push('t.priority = ?');
      params.push(req.query.priority);
    }
    if (req.query.client) {
      where.push('t.client_name = ?');
      params.push(req.query.client);
    }
    if (req.query.team) {
      where.push('o.team = ?');
      params.push(req.query.team);
    }
    const wantOverdue = req.query.overdue === 'true';

    if (req.query.q) {
      where.push("(t.name LIKE ? ESCAPE '\\' OR t.client_name LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
      const like = `%${String(req.query.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like, like);
    }

    const limit = Number(req.query.limit);
    let rows = await db
      .prepare(
        `${SELECT} WHERE ${where.join(' AND ')}
          ORDER BY
            CASE t.status WHEN 'open' THEN 0 WHEN 'submitted' THEN 1 WHEN 'verified' THEN 2
                          WHEN 'approved' THEN 3 ELSE 4 END,
            t.priority = 'normal',
            t.completion_date
          LIMIT ?`
      )
      .all(...params, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200);

    if (wantOverdue) rows = rows.filter((r) => overdueState(r).overdue);

    res.json({
      tasks: await Promise.all(rows.map((t) => shape(t, req.user))),
      canCreate: can(req.user, 'tasks.create'),
      ownOnly: ownOnly(req.user),
    });
  })
);

router.get(
  '/clients',
  wrap(async (req, res) => {
    const S = taskScope(req.user);
    const rows = await db
      .prepare(
        `SELECT t.client_name AS name, COUNT(*) AS tasks
           FROM tasks t JOIN users o ON o.id = t.owner_id
          WHERE ${S.sql} GROUP BY t.client_name ORDER BY tasks DESC, name`
      )
      .all(...S.params);
    res.json({ clients: rows });
  })
);

router.get(
  '/queue',
  wrap(async (req, res) => {
    const out = { toDo: [], toVerify: [], toApprove: [] };

    const toDoRows = await db
      .prepare(`${SELECT} WHERE t.owner_id = ? AND t.status = 'open' ORDER BY t.completion_date`)
      .all(req.user.id);
    out.toDo = await Promise.all(toDoRows.map((t) => shape(t, req.user)));

    if (can(req.user, 'tasks.verify')) {
      const rows = await db
        .prepare(`${SELECT} WHERE t.status = 'submitted' AND t.owner_id <> ? ORDER BY t.submitted_at`)
        .all(req.user.id);
      const shaped = await Promise.all(rows.map((t) => shape(t, req.user)));
      out.toVerify = shaped.filter((t) => t.canVerify);
    }
    if (can(req.user, 'tasks.approve')) {
      const rows = await db
        .prepare(`${SELECT} WHERE t.status = 'verified' AND t.owner_id <> ? ORDER BY t.verified_at`)
        .all(req.user.id);
      out.toApprove = await Promise.all(rows.map((t) => shape(t, req.user)));
    }
    res.json(out);
  })
);

// --- one task ---------------------------------------------------------------

router.get(
  '/:id',
  wrap(async (req, res) => {
    const t = await load(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (!canViewTask(req.user, t)) return res.status(403).json({ error: 'No access to that task' });

    const attachmentRows = await db
      .prepare(
        `SELECT a.*, u.name AS uploader_name FROM attachments a
           JOIN users u ON u.id = a.uploaded_by
          WHERE a.task_id = ? ORDER BY a.created_at`
      )
      .all(t.id);
    const attachments = attachmentRows.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      uploaderName: a.uploader_name,
      uploadedById: a.uploaded_by,
      createdAt: a.created_at,
      canDelete: a.uploaded_by === req.user.id || can(req.user, 'tasks.edit'),
    }));

    res.json({ task: await shape(t, req.user), attachments, history: await history(t.id) });
  })
);

// --- create ----------------------------------------------------------------

router.post(
  '/',
  requirePermission('tasks.create'),
  wrap(async (req, res) => {
    requireFields(req.body, ['name', 'clientName', 'ownerId', 'completionDate']);
    oneOf(req.body.priority, PRIORITIES, 'priority');

    const owner = await db
      .prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1')
      .get(req.body.ownerId);
    if (!owner) return res.status(400).json({ error: 'Pick an active person to own this' });

    const completionDate = isoDate(req.body.completionDate, 'completionDate');
    if (completionDate < today()) bad('The completion date cannot be in the past');

    const name = String(req.body.name).trim();
    if (name.length < 3) bad('Give the task a name somebody will recognise later');

    const stamp = nowSql();
    const info = await db
      .prepare(
        `INSERT INTO tasks
           (name, client_name, owner_id, completion_date, priority, notes,
            created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        name,
        String(req.body.clientName).trim(),
        owner.id,
        completionDate,
        req.body.priority || 'normal',
        req.body.notes ? String(req.body.notes).trim() : null,
        req.user.id,
        stamp,
        stamp
      );

    const id = info.lastInsertRowid;
    await record({
      taskId: id,
      actorId: req.user.id,
      action: 'created',
      to: 'open',
      note: `Assigned to ${owner.name}, due ${completionDate}`,
    });

    if (owner.id !== req.user.id) {
      await notifyTask({
        userId: owner.id,
        type: 'task_assigned',
        severity: req.body.priority === 'high' ? 'warning' : 'info',
        title: `New task: ${name}`,
        body: `${req.user.name} assigned this to you for ${req.body.clientName}. Due ${completionDate}.`,
        taskId: id,
        dedupeKey: `assigned:${id}:${owner.id}`,
      });
    }

    res.status(201).json({ task: await shape(await load(id), req.user) });
  })
);

// --- edit ------------------------------------------------------------------

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const existing = await load(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!canViewTask(req.user, existing)) {
      return res.status(403).json({ error: 'No access to that task' });
    }

    const a = await actionsFor(existing, req.user, can);
    const sets = [];
    const params = [];
    const changes = [];
    const stampNow = nowSql();
    let reassignment = null;

    const notesOnly = Object.keys(req.body).every((k) => k === 'notes');
    if (!a.canEdit && !(notesOnly && existing.owner_id === req.user.id)) {
      return res.status(403).json({ error: 'You cannot change that task' });
    }

    if (req.body.notes !== undefined) {
      sets.push('notes = ?');
      params.push(req.body.notes ? String(req.body.notes).trim() : null);
    }

    if (a.canEdit) {
      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 3) bad('Give the task a name somebody will recognise later');
        sets.push('name = ?');
        params.push(name);
        changes.push('name');
      }
      if (req.body.clientName !== undefined) {
        sets.push('client_name = ?');
        params.push(String(req.body.clientName).trim());
        changes.push('client');
      }
      if (req.body.priority !== undefined) {
        oneOf(req.body.priority, PRIORITIES, 'priority');
        sets.push('priority = ?');
        params.push(req.body.priority);
        changes.push(`priority → ${req.body.priority}`);
      }
      if (req.body.completionDate !== undefined) {
        const dd = isoDate(req.body.completionDate, 'completionDate');
        sets.push('completion_date = ?');
        params.push(dd);
        changes.push(`due date → ${dd}`);
      }
      if (req.body.ownerId !== undefined && Number(req.body.ownerId) !== existing.owner_id) {
        if (!a.canReassign) {
          return res.status(403).json({ error: 'Your role cannot reassign tasks' });
        }
        const owner = await db
          .prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1')
          .get(req.body.ownerId);
        if (!owner) return res.status(400).json({ error: 'Pick an active person' });

        const wasSubmitted = existing.status === 'submitted';

        sets.push('owner_id = ?', 'reassigned_at = ?', 'reassign_count = ?');
        params.push(owner.id, stampNow, existing.reassign_count + 1);
        if (wasSubmitted) {
          sets.push('status = ?', 'submitted_at = ?', 'submitted_note = ?');
          params.push('open', null, null);
        }

        reassignment = {
          from: existing.owner_name,
          fromId: existing.owner_id,
          to: owner.name,
          toId: owner.id,
          reason: req.body.reassignReason ? String(req.body.reassignReason).trim() : null,
          wasSubmitted,
        };
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = ?');
    params.push(stampNow, existing.id);
    await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (changes.length) {
      await record({
        taskId: existing.id,
        actorId: req.user.id,
        action: 'edited',
        from: existing.status,
        to: existing.status,
        note: changes.join(', '),
      });
    }

    if (reassignment) {
      await record({
        taskId: existing.id,
        actorId: req.user.id,
        action: 'reassigned',
        from: existing.status,
        to: reassignment.wasSubmitted ? 'open' : existing.status,
        note:
          `From ${reassignment.from} to ${reassignment.to}` +
          (reassignment.reason ? ` — ${reassignment.reason}` : '') +
          (reassignment.wasSubmitted ? ' (it was marked done, so it is open again)' : ''),
      });

      await notifyTask({
        userId: reassignment.toId,
        type: 'task_reassigned',
        severity: 'info',
        title: `Handed to you: ${existing.name}`,
        body:
          `${req.user.name} moved this from ${reassignment.from} to you. ` +
          `Due ${existing.completion_date}.` +
          (reassignment.reason ? ` "${reassignment.reason}"` : ''),
        taskId: existing.id,
        dedupeKey: `reassigned-to:${existing.id}:${reassignment.toId}:${stampNow}`,
      });

      if (reassignment.fromId !== req.user.id) {
        await notifyTask({
          userId: reassignment.fromId,
          type: 'task_reassigned',
          severity: 'info',
          title: `Moved off your list: ${existing.name}`,
          body:
            `${req.user.name} reassigned this to ${reassignment.to}.` +
            (reassignment.reason ? ` "${reassignment.reason}"` : ''),
          taskId: existing.id,
          dedupeKey: `reassigned-from:${existing.id}:${reassignment.fromId}:${stampNow}`,
        });
      }
    }

    res.json({ task: await shape(await load(existing.id), req.user) });
  })
);

// --- the four moves --------------------------------------------------------

async function transition(req, res, { action, allow, apply, prepare, event, notify }) {
  const existing = await load(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  if (!canViewTask(req.user, existing)) {
    return res.status(403).json({ error: 'No access to that task' });
  }
  const a = await actionsFor(existing, req.user, can);
  const refusal = allow(a, existing, req.user);
  if (refusal) return res.status(refusal.status).json({ error: refusal.error });

  const note = req.body.note ? String(req.body.note).trim() : null;
  const stamp = nowSql();
  // A handful of transitions need one more piece of async context before
  // `apply` (a pure, synchronous function) can decide what to write —
  // `prepare` computes it and it is merged into apply's argument.
  const extra = prepare ? await prepare({ existing, user: req.user }) : undefined;
  const next = apply({ existing, user: req.user, note, stamp, ...extra });

  await withTransaction(async (txDb) => {
    const sets = Object.keys(next.set);
    await txDb
      .prepare(`UPDATE tasks SET ${sets.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map((k) => next.set[k]), stamp, existing.id);
    await record(
      {
        taskId: existing.id,
        actorId: req.user.id,
        action: event || action,
        from: existing.status,
        to: next.set.status || existing.status,
        note,
      },
      txDb
    );
  });

  const fresh = await load(existing.id);
  if (notify) await notify({ existing, fresh, user: req.user, note });
  res.json({ task: await shape(fresh, req.user) });
}

router.post(
  '/:id/submit',
  wrap((req, res) =>
    transition(req, res, {
      action: 'submitted',
      allow: (a, t, u) => {
        if (a.canSubmit) return null;
        if (t.owner_id !== u.id) {
          return {
            status: 403,
            error:
              'Only the person who owns a task can submit it. That is the point of the two checks that follow.',
          };
        }
        return { status: 409, error: `This task is already ${STATUS_LABEL[t.status].toLowerCase()}` };
      },
      apply: ({ note, stamp }) => ({
        set: {
          status: 'submitted',
          submitted_at: stamp,
          submitted_note: note,
          returned_at: null,
          returned_by: null,
          return_reason: null,
        },
      }),
      notify: async ({ fresh, user }) => {
        const checkers = (await hasOtherChecker(fresh.owner_id))
          ? await db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'admin' AND id <> ?").all(user.id)
          : await db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'ceo' AND id <> ?").all(user.id);

        for (const v of checkers) {
          await notifyTask({
            userId: v.id,
            type: 'task_submitted',
            severity: 'info',
            title: `To check: ${fresh.name}`,
            body: `${user.name} marked this done for ${fresh.client_name}.`,
            taskId: fresh.id,
            dedupeKey: `submitted:${fresh.id}:${v.id}:${fresh.submitted_at}`,
          });
        }
      },
    })
  )
);

router.post(
  '/:id/verify',
  wrap((req, res) =>
    transition(req, res, {
      action: 'verified',
      allow: (a, t, u) => {
        if (a.canVerify) return null;
        if (t.owner_id === u.id) {
          return { status: 403, error: 'You cannot verify your own work' };
        }
        if (t.status !== 'submitted') {
          return { status: 409, error: `Nothing to verify — this task is ${t.status}` };
        }
        return { status: 403, error: 'Only the manager checks submitted work' };
      },
      prepare: async ({ existing }) => ({ completesTask: await verifyCompletesTask(existing) }),
      apply: ({ user, note, stamp, completesTask }) => {
        if (completesTask) {
          return {
            set: {
              status: 'approved',
              verified_at: stamp,
              verified_by: user.id,
              verified_note: note,
              approved_at: stamp,
              approved_by: user.id,
              approved_note: 'Completed on verification — the owner is the approver.',
            },
          };
        }
        return {
          set: { status: 'verified', verified_at: stamp, verified_by: user.id, verified_note: note },
        };
      },
      notify: async ({ fresh, user }) => {
        if (fresh.status === 'approved') {
          await notifyTask({
            userId: fresh.owner_id,
            type: 'task_approved',
            severity: 'info',
            title: `Approved: ${fresh.name}`,
            body: `${user.name} signed this off.`,
            taskId: fresh.id,
            dedupeKey: `approved:${fresh.id}`,
          });
          return;
        }
        const ceoRows = await db
          .prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'ceo' AND id <> ?")
          .all(fresh.owner_id);
        for (const c of ceoRows) {
          await notifyTask({
            userId: c.id,
            type: 'task_verified',
            severity: 'info',
            title: `Ready for approval: ${fresh.name}`,
            body: `${user.name} verified this. ${fresh.owner_name} did the work.`,
            taskId: fresh.id,
            dedupeKey: `verified:${fresh.id}:${c.id}:${fresh.verified_at}`,
          });
        }
        await notifyTask({
          userId: fresh.owner_id,
          type: 'task_verified',
          severity: 'info',
          title: `Verified: ${fresh.name}`,
          body: `${user.name} checked it over. Waiting on final approval.`,
          taskId: fresh.id,
          dedupeKey: `verified-owner:${fresh.id}:${fresh.verified_at}`,
        });
      },
    })
  )
);

router.post(
  '/:id/approve',
  wrap((req, res) =>
    transition(req, res, {
      action: 'approved',
      allow: (a, t, u) => {
        if (a.canApprove) return null;
        if (t.owner_id === u.id) {
          return { status: 403, error: 'You cannot approve your own work' };
        }
        if (t.status !== 'verified') {
          return {
            status: 409,
            error:
              t.status === 'submitted'
                ? 'Your manager needs to check this first'
                : `Nothing to approve — this task is ${t.status}`,
          };
        }
        return { status: 403, error: 'Only the CEO gives final approval' };
      },
      apply: ({ user, note, stamp }) => ({
        set: { status: 'approved', approved_at: stamp, approved_by: user.id, approved_note: note },
      }),
      notify: async ({ fresh, user }) => {
        await notifyTask({
          userId: fresh.owner_id,
          type: 'task_approved',
          severity: 'info',
          title: `Approved: ${fresh.name}`,
          body: `${user.name} signed this off.${fresh.approved_note ? ` "${fresh.approved_note}"` : ''}`,
          taskId: fresh.id,
          dedupeKey: `approved:${fresh.id}`,
        });
        if (fresh.verified_by && fresh.verified_by !== fresh.owner_id) {
          await notifyTask({
            userId: fresh.verified_by,
            type: 'task_approved',
            severity: 'info',
            title: `Approved: ${fresh.name}`,
            body: `${user.name} signed off the task you verified.`,
            taskId: fresh.id,
            dedupeKey: `approved-verifier:${fresh.id}`,
          });
        }
      },
    })
  )
);

router.post(
  '/:id/return',
  wrap(async (req, res) => {
    if (!req.body.note || String(req.body.note).trim().length < 5) {
      return res
        .status(400)
        .json({ error: 'Say what needs doing — a task sent back without a reason just stalls' });
    }
    return transition(req, res, {
      action: 'returned',
      allow: (a, t, u) => {
        if (a.canReturn) return null;
        if (t.owner_id === u.id) {
          return { status: 403, error: 'You cannot send your own task back to yourself' };
        }
        if (!['submitted', 'verified'].includes(t.status)) {
          return { status: 409, error: 'Only a submitted or verified task can be sent back' };
        }
        return { status: 403, error: 'Your role cannot send this back' };
      },
      apply: ({ existing, user, note, stamp }) => ({
        set: {
          status: 'open',
          returned_at: stamp,
          returned_by: user.id,
          return_reason: note,
          return_count: existing.return_count + 1,
          submitted_at: null,
          submitted_note: null,
          verified_at: null,
          verified_by: null,
          verified_note: null,
        },
      }),
      notify: async ({ fresh, user, note }) => {
        await notifyTask({
          userId: fresh.owner_id,
          type: 'task_returned',
          severity: 'warning',
          title: `Sent back: ${fresh.name}`,
          body: `${user.name}: "${note}"`,
          taskId: fresh.id,
          dedupeKey: `returned:${fresh.id}:${fresh.returned_at}`,
        });
      },
    });
  })
);

router.post(
  '/:id/cancel',
  requirePermission('tasks.cancel'),
  wrap((req, res) =>
    transition(req, res, {
      action: 'cancelled',
      allow: (a, t) => (a.canCancel ? null : { status: 409, error: `A ${t.status} task cannot be cancelled` }),
      apply: ({ note, stamp }) => ({
        set: { status: 'cancelled', cancelled_at: stamp, cancel_reason: note },
      }),
      notify: async ({ fresh, user, note }) => {
        if (fresh.owner_id === user.id) return;
        await notifyTask({
          userId: fresh.owner_id,
          type: 'task_cancelled',
          severity: 'info',
          title: `Cancelled: ${fresh.name}`,
          body: note ? `${user.name}: "${note}"` : `${user.name} cancelled this.`,
          taskId: fresh.id,
          dedupeKey: `cancelled:${fresh.id}`,
        });
      },
    })
  )
);

router.post(
  '/:id/reopen',
  requirePermission('tasks.reopen'),
  wrap((req, res) =>
    transition(req, res, {
      action: 'reopened',
      allow: (a, t) =>
        a.canReopen ? null : { status: 409, error: `Only an approved task can be reopened — this one is ${t.status}` },
      apply: ({ existing, user, note, stamp }) => ({
        set: {
          status: 'open',
          approved_at: null,
          approved_by: null,
          approved_note: null,
          verified_at: null,
          verified_by: null,
          verified_note: null,
          submitted_at: null,
          submitted_note: null,
          returned_at: stamp,
          returned_by: user.id,
          return_reason: note || 'Reopened after approval.',
          return_count: existing.return_count + 1,
        },
      }),
      notify: async ({ fresh, user, note }) => {
        await notifyTask({
          userId: fresh.owner_id,
          type: 'task_returned',
          severity: 'warning',
          title: `Reopened: ${fresh.name}`,
          body: note ? `${user.name}: "${note}"` : `${user.name} reopened this after approval.`,
          taskId: fresh.id,
          dedupeKey: `reopened:${fresh.id}:${fresh.returned_at}`,
        });
      },
    })
  )
);

export default router;
