/**
 * Two one-time actions, both meant to be run once and then removed:
 *
 *   1. purge-seed-data — remove the original demo/seed data (see db/seed.js)
 *      now that real usage has started.
 *   2. create-superadmin — bootstrap the very first Super Admin account.
 *      Needed because appointing a Super Admin normally requires already
 *      being one (see access.js's APPOINTERS) — the first one has to come
 *      from somewhere, and this is that somewhere, gated the same as
 *      everything else here (an existing Manager or Super Admin only).
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, nowSql } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { wrap } from '../lib/validate.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('team.manage'));

// Exactly what server/src/db/seed.js inserted: id -> [name, client_name].
const SEED_TASKS = {
  1: ['Terraform module for the shared VPC', 'Medhaa Health'],
  2: ['Pricing one-pager for the retainer proposal', 'Quantifi Labs'],
  3: ['Onboarding deck refresh', 'Internal'],
  4: ['Laptop provisioning for the two new joiners', 'Internal'],
  5: ['GST filing workings for August', 'Internal'],
  6: ['Discovery questionnaire for Crestwave', 'Crestwave Solar'],
  7: ['Cost optimisation report — August', 'Bharat Agro Exports'],
  8: ['SSO rollout for the Design team', 'Internal'],
  9: ['Statement of work — landing zone build', 'Fintrail Capital'],
  10: ['Q2 case study — DR programme', 'Vayu Airlines'],
  11: ['Monthly service report', 'Trailhead Fintech'],
  12: ['EKS upgrade runbook', 'Medhaa Health'],
  13: ['Vendor invoice reconciliation — July', 'Internal'],
  14: ['Security questionnaire response', 'Northline Logistics'],
  15: ['Board update for the September meeting', 'Internal'],
  16: ['Migration assessment for Sundar Textiles', 'Sundar Textiles'],
  17: ['Backup policy review for the Fintrail estate', 'Fintrail Capital'],
  18: ['Weekly status pack for the three active projects', 'Internal'],
  19: ['Runbook handover for the Medhaa night shift', 'Medhaa Health'],
};

// Not seed data — the real task created after go-live. The user explicitly
// asked to remove this specific one too, once they were done using it to
// test the app. Same name/client safety check as the rows above.
const EXTRA_TASKS = {
  20: ['Migration', 'Internal'],
};

// The seed script's eight demo chat messages (3 with the CEO, 2 with DevOps,
// 2 with Sales, 1 with Finance). Cleared only if the table still holds
// exactly that many — if real chat has happened since, this is skipped
// rather than wiping anything real.
const EXPECTED_CHAT_COUNT = 8;

router.post(
  '/purge-seed-data',
  wrap(async (req, res) => {
    const deleted = [];
    const skipped = [];

    for (const [idStr, [name, client]] of Object.entries({ ...SEED_TASKS, ...EXTRA_TASKS })) {
      const id = Number(idStr);
      const row = await db.prepare('SELECT id, name, client_name FROM tasks WHERE id = ?').get(id);
      if (!row) {
        skipped.push({ id, reason: 'already gone' });
        continue;
      }
      if (row.name !== name || row.client_name !== client) {
        skipped.push({
          id,
          reason: 'no longer matches the seed record — left alone',
          found: { name: row.name, client: row.client_name },
        });
        continue;
      }
      await db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      deleted.push({ id, name, client });
    }

    const chatCountBefore = (await db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get()).c;
    let chatCleared = false;
    if (chatCountBefore === EXPECTED_CHAT_COUNT) {
      await db.prepare('DELETE FROM chat_messages').run();
      chatCleared = true;
    }

    res.json({ deleted, skipped, chatCleared, chatCountBefore });
  })
);

router.post(
  '/create-superadmin',
  wrap(async (req, res) => {
    const name = 'Sohail Memon';
    const email = 'sohail@cloudmojo.tech';
    const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars, URL-safe
    const hash = bcrypt.hashSync(tempPassword, 10);

    const existing = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (existing) {
      await db
        .prepare('UPDATE users SET role = ?, password_hash = ?, updated_at = ? WHERE id = ?')
        .run('superadmin', hash, nowSql(), existing.id);
      return res.json({ action: 'updated', id: existing.id, email, tempPassword });
    }

    const stamp = nowSql();
    const info = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, team, title, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(name, email, hash, 'superadmin', 'Operations', 'Super Admin', stamp, stamp);
    res.json({ action: 'created', id: info.lastInsertRowid, email, tempPassword });
  })
);

export default router;
