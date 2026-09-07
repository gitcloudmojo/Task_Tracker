/**
 * API checks against a real server and a throwaway copy of the seeded database.
 *
 *   node test/api.mjs
 *
 * These are the rules the product is: who may move a task, who may check whose
 * work, and who may talk to whom. Every check is written as an attempt somebody
 * would actually make — including the ones that must be refused.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4533;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'cloudmojo123';
const SCRATCH = 'preview-test.db';

// Clear the scratch copy before writing it. A run that ends badly leaves its
// -wal behind, and sqlite would replay that stale journal onto the fresh copy —
// which shows up much later as one inexplicable failure in an unrelated check.
for (const suffix of ['', '-wal', '-shm']) {
  const scratch = path.join(SERVER, `data/${SCRATCH}${suffix}`);
  if (fs.existsSync(scratch)) fs.rmSync(scratch);
  const src = path.join(SERVER, `data/tracker.db${suffix}`);
  if (fs.existsSync(src)) fs.copyFileSync(src, scratch);
}

// Refuse to run next to a server left behind by a run that ended badly: it
// would keep the port, this one would fail to bind, and every check below would
// then interrogate somebody else's database.
try {
  if ((await fetch(`${BASE}/health`)).ok) {
    console.error(`\n  Something is already answering on port ${PORT}.`);
    console.error('  It is almost certainly a leftover from an earlier run. Stop it');
    console.error('  and try again:\n\n      pkill -f "src/index.js"\n');
    process.exit(1);
  }
} catch {
  /* nothing there, which is what we want */
}

const api = spawn('node', ['src/index.js'], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), ALERT_CRON: '0 0 31 2 *', DATABASE_FILE: `./data/${SCRATCH}` },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(200);
  try {
    up = (await fetch(`${BASE}/health`)).ok;
  } catch {
    /* keep waiting */
  }
}
if (!up) {
  api.kill();
  console.error('API did not start');
  process.exit(1);
}

// However this run ends, the server it started does not outlive it.
process.on('exit', () => api.kill('SIGKILL'));
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    console.error(`\n  ${event}:`, err?.message || err);
    process.exit(1);
  });
}

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  PASS ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

