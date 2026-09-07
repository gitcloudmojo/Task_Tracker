/**
 * Run a command with environment variables set, on any platform.
 *
 *   node tools/run.mjs STORE=workbook npm --prefix server run seed
 *
 * `VAR=value command` is bash syntax. cmd.exe does not understand it, which is
 * why the Excel Edition scripts used to fail on Windows. The usual answer is
 * `cross-env`, but that is a dependency somebody has to have installed — and
 * anything the scripts depend on is one more thing that can be missing when a
 * new folder is handed over. Node can do it in ten lines, so it does.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };

// Leading NAME=value pairs are settings; everything after is the command.
while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const [name, ...rest] = args.shift().split('=');
  env[name] = rest.join('=');
}

if (!args.length) {
  console.error('Usage: node tools/run.mjs [NAME=value …] command [args …]');
  process.exit(2);
}

// `shell: true` with one string is what makes this work in both cmd and sh.
const child = spawn(args.join(' '), { stdio: 'inherit', env, shell: true });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
