import { randomUUID } from 'node:crypto';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

const traceIds = new WeakMap<object, string>();

/**
 * Process-local correlation identity for one maker plan lifecycle. The identifier
 * carries no execution authority and never contains credentials or market secrets.
 */
export function getMakerLifecycleTraceId(plan: VerifiedArbitragePlan): string {
  const key = plan as object;
  const existing = traceIds.get(key);
  if (existing) return existing;
  const traceId = `maker-${randomUUID()}`;
  traceIds.set(key, traceId);
  return traceId;
}
