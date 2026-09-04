import type {
  NixGenBidRejectionReason,
  NixGenOptimizationResult,
  NixGenRejectedBid,
  NixGenResourceBudget,
  NixGenResourceDemand,
  NixGenResourceUsage,
  NixGenStrategyBid,
} from './types.js';

const EPSILON = 1e-9;
const DEFAULT_EXACT_BID_LIMIT = 16;
const MAX_EXACT_BID_LIMIT = 18;

interface ValidatedBid {
  bid: NixGenStrategyBid;
  utility: number;
  resourceDemand: Map<string, number>;
  exclusionGroup: string;
}

interface SelectionState {
  selected: ValidatedBid[];
  utility: number;
  netProfitUsd: number;
  usage: Map<string, number>;
  exclusionGroups: Set<string>;
}

export interface NixGenOptimizationOptions {
  now?: number;
  exactBidLimit?: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function rankingUtility(bid: NixGenStrategyBid): number {
  const probability = bounded(bid.advisory?.probabilityOfProfitableExecution, 1, 0, 1);
  const terminalCalibration = bounded(bid.advisory?.terminalCalibrationFactor, 1, 0.05, 1);
  const decayUrgency = bounded(bid.advisory?.decayUrgencyFactor, 1, 1, 2);
  const rankSignal = bounded(bid.advisory?.rankScore, 0, -75, 75);
  const rankAdjustment = 1 + rankSignal / 100;
  return bid.economics.netProfitUsd * probability * terminalCalibration * decayUrgency * rankAdjustment;
}

function normalizeBudgets(input: readonly NixGenResourceBudget[]): Map<string, number> {
  const budgets = new Map<string, number>();
  for (const budget of input) {
    const key = budget.resourceKey.trim();
    if (!key || !Number.isFinite(budget.capacity) || budget.capacity < 0) continue;
    const existing = budgets.get(key);
    // Duplicate projections for the same canonical resource describe the same
    // capacity, not additive capacity. Keep the most conservative projection.
    budgets.set(key, existing === undefined ? budget.capacity : Math.min(existing, budget.capacity));
  }
  return budgets;
}

function normalizeDemand(input: readonly NixGenResourceDemand[]): Map<string, number> | null {
  const demand = new Map<string, number>();
  for (const item of input) {
    const key = item.resourceKey.trim();
    if (!key || !finitePositive(item.units)) return null;
    demand.set(key, (demand.get(key) ?? 0) + item.units);
  }
  return demand;
}

function hardValidationReason(
  bid: NixGenStrategyBid,
  now: number,
  budgets: ReadonlyMap<string, number>,
): NixGenBidRejectionReason | null {
  if (!bid.bidId.trim() || !bid.opportunityId.trim() || !bid.strategyId.trim()) return 'invalid_economics_evidence';
  if (!Number.isFinite(bid.observedAt) || bid.observedAt <= 0 || bid.observedAt > now) return 'future_observation';
  if (!Number.isFinite(bid.expiresAt) || bid.expiresAt <= now) return 'expired';
  if (
    !Number.isFinite(bid.economics.measuredAt)
    || bid.economics.measuredAt <= 0
    || bid.economics.measuredAt > now
    || !bid.economics.authority.trim()
  ) return 'invalid_economics_evidence';
  if (!finitePositive(bid.economics.netProfitUsd)) return 'non_positive_canonical_economics';
  if (!finitePositive(bid.economics.notionalUsd)) return 'invalid_notional';
  if (bid.economics.netBps !== null && !Number.isFinite(bid.economics.netBps)) return 'invalid_bps';
  if (!bid.execution.eligible) return 'not_canonically_eligible';
  if (!bid.execution.executable || !bid.execution.authoritativePath.trim()) return 'execution_not_authoritative';
  if (!bid.execution.settlementCapable) return 'settlement_not_capable';

  const demand = normalizeDemand(bid.resources);
  if (!demand) return 'invalid_resource_demand';
  for (const [key, units] of demand) {
    const capacity = budgets.get(key);
    if (capacity === undefined || units > capacity + EPSILON) return 'resource_unavailable';
  }
  return null;
}

function validateBids(
  bids: readonly NixGenStrategyBid[],
  budgets: ReadonlyMap<string, number>,
  now: number,
): { valid: ValidatedBid[]; rejected: NixGenRejectedBid[] } {
  const valid: ValidatedBid[] = [];
  const rejected: NixGenRejectedBid[] = [];
  const seenBidIds = new Set<string>();

  for (const bid of bids) {
    const normalizedBidId = bid.bidId.trim();
    if (normalizedBidId && seenBidIds.has(normalizedBidId)) {
      rejected.push({ bidId: bid.bidId, opportunityId: bid.opportunityId, reason: 'duplicate_bid_id' });
      continue;
    }
    if (normalizedBidId) seenBidIds.add(normalizedBidId);

    const reason = hardValidationReason(bid, now, budgets);
    if (reason) {
      rejected.push({ bidId: bid.bidId, opportunityId: bid.opportunityId, reason });
      continue;
    }

    valid.push({
      bid,
      utility: rankingUtility(bid),
      resourceDemand: normalizeDemand(bid.resources) ?? new Map(),
      exclusionGroup: bid.mutualExclusionGroup?.trim() || `opportunity:${bid.opportunityId}`,
    });
  }

  return { valid, rejected };
}

function canAdd(
  candidate: ValidatedBid,
  usage: ReadonlyMap<string, number>,
  exclusionGroups: ReadonlySet<string>,
  budgets: ReadonlyMap<string, number>,
): boolean {
  if (exclusionGroups.has(candidate.exclusionGroup)) return false;
  for (const [key, units] of candidate.resourceDemand) {
    if ((usage.get(key) ?? 0) + units > (budgets.get(key) ?? -Infinity) + EPSILON) return false;
  }
  return true;
}

function addCandidate(state: SelectionState, candidate: ValidatedBid): SelectionState {
  const usage = new Map(state.usage);
  for (const [key, units] of candidate.resourceDemand) usage.set(key, (usage.get(key) ?? 0) + units);
  const exclusionGroups = new Set(state.exclusionGroups);
  exclusionGroups.add(candidate.exclusionGroup);
  return {
    selected: [...state.selected, candidate],
    utility: state.utility + candidate.utility,
    netProfitUsd: state.netProfitUsd + candidate.bid.economics.netProfitUsd,
    usage,
    exclusionGroups,
  };
}

function isBetter(left: SelectionState, right: SelectionState): boolean {
  if (left.utility > right.utility + EPSILON) return true;
  if (right.utility > left.utility + EPSILON) return false;
  if (left.netProfitUsd > right.netProfitUsd + EPSILON) return true;
  if (right.netProfitUsd > left.netProfitUsd + EPSILON) return false;
  const leftIds = left.selected.map(item => item.bid.bidId).sort().join('|');
  const rightIds = right.selected.map(item => item.bid.bidId).sort().join('|');
  return leftIds < rightIds;
}

function rawPriorityComparator(left: ValidatedBid, right: ValidatedBid): number {
  return right.utility - left.utility
    || right.bid.economics.netProfitUsd - left.bid.economics.netProfitUsd
    || left.bid.bidId.localeCompare(right.bid.bidId);
}

function exactSelect(valid: readonly ValidatedBid[], budgets: ReadonlyMap<string, number>): SelectionState {
  const ordered = [...valid].sort(rawPriorityComparator);
  const suffixUtility = new Array<number>(ordered.length + 1).fill(0);
  for (let index = ordered.length - 1; index >= 0; index--) {
    suffixUtility[index] = suffixUtility[index + 1] + Math.max(0, ordered[index].utility);
  }

  let best: SelectionState = { selected: [], utility: 0, netProfitUsd: 0, usage: new Map(), exclusionGroups: new Set() };

  const visit = (index: number, state: SelectionState): void => {
    if (state.utility + suffixUtility[index] < best.utility - EPSILON) return;
    if (index >= ordered.length) {
      if (isBetter(state, best)) best = state;
      return;
    }

    const candidate = ordered[index];
    if (canAdd(candidate, state.usage, state.exclusionGroups, budgets)) visit(index + 1, addCandidate(state, candidate));
    visit(index + 1, state);
  };

  visit(0, { selected: [], utility: 0, netProfitUsd: 0, usage: new Map(), exclusionGroups: new Set() });
  return best;
}

function scarcityPenalty(candidate: ValidatedBid, budgets: ReadonlyMap<string, number>): number {
  let penalty = 0;
  for (const [key, units] of candidate.resourceDemand) {
    const capacity = Math.max(EPSILON, budgets.get(key) ?? 0);
    penalty += units / capacity;
  }
  return penalty;
}

function resourceAwareComparator(budgets: ReadonlyMap<string, number>) {
  return (left: ValidatedBid, right: ValidatedBid): number => {
    const leftDensity = left.utility / (1 + scarcityPenalty(left, budgets));
    const rightDensity = right.utility / (1 + scarcityPenalty(right, budgets));
    return rightDensity - leftDensity || rawPriorityComparator(left, right);
  };
}

function greedySelect(valid: readonly ValidatedBid[], budgets: ReadonlyMap<string, number>): SelectionState {
  const ordered = [...valid].sort(resourceAwareComparator(budgets));
  let state: SelectionState = { selected: [], utility: 0, netProfitUsd: 0, usage: new Map(), exclusionGroups: new Set() };
  for (const candidate of ordered) {
    if (canAdd(candidate, state.usage, state.exclusionGroups, budgets)) state = addCandidate(state, candidate);
  }
  return state;
}

function resourceUsage(state: SelectionState, budgets: ReadonlyMap<string, number>): NixGenResourceUsage[] {
  return [...budgets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceKey, capacity]) => {
      const used = state.usage.get(resourceKey) ?? 0;
      return {
        resourceKey,
        used,
        capacity,
        utilization: capacity > 0 ? Math.max(0, Math.min(1, used / capacity)) : 0,
      };
    });
}

