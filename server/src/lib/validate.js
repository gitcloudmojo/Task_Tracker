/**
 * Tiny hand-rolled validation. Keeps the dependency list short and the
 * error messages plain enough to show straight to a user.
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => {
  throw new HttpError(400, msg);
};

export function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      bad(`"${f}" is required`);
    }
  }
}

export function oneOf(value, allowed, field) {
  if (value === undefined) return;
  if (!allowed.includes(value)) {
    bad(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!DATE_RE.test(value)) bad(`"${field}" must be a date in YYYY-MM-DD form`);
  return value;
}

export function num(value, field, { min, max } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) bad(`"${field}" must be a number`);
  if (min !== undefined && n < min) bad(`"${field}" must be at least ${min}`);
  if (max !== undefined && n > max) bad(`"${field}" must be at most ${max}`);
  return n;
}

/** Express wrapper so route handlers can just throw. */
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
