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
  structuralDeadlineAt: number;
  v4DeadlineAt: number;
  compositeDeadlineAt: number;
  structuralBudgetMs: number;
  v4BudgetMs: number;
  compositeBudgetMs: number;
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

/** Candidate ownership and evidence lifetime are intentionally independent. */
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
  return opportunity.id;
}

function evidenceGenerationOf(opportunity: ZeroCapitalOpportunity): string {
  return [
    opportunity.timestamp,
    opportunity.expiresAt,
    opportunity.netProfitBps,
    opportunity.flashLoanAmount.toString(),
  ].join(':');
}

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
 * One freshness-capped budget is partitioned into protected lanes. The lanes are
 * slices of the existing window, never additive time. Structural-negative work is
 * guaranteed the first slice, V4 owns the middle slice, and exact composite proof
 * retains the final slice. A stale candidate is still owned; when every input is
 * stale the configured wave deadline remains available solely to reacquire fresh
 * evidence, never to execute stale evidence.
 */
export function buildApeTierBudget(input: {
  candidates: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  hardDeadlineAt: number;
  now?: number;
}): ApeTierBudget {
  const now = input.now ?? Date.now();
  const configuredBoundaryAt = Math.max(now, input.hardDeadlineAt);
  const freshExpiries = input.candidates
    .map(candidate => candidate.expiresAt)
    .filter(expiresAt => Number.isFinite(expiresAt) && expiresAt > now);

  // Do not let a work wave outlive the evidence window it entered with. When all
  // evidence is already stale, keep the configured bounded window so workers may
  // reacquire evidence; stale evidence itself still has no execution authority.
  const observedFreshBoundaryAt = freshExpiries.length > 0
    ? Math.max(...freshExpiries)
    : configuredBoundaryAt;
  const freshnessBoundaryAt = Math.min(configuredBoundaryAt, observedFreshBoundaryAt);
  const hardDeadlineAt = freshnessBoundaryAt;
  const usableWindowMs = Math.max(0, hardDeadlineAt - now);

  // Protected lane fractions use the same total budget. No lane can borrow time
  // from a later lane, which prevents slow V4 quotes from starving split/composite.
  const structuralBudgetMs = Math.max(0, Math.floor(usableWindowMs * 0.30));
  const compositeBudgetMs = Math.max(0, Math.floor(usableWindowMs * 0.25));
  const v4BudgetMs = Math.max(0, usableWindowMs - structuralBudgetMs - compositeBudgetMs);
  const structuralDeadlineAt = Math.min(hardDeadlineAt, now + structuralBudgetMs);
  const v4DeadlineAt = Math.min(hardDeadlineAt, structuralDeadlineAt + v4BudgetMs);
  const compositeDeadlineAt = hardDeadlineAt;
  const downstreamReserveMs = Math.max(0, compositeDeadlineAt - v4DeadlineAt);

  return {
    hardDeadlineAt,
    freshnessBoundaryAt,
    structuralDeadlineAt,
    v4DeadlineAt,
    compositeDeadlineAt,
    structuralBudgetMs,
    v4BudgetMs,
    compositeBudgetMs,
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
