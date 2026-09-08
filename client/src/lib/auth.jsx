import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, clearToken, getToken, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  /**
   * Signing in always lands on Home.
   *
   * The router keeps whatever URL the browser was on, so a session that expired
   * on /tasks/7 — or a second person signing in on a shared machine — would
   * otherwise arrive inside somebody else's task. Home is the one screen every
   * role can read, and it is where a person expects to start.
   */
  const login = useCallback(
    async (email, password) => {
      const d = await api.post('/auth/login', { email, password });
      setToken(d.token);
      setUser(d.user);
      navigate('/', { replace: true });
      return d.user;
    },
    [navigate]
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    // Leave the address bar on Home too, so the next sign-in starts clean.
    navigate('/', { replace: true });
  }, [navigate]);

  /**
   * Permission check for the UI. The server enforces the same rules on every
   * request — this only decides what to render, so a stale client can never
   * grant itself anything.
   */
  const can = useCallback((key) => Boolean(user?.permissions?.[key]), [user]);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
