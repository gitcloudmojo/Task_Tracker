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

const today = () => new Date().toISOString().slice(0, 10);

export default function TaskModal({ task, people, clients, labels, onClose, onSaved }) {
  const { user, can } = useAuth();
  // `tasks.create` is "for anyone" (Manager, Super Admin); a team member holds
  // only `tasks.create_own` and never sees the owner picker at all — there is
  // nothing to choose, so nothing to get wrong.
  const assignOthers = can('tasks.create');
  // Filing a task under a label is a manager's call, same permission as
  // assigning it to somebody else — see access.js and the label column's
  // comment in schema.sql.
  const canSetLabel = can('tasks.edit');
  const editing = Boolean(task);
  const [name, setName] = useState(task?.name || '');
  const [clientName, setClientName] = useState(task?.clientName || '');
  const [ownerId, setOwnerId] = useState(task?.ownerId || (assignOthers ? '' : user.id));
  const [completionDate, setCompletionDate] = useState(task?.completionDate || '');
  const [priority, setPriority] = useState(task?.priority || 'normal');
  const [labelId, setLabelId] = useState(task?.labelId || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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
    name.trim().length >= 3 && clientName.trim() && ownerId && completionDate;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        clientName: clientName.trim(),
        ownerId: Number(ownerId),
        completionDate,
        priority,
        notes: notes.trim() || null,
      };
      if (canSetLabel) payload.labelId = labelId ? Number(labelId) : null;
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
      title={editing ? `Edit · ${task.name}` : 'New task'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !ready}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
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

          <Field label="Completion date *" help="The target for delivery. Alerts key off this.">
            <input
              type="date"
              value={completionDate}
              min={editing ? undefined : today()}
              onChange={(e) => setCompletionDate(e.target.value)}
            />
          </Field>

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

          {canSetLabel && (
            <Field
              label="Label"
              help="Which project this belongs to — lets the CEO see every task under it, whoever it's assigned to."
            >
              <select value={labelId} onChange={(e) => setLabelId(e.target.value)}>
                <option value="">— none —</option>
                {(labels || []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field
          label="Notes"
          help="Context, links, what done looks like. The owner can keep this updated as they go."
        >
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything the owner needs to know before starting."
          />
        </Field>

        <Field
          label="Attachments"
          help="The brief, the spec, the client's email — whatever the owner needs to start."
        >
          <FilePicker files={files} onChange={setFiles} label="Attach files to this task" />
        </Field>

        {!editing && assignOthers && (
          <div className="notice">
            The owner gets an alert straight away. They submit it when done, and a manager checking
            it is the final sign-off — the CEO can see it and comment, but does not need to act.
          </div>
        )}
        {!editing && !assignOthers && (
          <div className="notice">
            Submit it when it's done — your manager checking it is the final sign-off. The CEO can
            see it and comment too.
          </div>
        )}
      </div>
    </Modal>
  );
}
