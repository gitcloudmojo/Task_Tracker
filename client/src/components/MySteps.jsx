/**
 * My steps, away from the task they belong to.
 *
 * This exists because of one decision: a step can be handed to somebody who
 * does not own the parent task. Without a list like this, that step would live
 * somewhere the person never looks, and handing it to them would be a way of
 * losing it rather than a way of getting it done.
 *
 * Each row therefore leads with the step and says which task it came out of —
 * the reverse of the task screen, where the task is the context and the steps
 * are the detail.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { STEP_KIND, stepDueLabel } from '../lib/task.js';
import { dateLabel } from '../lib/format.js';

export default function MySteps({ steps = [], onChanged, onError }) {
  const [busy, setBusy] = useState(null);

  const tick = async (s) => {
    setBusy(s.id);
    try {
      await api.post(`/steps/${s.id}/done`);
      onChanged?.();
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="step-rows mine">
      {steps.map((s) => {
        const dl = stepDueLabel(s);
        const k = STEP_KIND[s.kind] || STEP_KIND.step;
        return (
          <li
            key={s.id}
            className={`step${s.state === 'late' ? ' late' : s.state === 'waiting' ? ' waiting' : ''}`}
          >
            {/* No tick box here, unlike on the task screen: every other row on
                Home puts its verb on the right, and one action wants one
                control. */}
            <div className="step-main">
              <div className="step-name">{s.name}</div>
              <div className="step-sub">
                {s.kind === 'follow_up' && (
                  <span className="step-kind" title={k.hint}>
                    <span aria-hidden="true">{k.icon}</span> Follow-up
                  </span>
                )}
                <Link to={`/tasks/${s.taskId}`} className="step-of">
                  {s.taskName}
                </Link>
                <span className="muted">· {s.clientName}</span>
                {/* Says why this is on your list when the task is not. */}
                {s.onSomebodyElsesTask && (
                  <span className="step-borrowed" title="You hold a step of somebody else's task">
                    their task
                  </span>
                )}
              </div>
            </div>

            <div className="step-when">
              {s.dueDate ? (
                <>
                  <span className={`step-date${s.state === 'late' ? ' late' : ''}`}>
                    {dateLabel(s.dueDate)}
                  </span>
                  {dl && <span className={`due ${dl.tone}`}>{dl.text}</span>}
                </>
              ) : (
                <span className="small muted">no date</span>
              )}
            </div>

            <div className="step-do">
              <button className="btn sm primary" disabled={busy === s.id} onClick={() => tick(s)}>
                {busy === s.id ? '…' : 'Done'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
