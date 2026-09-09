/**
 * The breakdown, as routes.
 *
 * Shaped like `attachments.js` on purpose — `/steps/task/:taskId` to add one,
 * `/steps/:id` to work on one — because both answer the same question ("what
 * hangs off this task?") and there is no reason for a reader to learn two
 * layouts.
 *
 * The rules about who may tick, change or remove a step live in
 * `services/steps.js` next to the reasoning for them. This file is about
 * loading, guarding, writing and telling people.
 *
 * Vercel/Turso edition: same routes and the same rules as the on-prem
 * edition. What changed — every handler is `async`, every query is `await`ed,
 * `canViewTask` is `await`ed (it now touches the database, via a step-owner
 * check), and the reorder endpoint's reordering loop uses `withTransaction`
 * from db/index.js instead of better-sqlite3's synchronous `db.transaction()`.
 */
import { Router } from 'express';
import { db, nowSql, withTransaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap, requireFields, oneOf, isoDate, bad } from '../lib/validate.js';
import { can, canViewTask } from '../access.js';
import { record } from '../services/workflow.js';
import { notifyTask } from '../services/alerts.js';
import {
  KINDS,
  KIND_LABEL,
  KIND_NOTE,
  canAddSteps,
  loadStep,
  nextPosition,
  shapeStep,
  stepsFor,
  myOpenSteps,
  stepDateCap,
} from '../services/steps.js';

const router = Router();
router.use(requireAuth);

const loadTask = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

/** The task a step belongs to, with the usual can-you-see-it guard. */
async function taskOfStep(step, user) {
  const task = await loadTask(step.task_id);
  return task && (await canViewTask(user, task)) ? task : null;
}

const MAX_NAME = 200;

/** Shared validation, so adding and editing cannot drift apart. */
async function readStepFields(body, task, { partial = false, existing = null } = {}) {
  const out = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim();
    if (name.length < 3) bad('Give the step a name somebody will recognise later');
    if (name.length > MAX_NAME) bad(`Keep the name under ${MAX_NAME} characters`);
    out.name = name;
  }

  if (body.kind !== undefined) {
    oneOf(body.kind, KINDS, 'kind');
    out.kind = body.kind;
  } else if (!partial) {
    out.kind = 'step';
  }

  if (body.ownerId !== undefined) {
    const owner = await db
      .prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1')
      .get(body.ownerId);
    if (!owner) return bad('Pick an active person to do this step');
    out.owner_id = owner.id;
  } else if (!partial) {
    // Left blank, a step belongs to whoever owns the task. That is the common
    // case by a wide margin, so it is the default rather than a required field.
    out.owner_id = task.owner_id;
  }

  if (body.dueDate !== undefined) {
    out.due_date = body.dueDate ? isoDate(body.dueDate, 'dueDate') : null;
  } else if (!partial) {
    out.due_date = null;
  }

  /**
   * A step cannot be due after the task is due.
   *
   * A piece of the work outlasting the whole is not a plan, it is a promise
   * nobody can keep — so this is a refusal, not a warning. Follow-ups are
   * exempt and must be: a check-back a fortnight after delivery is the entire
   * point of them.
   */
  // On an edit the kind may not be in the body at all, and defaulting to
  // 'step' there would cap an existing follow-up by a rule it is exempt from.
  const kindNow = out.kind ?? existing?.kind ?? 'step';
  // The date to test is the one the step will have, which on an edit that only
  // changes the kind is the date it already has — otherwise a follow-up dated
  // past the task could be turned into a step and slip through the rule.
  const dateNow = out.due_date !== undefined ? out.due_date : (existing?.due_date ?? null);
  const cap = stepDateCap(task, kindNow);
  if (cap && dateNow && dateNow > cap) {
    bad(
      `A step cannot be due after the task itself (${cap}). ` +
        `Move the task's completion date first, or make this a follow-up — ` +
        `follow-ups are meant to sit after delivery.`
    );
  }

  /**
   * Every step and follow-up needs a date — without one there is nothing for
   * "late" to mean, and no answer to "by when?" (Follow-ups are still exempt
   * from the completion-date cap above; they just cannot be dateless too.)
   */
  if (!dateNow) {
    bad(
      kindNow === 'follow_up'
        ? 'Give this follow-up a date to check back on'
        : 'Give this step a date to be done by'
    );
  }

  if (body.note !== undefined) {
    out.note = body.note ? String(body.note).trim() : null;
  } else if (!partial) {
    out.note = null;
  }

  return out;
}

// --- what is on my plate ---------------------------------------------------

