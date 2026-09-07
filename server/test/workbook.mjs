/**
 * The workbook store, checked the way it will actually be used.
 *
 *   node test/workbook.mjs
 *
 * Everything runs against a throwaway copy of the workbook in a temp folder, so
 * it never touches whatever you have in server/data.
 *
 * The interesting checks are not "does it write a file" — they are the four
 * things that make a spreadsheet backend either usable or a liability:
 *   1. the approval rules still hold, because the engine is unchanged;
 *   2. state survives a restart, because the file is the truth;
 *   3. a row typed by hand in Excel is adopted, ids and all;
 *   4. an edit made in Excel while the app is running is noticed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4577;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'cloudmojo123';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1k-workbook-'));
const BOOK = path.join(tmp, 'A1K-Task-Tracker.xlsx');
const CREDS = path.join(tmp, 'credentials.json');

const env = {
  ...process.env,
  STORE: 'workbook',
  WORKBOOK_FILE: BOOK,
  CREDENTIALS_FILE: CREDS,
  UPLOAD_DIR: path.join(tmp, 'attachments'),
  PORT: String(PORT),
  ALERT_CRON: '0 0 31 2 *',
  WORKBOOK_FLUSH_MS: '150',
  WORKBOOK_POLL_MS: '400',
};

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Refuse to run next to a server left behind by an earlier run.
 *
 * This test starts and stops its own server several times. If a previous run
 * died before its cleanup — a thrown assertion, a Ctrl+C — the old process
 * keeps the port, every `startApi()` here quietly fails to bind, and the checks
 * then interrogate a server pointed at a workbook from an hour ago. The
 * failures that produces are bizarre and blame the wrong code, so the run stops
 * here instead.
 */
try {
  const stale = await fetch(`${BASE}/health`);
  if (stale.ok) {
    console.error(`\n  Something is already answering on port ${PORT}.`);
    console.error('  It is almost certainly this test\'s server, left over from a run');
    console.error('  that ended badly. Stop it and try again:\n');
    console.error(`      pkill -f "src/index.js"\n`);
    process.exit(1);
  }
} catch {
  /* nothing there, which is what we want */
}

const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('node', args, { cwd: SERVER, env, stdio: 'pipe' });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });

let api = null;
let stopping = false;
const startApi = async () => {
  api = spawn('node', ['src/index.js'], { cwd: SERVER, env, stdio: process.env.LOUD ? 'inherit' : 'ignore' });
  api.on('exit', (code) => {
    if (code && !stopping) {
      console.error(`\n  The API exited with code ${code} instead of starting.`);
      console.error('  Run again with LOUD=1 to see what it said.\n');
    }
  });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* keep waiting */
    }
  }
  throw new Error('API did not start');
};
/** SIGTERM, so the server's shutdown hook gets to write the workbook. */
const stopApi = async () => {
  if (!api) return;
  stopping = true;
  const dead = new Promise((r) => api.on('exit', r));
  api.kill('SIGTERM');
  await Promise.race([dead, sleep(4000)]);
  api = null;
  stopping = false;
};

