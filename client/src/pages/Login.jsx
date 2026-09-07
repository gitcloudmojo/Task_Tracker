/**
 * Sign in.
 *
 * The demo accounts are listed on the page on purpose: this is a preview that
 * gets shared, and hunting for a password is a poor first impression. Drop the
 * block before this goes anywhere real.
 */
import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { BrandLockup, CompanyLine } from '../components/Brand.jsx';
import { getTheme } from '../lib/theme.js';

const DEMO = [
  ['parvez@cloudmojo.tech', 'CEO', 'approves what the manager has checked'],
  ['alfiya@cloudmojo.tech', 'Manager', 'assigns the work and checks it came back done'],
  ['cloud@cloudmojo.tech', 'Team member', 'Delivery — does the work'],
  ['devops@cloudmojo.tech', 'Team member', 'has one sent back to redo'],
  ['sales@cloudmojo.tech', 'Team member', 'Sales — one overdue'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('cloudmojo123');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* One lockup, one product name. The name used to appear twice here —
            once from the lockup and once from a second line underneath. */}
        <div className="login-head">
          <BrandLockup theme={getTheme()} height={34} />
          <CompanyLine />
        </div>
        <p className="login-lede">
          Work is assigned, marked done by whoever did it, checked by the manager, then approved by
          the CEO — three pairs of eyes, one record of who did what.
        </p>

        <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@cloudmojo.tech"
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo-block">
          <div className="small muted" style={{ marginBottom: 7 }}>
            Demo accounts — password <code>cloudmojo123</code>
          </div>
          {DEMO.map(([mail, role, note]) => (
            <button key={mail} className="demo-row" onClick={() => setEmail(mail)} type="button">
              <span className="strong">{mail}</span>
              <span className="small muted">
                {role} · {note}
              </span>
            </button>
          ))}
          {/* In the offline preview a task can be walked all the way through
              the chain, but only if you change people with Sign out — a reload
              rebuilds the bundled data and starts the demo over. */}
          {window.__TRACKER_STATIC_PREVIEW__ && (
            <div className="small muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
              To follow one task end to end, mark it done as its owner, then use{' '}
              <strong>Sign out</strong> to come back as Alfiya and confirm it, and again as Parvez to
              approve. Reloading the page starts the demo over.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