/**
 * My open steps, including the ones on other people's tasks.
 *
 * This is the whole reason a step may be handed to somebody who does not own
 * the parent: without it, that step would exist somewhere they never look.
 */
router.get(
  '/mine',
  wrap(async (req, res) => {
    const steps = await myOpenSteps(req.user.id, { limit: Number(req.query.limit) || 25 });
    res.json({
      steps,
      // Split out because they answer different questions: "what is left of my
      // own work" and "what am I holding up for somebody else".
      onOthers: steps.filter((s) => s.onSomebodyElsesTask).length,
      kinds: KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], note: KIND_NOTE[k] })),
    });
  })
);

// --- add -------------------------------------------------------------------

router.post(
  '/task/:taskId',
  wrap(async (req, res) => {
    const task = await loadTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!(await canViewTask(req.user, task))) return res.status(403).json({ error: 'No access to that task' });
    if (!canAddSteps(task, req.user, can)) {
      return res.status(403).json({
        error:
          task.status === 'cancelled'
            ? 'This task is cancelled — nothing more to break down'
            : 'Only the person doing the task, or the manager, can break it down',
      });
    }

    requireFields(req.body, ['name']);
    const fields = await readStepFields(req.body, task);
    const stamp = nowSql();

    const info = await db
      .prepare(
        `INSERT INTO task_steps
           (task_id, name, kind, owner_id, due_date, note, position, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        task.id,
        fields.name,
        fields.kind,
        fields.owner_id,
        fields.due_date,
        fields.note,
        await nextPosition(task.id),
        req.user.id,
        stamp,
        stamp
      );

    await record({
      taskId: task.id,
      actorId: req.user.id,
      action: 'step_added',
      from: task.status,
      to: task.status,
      note:
        `${KIND_LABEL[fields.kind]}: ${fields.name}` +
        (fields.due_date ? ` — by ${fields.due_date}` : '') +
        (fields.owner_id !== task.owner_id ? ' (assigned to somebody else)' : ''),
    });

    // Somebody handed a piece of work needs to hear about it, exactly as they
    // would for a whole task.
    if (fields.owner_id !== req.user.id) {
      await notifyTask({
        userId: fields.owner_id,
        type: 'step_assigned',
        severity: 'info',
        title: `${KIND_LABEL[fields.kind]} for you: ${fields.name}`,
        body:
          `${req.user.name} added this under "${task.name}"` +
          (fields.due_date ? `, by ${fields.due_date}.` : '.'),
        taskId: task.id,
        dedupeKey: `step-assigned:${info.lastInsertRowid}:${fields.owner_id}`,
      });
    }

    res.status(201).json({
      step: shapeStep(await loadStep(info.lastInsertRowid), task, req.user, can),
      steps: await stepsFor(task, req.user, can),
    });
  })
);

// --- change ----------------------------------------------------------------

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const step = await loadStep(req.params.id);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    const task = await taskOfStep(step, req.user);
    if (!task) return res.status(403).json({ error: 'No access to that step' });

    const a = shapeStep(step, task, req.user, can);
    if (!a.canEditStep) {
      return res.status(403).json({
        error: 'Only the person doing the task, or the manager, can change a step',
      });
    }

    const fields = await readStepFields(req.body, task, { partial: true, existing: step });
    const keys = Object.keys(fields);
    if (!keys.length) return res.status(400).json({ error: 'Nothing to change' });

    const stamp = nowSql();
    await db
      .prepare(`UPDATE task_steps SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), stamp, step.id);

    // Only the changes worth a line in the task's story. A note being reworded
    // is not one of them.
    const said = [];
    if (fields.name !== undefined && fields.name !== step.name) said.push(`renamed to "${fields.name}"`);
    if (fields.due_date !== undefined && fields.due_date !== step.due_date) {
      said.push(fields.due_date ? `date → ${fields.due_date}` : 'date cleared');
    }
    if (fields.kind !== undefined && fields.kind !== step.kind) {
      said.push(`now a ${KIND_LABEL[fields.kind].toLowerCase()}`);
    }
    let handedTo = null;
    if (fields.owner_id !== undefined && fields.owner_id !== step.owner_id) {
      handedTo = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(fields.owner_id);
      said.push(`handed to ${handedTo.name}`);
    }

    if (said.length) {
      await record({
        taskId: task.id,
        actorId: req.user.id,
        action: 'step_changed',
        from: task.status,
        to: task.status,
        note: `${step.name}: ${said.join(', ')}`,
      });
    }

    if (handedTo && handedTo.id !== req.user.id) {
      await notifyTask({
        userId: handedTo.id,
        type: 'step_assigned',
        severity: 'info',
        title: `${KIND_LABEL[fields.kind || step.kind]} for you: ${fields.name || step.name}`,
        body: `${req.user.name} moved this to you, under "${task.name}".`,
        taskId: task.id,
        dedupeKey: `step-assigned:${step.id}:${handedTo.id}:${stamp}`,
      });
    }

    const fresh = await loadStep(step.id);
    res.json({
      step: shapeStep(fresh, task, req.user, can),
      steps: await stepsFor(task, req.user, can),
    });
  })
);

