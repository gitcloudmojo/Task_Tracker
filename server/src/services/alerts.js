/**
 * The nag engine — same three kinds of lateness as the on-prem edition
 * (the owner is late, a submission is stalled unverified, a verified task is
 * stalled unapproved), plus the breakdown's own two kinds (a step past its
 * date is late; a follow-up past its date is simply your turn), just
 * triggered differently.
 *
 * On-prem: an in-process `node-cron` schedule inside a long-running Node
 * process. There is no long-running process here — a Vercel serverless
 * function starts, handles a request, and stops — so the sweep is now
 * triggered by an HTTP hit on /api/cron/alerts, which Vercel Cron calls on
 * the schedule in vercel.json (see that file's comment about the Hobby-plan
 * once-a-day floor). `runAlertSweep` itself is unchanged in what it decides;
 * only how it gets invoked, and that every query in it is now awaited.
 */
import { db, nowSql, today } from '../db/index.js';
import { config } from '../config.js';
import { daysToDue } from './workflow.js';

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_due_soon',
  'task_overdue',
  'task_submitted',
  'task_verified',
  'task_approved',
  'task_returned',
  'task_cancelled',
  'review_stalled',
  'approval_stalled',
  'task_reassigned',
  'chat_message',
  // The breakdown. A step past its date is late; a follow-up past its date is
  // simply your turn — see services/steps.js for why that distinction is kept
  // all the way out to the wording of the alert.
  'step_assigned',
  'step_done',
  'step_due_soon',
  'step_overdue',
  'follow_up_due',
  'steps_slipping',
];

