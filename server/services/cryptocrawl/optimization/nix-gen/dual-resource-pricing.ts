import { optimizeNixGenBids, type NixGenOptimizationOptions } from './global-optimizer.js';
import type { NixGenResourceBudget, NixGenStrategyBid } from './types.js';

const EPSILON = 1e-9;

export interface NixGenDualPriceOptions extends NixGenOptimizationOptions {
  iterations?: number;
  tolerance?: number;
  initialStepUsd?: number;
  maxResources?: number;
}

export interface NixGenDualResourcePrice {
  resourceKey: string;
  capacity: number;
  approximatePriceUsdPerUnit: number;
  relaxedUsage: number;
  excessDemandUnits: number;
  normalizedResidual: number;
}

export interface NixGenDualPriceSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_dual_resource_price';
  executionAuthority: false;
  resourceAuthority: false;
  treasuryAuthority: false;
  canonicalEconomicsAuthority: false;
  filtersCanonicalCandidates: false;
  isDualDerived: true;
  exactDualOptimalityClaim: false;
  method: 'projected_subgradient_lagrangian_relaxation';
  validBidCount: number;
  analyzedResourceCount: number;
  truncatedResourceCount: number;
  iterations: number;
  converged: boolean;
  maximumNormalizedResidual: number;
  feasibleCanonicalProfitUsd: number;
  bestDualUpperBoundUsd: number;
  dualityGapUpperBoundUsd: number;
  values: NixGenDualResourcePrice[];
}

type RelaxedChoice = {
  bid: NixGenStrategyBid;
  surplusUsd: number;
};

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function profitOnlyBids(bids: readonly NixGenStrategyBid[]): NixGenStrategyBid[] {
  return bids.map(bid => ({ ...bid, advisory: undefined }));
}

function demandFor(bid: NixGenStrategyBid): Map<string, number> {
  const out = new Map<string, number>();
  for (const demand of bid.resources) {
    const key = demand.resourceKey.trim();
    if (!key || !Number.isFinite(demand.units) || demand.units <= 0) continue;
    out.set(key, (out.get(key) ?? 0) + demand.units);
  }
  return out;
}

function exclusionGroup(bid: NixGenStrategyBid): string {
  return bid.mutualExclusionGroup?.trim() || `opportunity:${bid.opportunityId}`;
}

