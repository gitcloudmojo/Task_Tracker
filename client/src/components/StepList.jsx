/**
 * The breakdown — a task's steps, on the task.
 *
 * Three decisions shaped this:
 *
 * 1. **Adding is inline, not a dialogue.** Nobody breaks a task into one piece.
 *    The composer stays open and refocuses after each save, so a plan arrives
 *    the way it is thought of — four lines in a row — instead of four trips
 *    through a modal.
 * 2. **Ticking is one click and instant.** The answer from the server replaces
 *    the list, so there is no waiting on a round trip to see a tick land.
 * 3. **A follow-up is marked, a step is not.** The common case carries no
 *    decoration; the unusual one says what it is. The reverse would put a badge
 *    on every row and tell the reader nothing.
 *
 * Who may do what is decided by the server and arrives on each step as flags,
 * so a control here can never offer something the API would refuse.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, Field, Segmented } from './ui.jsx';
import { STEP_KIND, stepDueLabel } from '../lib/task.js';
import { dateLabel } from '../lib/format.js';

const KIND_OPTIONS = [
  { value: 'step', label: 'Step' },
  { value: 'follow_up', label: 'Follow-up' },
];

export default function StepList({
  task,
  steps = [],
  canAdd = false,
  people = [],
  onChanged,
  onError,
}) {
  const [list, setList] = useState(steps);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState(null);

  // Composer
  const [name, setName] = useState('');
  const [kind, setKind] = useState('step');
  const [due, setDue] = useState('');
  const [owner, setOwner] = useState('');
  const nameRef = useRef(null);

  /**
   * The list lives here as well as in the parent.
   *
   * Every write answers with the whole list, so a tick lands without waiting
   * for the task to be refetched — and this effect takes the parent's word
   * again whenever it genuinely reloads, so the two cannot drift.
   */
  useEffect(() => setList(steps), [steps]);

  const apply = (res) => {
    if (res?.steps) setList(res.steps);
    if (res?.warning) {
      setNote(res.warning);
      setTimeout(() => setNote(null), 6000);
    }
    onChanged?.();
  };

  const run = async (id, fn) => {
    setBusy(id);
    try {
      apply(await fn());
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(null);
    }
  };

  const add = async (e) => {
    e?.preventDefault();
    if (name.trim().length < 3) return;
    setBusy('new');
    try {
      apply(
        await api.post(`/steps/task/${task.id}`, {
          name: name.trim(),
          kind,
          dueDate: due || null,
          ownerId: owner ? Number(owner) : undefined,
        })
      );
      // Keep the kind, the date and the owner: a breakdown is usually several
      // steps for the same person by the same date, and retyping that is the
      // difference between using the feature and not bothering.
      setName('');
      nameRef.current?.focus();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(null);
    }
  };

  const done = list.filter((s) => s.doneAt).length;
  const openSteps = list.filter((s) => !s.doneAt && s.kind === 'step').length;
  // Anyone allowed to add or change a step gets to say who does it — not just
  // an admin. `canAdd` already reflects the server's own canAddSteps check
  // (task owner or admin), so this can never offer more than the API allows.
  const assignable = canAdd && people.length > 1;

  return (
    <div className="steps">
      {list.length > 0 && (
        <div className="steps-head">
          <span className="steps-count">
            <strong>{done}</strong> of {list.length} done
          </span>
          <span className="steps-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((done / list.length) * 100)}%` }} />
          </span>
          {openSteps > 0 && task.status === 'submitted' && (
            <span className="steps-warn">
              {openSteps} still open, and it is already marked done
            </span>
          )}
        </div>
      )}

      {note && <div className="steps-note">{note}</div>}

      {list.length === 0 && !canAdd && (
        <div className="empty">Nothing broken down yet.</div>
      )}

      {list.length > 0 && (
        <ul className="step-rows">
          {list.map((s) => {
            const dl = stepDueLabel(s);
            const k = STEP_KIND[s.kind] || STEP_KIND.step;
            return (
              <li
                key={s.id}
                className={`step${s.doneAt ? ' done' : ''}${
                  s.doneAt && s.doneOnTime === false ? ' missed' : ''
                }${s.state === 'late' ? ' late' : s.state === 'waiting' ? ' waiting' : ''}`}
              >
                <button
                  className="tick-box"
                  disabled={busy === s.id || (!s.canTick && !s.canUntick)}
                  aria-pressed={Boolean(s.doneAt)}
                  title={
                    s.doneAt
                      ? s.canUntick
                        ? `Done by ${s.doneByName}. Click to reopen.`
                        : `Done by ${s.doneByName}`
                      : s.canTick
                        ? 'Tick it off'
                        : `Only ${s.ownerName}, or the manager, can tick this off`
                  }
                  onClick={() =>
                    run(s.id, () => api.post(`/steps/${s.id}/${s.doneAt ? 'undone' : 'done'}`))
                  }
                >
                  <span aria-hidden="true">{s.doneAt ? '✓' : ''}</span>
                </button>

                <div className="step-main">
                  <div className="step-name">{s.name}</div>
                  <div className="step-sub">
                    {s.kind === 'follow_up' && (
                      <span className="step-kind" title={k.hint}>
                        <span aria-hidden="true">{k.icon}</span> Follow-up
                      </span>
                    )}
                    {/* The owner is only worth saying when it is not the
                        obvious answer — otherwise every row repeats one name. */}
                    {s.ownerId !== task.ownerId && <span className="step-who">{s.ownerName}</span>}
                    {/* Who ticked it, but only when that was not the person it
                        belonged to — otherwise the row reads "Designer by
                        Designer", which says the same thing twice. */}
                    {s.doneAt && s.doneByName && s.doneByName !== s.ownerName && (
                      <span className="muted">ticked by {s.doneByName}</span>
                    )}
                    {s.note && <span className="muted step-note">{s.note}</span>}
                  </div>
                </div>

                {/* The deadline is always shown. Once it is done, the day it
                    was actually finished sits under it, green if that was on
                    or before the deadline and red if it was not — which is the
                    one question anybody asks of a finished step. */}
                <div className="step-when">
                  {s.dueDate ? (
                    <>
                      <span
                        className={`step-date${
                          s.doneAt
                            ? s.doneOnTime === false
                              ? ' missed'
                              : ' kept'
                            : s.state === 'late'
                              ? ' late'
                              : ''
                        }`}
                      >
                        {dateLabel(s.dueDate)}
                      </span>
                      {s.doneAt ? (
                        <span className={`step-done-on ${s.doneOnTime === false ? 'missed' : 'kept'}`}>
                          {s.doneOnTime === false ? '✕' : '✓'} done {dateLabel(s.doneAt)}
                        </span>
                      ) : (
                        dl && <span className={`due ${dl.tone}`}>{dl.text}</span>
                      )}
                    </>
                  ) : s.doneAt ? (
                    <span className="step-done-on">done {dateLabel(s.doneAt)}</span>
                  ) : (
                    <span className="small muted">no date</span>
                  )}
                </div>

                <div className="step-do">
                  {s.canEditStep && (
                    <button
                      className="btn sm ghost"
                      onClick={() => setEditing(s)}
                      aria-label={`Change ${s.name}`}
                      title="Change this step"
                    >
                      ✎
                    </button>
                  )}
                  {s.canRemoveStep && (
                    <button
                      className="btn sm ghost"
                      disabled={busy === s.id}
                      onClick={() => run(s.id, () => api.del(`/steps/${s.id}`))}
                      aria-label={`Remove ${s.name}`}
                      title="Remove this step"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <form className="step-add" onSubmit={add}>
          <Segmented value={kind} onChange={setKind} options={KIND_OPTIONS} ariaLabel="Step or follow-up" />
          <input
            ref={nameRef}
            className="step-add-name"
            value={name}
            placeholder={kind === 'follow_up' ? 'Check back on…' : 'What is the next piece?'}
            onChange={(e) => setName(e.target.value)}
            aria-label="What the step is"
          />
          {assignable && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Who does it">
              <option value="">{task.ownerName}</option>
              {people
                .filter((p) => p.id !== task.ownerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
          {/* A step cannot be due after its task, so the picker will not offer
              it. A follow-up has no ceiling — sitting after delivery is the
              point of one. */}
          <input
            type="date"
            value={due}
            max={kind === 'step' ? task.completionDate : undefined}
            onChange={(e) => setDue(e.target.value)}
            aria-label={kind === 'follow_up' ? 'Follow-up date' : 'Deadline'}
            title={
              kind === 'follow_up'
                ? 'When to check back — may be after the task itself'
                : `When this piece must be done, at the latest ${task.completionDate}`
            }
          />
          <button
            className="btn primary sm"
            disabled={busy === 'new' || name.trim().length < 3 || (kind === 'step' && !due)}
            title={kind === 'step' && !due ? 'Pick a date this step is due by' : undefined}
          >
            {busy === 'new' ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      {editing && (
        <EditStep
          step={editing}
          task={task}
          people={people}
          assignable={assignable}
          onClose={() => setEditing(null)}
          onSaved={(res) => {
            apply(res);
            setEditing(null);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

/** The full form, for the things the inline composer deliberately leaves out. */
function EditStep({ step, task, people, assignable, onClose, onSaved, onError }) {
  const [name, setName] = useState(step.name);
  const [kind, setKind] = useState(step.kind);
  const [due, setDue] = useState(step.dueDate || '');
  const [owner, setOwner] = useState(String(step.ownerId));
  const [note, setNote] = useState(step.note || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(
        await api.patch(`/steps/${step.id}`, {
          name: name.trim(),
          kind,
          dueDate: due || null,
          ownerId: Number(owner),
          note: note.trim() || null,
        })
      );
    } catch (err) {
      onError?.(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change this step"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Never mind
          </button>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || name.trim().length < 3 || (kind === 'step' && !due)}
            title={kind === 'step' && !due ? 'Pick a date this step is due by' : undefined}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="What it is">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label="Which kind" help={STEP_KIND[kind].hint}>
          <Segmented value={kind} onChange={setKind} options={KIND_OPTIONS} ariaLabel="Kind" />
        </Field>

        <div className="grid cols-2">
          {assignable && (
            <Field label="Who does it">
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === task.ownerId ? ' — owns the task' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label={kind === 'follow_up' ? 'Check back on' : 'Done by'}
            help={
              kind === 'follow_up'
                ? 'Optional, and may fall after the task itself.'
                : `Required, and no later than the task itself (${task.completionDate}).`
            }
          >
            <input
              type="date"
              value={due}
              max={kind === 'step' ? task.completionDate : undefined}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Anything to add" help="Optional — a link, a name, where the file is.">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