export async function notifyTask(n) {
  if (!NOTIFICATION_TYPES.includes(n.type)) {
    console.warn(`[alerts] unknown notification type "${n.type}"`);
  }
  const info = await db
    .prepare(
      `INSERT OR IGNORE INTO notifications
         (user_id, type, severity, title, body, task_id, dedupe_key, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      n.userId,
      n.type,
      n.severity || 'info',
      n.title,
      n.body || null,
      n.taskId ?? null,
      n.dedupeKey,
      nowSql()
    );
  return info.changes > 0;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const ageInDays = (ts) =>
  ts ? Math.floor((Date.now() - new Date(`${ts.replace(' ', 'T')}Z`).getTime()) / 86_400_000) : 0;

const admins = () => db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'admin'").all();
const ceos = () => db.prepare("SELECT id FROM users WHERE is_active = 1 AND role = 'ceo'").all();

export async function runAlertSweep({ verbose = false } = {}) {
  const stamp = today();
  const created = {
    dueSoon: 0,
    overdue: 0,
    reviewStalled: 0,
    approvalStalled: 0,
    stepsDueSoon: 0,
    stepsOverdue: 0,
    followUps: 0,
    slipping: 0,
  };

  const live = await db
    .prepare(
      `SELECT t.*, o.name AS owner_name, o.reminder_days_before AS owner_lead
         FROM tasks t JOIN users o ON o.id = t.owner_id
        WHERE t.status IN ('open','submitted','verified')`
    )
    .all();

  for (const t of live) {
    const days = daysToDue(t.completion_date);

    if (days < 0) {
      const late = Math.abs(days);
      const blame = t.status === 'open' ? 'owner' : t.status === 'submitted' ? 'verifier' : 'approver';

      if (blame === 'owner') {
        if (
          await notifyTask({
            userId: t.owner_id,
            type: 'task_overdue',
            severity: late >= 3 ? 'critical' : 'warning',
            title: `Overdue: ${t.name}`,
            body: `Due ${t.completion_date} — ${plural(late, 'day')} late for ${t.client_name}.`,
            taskId: t.id,
            dedupeKey: `overdue:${t.id}:${t.owner_id}:${stamp}`,
          })
        ) {
          created.overdue++;
        }
      }

      /**
       * How many pieces of this late task are themselves late. Folded into the
       * one alert the manager already gets rather than sent as a second: two
       * alerts about one problem is how people learn to ignore both.
       */
      const lateInside = (
        await db
          .prepare(
            `SELECT COUNT(*) AS c FROM task_steps
              WHERE task_id = ? AND done_at IS NULL AND kind = 'step'
                AND due_date IS NOT NULL AND due_date < ?`
          )
          .get(t.id, stamp)
      ).c;

      // An admin hears about everything late, whoever is holding it, because
      // chasing it is their job either way.
      for (const a of await admins()) {
        if (a.id === t.owner_id && blame === 'owner') continue;
        await notifyTask({
          userId: a.id,
          type: 'task_overdue',
          severity: late >= 3 ? 'critical' : 'warning',
          title: `${plural(late, 'day')} late: ${t.name}`,
          body:
            (blame === 'owner'
              ? `${t.owner_name} has not finished it. ${t.client_name}.`
              : blame === 'verifier'
                ? `Submitted and waiting on a verification. ${t.client_name}.`
                : `Verified and waiting on approval. ${t.client_name}.`) +
            (lateInside
              ? ` ${plural(lateInside, 'step')} of the breakdown ${lateInside === 1 ? 'is' : 'are'} late too.`
              : ''),
          taskId: t.id,
          dedupeKey: `overdue-admin:${t.id}:${a.id}:${stamp}`,
        });
      }
    } else if (t.status === 'open') {
      const lead = t.owner_lead ?? 2;
      if (days <= lead) {
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`;
        if (
          await notifyTask({
            userId: t.owner_id,
            type: 'task_due_soon',
            severity: days === 0 ? 'warning' : 'info',
            title: `Due ${when}: ${t.name}`,
            body: `${t.client_name} · due ${t.completion_date}.`,
            taskId: t.id,
            dedupeKey: `due-soon:${t.id}:${stamp}`,
          })
        ) {
          created.dueSoon++;
        }
      }
    }

    if (t.status === 'submitted') {
      const waiting = ageInDays(t.submitted_at);
      if (waiting >= config.reviewSlaDays) {
        for (const a of await admins()) {
          if (a.id === t.owner_id) continue;
          if (
            await notifyTask({
              userId: a.id,
              type: 'review_stalled',
              severity: waiting >= config.reviewSlaDays * 3 ? 'critical' : 'warning',
              title: `Waiting on you for ${plural(waiting, 'day')}`,
              body: `${t.owner_name} submitted "${t.name}" and it has not been verified.`,
              taskId: t.id,
              dedupeKey: `review-stalled:${t.id}:${a.id}:${stamp}`,
            })
          ) {
            created.reviewStalled++;
          }
        }
      }
    }

    if (t.status === 'verified') {
      const waiting = ageInDays(t.verified_at);
      if (waiting >= config.reviewSlaDays) {
        for (const c of await ceos()) {
          if (c.id === t.owner_id) continue;
          if (
            await notifyTask({
              userId: c.id,
              type: 'approval_stalled',
              severity: waiting >= config.reviewSlaDays * 3 ? 'critical' : 'warning',
              title: `Awaiting your approval for ${plural(waiting, 'day')}`,
              body: `"${t.name}" for ${t.client_name} — verified, signed off by nobody yet.`,
              taskId: t.id,
              dedupeKey: `approval-stalled:${t.id}:${c.id}:${stamp}`,
            })
          ) {
            created.approvalStalled++;
          }
        }
      }
    }
  }

  // --- the breakdown -------------------------------------------------------
  //
  // Steps are swept independently of their parent's status, and deliberately
  // so: a follow-up dated a fortnight after delivery is still somebody's job
  // on the day, long after the task itself was approved. Only a cancelled
  // task's steps go quiet.
  //
  // These alerts go to the step's owner and nobody else. The manager already
  // sees "3 of 5" on the row, and one line per fragment per person would turn
  // the bell back into wallpaper — which is exactly what snoozing was built to
  // undo.
  const steps = await db
    .prepare(
      `SELECT s.*, t.name AS task_name, t.client_name, t.completion_date, t.status AS task_status,
              o.reminder_days_before AS owner_lead
         FROM task_steps s
         JOIN tasks t ON t.id = s.task_id
         JOIN users o ON o.id = s.owner_id
        WHERE s.done_at IS NULL AND s.due_date IS NOT NULL AND t.status <> 'cancelled'`
    )
    .all();

  /** Tasks whose breakdown has slipped while the task itself is still in time. */
  const slipping = new Map();

  for (const s of steps) {
    const days = daysToDue(s.due_date);
    const lead = s.owner_lead ?? 2;

    if (s.kind === 'follow_up') {
      /**
       * A follow-up whose day has come is not late — it is simply your turn,
       * and saying "overdue" about it would be a small lie the reader notices.
       * But it does get a nudge on the way in as well as on the day: knowing
       * on Tuesday that you promised to ring somebody on Thursday is the only
       * thing that makes a check-back reliable.
       */
      if (days <= lead) {
        if (
          await notifyTask({
            userId: s.owner_id,
            type: 'follow_up_due',
            severity: days <= -3 ? 'warning' : 'info',
            title:
              days > 0
                ? `Follow up ${days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`}: ${s.name}`
                : days === 0
                  ? `Follow up today: ${s.name}`
                  : `Waiting on you: ${s.name}`,
            body:
              `Under "${s.task_name}" for ${s.client_name}.` +
              (days < 0 ? ` Was set for ${s.due_date}.` : ` Set for ${s.due_date}.`),
            taskId: s.task_id,
            dedupeKey: `follow-up:${s.id}:${stamp}`,
          })
        ) {
          created.followUps++;
        }
      }
      continue;
    }

    if (days < 0) {
      const late = Math.abs(days);
      if (
        await notifyTask({
          userId: s.owner_id,
          type: 'step_overdue',
          severity: late >= 3 ? 'critical' : 'warning',
          title: `${plural(late, 'day')} late: ${s.name}`,
          body: `A step of "${s.task_name}", due ${s.due_date}.`,
          taskId: s.task_id,
          dedupeKey: `step-overdue:${s.id}:${stamp}`,
        })
      ) {
        created.stepsOverdue++;
      }
      // Only worth flagging upward while the task still looks fine. Once the
      // task itself is late the manager is already being told about it, and
      // two alerts for one problem is how people learn to ignore both.
      if (daysToDue(s.completion_date) >= 0) {
        const entry = slipping.get(s.task_id) || { task: s, count: 0 };
        entry.count += 1;
        slipping.set(s.task_id, entry);
      }
    } else if (days <= lead) {
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`;
      if (
        await notifyTask({
          userId: s.owner_id,
          type: 'step_due_soon',
          severity: days === 0 ? 'warning' : 'info',
          title: `Step due ${when}: ${s.name}`,
          body: `Under "${s.task_name}" for ${s.client_name}.`,
          taskId: s.task_id,
          dedupeKey: `step-due-soon:${s.id}:${stamp}`,
        })
      ) {
        created.stepsDueSoon++;
      }
    }
  }

  /**
   * The early warning, and the reason a breakdown with dates earns its keep: a
   * task that is not late yet, but whose insides have already slipped. One line
   * per task per day, to the manager — not one per step.
   */
  for (const [taskId, { task, count }] of slipping) {
    for (const a of await admins()) {
      if (
        await notifyTask({
          userId: a.id,
          type: 'steps_slipping',
          severity: 'warning',
          title: `Slipping: ${task.task_name}`,
          body:
            `${plural(count, 'step')} in the breakdown ${count === 1 ? 'is' : 'are'} late, ` +
            `but the task itself is not due until ${task.completion_date}.`,
          taskId,
          dedupeKey: `steps-slipping:${taskId}:${a.id}:${stamp}`,
        })
      ) {
        created.slipping++;
      }
    }
  }

  const total = Object.values(created).reduce((a, b) => a + b, 0);
  if (verbose || total > 0) {
    console.log(
      `[alerts] ${nowSql()} swept ${live.length} live tasks and ${steps.length} dated steps — ` +
        `created ${total} notification(s)`,
      created
    );
  }
  return { created, total, scanned: live.length, steps: steps.length };
}
