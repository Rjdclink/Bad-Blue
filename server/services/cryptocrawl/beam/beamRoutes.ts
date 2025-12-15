import { Router } from 'express';
import { emitBeamPulse, getBeamState } from './beam.js';
import { getRecombined } from '../../pulse/recombiner.js';

export function createBeamRouter(): Router {
  const router = Router();

  // POST /beam/pulse - trigger an oscillation probe (for Railway Cron)
  router.post('/pulse', async (req, res) => {
    const kind = String(req.query?.kind || req.body?.kind || 'cron');
    const k = kind === 'boot' || kind === 'manual' || kind === 'cron' ? kind : 'cron';
    const result = await emitBeamPulse(k);
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

