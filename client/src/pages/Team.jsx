/**
 * People.
 *
 * Users are everybody in the company — a designer, a salesperson, an engineer,
 * somebody in IT. Their team is a label; their role is only about where they
 * sit in the approval chain, which is why the role reference sits on this page
 * rather than being buried in documentation.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import { Card, Badge, Empty, ErrorBanner, Modal, Field, Segmented } from '../components/ui.jsx';
import { initialsOf } from '../lib/format.js';

const ROLE_TONE = { ceo: 'accent', admin: 'warning', user: '' };

const blank = { name: '', email: '', password: '', role: 'user', team: '', title: '' };

export default function Team() {
  const { user, can } = useAuth();
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('active');

  const load = () =>
    api
      .get('/users')
      .then((d) => {
        setUsers(d.users);
        setTeams(d.teams);
      })
      .catch(setError);

  useEffect(() => {
    load();
    api.get('/users/roles').then((d) => setRoles(d.roles)).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, {
          name: form.name,
          title: form.title || null,
          team: form.team || null,
          role: form.role,
        });
      } else {
        await api.post('/users', form);
      }
      setAdding(false);
      setEditing(null);
      setForm(blank);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    setError(null);
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const shown = users.filter((u) => (filter === 'active' ? u.isActive : true));
  const ready =
    form.name.trim() &&
    (editing || (form.email.trim() && form.password.length >= 8)) &&
    form.role;

  return (
    <Layout
      title="People"
      subtitle={`${users.filter((u) => u.isActive).length} active across every team`}
      actions={
        can('team.manage') && (
          <button
            className="btn primary"
            onClick={() => {
              setForm(blank);
              setAdding(true);
            }}
          >
            + Add person
          </button>
        )
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />

        <div className="row wrap">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'Everybody' },
            ]}
          />
        </div>

        <Card>
          <div className="card-body table-scroll" style={{ padding: 0 }}>
            {shown.length === 0 ? (
              <Empty>Nobody here.</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Team</th>
                    <th className="num">Live</th>
                    <th className="num">Late</th>
                    <th className="num">Being checked</th>
                    <th className="num">Approved</th>
                    {can('team.manage') && <th />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                      <td>
                        <div className="row" style={{ gap: 9 }}>
                          <span className="avatar sm">{initialsOf(u.name)}</span>
                          <span>
                            <Link to={`/tasks?view=all&owner=${u.id}`} className="strong">
                              {u.name}
                            </Link>
                            <div className="small muted">{u.title || u.email}</div>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={ROLE_TONE[u.role]}>{u.roleLabel}</Badge>
                      </td>
                      <td className="nowrap small muted">{u.team || '—'}</td>
                      <td className="num">{u.openTasks}</td>
                      <td className="num">
                        {u.overdueTasks > 0 ? (
                          <Badge tone="critical">{u.overdueTasks}</Badge>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="num">
                        {u.awaitingReview > 0 ? (
                          <Badge tone="warning">{u.awaitingReview}</Badge>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="num muted">{u.approvedTasks}</td>
                      {can('team.manage') && (
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              className="btn sm ghost"
                              onClick={() => {
                                setEditing(u);
                                setForm({
                                  ...blank,
                                  name: u.name,
                                  role: u.role,
                                  team: u.team || '',
                                  title: u.title || '',
                                });
                              }}
                            >
                              Edit
                            </button>
                            <button className="btn sm ghost" onClick={() => toggleActive(u)}>
                              {u.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* The role reference, generated from the permission table the server
            actually enforces — so it cannot go stale. */}
        {roles.length > 0 && (
          <Card
            title="What each role can do"
            hint="from the permissions the API enforces"
            collapsible
            defaultCollapsed
            id="team-roles"
          >
            <div className="grid cols-3">
              {roles.map((r) => (
                <div key={r.key} className="role-card">
                  <div className="row" style={{ gap: 8 }}>
                    <Badge tone={ROLE_TONE[r.key]}>{r.label}</Badge>
                  </div>
                  <div className="small" style={{ marginTop: 6, color: 'var(--ink-secondary)' }}>
                    {r.note}
                  </div>
                  <ul className="perm-list">
                    {Object.entries(r.permissions)
                      .filter(([, v]) => v)
                      .map(([k]) => (
                        <li key={k}>{k}</li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
              Note what the CEO does not hold: creating tasks and managing people are the manager's
              job, so the CEO reviews the work rather than administering the tool. These were called
              indicative at kick-off — they live in one file and are easy to change.
            </div>
          </Card>
        )}
      </div>

      {(adding || editing) && (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'Add a person'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          wide
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setAdding(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={saving || !ready}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add person'}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <ErrorBanner error={error} />
            <div className="grid cols-2">
              <Field label="Full name *">
                <input type="text" value={form.name} onChange={set('name')} autoFocus />
              </Field>
              {!editing && (
                <Field label="Work email *">
                  <input type="email" value={form.email} onChange={set('email')} />
                </Field>
              )}
              {!editing && (
                <Field label="Temporary password *" help="At least 8 characters. They can change it in Settings.">
                  <input type="password" value={form.password} onChange={set('password')} />
                </Field>
              )}
              <Field
                label="Role *"
                help="A team member does the work. A manager assigns it and checks it. The CEO approves."
              >
                <select value={form.role} onChange={set('role')}>
                  <option value="user">Team member</option>
                  <option value="admin">Manager</option>
                  {user.role === 'ceo' && <option value="ceo">CEO</option>}
                </select>
              </Field>
              <Field label="Team" help="A label for grouping — it does not affect what they can do.">
                <select value={form.team} onChange={set('team')}>
                  <option value="">— none —</option>
                  {teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Job title">
                <input type="text" value={form.title} onChange={set('title')} />
              </Field>
            </div>
            {form.role === 'admin' && (
              <div className="notice">
                A manager checks work that has been marked done — but never their own. If a manager
                owns a task, another manager or the CEO has to check it.
              </div>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}
