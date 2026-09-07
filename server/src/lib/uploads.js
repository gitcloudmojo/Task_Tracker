/**
 * File uploads, in one place — Vercel Blob edition.
 *
 * The on-prem edition wrote bytes to local disk under a generated name. There
 * is no local disk here, so the bytes go to Vercel Blob instead, under a
 * generated pathname — same reasoning, different shelf:
 *   1. The stored name/pathname is generated. A file called `../../etc/passwd`,
 *      or one that collides with an existing upload, cannot cause trouble.
 *   2. Nothing is handed out by a public directory listing. Every download in
 *      this app still goes through an authenticated route (see routes/
 *      attachments.js, routes/chat.js) that proxies the bytes back rather than
 *      redirecting to the blob URL directly — see the note in config.js about
 *      what that does and does not buy you with Vercel Blob specifically.
 *
 * multer now buffers into memory (`multer.memoryStorage()`) instead of
 * writing to disk — there is no server-local disk to write to, and a
 * serverless function's whole request body has to fit in memory for the
 * length of one invocation anyway.
 */
import multer from 'multer';
import crypto from 'node:crypto';
import { put, del, head } from '@vercel/blob';
import { config } from '../config.js';

export const MAX_FILES = 5;

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: config.maxUploadBytes, files: MAX_FILES } });

export const humanSize = (b) =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

/**
 * Middleware that accepts up to five files into memory and turns multer's
 * error codes into sentences a person can act on. Identical contract to the
 * on-prem version — routes did not have to change to call this.
 */
export const acceptFiles = (field = 'files') => (req, res, next) =>
  upload.array(field, MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Files must be under ${humanSize(config.maxUploadBytes)}` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ error: `${MAX_FILES} files at a time` });
    }
    return res.status(400).json({ error: err.message });
  });

/** Nothing to clean up on disk any more — files that never get inserted into
 * the database simply never get uploaded to Blob in the first place, since
 * the upload only happens after every check has passed. Kept as a no-op so
 * every call site that used to call `discard(req)` on a refusal still works
 * unchanged. */
export const discard = () => {};

/** Generate the pathname a file will live under in the Blob store. */
function storedName(originalName) {
  const ext = String(originalName || '')
    .match(/\.[a-zA-Z0-9]{1,12}$/)?.[0]
    ?.replace(/[^.\w]/g, '') || '';
  return `${config.blobPrefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

/**
 * Upload one already-buffered (multer memoryStorage) file to Vercel Blob.
 * Returns the generated pathname (what gets saved as `stored_name`) — the
 * database row is the source of truth for the original filename, mime type
 * and size, exactly as before.
 */
export async function storeFile(file) {
  const pathname = storedName(file.originalname);
  await put(pathname, file.buffer, {
    access: 'public', // Vercel Blob has no other mode — see config.js
    token: config.blobToken,
    contentType: file.mimetype || 'application/octet-stream',
    addRandomSuffix: false,
  });
  return pathname;
}

/**
 * Stream a stored file back through this server rather than redirecting to
 * its Blob URL, so the auth check on the calling route is what actually gates
 * the download.
 */
export async function sendStoredFile(res, row, { inline = false } = {}) {
  let info;
  try {
    info = await head(row.stored_name, { token: config.blobToken });
  } catch {
    return res.status(410).json({ error: 'That file is no longer available' });
  }
  const upstream = await fetch(info.url);
  if (!upstream.ok || !upstream.body) {
    return res.status(410).json({ error: 'That file is no longer available' });
  }
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${String(row.filename).replace(/["\\]/g, '')}"`
  );
  const reader = upstream.body.getReader();
  res.on('close', () => reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(Buffer.from(value))) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

/** Delete the bytes. The row is the caller's business. */
export async function removeStoredFile(storedName) {
  try {
    await del(storedName, { token: config.blobToken });
  } catch (err) {
    console.error('[uploads] could not delete blob', storedName, err);
  }
}
