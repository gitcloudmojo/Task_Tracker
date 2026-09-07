/**
 * Run the API and the interface together, with tidy prefixed output.
 *
 *   node tools/dev.mjs            Standard edition
 *   node tools/dev.mjs --excel    Excel Edition
 *
 * This replaces `concurrently`. Not because that package is bad, but because it
 * was the last thing the root needed installed — and every dependency in the
 * launcher is another way for a fresh folder to fail with a message about a
 * missing module instead of doing what was asked. The root now has no
 * dependencies at all: install the two halves and everything works.
 */
import { spawn } from 'node:child_process';

const excel = process.argv.includes('--excel');

const parts = [
  { name: 'api', colour: '[34m', cmd: `npm --prefix server run ${excel ? 'dev:excel' : 'dev'}` },
  { name: 'web', colour: '[32m', cmd: 'npm --prefix client run dev' },
];
const RESET = '[0m';
const width = Math.max(...parts.map((p) => p.name.length));

const children = [];
let leaving = false;

/** Prefix every line, so two logs in one terminal stay readable. */
const pipe = (stream, part, to) => {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      to.write(`${part.colour}[${part.name.padEnd(width)}]${RESET} ${line}\n`);
    }
  });
};

for (const part of parts) {
  const child = spawn(part.cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  pipe(child.stdout, part, process.stdout);
  pipe(child.stderr, part, process.stderr);
  child.on('exit', (code) => {
    if (leaving) return;
    // If one half dies the other is useless, so take both down and say which.
    console.error(`\n${part.colour}[${part.name}]${RESET} stopped (exit ${code}). Shutting the other one down.`);
    stop();
    process.exitCode = code ?? 1;
  });
  children.push(child);
}

function stop() {
  leaving = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}

console.log(
  `\nA1K Task Tracker · ${excel ? 'Excel Edition' : 'Standard'}` +
    '\n  api  http://localhost:4100' +
    '\n  web  http://localhost:5174   ← open this one' +
    '\n\nCtrl+C stops both.\n'
);
