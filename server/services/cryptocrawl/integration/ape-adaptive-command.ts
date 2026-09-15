import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  buildApeCandidateRescueSnapshots,
  classifyApeRescueDefect,
} from './ape-rescue-orchestration.js';

/**
 * Resident APE command intelligence.
 *
 * This layer is deliberately advisory: it allocates search time, orders candidates,
 * plans transformation sequences and retires only the current evidence generation.
 * It never manufactures economics and never owns promotion/execution authority.
 */
export type ApeTactic = 'route_split' | 'single_route_v4' | 'shared_principal_stack';
export type ApeMeritRank = 0 | 1 | 2 | 3 | 4;

type TacticAggregate = {
  attempts: number;
  improvements: number;
  strictPositive: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
};

type TransitionAggregate = {
  attempts: number;
  improvements: number;
  cumulativeImprovementBps: number;
};

type CandidateState = {
  generation: string;
  rank: ApeMeritRank;
  attempts: number;
  improvements: number;
  noImprovementStreak: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
  triedTactics: Set<ApeTactic>;
  lastTactic: ApeTactic | null;
  retired: boolean;
};

export interface ApeCounterfactualPlan {
  candidateId: string;
  sequence: ApeTactic[];
  planningDepth: number;
  brainCount: number;
  preferredFirstTactic: ApeTactic;
  exactEconomicsAuthority: false;
  executionAuthority: false;
}

const candidateStates = new Map<string, CandidateState>();
const tacticAggregates = new Map<ApeTactic, TacticAggregate>();
const transitionAggregates = new Map<string, TransitionAggregate>();
const MAX_RESIDENT_KEYS = 4096;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function pruneMap<T>(map: Map<string, T>): void {
  while (map.size > MAX_RESIDENT_KEYS) {
    const key = map.keys().next().value as string | undefined;
    if (!key) break;
    map.delete(key);
  }
}

function candidateGeneration(root: ZeroCapitalOpportunity): string {
  return [
    root.id,
    root.timestamp,
    root.expiresAt,
    root.flashLoanAmount.toString(),
  ].join(':');
}

function freshCandidateState(root: ZeroCapitalOpportunity): CandidateState {
  return {
    generation: candidateGeneration(root),
    rank: 0,
    attempts: 0,
    improvements: 0,
    noImprovementStreak: 0,
    cumulativeImprovementBps: 0,
    cumulativeLatencyMs: 0,
    triedTactics: new Set<ApeTactic>(),
    lastTactic: null,
    retired: false,
  };
}

function stateFor(root: ZeroCapitalOpportunity): CandidateState {
  const generation = candidateGeneration(root);
  const current = candidateStates.get(root.id);
  if (!current || current.generation !== generation) {
    const next = freshCandidateState(root);
    candidateStates.set(root.id, next);
    pruneMap(candidateStates);
    return next;
  }
  return current;
}

function strictNormalizedImprovement(before: ZeroCapitalOpportunity, after: ZeroCapitalOpportunity): boolean {
  if (before.flashLoanAmount <= 0n || after.flashLoanAmount <= 0n) return false;
  return after.expectedProfit * before.flashLoanAmount > before.expectedProfit * after.flashLoanAmount;
}

function improvementBps(before: ZeroCapitalOpportunity, after: ZeroCapitalOpportunity): number {
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return 0;
  return after.netProfitBps - before.netProfitBps;
}

function aggregateFor(tactic: ApeTactic): TacticAggregate {
  const current = tacticAggregates.get(tactic);
  if (current) return current;
  const created: TacticAggregate = {
    attempts: 0,
    improvements: 0,
    strictPositive: 0,
    cumulativeImprovementBps: 0,
    cumulativeLatencyMs: 0,
  };
  tacticAggregates.set(tactic, created);
  return created;
}

function transitionKey(from: ApeTactic, to: ApeTactic): string {
  return `${from}->${to}`;
}

function promote(rank: ApeMeritRank, steps: number): ApeMeritRank {
  return Math.max(0, Math.min(4, rank + steps)) as ApeMeritRank;
}

function demote(rank: ApeMeritRank): ApeMeritRank {
  return Math.max(0, rank - 1) as ApeMeritRank;
}

/**
 * Exact measured improvement controls promotion. A larger-than-own-history gain can
 * advance two rungs; otherwise an improvement advances one. Stalls demote only
 * search priority and never reject the opportunity globally.
 */
