import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  buildApeCandidateRescueSnapshots,
  classifyApeRescueDefect,
} from './ape-rescue-orchestration.js';
import { clearsFiveDollarOutputFloor } from './zero-capital-profit-output-floor.js';

/**
 * Resident APE command intelligence. Search priority only: exact economics and the
 * canonical $5 output floor remain sovereign. All state updates are O(1) and add no
 * network work to the hot path.
 */
export type ApeTactic = 'route_split' | 'single_route_v4' | 'shared_principal_stack';
export type ApeMeritRank = 0 | 1 | 2 | 3 | 4;

type TacticAggregate = {
  attempts: number;
  improvements: number;
  outputFloorWins: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
};

type CandidateTacticState = {
  attempts: number;
  improvements: number;
  stalls: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
  locallyDeprioritizedUntilAttempt: number;
};

type TransitionAggregate = {
  attempts: number;
  improvements: number;
  cumulativeImprovementBps: number;
};

type CandidateState = {
  generation: string;
  rank: ApeMeritRank;
  protectedRank: ApeMeritRank;
  attempts: number;
  improvements: number;
  noImprovementStreak: number;
  cumulativeImprovementBps: number;
  cumulativeLatencyMs: number;
  triedTactics: Set<ApeTactic>;
  lastTactic: ApeTactic | null;
  lastWinningTactic: ApeTactic | null;
  retired: boolean;
  tacticStates: Map<ApeTactic, CandidateTacticState>;
  cachedPlan: ApeCounterfactualPlan | null;
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
  return [root.id, root.timestamp, root.expiresAt, root.flashLoanAmount.toString()].join(':');
}

