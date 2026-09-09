/**
 * One-time cleanup: remove the original demo/seed data (see db/seed.js) now
 * that real usage has started.
 *
 * Deliberately narrow rather than a general "delete anything" tool: the only
 * task ids this can ever touch are the ones seed.js created, and each one is
 * checked against exactly what the seed script put there — name and client —
 * before it is deleted. If either has changed since seeding, that row is left
 * alone rather than guessed at, because somebody may have renamed or
 * repurposed it into real work. This whole file is meant to be removed again
 * once it has been run.
 */
import { Router } from 'express';
import { db } from '../db/index.js';
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

// The seed script's five demo chat messages. Cleared only if the table still
// holds exactly that many — if real chat has happened since, this is skipped
// rather than wiping anything real.
const EXPECTED_CHAT_COUNT = 5;

router.post(
  '/purge-seed-data',
  wrap(async (req, res) => {
    const deleted = [];
    const skipped = [];

    for (const [idStr, [name, client]] of Object.entries(SEED_TASKS)) {
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

export default router;
