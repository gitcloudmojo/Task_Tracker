/**
 * Demo data — Vercel/Turso edition.
 *
 *   npm run seed     — fill an empty database
 *   npm run reset    — wipe first, then fill
 *
 * Same data as the on-prem edition. What changed: no workbook to open/flush
 * (there is no workbook mode here — see db/index.js), and every database
 * call is awaited.
 */
import bcrypt from 'bcryptjs';
import { db, ensureMigrated } from './index.js';
import { runAlertSweep } from '../services/alerts.js';
import { record } from '../services/workflow.js';

const RESET = process.argv.includes('--reset');
const PASSWORD = process.env.SEED_PASSWORD || 'cloudmojo123';

const d = (off) => {
  const x = new Date();
  x.setDate(x.getDate() + off);
  return x.toISOString().slice(0, 10);
};
const ts = (off) => {
  const x = new Date();
  x.setDate(x.getDate() + off);
  return x.toISOString().slice(0, 19).replace('T', ' ');
};

await ensureMigrated();

if (RESET) {
  await db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM chat_attachments;
    DELETE FROM chat_messages;
    DELETE FROM notifications;
    DELETE FROM attachments;
    DELETE FROM task_events;
    DELETE FROM tasks;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);
  console.log('Wiped existing data.');
}

const existingUsers = await db.prepare('SELECT COUNT(*) AS c FROM users').get();
if (existingUsers.c > 0) {
  console.log('The database already has people — nothing to do. Use `npm run reset` to start over.');
  process.exit(0);
}

const hash = bcrypt.hashSync(PASSWORD, 10);
const addUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, role, team, title, reminder_days_before)
   VALUES (?,?,?,?,?,?,?)`
);
const U = async (name, email, role, team, title, lead = 2) =>
  (await addUser.run(name, email, hash, role, team, title, lead)).lastInsertRowid;

// --- people -----------------------------------------------------------------
const parvez = await U('Parvez Banatwala', 'parvez@cloudmojo.tech', 'ceo', 'Operations', 'Chief Executive Officer');
const alfiya = await U('Alfiya A Parvez', 'alfiya@cloudmojo.tech', 'admin', 'Operations', 'Manager', 1);

const cloud = await U('Cloud Engineer', 'cloud@cloudmojo.tech', 'user', 'Delivery', 'Senior Cloud Engineer', 3);
const devops = await U('DevOps Engineer', 'devops@cloudmojo.tech', 'user', 'Delivery', 'DevOps Engineer');
const projects = await U('Project Coordinator', 'projects@cloudmojo.tech', 'user', 'Delivery', 'Project Coordinator');
const sales = await U('Sales Executive', 'sales@cloudmojo.tech', 'user', 'Sales', 'Account Executive', 1);
const presales = await U('Pre-sales Consultant', 'presales@cloudmojo.tech', 'user', 'Pre-sales', 'Pre-sales Consultant');
const design = await U('Designer', 'design@cloudmojo.tech', 'user', 'Design', 'Product Designer');
const it = await U('IT Administrator', 'it@cloudmojo.tech', 'user', 'IT', 'IT Administrator');
const finance = await U('Finance Executive', 'finance@cloudmojo.tech', 'user', 'Finance', 'Finance Executive', 1);

// --- tasks ------------------------------------------------------------------
const addTask = db.prepare(
  `INSERT INTO tasks
     (name, client_name, owner_id, completion_date, priority, notes, status, created_by,
      submitted_at, submitted_note, verified_at, verified_by, verified_note,
      approved_at, approved_by, approved_note,
      returned_at, returned_by, return_reason, return_count,
      cancelled_at, cancel_reason, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);

async function task({
  name,
  client,
  owner,
  due,
  priority = 'normal',
  notes = null,
  status = 'open',
  by = alfiya,
  createdAgo = -20,
  submitted = null,
  submitNote = null,
  verified = null,
  verifier = null,
  verifyNote = null,
  approved = null,
  approver = null,
  approveNote = null,
  returned = null,
  returner = null,
  returnReason = null,
  returns = 0,
  cancelled = null,
  cancelReason = null,
}) {
  const { lastInsertRowid: id } = await addTask.run(
    name,
    client,
    owner,
    d(due),
    priority,
    notes,
    status,
    by,
    submitted === null ? null : ts(submitted),
    submitNote,
    verified === null ? null : ts(verified),
    verifier,
    verifyNote,
    approved === null ? null : ts(approved),
    approver,
    approveNote,
    returned === null ? null : ts(returned),
    returner,
    returnReason,
    returns,
    cancelled === null ? null : ts(cancelled),
    cancelReason,
    ts(createdAgo),
    ts(approved ?? verified ?? submitted ?? returned ?? createdAgo)
  );

  await record({ taskId: id, actorId: by, action: 'created', to: 'open', note: 'Assigned' });
  if (submitted !== null) {
    await record({ taskId: id, actorId: owner, action: 'submitted', from: 'open', to: 'submitted', note: submitNote });
  }
  if (verified !== null) {
    await record({ taskId: id, actorId: verifier, action: 'verified', from: 'submitted', to: 'verified', note: verifyNote });
  }
  if (approved !== null) {
    await record({ taskId: id, actorId: approver, action: 'approved', from: 'verified', to: 'approved', note: approveNote });
  }
  if (returned !== null) {
    await record({ taskId: id, actorId: returner, action: 'returned', from: 'submitted', to: 'open', note: returnReason });
  }
  if (cancelled !== null) {
    await record({ taskId: id, actorId: by, action: 'cancelled', from: 'open', to: 'cancelled', note: cancelReason });
  }
  return id;
}

