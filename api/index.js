/**
 * Vercel serverless entry point. Every request to /api/* (per vercel.json)
 * lands here and is handed straight to the Express app — Express's own
 * router does the rest, exactly as it did behind app.listen() on-prem.
 */
import { app } from '../server/src/index.js';

export default function handler(req, res) {
  return app(req, res);
}