function uniqueOpportunityOrder(bids: readonly ValidatedBid[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of bids) {
    if (seen.has(candidate.bid.opportunityId)) continue;
    seen.add(candidate.bid.opportunityId);
    ordered.push(candidate.bid.opportunityId);
  }
  return ordered;
}

export function optimizeNixGenBids(
  bids: readonly NixGenStrategyBid[],
  resourceBudgets: readonly NixGenResourceBudget[],
  options: NixGenOptimizationOptions = {},
): NixGenOptimizationResult {
  const now = options.now ?? Date.now();
  const exactBidLimit = Math.max(1, Math.min(MAX_EXACT_BID_LIMIT, Math.trunc(options.exactBidLimit ?? DEFAULT_EXACT_BID_LIMIT)));
  const budgets = normalizeBudgets(resourceBudgets);
  const { valid, rejected } = validateBids(bids, budgets, now);
  const exact = valid.length <= exactBidLimit;
  const selectedState = exact ? exactSelect(valid, budgets) : greedySelect(valid, budgets);
  const selectedIds = new Set(selectedState.selected.map(item => item.bid.bidId));
  const selectedGroups = new Set(selectedState.selected.map(item => item.exclusionGroup));

  for (const candidate of valid) {
    if (selectedIds.has(candidate.bid.bidId)) continue;
    rejected.push({
      bidId: candidate.bid.bidId,
      opportunityId: candidate.bid.opportunityId,
      reason: selectedGroups.has(candidate.exclusionGroup) ? 'mutual_exclusion' : 'not_selected_by_optimizer',
    });
  }

  const selectedOrdered = [...selectedState.selected].sort(resourceAwareComparator(budgets));
  const remainderOrdered = valid
    .filter(candidate => !selectedIds.has(candidate.bid.bidId))
    .sort(resourceAwareComparator(budgets));
  const priorityOrder = [...selectedOrdered, ...remainderOrdered];

  return {
    generatedAt: now,
    decisionAuthority: 'advisory_only',
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    selectedBidIds: selectedOrdered.map(item => item.bid.bidId),
    selectedOpportunityIds: uniqueOpportunityOrder(selectedOrdered),
    priorityOrderBidIds: priorityOrder.map(item => item.bid.bidId),
    priorityOrderOpportunityIds: uniqueOpportunityOrder(priorityOrder),
    rejected,
    totalCanonicalNetProfitUsd: selectedState.netProfitUsd,
    totalRankingUtility: selectedState.utility,
    resourceUsage: resourceUsage(selectedState, budgets),
    method: exact ? 'exact_branch_and_bound' : 'deterministic_greedy',
    exact,
  };
}