function freshCandidateState(root: ZeroCapitalOpportunity): CandidateState {
  return {
    generation: candidateGeneration(root),
    rank: 0,
    protectedRank: 0,
    attempts: 0,
    improvements: 0,
    noImprovementStreak: 0,
    cumulativeImprovementBps: 0,
    cumulativeLatencyMs: 0,
    triedTactics: new Set<ApeTactic>(),
    lastTactic: null,
    lastWinningTactic: null,
    retired: false,
    tacticStates: new Map<ApeTactic, CandidateTacticState>(),
    cachedPlan: null,
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

function tacticStateFor(state: CandidateState, tactic: ApeTactic): CandidateTacticState {
  const current = state.tacticStates.get(tactic);
  if (current) return current;
  const created: CandidateTacticState = {
    attempts: 0,
    improvements: 0,
    stalls: 0,
    cumulativeImprovementBps: 0,
    cumulativeLatencyMs: 0,
    locallyDeprioritizedUntilAttempt: 0,
  };
  state.tacticStates.set(tactic, created);
  return created;
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
    outputFloorWins: 0,
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

function tacticAverageLatencyMs(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  if (!aggregate || aggregate.attempts <= 0) return Number.POSITIVE_INFINITY;
  return aggregate.cumulativeLatencyMs / aggregate.attempts;
}

function tacticSuccessRate(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  return aggregate && aggregate.attempts > 0 ? aggregate.improvements / aggregate.attempts : 0;
}

function tacticImprovementPerMs(tactic: ApeTactic): number {
  const aggregate = tacticAggregates.get(tactic);
  return aggregate && aggregate.cumulativeLatencyMs > 0
    ? aggregate.cumulativeImprovementBps / aggregate.cumulativeLatencyMs
    : 0;
}

function locallyDeprioritized(state: CandidateState, tactic: ApeTactic): boolean {
  const local = tacticStateFor(state, tactic);
  return local.locallyDeprioritizedUntilAttempt > state.attempts;
}

function refreshLocalOutlierState(state: CandidateState, tactic: ApeTactic): void {
  const local = tacticStateFor(state, tactic);
  const average = local.attempts > 0 ? local.cumulativeLatencyMs / local.attempts : 0;
  const globalAverage = tacticAverageLatencyMs(tactic);
  const repeatedStall = local.stalls >= 2;
  const slow = average > 0 && Number.isFinite(globalAverage) && average >= Math.max(250, globalAverage * 1.35);
  if (repeatedStall && slow) {
    // Local ejection is temporary and attempt-count based: no timer/poll/network work.
    local.locallyDeprioritizedUntilAttempt = Math.max(local.locallyDeprioritizedUntilAttempt, state.attempts + 2);
  }
}

/**
 * Candidate merit and tactic merit are intentionally separate. A winning candidate
 * cannot lose its proven generation rank because a different tactic later stalls.
 */
export function recordApeCommandOutcome(input: {
  root: ZeroCapitalOpportunity;
  before: ZeroCapitalOpportunity;
  after: ZeroCapitalOpportunity;
  tactic: ApeTactic;
  elapsedMs: number;
}): void {
  const state = stateFor(input.root);
  const local = tacticStateFor(state, input.tactic);
  const aggregate = aggregateFor(input.tactic);
  const elapsedMs = Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);
  const priorAverageImprovement = state.improvements > 0
    ? state.cumulativeImprovementBps / state.improvements
    : 0;
  const deltaBps = improvementBps(input.before, input.after);
  const improved = strictNormalizedImprovement(input.before, input.after) && deltaBps > 0;
  const previousTactic = state.lastTactic;

  state.attempts += 1;
  state.triedTactics.add(input.tactic);
  state.cumulativeLatencyMs += elapsedMs;
  local.attempts += 1;
  local.cumulativeLatencyMs += elapsedMs;
  aggregate.attempts += 1;
  aggregate.cumulativeLatencyMs += elapsedMs;

  if (improved) {
    state.improvements += 1;
    state.noImprovementStreak = 0;
    state.cumulativeImprovementBps += deltaBps;
    const steps = priorAverageImprovement > 0 && deltaBps > priorAverageImprovement ? 2 : 1;
    state.rank = promote(state.rank, steps);
    state.protectedRank = Math.max(state.protectedRank, state.rank) as ApeMeritRank;
    state.lastWinningTactic = input.tactic;
    state.retired = false;
    local.improvements += 1;
    local.stalls = 0;
    local.cumulativeImprovementBps += deltaBps;
    local.locallyDeprioritizedUntilAttempt = 0;
    aggregate.improvements += 1;
    aggregate.cumulativeImprovementBps += deltaBps;
    if (clearsFiveDollarOutputFloor(input.after)) aggregate.outputFloorWins += 1;
  } else {
    state.noImprovementStreak += 1;
    local.stalls += 1;
    // Demote only the local tactic immediately. Candidate rank is protected after
    // measured improvement and can fall only before it has ever earned promotion.
    refreshLocalOutlierState(state, input.tactic);
    if (state.improvements === 0 && state.noImprovementStreak >= 2) {
      state.rank = demote(state.rank);
    } else if (state.rank < state.protectedRank) {
      state.rank = state.protectedRank;
    }
  }

  if (previousTactic && previousTactic !== input.tactic) {
    const key = transitionKey(previousTactic, input.tactic);
    const transition = transitionAggregates.get(key) ?? { attempts: 0, improvements: 0, cumulativeImprovementBps: 0 };
    transition.attempts += 1;
    if (improved) {
      transition.improvements += 1;
      transition.cumulativeImprovementBps += deltaBps;
    }
    transitionAggregates.set(key, transition);
    pruneMap(transitionAggregates);
  }
  state.lastTactic = input.tactic;
  state.cachedPlan = null;
}

/** Current-generation retirement only; positive-but-<$5 candidates stay APE-owned. */
export function candidateRetiredForGeneration(root: ZeroCapitalOpportunity): boolean {
  const state = stateFor(root);
  if (state.retired) return true;
  if (clearsFiveDollarOutputFloor(root)) return false;
  const maxStalls = Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RETIRE_AFTER_STALLS, 4, 3, 8));
  const minDistinctTactics = Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RETIRE_MIN_TACTICS, 3, 2, 3));
  const exhaustedDistinctTactics = [...state.tacticStates.values()].filter(local => local.stalls > 0).length;
  if (
    state.noImprovementStreak >= maxStalls
    && state.triedTactics.size >= minDistinctTactics
    && exhaustedDistinctTactics >= minDistinctTactics
  ) state.retired = true;
  return state.retired;
}

export function getApeTacticDemandMultiplier(tactic: ApeTactic): number {
  const success = tacticSuccessRate(tactic);
  const efficiency = tacticImprovementPerMs(tactic);
  const latency = tacticAverageLatencyMs(tactic);
  const latencyPenalty = Number.isFinite(latency) ? Math.min(0.6, Math.log1p(latency) / 16) : 0;
  return Math.max(0.35, Math.min(3, 1 + success + Math.max(0, efficiency) * 30 - latencyPenalty));
}

function transitionScore(from: ApeTactic | null, to: ApeTactic): number {
  if (!from || from === to) return 0;
  const aggregate = transitionAggregates.get(transitionKey(from, to));
  if (!aggregate || aggregate.attempts <= 0) return 0;
  return (aggregate.improvements / aggregate.attempts) * 10
    + aggregate.cumulativeImprovementBps / aggregate.attempts;
}

/**
 * Cached three-tactic plan. Intelligence is resident and reused; no network, model,
 * persistence, or deep synchronous search is introduced into the APE window.
 */
