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