const tokens = {};
const signIn = async (email) => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${email}@cloudmojo.tech`, password: PASSWORD }),
  }).then((x) => x.json());
  tokens[email] = r.token;
  return r.user;
};

const call = async (who, method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[who]}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};
const get = (who, p) => call(who, 'GET', p);
const post = (who, p, b = {}) => call(who, 'POST', p, b);

/** A multipart upload, built by hand so the tests need no extra dependency. */
const upload = async (who, p, files) => {
  const form = new FormData();
  for (const [name, text] of files) form.append('files', new Blob([text], { type: 'text/plain' }), name);
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens[who]}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

/** Downloads answer with bytes rather than JSON, so they get their own call. */
const download = async (who, p) => {
  const res = await fetch(BASE + p, { headers: { Authorization: `Bearer ${tokens[who]}` } });
  return { status: res.status, text: res.ok ? await res.text() : '' };
};

const people = {};
for (const who of ['parvez', 'alfiya', 'cloud', 'devops', 'sales', 'finance']) {
  people[who] = await signIn(who);
}

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

console.log('\nROLES AND SCOPE');
ok('the manager is labelled Manager', people.alfiya.roleLabel === 'Manager', people.alfiya.roleLabel);
ok('a member is labelled Team member', people.cloud.roleLabel === 'Team member', people.cloud.roleLabel);
const cloudList = await get('cloud', '/tasks');
ok(
  'a member sees only their own work',
  cloudList.body.tasks.every((t) => t.mine || t.createdById === people.cloud.id),
  `${cloudList.body.tasks.length} tasks`
);
const allList = await get('alfiya', '/tasks?limit=500');
ok('the manager sees everything', allList.body.tasks.length >= 18, `${allList.body.tasks.length} tasks`);
ok('the CEO does not create tasks', (await post('parvez', '/tasks', {
  name: 'CEO trying to create one',
  clientName: 'Internal',
  ownerId: people.cloud.id,
  completionDate: inDays(5),
})).status === 403);
ok('a member cannot create tasks', (await post('cloud', '/tasks', {
  name: 'Member trying to create one',
  clientName: 'Internal',
  ownerId: people.cloud.id,
  completionDate: inDays(5),
})).status === 403);

console.log('\nTHE CHAIN');
const made = await post('alfiya', '/tasks', {
  name: 'Landing zone review for Medhaa',
  clientName: 'Medhaa Health',
  ownerId: people.cloud.id,
  completionDate: inDays(4),
  priority: 'high',
});
ok('the manager assigns work', made.status === 201);
const id = made.body.task.id;

ok('only the owner marks it done', (await post('alfiya', `/tasks/${id}/submit`)).status === 403);
ok('nothing to check before that', (await post('alfiya', `/tasks/${id}/verify`)).status === 409);
ok('the owner marks it done', (await post('cloud', `/tasks/${id}/submit`)).body.task?.status === 'submitted');
ok('a member cannot check work', (await post('devops', `/tasks/${id}/verify`)).status === 403);
ok('the CEO cannot check what the manager can', (await post('parvez', `/tasks/${id}/verify`)).status === 403);
ok('the CEO cannot skip the check', (await post('parvez', `/tasks/${id}/approve`)).status === 409);
ok('the manager checks it', (await post('alfiya', `/tasks/${id}/verify`, { note: 'Matches the plan output.' })).body.task?.status === 'verified');
ok('the manager cannot approve', (await post('alfiya', `/tasks/${id}/approve`)).status === 403);
ok('the CEO approves', (await post('parvez', `/tasks/${id}/approve`, { note: 'Good.' })).body.task?.status === 'approved');
ok('an approved task is finished', (await post('cloud', `/tasks/${id}/submit`)).status === 409);

const detail = await get('parvez', `/tasks/${id}`);
ok('the CEO can see who checked it', detail.body.task.verifierName === 'Alfiya A Parvez', detail.body.task.verifierName);
ok('the history holds every step', detail.body.history.length >= 4, `${detail.body.history.length} entries`);

console.log('\nNOBODY CHECKS THEIR OWN WORK');
const own = await post('alfiya', '/tasks', {
  name: 'The manager doing a piece of work herself',
  clientName: 'Internal',
  ownerId: people.alfiya.id,
  completionDate: inDays(6),
});
const ownId = own.body.task.id;
await post('alfiya', `/tasks/${ownId}/submit`);
ok('she cannot check her own', (await post('alfiya', `/tasks/${ownId}/verify`)).status === 403);
const ceoQueue = await get('parvez', '/tasks/queue');
ok(
  'the CEO picks up that check, and only that one',
  ceoQueue.body.toVerify.length === 1 && ceoQueue.body.toVerify[0].id === ownId,
  `${ceoQueue.body.toVerify.length} in his check queue`
);
ok('he checks it', (await post('parvez', `/tasks/${ownId}/verify`, { note: 'Read it through.' })).body.task?.status === 'verified');
ok('then approves it', (await post('parvez', `/tasks/${ownId}/approve`)).body.task?.status === 'approved');

console.log('\nSENDING IT BACK');
const back = await post('alfiya', '/tasks', {
  name: 'Report that will come back once',
  clientName: 'Internal',
  ownerId: people.devops.id,
  completionDate: inDays(3),
});
const backId = back.body.task.id;
await post('devops', `/tasks/${backId}/submit`);
ok('a reason is required', (await post('alfiya', `/tasks/${backId}/return`, { note: 'no' })).status === 400);
const returned = await post('alfiya', `/tasks/${backId}/return`, {
  note: 'The SLO figures are last month’s — please pull them again.',
});
ok('with a reason it goes back', returned.body.task?.status === 'open');
ok('the gate it passed is cleared', returned.body.task?.submittedAt === null);
ok('and it is counted', returned.body.task?.returnCount === 1);
const owned = await get('devops', `/tasks/${backId}`);
ok('the owner reads why', String(owned.body.task.returnReason).includes('SLO'));

console.log('\nREASSIGNMENT');
const move = await post('alfiya', '/tasks', {
  name: 'Task that will change hands',
  clientName: 'Fintrail Capital',
  ownerId: people.cloud.id,
  completionDate: inDays(7),
});
const moveId = move.body.task.id;
ok(
  'a member cannot reassign',
  (await call('cloud', 'PATCH', `/tasks/${moveId}`, { ownerId: people.devops.id })).status === 403
);
ok(
  'the CEO cannot reassign either',
  (await call('parvez', 'PATCH', `/tasks/${moveId}`, { ownerId: people.devops.id })).status === 403
);
const moved = await call('alfiya', 'PATCH', `/tasks/${moveId}`, {
  ownerId: people.devops.id,
  reassignReason: 'Cloud Engineer is on leave until the 4th.',
});
ok('the manager reassigns it', moved.body.task?.ownerName === 'DevOps Engineer', moved.body.task?.ownerName);
ok('it is counted', moved.body.task?.reassignCount === 1);
ok('and dated', Boolean(moved.body.task?.reassignedAt), moved.body.task?.reassignedAt);

const movedHistory = (await get('alfiya', `/tasks/${moveId}`)).body.history;
const entry = movedHistory.find((e) => e.action === 'reassigned');
ok('the history has its own reassigned entry', Boolean(entry));
ok('naming both people', entry?.note.includes('Cloud Engineer') && entry?.note.includes('DevOps Engineer'), entry?.note);
ok('with the reason', entry?.note.includes('on leave'));
ok('and the day it happened', /^\d{4}-\d{2}-\d{2} /.test(entry?.createdAt || ''), entry?.createdAt);

const newOwnerBell = await get('devops', '/notifications');
ok(
  'the new owner is told',
  newOwnerBell.body.notifications.some((n) => n.type === 'task_reassigned' && n.title.includes('Handed to you')),
);
const oldOwnerBell = await get('cloud', '/notifications');
ok(
  'and so is the person who lost it',
  oldOwnerBell.body.notifications.some((n) => n.title.includes('Moved off your list'))
);

// Work already marked done cannot be inherited as done.
await post('devops', `/tasks/${moveId}/submit`);
const movedAgain = await call('alfiya', 'PATCH', `/tasks/${moveId}`, { ownerId: people.sales.id });
ok('handing over submitted work reopens it', movedAgain.body.task?.status === 'open', movedAgain.body.task?.status);
ok('and clears the claim that it was done', movedAgain.body.task?.submittedAt === null);
ok('counting the second move', movedAgain.body.task?.reassignCount === 2);
ok(
  'an inactive person cannot be handed work',
  (await call('alfiya', 'PATCH', `/tasks/${moveId}`, { ownerId: 9999 })).status === 400
);

console.log('\nCHAT: UP AND DOWN ONLY');
const memberThreads = await get('cloud', '/chat/threads');
ok('a member has exactly one thread', memberThreads.body.threads.length === 1, memberThreads.body.threads[0]?.name);
const mgrThreads = await get('alfiya', '/chat/threads');
ok('the manager has the CEO and the whole team', mgrThreads.body.threads.length === 9, `${mgrThreads.body.threads.length}`);
const ceoThreads = await get('parvez', '/chat/threads');
ok('the CEO has only the manager', ceoThreads.body.threads.length === 1, ceoThreads.body.threads[0]?.name);

ok('member to member is refused', (await post('cloud', `/chat/with/${people.devops.id}`, { body: 'psst' })).status === 403);
ok('member to CEO is refused', (await post('cloud', `/chat/with/${people.parvez.id}`, { body: 'hello boss' })).status === 403);
ok('nobody talks to themselves', (await post('cloud', `/chat/with/${people.cloud.id}`, { body: 'hi me' })).status === 403);
ok('an empty message is refused', (await post('cloud', `/chat/with/${people.alfiya.id}`, { body: '   ' })).status === 400);

// Counted as a difference, not an absolute: the seed carries conversations of
// its own, and a check that only passes on a virgin database is a check that
// will fail one day for no reason.
const before = (await get('alfiya', '/chat/threads')).body.threads.find(
  (t) => t.name === 'Cloud Engineer'
).unread;
const sent = await post('cloud', `/chat/with/${people.alfiya.id}`, { body: 'Applied in staging — anything else?' });
ok('member to manager works', sent.status === 201);
const mgrInbox = await get('alfiya', '/chat/threads');
const fromCloud = mgrInbox.body.threads.find((t) => t.name === 'Cloud Engineer');
ok('it lands unread with her', fromCloud.unread === before + 1, `${before} → ${fromCloud.unread}`);
const opened = await get('alfiya', `/chat/with/${people.cloud.id}`);
ok('opening it marks it read', opened.body.messages.every((m) => m.mine || m.readAt));
const reInbox = await get('alfiya', '/chat/threads');
ok('so the badge clears', reInbox.body.threads.find((t) => t.name === 'Cloud Engineer').unread === 0);
ok('the manager can reach the CEO', (await post('alfiya', `/chat/with/${people.parvez.id}`, { body: 'SOW is with you.' })).status === 201);
const bell = await get('parvez', '/notifications');
ok(
  'and it reaches his bell',
  bell.body.notifications.some((n) => n.type === 'chat_message'),
  `${bell.body.unread} unread`
);

console.log('\nFILES ON A TASK');
const evidenceTask = await post('alfiya', '/tasks', {
  name: 'Attach the signed SOW',
  clientName: 'Meridian Retail',
  ownerId: people.cloud.id,
  completionDate: inDays(4),
});
const evidenceId = evidenceTask.body.task.id;

const put = await upload('cloud', `/attachments/task/${evidenceId}`, [
  ['sow.txt', 'signed and scanned'],
]);
ok('the owner can attach a file', put.status === 201, `${put.status}`);
const attached = await get('cloud', `/tasks/${evidenceId}`);
ok('it appears on the task', attached.body.attachments?.length === 1, attached.body.attachments?.[0]?.filename);

const fileId = attached.body.attachments[0].id;
const pulled = await download('alfiya', `/attachments/${fileId}`);
ok('the manager can download it', pulled.status === 200 && pulled.text === 'signed and scanned');
ok(
  'somebody outside the line cannot',
  (await download('finance', `/attachments/${fileId}`)).status === 403
);
ok(
  'and cannot attach to a task that is not theirs',
  (await upload('finance', `/attachments/task/${evidenceId}`, [['sneaky.txt', 'x']])).status === 403
);
ok(
  'a file with no task is a 404, not a crash',
  (await upload('cloud', '/attachments/task/999999', [['nowhere.txt', 'x']])).status === 404
);

ok(
  'the file survives the task being marked done',
  (await post('cloud', `/tasks/${evidenceId}/submit`)).status === 200 &&
    (await get('cloud', `/tasks/${evidenceId}`)).body.attachments.length === 1
);
ok(
  'somebody unconnected cannot remove it',
  (await call('finance', 'DELETE', `/attachments/${fileId}`)).status === 403
);
ok('the person who uploaded it can', (await call('cloud', 'DELETE', `/attachments/${fileId}`)).status === 200);

// Evidence on an approved task is frozen: it is what was signed off.
const frozen = await upload('cloud', `/attachments/task/${evidenceId}`, [['final.txt', 'the final copy']]);
const frozenId = frozen.body.attachments[0].id;
await post('alfiya', `/tasks/${evidenceId}/verify`);
await post('parvez', `/tasks/${evidenceId}/approve`);
ok(
  'once approved, nothing more can be attached',
  (await upload('cloud', `/attachments/task/${evidenceId}`, [['late.txt', 'x']])).status === 403
);
ok(
  'and the evidence cannot be removed',
  (await call('cloud', 'DELETE', `/attachments/${frozenId}`)).status === 409
);
ok(
  'but it can still be read',
  (await download('parvez', `/attachments/${frozenId}`)).text === 'the final copy'
);

console.log('\nFILES IN A CONVERSATION');
const withFile = await post('cloud', `/chat/with/${people.alfiya.id}`, { willAttach: true });
ok('an empty message is allowed when a file follows', withFile.status === 201);
const messageId = withFile.body.message.id;

const chatPut = await upload('cloud', `/chat/messages/${messageId}/attachments`, [
  ['log.txt', 'the deploy log'],
]);
ok('the file attaches to it', chatPut.status === 201);
ok('and comes back on the message', chatPut.body.message.files.length === 1, chatPut.body.message.files[0]?.filename);

const chatFileId = chatPut.body.message.files[0].id;
ok(
  'the person it was sent to can download it',
  (await download('alfiya', `/chat/attachments/${chatFileId}`)).text === 'the deploy log'
);
ok(
  'a third party cannot',
  (await download('devops', `/chat/attachments/${chatFileId}`)).status === 403
);
ok(
  'and cannot hang a file off somebody else’s message',
  (await upload('alfiya', `/chat/messages/${messageId}/attachments`, [['mine.txt', 'x']])).status === 403
);
ok(
  'the recipient cannot delete it either',
  (await call('alfiya', `DELETE`, `/chat/attachments/${chatFileId}`)).status === 403
);
ok('the sender can', (await call('cloud', 'DELETE', `/chat/attachments/${chatFileId}`)).status === 200);

console.log('\nSNOOZING AN ALERT');
const inbox = await get('alfiya', '/notifications');
ok('the panel offers snooze presets', (inbox.body.presets || []).length >= 3, `${inbox.body.presets?.length}`);
const target = inbox.body.notifications[0];
ok('there is something in her inbox to snooze', Boolean(target));

const snoozed = await post('alfiya', `/notifications/${target.id}/snooze`, { preset: '3d' });
ok('snoozing answers with when it comes back', snoozed.status === 200 && Boolean(snoozed.body.snoozedUntil), snoozed.body.label);
ok('an unknown preset is refused', (await post('alfiya', `/notifications/${target.id}/snooze`, { preset: 'someday' })).status === 400);

const afterSnooze = await get('alfiya', '/notifications');
ok('it leaves the inbox', !afterSnooze.body.notifications.some((n) => n.id === target.id));
ok('and is counted as snoozed', afterSnooze.body.snoozed >= 1, `${afterSnooze.body.snoozed}`);

const snoozeList = await get('alfiya', '/notifications?snoozed=true');
ok('the snoozed tab shows it', snoozeList.body.notifications.some((n) => n.id === target.id));
ok('with the time it returns', Boolean(snoozeList.body.notifications.find((n) => n.id === target.id)?.snoozedUntil));

await post('alfiya', '/notifications/read-all');
const stillSnoozed = await get('alfiya', '/notifications?snoozed=true');
ok(
  'marking all read does not silently dismiss it',
  stillSnoozed.body.notifications.some((n) => n.id === target.id)
);

ok('bringing it back works', (await post('alfiya', `/notifications/${target.id}/unsnooze`)).status === 200);
const woken = await get('alfiya', '/notifications');
ok('and it is in the inbox again', woken.body.notifications.some((n) => n.id === target.id));
ok(
  'somebody else’s alert cannot be snoozed',
  (await post('cloud', `/notifications/${target.id}/snooze`, { preset: '1h' })).status === 404
);

api.kill();
for (const suffix of ['', '-wal', '-shm']) {
  const f = path.join(SERVER, `data/${SCRATCH}${suffix}`);
  if (fs.existsSync(f)) fs.rmSync(f);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
