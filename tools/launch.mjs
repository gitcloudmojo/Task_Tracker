/**
 * One command, from a fresh unzip to a browser window.
 *
 *     node tools/launch.mjs            Standard edition
 *     node tools/launch.mjs --excel    Excel edition
 *
 * `start.bat` and `start.sh` are two-line wrappers around this. The point of it
 * is that nothing is assumed: it checks Node, installs whichever half is
 * missing, writes server/.env, creates the data folders, seeds the demo data if
 * the database does not exist yet, builds the client if the build is missing or
 * older than the source, then starts the server and opens the browser.
 *
 * Every step announces itself and every failure explains itself, because the
 * people running this are not going to read a stack trace — they are going to
 * send a screenshot of it.
 *
 * It is safe to run again. On a folder that is already set up it does nothing
 * but start the server, which takes about a second.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excel = process.argv.includes('--excel');
const noOpen = process.argv.includes('--no-open');
const edition = excel ? 'Excel Edition' : 'Standard Edition';

// npm is a .cmd on Windows and cannot be exec'd without a shell.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const line = '─'.repeat(66);
const say = (s = '') => console.log(s);
const step = (n, total, s) => say(`\n[${n}/${total}] ${s}`);

function stop(title, ...detail) {
  say(`\n  ${line}`);
  say(`  ${title}`);
  for (const d of detail) say(`  ${d}`);
  say(`  ${line}\n`);
  process.exit(1);
}

/** Run a command to completion, inheriting the console so npm's output shows. */
function run(cmd, args, label) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error?.code === 'ENOENT') {
    stop(
      `Could not run "${cmd}".`,
      '',
      'Node.js comes with npm, so this usually means Node was installed',
      'in a way that left npm off the PATH. Reinstalling Node from',
      'https://nodejs.org (the LTS build, "Add to PATH" ticked) fixes it.'
    );
  }
  if (res.status !== 0) {
    stop(
      `${label} failed.`,
      '',
      'The output above says why. The two usual causes are no internet',
      'connection (npm cannot reach the registry) or a folder the account',
      'cannot write to — a project unzipped inside Program Files, say.',
      '',
      'Moving the folder somewhere like C:\\A1K or ~/A1K and running this',
      'again clears up the second one.'
    );
  }
}

/** Newest mtime under a folder, skipping node_modules. Used to date the build. */
function newest(dir) {
  let latest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const t = fs.statSync(full).mtimeMs;
        if (t > latest) latest = t;
      }
    }
  };
  walk(dir);
  return latest;
}

/** Nothing hard-codes the port twice: it comes from .env, or the default. */
function portFromEnv() {
  const file = path.join(root, 'server', '.env');
  if (fs.existsSync(file)) {
    const found = fs.readFileSync(file, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (found) return Number(found[1]);
  }
  return 4100;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // A browser that will not open is not a reason to stop; the URL is printed.
  }
}

// --- 0. Node itself --------------------------------------------------------

const major = Number(process.versions.node.split('.')[0]);
say(`\n  A1K Task Tracker — ${edition}`);
say(`  Node ${process.versions.node} · ${process.platform}\n${line}`);

if (major < 20) {
  stop(
    `This needs Node 20 or newer. You have ${process.versions.node}.`,
    '',
    'Install the LTS build from https://nodejs.org, close this window,',
    'open it again, and run the same command.'
  );
}

const TOTAL = 5;

// --- 1. dependencies -------------------------------------------------------

step(1, TOTAL, 'Dependencies');
const halves = [
  { name: 'server', probe: 'express' },
  { name: 'client', probe: 'vite' },
];
let installed = false;
for (const half of halves) {
  if (fs.existsSync(path.join(root, half.name, 'node_modules', half.probe))) {
    say(`      ${half.name}: already installed`);
    continue;
  }
  say(`      ${half.name}: installing — this takes a minute or two the first time`);
  run(NPM, ['--prefix', half.name, 'install'], `Installing the ${half.name} dependencies`);
  installed = true;
}
if (!installed) say('      nothing to do');

// --- 2. configuration and folders -----------------------------------------

step(2, TOTAL, 'Configuration');
const envFile = path.join(root, 'server', '.env');
if (fs.existsSync(envFile)) {
  say('      server/.env: already there');
} else {
  fs.copyFileSync(path.join(root, 'server', '.env.example'), envFile);
  say('      server/.env: written from .env.example');
}
fs.mkdirSync(path.join(root, 'server', 'data', 'attachments'), { recursive: true });
say('      server/data/attachments: ready');

// --- 3. the data -----------------------------------------------------------

step(3, TOTAL, 'Data');
const dataFile = path.join(root, 'server', 'data', excel ? 'A1K-Task-Tracker.xlsx' : 'tracker.db');
if (fs.existsSync(dataFile)) {
  say(`      ${path.basename(dataFile)}: found — left exactly as it is`);
} else {
  say(`      ${path.basename(dataFile)}: not there yet, seeding the demo people and tasks`);
  run(NPM, ['run', excel ? 'seed:excel' : 'seed'], 'Seeding the data');
}

// --- 4. the client build ---------------------------------------------------

step(4, TOTAL, 'Client build');
const dist = path.join(root, 'client', 'dist', 'index.html');
if (!fs.existsSync(dist)) {
  say('      no build yet — building');
  run(NPM, ['run', 'build'], 'Building the client');
} else if (newest(path.join(root, 'client', 'src')) > fs.statSync(dist).mtimeMs) {
  say('      the source is newer than the build — rebuilding');
  run(NPM, ['run', 'build'], 'Building the client');
} else {
  say('      up to date');
}

// --- 5. go -----------------------------------------------------------------

const port = portFromEnv();
const url = `http://localhost:${port}`;

step(5, TOTAL, 'Starting');
say(`      ${url}`);
say(`\n${line}`);
say(`  Open ${url} in your browser.`);
say('');
say('  Sign in with any of the demo accounts — the password is on the');
say('  sign-in screen. Everything runs on this machine; nothing is sent');
say('  anywhere.');
if (excel) {
  say('');
  say(`  The workbook is server/data/A1K-Task-Tracker.xlsx. Open it in Excel`);
  say('  while this is running and your edits appear in the app.');
}
say('');
say('  Press Ctrl+C in this window to stop.');
say(`${line}\n`);

const child = spawn(NPM, ['run', excel ? 'start:excel' : 'start'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// Give the server a moment to bind before pointing a browser at it.
if (!noOpen) setTimeout(() => openBrowser(url), 1800);

const bye = () => child.kill();
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
child.on('exit', (code) => {
  // The server explains its own startup failures in plain English, so this is
  // only here to make sure the window does not just close in silence.
  if (code && code !== 0) say('\n  The server stopped. The message above says why.\n');
  process.exit(code ?? 0);
});
