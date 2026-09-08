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
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import Layout from '../components/Layout.jsx';
import TaskModal from '../components/TaskModal.jsx';
import ReassignModal from '../components/ReassignModal.jsx';
import MoveButtons from '../components/MoveButtons.jsx';
import StepList from '../components/StepList.jsx';
import { Card, Badge, Empty, ErrorBanner, ClipIcon } from '../components/ui.jsx';
import { STATUS, PRIORITY, ACTION_LABEL, ACTION_ICON, fileSize, dueLabel } from '../lib/task.js';
import { dateLabel, dateTimeLabel, relativeTime } from '../lib/format.js';

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
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = () =>
    api
      .get(`/tasks/${id}`)
      .then((d) => {
        setData(d);
        setNotes(d.task.notes || '');
      })
      .catch(setError);

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    api.get('/users').then((d) => setPeople(d.users)).catch(() => {});
    api.get('/tasks/clients').then((d) => setClients(d.clients)).catch(() => {});
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
  const due = dueLabel(t.daysToDue, t.status);
  const notesChanged = (t.notes || '') !== notes;
  const canEditNotes = t.mine || t.canEdit;
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
          {t.canEdit && (
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />

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
          <div className="callout bad">
            <div>
              <strong>{Math.abs(t.daysToDue)} days past the completion date.</strong>{' '}
              {t.status === 'open'
                ? 'Still with the person doing it.'
                : t.status === 'submitted'
                  ? 'Marked done — waiting on the manager to check it.'
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
              <span className={`due-date${t.isOverdue ? ' late' : ''}`}>
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
                <span className="small muted">
                  Confirming sends it up to the CEO for the final approval.
                </span>
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

        <Card
          title="Notes"
          hint={canEditNotes ? 'the owner keeps this current' : undefined}
          action={
            canEditNotes && notesChanged ? (
              <button
                className="btn sm primary"
                disabled={savingNotes}
                onClick={async () => {
                  setSavingNotes(true);
                  try {
                    await api.patch(`/tasks/${id}`, { notes });
                    await load();
                  } catch (err) {
                    setError(err);
                  } finally {
                    setSavingNotes(false);
                  }
                }}
              >
                {savingNotes ? 'Saving…' : 'Save notes'}
              </button>
            ) : null
          }
        >
          {canEditNotes ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Context, links, blockers, what done looks like."
            />
          ) : (
            <div className="prose">{t.notes || <span className="muted">No notes.</span>}</div>
          )}
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
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </Layout>
  );
}
