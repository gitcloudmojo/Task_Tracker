# A1K Task Tracker — Excel Edition

The same A1K Task Tracker, with an **Excel workbook as the database** instead of
the app's own file. Same screens, same approval chain, same rules — the only
difference is where the rows live and who else can open them.

The other one is the **Standard edition** (see [README.md](README.md)), which
keeps its own database and is the one to run when the record needs to be
trustworthy. Both are the same code: one setting apart.

```bash
npm run template          # writes a blank workbook you can start typing into
npm run seed:excel        # or fill one with the demo data instead
npm run dev:excel         # run against it
```

That is the whole switch. In production it is one environment variable:

```bash
STORE=workbook WORKBOOK_FILE=/path/to/A1K-Task-Tracker.xlsx npm start
```

On Windows, `cmd` cannot set a variable inline like that. Either use the
`:excel` scripts above — they set it in Node, so they work everywhere — or put
the two lines in `server\.env` and use the ordinary `npm run dev` / `npm start`:

```ini
STORE=workbook
WORKBOOK_FILE=./data/A1K-Task-Tracker.xlsx
```

---

## How it works

A spreadsheet is a good *file format* and a poor *query engine* — no
transactions, no constraints, no joins, no way to stop two writers trampling
each other. So this mode does not rewrite the app to talk to a spreadsheet:

```
the workbook is the record   ·   SQLite (in memory) is the engine
```

At boot, the sheets are read into an in-memory database with the real schema.
Every click goes through the same routes and the same approval logic as always.
A moment later (800 ms by default, so a burst of clicks becomes one save) the
whole workbook is written back, **atomically** — written beside the target, then
moved into place, because a half-written workbook is not a workbook and this is
somebody's only copy.

Nothing in `routes/` or `services/` knows this mode exists. That is deliberate:
one codebase, one set of rules, two places to keep the rows.

## "Live Excel"

Put the workbook in a **OneDrive or SharePoint synced folder**:

```bash
STORE=workbook \
WORKBOOK_FILE="/Users/you/OneDrive - CloudMojo/Task Tracker/A1K-Task-Tracker.xlsx" \
npm start
```

OneDrive syncs the file up as the app writes it, so the same workbook is live in
**Excel on the web**, on phones, and in anybody's desktop Excel — while the app
keeps running the approval chain on top of it. No API keys, no Graph
registration, no second copy to reconcile.

Two things to know:

- Sync is not instant. Somebody editing in Excel on the web may take a minute to
  land back on the app's disk. The app notices within a couple of seconds of the
  file actually changing.
- Keep **one** app instance pointed at one workbook. Two servers on one file
  will overwrite each other — that is a property of the format, not a bug here.

## What you can safely type into

| Sheet | By hand? | Notes |
|-------|----------|-------|
| **Tasks** | Yes | Task name, Client, Owner (email), Completion date is enough. Leave **Task ID** blank and the app numbers it. Priority and Status default to normal/open. |
| **People** | Yes | Name, Email, Role (`ceo` / `admin` / `user`), Team. A person added this way has no password — a manager sets one in the app, on the People screen. |
| **Tasks** — status and the four *at / by / note* groups | Better not | This is the approval chain. The app is what keeps it honest; typing `approved` into a cell bypasses every check. |
| **Task history** | No | It is the record of what happened. Editing it rewrites the past. |
| **Messages, Alerts, Files** | No | Written by the app. Clearing Alerts is harmless — the sweep refills it. |
| **Dashboard** | Formulas | `COUNTIF`s over the Tasks sheet, so the numbers are right even with the app closed. Rebuilt on every save. |
| **Read me** | — | The same guidance, inside the file, for whoever opens it without this README. |
| Your own extra sheets | Yes | The app rewrites only the sheets it owns and leaves everything else alone. |

Owners are written as **email addresses**, not internal ids, precisely so a
human can edit them. Dates are real Excel dates, so sorting and filtering work.

## The things that go wrong with a shared file, and what happens

| Situation | What the app does |
|-----------|-------------------|
| The file is **open in Excel** when the app saves (Windows holds an exclusive lock) | Writes to `A1K-Task-Tracker.xlsx.pending`, keeps retrying, and shows a banner in the app: *"The workbook is open in Excel."* Nothing is lost. |
| Somebody **edits the sheet** while the app is idle | Noticed within ~2 seconds and reloaded. New rows are adopted and numbered. |
| Somebody edits it **in the same moment** the app is writing | The app's version wins — losing a click is worse than losing a sheet edit — and *their* version is kept beside the file as `…conflict-<timestamp>.xlsx`, never binned. Settings tells you it happened. |
| A row is **missing something** the app needs (no owner, no date) | That row is skipped, the rest load, and Settings lists exactly which rows and why. |
| An owner email **does not match anybody** | Same: the row is skipped and named. Fix the spelling in the sheet and it appears. |
| The workbook is **deleted or renamed** | The app keeps running on what it has in memory and writes a fresh file at the configured path on the next change. |

## Passwords are not in the workbook

Password hashes live in `credentials.json` beside the file, mode `600`. A
workbook gets emailed, copied to a laptop and dropped in a shared folder;
password hashes should not travel with it.

The practical consequence, and it is a nice one: you can type ten people into
the People sheet, and each of them exists — assignable, visible, part of the
chain — but cannot sign in until the manager sets them a password on the People
screen.

## Where each thing lives

```
A1K-Task-Tracker.xlsx          the database
credentials.json               password hashes, mode 600
attachments/                   the files people attach, by generated name
A1K-Task-Tracker.xlsx.pending  only exists when the file was locked
…conflict-<timestamp>.xlsx     only exists after a simultaneous edit
```

Back up the folder, not just the workbook: the attachments are real files.

## Honest limits

- **The record is only as trustworthy as folder access.** The app cannot refuse
  what it did not do. If somebody with the file types `approved` into a cell,
  the history will not show who approved it — because nobody did. If that
  matters more than the convenience, run the Standard edition and use a workbook
  as an export instead.
- **One writer.** One app instance, one workbook.
- **Size.** Fine into the low tens of thousands of rows; every save rewrites the
  whole file, so a workbook with 100,000 tasks will feel it.
- **No cell-level permissions.** Everyone who can open the file sees everything,
  including the chat sheet. Role scoping is enforced by the app, not the file.

## Switching between the two editions

They are the same schema, so moving is a data copy, not a migration:

```bash
# Standard → Excel Edition: point the app at a new workbook and it writes
#   everything it has into it:
STORE=workbook WORKBOOK_FILE=./data/A1K-Task-Tracker.xlsx npm start
```

Nothing about the interface changes. The only visible difference is a card on
the Settings screen naming the file, when it last saved, and anything it could
not read.

## Tests

```bash
npm run test:excel     # 41 checks, all against a throwaway workbook
```

They cover the parts that decide whether a spreadsheet backend is usable or a
liability: the approval rules still holding, state surviving a restart, a
hand-typed row being adopted with a fresh id, an edit made in Excel being picked
up while the app runs, and a simultaneous edit keeping both copies.
