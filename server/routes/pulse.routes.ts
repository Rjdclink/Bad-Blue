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

async function fireAndForgetPost(url: string, body: any, headers?: Record<string, string>): Promise<void> {
  try {
    // Fire-and-forget: do not parse response.
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
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

function parsePeerSpec(spec: string): { peerId: string; url: string } {
  // Supports:
  // - "https://host/api/pulse/node" (peerId derived from url)
  // - "peerA|https://host/api/pulse/node" (explicit peerId; enables weighting by peerId)
  const s = spec.trim();
  const parts = s.split('|');
  if (parts.length === 2) {
    return { peerId: parts[0].trim() || s, url: parts[1].trim() };
  }
  return { peerId: s, url: s };
}

export function setupPulseRoutes(app: any): void {
  const router = Router();

  /**
   * Bidirectional emission by default (no "client" vs "server"):
   * - Accepts signed packets (integrity-only, no upstream auth)
   * - Ingests into recombiner (merge via coherence ID)
   * - Phase-shifts (adds entropy hop)
   * - Re-emits immediately on receipt (continuous oscillation)
   *
   * TTL governs decay (probability/weight), not a terminal completion condition.
   * Paths may be asymmetric (PULSE_PEERS differs per node).
   */
  async function handleNode(req: Request, res: Response): Promise<void> {
    const secret = getSecret();
    if (!secret) {
      res.status(500).json({ ok: false, error: 'PULSE_SIGNING_SECRET not configured' });
      return;
    }
    const signed = req.body as SignedPulsePacket;
    if (!verifySignedPacket(signed, secret)) {
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
    if (isExpired(signed)) {
      res.status(410).json({ ok: false, error: 'expired' });
      return;
    }

    const nodeId = String(process.env.PULSE_NODE_ID || process.env.PULSE_MIRROR_ID || process.env.RAILWAY_SERVICE_NAME || 'node');
    const host = String(req.headers.host || '');
    const serviceName = String(process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_NAME || 'unknown');

    const pkt = signed.packet;
    // Shared coherence id (merge key). Do not treat as a sequence number.
    if (pkt.coherenceId && pkt.coherenceId !== pkt.id) {
      res.status(400).json({ ok: false, error: 'coherence_id_mismatch' });
      return;
    }

    // Ingest fragment immediately (focus lens merges by id). No waiting for responses.
    const recombined = ingestFragment(signed);

    const deadline = pkt.ts + Math.max(0, pkt.ttlMs || 0);
    const remainingMs = Math.max(0, deadline - now());
    const ttlFactor = pkt.ttlMs > 0 ? Math.max(0, Math.min(1, remainingMs / pkt.ttlMs)) : 0;

    const nextPacket = {
      ...pkt,
      coherenceId: pkt.coherenceId || pkt.id,
      phase: (pkt.phase || 0) + 1,
      trace: [
        ...(pkt.trace || []),
        {
          hopId: randomB64url(12),
          at: now(),
          mirrorId: nodeId,
          serviceName,
          host,
          phase: (pkt.phase || 0) + 1,
          entropy: randomB64url(16),
          outcome: 'oscillate_emit',
          context: {
            ttlFactor,
            pathsKnown: Object.keys(recombined.paths || {}).length,
          },
        },
      ],
    };

    const nextSigned = signPacket(nextPacket, secret);

    // Asymmetric topology: each node defines its own peers. No mirror symmetry enforced.
    const peers = [
      ...splitTargets(process.env.PULSE_PEERS),
      ...splitTargets(process.env.PULSE_FORWARD_TARGETS),
      ...splitTargets(process.env.PULSE_BACKWARD_TARGETS),
    ].map(parsePeerSpec);

    // Re-emit on receipt (continuous oscillation). Probability decays with TTL.
    // Prefer stable oscillation paths by weighting emission probability per peer.
    const peerPosts: Promise<void>[] = [];
    for (const peer of peers) {
      const pathStats = recombined.paths?.[peer.peerId];
      const w = typeof pathStats?.weight === 'number' ? pathStats.weight : 1.0;
      const baseP = Math.max(0.05, Math.min(1, w / 1.5));
      const p = baseP * ttlFactor;
      if (Math.random() <= p) {
        peerPosts.push(fireAndForgetPost(peer.url, nextSigned, { 'X-Pulse-Node': nodeId }));
      }
    }
    void Promise.allSettled(peerPosts);

    // No ping-pong semantics: accept and emit; do not wait for any returning fragment.
    res.status(202).json({ ok: true, id: nextSigned.packet.id, phase: nextSigned.packet.phase });
  }

  // Symmetric node endpoint (recommended).
  router.post('/node', (req, res) => void handleNode(req, res));

  // Back-compat aliases (no special semantics; still oscillatory).
  router.post('/mirror', (req, res) => void handleNode(req, res));
  router.post('/ingest', (req, res) => void handleNode(req, res));

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
      pathWeights: state.paths,
    });
  });

  app.use('/api/pulse', router);
}

