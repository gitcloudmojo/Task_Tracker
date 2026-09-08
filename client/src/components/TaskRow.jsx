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
import { dateLabel } from '../lib/format.js';

export default function TaskRow({
  task: t,
  showOwner = true,
  /** Show the status chip — off in queues, where every row has the same one. */
  showStatus = false,
  /** Inline action buttons, so the common case never needs the detail page. */
  actionable = false,
  /** Who checked it and what they said — the CEO's whole question. */
  showCheck = false,
  onChanged,
  onError,
}) {
  const s = STATUS[t.status] || STATUS.open;
  const due = dueLabel(t.daysToDue, t.status);
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
    <div className={`t-row${t.isOverdue ? ' overdue' : ''}`}>
      <div className="t-main">
        <Link to={`/tasks/${t.id}`} className="t-name">
          {t.name}
        </Link>
        <div className="t-sub">
          <span className="t-client">{t.clientName}</span>
          {showOwner && <span className="muted">· {t.ownerName}</span>}
          {t.priority === 'high' && <span className="flag-high">High</span>}
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
        <span className={`t-date${due?.tone === 'critical' ? ' late' : ''}`}>
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
