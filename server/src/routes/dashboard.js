/**
 * The dashboard. Same shape as the on-prem edition; `canCheck` is now async
 * (it queries the database), so the one spot that filtered by it in place
 * now resolves each check first with `Promise.all`.
 */
import { Router } from 'express';
import { db, today } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../lib/validate.js';
import { can, taskScope, ownOnly, scopeLabel } from '../access.js';
import { daysToDue, overdueState, canCheck } from '../services/workflow.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const S = taskScope(req.user);

    const rows = await db
      .prepare(
        `SELECT t.*, o.name AS owner_name, o.team AS owner_team
           FROM tasks t JOIN users o ON o.id = t.owner_id
          WHERE ${S.sql}`
      )
      .all(...S.params);

    const live = rows.filter((t) => ['open', 'submitted', 'verified'].includes(t.status));
    const byStatus = (s) => rows.filter((t) => t.status === s).length;

    const overdue = live.filter((t) => overdueState(t).overdue);
    const dueThisWeek = live.filter((t) => {
      const d = daysToDue(t.completion_date);
      return d !== null && d >= 0 && d <= 7;
    });

    const stalls = {
      withOwner: live.filter((t) => t.status === 'open').length,
      withVerifier: live.filter((t) => t.status === 'submitted').length,
      withApprover: live.filter((t) => t.status === 'verified').length,
    };

    const mine = {
      toDo: rows.filter((t) => t.owner_id === req.user.id && t.status === 'open').length,
      overdue: rows.filter(
        (t) => t.owner_id === req.user.id && overdueState(t).overdue && t.status === 'open'
      ).length,
      submitted: rows.filter((t) => t.owner_id === req.user.id && t.status === 'submitted').length,
      approved: rows.filter((t) => t.owner_id === req.user.id && t.status === 'approved').length,
    };

    let toVerifyCount = 0;
    if (can(req.user, 'tasks.verify')) {
      const submitted = rows.filter((t) => t.status === 'submitted');
      const checkable = await Promise.all(submitted.map((t) => canCheck(t, req.user, can)));
      toVerifyCount = checkable.filter(Boolean).length;
    }
    const onMyDesk = {
      toVerify: toVerifyCount,
      toApprove: can(req.user, 'tasks.approve')
        ? rows.filter((t) => t.status === 'verified' && t.owner_id !== req.user.id).length
        : 0,
    };

    let byPerson = [];
    let byClient = [];
    let byTeam = [];
    if (can(req.user, 'tasks.view_all')) {
      const group = (keyFn) => {
        const map = new Map();
        for (const t of rows) {
          const key = keyFn(t) || 'Unassigned';
          const e =
            map.get(key) ||
            { key, live: 0, overdue: 0, awaitingReview: 0, awaitingApproval: 0, approved: 0, total: 0 };
          e.total += 1;
          if (['open', 'submitted', 'verified'].includes(t.status)) e.live += 1;
          if (overdueState(t).overdue) e.overdue += 1;
          if (t.status === 'submitted') e.awaitingReview += 1;
          if (t.status === 'verified') e.awaitingApproval += 1;
          if (t.status === 'approved') e.approved += 1;
          map.set(key, e);
        }
        return [...map.values()].sort((a, b) => b.live - a.live || b.total - a.total);
      };
      byPerson = group((t) => t.owner_name);
      byClient = group((t) => t.client_name);
      byTeam = group((t) => t.owner_team);
    }

    const attention = live
      .map((t) => ({ t, d: daysToDue(t.completion_date) }))
      .sort((a, b) => a.d - b.d || (a.t.priority === 'high' ? -1 : 1))
      .slice(0, 6)
      .map(({ t, d }) => ({
        id: t.id,
        name: t.name,
        clientName: t.client_name,
        ownerName: t.owner_name,
        status: t.status,
        priority: t.priority,
        completionDate: t.completion_date,
        daysToDue: d,
        isOverdue: overdueState(t).overdue,
      }));

    res.json({
      scopeLabel: scopeLabel(req.user),
      ownOnly: ownOnly(req.user),
      totals: {
        all: rows.length,
        live: live.length,
        open: byStatus('open'),
        submitted: byStatus('submitted'),
        verified: byStatus('verified'),
        approved: byStatus('approved'),
        cancelled: byStatus('cancelled'),
        overdue: overdue.length,
        dueThisWeek: dueThisWeek.length,
        highPriorityLive: live.filter((t) => t.priority === 'high').length,
      },
      stalls,
      mine,
      onMyDesk,
      byPerson,
      byClient,
      byTeam,
      attention,
      generatedFor: today(),
    });
  })
);

export default router;