const tokens = {};
const signIn = async (who) => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${who}@cloudmojo.tech`, password: PASSWORD }),
  }).then((x) => x.json());
  tokens[who] = r.token;
  return r;
};
const call = async (who, method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};
const get = (who, p) => call(who, 'GET', p);
const post = (who, p, b = {}) => call(who, 'POST', p, b);

const openBook = async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(BOOK);
  return wb;
};
const rowCount = (ws) => (ws ? ws.rowCount - 1 : 0);

// However this run ends, the server it started does not outlive it — that is
// what made the failure above possible in the first place.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    stopping = true;
    api?.kill('SIGKILL');
    console.error(`\n  ${event}:`, err?.message || err);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  });
}
process.on('exit', () => {
  stopping = true;
  api?.kill('SIGKILL');
});

// --- 1. seed straight into a workbook --------------------------------------
console.log('\nSEEDING A WORKBOOK');
await run(['src/db/seed.js', '--reset']);
ok('the workbook was created', fs.existsSync(BOOK), `${Math.round(fs.statSync(BOOK).size / 1024)} KB`);
ok('passwords are kept out of it', fs.existsSync(CREDS));

let wb = await openBook();
const sheetNames = wb.worksheets.map((w) => w.name);
ok(
  'every sheet is there',
  ['Read me', 'Dashboard', 'Tasks', 'People', 'Task history', 'Messages', 'Chat files', 'Alerts', 'Files'].every((n) =>
    sheetNames.includes(n)
  ),
  sheetNames.join(', ')
);
ok('people are in it', rowCount(wb.getWorksheet('People')) === 10, `${rowCount(wb.getWorksheet('People'))} rows`);
ok('tasks are in it', rowCount(wb.getWorksheet('Tasks')) >= 19, `${rowCount(wb.getWorksheet('Tasks'))} rows`);
const bookText = JSON.stringify(wb.getWorksheet('People').getSheetValues());
ok('no password hash anywhere in the sheet', !bookText.includes('$2a$') && !bookText.includes('$2b$'));

// people are readable: emails, not ids
const ownerCell = wb.getWorksheet('Tasks').getRow(2).getCell(4).value;
ok('owners are written as emails', String(ownerCell).includes('@'), String(ownerCell));
// dates are real dates, so Excel can sort and filter them
const dueCell = wb.getWorksheet('Tasks').getRow(2).getCell(5).value;
ok('dates are real Excel dates', dueCell instanceof Date, String(dueCell));
const dash = wb.getWorksheet('Dashboard').getSheetValues().flat().filter(Boolean);
ok(
  'the Dashboard is formulas, not stale numbers',
  JSON.stringify(dash).includes('COUNTIF'),
);

// --- 2. the rules still hold ----------------------------------------------
console.log('\nTHE RULES, ON A SPREADSHEET');
await startApi();
const health = await fetch(`${BASE}/health`).then((r) => r.json());
ok('the app reports the workbook store', health.store === 'workbook', health.store);

for (const who of ['parvez', 'alfiya', 'cloud', 'devops']) await signIn(who);
ok('everybody can sign in', Object.values(tokens).every(Boolean));

const made = await post('alfiya', '/tasks', {
  name: 'Written into a spreadsheet',
  clientName: 'Medhaa Health',
  ownerId: (await get('alfiya', '/users')).body.users.find((u) => u.email === 'cloud@cloudmojo.tech').id,
  completionDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
});
ok('the manager assigns work', made.status === 201);
const id = made.body.task.id;

ok('only the owner marks it done', (await post('alfiya', `/tasks/${id}/submit`)).status === 403);
ok('the owner marks it done', (await post('cloud', `/tasks/${id}/submit`)).body.task?.status === 'submitted');
ok('a member cannot check it', (await post('devops', `/tasks/${id}/verify`)).status === 403);
ok(
  'the manager checks it',
  (await post('alfiya', `/tasks/${id}/verify`, { note: 'Looks right.' })).body.task?.status === 'verified'
);
ok('the manager cannot approve', (await post('alfiya', `/tasks/${id}/approve`)).status === 403);
ok('the CEO approves', (await post('parvez', `/tasks/${id}/approve`)).body.task?.status === 'approved');

// --- 3. it is all in the file, and it survives a restart -------------------
console.log('\nDURABILITY');
await sleep(600); // let the debounced save land
wb = await openBook();
const taskRows = wb.getWorksheet('Tasks').getSheetValues();
const written = taskRows.find((r) => r && r[2] === 'Written into a spreadsheet');
ok('the new task is in the sheet', Boolean(written));
ok('with the status the app set', written?.[7] === 'approved', String(written?.[7]));
const historyRows = wb.getWorksheet('Task history').getSheetValues().filter(Boolean);
ok(
  'and every step of it is in Task history',
  historyRows.filter((r) => r[2] === id).length >= 4,
  `${historyRows.filter((r) => r[2] === id).length} entries`
);

const status = await fetch(`${BASE}/store`).then((r) => r.json());
ok('the app knows when it last saved', Boolean(status.lastSavedAt), status.lastSavedAt);
ok('and reports no problems', status.problems.length === 0, status.problems.join(' | '));

await stopApi();
await startApi();
await signIn('parvez');
const afterRestart = await get('parvez', `/tasks/${id}`);
ok('after a restart the task is still there', afterRestart.body.task?.name === 'Written into a spreadsheet');
ok('still approved', afterRestart.body.task?.status === 'approved');
ok(
  'with its history intact',
  afterRestart.body.history.filter((e) => e.action === 'approved').length === 1,
  `${afterRestart.body.history.length} entries`
);

// --- 4. a row typed by hand in Excel --------------------------------------
console.log('\nTYPED STRAIGHT INTO EXCEL');
await stopApi();
wb = await openBook();
const tasks = wb.getWorksheet('Tasks');
// Exactly what somebody would type: the four mandatory columns, no ID.
const typed = tasks.addRow([]);
typed.getCell(2).value = 'Typed into the sheet by hand';
typed.getCell(3).value = 'Fintrail Capital';
typed.getCell(4).value = 'devops@cloudmojo.tech';
typed.getCell(5).value = new Date(Date.now() + 9 * 864e5);
typed.commit();
// And a person, the same way.
const peopleSheet = wb.getWorksheet('People');
const newPerson = peopleSheet.addRow([]);
newPerson.getCell(2).value = 'Network Engineer';
newPerson.getCell(3).value = 'network@cloudmojo.tech';
newPerson.getCell(4).value = 'user';
newPerson.getCell(5).value = 'IT';
newPerson.commit();
await wb.xlsx.writeFile(BOOK);

await startApi();
await signIn('alfiya');
const list = await get('alfiya', '/tasks?limit=500');
const adopted = list.body.tasks.find((t) => t.name === 'Typed into the sheet by hand');
if (process.env.LOUD && !adopted) {
  console.log('  names:', list.body.tasks.map((t) => t.name).slice(-4));
  console.log('  count:', list.body.tasks.length, 'status:', list.status, list.body.error || '');
}
ok('the hand-typed task was adopted', Boolean(adopted));
ok('it was given an ID', Number.isInteger(adopted?.id), `id ${adopted?.id}`);
ok('the owner email resolved to a person', adopted?.ownerName === 'DevOps Engineer', adopted?.ownerName);
ok('it defaulted to open and normal', adopted?.status === 'open' && adopted?.priority === 'normal');

const people = await get('alfiya', '/users');
const hand = people.body.users.find((u) => u.email === 'network@cloudmojo.tech');
ok('the hand-typed person was adopted', Boolean(hand), hand?.name);
ok('with no password until somebody sets one', hand?.hasPassword === false);
const noPassword = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'network@cloudmojo.tech', password: 'anything' }),
});
ok('so they cannot sign in yet', noPassword.status === 401);
const given = await call('alfiya', 'PATCH', `/users/${hand.id}`, { password: 'temporary-one' });
ok('the manager can set one', given.status === 200 && given.body.user.hasPassword === true);
const nowIn = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'network@cloudmojo.tech', password: 'temporary-one' }),
}).then((r) => r.json());
ok('and then they can sign in', Boolean(nowIn.token));

// --- 5. an edit made while the app is running -----------------------------
console.log('\nEDITED UNDERNEATH THE APP');
/** Wait until the app has nothing outstanding, so this is a clean one-sided edit. */
const untilIdle = async () => {
  for (let i = 0; i < 30; i++) {
    const s = await fetch(`${BASE}/store`).then((r) => r.json());
    if (!s.unsaved) return true;
    await sleep(150);
  }
  return false;
};
ok('the app settles after a write', await untilIdle());
wb = await openBook();
const t2 = wb.getWorksheet('Tasks');
let editedRow = null;
t2.eachRow((row, n) => {
  if (n > 1 && row.getCell(2).value === 'Typed into the sheet by hand') editedRow = row;
});
editedRow.getCell(2).value = 'Renamed in Excel while the app was running';
editedRow.getCell(6).value = 'high';
editedRow.commit();
await wb.xlsx.writeFile(BOOK);

let seen = null;
for (let i = 0; i < 20 && !seen; i++) {
  await sleep(300);
  const fresh = await get('alfiya', `/tasks/${adopted.id}`);
  if (fresh.body.task?.name === 'Renamed in Excel while the app was running') seen = fresh.body.task;
}
ok('the app picked the change up on its own', Boolean(seen));
ok('including the priority', seen?.priority === 'high', seen?.priority);

// --- 6. both sides move at once ------------------------------------------
console.log('\nFILES AND SNOOZING REACH THE WORKBOOK');

// A file sent in a conversation is a row like anything else, and a snoozed
// alert is a date in a column — both have to survive a save and a reload.
const chatFilesSheet = (await openBook()).getWorksheet('Chat files');
ok('there is a sheet for files sent in chat', Boolean(chatFilesSheet));
ok(
  'with the columns you would expect',
  ['Message ID', 'File name', 'Sent by'].every((h) =>
    (chatFilesSheet.getRow(1).values || []).some((v) => String(v) === h)
  ),
  (chatFilesSheet.getRow(1).values || []).filter(Boolean).join(', ')
);

const alertsSheet = (await openBook()).getWorksheet('Alerts');
ok(
  'the Alerts sheet has a Snoozed until column',
  (alertsSheet.getRow(1).values || []).some((v) => String(v).toLowerCase().includes('snoozed'))
);

const bell = await get('alfiya', '/notifications');
if (bell.body.notifications.length) {
  const one = bell.body.notifications[0];
  const put = await post('alfiya', `/notifications/${one.id}/snooze`, { preset: '3d' });
  ok('an alert can be put off', put.status === 200, put.body.label);
  await untilIdle();
  await sleep(1200);
  const saved = (await openBook()).getWorksheet('Alerts');
  // getRow().values is 1-based and sparse, so it needs flattening before any
  // index arithmetic — the hole at [0] is not a column.
  const header = Array.from(saved.getRow(1).values || [], (v) => String(v ?? ''));
  const col = header.findIndex((h) => h.toLowerCase().includes('snoozed'));
  const stamped = saved
    .getSheetValues()
    .filter(Boolean)
    .slice(1)
    .some((r) => r[col] !== undefined && r[col] !== null && String(r[col]).length > 4);
  ok('and the date is written into the file', stamped);
} else {
  ok('there was an alert to put off', false, 'bell empty');
}

console.log('\nWHEN BOTH SIDES MOVE');
// Somebody edits the sheet in the same instant the app writes. The invariant
// that matters is not "who wins" — it is that the app and the file agree
// afterwards, and that nobody's copy is silently binned.
const clash = openBook().then(async (book) => {
  const ws = book.getWorksheet('Tasks');
  ws.getRow(2).getCell(3).value = 'Typed over by a human';
  await book.xlsx.writeFile(BOOK);
});
const apiWrite = post('alfiya', '/tasks', {
  name: 'Created during a clash',
  clientName: 'Internal',
  ownerId: hand.id,
  completionDate: new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10),
});
const [, created] = await Promise.all([clash, apiWrite]);
ok('the API write succeeded', created.status === 201);

await untilIdle();
await sleep(1200);
const appView = await get('alfiya', '/tasks?limit=500');
const finalBook = await openBook();
const finalRows = finalBook.getWorksheet('Tasks').getSheetValues().filter(Boolean);
const inApp = appView.body.tasks.some((t) => t.name === 'Created during a clash');
const inFile = finalRows.some((r) => r[2] === 'Created during a clash');
ok('the app and the file agree', inApp === inFile, `app=${inApp} file=${inFile}`);

const st = await fetch(`${BASE}/store`).then((r) => r.json());
const keptCopy = st.conflicts.length > 0;
ok(
  'if a version was overruled, a copy of it was kept',
  !keptCopy || fs.existsSync(path.join(path.dirname(BOOK), st.conflicts[0])),
  keptCopy ? st.conflicts.join(', ') : 'no clash detected this run'
);

await stopApi();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