export function recordApeCommandOutcome(input: {
  root: ZeroCapitalOpportunity;
  before: ZeroCapitalOpportunity;
  after: ZeroCapitalOpportunity;
  tactic: ApeTactic;
  elapsedMs: number;
}): void {
  const state = stateFor(input.root);
  const tactic = aggregateFor(input.tactic);
  const priorAverageImprovement = state.improvements > 0
    ? state.cumulativeImprovementBps / state.improvements
    : 0;
  const deltaBps = improvementBps(input.before, input.after);
  const improved = strictNormalizedImprovement(input.before, input.after) && deltaBps > 0;
  const previousTactic = state.lastTactic;

  state.attempts += 1;
  state.triedTactics.add(input.tactic);
  state.cumulativeLatencyMs += Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);
  tactic.attempts += 1;
  tactic.cumulativeLatencyMs += Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);

  if (improved) {
    state.improvements += 1;
    state.noImprovementStreak = 0;
    state.cumulativeImprovementBps += deltaBps;
    state.rank = promote(state.rank, priorAverageImprovement > 0 && deltaBps > priorAverageImprovement ? 2 : 1);
    state.retired = false;
    tactic.improvements += 1;
    tactic.cumulativeImprovementBps += deltaBps;
    if (input.after.expectedProfit > 0n) tactic.strictPositive += 1;
  } else {
    state.noImprovementStreak += 1;
    if (state.noImprovementStreak >= 2) state.rank = demote(state.rank);
  }

  if (previousTactic && previousTactic !== input.tactic) {
    const key = transitionKey(previousTactic, input.tactic);
    const transition = transitionAggregates.get(key) ?? {
      attempts: 0,
      improvements: 0,
      cumulativeImprovementBps: 0,
    };
    transition.attempts += 1;
    if (improved) {
      transition.improvements += 1;
      transition.cumulativeImprovementBps += deltaBps;
    }
    transitionAggregates.set(key, transition);
    pruneMap(transitionAggregates);
  }
  state.lastTactic = input.tactic;
}

/** Current-generation retirement only. New Stage-1 evidence creates a new generation. */
export function candidateRetiredForGeneration(root: ZeroCapitalOpportunity): boolean {
  const state = stateFor(root);
  if (state.retired) return true;
  const maxStalls = Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RETIRE_AFTER_STALLS, 3, 2, 8));
  const minDistinctTactics = Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RETIRE_MIN_TACTICS, 2, 2, 3));
  if (
    root.expectedProfit <= 0n
    && state.noImprovementStreak >= maxStalls
    && state.triedTactics.size >= minDistinctTactics
  ) state.retired = true;
  return state.retired;
}

function tacticSuccessRate(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  if (!aggregate || aggregate.attempts <= 0) return 0;
  return aggregate.improvements / aggregate.attempts;
}

function tacticImprovementPerMs(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  if (!aggregate || aggregate.cumulativeLatencyMs <= 0) return 0;
  return aggregate.cumulativeImprovementBps / aggregate.cumulativeLatencyMs;
}

function tacticAverageLatencyMs(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  if (!aggregate || aggregate.attempts <= 0) return Number.POSITIVE_INFINITY;
  return aggregate.cumulativeLatencyMs / aggregate.attempts;
}

function transitionScore(from: ApeTactic | null, to: ApeTactic): number {
  if (!from || from === to) return 0;
  const aggregate = transitionAggregates.get(transitionKey(from, to));
  if (!aggregate || aggregate.attempts <= 0) return 0;
  return (aggregate.improvements / aggregate.attempts) * 10
    + aggregate.cumulativeImprovementBps / aggregate.attempts;
}

/**
 * Demand multiplier for elastic lane allocation. It reflects measured search yield,
 * never economic truth. Unobserved tactics remain neutral and retain exploration.
 */
export function getApeTacticDemandMultiplier(tactic: ApeTactic): number {
  const success = tacticSuccessRate(tactic);
  const efficiency = tacticImprovementPerMs(tactic);
  const latency = tacticAverageLatencyMs(tactic);
  const latencyPenalty = Number.isFinite(latency) ? Math.min(0.4, Math.log1p(latency) / 20) : 0;
  return Math.max(0.5, Math.min(3, 1 + success + Math.max(0, efficiency) * 25 - latencyPenalty));
}

function reciprocalRankFusion(rankings: readonly ApeTactic[][], candidates: readonly ApeTactic[]): Map<ApeTactic, number> {
  const scores = new Map<ApeTactic, number>(candidates.map(tactic => [tactic, 0]));
  for (const ranking of rankings) {
    ranking.forEach((tactic, index) => {
      if (!scores.has(tactic)) return;
      scores.set(tactic, (scores.get(tactic) ?? 0) + 1 / (10 + index));
    });
  }
  return scores;
}

/**
 * Multi-brain tactical portfolio + depth-bounded counterfactual planner.
 * Brains: exact defect, measured historical yield, latency, novelty, and learned
 * tactic transitions. The exact defect brain fixes the first move so prior safety
 * semantics remain intact; the other brains plan the remaining transformation path.
 */
