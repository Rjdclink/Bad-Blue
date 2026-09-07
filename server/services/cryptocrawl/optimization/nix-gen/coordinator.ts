import { optimizeNixGenBids } from './global-optimizer.js';
import type { NixGenPreparedBid } from './canonical-bid-adapters.js';
import { buildNixGenKalshiAdvisory, type NixGenKalshiAdvisorySnapshot } from './kalshi-advisory.js';
import type { NixGenOptimizationResult, NixGenResourceBudget, NixGenStrategyBid } from './types.js';

const DISPATCH_RESOURCE_KEY = 'scheduler:dispatch_batch';

export interface NixGenAllocationSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_allocation';
  executionAuthority: false;
  filtersCanonicalCandidates: false;
  preparedBidCount: number;
  priorityIndexByOpportunityId: Readonly<Record<string, number>>;
  kalshi: NixGenKalshiAdvisorySnapshot;
  result: NixGenOptimizationResult;
}

function mergeBudgets(prepared: readonly NixGenPreparedBid[], dispatchCapacity: number): NixGenResourceBudget[] {
  const capacities = new Map<string, number>();
  for (const item of prepared) {
    for (const budget of item.budgets) {
      if (!budget.resourceKey.trim() || !Number.isFinite(budget.capacity) || budget.capacity < 0) continue;
      const current = capacities.get(budget.resourceKey);
      capacities.set(budget.resourceKey, current === undefined ? budget.capacity : Math.min(current, budget.capacity));
    }
  }
  capacities.set(DISPATCH_RESOURCE_KEY, Math.max(1, Math.floor(dispatchCapacity)));
  return [...capacities.entries()].map(([resourceKey, capacity]) => ({ resourceKey, capacity }));
}

function withSharedDispatchDemand(item: NixGenPreparedBid): NixGenStrategyBid {
  return {
    ...item.bid,
    resources: [
      ...item.bid.resources,
      { resourceKey: DISPATCH_RESOURCE_KEY, units: 1 },
    ],
  };
}

export function coordinateNixGenAllocation(
  prepared: readonly NixGenPreparedBid[],
  input: { now: number; dispatchCapacity: number; exactBidLimit?: number },
): NixGenAllocationSnapshot {
  const dispatchCapacity = Number.isFinite(input.dispatchCapacity)
    ? Math.max(1, Math.floor(input.dispatchCapacity))
    : 1;
  const bids = prepared.map(withSharedDispatchDemand);
  const budgets = mergeBudgets(prepared, dispatchCapacity);
  const result = optimizeNixGenBids(bids, budgets, {
    now: input.now,
    exactBidLimit: input.exactBidLimit,
  });
  const priorityIndexByOpportunityId = Object.fromEntries(
    result.priorityOrderOpportunityIds.map((opportunityId, index) => [opportunityId, index]),
  );
  const kalshi = buildNixGenKalshiAdvisory(prepared);

  return {
    generatedAt: input.now,
    authority: 'nix_gen_advisory_allocation',
    executionAuthority: false,
    filtersCanonicalCandidates: false,
    preparedBidCount: prepared.length,
    priorityIndexByOpportunityId,
    kalshi,
    result,
  };
}

export function compareByNixGenPriority<T extends { opportunityId: string }>(
  priorityIndexByOpportunityId: Readonly<Record<string, number>>,
  fallbackComparator: (left: T, right: T) => number,
): (left: T, right: T) => number {
  return (left, right) => {
    const leftRank = priorityIndexByOpportunityId[left.opportunityId];
    const rightRank = priorityIndexByOpportunityId[right.opportunityId];
    const leftKnown = Number.isInteger(leftRank) && leftRank >= 0;
    const rightKnown = Number.isInteger(rightRank) && rightRank >= 0;
    if (leftKnown && rightKnown && leftRank !== rightRank) return leftRank - rightRank;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    return fallbackComparator(left, right);
  };
}