await task({
  name: 'Terraform module for the shared VPC',
  client: 'Medhaa Health',
  owner: cloud,
  due: 6,
  priority: 'high',
  notes: 'Peering with the existing prod account. Needs review before the migration window.',
  by: alfiya,
  createdAgo: -5,
});
await task({
  name: 'Pricing one-pager for the retainer proposal',
  client: 'Quantifi Labs',
  owner: presales,
  due: 3,
  notes: 'Two options — 2 FTE and 3 FTE. Finance has the day rates.',
  createdAgo: -4,
});
await task({
  name: 'Onboarding deck refresh',
  client: 'Internal',
  owner: design,
  due: 9,
  notes: 'New brand palette. Reuse the Q1 structure.',
  createdAgo: -3,
});
await task({
  name: 'Laptop provisioning for the two new joiners',
  client: 'Internal',
  owner: it,
  due: 2,
  priority: 'high',
  notes: 'Both start Monday. MDM enrolment and SSO groups.',
  createdAgo: -6,
});
await task({
  name: 'GST filing workings for August',
  client: 'Internal',
  owner: finance,
  due: -4,
  priority: 'high',
  notes: 'Blocked on two vendor invoices from Delivery.',
  createdAgo: -18,
});
await task({
  name: 'Discovery questionnaire for Crestwave',
  client: 'Crestwave Solar',
  owner: sales,
  due: -9,
  notes: 'Client asked twice. Needs sending.',
  createdAgo: -22,
});
await task({
  name: 'Cost optimisation report — August',
  client: 'Bharat Agro Exports',
  owner: devops,
  due: -2,
  priority: 'high',
  notes: 'Found ₹1.4L/month of idle RDS and unattached volumes.',
  status: 'submitted',
  by: alfiya,
  createdAgo: -14,
  submitted: -3,
  submitNote: 'Report and the raw CUR export are attached. Savings are conservative.',
});
await task({
  name: 'SSO rollout for the Design team',
  client: 'Internal',
  owner: it,
  due: 4,
  status: 'submitted',
  createdAgo: -9,
  submitted: -1,
  submitNote: 'All eight accounts migrated. Two people still need to re-enrol MFA.',
});
await task({
  name: 'Statement of work — landing zone build',
  client: 'Fintrail Capital',
  owner: sales,
  due: 1,
  priority: 'high',
  notes: 'Legal have signed off the liability clause.',
  status: 'verified',
  createdAgo: -12,
  submitted: -4,
  submitNote: 'Final version after the CFO call.',
  verified: -2,
  verifier: alfiya,
  verifyNote: 'Numbers match the rate card. Scope matches the discovery notes.',
});
await task({
  name: 'Q2 case study — DR programme',
  client: 'Vayu Airlines',
  owner: design,
  due: -1,
  status: 'verified',
  createdAgo: -20,
  submitted: -8,
  submitNote: 'Client quote approved by their comms team.',
  verified: -6,
  verifier: alfiya,
  verifyNote: 'Reads well. Metrics check out against the project record.',
});
await task({
  name: 'Monthly service report',
  client: 'Trailhead Fintech',
  owner: devops,
  due: 2,
  notes: 'Rebuilding with the corrected SLO figures.',
  status: 'open',
  by: alfiya,
  createdAgo: -16,
  returned: -2,
  returner: alfiya,
  returnReason:
    'The uptime figure is last month’s. Please pull it again from the current dashboard and re-check the incident count.',
  returns: 1,
});
await task({
  name: 'EKS upgrade runbook',
  client: 'Medhaa Health',
  owner: cloud,
  due: -6,
  priority: 'high',
  status: 'approved',
  by: alfiya,
  createdAgo: -30,
  submitted: -10,
  submitNote: 'Dry run completed on staging, notes inline.',
  verified: -9,
  verifier: alfiya,
  verifyNote: 'Followed it end to end myself. Accurate.',
  approved: -8,
  approver: parvez,
  approveNote: 'Good work. Let us reuse this shape for the other two accounts.',
});
await task({
  name: 'Vendor invoice reconciliation — July',
  client: 'Internal',
  owner: finance,
  due: -12,
  status: 'approved',
  createdAgo: -34,
  submitted: -16,
  submitNote: 'All but one matched; the outlier is documented.',
  verified: -15,
  verifier: alfiya,
  verifyNote: 'Checked the outlier against the PO.',
  approved: -14,
  approver: parvez,
});
await task({
  name: 'Security questionnaire response',
  client: 'Northline Logistics',
  owner: presales,
  due: -20,
  status: 'approved',
  createdAgo: -40,
  submitted: -24,
  submitNote: 'Answered all 112 items; four marked not applicable.',
  verified: -23,
  verifier: alfiya,
  approved: -22,
  approver: parvez,
  approveNote: 'Thorough. Worth keeping as a template.',
});
await task({
  name: 'Board update for the September meeting',
  client: 'Internal',
  owner: parvez,
  due: 8,
  priority: 'high',
  notes: 'Needs the utilisation numbers from Operations.',
  by: alfiya,
  createdAgo: -2,
});
await task({
  name: 'Migration assessment for Sundar Textiles',
  client: 'Sundar Textiles',
  owner: cloud,
  due: -3,
  status: 'cancelled',
  by: alfiya,
  createdAgo: -25,
  cancelled: -11,
  cancelReason: 'Client went with an in-house team. Closing this out.',
});

