import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set when NODE_ENV=production.');
  process.exit(1);
}

export const config = {
  isProd,
  // Not used to open a listening port under Vercel (see api/index.js), but
  // still read by anything that logs it.
  port: Number(process.env.PORT || 4100),

  // This deployment target is Standard/SQLite-compatible only. See
  // db/index.js for why Excel Edition (STORE=workbook) is refused here.
  store: (process.env.STORE || 'sqlite').toLowerCase(),

  // --- database: Turso (libSQL) ---------------------------------------------
  tursoUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  // --- attachments: Vercel Blob ----------------------------------------------
  // Vercel Blob has no private/authenticated read mode — a blob's URL is
  // fetchable by anyone who has it. The app still gates every download
  // through the authenticated /api/attachments/:id route (see routes/
  // attachments.js), and the stored pathname is a long random token rather
  // than the original filename, but that is obscurity, not access control —
  // weaker than the on-prem edition's "every byte only leaves through an
  // auth check". Worth knowing before this handles anything sensitive.
  blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  blobPrefix: process.env.BLOB_PREFIX || 'a1k-attachments',

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5174',

  // Vercel Cron's minimum interval on the Hobby plan is once a day; the Pro
  // plan allows per-minute schedules. The original 15-minute sweep needs Pro
  // (or an external pinger hitting /api/cron/alerts) — see vercel.json and
  // ARCHITECTURE-VERCEL.md.
  alertCron: process.env.ALERT_CRON || '*/15 * * * *',
  reviewSlaDays: Number(process.env.REVIEW_SLA_DAYS || 2),
  cronSecret: process.env.CRON_SECRET, // Vercel sets this automatically for its own cron calls

  // The original on-prem edition allows 20 MB — but a Vercel serverless
  // function's own request body cap is 4.5 MB (Hobby and Pro alike), and this
  // upload route still buffers the whole request in the function rather than
  // using Vercel Blob's client-side direct-upload flow. Default lowered to
  // stay under that ceiling; raising it past ~4 MB will start failing
  // uploads with a platform-level 413 that this app cannot translate into a
  // friendly message. See lib/uploads.js and ARCHITECTURE-VERCEL.md.
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 4 * 1024 * 1024),
};
