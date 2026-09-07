/**
 * Builds one self-contained HTML file that runs the real interface against a
 * frozen copy of the seeded database — no server, no install, no network.
 *
 *   npm run build && node tools/build-preview.mjs
 *
 * How it works. The script boots the API on a scratch port, signs in as the
 * CEO (who can see everything) and records the whole world once: every task,
 * every person, and each task's history and attachment list. Then it signs in
 * as each demo account to capture that person's identity and bell.
 *
 * The shim in the browser then answers from that one shared world rather than
 * from ten per-user snapshots. That matters here: this product is a relay —
 * the owner marks work done, the manager checks it, the CEO approves — and a
 * preview where each login had its own private copy could never show the baton
 * being passed. With a shared world you can mark a task done as the Cloud
 * Engineer, sign in as Alfiya and confirm it, then sign in as Parvez and
 * approve it. Nothing is written to disk, so a reload restarts the demo.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4477;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = process.env.SEED_PASSWORD || 'cloudmojo123';

const CEO = 'parvez@cloudmojo.tech';
const ACCOUNTS = [
  CEO,
  'alfiya@cloudmojo.tech',
  'cloud@cloudmojo.tech',
  'devops@cloudmojo.tech',
  'projects@cloudmojo.tech',
  'sales@cloudmojo.tech',
  'presales@cloudmojo.tech',
  'design@cloudmojo.tech',
  'it@cloudmojo.tech',
  'finance@cloudmojo.tech',
];

/**
 * The capture reads every conversation, and reading a conversation marks it
 * read — so it runs against a throwaway copy of the database. Otherwise
 * building the preview twice would quietly wipe the demo's unread badges.
 */
const scratch = path.join(ROOT, 'server/data/preview-scratch.db');
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join(ROOT, `server/data/tracker.db${suffix}`);
  if (fs.existsSync(src)) fs.copyFileSync(src, scratch + suffix);
}
if (!fs.existsSync(scratch)) {
  console.error('No database to copy. Run `npm run seed` first.');
  process.exit(1);
}

const dist = path.join(ROOT, 'client/dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('No client build found. Run `npm run build` first.');
  process.exit(1);
}

// --- boot the API on a scratch port -----------------------------------------
const server = spawn('node', ['src/index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: {
    ...process.env,
    PORT: String(PORT),
    ALERT_CRON: '0 0 31 2 *',
    DATABASE_FILE: './data/preview-scratch.db',
  },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(250);
  try {
    up = (await fetch(`${BASE}/health`)).ok;
  } catch {
    /* keep waiting */
  }
}
if (!up) {
  server.kill();
  console.error('API did not come up. Is the database seeded? Try `npm run seed`.');
  process.exit(1);
}

const signIn = async (email) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((r) => r.json());
  if (!res.token) {
    server.kill();
    console.error(`Could not sign in as ${email} — is the seed password "${PASSWORD}"?`);
    process.exit(1);
  }
  return res;
};

const getter = (token) => (p) =>
  fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .catch(() => ({}));

// --- the world, captured once through the account that can see all of it ----
const ceoSession = await signIn(CEO);
const asCeo = getter(ceoSession.token);

const [taskList, userList, roleList] = await Promise.all([
  asCeo('/tasks?limit=500'),
  asCeo('/users'),
  asCeo('/users/roles'),
]);

const history = {};
const attachments = {};
for (const t of taskList.tasks) {
  const detail = await asCeo(`/tasks/${t.id}`);
  history[t.id] = detail.history || [];
  attachments[t.id] = detail.attachments || [];
}

// Permissions come from the API's own table, so the shim's `can()` cannot
// drift from what the server enforces.
const permissions = {};
const roleNotes = {};
const roleLabels = {};
for (const r of roleList.roles || []) {
  permissions[r.key] = r.permissions;
  roleNotes[r.key] = r.note;
  roleLabels[r.key] = r.label;
}

