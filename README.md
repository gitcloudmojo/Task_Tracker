# A1K Task Tracker

Work is assigned, marked done by whoever did it, checked by the manager, then
approved by the CEO. Three pairs of eyes, one record of who did what.

One solution on the **A1K** platform, by **CloudMojo Tech**.

```
to do ──mark done──▶ with the manager ──confirm──▶ with the CEO ──approve──▶ approved
                          │                            │
                          └────────── send back ───────┴──▶ back to the owner, with a reason
```

Three rules hold the whole thing together, and all three say the same thing —
nobody signs off their own work:

1. Only the owner marks a task done. Not the manager on their behalf.
2. The checker is never the owner.
3. The approver is never the owner either.

---

## Two editions, one codebase

| | **Standard** | **Excel Edition** |
|---|---|---|
| The data lives in | the app's own database file | an Excel workbook you can open |
| Best for | running it for real — the record is trustworthy and safe with many people at once | teams who want the database to *be* the spreadsheet they already use |
| Anybody can edit the data outside the app | no | yes, that is the point — and the trade-off |
| Set up with | `npm run setup` | `npm run setup` then `npm run seed:excel` |
| Run with | `npm run dev` / `npm start` | `npm run dev:excel` / `npm run start:excel` |
| Documented in | this file | **[EXCEL-EDITION.md](EXCEL-EDITION.md)** |

They are the same code, the same screens and the same rules — one setting apart
(`STORE` in `server/.env`). **Standard is the default**: if you never touch that
setting, that is what you are running. The app tells you which one it is at the
top of the Settings screen, and in the line it prints when it starts.

## What you need

- **Node.js 20 or newer** (22 recommended) and npm.
- Nothing else. No database server: the data lives in one SQLite file.

## Start it up

**The short way — one step, from a fresh unzip:**

| | |
|---|---|
| **Windows** | double-click **`start.bat`** |
| **macOS / Linux** | `./start.sh` |
| **Excel Edition** | **`start-excel.bat`**, or `./start.sh --excel` |

That checks Node, installs whichever half is missing, writes `server/.env`,
creates the data folders, seeds the demo data if there is none yet, builds the
interface, starts the app on <http://localhost:4100> and opens your browser. It
says what it is doing at each step, and it is safe to run again — on a folder
that is already set up it just starts the app.

`npm run go` (or `npm run go:excel`) does the same thing from a terminal.

**The long way**, if you would rather drive it yourself:

```bash
npm run setup      # installs BOTH halves, writes server/.env, seeds demo data
npm run dev        # API on :4100, interface on :5174, both reloading as you edit
```

> **`npm install` on its own is not enough.** This is three packages in one
> folder: the root holds the scripts, and the server and the client each have
> their own dependencies. `npm run setup` installs both halves — and every other
> script now stops with a plain message if they are missing, instead of a
> `Cannot find package 'express'` stack trace.
>
> By hand, if you prefer:
>
> ```bash
> npm --prefix server install
> npm --prefix client install
> ```

Sign in with any demo account — the password is `cloudmojo123`:

| Email | Role | Sees |
|-------|------|------|
| `parvez@cloudmojo.tech` | CEO | everything; approves what the manager has checked |
| `alfiya@cloudmojo.tech` | Manager | everything; assigns work and checks it |
| `cloud@cloudmojo.tech` | Team member | their own tasks only |

To run on an Excel workbook instead:

```bash
npm run template      # a blank workbook to start typing into
npm run seed:excel    # or one filled with the demo data
npm run dev:excel     # run against it
```

`npm run reset` wipes and re-seeds. When you are ready for real data, reset
once, then add your own people from the **People** screen and delete the demo
accounts.

## Windows

Everything works from `cmd` or PowerShell — Node, npm and the scripts are all
cross-platform. Two things worth knowing:

- **`start.bat` handles everything** — it is there so nobody has to remember
  any of this. Double-click it.
- If you would rather use npm: **`npm run setup`**, not `npm install`. See the
  note above. The root has no dependencies of its own, so there is nothing else
  to install.
- The Excel Edition scripts set an environment variable, which `cmd` cannot do
  inline. They go through `tools/run.mjs`, which sets it in Node, so they behave
  the same everywhere and need no extra package. If you would rather not think
  about it at all, put the setting in `server\.env` and use the ordinary
  commands:

  ```ini
  STORE=workbook
  WORKBOOK_FILE=./data/A1K-Task-Tracker.xlsx
  ```

  Then `npm run dev` and `npm start` are already in workbook mode.

A path with spaces in it (`D:\Running Data\...`) is fine. If `npm --prefix
server install` fails while building `better-sqlite3`, install Node 22 — it ships
a prebuilt binary and needs no compiler.

## Configuration

Everything is read from `server/.env` (copy `server/.env.example`):

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `4100` | API, and the whole app in production |
| `JWT_SECRET` | insecure default | **Set this.** Signs sign-in tokens; changing it signs everybody out |
| `JWT_EXPIRES_IN` | `12h` | How long a session lasts |
| `DATABASE_FILE` | `./data/tracker.db` | Relative to `server/` |
| `UPLOAD_DIR` | `./data/attachments` | Where attached files are kept |
| `CLIENT_ORIGIN` | `http://localhost:5174` | CORS origin for the dev server; unused in production |
| `ALERT_CRON` | `*/15 * * * *` | How often to sweep for late work and stalled approvals |
| `REVIEW_SLA_DAYS` | `2` | How long something may sit unchecked before it nags |
| `MAX_UPLOAD_BYTES` | `20971520` | 20 MB a file |
| `STORE` | `sqlite` | `sqlite` = Standard, `workbook` = Excel Edition — see [EXCEL-EDITION.md](EXCEL-EDITION.md) |
| `WORKBOOK_FILE` | `./data/A1K-Task-Tracker.xlsx` | workbook mode only |
| `CREDENTIALS_FILE` | `./data/credentials.json` | password hashes; never in the workbook |
| `WORKBOOK_FLUSH_MS` | `800` | how long to batch changes before saving the file |
| `WORKBOOK_POLL_MS` | `2000` | how often to check for edits made in Excel |

