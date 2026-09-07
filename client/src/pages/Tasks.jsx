/**
 * All tasks — the one screen that holds the numbers, the filters and the
 * breakdowns, so Home does not have to.
 *
 * The summary is a sentence rather than a wall of tiles. The filters are the
 * five questions people actually ask, as one row of chips. The breakdown that
 * used to be its own Reports page is a panel at the bottom, closed until
 * somebody wants it.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import TaskRow from '../components/TaskRow.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { Card, Empty, ErrorBanner, Badge, Segmented, StageBar } from '../components/ui.jsx';

const VIEWS = [
  { value: 'live', label: 'Live' },
  { value: 'overdue', label: 'Late' },
  { value: 'submitted', label: 'To check' },
  { value: 'verified', label: 'To approve' },
  { value: 'approved', label: 'Approved' },
  { value: 'all', label: 'All' },
];

const GROUPS = [
  { key: 'byPerson', label: 'By person' },
  { key: 'byClient', label: 'By client' },
  { key: 'byTeam', label: 'By team' },
];

export default function Tasks() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [dash, setDash] = useState(null);
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [group, setGroup] = useState('byPerson');

  const [view, setView] = useState(params.get('view') || 'live');
  const [owner, setOwner] = useState(params.get('owner') || '');
  const [client, setClient] = useState('');
  const [search, setSearch] = useState('');

  const load = () => {
    const q = { limit: 300 };
    if (view === 'live') q.open = 'true';
    else if (view === 'overdue') {
      q.open = 'true';
      q.overdue = 'true';
    } else if (view !== 'all') q.status = view;
    if (owner) q.ownerId = owner;
    if (client) q.client = client;
    if (search) q.q = search;
    api
      .get(`/tasks${qs(q)}`)
      .then((d) => setTasks(d.tasks))
      .catch(setError);
    api.get('/dashboard').then(setDash).catch(() => {});
  };

  useEffect(load, [view, owner, client]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    api.get('/users').then((d) => setPeople(d.users)).catch(() => {});
    api.get('/tasks/clients').then((d) => setClients(d.clients)).catch(() => {});
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (view === 'live') next.delete('view');
    else next.set('view', view);
    if (owner) next.set('owner', owner);
    else next.delete('owner');
    setParams(next, { replace: true });
  }, [view, owner]);

  const t = dash?.totals;
  const rows = dash?.[group] || [];

  return (
    <Layout
      title="All tasks"
      subtitle={
        t
          ? `${t.all} in total · ${t.live} live · ${t.overdue} late · ${dash.stalls.withVerifier} to check · ${dash.stalls.withApprover} to approve`
          : undefined
      }
      actions={
        can('tasks.create') && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New task
          </button>
        )
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />

        <div className="row wrap">
          <Segmented value={view} onChange={setView} options={VIEWS} />
          {can('tasks.view_all') && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Anybody</option>
              {people
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
          <select value={client} onChange={(e) => setClient(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Any client</option>
            {clients.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.tasks})
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search name, client or notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
        </div>

        <Card>
          {tasks.length === 0 ? (
            <Empty>{view === 'overdue' ? 'Nothing is late.' : 'Nothing matches that.'}</Empty>
          ) : (
            <div className="t-list">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showStatus
                  actionable
                  onChanged={load}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </Card>

        {/* What used to be the Reports page. Closed by default: it answers a
            question people ask weekly, not daily. */}
        {rows.length > 0 && (
          <Card
            title="Breakdown"
            collapsible
            defaultCollapsed
            id="tasks-breakdown"
            action={
              <Segmented
                value={group}
                onChange={setGroup}
                options={GROUPS.map((g) => ({ value: g.key, label: g.label }))}
              />
            }
          >
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>{GROUPS.find((g) => g.key === group)?.label.replace('By ', '')}</th>
                    <th className="num">Live</th>
                    <th style={{ width: 190 }}>Sitting where</th>
                    <th className="num">Late</th>
                    <th className="num">To check</th>
                    <th className="num">To approve</th>
                    <th className="num">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="strong">{r.key}</td>
                      <td className="num">{r.live}</td>
                      <td>
                        <StageBar
                          live={r.live}
                          toCheck={r.awaitingReview}
                          toApprove={r.awaitingApproval}
                          title={`${r.live} live: ${r.live - r.awaitingReview - r.awaitingApproval} being worked on, ${r.awaitingReview} to check, ${r.awaitingApproval} to approve`}
                        />
                      </td>
                      <td className="num">
                        {r.overdue ? <Badge tone="critical">{r.overdue}</Badge> : <span className="muted">0</span>}
                      </td>
                      <td className="num">
                        {r.awaitingReview ? <Badge tone="accent">{r.awaitingReview}</Badge> : <span className="muted">0</span>}
                      </td>
                      <td className="num">
                        {r.awaitingApproval ? <Badge tone="warning">{r.awaitingApproval}</Badge> : <span className="muted">0</span>}
                      </td>
                      <td className="num muted">{r.approved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* The bar is only readable with the key, so they live together. */}
            <div className="bar-key" style={{ marginTop: 12 }}>
              <span>
                <i className="working" /> being worked on
              </span>
              <span>
                <i className="checking" /> waiting to be checked
              </span>
              <span>
                <i className="approving" /> waiting for approval
              </span>
            </div>
          </Card>
        )}
      </div>

      {creating && (
        <TaskModal people={people} clients={clients} onClose={() => setCreating(false)} onSaved={load} />
      )}
    </Layout>
  );
}
