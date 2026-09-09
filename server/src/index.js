/**
 * The Express app — Vercel/Turso edition.
 *
 * Two changes from the on-prem edition, both because there is no
 * long-running process any more:
 *
 *   1. This module exports the app; it does not call `app.listen()` itself.
 *      `api/index.js` is the actual Vercel entry point and calls `listen()`
 *      only when running locally (see the bottom of this file) — under
 *      Vercel, the platform's Node runtime hands requests to the exported
 *      app directly.
 *   2. It no longer serves the built client (`express.static(...)`) or
 *      starts the in-process alert scheduler. In this deployment the client
 *      is its own static build, served by Vercel alongside these functions
 *      (see vercel.json), and the alert sweep is triggered by Vercel Cron
 *      hitting /api/cron/alerts (see services/alerts.js and that route).
 */
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { db, ensureMigrated, storeStatus, EDITION } from './db/index.js';
import { HttpError } from './lib/validate.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import taskRoutes from './routes/tasks.js';
import attachmentRoutes from './routes/attachments.js';
import notificationRoutes from './routes/notifications.js';
import stepRoutes from './routes/steps.js';
import dashboardRoutes from './routes/dashboard.js';
import chatRoutes from './routes/chat.js';
import projectRoutes from './routes/projects.js';
import adminRoutes from './routes/admin.js';

export const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Every request first waits on the schema existing — cheap once warm, since
// ensureMigrated() only actually runs migrate() once per cold start.
app.use((req, res, next) => {
  ensureMigrated().then(() => next(), next);
});

app.get(
  '/api/health',
  async (req, res, next) => {
    try {
      const users = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
      const tasks = (await db.prepare('SELECT COUNT(*) AS c FROM tasks').get()).c;
      res.json({
        ok: true,
        users,
        tasks,
        edition: EDITION,
        store: storeStatus().mode,
        time: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

app.get('/api/store', (req, res) => res.json(storeStatus()));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/steps', stepRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'No such endpoint' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

// Local development only — `npm run dev` inside server/. Under Vercel,
// process.env.VERCEL is set and api/index.js hands requests to `app`
// directly without ever calling listen().
if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`A1K Task Tracker · ${EDITION} — http://localhost:${config.port}`);
    console.log(`Turso: ${config.tursoUrl}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use.`);
      process.exit(1);
    }
    throw err;
  });
}
