import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomB64url, signPacket, verifySignedPacket } from '../services/pulse/crypto.js';
import type { SignedPulsePacket } from '../services/pulse/types.js';
import { ingestFragment, getRecombined } from '../services/pulse/recombiner.js';

function getSecret(): string {
  return String(process.env.PULSE_SIGNING_SECRET || process.env.INTERNAL_VERIFY_SECRET || '');
}

function now(): number {
  return Date.now();
}

function isExpired(pkt: SignedPulsePacket): boolean {
  const deadline = pkt.packet.ts + Math.max(0, pkt.packet.ttlMs || 0);
  return now() > deadline;
}

async function fireAndForgetPost(url: string, body: any): Promise<void> {
  try {
    // Don't await a response body; just emit.
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Intentionally swallow errors: fire-and-forget.
  }
}

function splitTargets(envVal: string | undefined): string[] {
  if (!envVal) return [];
  return envVal
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function setupPulseRoutes(app: any): void {
  const router = Router();

  // Mirror: verifies integrity, adds hop entropy, re-emits forward/backward.
  router.post('/mirror', async (req: Request, res: Response) => {
    const secret = getSecret();
    if (!secret) {
      return res.status(500).json({ ok: false, error: 'PULSE_SIGNING_SECRET not configured' });
    }
    const signed = req.body as SignedPulsePacket;
    if (!verifySignedPacket(signed, secret)) {
      return res.status(401).json({ ok: false, error: 'invalid_signature' });
    }
    if (isExpired(signed)) {
      return res.status(410).json({ ok: false, error: 'expired' });
    }

    const mirrorId = String(process.env.PULSE_MIRROR_ID || process.env.RAILWAY_SERVICE_NAME || 'mirror');
    const host = String(req.headers.host || '');
    const serviceName = String(process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_NAME || 'unknown');

    const pkt = signed.packet;
    const nextPacket = {
      ...pkt,
      phase: (pkt.phase || 0) + 1,
      trace: [
        ...(pkt.trace || []),
        {
          hopId: randomB64url(12),
          at: now(),
          mirrorId,
          serviceName,
          host,
          phase: (pkt.phase || 0) + 1,
          entropy: randomB64url(16),
          outcome: 'mirrored',
        },
      ],
    };

    const nextSigned = signPacket(nextPacket, secret);

    const forwardTargets = splitTargets(process.env.PULSE_FORWARD_TARGETS);
    const backwardTargets = splitTargets(process.env.PULSE_BACKWARD_TARGETS);
    const recombiner = String(process.env.PULSE_RECOMBINER_URL || '');

    // Fire forward/backward fragments independently.
    await Promise.allSettled([
      ...forwardTargets.map(t => fireAndForgetPost(t, nextSigned)),
      ...backwardTargets.map(t => fireAndForgetPost(t, nextSigned)),
      ...(recombiner ? [fireAndForgetPost(recombiner, nextSigned)] : []),
    ]);

    return res.status(202).json({ ok: true, packetId: nextSigned.packet.id, phase: nextSigned.packet.phase });
  });

  // Recombiner ingest: accepts any returning fragment, correlates by packet id.
  router.post('/ingest', (req: Request, res: Response) => {
    const secret = getSecret();
    if (!secret) {
      return res.status(500).json({ ok: false, error: 'PULSE_SIGNING_SECRET not configured' });
    }
    const signed = req.body as SignedPulsePacket;
    if (!verifySignedPacket(signed, secret)) {
      return res.status(401).json({ ok: false, error: 'invalid_signature' });
    }
    const state = ingestFragment(signed);
    return res.json({
      ok: true,
      packetId: state.packetId,
      fragments: state.fragments.length,
      firstSeenAt: state.firstSeenAt,
      lastSeenAt: state.lastSeenAt,
    });
  });

  // Status: show partial truth reconstruction.
  router.get('/status/:packetId', (req: Request, res: Response) => {
    const state = getRecombined(String(req.params.packetId));
    if (!state) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({
      ok: true,
      packetId: state.packetId,
      fragments: state.fragments.length,
      firstSeenAt: state.firstSeenAt,
      lastSeenAt: state.lastSeenAt,
      phasesSeen: Array.from(new Set(state.fragments.map(f => f.packet.phase))).sort((a, b) => a - b),
      mirrorsSeen: Array.from(
        new Set(
          state.fragments
            .flatMap(f => f.packet.trace || [])
            .map(h => h.mirrorId)
        )
      ),
    });
  });

  app.use('/api/pulse', router);
}