In production the server refuses to start without `JWT_SECRET`. That is
deliberate.

## Deploy

The server serves the built interface itself, so production is **one process on
one port**.

### Plain Node

```bash
npm --prefix server install --omit=dev
npm --prefix client install && npm run build     # writes client/dist
cp server/.env.example server/.env               # then edit it
npm run seed                                     # first time only
NODE_ENV=production JWT_SECRET='<a long random string>' npm start
```

Keep it running with systemd:

```ini
# /etc/systemd/system/a1k-tracker.service
[Unit]
Description=A1K Task Tracker
After=network.target

[Service]
Type=simple
User=a1k
WorkingDirectory=/opt/a1k-task-tracker
Environment=NODE_ENV=production
EnvironmentFile=/opt/a1k-task-tracker/server/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Put TLS in front of it — nginx, Caddy, or an ALB. Minimal nginx:

```nginx
server {
  server_name tracker.example.com;
  client_max_body_size 25m;          # attachments are capped at 20 MB
  location / {
    proxy_pass http://127.0.0.1:4100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Docker

```bash
docker compose up -d --build
docker compose exec app npm run seed     # first time only
```

The compose file mounts `./data` for the database and the attachments, and
reads `JWT_SECRET` from your environment or a `.env` beside the compose file.

## Backups

On the Excel Edition, back up the *folder*: the workbook, `credentials.json` and
`attachments/`. See [EXCEL-EDITION.md](EXCEL-EDITION.md).

On Standard, the entire application state is **one file**: `server/data/tracker.db`, plus the
`server/data/attachments/` directory for uploaded files. To back it up safely
while the app is running, use SQLite's own backup rather than `cp`:

```bash
sqlite3 server/data/tracker.db ".backup '/backups/tracker-$(date +%F).db'"
tar czf /backups/attachments-$(date +%F).tar.gz server/data/attachments
```

Restoring is putting those two things back and restarting. There is no
migration step and nothing else to remember.

## Upgrading

```bash
git pull                       # or unzip the new build over the old one
npm --prefix server install --omit=dev
npm --prefix client install && npm run build
sudo systemctl restart a1k-tracker
```

Schema changes are applied automatically on boot by an idempotent patch step in
`server/src/db/index.js` — new columns are added under a guard, so running an
old or a new database through it ends in the same place. Back up first anyway.

## Tests

```bash
npm test            # 88 checks on the Standard edition
npm run test:excel  # 46 more on the Excel Edition
```

They cover the rules rather than the plumbing: who may move a task, who may
check whose work, reassignment and its history entry, the chat hierarchy
including everything it must refuse, who may attach and download a file, and
what snoozing an alert does and does not dismiss.

## The offline preview

`preview/a1k-task-tracker-preview.html` is the whole interface in a single
file, running against a frozen copy of the seeded data — no install, no
network. Useful for showing somebody the product before you host it. The
approval chain works inside the tab; switch people with **Sign out** (a reload
restarts the demo).

Rebuild it after a change with:

```bash
npm run preview:html
```

## Layout

```
client/                     React 18 + Vite
  src/pages/                Home, Tasks, TaskDetail, Chat, Team, Settings, Login
  src/components/           Layout, Alerts (the bell), TaskRow, MoveButtons,
                            FilePicker, modals, ui.jsx
  src/lib/                  api, auth, task vocabulary, formatting, theme
  src/styles.css            the entire design system, one file
server/                     Express 4 + better-sqlite3
  src/routes/               auth, users, tasks, attachments, notifications,
                            dashboard, chat
  src/services/workflow.js  the approval chain — the file to read first
  src/services/alerts.js    the sweep that nags about late and stalled work
  src/access.js             who can do what, and who may talk to whom
  src/db/schema.sql         the tables, with the reasoning in comments
  src/db/workbook.js        the Excel Edition's store: sheets in, sheets out
  src/db/template.js        writes the blank template workbook
  test/api.mjs              the rule checks
  test/workbook.mjs         the same rules, on a spreadsheet
tools/launch.mjs            what start.bat and start.sh run
tools/                      the single-file preview builder, and the guards
                            that stop a script before it reaches a stack trace
```

If you read one file to understand the product, read
`server/src/services/workflow.js`. Everything else serves it.

## Roles

| Role | Holds | Deliberately does not hold |
|------|-------|----------------------------|
| CEO | sees everything, final approval, reopen; checks only what nobody else can | creating tasks, managing people |
| Manager | creates, assigns, edits, cancels, checks, manages people | final approval |
| Team member | own tasks; keeps the notes; marks them done | anything about other people's work |

Permissions live in one flat table in `server/src/access.js`. Changing them is a
two-line edit, not a migration.

## Not built yet

- CSV export from the Standard edition (the `tasks.export` permission exists;
  nothing uses it yet). On the Excel Edition the export is moot — the file *is*
  the spreadsheet.
- Recurring tasks — a monthly report is one task per month today.
- Email or WhatsApp delivery; notifications live in the bell.
- Custom roles beyond the three.

## Before you put it in front of the company

- [ ] Set a real `JWT_SECRET`.
- [ ] `npm run reset`, then add your own people and remove the demo accounts.
- [ ] Change every password from `cloudmojo123`.
- [ ] Put TLS in front of it.
- [ ] Point a backup job at `server/data/`.
- [ ] Delete the demo-account block from `client/src/pages/Login.jsx`.
