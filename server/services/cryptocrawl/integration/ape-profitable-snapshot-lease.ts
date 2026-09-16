import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { clearsStrictPositiveOutputThreshold } from './zero-capital-profit-output-floor.js';

/**
 * Resident, candidate-local profitable snapshot lease.
 *
 * This module is deliberately O(1), synchronous and I/O-free. It never extends stale
 * evidence. Instead it retains two immutable-by-convention object references:
 * - bestProfit: highest proven live absolute all-in profit seen for this candidate.
 * - freshestPositive: longest-lived proven positive successor available as shadow.
 *
 * APE may experiment on other derived objects without overwriting either pointer.
 */
export type ApeProfitLeaseMode = 'none' | 'optimize' | 'refresh_shadow' | 'dispatch_now';

export interface ApeProfitLeaseDecision {
  candidateId: string;
  mode: ApeProfitLeaseMode;
  snapshot: ZeroCapitalOpportunity | null;
  bestProfit: ZeroCapitalOpportunity | null;
  freshestPositive: ZeroCapitalOpportunity | null;
  refreshAt: number | null;
  dispatchBy: number | null;
  remainingMs: number | null;
  executionReserveMs: number | null;
  refreshReserveMs: number | null;
}

type LeaseState = {
  bestProfit: ZeroCapitalOpportunity;
  freshestPositive: ZeroCapitalOpportunity;
  updatedAt: number;
};

const leases = new Map<string, LeaseState>();
const MAX_RESIDENT_LEASES = 4096;
let observations = 0;
let bestProfitReplacements = 0;
let freshnessSuccessors = 0;
let expiredEvictions = 0;
let dispatchDecisions = 0;
let refreshDecisions = 0;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function quoteLatencyMs(candidate: ZeroCapitalOpportunity): number {
  const measured = Number(candidate.quoteLatencyMs);
  return Number.isFinite(measured) && measured > 0 ? measured : 0;
}

function executionReserveMs(candidate: ZeroCapitalOpportunity): number {
  const floor = bounded(process.env.ZERO_CAPITAL_APE_EXECUTION_RESERVE_MS, 750, 100, 8_000);
  // Tail-aware reserve without another measurement call: use already-resident quote
  // latency and a conservative multiplier for final validation/submission overhead.
  return Math.trunc(Math.max(floor, quoteLatencyMs(candidate) * 4));
}

function refreshReserveMs(candidate: ZeroCapitalOpportunity): number {
  const floor = bounded(process.env.ZERO_CAPITAL_APE_REFRESH_RESERVE_MS, 1_500, 250, 15_000);
  return Math.trunc(Math.max(floor, quoteLatencyMs(candidate) * 6, executionReserveMs(candidate) * 2));
}

function dispatchBy(candidate: ZeroCapitalOpportunity): number {
  return candidate.expiresAt - executionReserveMs(candidate);
}

function refreshAt(candidate: ZeroCapitalOpportunity): number {
  return candidate.expiresAt - refreshReserveMs(candidate);
}

function livePositive(candidate: ZeroCapitalOpportunity | null | undefined, now: number): candidate is ZeroCapitalOpportunity {
  return Boolean(candidate)
    && candidate!.expiresAt > now
    && clearsStrictPositiveOutputThreshold(candidate!, now);
}

function betterAbsoluteProfit(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): boolean {
  if (left.expectedProfit !== right.expectedProfit) return left.expectedProfit > right.expectedProfit;
  if (left.netProfitBps !== right.netProfitBps) return left.netProfitBps > right.netProfitBps;
  if (left.expiresAt !== right.expiresAt) return left.expiresAt > right.expiresAt;
  return left.timestamp > right.timestamp;
}

function fresher(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): boolean {
  if (left.expiresAt !== right.expiresAt) return left.expiresAt > right.expiresAt;
  if (left.timestamp !== right.timestamp) return left.timestamp > right.timestamp;
  return betterAbsoluteProfit(left, right);
}

function prune(now: number): void {
  for (const [id, lease] of leases) {
    if (lease.bestProfit.expiresAt <= now && lease.freshestPositive.expiresAt <= now) {
      leases.delete(id);
      expiredEvictions += 1;
    }
  }
  while (leases.size > MAX_RESIDENT_LEASES) {
    const oldest = leases.keys().next().value as string | undefined;
    if (!oldest) break;
    leases.delete(oldest);
  }
}

/**
 * Observe a proven candidate without mutating it. Failed/worse optimization attempts
 * cannot overwrite the best profitable pointer. A newer positive generation may still
 * become the freshness shadow even when its profit is lower.
 */
export function observeApeProfitableSnapshot(
  candidate: ZeroCapitalOpportunity,
  now = Date.now(),
): boolean {
  observations += 1;
  if (!livePositive(candidate, now)) return false;
  const current = leases.get(candidate.id);
  if (!current) {
    leases.set(candidate.id, { bestProfit: candidate, freshestPositive: candidate, updatedAt: now });
    prune(now);
    return true;
  }

  let changed = false;
  let bestProfit = current.bestProfit;
  let freshestPositive = current.freshestPositive;

  if (!livePositive(bestProfit, now) || betterAbsoluteProfit(candidate, bestProfit)) {
    bestProfit = candidate;
    bestProfitReplacements += 1;
    changed = true;
  }
  if (!livePositive(freshestPositive, now) || fresher(candidate, freshestPositive)) {
    freshestPositive = candidate;
    freshnessSuccessors += 1;
    changed = true;
  }

  if (changed) leases.set(candidate.id, { bestProfit, freshestPositive, updatedAt: now });
  prune(now);
  return changed;
}

