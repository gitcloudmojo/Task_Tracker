/**
 * Projects — manager only.
 *
 * A project here is a client name (tasks.clientName) — the app's own name for
 * "who this work is for", "Internal" included. This screen answers one
 * question: for each one, who is on it.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Layout from '../components/Layout.jsx';
import { Card, Badge, Empty, ErrorBanner } from '../components/ui.jsx';
import { initialsOf } from '../lib/format.js';

const ROLE_TONE = { ceo: 'accent', admin: 'warning', user: '' };

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/projects')
      .then((d) => setProjects(d.projects))
      .catch(setError);
  }, []);

  return (
    <Layout
      title="Projects"
      subtitle={projects ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : undefined}
    >
      <div className="stack">
        <ErrorBanner error={error} />

        {!projects ? (
          <div className="muted">Loading…</div>
        ) : projects.length === 0 ? (
          <Empty>No project has a task yet.</Empty>
        ) : (
          <div className="grid cols-2">
            {projects.map((p) => (
              <Card key={p.name} title={p.name} hint={`${p.people.length} on it`}>
                {p.people.length === 0 ? (
                  <Empty>Nobody currently owns a task here.</Empty>
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
                            <Badge tone={ROLE_TONE[person.role]}>
                              {person.role === 'admin' ? 'Manager' : person.role === 'ceo' ? 'CEO' : 'Team member'}
                            </Badge>
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
    </Layout>
  );
}
