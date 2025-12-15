import { signPacket, randomB64url } from '../server/services/pulse/crypto.js';
import type { PulsePacket } from '../server/services/pulse/types.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing ${name}`);
  return v.trim();
}

function splitTargets(v: string): string[] {
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function postJson(url: string, body: any): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const secret = requireEnv('PULSE_SIGNING_SECRET');
  const targets = splitTargets(requireEnv('PULSE_TARGETS')); // typically mirror endpoints

  const packet: PulsePacket = {
    id: randomB64url(18),
    intent: process.env.PULSE_INTENT || 'VERIFY_RUNTIME_PROCESS',
    payload: {
      note: 'laser_pulse_emit',
    },
    ts: Date.now(),
    nonce: randomB64url(16),
    phase: 0,
    ttlMs: Number(process.env.PULSE_TTL_MS || 60_000),
    trace: [],
    emitter: {
      serviceName: process.env.SERVICE_NAME || process.env.RAILWAY_SERVICE_NAME || 'local-cli',
      host: process.env.PULSE_EMITTER_HOST || '',
    },
  };

  const signed = signPacket(packet, secret);

  // Fire-and-forget semantics in spirit; we still await POSTs so the CLI doesn't exit early.
  await Promise.allSettled(targets.map(t => postJson(t, signed)));

  // Print only packet id for correlation.
  console.log(packet.id);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

