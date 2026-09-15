import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export type ApeRescueDefect = 'cost_positive_gross' | 'structural_nonpositive_gross';

export interface ApeCandidateRescueSnapshot {
  id: string;
  generation: string;
  evidenceGeneration: string;
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
 * calculation is introduced. Classification chooses the fastest first tool only;
 * it never removes another compatible rescue tool from a negative candidate.
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
 * A timed-out or stale negative candidate remains APE-owned. Fresh exact evidence
 * is still mandatory for promotion/execution, but negative BPS is work, not reject.
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

/** Stable candidate/work identity. */
function generationOf(opportunity: ZeroCapitalOpportunity): string {
  return opportunity.id;
}

/** Independently version the evidence carried by that stable candidate. */
function evidenceGenerationOf(opportunity: ZeroCapitalOpportunity): string {
  return [
    opportunity.timestamp,
    opportunity.expiresAt,
    opportunity.netProfitBps,
    opportunity.flashLoanAmount.toString(),
  ].join(':');
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
      evidenceGeneration: evidenceGenerationOf(opportunity),
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
 * Fresh evidence is preferred because it can be acted on immediately, but stale
 * candidates remain in the same ownership set and are refreshed by workers.
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
    if (a.quoteLatencyMs !== b.quoteLatencyMs) return a.quoteLatencyMs - b.quoteLatencyMs;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Reserve part of the existing APE wave for downstream tools. Candidate/evidence
 * expiry is deliberately NOT a hard boundary: stale evidence is refreshed and the
 * candidate remains owned. This function introduces no wait, poll or extra I/O.
 */
export function buildApeTierBudget(input: {
  candidates: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  hardDeadlineAt: number;
  now?: number;
}): ApeTierBudget {
  const now = input.now ?? Date.now();
  const freshnessBoundaryAt = input.hardDeadlineAt;
  const usableWindowMs = Math.max(0, input.hardDeadlineAt - now);

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
