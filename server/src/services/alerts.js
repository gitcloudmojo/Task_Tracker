/**
 * The nag engine — same three kinds of lateness as the on-prem edition
 * (the owner is late, a submission is stalled unverified, a verified task is
 * stalled unapproved), just triggered differently.
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
  const created = { dueSoon: 0, overdue: 0, reviewStalled: 0, approvalStalled: 0 };

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

      for (const a of await admins()) {
        if (a.id === t.owner_id && blame === 'owner') continue;
        await notifyTask({
          userId: a.id,
          type: 'task_overdue',
          severity: late >= 3 ? 'critical' : 'warning',
          title: `${plural(late, 'day')} late: ${t.name}`,
          body:
            blame === 'owner'
              ? `${t.owner_name} has not finished it. ${t.client_name}.`
              : blame === 'verifier'
                ? `Submitted and waiting on a verification. ${t.client_name}.`
                : `Verified and waiting on approval. ${t.client_name}.`,
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

  const total = Object.values(created).reduce((a, b) => a + b, 0);
  if (verbose || total > 0) {
    console.log(
      `[alerts] ${nowSql()} swept ${live.length} live tasks — created ${total} notification(s)`,
      created
    );
  }
  return { created, total, scanned: live.length };
}
