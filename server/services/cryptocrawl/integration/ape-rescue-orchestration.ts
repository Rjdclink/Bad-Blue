import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export type ApeRescueDefect = 'cost_positive_gross' | 'structural_nonpositive_gross';

export interface ApeCandidateRescueSnapshot {
  id: string;
  generation: string;
  fresh: boolean;
  unresolved: boolean;
  baselineBps: number;
  currentBps: number;
  improvementBps: number;
  improvementVelocityBpsPerSecond: number;
  distanceToPositiveBps: number;
  slackMs: number;
  quoteLatencyMs: number;
}

export interface ApeTierBudget {
  hardDeadlineAt: number;
  freshnessBoundaryAt: number;
  v4DeadlineAt: number;
  downstreamReserveMs: number;
  usableWindowMs: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function grossProfitBaseUnits(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

/**
 * Cheap exact defect classification from evidence already present on the Stage-1
 * candidate. No registry read, model, RPC, database call, quote or new economics
 * calculation is introduced. A candidate with positive gross route value can be
 * rescued by cost/provider/size compression; a non-positive-gross candidate first
 * needs a structural route/edge change because cost compression cannot create
 * gross edge that is not there.
 */
export function classifyApeRescueDefect(opportunity: ZeroCapitalOpportunity): ApeRescueDefect {
  return grossProfitBaseUnits(opportunity) > 0n
    ? 'cost_positive_gross'
    : 'structural_nonpositive_gross';
}

export function apeV4FirstCandidate(opportunity: ZeroCapitalOpportunity): boolean {
  return classifyApeRescueDefect(opportunity) === 'cost_positive_gross';
}

export function apeStructuralFirstCandidate(opportunity: ZeroCapitalOpportunity): boolean {
  return classifyApeRescueDefect(opportunity) === 'structural_nonpositive_gross';
}

/**
 * APE ownership and execution freshness are intentionally separate concepts.
 * A timed-out or newly-stale negative candidate remains APE-owned until its
 * compatible toolbox is genuinely exhausted. Freshness is still mandatory for
 * measured tools and canonical promotion; this predicate never grants execution.
 */
export function isApeUnresolvedOwnershipCandidate(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}

export function isApeFreshMeasuredCandidate(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): boolean {
  return isApeUnresolvedOwnershipCandidate(opportunity) && opportunity.expiresAt > now;
}

function generationOf(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.id}:${opportunity.timestamp}:${opportunity.expiresAt}`;
}

/**
 * Resident-only rescue state. No network, persistence, model, quote, RPC or
 * scheduler handoff is introduced here. The snapshot is advisory scheduling
 * state only; canonical economics remains the sole profitability authority.
 */
export function buildApeCandidateRescueSnapshots(input: {
  roots: readonly ZeroCapitalOpportunity[];
  current: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  now?: number;
}): ApeCandidateRescueSnapshot[] {
  const now = input.now ?? Date.now();
  const elapsedSeconds = Math.max(0.001, (now - input.startedAt) / 1_000);
  const roots = new Map(input.roots.map(opportunity => [opportunity.id, opportunity]));

  return input.current.map(opportunity => {
    const root = roots.get(opportunity.id) ?? opportunity;
    const baselineBps = finite(root.netProfitBps, Number.NEGATIVE_INFINITY);
    const currentBps = finite(opportunity.netProfitBps, Number.NEGATIVE_INFINITY);
    const improvementBps = Number.isFinite(baselineBps) && Number.isFinite(currentBps)
      ? currentBps - baselineBps
      : 0;
    return {
      id: opportunity.id,
      generation: generationOf(opportunity),
      fresh: opportunity.expiresAt > now,
      unresolved: isApeUnresolvedOwnershipCandidate(opportunity),
      baselineBps,
      currentBps,
      improvementBps,
      improvementVelocityBpsPerSecond: improvementBps / elapsedSeconds,
      distanceToPositiveBps: Number.isFinite(currentBps) ? Math.max(0, -currentBps) : Number.POSITIVE_INFINITY,
      slackMs: Math.max(0, opportunity.expiresAt - now),
      quoteLatencyMs: Math.max(0, finite(opportunity.quoteLatencyMs, 0)),
    };
  });
}

/**
 * Momentum and distance change scheduling priority, never candidate survival.
 * Urgency is the final tiebreaker so a short-lived candidate is not hidden behind
 * a materially equivalent long-lived candidate. This function performs only
 * bounded in-memory comparisons.
 */
export function prioritizeApeRescueCandidates(input: {
  roots: readonly ZeroCapitalOpportunity[];
  current: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  now?: number;
}): ZeroCapitalOpportunity[] {
  const now = input.now ?? Date.now();
  const snapshots = buildApeCandidateRescueSnapshots({ ...input, now });
  const state = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));

  return [...input.current].sort((left, right) => {
    const a = state.get(left.id)!;
    const b = state.get(right.id)!;
    if (a.unresolved !== b.unresolved) return a.unresolved ? -1 : 1;
    if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    if (a.improvementVelocityBpsPerSecond !== b.improvementVelocityBpsPerSecond) {
      return b.improvementVelocityBpsPerSecond - a.improvementVelocityBpsPerSecond;
    }
    if (a.improvementBps !== b.improvementBps) return b.improvementBps - a.improvementBps;
    if (a.distanceToPositiveBps !== b.distanceToPositiveBps) return a.distanceToPositiveBps - b.distanceToPositiveBps;
    if (a.slackMs !== b.slackMs) return a.slackMs - b.slackMs;
    if (a.quoteLatencyMs !== b.quoteLatencyMs) return a.quoteLatencyMs - b.quoteLatencyMs;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Reserve a slice of the already-existing candidate window for downstream tools
 * and final proof. This never lengthens the hot path: it only prevents V4 from
 * consuming 100% of the window that already exists.
 */
export function buildApeTierBudget(input: {
  candidates: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  hardDeadlineAt: number;
  now?: number;
}): ApeTierBudget {
  const now = input.now ?? Date.now();
  const finiteExpiries = input.candidates
    .filter(isApeUnresolvedOwnershipCandidate)
    .map(candidate => candidate.expiresAt)
    .filter(expiry => Number.isFinite(expiry) && expiry > now)
    .sort((a, b) => a - b);

  const freshnessBoundaryAt = finiteExpiries.length > 0
    ? Math.min(input.hardDeadlineAt, finiteExpiries[0])
    : input.hardDeadlineAt;
  const usableWindowMs = Math.max(0, freshnessBoundaryAt - now);

  // Dynamic, bounded reserve: at most 30% of the already-existing window, with
  // a small ceiling. No new waiting or I/O is introduced.
  const targetReserve = Math.min(750, Math.floor(usableWindowMs * 0.30));
  const maximumReserve = Math.max(0, usableWindowMs - 75);
  const downstreamReserveMs = Math.min(maximumReserve, Math.max(0, targetReserve));
  const v4DeadlineAt = Math.max(now, freshnessBoundaryAt - downstreamReserveMs);

  return {
    hardDeadlineAt: input.hardDeadlineAt,
    freshnessBoundaryAt,
    v4DeadlineAt,
    downstreamReserveMs,
    usableWindowMs,
  };
}

export function apeGenerationMatches(
  opportunity: ZeroCapitalOpportunity,
  generation: string,
): boolean {
  return generationOf(opportunity) === generation;
}
