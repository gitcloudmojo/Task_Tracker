/**
 * The shell: sidebar, top bar, the bell.
 *
 * The menu is built from permissions, so a user never sees a link that would
 * refuse them. The one badge in the sidebar is the count of things sitting on
 * this person's desk — the number that decides whether they need to open the
 * app at all today.
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { initialsOf } from '../lib/format.js';
import { getTheme, applyTheme } from '../lib/theme.js';
import { BrandLockup, BrandMark, CompanyLine } from './Brand.jsx';
import { Switch } from './ui.jsx';
import Alerts from './Alerts.jsx';

/**
 * Five items at most, and a team member only ever sees three — Projects is
 * manager-only, so it never adds a fourth for them. Every screen that used to
 * be here — My tasks, Reports — folded into one of these, because a menu is a
 * list of decisions and most of those decisions were not real.
 */
const NAV = [
  { to: '/', label: 'Home', icon: '◱', permission: null, badge: 'desk' },
  { to: '/tasks', label: 'All tasks', icon: '☰', permission: 'tasks.view_all' },
  { to: '/chat', label: 'Chat', icon: '✉', permission: null, badge: 'chat' },
  { to: '/team', label: 'People', icon: '⚇', permission: 'team.view' },
  { to: '/projects', label: 'Projects', icon: '▤', permission: 'projects.view' },
];

const RAIL_KEY = 'cloudmojo.tracker.sidebar';

export default function Layout({ title, subtitle, actions, children }) {
  const { user, logout, can } = useAuth();
  const [deskCount, setDeskCount] = useState(0);
  const [chatCount, setChatCount] = useState(0);
  const [store, setStore] = useState(null);
  const [theme, setTheme] = useState(getTheme());
  const [rail, setRail] = useState(() => storage.get(RAIL_KEY) === 'collapsed');

  // The bell keeps its own counts and its own polling — see Alerts.jsx. What is
  // left here is the two numbers the sidebar shows.
  const load = () => {
    api
      .get('/tasks/queue')
      .then((d) => setDeskCount(d.toDo.length + d.toVerify.length + d.toApprove.length))
      .catch(() => {});
    api
      .get('/chat/threads')
      .then((d) => setChatCount(d.unreadTotal))
      .catch(() => {});
    // On a workbook, whether the file can be written is everybody's business.
    api.get('/store').then(setStore).catch(() => {});
  };

  useEffect(() => {
    load();
    // A minute is plenty for deadline work and keeps the server simple.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const toggleRail = () => {
    const next = !rail;
    setRail(next);
    storage.set(RAIL_KEY, next ? 'collapsed' : 'expanded');
  };

  const setDark = (dark) => {
    const next = dark ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className={`app${rail ? ' rail' : ''}`}>
      <aside className="sidebar">
        {/* A1K is the platform, Task Tracker is the solution — so the lockup
            carries both, once. Collapsed, the logo alone stands in. */}
        <div className="brand">{rail ? <BrandMark size={18} theme={theme} /> : <BrandLockup theme={theme} />}</div>

        <button className="rail-toggle" onClick={toggleRail} aria-label={rail ? 'Expand' : 'Collapse'}>
          <span aria-hidden="true">{rail ? '»' : '«'}</span>
          {!rail && <span className="rail-toggle-label">Collapse</span>}
        </button>

        {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            title={rail ? n.label : undefined}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {/* Collapsed, the count rides on the icon as a pip rather than
                sitting in the row — a badge with `margin-left: auto` pushed the
                icon off centre, so the two rows that had one did not line up
                with the four that did not. */}
            <span className="nav-icon" aria-hidden="true">
              {n.icon}
              {rail && n.badge === 'desk' && deskCount > 0 && (
                <span className="nav-pip">{deskCount > 9 ? '9+' : deskCount}</span>
              )}
              {rail && n.badge === 'chat' && chatCount > 0 && (
                <span className="nav-pip">{chatCount > 9 ? '9+' : chatCount}</span>
              )}
            </span>
            <span className="nav-text">{n.label}</span>
            {!rail && n.badge === 'desk' && deskCount > 0 && (
              <span className="count alert">{deskCount}</span>
            )}
            {!rail && n.badge === 'chat' && chatCount > 0 && (
              <span className="count alert">{chatCount}</span>
            )}
          </NavLink>
        ))}

        {!rail && <div className="nav-label">Account</div>}
        <NavLink
          to="/settings"
          title={rail ? 'Settings' : undefined}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon" aria-hidden="true">
            ⚙
          </span>
          <span className="nav-text">Settings</span>
        </NavLink>

        <div className="sidebar-footer">
          {rail ? (
            <div className="avatar" title={`${user.name} — ${user.roleLabel}`}>
              {initialsOf(user.name)}
            </div>
          ) : (
            <div style={{ padding: '0 10px 10px' }}>
              <div style={{ fontWeight: 560, fontSize: 13 }}>{user.name}</div>
              <div className="small muted">
                {user.roleLabel}
                {user.team ? ` · ${user.team}` : ''}
              </div>
            </div>
          )}
          <button className="nav-item" style={{ width: '100%' }} onClick={logout}>
            <span className="nav-icon" aria-hidden="true">
              ⏻
            </span>
            <span className="nav-text">Sign out</span>
          </button>
          {!rail && (
            <div style={{ padding: '10px 10px 0' }}>
              <CompanyLine prefix="A1K · by CloudMojo Tech" />
            </div>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <div className="topbar-actions">
            {actions}
            <Switch
              on={theme === 'dark'}
              onChange={setDark}
              label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
              onIcon="☾"
              offIcon="☀"
            />
            <Alerts />
          </div>
        </header>
        {/* One line, only when the store cannot be written. Everything else
            about where the data lives belongs in Settings. */}
        {store?.blocked && (
          <div className="store-bar">
            <strong>The workbook is open in Excel.</strong> Your changes are saved and will be
            written to the file as soon as it is closed.
          </div>
        )}

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
