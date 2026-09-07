import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Layout from '../components/Layout.jsx';
import { Card, Field, ErrorBanner } from '../components/ui.jsx';

/** Where the data lives, in one card. */
function StoreCard({ store }) {
  const workbook = store.mode === 'workbook';
  if (store.mode === 'preview') return null;
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '—');
  return (
    <Card
      title={`Edition — ${store.edition || (workbook ? 'Excel Edition' : 'Standard')}`}
      hint={workbook ? 'your workbook is the record' : 'the app keeps its own database'}
      collapsible
      defaultCollapsed={!workbook}
      id="settings-store"
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="kv">
          <span>Data lives in</span>
          <span>{workbook ? 'an Excel workbook' : 'a database file'}</span>
          <span>File</span>
          <span className="mono-ish">{store.file}</span>
          {workbook && (
            <>
              <span>Last saved</span>
              <span>{when(store.lastSavedAt)}</span>
              <span>Last read</span>
              <span>{when(store.lastLoadedAt)}</span>
              <span>Unsaved changes</span>
              <span>{store.unsaved ? 'yes — saving shortly' : 'none'}</span>
            </>
          )}
          <span>Attachments</span>
          <span className="mono-ish">{store.attachmentsDir}</span>
        </div>

        {workbook && store.blocked && (
          <div className="callout warn">
            <div>
              <strong>The workbook is open somewhere else.</strong>
              <div style={{ marginTop: 2 }}>
                Changes are being kept in <code>{store.blocked.pending?.split('/').pop()}</code> and
                will be written as soon as the file is free. Close it in Excel.
              </div>
            </div>
          </div>
        )}

        {workbook && store.conflicts?.length > 0 && (
          <div className="callout warn">
            <div>
              <strong>Somebody edited the workbook while the app was mid-change.</strong>
              <div style={{ marginTop: 2 }}>
                The app's version was kept. Theirs is saved beside it as{' '}
                {store.conflicts.map((c) => (
                  <code key={c} style={{ marginRight: 6 }}>
                    {c}
                  </code>
                ))}
              </div>
            </div>
          </div>
        )}

        {workbook && store.problems?.length > 0 && (
          <div className="callout bad">
            <div>
              <strong>{store.problems.length} row(s) in the workbook could not be read.</strong>
              <ul className="problem-list">
                {store.problems.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {store.problems.length > 8 && (
                <div className="small muted">…and {store.problems.length - 8} more.</div>
              )}
            </div>
          </div>
        )}

        {workbook && (
          <div className="small muted" style={{ lineHeight: 1.6 }}>
            You can type into the Tasks and People sheets — the app picks changes up within a few
            seconds and numbers any new rows. Leave the status columns and the history to the app:
            those are the approval chain, and it is what keeps them honest.
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Settings() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [days, setDays] = useState(String(user.reminderDaysBefore));
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [store, setStore] = useState(null);

  // Where the data actually lives. Worth showing plainly: on a workbook, the
  // answer is a file somebody could be looking at right now.
  useEffect(() => {
    api.get('/store').then(setStore).catch(() => {});
  }, []);

  const saveProfile = async () => {
    setError(null);
    setSaved(null);
    try {
      const d = await api.patch('/auth/me', { name, reminderDaysBefore: Number(days) });
      setUser(d.user);
      setSaved('Profile updated.');
    } catch (err) {
      setError(err);
    }
  };

  const savePassword = async () => {
    setError(null);
    setSaved(null);
    try {
      await api.patch('/auth/me', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setSaved('Password changed.');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Layout title="Settings" subtitle="Your account and how you get nudged">
      <div className="stack" style={{ maxWidth: 620 }}>
        <ErrorBanner error={error} />
        {saved && <div className="notice">{saved}</div>}

        {store && <StoreCard store={store} />}

        <Card title="Profile">
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Name">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" value={user.email} disabled />
            </Field>
            <Field label="Role">
              <input type="text" value={`${user.roleLabel}${user.team ? ` · ${user.team}` : ''}`} disabled />
            </Field>
            <Field
              label="Remind me this many days before a completion date"
              help="0 means you only hear about it on the day. Overdue tasks nag daily regardless."
            >
              <input type="number" min="0" max="30" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <div>
              <button className="btn primary" onClick={saveProfile}>
                Save profile
              </button>
            </div>
          </div>
        </Card>

        <Card title="Password" collapsible defaultCollapsed id="set-password">
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Current password">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" help="At least 8 characters.">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <div>
              <button
                className="btn"
                onClick={savePassword}
                disabled={!currentPassword || newPassword.length < 8}
              >
                Change password
              </button>
            </div>
          </div>
        </Card>

        <Card title="How the chain works" collapsible defaultCollapsed id="set-chain">
          <div className="small" style={{ color: 'var(--ink-secondary)', lineHeight: 1.7 }}>
            You submit a task when you consider it done. An admin verifies it — checking the work,
            not just the box — and then the CEO gives the final approval. Either reviewer can send
            it back, and they have to say why; the reason lands on your task and in your alerts.
            <br />
            <br />
            Nobody reviews their own work. If an admin owns a task, another admin or the CEO has to
            verify it. The one exception is a task the CEO owns: with nobody above them, an admin's
            verification completes it, and the record says so.
            <br />
            <br />
            Alerts watch three things: your completion dates, submissions nobody has verified, and
            verified work nobody has approved. The last two matter because from a client's point of
            view a task stuck in a review queue is just as late as one nobody started.
          </div>
        </Card>
      </div>
    </Layout>
  );
}
