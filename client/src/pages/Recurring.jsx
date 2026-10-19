/**
 * Repeating tasks.
 *
 * A row here is a schedule, not a task: each time it comes round the server
 * creates an ordinary task from it (its own deadline, its own check and
 * sign-off) — see services/recurring.js. This page is where a schedule is
 * made, changed, paused or stopped; the tasks it creates live in the normal
 * lists, marked with ↻.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { Card, Badge, Empty, ErrorBanner, Modal } from '../components/ui.jsx';
import { shortDay } from '../lib/recurring.js';

export default function Recurring() {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () =>
    api
      .get('/recurring')
      .then(setData)
      .catch(setError);

  useEffect(() => {
    load();
    // Only needed for the form; a team member's request for these is allowed
    // too (it is the same lists the New task button uses).
    api.get('/users').then((d) => setPeople(d.users)).catch(() => {});
    api.get('/tasks/clients').then((d) => setClients(d.clients)).catch(() => {});
  }, []);

  const toggle = async (s) => {
    setBusyId(s.id);
    setError(null);
    try {
      await api.patch(`/recurring/${s.id}`, { active: !s.active });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    setBusyId(removing.id);
    setError(null);
    try {
      await api.del(`/recurring/${removing.id}`);
      setRemoving(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const schedules = data?.schedules || [];
  const active = schedules.filter((s) => s.active).length;
  const viewAll = can('tasks.view_all');

  return (
    <Layout
      title="Repeating tasks"
      subtitle={
        data
          ? `${active} active${schedules.length - active ? ` · ${schedules.length - active} paused` : ''} — a new task is created automatically each time`
          : undefined
      }
      actions={
        data?.canCreate && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New repeating task
          </button>
        )
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />

        <Card>
          {!data ? (
            <Empty>Loading…</Empty>
          ) : schedules.length === 0 ? (
            <Empty>
              Nothing repeats yet. Use <strong>+ New repeating task</strong> for work that comes round
              on a rhythm — checking tenders every Monday, a weekly report, month-end — and each
              time, a fresh task appears with its own deadline.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Owner</th>
                    <th>Repeats</th>
                    <th>Next one</th>
                    <th className="num">Tasks so far</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id} style={{ opacity: s.active ? 1 : 0.6 }}>
                      <td>
                        <div className="strong">{s.name}</div>
                        <div className="small muted">
                          {s.clientName}
                          {s.labelName ? <span className="flag-label" style={{ marginLeft: 8 }}>{s.labelName}</span> : null}
                        </div>
                      </td>
                      <td className="nowrap">{s.ownerName}</td>
                      <td>
                        <div>{s.scheduleText}</div>
                        <div className="small muted">
                          {s.dueAfterDays > 0
                            ? `due ${s.dueAfterDays} day${s.dueAfterDays === 1 ? '' : 's'} after`
                            : 'due the same day'}
                          {s.endDate ? ` · ends ${shortDay(s.endDate)}` : ''}
                        </div>
                      </td>
                      <td className="nowrap">{s.active && s.nextDate ? shortDay(s.nextDate) : <span className="muted">—</span>}</td>
                      <td className="num">
                        {viewAll && s.taskCount > 0 ? (
                          <Link to={`/tasks?view=all&recurring=${s.id}`} className="strong">
                            {s.taskCount}
                          </Link>
                        ) : (
                          s.taskCount
                        )}
                        {s.lateCount > 0 && (
                          <span style={{ marginLeft: 6 }}>
                            <Badge tone="critical">{s.lateCount} late</Badge>
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={s.active ? 'good' : ''}>{s.active ? 'Active' : 'Paused'}</Badge>
                      </td>
                      <td>
                        {s.canEdit && (
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn sm ghost" onClick={() => setEditing(s)}>
                              Edit
                            </button>
                            <button className="btn sm ghost" onClick={() => toggle(s)} disabled={busyId === s.id}>
                              {s.active ? 'Pause' : 'Resume'}
                            </button>
                            <button className="btn sm ghost" onClick={() => setRemoving(s)}>
                              Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="footnote">
          Pausing stops new tasks and picks up from the day you resume — it never back-fills the gap.
          Removing a schedule keeps every task it already made.
        </div>
      </div>

      {creating && (
        <TaskModal
          startRepeating
          people={people}
          clients={clients}
          onClose={() => setCreating(false)}
          onSaved={load}
        />
      )}
      {editing && (
        <TaskModal
          schedule={editing}
          people={people}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {removing && (
        <Modal
          title="Remove this repeating task?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRemoving(null)}>
                Keep it
              </button>
              <button className="btn danger" onClick={remove} disabled={busyId === removing.id}>
                {busyId === removing.id ? 'Removing…' : 'Remove schedule'}
              </button>
            </>
          }
        >
          <div className="small" style={{ lineHeight: 1.7 }}>
            <strong>{removing.name}</strong> will stop creating tasks.{' '}
            {removing.taskCount > 0
              ? `The ${removing.taskCount} task${removing.taskCount === 1 ? '' : 's'} it already made stay exactly as they are, with their history, as ordinary tasks.`
              : 'It has not made any tasks yet.'}{' '}
            To stop it temporarily instead, use Pause.
          </div>
        </Modal>
      )}
    </Layout>
  );
}
