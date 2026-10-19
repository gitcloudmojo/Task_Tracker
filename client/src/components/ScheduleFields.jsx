/**
 * The "how often" part of a repeating task: rhythm, the days, how long each
 * one has to be done, and when the series starts and stops. Used by the
 * New-task modal (where "Does not repeat" is the first choice) and by the
 * edit screen on the Repeating page (where it is not).
 */
import { Field, Segmented } from './ui.jsx';
import { WEEKDAYS, DEFAULT_DUE_AFTER, emptySchedule, preview } from '../lib/recurring.js';

const today = () => new Date().toISOString().slice(0, 10);

const ord = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

export default function ScheduleFields({ value, onChange, allowNone = false, editing = false }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const pickFrequency = (frequency) => {
    if (frequency === 'none') return onChange({ ...value, frequency: 'none' });
    // Moving between rhythms resets the bits that mean something different
    // for each — the days, and a sensible deadline — but keeps start and end.
    const fresh = emptySchedule(frequency);
    onChange({ ...value, frequency, weekdays: fresh.weekdays, monthDay: fresh.monthDay, dueAfterDays: fresh.dueAfterDays });
  };

  const toggleDay = (n) => {
    const has = value.weekdays.includes(n);
    const next = has ? value.weekdays.filter((d) => d !== n) : [...value.weekdays, n];
    set({ weekdays: next.sort((a, b) => a - b) });
  };

  const options = [
    ...(allowNone ? [{ value: 'none', label: 'Does not repeat' }] : []),
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  const repeating = value.frequency !== 'none';
  const daysOk = value.frequency !== 'weekly' || value.weekdays.length > 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Field
        label="Repeat"
        help={
          allowNone
            ? 'For work that comes round on a rhythm — checking tenders, a weekly report, month-end. Each time, a fresh task is created with its own deadline.'
            : undefined
        }
      >
        <Segmented value={value.frequency} onChange={pickFrequency} options={options} ariaLabel="How often" />
      </Field>

      {repeating && (
        <>
          {(value.frequency === 'weekly' || value.frequency === 'daily') && (
            <Field
              label={value.frequency === 'weekly' ? 'On *' : 'On these days'}
              help={
                value.frequency === 'daily'
                  ? 'Leave all seven for every day, or untick the weekend.'
                  : 'Pick one day, or several.'
              }
            >
              <div className="day-pills" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    className={`day-pill${value.weekdays.includes(d.n) ? ' on' : ''}`}
                    aria-pressed={value.weekdays.includes(d.n)}
                    onClick={() => toggleDay(d.n)}
                    title={d.long}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {value.frequency === 'monthly' && (
            <Field
              label="On the *"
              help="A 31st in a shorter month falls on that month's last day, so nothing is skipped."
            >
              <select value={value.monthDay} onChange={(e) => set({ monthDay: e.target.value })} style={{ maxWidth: 200 }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {ord(n)}
                  </option>
                ))}
                <option value="last">Last day of the month</option>
              </select>
            </Field>
          )}

          <div className="grid cols-3">
            <Field
              label="Each one is due *"
              help={`Days after it appears. 0 = the same day. (Usual for ${value.frequency}: ${DEFAULT_DUE_AFTER[value.frequency]}.)`}
            >
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={value.dueAfterDays}
                  onChange={(e) => set({ dueAfterDays: e.target.value === '' ? '' : Number(e.target.value) })}
                  style={{ width: 84 }}
                />
                <span className="muted small">days after</span>
              </div>
            </Field>
            {!editing && (
              <Field label="Starts" help="Today, or a date in the future.">
                <input
                  type="date"
                  value={value.startDate || today()}
                  min={today()}
                  onChange={(e) => set({ startDate: e.target.value })}
                />
              </Field>
            )}
            <Field label="Ends" help="Optional. Leave empty to repeat until you stop it.">
              <input
                type="date"
                value={value.endDate || ''}
                min={value.startDate || today()}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            </Field>
          </div>

          <div className={`notice${daysOk ? '' : ' warn'}`}>
            {daysOk ? (editing ? 'Changes apply from today on — tasks already created stay exactly as they are.' : preview(value, today())) : 'Pick at least one day of the week.'}
          </div>
        </>
      )}
    </div>
  );
}