const handed = await task({
  name: 'Backup policy review for the Fintrail estate',
  client: 'Fintrail Capital',
  owner: cloud,
  due: 5,
  notes: 'Picked this up mid-way — check what was already covered in the first pass.',
  by: alfiya,
  createdAgo: -9,
});
await db.prepare('UPDATE tasks SET reassigned_at = ?, reassign_count = 1 WHERE id = ?').run(ts(-3), handed);
await record({
  taskId: handed,
  actorId: alfiya,
  action: 'reassigned',
  from: 'open',
  to: 'open',
  note: 'From DevOps Engineer to Cloud Engineer — DevOps Engineer is on the cost report this week.',
});

await task({
  name: 'Weekly status pack for the three active projects',
  client: 'Internal',
  owner: projects,
  due: 1,
  notes: 'Pull the burn-down from each project board before Friday.',
  by: alfiya,
  createdAgo: -3,
});
await task({
  name: 'Runbook handover for the Medhaa night shift',
  client: 'Medhaa Health',
  owner: projects,
  due: -1,
  status: 'submitted',
  by: alfiya,
  createdAgo: -11,
  submitted: -1,
  submitNote: 'Handover call done and the pack is attached. Two open questions noted at the end.',
});

// --- chat ------------------------------------------------------------------
const addMessage = db.prepare(
  `INSERT INTO chat_messages (author_id, partner_id, body, task_id, read_at, created_at)
   VALUES (?,?,?,?,?,?)`
);
const say = (from, to, body, ago, read = true) =>
  addMessage.run(from, to, body, null, read ? ts(ago + 0.2) : null, ts(ago));

await say(parvez, alfiya, 'How is the Fintrail SOW looking? I want to sign it off today if it is ready.', -1);
await say(
  alfiya,
  parvez,
  'Checked it this morning — numbers match the rate card. It is with you for approval now.',
  -1
);
await say(parvez, alfiya, 'Seen. Approving it now.', -0.5, false);

await say(
  alfiya,
  devops,
  'The service report came back to you — the uptime figure was last month’s. Reason is on the task.',
  -2
);
await say(devops, alfiya, 'Got it, my mistake. Pulling the current numbers and resubmitting today.', -2);

await say(
  finance,
  alfiya,
  'GST workings are blocked on two vendor invoices from Delivery. Can you chase them?',
  -1,
  false
);
await say(alfiya, sales, 'Crestwave have asked twice for the questionnaire. What is holding it?', -1, true);
await say(sales, alfiya, 'Waiting on their tariff data. I will send what we have and flag the gap.', -1);

const counts = await db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all();
const sweep = await runAlertSweep({ verbose: true });

const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
const taskCount = (await db.prepare('SELECT COUNT(*) AS c FROM tasks').get()).c;
const chatCount = (await db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get()).c;

console.log(`
Seeded A1K Task Tracker (Turso)

  ${userCount} people — one CEO, one manager, eight doing the work
  ${taskCount} tasks — ${counts.map((c) => `${c.c} ${c.status}`).join(', ')}
  ${chatCount} messages, all of them up or down the line
  ${sweep.total} notifications from the first sweep

Sign in with any of these — password: ${PASSWORD}

  parvez@cloudmojo.tech    CEO       approves what the manager has checked
  alfiya@cloudmojo.tech    Manager   assigns the work and checks it came back done
  cloud@cloudmojo.tech     Member    Delivery
  devops@cloudmojo.tech    Member    Delivery — has one sent back to redo
  projects@cloudmojo.tech  Member    Delivery
  sales@cloudmojo.tech     Member    Sales — one overdue
  presales@cloudmojo.tech  Member    Pre-sales
  design@cloudmojo.tech    Member    Design
  it@cloudmojo.tech        Member    IT
  finance@cloudmojo.tech   Member    Finance — one overdue

Change these passwords before putting this anywhere real.
`);

process.exit(0);
