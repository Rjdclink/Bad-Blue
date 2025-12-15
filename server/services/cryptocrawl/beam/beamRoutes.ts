import { Router } from 'express';
import { emitBeamPulse, getBeamState } from './beam.js';
import { getRecombined } from '../../pulse/recombiner.js';

function requireInternalAuth(req: any, res: any, next: any): any {
  // Internal/admin auth only (no user session dependency).
  // Prefer INTERNAL_API_KEY if configured; otherwise use INTERNAL_VERIFY_SECRET (same header as verifier).
  const apiKey = String(process.env.INTERNAL_KEY || process.env.INTERNAL_API_KEY || '');
  const verifySecret = String(process.env.INTERNAL_VERIFY_SECRET || '');

  const providedApiKey = String(req.header('X-Internal-Key') || req.header('X-Internal-Api-Key') || '');
  const providedVerify = String(req.header('X-Internal-Verify') || '');

  const ok =
    (apiKey && providedApiKey && providedApiKey === apiKey) ||
    (verifySecret && providedVerify && providedVerify === verifySecret);

  if (!ok) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      message: 'Internal auth required',
      expected: apiKey ? 'X-Internal-Key' : verifySecret ? 'X-Internal-Verify' : 'NO_SECRET_CONFIGURED',
    });
  }
  return next();
}

export function createBeamRouter(): Router {
  const router = Router();

  // All beam endpoints are internal-only.
  router.use(requireInternalAuth);

  // POST /beam/pulse - trigger an oscillation probe (for Railway Cron)
  router.post('/pulse', async (req, res) => {
    const kind = String(req.query?.kind || req.body?.kind || 'cron');
    const k = kind === 'boot' || kind === 'manual' || kind === 'cron' ? kind : 'cron';
    const result = await emitBeamPulse(k);
    if (!result.ok) return res.status(503).json({ ok: false, ...result });
    return res.json({ ok: true, id: result.id });
  });

  // POST /beam/start - UI-friendly alias (manual trigger)
  router.post('/start', async (_req, res) => {
    const result = await emitBeamPulse('manual');
    if (!result.ok) return res.status(503).json({ ok: false, ...result });
    return res.json({ ok: true, id: result.id });
  });

  // GET /beam/status - last pulse + recombination view (if any)
  router.get('/status', (req, res) => {
    const s = getBeamState();
    const recombined = s.lastPulseId ? getRecombined(s.lastPulseId) : null;
    return res.json({
      ok: true,
      enabled: s.enabled,
      state: s,
      recombined: recombined
        ? {
            packetId: recombined.packetId,
            fragments: recombined.fragments.length,
            firstSeenAt: recombined.firstSeenAt,
            lastSeenAt: recombined.lastSeenAt,
            paths: recombined.paths,
          }
        : null,
    });
  });

  return router;
}

