import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { can } from '../access.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in to continue' });

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'That account no longer exists' });
    if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Guard a route on a single permission, and say which one was missing. */
export const requirePermission = (permission) => (req, res, next) => {
  if (can(req.user, permission)) return next();
  return res.status(403).json({
    error: `Your role does not have permission for this.`,
    permission,
  });
};

/**
 * Guard a route on any one of several permissions — for a route that more
 * than one role may enter, each for its own reason (e.g. task creation: a
 * Manager may create for anyone, a team member only for themselves — the
 * *narrower* check, which permission that was, happens inside the handler).
 */
export const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (permissions.some((p) => can(req.user, p))) return next();
  return res.status(403).json({
    error: `Your role does not have permission for this.`,
    permission: permissions[0],
  });
};