function liveLeaseCandidates(state: LeaseState, now: number): ZeroCapitalOpportunity[] {
  const output: ZeroCapitalOpportunity[] = [];
  if (livePositive(state.bestProfit, now)) output.push(state.bestProfit);
  if (
    state.freshestPositive !== state.bestProfit
    && livePositive(state.freshestPositive, now)
  ) output.push(state.freshestPositive);
  return output;
}

/** Highest-profit currently executable snapshot; freshest shadow is fallback on expiry. */
export function getApeBestExecutableSnapshot(
  candidateId: string,
  now = Date.now(),
): ZeroCapitalOpportunity | null {
  const state = leases.get(candidateId);
  if (!state) return null;
  const live = liveLeaseCandidates(state, now);
  if (live.length === 0) {
    leases.delete(candidateId);
    expiredEvictions += 1;
    return null;
  }
  live.sort((left, right) => betterAbsoluteProfit(left, right) ? -1 : betterAbsoluteProfit(right, left) ? 1 : 0);
  return live[0] ?? null;
}

/**
 * Dynamic lease decision. `dispatch_now` means optimization must yield the hot path
 * to downstream execution before this already-profitable snapshot loses its reserve.
 */
export function getApeProfitLeaseDecision(
  candidateId: string,
  now = Date.now(),
): ApeProfitLeaseDecision {
  const state = leases.get(candidateId);
  if (!state) {
    return {
      candidateId,
      mode: 'none',
      snapshot: null,
      bestProfit: null,
      freshestPositive: null,
      refreshAt: null,
      dispatchBy: null,
      remainingMs: null,
      executionReserveMs: null,
      refreshReserveMs: null,
    };
  }

  const snapshot = getApeBestExecutableSnapshot(candidateId, now);
  if (!snapshot) {
    return {
      candidateId,
      mode: 'none',
      snapshot: null,
      bestProfit: null,
      freshestPositive: null,
      refreshAt: null,
      dispatchBy: null,
      remainingMs: null,
      executionReserveMs: null,
      refreshReserveMs: null,
    };
  }

  const executionReserve = executionReserveMs(snapshot);
  const refreshReserve = refreshReserveMs(snapshot);
  const localDispatchBy = snapshot.expiresAt - executionReserve;
  const localRefreshAt = snapshot.expiresAt - refreshReserve;
  const mode: ApeProfitLeaseMode = now >= localDispatchBy
    ? 'dispatch_now'
    : now >= localRefreshAt
      ? 'refresh_shadow'
      : 'optimize';
  if (mode === 'dispatch_now') dispatchDecisions += 1;
  if (mode === 'refresh_shadow') refreshDecisions += 1;

  return {
    candidateId,
    mode,
    snapshot,
    bestProfit: livePositive(state.bestProfit, now) ? state.bestProfit : null,
    freshestPositive: livePositive(state.freshestPositive, now) ? state.freshestPositive : null,
    refreshAt: localRefreshAt,
    dispatchBy: localDispatchBy,
    remainingMs: Math.max(0, snapshot.expiresAt - now),
    executionReserveMs: executionReserve,
    refreshReserveMs: refreshReserve,
  };
}

/** Deadline for optional optimization work; execution reserve always wins. */
export function capApeOptimizationDeadline(
  candidateId: string,
  proposedDeadlineAt: number,
  now = Date.now(),
): number {
  const decision = getApeProfitLeaseDecision(candidateId, now);
  return decision.dispatchBy === null ? proposedDeadlineAt : Math.min(proposedDeadlineAt, decision.dispatchBy);
}

export function getApeProfitableSnapshotLeaseSnapshot(now = Date.now()) {
  prune(now);
  let liveBestProfit = 0;
  let liveFreshnessShadows = 0;
  let dispatchNow = 0;
  let refreshShadow = 0;
  for (const [candidateId, state] of leases) {
    if (livePositive(state.bestProfit, now)) liveBestProfit += 1;
    if (state.freshestPositive !== state.bestProfit && livePositive(state.freshestPositive, now)) liveFreshnessShadows += 1;
    const decision = getApeProfitLeaseDecision(candidateId, now);
    if (decision.mode === 'dispatch_now') dispatchNow += 1;
    if (decision.mode === 'refresh_shadow') refreshShadow += 1;
  }
  return {
    residentLeases: leases.size,
    liveBestProfit,
    liveFreshnessShadows,
    dispatchNow,
    refreshShadow,
    observations,
    bestProfitReplacements,
    freshnessSuccessors,
    expiredEvictions,
    dispatchDecisions,
    refreshDecisions,
    storageAuthority: 'resident_candidate_local_pointer_only' as const,
    persistenceOnHotPath: false as const,
    networkIoOnDecisionPath: false as const,
    staleEvidenceExtended: false as const,
    bestSnapshotOverwriteByWorseAttempt: false as const,
    strictPositiveStopsOptimization: false as const,
  };
}
