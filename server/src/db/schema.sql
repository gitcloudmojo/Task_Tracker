-- ---------------------------------------------------------------------------
-- A1K Task Tracker — one solution on the A1K platform, by CloudMojo.
--
-- One thing this app does: move a piece of work from "assigned" to "signed
-- off", through two pairs of eyes that are not the person who did it.
--
--   open  --submit-->  submitted  --verify-->  verified  --approve-->  approved
--                          |                      |
--                          +------ return --------+---> back to open, with a
--                                                       reason on the record
--
-- Everything else here exists to serve that: who may push which transition,
-- what the state was before, and why somebody sent it back.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- People.
--
-- Three roles, and they map to the three things a person can be in the
-- workflow rather than to a department:
--
--   user  — does the work and submits it
--   admin — assigns work and verifies it came back done
--   ceo   — signs it off, and can see everything
--
-- `team` is what department somebody sits in (Sales, Design, Delivery, IT…).
-- It is deliberately NOT the role: a designer and a salesperson are both
-- `user`, because the tracker treats their work identically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL,
  team          TEXT,
  title         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  -- How many days before a completion date this person wants a nudge.
  reminder_days_before INTEGER NOT NULL DEFAULT 2,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Tasks.
--
-- `status` is the single source of truth for where a task is in the chain.
-- The three timestamps beside it (submitted / verified / approved) record when
-- each gate was passed, and the three *_by columns record who passed it — so
-- "who signed this off and when" never needs reconstructing from a log.
--
-- A returned task goes back to `open` and keeps `return_reason` and
-- `returned_at` until it is submitted again. That way the owner opens it and
-- sees why it came back, rather than just finding it un-done.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 3.1: the mandatory four
  name            TEXT    NOT NULL,
  client_name     TEXT    NOT NULL,
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  completion_date TEXT    NOT NULL,

  -- High or Normal. Two values on purpose: a four-point priority scale ends up
  -- with everything marked urgent.
  priority        TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  notes           TEXT,

  status          TEXT    NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','submitted','verified','approved','cancelled')),

  created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- the three gates
  submitted_at    TEXT,
  submitted_note  TEXT,
  verified_at     TEXT,
  verified_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_note   TEXT,
  approved_at     TEXT,
  approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_note   TEXT,

  -- set when somebody sends it back; cleared on the next submission
  returned_at     TEXT,
  returned_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  return_reason   TEXT,
  return_count    INTEGER NOT NULL DEFAULT 0,

  cancelled_at    TEXT,
  cancel_reason   TEXT,

  -- set when a task changes hands; the history carries the why
  reassigned_at   TEXT,
  reassign_count  INTEGER NOT NULL DEFAULT 0,

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner  ON tasks(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, completion_date);
CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_name);

-- ---------------------------------------------------------------------------
-- The breakdown: the steps a task is made of.
--
-- A step is deliberately NOT a task with a parent. If it were, "call the client
-- back" would need marking done, checking by the manager and approving by the
-- CEO — the review queues would fill with fragments and every count in the app
-- would tally a task and its parts. The three-pairs-of-eyes rule is worth
-- something precisely because it is reserved for whole pieces of work.
--
-- So: the parent task keeps the chain, and a step is done when the person doing
-- it says so. One level deep, always — sub-sub-tasks are where trackers go to
-- die.
--
-- `kind` carries a distinction that turned out to be real:
--
--   step       a piece of the work. Past its date it is LATE.
--   follow_up  a check-back — "chase the client on the 12th". Past its date it
--              is WAITING ON YOU, which is not the same thing as late, and the
--              alerts should not pretend otherwise.
--
-- `due_date` is optional: an item on a checklist is useful without a date, and
-- forcing one would just get today's date typed in.
--
-- `owner_id` is always set explicitly, even when it is the task's owner. That
-- way reassigning the parent can move the steps that were really that person's
-- and leave alone the ones handed to somebody else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'step' CHECK (kind IN ('step','follow_up')),
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date    TEXT,
  note        TEXT,
  -- The order somebody dragged them into. Ties break on id, so a step with no
  -- opinion about its position still lands where it was added.
  position    INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_steps_task  ON task_steps(task_id, position, id);
-- Owner + done is the index behind "what steps are on my plate", which the
-- sweep asks once per run and Home asks on every visit.
CREATE INDEX IF NOT EXISTS idx_steps_owner ON task_steps(owner_id, done_at);

-- ---------------------------------------------------------------------------
-- Activity.
--
-- Append-only. Every transition writes a row, so the history of a task is a
-- fact rather than an inference — which matters the first time somebody asks
-- why a task was returned twice before it was approved.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action     TEXT    NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, created_at);

-- ---------------------------------------------------------------------------
-- Attachments.
--
-- The bytes live on disk under UPLOAD_DIR with a generated name; this table
-- holds what the file actually was. Downloads go through the API so the same
-- access rules apply to a file as to the task it hangs off — a public static
-- directory would quietly bypass every permission in the app.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

-- ---------------------------------------------------------------------------
-- Notifications — what the bell reads.
--
-- `dedupe_key` is unique per user, so a sweep running every 15 minutes still
-- only nudges somebody once per thing per day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info','warning','critical')),
  title       TEXT    NOT NULL,
  body        TEXT,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  dedupe_key  TEXT    NOT NULL,
  read_at     TEXT,
  -- Put off until later. A snoozed alert is neither read nor in the way.
  snoozed_until TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- ---------------------------------------------------------------------------
-- Chat.
--
-- Deliberately not a chat room. Messages travel up and down the same line the
-- approval chain uses and nowhere else:
--
--   CEO  <-->  manager  <-->  each person
--
-- so a pair is always one rung apart. There is no `threads` table because a
-- thread has no properties of its own: it IS the pair of people, and storing
-- the pair on every message keeps "who is allowed to read this" a question
-- about the two ids rather than about a join.
--
-- `read_at` is on the message and means "the other person has seen it", which
-- is all a two-person thread ever needs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The other half of the pair. Always the person on the other rung.
  partner_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT    NOT NULL,
  -- Optional: a message can hang off a task, so "about which one?" is answered.
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  read_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_pair ON chat_messages(author_id, partner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_inbox ON chat_messages(partner_id, read_at);

-- Files sent in a message. A separate table from `attachments` rather than a
-- nullable task_id on that one: a task's evidence and a file passed in
-- conversation are different things, with different rules about who may see
-- them, and mixing them would mean every query on either had to remember which
-- kind it was looking at.
CREATE TABLE IF NOT EXISTS chat_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  stored_name TEXT    NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_files ON chat_attachments(message_id);
