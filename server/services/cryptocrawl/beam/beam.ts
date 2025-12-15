import { signPacket, randomB64url } from '../../pulse/crypto.js';
import type { PulsePacket, SignedPulsePacket } from '../../pulse/types.js';

export interface BeamState {
  enabled: boolean;
  lastBootPulseAt?: number;
  lastManualPulseAt?: number;
  lastCronPulseAt?: number;
  lastPulseId?: string;
  lastIntent?: string;
  lastTargets?: string[];
  lastError?: string;
}

let state: BeamState = { enabled: false };

function isEnabled(): boolean {
  return String(process.env.BEAM_ENABLED || '').toLowerCase() === 'true';
}

function getSecret(): string {
  return String(process.env.PULSE_SIGNING_SECRET || '');
}

function splitTargets(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function getTargets(): string[] {
  // Prefer explicit beam targets, otherwise reuse the pulse topology.
  const t =
    process.env.BEAM_TARGETS ||
    process.env.PULSE_TARGETS ||
    process.env.PULSE_PEERS ||
    process.env.PULSE_FORWARD_TARGETS ||
    '';
  // If PULSE_PEERS uses "peerId|url" specs, strip peerId here.
  return splitTargets(t).map(s => (s.includes('|') ? s.split('|')[1].trim() : s));
}

async function fireAndForgetPost(url: string, body: any): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // no-op
  }
}

export function getBeamState(): BeamState {
  state.enabled = isEnabled();
  return { ...state };
}

export async function emitBeamPulse(kind: 'boot' | 'manual' | 'cron'): Promise<{ ok: boolean; id?: string; error?: string }> {
  const enabled = isEnabled();
  state.enabled = enabled;
  if (!enabled) return { ok: false, error: 'BEAM_DISABLED' };

  const secret = getSecret();
  if (!secret) {
    state.lastError = 'Missing PULSE_SIGNING_SECRET';
    return { ok: false, error: 'MISSING_PULSE_SIGNING_SECRET' };
  }

  const targets = getTargets();
  if (targets.length === 0) {
    state.lastError = 'No BEAM_TARGETS/PULSE_TARGETS/PULSE_PEERS configured';
    return { ok: false, error: 'NO_TARGETS' };
  }

  const id = randomB64url(18);
  const packet: PulsePacket = {
    id,
    coherenceId: id,
    intent: 'BEAM_OSCILLATION_PROBE',
    payload: {
      kind,
      ts: Date.now(),
    },
    ts: Date.now(),
    nonce: randomB64url(16),
    phase: 0,
    ttlMs: Number(process.env.BEAM_TTL_MS || 5 * 60_000), // default 5 minutes decay window
    trace: [],
    emitter: {
      serviceName: process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_NAME || 'beam',
      host: process.env.BEAM_EMITTER_HOST || '',
    },
  };

  const signed: SignedPulsePacket = signPacket(packet, secret);

  // Bidirectional emission by default: emit to all configured targets simultaneously.
  // No waiting for replies; this is fire-and-forget.
  void Promise.allSettled(targets.map(t => fireAndForgetPost(t, signed)));

  const now = Date.now();
  if (kind === 'boot') state.lastBootPulseAt = now;
  if (kind === 'manual') state.lastManualPulseAt = now;
  if (kind === 'cron') state.lastCronPulseAt = now;
  state.lastPulseId = id;
  state.lastIntent = packet.intent;
  state.lastTargets = targets;
  state.lastError = undefined;

  return { ok: true, id };
}

export function startBeamOnBoot(): void {
  if (!isEnabled()) return;
  // No scheduler here: only a boot pulse. Cron can call /beam/pulse for periodic wake-ups.
  void emitBeamPulse('boot');
}

