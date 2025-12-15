import type { SignedPulsePacket } from './types.js';

interface RecombinedState {
  packetId: string; // coherence id
  firstSeenAt: number;
  lastSeenAt: number;
  fragments: SignedPulsePacket[];
  paths: Record<string, PathStats>;
}

interface PathStats {
  weight: number; // reinforcement weight
  lastSeenAt?: number;
  ewmaMeanMs?: number;
  ewmaVarMs2?: number;
  stability?: number; // 0..1 (higher = more stable oscillation)
  lastIntervalMs?: number;
}

const store = new Map<string, RecombinedState>();

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getSourceKey(fragment: SignedPulsePacket): string {
  const trace = fragment.packet.trace || [];
  const lastHop = trace.length > 0 ? trace[trace.length - 1] : null;
  return String(lastHop?.mirrorId || fragment.packet.emitter?.serviceName || 'unknown');
}

/**
 * Update path stats to reward stable oscillation over raw speed.
 *
 * - Measure phase alignment via interval stability (variance/mean), not response time alone.
 * - Latency drops are only rewarded if stability increases (constructive).
 * - Instability reduces weight even if faster.
 */
function updatePathStats(prev: PathStats | undefined, intervalMs: number): PathStats {
  const alpha = 0.2; // smoothing factor
  const p: PathStats = prev ? { ...prev } : { weight: 1.0 };

  const prevMean = p.ewmaMeanMs;
  const prevVar = p.ewmaVarMs2;
  const prevStability = p.stability;

  const mean = prevMean === undefined ? intervalMs : alpha * intervalMs + (1 - alpha) * prevMean;
  const err = intervalMs - mean;
  const variance = prevVar === undefined ? err * err : alpha * (err * err) + (1 - alpha) * prevVar;

  const stability = 1 / (1 + variance / (mean * mean + 1)); // 0..1, higher = more stable

  // Weight reinforcement/decay logic
  if (prevStability !== undefined && prevMean !== undefined) {
    const deltaStability = stability - prevStability;
    const meanDelta = mean - prevMean;

    // Reward stability gains, penalize stability loss.
    if (deltaStability > 0.02) p.weight += 0.1;
    if (deltaStability < -0.02) p.weight -= 0.1;

    // Faster only good if stability increases. Otherwise treat as interference.
    if (meanDelta < 0 && deltaStability > 0) p.weight += 0.05;
    if (meanDelta < 0 && deltaStability < 0) p.weight -= 0.15;
  }

  p.weight = clamp(p.weight, 0.1, 3.0);
  p.ewmaMeanMs = mean;
  p.ewmaVarMs2 = variance;
  p.stability = stability;
  p.lastIntervalMs = intervalMs;
  p.lastSeenAt = Date.now();
  return p;
}

export function ingestFragment(fragment: SignedPulsePacket): RecombinedState {
  const id = fragment.packet.id;
  const now = Date.now();
  const existing = store.get(id);
  const sourceKey = getSourceKey(fragment);
  if (!existing) {
    const state: RecombinedState = {
      packetId: id,
      firstSeenAt: now,
      lastSeenAt: now,
      fragments: [fragment],
      paths: {
        [sourceKey]: updatePathStats(undefined, 0),
      },
    };
    store.set(id, state);
    return state;
  }
  existing.lastSeenAt = now;
  existing.fragments.push(fragment);
  if (existing.fragments.length > 200) existing.fragments = existing.fragments.slice(-200);

  // Update path stability using return interval consistency (oscillation coherence).
  const prev = existing.paths[sourceKey];
  const intervalMs = prev?.lastSeenAt ? now - prev.lastSeenAt : 0;
  existing.paths[sourceKey] = updatePathStats(prev, intervalMs);

  return existing;
}

export function getRecombined(packetId: string): RecombinedState | null {
  return store.get(packetId) || null;
}

