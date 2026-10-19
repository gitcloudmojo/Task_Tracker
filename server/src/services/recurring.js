/**
 * Repeating tasks.
 *
 * A schedule (a row in `recurring_tasks`) does not repeat a task — it makes a
 * new, ordinary one each time it comes round. That is the whole design: every
 * occurrence has its own deadline, its own submit/check/sign-off, its own
 * notes log, and its own "late" flag, so "we missed the tender check three
 * weeks ago" is a fact on the record rather than something an edited date
 * erased.
 *
 * Where generation runs from (all idempotent — see the unique index on
 * tasks(recurring_id, occurrence_date) in db/index.js, which is what makes
 * running it from several places harmless):
 *   - the daily cron (api/cron/alerts.js), so a quiet day still gets its tasks
 *   - the API itself, at most once an hour per instance (src/index.js), so a
 *     local server or a cold start catches up without waiting for the cron
 *   - right after a schedule is saved, so a schedule starting today shows its
 *     first task immediately
 *
 * Dates are plain 'YYYY-MM-DD' strings throughout and the arithmetic is done
 * in UTC on the date alone — no clock times, no daylight-saving surprises.
 */
import { db, nowSql, today } from '../db/index.js';
import { record } from './workflow.js';
import { notifyTask } from './alerts.js';

/** The most occurrences one schedule will create in a single catch-up. */
export const MAX_CATCHUP = 31;