export function buildApeCounterfactualPlan(input: {
  root: ZeroCapitalOpportunity;
  compatibleGroupSize: number;
}): ApeCounterfactualPlan {
  const state = stateFor(input.root);
  const compatible: ApeTactic[] = ['route_split', 'single_route_v4'];
  if (input.compatibleGroupSize >= 2) compatible.push('shared_principal_stack');

  const defect = classifyApeRescueDefect(input.root);
  const first: ApeTactic = defect === 'structural_nonpositive_gross' ? 'route_split' : 'single_route_v4';
  const remaining = compatible.filter(tactic => tactic !== first);

  const historical = [...remaining].sort((a, b) => getApeTacticDemandMultiplier(b) - getApeTacticDemandMultiplier(a));
  const latency = [...remaining].sort((a, b) => tacticAverageLatencyMs(a) - tacticAverageLatencyMs(b));
  const novelty = [...remaining].sort((a, b) => Number(state.triedTactics.has(a)) - Number(state.triedTactics.has(b)));
  const transitions = [...remaining].sort((a, b) => transitionScore(state.lastTactic ?? first, b) - transitionScore(state.lastTactic ?? first, a));
  const composition = [...remaining].sort((a, b) => {
    if (input.compatibleGroupSize >= 2) {
      if (a === 'shared_principal_stack' && b !== 'shared_principal_stack') return -1;
      if (b === 'shared_principal_stack' && a !== 'shared_principal_stack') return 1;
    }
    return 0;
  });

  const fused = reciprocalRankFusion([historical, latency, novelty, transitions, composition], remaining);
  const orderedRemaining = [...remaining].sort((a, b) => {
    const score = (fused.get(b) ?? 0) - (fused.get(a) ?? 0);
    if (Math.abs(score) > 1e-12) return score;
    return a.localeCompare(b);
  });

  return {
    candidateId: input.root.id,
    sequence: [first, ...orderedRemaining],
    planningDepth: 1 + orderedRemaining.length,
    brainCount: 5,
    preferredFirstTactic: first,
    exactEconomicsAuthority: false,
    executionAuthority: false,
  };
}

export function rankApeCommandCandidates(input: {
  roots: readonly ZeroCapitalOpportunity[];
  current: readonly ZeroCapitalOpportunity[];
  startedAt: number;
  now?: number;
}): ZeroCapitalOpportunity[] {
  const now = input.now ?? Date.now();
  const snapshots = buildApeCandidateRescueSnapshots({ ...input, now });
  const snapshotById = new Map(snapshots.map(item => [item.id, item]));
  const roots = new Map(input.roots.map(item => [item.id, item]));

  return [...input.current]
    .filter(item => !candidateRetiredForGeneration(roots.get(item.id) ?? item))
    .sort((left, right) => {
      const rootLeft = roots.get(left.id) ?? left;
      const rootRight = roots.get(right.id) ?? right;
      const leftState = stateFor(rootLeft);
      const rightState = stateFor(rootRight);
      const a = snapshotById.get(left.id)!;
      const b = snapshotById.get(right.id)!;

      if (leftState.rank !== rightState.rank) return rightState.rank - leftState.rank;
      const leftScore = a.improvementVelocityBpsPerSecond * 4
        + a.improvementBps * 2
        - a.distanceToPositiveBps * 0.05
        - leftState.noImprovementStreak * 0.75
        + (a.fresh ? 0.5 : -2);
      const rightScore = b.improvementVelocityBpsPerSecond * 4
        + b.improvementBps * 2
        - b.distanceToPositiveBps * 0.05
        - rightState.noImprovementStreak * 0.75
        + (b.fresh ? 0.5 : -2);
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (a.slackMs !== b.slackMs) return a.slackMs - b.slackMs;
      return left.id.localeCompare(right.id);
    });
}

export function getApeAdaptiveCommandSnapshot() {
  const retiredGenerations = [...candidateStates.values()].filter(state => state.retired).length;
  const rankHistogram = [0, 1, 2, 3, 4].map(rank => ({
    rank,
    count: [...candidateStates.values()].filter(state => state.rank === rank).length,
  }));
  return {
    candidateStateKeys: candidateStates.size,
    retiredGenerations,
    rankHistogram,
    tacticStats: [...tacticAggregates.entries()].map(([tactic, aggregate]) => ({
      tactic,
      attempts: aggregate.attempts,
      improvements: aggregate.improvements,
      strictPositive: aggregate.strictPositive,
      improvementPerMs: tacticImprovementPerMs(tactic),
      averageLatencyMs: tacticAverageLatencyMs(tactic),
      demandMultiplier: getApeTacticDemandMultiplier(tactic),
    })),
    learnedTransitions: transitionAggregates.size,
    meritPromotionAuthority: 'search_priority_only' as const,
    generationLocalRetirement: true as const,
    resurrectionOnNewEvidenceGeneration: true as const,
    multiBrainCounterfactualPlanning: true as const,
    exactEconomicsAuthority: false as const,
    executionAuthority: false as const,
  };
}