export function buildApeCounterfactualPlan(input: {
  root: ZeroCapitalOpportunity;
  compatibleGroupSize: number;
}): ApeCounterfactualPlan {
  const state = stateFor(input.root);
  if (state.cachedPlan) return state.cachedPlan;

  const compatible: ApeTactic[] = ['route_split', 'single_route_v4'];
  if (input.compatibleGroupSize >= 2) compatible.push('shared_principal_stack');
  const defect = classifyApeRescueDefect(input.root);
  const defectFirst: ApeTactic = defect === 'structural_nonpositive_gross' ? 'route_split' : 'single_route_v4';
  const remaining = compatible.filter(tactic => tactic !== defectFirst);

  remaining.sort((left, right) => {
    const stickyLeft = state.lastWinningTactic === left && !locallyDeprioritized(state, left) ? 1 : 0;
    const stickyRight = state.lastWinningTactic === right && !locallyDeprioritized(state, right) ? 1 : 0;
    if (stickyLeft !== stickyRight) return stickyRight - stickyLeft;
    const ejectedLeft = Number(locallyDeprioritized(state, left));
    const ejectedRight = Number(locallyDeprioritized(state, right));
    if (ejectedLeft !== ejectedRight) return ejectedLeft - ejectedRight;
    const transitionDelta = transitionScore(state.lastTactic ?? defectFirst, right)
      - transitionScore(state.lastTactic ?? defectFirst, left);
    if (Math.abs(transitionDelta) > 1e-12) return transitionDelta;
    const demandDelta = getApeTacticDemandMultiplier(right) - getApeTacticDemandMultiplier(left);
    if (Math.abs(demandDelta) > 1e-12) return demandDelta;
    return tacticAverageLatencyMs(left) - tacticAverageLatencyMs(right);
  });

  const plan: ApeCounterfactualPlan = {
    candidateId: input.root.id,
    sequence: [defectFirst, ...remaining],
    planningDepth: 1 + remaining.length,
    brainCount: 5,
    preferredFirstTactic: defectFirst,
    exactEconomicsAuthority: false,
    executionAuthority: false,
  };
  state.cachedPlan = plan;
  return plan;
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
      const leftScore = a.improvementVelocityBpsPerSecond * 5
        + a.improvementBps * 3
        - a.distanceToPositiveBps * 0.03
        - leftState.noImprovementStreak * 0.35
        + (a.fresh ? 0.5 : -2);
      const rightScore = b.improvementVelocityBpsPerSecond * 5
        + b.improvementBps * 3
        - b.distanceToPositiveBps * 0.03
        - rightState.noImprovementStreak * 0.35
        + (b.fresh ? 0.5 : -2);
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (a.slackMs !== b.slackMs) return a.slackMs - b.slackMs;
      return left.id.localeCompare(right.id);
    });
}

export function getApeAdaptiveCommandSnapshot() {
  const states = [...candidateStates.values()];
  const retiredGenerations = states.filter(state => state.retired).length;
  const rankHistogram = [0, 1, 2, 3, 4].map(rank => ({
    rank,
    count: states.filter(state => state.rank === rank).length,
  }));
  const locallyDeprioritizedTactics = states.reduce((sum, state) => sum + [...state.tacticStates.entries()]
    .filter(([tactic]) => locallyDeprioritized(state, tactic)).length, 0);
  return {
    candidateStateKeys: candidateStates.size,
    retiredGenerations,
    rankHistogram,
    locallyDeprioritizedTactics,
    tacticStats: [...tacticAggregates.entries()].map(([tactic, aggregate]) => ({
      tactic,
      attempts: aggregate.attempts,
      improvements: aggregate.improvements,
      strictPositive: aggregate.outputFloorWins,
      outputFloorWins: aggregate.outputFloorWins,
      improvementPerMs: tacticImprovementPerMs(tactic),
      averageLatencyMs: tacticAverageLatencyMs(tactic),
      demandMultiplier: getApeTacticDemandMultiplier(tactic),
    })),
    learnedTransitions: transitionAggregates.size,
    meritPromotionAuthority: 'search_priority_only' as const,
    candidateAndTacticMeritSeparated: true as const,
    promotionHysteresisWithinEvidenceGeneration: true as const,
    localLatencyOutlierDeprioritization: true as const,
    stickyWinningTacticAffinity: true as const,
    cachedCounterfactualPlanning: true as const,
    generationLocalRetirement: true as const,
    resurrectionOnNewEvidenceGeneration: true as const,
    multiBrainCounterfactualPlanning: true as const,
    exactEconomicsAuthority: false as const,
    executionAuthority: false as const,
  };
}