const DAY = 86_400_000;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s, n) => fmt(parse(s) + n * DAY);
const isoWeekday = (s) => {
  const w = new Date(parse(s)).getUTCDay();
  return w === 0 ? 7 : w;
};
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const parseWeekdays = (csv) => {
  const set = String(csv || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return [...new Set(set)].sort((a, b) => a - b);
};

/** Does this schedule fall on this date? */
export function occursOn(rule, date) {
  if (rule.frequency === 'monthly') {
    const [y, m, d] = date.split('-').map(Number);
    const last = lastDayOfMonth(y, m);
    const want = rule.month_day === 'last' ? last : Math.min(Number(rule.month_day) || 1, last);
    return d === want;
  }
  const days = parseWeekdays(rule.weekdays);
  return (days.length ? days : [1, 2, 3, 4, 5, 6, 7]).includes(isoWeekday(date));
}

/** Every date the schedule falls on, from `from` to `to`, both inclusive. */
export function occurrencesBetween(rule, from, to) {
  const out = [];
  for (let d = parse(from), end = parse(to); d <= end; d += DAY) {
    const s = fmt(d);
    if (occursOn(rule, s)) out.push(s);
  }
  return out;
}

/** The first date after `after` the schedule falls on — for "next: …". */
export function nextOccurrence(rule, after) {
  const limit = rule.end_date || null;
  for (let i = 1; i <= 400; i++) {
    const s = addDays(after, i);
    if (limit && s > limit) return null;
    if (s >= rule.start_date && occursOn(rule, s)) return s;
  }
  return null;
}

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

/** "Every Monday", "Weekdays", "Monthly on the 5th", … */
export function describeSchedule(rule) {
  if (rule.frequency === 'monthly') {
    return rule.month_day === 'last'
      ? 'Monthly, on the last day'
      : `Monthly, on the ${ordinal(Number(rule.month_day) || 1)}`;
  }
  const days = parseWeekdays(rule.weekdays);
  if (rule.frequency === 'daily' || days.length === 0 || days.length === 7) {
    if (days.length === 5 && days.join() === '1,2,3,4,5') return 'Every weekday';
    if (days.length && days.length < 7) return `Daily, ${days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
    return 'Every day';
  }
  if (days.join() === '1,2,3,4,5') return 'Every weekday';
  if (days.length === 1) return `Every ${WEEKDAY_LONG[days[0]]}`;
  return `Weekly, ${days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
}

/** "20 Oct" for a daily/weekly occurrence, "Oct 2026" for a monthly one. */
function occurrenceTag(rule, date) {
  const [y, m, d] = date.split('-').map(Number);
  return rule.frequency === 'monthly' ? `${MONTH_SHORT[m - 1]} ${y}` : `${d} ${MONTH_SHORT[m - 1]}`;
}

/**
 * Create whatever tasks are due. Safe to call at any time, from anywhere, as
 * often as you like.
 *
 *   ruleId   limit it to one schedule (used right after saving one)
 *   asOf     override "today" — for tests
 */
export async function generateRecurring({ ruleId, asOf } = {}) {
  const stamp = asOf || today();
  const rules = await db
    .prepare(
      `SELECT r.*, o.name AS owner_name, o.is_active AS owner_active
         FROM recurring_tasks r JOIN users o ON o.id = r.owner_id
        WHERE r.active = 1 AND r.start_date <= ? ${ruleId ? 'AND r.id = ?' : ''}`
    )
    .all(...(ruleId ? [stamp, ruleId] : [stamp]));

  const result = { created: 0, skippedOlder: 0, rules: rules.length };

  for (const rule of rules) {
    // Nobody to give it to. Leave the schedule alone — once it has a live
    // owner again it catches up, rather than silently dropping weeks.
    if (!rule.owner_active) continue;

    let from = rule.generated_through ? addDays(rule.generated_through, 1) : rule.start_date;
    if (from < rule.start_date) from = rule.start_date;
    const to = rule.end_date && rule.end_date < stamp ? rule.end_date : stamp;
    if (from > to) continue;

    let dates = occurrencesBetween(rule, from, to);
    if (dates.length > MAX_CATCHUP) {
      result.skippedOlder += dates.length - MAX_CATCHUP;
      dates = dates.slice(-MAX_CATCHUP);
    }

    for (const date of dates) {
      const deadline = addDays(date, rule.due_after_days);
      const name = `${rule.name} — ${occurrenceTag(rule, date)}`;
      const stampNow = nowSql();

      const info = await db
        .prepare(
          `INSERT OR IGNORE INTO tasks
             (name, client_name, owner_id, completion_date, priority, notes, label_id,
              created_by, recurring_id, occurrence_date, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          name,
          rule.client_name,
          rule.owner_id,
          deadline,
          rule.priority,
          rule.notes,
          rule.label_id,
          rule.created_by,
          rule.id,
          date,
          stampNow,
          stampNow
        );
      if (!info.changes) continue; // already there — the unique index said no

      const taskId = info.lastInsertRowid;
      result.created++;

      await record({
        taskId,
        actorId: rule.created_by,
        action: 'created',
        to: 'open',
        note: `Created automatically from a repeating task (${describeSchedule(rule)}). Assigned to ${rule.owner_name}, due ${deadline}`,
      });

      // The schedule's standing notes become the first entry in the task's
      // dated log, the same as a note typed when creating a task by hand.
      if (rule.notes) {
        await db
          .prepare(
            `INSERT INTO task_notes (task_id, author_id, body, entry_date, created_at)
             VALUES (?,?,?,?,?)`
          )
          .run(taskId, rule.created_by, rule.notes, date, stampNow);
      }

      if (rule.created_by !== rule.owner_id) {
        await notifyTask({
          userId: rule.owner_id,
          type: 'task_assigned',
          severity: rule.priority === 'high' ? 'warning' : 'info',
          title: `New task: ${name}`,
          body: `Repeating task for ${rule.client_name}. Due ${deadline}.`,
          taskId,
          dedupeKey: `recurring:${rule.id}:${date}`,
        });
      }
    }

    await db
      .prepare('UPDATE recurring_tasks SET generated_through = ?, updated_at = ? WHERE id = ?')
      .run(to, nowSql(), rule.id);
  }

  return result;
}

/**
 * For the API: run the generator, but no more than once an hour per server
 * instance, and never let a failure here break the request that happened to
 * trigger it.
 */
let lastRun = 0;
export async function generateRecurringThrottled() {
  const now = Date.now();
  if (now - lastRun < 60 * 60 * 1000) return;
  lastRun = now;
  try {
    await generateRecurring();
  } catch (err) {
    lastRun = 0; // try again on the next request
    console.error('[recurring] generation failed', err);
  }
}
