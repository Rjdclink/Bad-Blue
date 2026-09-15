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
  structuralProtectedMs: number;
  v4ProtectedMs: number;
  compositeProtectedMs: number;
  elasticPoolMs: number;
  structuralElasticGrantMs: number;
  v4ElasticGrantMs: number;
  compositeElasticGrantMs: number;
  downstreamReserveMs: number;
  usableWindowMs: number;
  elasticBudgeting: true;
}

export interface ApeBudgetDemand {
  structuralCandidates?: number;
  v4Candidates?: number;
  compositeCandidates?: number;
  structuralMultiplier?: number;
  v4Multiplier?: number;
  compositeMultiplier?: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Number(value))) : fallback;
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

function laneDemand(count: number, multiplier: number): number {
  if (count <= 0) return 0;
  return Math.sqrt(count) * bounded(multiplier, 1, 0.5, 3);
}

/**
 * Freshness-capped elastic budget. Each active lane keeps a protected minimum,
 * while the rest is allocated according to live demand and measured tactic yield.
 * Inactive lane reserves are immediately returned to the elastic pool. Because
 * deadlines are cumulative, finishing a lane early automatically transfers its
 * unused milliseconds to every later lane. No allocation crosses freshness.
 */
export function buildApeTierBudget(input: {
  candidates: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  hardDeadlineAt: number;
  now?: number;
  demand?: ApeBudgetDemand;
}): ApeTierBudget {
  const now = input.now ?? Date.now();
  const configuredBoundaryAt = Math.max(now, input.hardDeadlineAt);
  const freshExpiries = input.candidates
    .map(candidate => candidate.expiresAt)
    .filter(expiresAt => Number.isFinite(expiresAt) && expiresAt > now);

  const observedFreshBoundaryAt = freshExpiries.length > 0
    ? Math.min(...freshExpiries)
    : configuredBoundaryAt;
  const freshnessBoundaryAt = Math.min(configuredBoundaryAt, observedFreshBoundaryAt);
  const hardDeadlineAt = freshnessBoundaryAt;
  const usableWindowMs = Math.max(0, hardDeadlineAt - now);

  const structuralCount = Math.max(0, Math.trunc(input.demand?.structuralCandidates ?? input.candidates.filter(apeStructuralFirstCandidate).length));
  const v4Count = Math.max(0, Math.trunc(input.demand?.v4Candidates ?? input.candidates.length));
  const compositeCount = Math.max(0, Math.trunc(input.demand?.compositeCandidates ?? (input.candidates.length >= 2 ? input.candidates.length : 0)));

  const structuralProtectedMs = structuralCount > 0 ? Math.floor(usableWindowMs * 0.12) : 0;
  const v4ProtectedMs = v4Count > 0 ? Math.floor(usableWindowMs * 0.18) : 0;
  const compositeProtectedMs = compositeCount > 0 ? Math.floor(usableWindowMs * 0.15) : 0;
  const protectedTotalMs = structuralProtectedMs + v4ProtectedMs + compositeProtectedMs;
  const elasticPoolMs = Math.max(0, usableWindowMs - protectedTotalMs);

  const structuralDemand = laneDemand(structuralCount, input.demand?.structuralMultiplier ?? 1);
  const v4Demand = laneDemand(v4Count, input.demand?.v4Multiplier ?? 1);
  const compositeDemand = laneDemand(compositeCount, input.demand?.compositeMultiplier ?? 1);
  const demandTotal = structuralDemand + v4Demand + compositeDemand;

  const elasticGrant = (demand: number): number => demandTotal > 0
    ? Math.floor(elasticPoolMs * demand / demandTotal)
    : 0;

  let structuralElasticGrantMs = structuralCount > 0 ? elasticGrant(structuralDemand) : 0;
  let v4ElasticGrantMs = v4Count > 0 ? elasticGrant(v4Demand) : 0;
  let compositeElasticGrantMs = compositeCount > 0 ? elasticGrant(compositeDemand) : 0;

  const granted = structuralElasticGrantMs + v4ElasticGrantMs + compositeElasticGrantMs;
  const remainder = Math.max(0, elasticPoolMs - granted);
  if (compositeCount > 0) compositeElasticGrantMs += remainder;
  else if (v4Count > 0) v4ElasticGrantMs += remainder;
  else structuralElasticGrantMs += remainder;

  const structuralBudgetMs = structuralCount > 0
    ? structuralProtectedMs + structuralElasticGrantMs
    : 0;
  const v4BudgetMs = v4Count > 0
    ? v4ProtectedMs + v4ElasticGrantMs
    : 0;
  const compositeBudgetMs = Math.max(0, usableWindowMs - structuralBudgetMs - v4BudgetMs);

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
    structuralProtectedMs,
    v4ProtectedMs,
    compositeProtectedMs,
    elasticPoolMs,
    structuralElasticGrantMs,
    v4ElasticGrantMs,
    compositeElasticGrantMs,
    downstreamReserveMs,
    usableWindowMs,
    elasticBudgeting: true,
  };
}

export function apeGenerationMatches(
  opportunity: ZeroCapitalOpportunity,
  generation: string,
): boolean {
  return generationOf(opportunity) === generation;
}
