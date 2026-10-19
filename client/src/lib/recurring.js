/**
 * Small helpers for the repeating-task form. The server is the authority on
 * when a schedule falls (services/recurring.js) — this only mirrors enough of
 * it to say, live, "your first task will be on …, due …", so nobody has to
 * save a schedule to find out what it does.
 */

export const WEEKDAYS = [
  { n: 1, short: 'Mon', long: 'Monday' },
  { n: 2, short: 'Tue', long: 'Tuesday' },
  { n: 3, short: 'Wed', long: 'Wednesday' },
  { n: 4, short: 'Thu', long: 'Thursday' },
  { n: 5, short: 'Fri', long: 'Friday' },
  { n: 6, short: 'Sat', long: 'Saturday' },
  { n: 7, short: 'Sun', long: 'Sunday' },
];

/** A sensible deadline for each rhythm — people can change it, few need to. */
export const DEFAULT_DUE_AFTER = { daily: 0, weekly: 4, monthly: 7 };

export const emptySchedule = (frequency = 'weekly') => ({
  frequency,
  weekdays: frequency === 'daily' ? [1, 2, 3, 4, 5] : [1],
  monthDay: '1',
  dueAfterDays: DEFAULT_DUE_AFTER[frequency] ?? 0,
  startDate: '',
  endDate: '',
});

export const scheduleFromRule = (r) => ({
  frequency: r.frequency,
  weekdays: r.weekdays?.length ? r.weekdays : r.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1],
  monthDay: r.monthDay || '1',
  dueAfterDays: r.dueAfterDays ?? 0,
  startDate: r.startDate || '',
  endDate: r.endDate || '',
});

// --- plain 'YYYY-MM-DD' date arithmetic, in UTC, no clock times -------------

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

function occursOn(sc, date) {
  if (sc.frequency === 'monthly') {
    const [y, m, d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const want = sc.monthDay === 'last' ? last : Math.min(Number(sc.monthDay) || 1, last);
    return d === want;
  }
  const days = sc.weekdays?.length ? sc.weekdays : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(isoWeekday(date));
}

/** The first date on or after `from` the schedule falls on. */
export function firstOccurrence(sc, from) {
  for (let i = 0; i < 400; i++) {
    const s = addDays(from, i);
    if (sc.endDate && s > sc.endDate) return null;
    if (occursOn(sc, s)) return s;
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 19 Oct" */
export function shortDay(s) {
  const dt = new Date(parse(s));
  return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

/** The schedule in a few plain words. */
export function describe(sc) {
  if (sc.frequency === 'monthly') {
    return sc.monthDay === 'last' ? 'Monthly, on the last day' : `Monthly, on the ${ordinal(Number(sc.monthDay) || 1)}`;
  }
  const days = [...(sc.weekdays || [])].sort((a, b) => a - b);
  const names = days.map((d) => WEEKDAYS[d - 1].short);
  if (days.join() === '1,2,3,4,5') return 'Every weekday';
  if (sc.frequency === 'daily' && (days.length === 0 || days.length === 7)) return 'Every day';
  if (days.length === 1 && sc.frequency === 'weekly') return `Every ${WEEKDAYS[days[0] - 1].long}`;
  return sc.frequency === 'daily' ? `Daily, ${names.join(', ')}` : `Weekly, ${names.join(', ')}`;
}

/** The sentence under the form: what saving this will actually do. */
export function preview(sc, todayStr) {
  const start = sc.startDate || todayStr;
  const first = firstOccurrence(sc, start);
  if (!first) return 'This schedule never falls on a day inside its start and end dates.';
  const due = addDays(first, Number(sc.dueAfterDays) || 0);
  const lead = first === todayStr ? 'The first task is created today' : `The first task is created on ${shortDay(first)}`;
  const gap =
    Number(sc.dueAfterDays) > 0
      ? `, due ${shortDay(due)}`
      : ', due the same day';
  return `${lead}${gap}. After that, a new task appears each time and the old one stays on the record.`;
}
