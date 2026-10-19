/**
 * One task in a list.
 *
 * Three things and no more: what it is, when it is due, and what you can do
 * about it. Everything else — status words, the pipeline, who verified it —
 * is either implied by the list you are looking at or one click away on the
 * task itself. A row that tries to say everything says nothing.
 */
import { Link } from 'react-router-dom';
import { Badge, ClipIcon } from './ui.jsx';
import MoveButtons from './MoveButtons.jsx';
import { STATUS, dueLabel, stepDueLabel } from '../lib/task.js';
import { dateLabel, initialsOf } from '../lib/format.js';

export default function TaskRow({
  task: t,
  showOwner = true,
  /** Show the status chip — off in queues, where every row has the same one. */
  showStatus = false,
  /** Inline action buttons, so the common case never needs the detail page. */
  actionable = false,
  /**
   * Who checked it and what they said. No tab turns this on today — checking
   * a task is now also its final sign-off, so there is no longer a separate
   * "what did the check say" queue the way there was when the CEO's approval
   * came after it — but a row can still ask for it wherever that question
   * matters again.
   */
  showCheck = false,
  onChanged,
  onError,
}) {
  const s = STATUS[t.status] || STATUS.open;
  const due = dueLabel(t.daysToDue, t.status, t.lateSide);
  // The row only gets the red "overdue" treatment when the work itself is
  // late — the owner has not finished it. A task the owner already turned
  // in that is now waiting past its date on somebody else's check is a
  // different problem (and not this row's fault), so it gets its own,
  // quieter treatment instead — see dueLabel() in lib/task.js.
  const doneAwaitingSignOff = t.isOverdue && t.lateSide && t.lateSide !== 'owner';
  /**
   * The next unfinished dated step — but only when there is something to say
   * about it. A row that names the next step on every task doubles its own
   * height for information the "3 of 5" pill already implies; naming it only
   * when it is late or nearly due is the whole value of having dates on the
   * pieces.
   */
  const nextDue = t.nextStep ? stepDueLabel(t.nextStep) : null;
  const next = nextDue && (nextDue.tone === 'critical' || nextDue.tone === 'warning') ? nextDue : null;

  return (
    <div className={`t-row${t.isOverdue ? (doneAwaitingSignOff ? ' pending-review' : ' overdue') : ''}`}>
      <div className="t-main">
        <Link to={`/tasks/${t.id}`} className="t-name">
          {t.name}
        </Link>
        <div className="t-sub">
          <span className="t-client">{t.clientName}</span>
          {showOwner && (
            <span className="t-owner" title={`Owner: ${t.ownerName}`}>
              <span className="t-av" aria-hidden="true">{initialsOf(t.ownerName)}</span>
              {t.ownerName}
            </span>
          )}
          {t.priority === 'high' && <span className="flag-high">High</span>}
          {t.labelName && <span className="flag-label">{t.labelName}</span>}
          {/* Made by a repeating schedule — each one is its own task, so this
              is only a marker, not a different kind of row. */}
          {t.recurringId && (
            <span className="flag-repeat" title="Created by a repeating task">
              ↻ repeats
            </span>
          )}
          {/* Says plainly that the owner's part is done, right next to the
              date that would otherwise read as if they were the ones late. */}
          {doneAwaitingSignOff && <span className="flag-pending">done — awaiting sign-off</span>}
          {t.returnCount > 0 && t.status !== 'approved' && (
            <span className="flag-back" title={t.returnReason || undefined}>
              sent back{t.returnCount > 1 ? ` ${t.returnCount}×` : ''}
            </span>
          )}
          {t.attachmentCount > 0 && (
            <span className="muted small count-files" title={`${t.attachmentCount} file(s)`}>
              <ClipIcon size={12} /> {t.attachmentCount}
            </span>
          )}
          {/* Only when there is a breakdown. A row that says "0 of 0" on every
              task teaches people to stop reading that part of the row. */}
          {t.stepTotal > 0 && (
            <span
              className={`t-steps${t.stepsLate > 0 ? ' late' : ''}`}
              title={
                t.stepsLate > 0
                  ? `${t.stepsLate} step(s) late`
                  : `${t.stepsDone} of ${t.stepTotal} steps done`
              }
            >
              {t.stepsDone}/{t.stepTotal}
            </span>
          )}
          {/* The one thing worth saying about a breakdown on a crowded row:
              what is next, and when. */}
          {next && (
            <span className={`t-next${next.tone ? ` ${next.tone}` : ''}`}>
              next: {t.nextStep.name}
              {next.text ? ` · ${next.text}` : ''}
            </span>
          )}
        </div>

        {/* The CEO's question about a checked task is "who checked it, and
            what did they say" — so the answer sits on the row itself. */}
        {showCheck && t.verifierName && (
          <div className="t-check">
            <span className="tick" aria-hidden="true">
              ✓
            </span>
            <span>
              Checked by {t.verifierName}
              {t.verifiedNote ? <span className="muted"> — “{t.verifiedNote}”</span> : null}
            </span>
          </div>
        )}
      </div>

      {/* The completion date is the whole point of a tracker, so it is read
          first: the date itself, then how many days that leaves. */}
      <div className="t-when">
        <span
          className={`t-date${due?.tone === 'critical' ? ' late' : due?.tone === 'warning' && t.isOverdue ? ' review-late' : ''}`}
        >
          {dateLabel(t.completionDate)}
        </span>
        {due ? (
          <span className={`due ${due.tone}`}>{due.text}</span>
        ) : (
          <span className="small muted">{t.status === 'approved' ? 'signed off' : 'closed'}</span>
        )}
      </div>

      {showStatus && (
        <div className="t-state">
          <Badge tone={s.tone}>{s.short}</Badge>
        </div>
      )}

      {actionable && (
        <div className="t-do">
          <MoveButtons task={t} onDone={onChanged} onError={onError} />
        </div>
      )}
    </div>
  );
}
