/**
 * Hit by Vercel Cron on the schedule in vercel.json (or by any external
 * pinger, if you need a cadence Vercel Cron itself cannot give you — see the
 * note in vercel.json about the Hobby plan's once-a-day floor). Replaces the
 * on-prem edition's in-process `node-cron` schedule: same `runAlertSweep()`
 * underneath, just invoked over HTTP instead of from a setInterval-style
 * scheduler inside a process that no longer exists here.
 *
 * Vercel signs its own cron requests with an Authorization header carrying
 * CRON_SECRET (an env var Vercel sets automatically when you add a cron job
 * in the dashboard, or one you set yourself for an external pinger) — this
 * checks it so nobody else can trigger a sweep for free.
 */
import { ensureMigrated } from '../../server/src/db/index.js';
import { runAlertSweep } from '../../server/src/services/alerts.js';
import { config } from '../../server/src/config.js';

export default async function handler(req, res) {
  if (config.cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${config.cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    await ensureMigrated();
    const result = await runAlertSweep({ verbose: true });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/alerts] sweep failed', err);
    res.status(500).json({ ok: false, error: 'Sweep failed — see function logs' });
  }
}