// --- who can sign in, what is in each bell, and every conversation ---------
// Chat is captured as one flat message log keyed by the pair, not per account,
// so a message sent in the preview shows up on both sides when you switch
// people — which is the whole point of a hierarchy you can walk.
//
// Two passes, because fetching a conversation marks it read on the server:
// pass one records what is unread for whom, pass two reads the messages.
const accounts = {};
const sessions = {};
const unreadFor = {}; // `${readerId}:${partnerId}` -> count, before anything is read

for (const email of ACCOUNTS) {
  const s = await signIn(email);
  const get = getter(s.token);
  sessions[email] = { token: s.token, user: s.user };

  const notifications = await get('/notifications?limit=60');
  const threads = await get('/chat/threads');
  for (const t of threads.threads || []) {
    unreadFor[`${s.user.id}:${t.partnerId}`] = t.unread;
  }

  accounts[email.toLowerCase()] = {
    user: s.user,
    notifications: notifications.notifications || [],
  };
  console.log(
    `captured ${email.padEnd(24)} ${String(s.user.role).padEnd(7)} · ` +
      `${(notifications.notifications || []).length} in the bell · ` +
      `${(threads.threads || []).length} thread(s)`
  );
}

const chat = { messages: [] };
const seenPairs = new Set();

for (const email of ACCOUNTS) {
  const { token, user } = sessions[email];
  const get = getter(token);
  const threads = await get('/chat/threads');

  for (const t of threads.threads || []) {
    const pair = [user.id, t.partnerId].sort((a, b) => a - b).join('-');
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);

    const conv = await get(`/chat/with/${t.partnerId}`);
    const msgs = (conv.messages || []).map((m) => ({
      id: m.id,
      body: m.body,
      authorId: m.authorId,
      authorName: m.authorName,
      authorRole: m.authorRole,
      // `mine` is per-reader, so the shim derives it rather than storing it.
      partnerId: m.authorId === user.id ? t.partnerId : user.id,
      taskId: m.taskId,
      taskName: m.taskName,
      readAt: m.readAt,
      createdAt: m.createdAt,
    }));

    // Put the unread state back: the newest N messages each side had not
    // opened, so the demo still shows a badge worth clicking.
    for (const [reader, other] of [
      [user.id, t.partnerId],
      [t.partnerId, user.id],
    ]) {
      const n = unreadFor[`${reader}:${other}`] || 0;
      if (!n) continue;
      msgs
        .filter((m) => m.authorId === other)
        .slice(-n)
        .forEach((m) => {
          m.readAt = null;
        });
    }

    chat.messages.push(...msgs);
  }
}
chat.messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

server.kill();
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(scratch + suffix)) fs.rmSync(scratch + suffix);
}

const world = {
  tasks: taskList.tasks,
  users: userList.users,
  teams: userList.teams,
  roles: roleList.roles || [],
  permissions,
  roleNotes,
  roleLabels,
  history,
  attachments,
  accounts,
  chat,
  password: PASSWORD,
};

console.log(
  `\nworld: ${world.tasks.length} tasks · ${world.users.length} people · ` +
    `${chat.messages.length} messages · ` +
    `${Object.values(history).reduce((a, h) => a + h.length, 0)} activity entries · ` +
    `${Object.values(attachments).reduce((a, x) => a + x.length, 0)} attachments`
);

// --- assemble ---------------------------------------------------------------
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const cssFile = indexHtml.match(/href="\/?(assets\/[^"]+\.css)"/)?.[1];
const jsFile = indexHtml.match(/src="\/?(assets\/[^"]+\.js)"/)?.[1];
if (!cssFile || !jsFile) {
  console.error('Could not find the built asset names in dist/index.html.');
  process.exit(1);
}
const css = fs.readFileSync(path.join(dist, cssFile), 'utf8');
const js = fs.readFileSync(path.join(dist, jsFile), 'utf8');
const shim = fs.readFileSync(path.join(ROOT, 'tools/preview-shim.js'), 'utf8');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>A1K Task Tracker — interface preview</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__TRACKER_WORLD__ = ${JSON.stringify(world)};</script>
    <script>
${shim}
    </script>
    <script type="module">
${js}
    </script>
  </body>
</html>
`;

const outDir = path.join(ROOT, 'preview');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'a1k-task-tracker-preview.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
