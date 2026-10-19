/**
 * Create or edit a task.
 *
 * The five starred fields from the spec are the five required inputs here, in
 * the order somebody actually thinks about them: what, for whom, who does it,
 * by when, how urgent.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Modal, Field, ErrorBanner, Segmented } from './ui.jsx';
import FilePicker from './FilePicker.jsx';
import LabelPicker from './LabelPicker.jsx';
import ScheduleFields from './ScheduleFields.jsx';
import { emptySchedule, scheduleFromRule } from '../lib/recurring.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Four jobs, one form — they share every field except the dates:
 *   - a new task                     (no props)
 *   - editing a task                 (`task`)
 *   - a new repeating task           (pick Daily / Weekly / Monthly under "Repeat",
 *                                     or open it with `startRepeating`)
 *   - editing a repeating schedule   (`schedule`)
 * A repeating task replaces the single completion date with "how often" and
 * "due N days after each one appears" — see ScheduleFields and
 * services/recurring.js on the server.
 */
export default function TaskModal({ task, schedule: rule, startRepeating, people, clients, onClose, onSaved }) {
  const { user, can } = useAuth();
  // `tasks.create` is "for anyone" (Manager, Super Admin); a team member holds
  // only `tasks.create_own` and never sees the owner picker at all — there is
  // nothing to choose, so nothing to get wrong.
  const assignOthers = can('tasks.create');
  const manageLabels = can('labels.manage');
  const editing = Boolean(task);
  const src = task || rule;
  const [name, setName] = useState(src?.name || '');
  const [clientName, setClientName] = useState(src?.clientName || '');
  const [ownerId, setOwnerId] = useState(src?.ownerId || (assignOthers ? '' : user.id));
  const [completionDate, setCompletionDate] = useState(task?.completionDate || '');
  const [priority, setPriority] = useState(src?.priority || 'normal');
  const [notes, setNotes] = useState(src?.notes || '');
  const [labelId, setLabelId] = useState(src?.labelId || null);
  const [sched, setSched] = useState(
    rule
      ? scheduleFromRule(rule)
      : startRepeating
        ? emptySchedule('weekly')
        : { ...emptySchedule('weekly'), frequency: 'none' }
  );
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Repeating = editing a schedule, or creating one by choosing a rhythm.
  const repeating = Boolean(rule) || (!editing && sched.frequency !== 'none');

  // A brand-new task defaults to a week out — far enough to be plausible,
  // near enough that somebody will change it if it matters.
  useEffect(() => {
    if (!editing && !completionDate) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setCompletionDate(d.toISOString().slice(0, 10));
    }
  }, []);

  const ready =
    name.trim().length >= 3 &&
    clientName.trim() &&
    ownerId &&
    (repeating
      ? (sched.frequency !== 'weekly' || sched.weekdays.length > 0) && sched.dueAfterDays !== ''
      : completionDate);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (repeating) {
        const body = {
          name: name.trim(),
          clientName: clientName.trim(),
          ownerId: Number(ownerId),
          priority,
          notes: notes.trim() || null,
          frequency: sched.frequency,
          weekdays: sched.weekdays,
          monthDay: sched.monthDay,
          dueAfterDays: Number(sched.dueAfterDays),
          endDate: sched.endDate || null,
        };
        if (manageLabels) body.labelId = labelId || null;
        if (rule) {
          await api.patch(`/recurring/${rule.id}`, body);
        } else {
          if (sched.startDate) body.startDate = sched.startDate;
          await api.post('/recurring', body);
        }
        onSaved();
        onClose();
        return;
      }
      const payload = {
        name: name.trim(),
        clientName: clientName.trim(),
        ownerId: Number(ownerId),
        completionDate,
        priority,
      };
      // Notes only apply at creation — after that, updates go on the task's
      // dated log instead (see Task Detail), so an edit never sends this and
      // there is nothing here that would silently overwrite what somebody
      // logged there.
      if (!editing) payload.notes = notes.trim() || null;
      // Only a Manager or Super Admin sends this at all — the server refuses
      // a `labelId` from anybody else on an edit, so a team member's own
      // edit (`canEditOwn`) never carries it.
      if (manageLabels) payload.labelId = labelId || null;
      // A task has no id until it exists, so files go up straight afterwards.
      // If that second step fails the task still stands — better a task with a
      // missing brief than no task at all — and the error says which happened.
      const saved = editing
        ? await api.patch(`/tasks/${task.id}`, payload)
        : await api.post('/tasks', payload);

      if (files.length) {
        try {
          await api.upload(`/attachments/task/${saved.task.id}`, files);
        } catch (err) {
          onSaved();
          setError(
            new Error(`The task was saved, but the files did not attach: ${err.message}`)
          );
          setBusy(false);
          return;
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        editing
          ? `Edit · ${task.name}`
          : rule
            ? `Edit repeating task · ${rule.name}`
            : repeating
              ? 'New repeating task'
              : 'New task'
      }
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !ready}>
            {busy ? 'Saving…' : editing || rule ? 'Save changes' : repeating ? 'Create repeating task' : 'Create task'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <ErrorBanner error={error} />

        <Field label="Task name *" help="What somebody will recognise this by in three months.">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cost optimisation report — August"
            autoFocus
          />
        </Field>

        <div className="grid cols-2">
          <Field label="Client *" help="Use Internal for work that is not for a client.">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              list="client-suggestions"
              placeholder="e.g. Internal"
            />
            <datalist id="client-suggestions">
              {(clients || []).map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </Field>

          <Field
            label="Task owner *"
            help={assignOthers ? 'The person who does the work and submits it.' : 'You can only create tasks for yourself.'}
          >
            {assignOthers ? (
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">— choose —</option>
                {(people || [])
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.team ? ` — ${p.team}` : ''}
                    </option>
                  ))}
              </select>
            ) : (
              <input type="text" value={`${user.name} (you)`} disabled />
            )}
          </Field>

          {!repeating && (
            <Field label="Completion date *" help="The target for delivery. Alerts key off this.">
              <input
                type="date"
                value={completionDate}
                min={editing ? undefined : today()}
                onChange={(e) => setCompletionDate(e.target.value)}
              />
            </Field>
          )}

          <Field label="Priority" help="Two levels on purpose — four ends up with everything urgent.">
            <Segmented
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Field>

          {manageLabels && (
            <Field
              label="Label"
              help="The wider project this belongs to, if any — lets the CEO pull up every task under it, whoever it's assigned to."
            >
              <LabelPicker value={labelId} onChange={setLabelId} />
            </Field>
          )}
        </div>

        {/* Where "Repeat" lives: right under the fields every task has, so
            "does this come round again?" is part of describing the work. On
            the edit screen of an existing task there is nothing to choose —
            a task is one occurrence; its schedule is edited on the Repeating
            page — so it is not offered. */}
        {!editing && (
          <ScheduleFields value={sched} onChange={setSched} allowNone={!rule} editing={Boolean(rule)} />
        )}

        {!editing && (
          <Field
            label="Notes"
            help={
              repeating
                ? 'Standing instructions. Copied into the update log of every task this creates.'
                : "Context, links, what done looks like. Becomes the first entry in the task's update log — the owner adds to it from there as they go."
            }
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Anything the owner needs to know before starting."
            />
          </Field>
        )}

        {/* Files belong to one task; a schedule makes many, so they are not
            offered here — attach to the task itself once it exists. */}
        {!repeating && (
          <Field
            label="Attachments"
            help="The brief, the spec, the client's email — whatever the owner needs to start."
          >
            <FilePicker files={files} onChange={setFiles} label="Attach files to this task" />
          </Field>
        )}

        {repeating && (
          <div className="notice">
            Every task this makes goes through the usual flow on its own — the owner submits it, a
            manager checks and signs it off — so a missed week shows up as a late task, never as an
            edited date.
          </div>
        )}
        {!editing && !repeating && assignOthers && (
          <div className="notice">
            The owner gets an alert straight away. They submit it when done, and whoever checks
            it signs it off in that same step — no separate approval to wait on afterwards.
          </div>
        )}
        {!editing && !repeating && !assignOthers && (
          <div className="notice">
            Submit it when it's done — your manager checking it is the final sign-off, in one
            step.
          </div>
        )}
      </div>
    </Modal>
  );
}
