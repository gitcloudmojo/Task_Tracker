import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Tasks from './pages/Tasks.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Chat from './pages/Chat.jsx';
import Team from './pages/Team.jsx';
import Projects from './pages/Projects.jsx';
import Settings from './pages/Settings.jsx';

function Shell() {
  const { user, loading, can } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (!user) return <Login />;

  // Every refusal lands on Home, which needs no permission at all — so a guard
  // can never bounce somebody between two pages that both reject them.
  const home = <Navigate to="/" replace />;
  const guard = (permission, element) => (can(permission) ? element : home);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/tasks" element={guard('tasks.view_all', <Tasks />)} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/chat/:userId" element={<Chat />} />
      <Route path="/team" element={guard('team.view', <Team />)} />
      <Route path="/projects" element={guard('projects.view', <Projects />)} />
      <Route path="/settings" element={<Settings />} />
      {/* The screens that folded into the ones above. Old links still work. */}
      <Route path="/mine" element={home} />
      <Route path="/reports" element={guard('tasks.view_all', <Tasks />)} />
      <Route path="*" element={home} />
    </Routes>
  );
}

export default function App() {
  // The offline preview is a single file opened straight from disk, where there
  // is no server to answer a path — so it routes on the hash.
  const Router = window.__TRACKER_STATIC_PREVIEW__ ? HashRouter : BrowserRouter;
  return (
    <Router>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </Router>
  );
}
