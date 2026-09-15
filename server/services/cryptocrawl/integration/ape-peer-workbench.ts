import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export type ApePeerWorker = 'dispatcher' | 'v4' | 'route_split' | 'composite';

export interface ApePeerHint {
  worker: ApePeerWorker;
  kind: string;
  value: string;
  observedAt: number;
}

type ApePeerEntry = {
  generation: string;
  expiresAt: number;
  best: ZeroCapitalOpportunity;
  bestWorker: ApePeerWorker;
  hints: ApePeerHint[];
  inFlight: Map<string, Promise<unknown>>;
};

const peerWorkbench = new Map<string, ApePeerEntry>();
const MAX_ENTRIES = 1024;
const MAX_HINTS_PER_ENTRY = 16;

function generationOf(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.id}:${opportunity.timestamp}:${opportunity.expiresAt}`;
}

function exactNetRatioBetter(candidate: ZeroCapitalOpportunity, incumbent: ZeroCapitalOpportunity): boolean {
  if (candidate.flashLoanAmount <= 0n || incumbent.flashLoanAmount <= 0n) return false;
  const left = candidate.expectedProfit * incumbent.flashLoanAmount;
  const right = incumbent.expectedProfit * candidate.flashLoanAmount;
  if (left !== right) return left > right;
  if (candidate.expectedProfit !== incumbent.expectedProfit) return candidate.expectedProfit > incumbent.expectedProfit;
  return candidate.netProfitBps > incumbent.netProfitBps;
}

function prune(now = Date.now()): void {
  for (const [id, entry] of peerWorkbench) {
    if (entry.expiresAt <= now) peerWorkbench.delete(id);
  }
  while (peerWorkbench.size > MAX_ENTRIES) {
    const oldest = peerWorkbench.keys().next().value as string | undefined;
    if (!oldest) break;
    peerWorkbench.delete(oldest);
  }
}

function ensureEntry(root: ZeroCapitalOpportunity, worker: ApePeerWorker = 'dispatcher'): ApePeerEntry {
  const generation = generationOf(root);
  const existing = peerWorkbench.get(root.id);
  if (existing && existing.generation === generation && existing.expiresAt > Date.now()) return existing;
  const entry: ApePeerEntry = {
    generation,
    expiresAt: root.expiresAt,
    best: root,
    bestWorker: worker,
    hints: [],
    inFlight: new Map(),
  };
  peerWorkbench.set(root.id, entry);
  prune();
  return entry;
}

/** Seed shared candidate state without copying or performing I/O. */
export function seedApePeerWorkbench(opportunities: readonly ZeroCapitalOpportunity[]): void {
  for (const opportunity of opportunities) ensureEntry(opportunity);
}

/**
 * Peer result injection. A worker may publish a strictly better derived result for
 * a root generation without taking ownership or changing execution authority.
 */
export function publishApePeerImprovement(
  worker: ApePeerWorker,
  root: ZeroCapitalOpportunity,
  candidate: ZeroCapitalOpportunity,
): boolean {
  const entry = ensureEntry(root);
  if (entry.generation !== generationOf(root) || Date.now() >= entry.expiresAt) return false;
  if (candidate.id !== root.id || candidate.expiresAt <= Date.now()) return false;
  if (!exactNetRatioBetter(candidate, entry.best)) return false;
  entry.best = candidate;
  entry.bestWorker = worker;
  return true;
}

/** Read the current peer incumbent in O(1), with generation fencing. */
export function peekApePeerBest(root: ZeroCapitalOpportunity): ZeroCapitalOpportunity | null {
  const entry = peerWorkbench.get(root.id);
  if (!entry || entry.generation !== generationOf(root) || entry.expiresAt <= Date.now()) return null;
  return entry.best;
}

/** Nonblocking peer hint channel; no acknowledgement or ownership transfer. */
export function publishApePeerHint(
  worker: ApePeerWorker,
  root: ZeroCapitalOpportunity,
  kind: string,
  value: string,
): void {
  const entry = ensureEntry(root);
  if (entry.generation !== generationOf(root) || Date.now() >= entry.expiresAt) return;
  entry.hints.push({ worker, kind, value, observedAt: Date.now() });
  if (entry.hints.length > MAX_HINTS_PER_ENTRY) {
    entry.hints.splice(0, entry.hints.length - MAX_HINTS_PER_ENTRY);
  }
}

export function readApePeerHints(root: ZeroCapitalOpportunity): readonly ApePeerHint[] {
  const entry = peerWorkbench.get(root.id);
  if (!entry || entry.generation !== generationOf(root) || entry.expiresAt <= Date.now()) return [];
  return entry.hints;
}

/**
 * Shared in-flight work slot. Multiple workers asking for the same generation/key
 * attach to one promise instead of launching duplicate work. The workbench itself
 * adds no work and removes the slot as soon as the shared promise settles.
 */
export function getOrCreateApeSharedWork<T>(
  root: ZeroCapitalOpportunity,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const entry = ensureEntry(root);
  const scopedKey = `${entry.generation}:${key}`;
  const existing = entry.inFlight.get(scopedKey);
  if (existing) return existing as Promise<T>;
  let pending: Promise<T>;
  pending = factory().finally(() => {
    if (entry.inFlight.get(scopedKey) === pending) entry.inFlight.delete(scopedKey);
  });
  entry.inFlight.set(scopedKey, pending as Promise<unknown>);
  return pending;
}

export function apePeerWorkbenchSnapshot(root: ZeroCapitalOpportunity): {
  bestWorker: ApePeerWorker | null;
  hintCount: number;
  sharedInFlightCount: number;
} {
  const entry = peerWorkbench.get(root.id);
  if (!entry || entry.generation !== generationOf(root) || entry.expiresAt <= Date.now()) {
    return { bestWorker: null, hintCount: 0, sharedInFlightCount: 0 };
  }
  return {
    bestWorker: entry.bestWorker,
    hintCount: entry.hints.length,
    sharedInFlightCount: entry.inFlight.size,
  };
}
