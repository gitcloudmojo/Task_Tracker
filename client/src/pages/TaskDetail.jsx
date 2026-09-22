/**
 * One task.
 *
 * Ordered by what the person opening it needs, in that order:
 *
 *   1. Anything wrong — sent back, or late.
 *   2. Where it has got to, as one line plus four small steps.
 *   3. What they can do about it, right there.
 *   4. The facts, the notes, the files.
 *   5. The history, folded away until somebody asks "what happened here".
 *
 * The old version led with a four-box rail and two columns of panels. That
 * showed everything at once, which meant nothing led.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import TaskModal from '../components/TaskModal.jsx';
import ReassignModal from '../components/ReassignModal.jsx';
import MoveButtons from '../components/MoveButtons.jsx';
import StepList from '../components/StepList.jsx';
import { Card, Badge, Empty, ErrorBanner, ClipIcon, Field } from '../components/ui.jsx';
import { STATUS, PRIORITY, ACTION_LABEL, ACTION_ICON, fileSize, dueLabel } from '../lib/task.js';
import { dateLabel, dateTimeLabel, relativeTime } from '../lib/format.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The four gates of the approval chain, as one line.
 *
 * Named gates, not steps: a task's *steps* are now the pieces it was broken
 * into, and calling both by the same word would confuse the reader of the code
 * as surely as it would confuse the reader of the screen.
 */
