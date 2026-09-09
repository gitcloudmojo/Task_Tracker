/**
 * Projects — manager only.
 *
 * Deliberately not derived from tasks. A task's "Client" field is billing
 * information; this is the manager's own note of who is on which engagement,
 * kept and edited by hand. Nothing else in the app reads it, and nothing here
 * ever touches a task.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Layout from '../components/Layout.jsx';
import { Card, Badge, Empty, ErrorBanner, Modal, Field } from '../components/ui.jsx';
import { initialsOf } from '../lib/format.js';

const ROLE_TONE = { ceo: 'accent', admin: 'warning', user: '' };
const ROLE_WORD = { ceo: 'CEO', admin: 'Manager', user: 'Team member' };

const blank = { name: '', memberIds: [] };

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api
      .get('/projects')
      .then((d) => setProjects(d.projects))
      .catch(setError);

  useEffect(() => {
    load();
    api
      .get('/users')
      .then((d) => setPeople(d.users.filter((u) => u.isActive)))
      .catch(() => {});
  }, []);

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm(blank);
  };

  const toggleMember = (id) =>
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(id)
        ? f.memberIds.filter((x) => x !== id)
        : [...f.memberIds, id],
    }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), memberIds: form.memberIds };
      if (editing) {
        await api.patch(`/projects/${editing.id}`, payload);
      } else {
        await api.post('/projects', payload);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (project) => {
    setSaving(true);
    setError(null);
    try {
      await api.del(`/projects/${project.id}`);
      closeModal();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const ready = form.name.trim().length >= 2;

  return (
    <Layout
      title="Projects"
      subtitle={
        projects
          ? `${projects.length} project${projects.length === 1 ? '' : 's'} — your own note of who is on what`
          : undefined
      }
      actions={
        <button
          className="btn primary"
          onClick={() => {
            setForm(blank);
            setAdding(true);
          }}
        >
          + Add project
        </button>
      }
    >
      <div className="stack">
        <ErrorBanner error={error} />

        {!projects ? (
          <div className="muted">Loading…</div>
        ) : projects.length === 0 ? (
          <Empty>No project yet — add one to start keeping track.</Empty>
        ) : (
          <div className="grid cols-2">
            {projects.map((p) => (
              <Card
                key={p.id}
                title={p.name}
                hint={`${p.people.length} on it`}
                action={
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setForm({ name: p.name, memberIds: p.people.map((m) => m.id) });
                      setEditing(p);
                    }}
                  >
                    Edit
                  </button>
                }
              >
                {p.people.length === 0 ? (
                  <Empty>Nobody added yet.</Empty>
                ) : (
                  <div className="stack" style={{ gap: 10 }}>
                    {p.people.map((person) => (
                      <div
                        key={person.id}
                        className="row"
                        style={{ gap: 9, opacity: person.isActive ? 1 : 0.55 }}
                      >
                        <span className="avatar sm">{initialsOf(person.name)}</span>
                        <span>
                          <Link to={`/tasks?view=all&owner=${person.id}`} className="strong">
                            {person.name}
                          </Link>
                          <div className="small muted">
                            <Badge tone={ROLE_TONE[person.role]}>{ROLE_WORD[person.role]}</Badge>
                            {person.title ? ` · ${person.title}` : ''}
                            {person.team ? ` · ${person.team}` : ''}
                          </div>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {(adding || editing) && (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'Add a project'}
          onClose={closeModal}
          wide
          footer={
            <>
              {editing && (
                <button
                  className="btn danger"
                  onClick={() => remove(editing)}
                  disabled={saving}
                  style={{ marginRight: 'auto' }}
                >
                  Remove project
                </button>
              )}
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={saving || !ready}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add project'}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <ErrorBanner error={error} />
            <Field label="Project name *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </Field>
            <Field label="Members" help="Just a note for you — this does not assign or change any task.">
              {people.length === 0 ? (
                <div className="small muted">Nobody active to add yet.</div>
              ) : (
                <div
                  className="stack"
                  style={{
                    gap: 2,
                    maxHeight: 280,
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 6,
                  }}
                >
                  {people.map((p) => (
                    <label
                      key={p.id}
                      className="row"
                      style={{ gap: 9, padding: '6px 6px', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={form.memberIds.includes(p.id)}
                        onChange={() => toggleMember(p.id)}
                      />
                      <span className="avatar sm">{initialsOf(p.name)}</span>
                      <span>
                        <span className="strong">{p.name}</span>
                        <span className="small muted"> · {p.title || ROLE_WORD[p.role]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