// --- tick and untick -------------------------------------------------------

/** Both directions through one place, so the history can never miss one. */
async function setDone(req, res, done) {
  const step = await loadStep(req.params.id);
  if (!step) return res.status(404).json({ error: 'Step not found' });
  const task = await taskOfStep(step, req.user);
  if (!task) return res.status(403).json({ error: 'No access to that step' });

  const a = shapeStep(step, task, req.user, can);
  if (done && !a.canTick) {
    if (step.done_at) return res.status(409).json({ error: 'That step is already done' });
    return res.status(403).json({
      error: `Only ${step.owner_name}, or the manager, can tick this off`,
    });
  }
  if (!done && !a.canUntick) {
    if (!step.done_at) return res.status(409).json({ error: 'That step is not done yet' });
    return res.status(403).json({ error: `Only ${step.owner_name}, or the manager, can reopen this` });
  }

  const stamp = nowSql();
  await db.prepare('UPDATE task_steps SET done_at = ?, done_by = ?, updated_at = ? WHERE id = ?').run(
    done ? stamp : null,
    done ? req.user.id : null,
    stamp,
    step.id
  );

  await record({
    taskId: task.id,
    actorId: req.user.id,
    action: done ? 'step_done' : 'step_undone',
    from: task.status,
    to: task.status,
    note: step.name,
  });

  // The person who planned the work hears when somebody else finishes a piece
  // of it — one line, and only when it is not their own tick.
  if (done && task.owner_id !== req.user.id) {
    await notifyTask({
      userId: task.owner_id,
      type: 'step_done',
      severity: 'info',
      title: `Step done: ${step.name}`,
      body: `${req.user.name} finished this under "${task.name}".`,
      taskId: task.id,
      dedupeKey: `step-done:${step.id}`,
    });
  }

  return res.json({
    step: shapeStep(await loadStep(step.id), task, req.user, can),
    steps: await stepsFor(task, req.user, can),
  });
}

router.post('/:id/done', wrap((req, res) => setDone(req, res, true)));
router.post('/:id/undone', wrap((req, res) => setDone(req, res, false)));

// --- order -----------------------------------------------------------------

router.post(
  '/task/:taskId/order',
  wrap(async (req, res) => {
    const task = await loadTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!(await canViewTask(req.user, task))) return res.status(403).json({ error: 'No access to that task' });
    if (!canAddSteps(task, req.user, can)) {
      return res.status(403).json({ error: 'Only the person doing the task, or the manager, can reorder it' });
    }
    if (!Array.isArray(req.body.ids)) bad('Send the step ids in the order you want them');

    // Only ids that really belong to this task, so a reorder cannot be used to
    // reach across tasks.
    const rows = await db.prepare('SELECT id FROM task_steps WHERE task_id = ?').all(task.id);
    const mine = new Set(rows.map((r) => r.id));
    const stamp = nowSql();

    await withTransaction(async (txDb) => {
      const update = txDb.prepare('UPDATE task_steps SET position = ?, updated_at = ? WHERE id = ?');
      let n = 0;
      for (const id of req.body.ids) {
        if (mine.has(Number(id))) await update.run(n++, stamp, Number(id));
      }
    });

    res.json({ steps: await stepsFor(task, req.user, can) });
  })
);

// --- remove ----------------------------------------------------------------

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const step = await loadStep(req.params.id);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    const task = await taskOfStep(step, req.user);
    if (!task) return res.status(403).json({ error: 'No access to that step' });

    const a = shapeStep(step, task, req.user, can);
    if (!a.canRemoveStep) {
      return res.status(403).json({
        error: 'Only the person doing the task, or the manager, can remove a step',
      });
    }

    await db.prepare('DELETE FROM task_steps WHERE id = ?').run(step.id);
    // Recorded rather than silently gone: "there used to be a step for this"
    // is a question somebody asks eventually.
    await record({
      taskId: task.id,
      actorId: req.user.id,
      action: 'step_removed',
      from: task.status,
      to: task.status,
      note: step.done_at ? `${step.name} (it had been ticked off)` : step.name,
    });

    res.json({ ok: true, steps: await stepsFor(task, req.user, can) });
  })
);

export default router;
