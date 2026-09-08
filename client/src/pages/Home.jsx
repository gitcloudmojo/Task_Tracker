/**
 * Home — and for most people, the only screen they need.
 *
 * The design question was "what does this person need to know in the first two
 * seconds", and the answer differs by role but the shape does not:
 *
 *   one sentence  →  one list  →  the actions on each row
 *
 * A team member's list is their own work. The manager's list is everything
 * waiting to be checked — the question she asks every morning, answered before
 * she clicks anything. The CEO's list is what the manager has already checked,
 * which is the only queue that is his to move.
 *
 * Everything that used to crowd this screen — pipeline counts, breakdown
 * tables, filters — moved to All tasks. This page holds one number and one
 * list on purpose.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import TaskRow from '../components/TaskRow.jsx';
import { Card, Empty, ErrorBanner } from '../components/ui.jsx';
import MySteps from '../components/MySteps.jsx';

export default function Home() {
  const { user, can } = useAuth();
  const [queue, setQueue] = useState(null);
  const [dash, setDash] = useState(null);
  const [mine, setMine] = useState([]);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);

  const load = () => {
    api.get('/tasks/queue').then(setQueue).catch(setError);
    api.get('/dashboard').then(setDash).catch(setError);
    // Steps, including the ones on tasks this person does not own — the whole
    // reason a step may be handed across.
    api.get('/steps/mine').then((d) => setSteps(d.steps)).catch(() => {});
    api
      .get('/tasks?mine=true&limit=200')
      .then((d) => setMine(d.tasks))
      .catch(() => {});
  };

  useEffect(load, []);

  if (error && !queue) {
    return (
      <Layout title="Home">
        <ErrorBanner error={error} />
      </Layout>
    );
  }
  if (!queue || !dash) {
    return (
      <Layout title="Home">
        <Empty>Loading…</Empty>
      </Layout>
    );
  }

  const firstName = user.name.split(' ')[0];
  const isManager = can('tasks.verify');
  const isCeo = can('tasks.approve');

  const myOpen = mine.filter((t) => t.status === 'open');
  const myWaiting = mine.filter((t) => t.status === 'submitted' || t.status === 'verified');
  const myDone = mine.filter((t) => t.status === 'approved');
  const sentBack = myOpen.filter((t) => t.returnCount > 0 && t.returnedAt);

  /**
   * The tabs, in the order this role cares about them. The first one is what
   * the page opens on, so each role lands on their own queue without choosing.
   */
  const tabs = [];
  if (isCeo) {
    tabs.push({
      key: 'approve',
      label: 'To approve',
      count: queue.toApprove.length,
      rows: queue.toApprove,
      hint: 'checked by your manager — yours is the final word',
      showCheck: true,
      empty: 'Nothing waiting on your approval.',
      showOwner: true,
    });
  }
  if (isManager) {
    tabs.push({
      key: 'check',
      label: 'To check',
      count: queue.toVerify.length,
      rows: queue.toVerify,
      hint: 'the person says it is done — confirm it, and it goes to the CEO',
      empty: 'Nothing waiting to be checked.',
      showOwner: true,
    });
  }
  tabs.push({
    key: 'todo',
    label: isManager || isCeo ? 'My own tasks' : 'To do',
    count: myOpen.length,
    rows: myOpen,
    hint: 'mark each one done when it is finished',
    empty: 'Nothing on your own list.',
    showOwner: false,
  });

  /**
   * Steps get a tab only when there are some.
   *
   * An always-present tab reading "0" is a tab people learn to skip, and it
   * would push the queues that matter along the row for no reason.
   */
  if (steps.length > 0) {
    tabs.push({
      key: 'steps',
      kind: 'steps',
      label: 'My steps',
      count: steps.length,
      rows: steps,
      hint: 'pieces of work and check-backs — tick each one when it is done',
      empty: 'Nothing outstanding.',
    });
  }

  // A reviewer's own submitted and approved work is a footnote, not a tab —
  // they have All tasks for that. For a team member it is the other half of
  // their working week, so they keep both.
  if (!isManager && !isCeo) {
    tabs.push({
      key: 'waiting',
      label: 'With the manager',
      count: myWaiting.length,
      rows: myWaiting,
      hint: 'you have marked these done — they are with somebody else now',
      empty: 'Nothing of yours is waiting.',
      showOwner: false,
      showStatus: true,
      actionable: false,
    });
    tabs.push({
      key: 'done',
      label: 'Approved',
      count: myDone.length,
      rows: myDone,
      hint: 'signed off',
      empty: 'Nothing approved yet.',
      showOwner: false,
      actionable: false,
    });
  }

  const active = tabs.find((t) => t.key === tab) || tabs[0];

  // The headline: one sentence naming the single most pressing thing.
  const onMe = (isCeo ? queue.toApprove.length : 0) + (isManager ? queue.toVerify.length : 0);
  const lateMine = myOpen.filter((t) => t.isOverdue).length;
  /**
   * The steps worth interrupting somebody about: late, or a follow-up whose day
   * has come, or due within a couple of days. Anything further out lives on the
   * My steps tab and does not need a callout.
   */
  const needStep = steps.filter((s) => ['late', 'waiting', 'soon'].includes(s.state));
  const lateSteps = steps.filter((s) => s.state === 'late' || s.state === 'waiting').length;
  // Tasks not yet late whose breakdown has slipped — the early warning, and the
  // one thing nothing else in the app is saying.
  const slipping = (dash.slipping || []).filter((t) => t.taskStillInTime);
  const line = () => {
    if (onMe > 0 && myOpen.length > 0) {
      return `${onMe} waiting on you, and ${myOpen.length} of your own.`;
    }
    if (onMe > 0) return `${onMe} waiting on you.`;
    if (lateMine > 0) return `${lateMine} of your ${lateMine === 1 ? 'task is' : 'tasks are'} past its date.`;
    // A late step is the earliest warning anybody gets that a task will slip,
    // so it is worth the headline when nothing louder is happening.
    if (lateSteps > 0) {
      return `${lateSteps} step${lateSteps === 1 ? '' : 's'} of yours ${lateSteps === 1 ? 'needs' : 'need'} attention.`;
    }
    if (myOpen.length > 0) return `${myOpen.length} on your list. Nothing late.`;
    return 'Nothing waiting on you.';
  };

  return (
    <Layout title={`Good day, ${firstName}`} subtitle={line()}>
      <div className="stack">
        <ErrorBanner error={error} />

        {/* Three things must not be scrolled past, in this order: work that
            came back, pieces of your own work that have slipped, and tasks
            whose insides have slipped while the task itself still looks fine.
            All three sit above the tabs, because a tab nobody has clicked
            hides whatever is in it. */}
        {sentBack.map((t) => (
          <div key={t.id} className="callout warn">
            <div>
              <strong>Sent back:</strong>{' '}
              <Link to={`/tasks/${t.id}`}>{t.name}</Link>
              <div className="small" style={{ marginTop: 3 }}>
                {t.returnerName}: “{t.returnReason}”
              </div>
            </div>
          </div>
        ))}

        {needStep.length > 0 && (
          <div className="callout warn">
            <div>
              <strong>
                {needStep.length} step{needStep.length === 1 ? '' : 's'} of yours{' '}
                {needStep.length === 1 ? 'needs' : 'need'} attention
              </strong>
              <ul className="callout-list">
                {needStep.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <Link to={`/tasks/${s.taskId}`}>{s.name}</Link>
                    <span className={`due ${s.state === 'late' ? 'critical' : 'warning'}`}>
                      {s.state === 'late'
                        ? `${Math.abs(s.daysToDue)}d late`
                        : s.state === 'waiting'
                          ? 'your turn'
                          : s.daysToDue === 0
                            ? 'today'
                            : `in ${s.daysToDue}d`}
                    </span>
                    <span className="muted">· {s.taskName}</span>
                  </li>
                ))}
              </ul>
              {needStep.length > 4 && (
                <div className="small muted" style={{ marginTop: 4 }}>
                  and {needStep.length - 4} more under My steps.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Only the ones the rest of the app is quiet about. A task that is
            itself late already shouts from every list it appears in. */}
        {slipping.length > 0 && (
          <div className="callout warn">
            <div>
              <strong>
                {slipping.length === 1 ? 'A task is' : `${slipping.length} tasks are`} slipping
                inside
              </strong>
              <ul className="callout-list">
                {slipping.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`}>{t.name}</Link>
                    <span className="due critical">
                      {t.lateSteps} step{t.lateSteps === 1 ? '' : 's'} late
                    </span>
                    <span className="muted">
                      {/* Naming the reader back to themselves reads oddly, so
                          the owner appears only when it is somebody else. */}
                      {t.ownerName !== user.name ? `· ${t.ownerName} ` : ''}· task itself due{' '}
                      {t.daysToDue === 0 ? 'today' : `in ${t.daysToDue}d`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab${active.key === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className={`tab-count${t.count > 0 && t.key === active.key ? ' on' : ''}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <Card hint={active.rows.length ? active.hint : undefined}>
          {active.rows.length === 0 ? (
            <Empty>{active.empty}</Empty>
          ) : active.kind === 'steps' ? (
            <MySteps steps={active.rows} onChanged={load} onError={setError} />
          ) : (
            <div className="t-list">
              {active.rows.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showOwner={active.showOwner}
                  showStatus={active.showStatus}
                  showCheck={active.showCheck}
                  actionable={active.actionable !== false}
                  onChanged={load}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </Card>

        {/* One quiet line for the wider picture, for whoever can see it. Not a
            grid of numbers — a sentence with a way in. */}
        {!dash.ownOnly && (
          <div className="footnote">
            Across the company: {dash.totals.live} live
            {dash.totals.overdue > 0 && <> · <strong className="bad">{dash.totals.overdue} late</strong></>}
            {' · '}
            {dash.stalls.withOwner} being worked on · {dash.stalls.withVerifier} to check ·{' '}
            {dash.stalls.withApprover} to approve
            <Link className="footnote-link" to="/tasks">
              See all tasks →
            </Link>
          </div>
        )}
      </div>
    </Layout>
  );
}