function Gates({ task: t }) {
  const gates = [
    { key: 'open', label: 'Assigned', who: t.creatorName, at: t.createdAt, done: true },
    {
      key: 'submitted',
      label: 'Marked done',
      who: t.ownerName,
      at: t.submittedAt,
      done: Boolean(t.submittedAt) || ['verified', 'approved'].includes(t.status),
    },
    {
      key: 'verified',
      label: 'Checked',
      who: t.verifierName,
      at: t.verifiedAt,
      done: Boolean(t.verifiedAt) || t.status === 'approved',
    },
    {
      key: 'approved',
      label: 'Approved',
      who: t.approverName,
      at: t.approvedAt,
      done: t.status === 'approved',
    },
  ];

  return (
    <div className="gates">
      {gates.map((s, i) => (
        <div
          key={s.key}
          className={`gate${s.done ? ' done' : ''}${t.status === s.key ? ' here' : ''}`}
        >
          <span className="gate-dot" aria-hidden="true">
            {s.done ? '✓' : i + 1}
          </span>
          <span className="gate-text">
            <span className="gate-label">{s.label}</span>
            <span className="small muted">
              {s.done && s.at ? `${s.who ? `${s.who} · ` : ''}${dateLabel(s.at)}` : 'not yet'}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [labels, setLabels] = useState([]);
  const [labelBusy, setLabelBusy] = useState(false);
  const [newLabelOpen, setNewLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [addingLabel, setAddingLabel] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [noteDate, setNoteDate] = useState(today());
  const [addingNote, setAddingNote] = useState(false);

  const load = () => api.get(`/tasks/${id}`).then(setData).catch(setError);
  const loadLabels = () => api.get('/labels').then((d) => setLabels(d.labels)).catch(() => {});

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    api.get('/users').then((d) => setPeople(d.users)).catch(() => {});
    api.get('/tasks/clients').then((d) => setClients(d.clients)).catch(() => {});
    loadLabels();
  }, []);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      await api.upload(`/attachments/task/${id}`, files);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.del(`/tasks/${id}`);
      navigate('/');
    } catch (err) {
      setError(err);
      setDeleting(false);
    }
  };

  const addNote = async () => {
    if (!noteBody.trim()) return;
    setAddingNote(true);
    setError(null);
    try {
      await api.post(`/tasks/${id}/notes`, { body: noteBody.trim(), entryDate: noteDate || undefined });
      setNoteBody('');
      setNoteDate(today());
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setAddingNote(false);
    }
  };

  const setLabel = async (labelId) => {
    setLabelBusy(true);
    setError(null);
    try {
      await api.patch(`/tasks/${id}`, { labelId: labelId || null });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setLabelBusy(false);
    }
  };

  const createLabel = async () => {
    if (!newLabelName.trim()) return;
    setAddingLabel(true);
    setError(null);
    try {
      const d = await api.post('/labels', { name: newLabelName.trim() });
      setNewLabelName('');
      setNewLabelOpen(false);
      await loadLabels();
      await setLabel(d.label.id);
    } catch (err) {
      setError(err);
    } finally {
      setAddingLabel(false);
    }
  };

  if (error && !data) {
    return (
      <Layout title="Task">
        <ErrorBanner error={error} />
        <div style={{ marginTop: 14 }}>
          <Link className="btn" to="/">
            Back
          </Link>
        </div>
      </Layout>
    );
  }
  if (!data) {
    return (
      <Layout title="Task">
        <Empty>Loading…</Empty>
      </Layout>
    );
  }

  const t = data.task;
  const s = STATUS[t.status];
  const due = dueLabel(t.daysToDue, t.status, t.lateSide);
  // Red only when the lateness is genuinely the owner's — still open, past
  // its date. Once the owner has done their part and it is sitting with a
  // reviewer, the amber `due` tone above already says so without painting
  // the whole task as if the person doing the work were the one holding it
  // up. See lib/task.js's dueLabel for the reasoning.
  const ownerLate = t.isOverdue && t.lateSide === 'owner';
  const canSetLabel = can('tasks.edit');
  // The bar also appears when there is no move to make *because* the breakdown
  // is holding it — that is when the reader most needs to be told why.
  const hasMove =
    t.canSubmit ||
    t.canVerify ||
    t.canApprove ||
    t.canReturn ||
    t.canCancel ||
    t.canReopen ||
    (t.blockedBySteps && t.mine);

  return (
    <Layout
      title={t.name}
      subtitle={`${t.clientName} · ${t.ownerName}${t.ownerTeam ? ` (${t.ownerTeam})` : ''}`}
      actions={
        <>
          <Link className="btn ghost" to="/">
            Back
          </Link>
          {t.canReassign && (
            <button className="btn ghost" onClick={() => setReassigning(true)}>
              Reassign
            </button>
          )}
          {(t.canEdit || t.canEditOwn) && (
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {can('tasks.delete') && (
            <button
              className="btn danger"
              disabled={deleting}
              onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              {deleting ? 'Deleting…' : confirmDelete ? 'Click again to confirm' : 'Delete task'}
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />
        {confirmDelete && (
          <div className="callout warn">
            <div>
              <strong>This permanently deletes the task</strong> — its steps, history, and files go
              with it. There is no undo. Click "Click again to confirm" to proceed, or click anywhere
              else to cancel.
            </div>
          </div>
        )}

        {/* Sent back: the first thing the owner must see. */}
        {t.returnedAt && t.status === 'open' && (
          <div className="callout warn">
            <div>
              <strong>Sent back by {t.returnerName}</strong>
              <div style={{ marginTop: 2 }}>{t.returnReason}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {relativeTime(t.returnedAt)}
                {t.returnCount > 1 ? ` · sent back ${t.returnCount} times` : ''}
              </div>
            </div>
          </div>
        )}

        {t.isOverdue && (
          <div className={`callout ${ownerLate ? 'bad' : 'warn'}`}>
            <div>
              <strong>{Math.abs(t.daysToDue)} days past the completion date.</strong>{' '}
              {t.status === 'open'
                ? 'Still with the person doing it.'
                : t.status === 'submitted'
                  ? `Completed by ${t.ownerName} — waiting on the manager to check it.`
                  : 'Checked — waiting on the CEO.'}
            </div>
          </div>
        )}

        {/* Where it is, and what you can do — one card, in that order. */}
        <Card>
          <div className="state-line">
            <Badge tone={s.tone} icon={s.icon}>
              {s.label}
            </Badge>
            <span className="muted">{s.heldBy}</span>
            <div className="spacer" />
            <span className="due-block">
              <span className="due-label">Complete by</span>
              <span className={`due-date${ownerLate ? ' late' : ''}`}>
                {dateLabel(t.completionDate)}
              </span>
              {due && <span className={`due ${due.tone}`}>{due.text}</span>}
            </span>
          </div>

          <Gates task={t} />

          {hasMove && (
            <div className="move-bar">
              <MoveButtons task={t} onDone={load} onError={setError} full size="" />
              {t.canSubmit && (
                <span className="small muted">
                  Marking it done tells your manager to check it. You will hear back either way.
                </span>
              )}
              {t.canVerify && (
                <span className="small muted">Confirming is the final sign-off — this approves it.</span>
              )}
            </div>
          )}
        </Card>

        {/* The facts, in one quiet row rather than a panel of their own. */}
        <div className="facts">
          <span>
            <b>Priority</b> {PRIORITY[t.priority].label}
          </span>
          <span>
            <b>Assigned by</b> {t.creatorName}
          </span>
          {/* Only a manager sets this (see access.js — it rides on `tasks.edit`),
              but everybody who can see the task sees which project it is
              filed under, which is the whole point for the CEO. */}
          {canSetLabel ? (
            <span className="row" style={{ gap: 6 }}>
              <b>Label</b>
              <select
                value={t.labelId || ''}
                disabled={labelBusy}
                onChange={(e) => setLabel(e.target.value ? Number(e.target.value) : null)}
                style={{ display: 'inline-block', width: 'auto' }}
              >
                <option value="">— none —</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {newLabelOpen ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    placeholder="New label"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createLabel()}
                    style={{ width: 140 }}
                  />
                  <button
                    className="btn sm ghost"
                    disabled={addingLabel || !newLabelName.trim()}
                    onClick={createLabel}
                  >
                    {addingLabel ? 'Adding…' : 'Add'}
                  </button>
                </>
              ) : (
                <button className="btn sm ghost" onClick={() => setNewLabelOpen(true)}>
                  + new label
                </button>
              )}
            </span>
          ) : (
            t.labelName && (
              <span>
                <b>Label</b> <Badge tone="accent">{t.labelName}</Badge>
              </span>
            )
          )}
          {t.verifierName && (
            <span>
              <b>Checked by</b> {t.verifierName}
            </span>
          )}
          {t.approverName && (
            <span>
              <b>Approved by</b> {t.approverName}
            </span>
          )}
          {t.returnCount > 0 && (
            <span>
              <b>Sent back</b> {t.returnCount === 1 ? 'once' : `${t.returnCount} times`}
            </span>
          )}
          {t.reassignCount > 0 && (
            <span>
              <b>Reassigned</b> {t.reassignCount === 1 ? 'once' : `${t.reassignCount} times`}
              {t.reassignedAt ? `, last on ${dateLabel(t.reassignedAt)}` : ''}
            </span>
          )}
          {t.cancelledAt && (
            <span>
              <b>Cancelled</b> {t.cancelReason || dateLabel(t.cancelledAt)}
            </span>
          )}
        </div>

        {/* What the reviewer said, when there is something to read. */}
        {(t.submittedNote || t.verifiedNote || t.approvedNote) && (
          <Card title="What was said" collapsible id="task-said">
            <div className="stack" style={{ gap: 10 }}>
              {t.submittedNote && (
                <div className="said">
                  <b>{t.ownerName} on marking it done</b>
                  <div>{t.submittedNote}</div>
                </div>
              )}
              {t.verifiedNote && (
                <div className="said">
                  <b>{t.verifierName} on checking it</b>
                  <div>{t.verifiedNote}</div>
                </div>
              )}
              {t.approvedNote && (
                <div className="said">
                  <b>{t.approverName} on approving it</b>
                  <div>{t.approvedNote}</div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* The breakdown sits with the work rather than with the context: it is
            a list of things somebody still has to do, so it belongs above the
            notes and the files, not folded away beneath them. */}
        <Card
          title="Breakdown"
          hint={
            t.stepTotal === 0
              ? 'split it into steps, each with its own date'
              : t.stepsLate > 0
                ? `${t.stepsLate} late`
                : t.followUpsOpen > 0
                  ? `${t.followUpsOpen} follow-up${t.followUpsOpen === 1 ? '' : 's'} pending`
                  : undefined
          }
          collapsible
          defaultCollapsed={t.stepTotal === 0 && !data.canAddSteps}
          id="task-steps"
        >
          <StepList
            task={t}
            steps={data.steps}
            canAdd={data.canAddSteps}
            people={people}
            onChanged={load}
            onError={setError}
          />
        </Card>

        {/* A running log, not a text box that gets overwritten — a daily
            update from three weeks ago is worth exactly as much as today's.
            Anybody who can see the task can add to it, the owner logging
            progress and the CEO leaving a comment through the same door. */}
        <Card
          title="Notes & updates"
          hint="a dated log — the owner's daily progress, and anyone else's comments"
          collapsible
          defaultCollapsed={false}
          id="task-notes"
        >
          <div className="stack" style={{ gap: 12 }}>
            {(!data.notes || data.notes.length === 0) && (
              <div className="small muted">Nothing logged yet.</div>
            )}
            {data.notes && data.notes.length > 0 && (
              <div className="log">
                {data.notes.map((n) => (
                  <div key={n.id} className="hist">
                    <span className="hist-dot" aria-hidden="true">
                      ✎
                    </span>
                    <div className="hist-main">
                      <div className="hist-head">
                        <span className="strong">{n.authorName}</span>
                        <span className="muted"> on {dateLabel(n.entryDate)}</span>
                        <span className="small muted" style={{ marginLeft: 'auto' }}>
                          logged {relativeTime(n.createdAt)}
                        </span>
                      </div>
                      <div className="hist-note">{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid cols-2" style={{ gap: 10, alignItems: 'end' }}>
              <Field label="Date this update is about">
                <input type="date" value={noteDate} max={today()} onChange={(e) => setNoteDate(e.target.value)} />
              </Field>
              <div />
            </div>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
              placeholder="Progress, a blocker, a comment for whoever reads this next."
            />
            <div>
              <button
                className="btn sm primary"
                disabled={addingNote || !noteBody.trim()}
                onClick={addNote}
              >
                {addingNote ? 'Adding…' : 'Add to the log'}
              </button>
            </div>
          </div>
        </Card>

        <Card
          title={`Files · ${data.attachments.length}`}
          hint={t.canAttach ? 'up to 5 at a time, 20 MB each' : 'locked once approved'}
          collapsible
          defaultCollapsed={data.attachments.length === 0}
          id="task-files"
        >
          {data.attachments.length === 0 && !t.canAttach ? (
            <Empty>No files.</Empty>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {data.attachments.map((a) => (
                <div key={a.id} className="file-row">
                  <span className="file-icon" aria-hidden="true">
                    <ClipIcon size={14} />
                  </span>
                  <div className="file-main">
                    <button
                      className="file-name"
                      onClick={() => api.download(`/attachments/${a.id}`, a.filename).catch(setError)}
                    >
                      {a.filename}
                    </button>
                    <div className="small muted">
                      {fileSize(a.sizeBytes)} · {a.uploaderName} · {relativeTime(a.createdAt)}
                    </div>
                  </div>
                  {a.canDelete && t.status !== 'approved' && (
                    <button
                      className="btn sm ghost"
                      disabled={busy}
                      onClick={() => act(() => api.del(`/attachments/${a.id}`))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {t.canAttach && (
                <label className="drop">
                  <input
                    type="file"
                    multiple
                    onChange={(e) => {
                      upload([...e.target.files]);
                      e.target.value = '';
                    }}
                  />
                  <span>{uploading ? 'Uploading…' : 'Add files'}</span>
                  <span className="small muted">The report, the screenshot, the signed copy.</span>
                </label>
              )}
            </div>
          )}
        </Card>

        <Card title="History" hint="every step, oldest first" collapsible defaultCollapsed id="task-history">
          <div className="log">
            {data.history.map((e) => (
              <div key={e.id} className={`hist ${e.action}`}>
                <span className="hist-dot" aria-hidden="true">
                  {ACTION_ICON[e.action] || '•'}
                </span>
                <div className="hist-main">
                  <div className="hist-head">
                    <span className="strong">{e.actorName}</span>
                    <span className="muted"> {ACTION_LABEL[e.action] || e.action}</span>
                    <span className="small muted" style={{ marginLeft: 'auto' }}>
                      {dateTimeLabel(e.createdAt)}
                    </span>
                  </div>
                  {e.note && <div className="hist-note">{e.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {reassigning && (
        <ReassignModal task={t} people={people} onClose={() => setReassigning(false)} onSaved={load} />
      )}

      {editing && (
        <TaskModal
          task={t}
          people={people}
          clients={clients}
          labels={labels}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </Layout>
  );
}