function medianPositive(values: readonly number[]): number {
  const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function relaxedSelection(
  bids: readonly NixGenStrategyBid[],
  prices: ReadonlyMap<string, number>,
): RelaxedChoice[] {
  const bestByGroup = new Map<string, RelaxedChoice>();
  for (const bid of bids) {
    let resourceCharge = 0;
    for (const [resourceKey, units] of demandFor(bid)) {
      resourceCharge += (prices.get(resourceKey) ?? 0) * units;
    }
    const choice = { bid, surplusUsd: bid.economics.netProfitUsd - resourceCharge };
    const group = exclusionGroup(bid);
    const current = bestByGroup.get(group);
    if (
      !current
      || choice.surplusUsd > current.surplusUsd + EPSILON
      || (Math.abs(choice.surplusUsd - current.surplusUsd) <= EPSILON
        && (choice.bid.economics.netProfitUsd > current.bid.economics.netProfitUsd + EPSILON
          || (Math.abs(choice.bid.economics.netProfitUsd - current.bid.economics.netProfitUsd) <= EPSILON
            && choice.bid.bidId.localeCompare(current.bid.bidId) < 0)))
    ) {
      bestByGroup.set(group, choice);
    }
  }
  return [...bestByGroup.values()].filter(choice => choice.surplusUsd > 0);
}

function usageFor(selection: readonly RelaxedChoice[], resources: ReadonlySet<string>): Map<string, number> {
  const usage = new Map<string, number>();
  for (const choice of selection) {
    for (const [resourceKey, units] of demandFor(choice.bid)) {
      if (!resources.has(resourceKey)) continue;
      usage.set(resourceKey, (usage.get(resourceKey) ?? 0) + units);
    }
  }
  return usage;
}

function dualUpperBound(
  selection: readonly RelaxedChoice[],
  prices: ReadonlyMap<string, number>,
  capacities: ReadonlyMap<string, number>,
): number {
  let upper = 0;
  for (const [resourceKey, capacity] of capacities) upper += (prices.get(resourceKey) ?? 0) * capacity;
  for (const choice of selection) upper += Math.max(0, choice.surplusUsd);
  return upper;
}

/**
 * Approximate Lagrangian resource-price discovery for Nix-Gen's discrete global
 * allocation. Resource constraints are dualized while mutual-exclusion groups
 * remain explicit in the relaxed subproblem. Projected subgradient updates produce
 * optimization-derived USD/unit prices. Because the production allocation is
 * integer/discrete, this module never claims exact strong-duality or exact optimal
 * multipliers; the feasible classical optimizer remains the production baseline.
 */
export function discoverNixGenDualResourcePrices(
  bids: readonly NixGenStrategyBid[],
  resourceBudgets: readonly NixGenResourceBudget[],
  options: NixGenDualPriceOptions = {},
): NixGenDualPriceSnapshot {
  const now = options.now ?? Date.now();
  const iterations = boundedInt(options.iterations, 96, 8, 512);
  const tolerance = boundedNumber(options.tolerance, 0.02, 0.0001, 0.5);
  const maxResources = boundedInt(options.maxResources, 64, 1, 128);
  const profitBids = profitOnlyBids(bids);

  // Reuse the production optimizer's validation and conservative budget merge.
  const feasible = optimizeNixGenBids(profitBids, resourceBudgets, {
    now,
    exactBidLimit: options.exactBidLimit,
  });
  const validIds = new Set(feasible.priorityOrderBidIds);
  const valid = profitBids.filter(bid => validIds.has(bid.bidId));
  const allCapacities = new Map(feasible.resourceUsage.map(row => [row.resourceKey, row.capacity]));
  const rankedResources = [...allCapacities.entries()]
    .map(([resourceKey, capacity]) => {
      const aggregateDemand = valid.reduce((sum, bid) => sum + (demandFor(bid).get(resourceKey) ?? 0), 0);
      const pressure = capacity > 0 ? aggregateDemand / capacity : aggregateDemand > 0 ? Number.POSITIVE_INFINITY : 0;
      return { resourceKey, capacity, pressure };
    })
    .sort((left, right) => right.pressure - left.pressure || left.resourceKey.localeCompare(right.resourceKey));
  const analyzedRows = rankedResources.slice(0, maxResources);
  const capacities = new Map(analyzedRows.map(row => [row.resourceKey, row.capacity]));
  const resourceSet = new Set(capacities.keys());
  const prices = new Map<string, number>([...resourceSet].map(key => [key, 0]));

  const medianProfit = medianPositive(valid.map(bid => bid.economics.netProfitUsd));
  const initialStepUsd = boundedNumber(options.initialStepUsd, Math.max(0.01, medianProfit * 0.25), 0.000001, 1_000_000);

  let bestPrices = new Map(prices);
  let bestUsage = new Map<string, number>();
  let bestResidual = Number.POSITIVE_INFINITY;
  let bestDual = Number.POSITIVE_INFINITY;
  let iterationsUsed = 0;
  let converged = valid.length === 0 || resourceSet.size === 0;

  for (let index = 0; index < iterations && !converged; index++) {
    iterationsUsed = index + 1;
    const selection = relaxedSelection(valid, prices);
    const usage = usageFor(selection, resourceSet);
    let maximumResidual = 0;
    for (const [resourceKey, capacity] of capacities) {
      const used = usage.get(resourceKey) ?? 0;
      const denominator = Math.max(1, Math.abs(capacity));
      maximumResidual = Math.max(maximumResidual, Math.abs(used - capacity) / denominator);
    }
    const dual = dualUpperBound(selection, prices, capacities);
    if (
      maximumResidual < bestResidual - EPSILON
      || (Math.abs(maximumResidual - bestResidual) <= EPSILON && dual < bestDual)
    ) {
      bestResidual = maximumResidual;
      bestDual = dual;
      bestPrices = new Map(prices);
      bestUsage = new Map(usage);
    }
    if (maximumResidual <= tolerance) {
      converged = true;
      break;
    }

    const step = initialStepUsd / Math.sqrt(index + 1);
    for (const [resourceKey, capacity] of capacities) {
      const used = usage.get(resourceKey) ?? 0;
      const normalizedExcess = (used - capacity) / Math.max(1, Math.abs(capacity));
      prices.set(resourceKey, Math.max(0, (prices.get(resourceKey) ?? 0) + step * normalizedExcess));
    }
  }

  if (!Number.isFinite(bestResidual)) bestResidual = 0;
  if (!Number.isFinite(bestDual)) bestDual = feasible.totalCanonicalNetProfitUsd;
  const values = [...capacities.entries()]
    .map(([resourceKey, capacity]) => {
      const relaxedUsage = bestUsage.get(resourceKey) ?? 0;
      const excessDemandUnits = relaxedUsage - capacity;
      return {
        resourceKey,
        capacity,
        approximatePriceUsdPerUnit: Number((bestPrices.get(resourceKey) ?? 0).toFixed(10)),
        relaxedUsage,
        excessDemandUnits,
        normalizedResidual: Math.abs(excessDemandUnits) / Math.max(1, Math.abs(capacity)),
      } satisfies NixGenDualResourcePrice;
    })
    .sort((left, right) =>
      right.approximatePriceUsdPerUnit - left.approximatePriceUsdPerUnit
      || left.resourceKey.localeCompare(right.resourceKey),
    );

  return {
    generatedAt: now,
    authority: 'nix_gen_advisory_dual_resource_price',
    executionAuthority: false,
    resourceAuthority: false,
    treasuryAuthority: false,
    canonicalEconomicsAuthority: false,
    filtersCanonicalCandidates: false,
    isDualDerived: true,
    exactDualOptimalityClaim: false,
    method: 'projected_subgradient_lagrangian_relaxation',
    validBidCount: valid.length,
    analyzedResourceCount: values.length,
    truncatedResourceCount: Math.max(0, rankedResources.length - values.length),
    iterations: iterationsUsed,
    converged,
    maximumNormalizedResidual: Number(bestResidual.toFixed(10)),
    feasibleCanonicalProfitUsd: feasible.totalCanonicalNetProfitUsd,
    bestDualUpperBoundUsd: Number(bestDual.toFixed(8)),
    dualityGapUpperBoundUsd: Number(Math.max(0, bestDual - feasible.totalCanonicalNetProfitUsd).toFixed(8)),
    values,
  };
}
