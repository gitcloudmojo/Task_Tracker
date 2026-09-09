/** Sign in. */
import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { BrandLockup, CompanyLine } from '../components/Brand.jsx';
import { getTheme } from '../lib/theme.js';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      </div>
    </div>
  );
}
