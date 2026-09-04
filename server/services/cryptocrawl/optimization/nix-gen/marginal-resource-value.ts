import { optimizeNixGenBids, type NixGenOptimizationOptions } from './global-optimizer.js';
import type { NixGenResourceBudget, NixGenStrategyBid } from './types.js';

const DEFAULT_MAX_RESOURCES = 16;
const HARD_MAX_RESOURCES = 64;

export interface NixGenMarginalResourceValue {
  resourceKey: string;
  baselineCapacity: number;
  addedCapacityUnits: number;
  aggregateDemandUnits: number;
  demandToCapacityRatio: number | null;
  marginalCanonicalProfitUsd: number;
  marginalCanonicalProfitUsdPerUnit: number;
  newlySelectedOpportunityIds: string[];
}

export interface NixGenMarginalResourceValueSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_marginal_resource_value';
  executionAuthority: false;
  resourceAuthority: false;
  canonicalEconomicsAuthority: false;
  filtersCanonicalCandidates: false;
  isDualShadowPrice: false;
  baselineCanonicalNetProfitUsd: number;
  analyzedResourceCount: number;
  truncatedResourceCount: number;
  values: NixGenMarginalResourceValue[];
}

export interface NixGenMarginalResourceValueOptions extends NixGenOptimizationOptions {
  addedCapacityUnits?: number;
  maxResources?: number;
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function profitOnlyBids(bids: readonly NixGenStrategyBid[]): NixGenStrategyBid[] {
  // Marginal canonical-profit value deliberately strips advisory modifiers so
  // the sensitivity result measures deterministic canonical profit only.
  return bids.map(bid => ({ ...bid, advisory: undefined }));
}

function aggregateDemandByResource(bids: readonly NixGenStrategyBid[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const bid of bids) {
    for (const item of bid.resources) {
      const key = item.resourceKey.trim();
      if (!key || !Number.isFinite(item.units) || item.units <= 0) continue;
      demand.set(key, (demand.get(key) ?? 0) + item.units);
    }
  }
  return demand;
}

/**
 * Bounded finite-difference sensitivity analysis over the existing optimizer.
 * This is an optimization-derived marginal-value diagnostic, not a LP/MIP dual
 * variable and therefore not a shadow price. It never reserves resources,
 * changes canonical economics, or grants execution authority.
 */
export function evaluateNixGenMarginalResourceValues(
  bids: readonly NixGenStrategyBid[],
  resourceBudgets: readonly NixGenResourceBudget[],
  options: NixGenMarginalResourceValueOptions = {},
): NixGenMarginalResourceValueSnapshot {
  const now = options.now ?? Date.now();
  const addedCapacityUnits = positiveFinite(options.addedCapacityUnits, 1);
  const maxResources = boundedInt(options.maxResources, DEFAULT_MAX_RESOURCES, 1, HARD_MAX_RESOURCES);
  const profitBids = profitOnlyBids(bids);
  const baseline = optimizeNixGenBids(profitBids, resourceBudgets, {
    now,
    exactBidLimit: options.exactBidLimit,
  });

  // Reuse the optimizer's normalized/conservative capacities rather than
  // independently reinterpreting duplicate budget projections.
  const effectiveBudgets = baseline.resourceUsage.map(resource => ({
    resourceKey: resource.resourceKey,
    capacity: resource.capacity,
  }));
  const demand = aggregateDemandByResource(profitBids);
  const rankedResources = [...effectiveBudgets].sort((left, right) => {
    const leftDemand = demand.get(left.resourceKey) ?? 0;
    const rightDemand = demand.get(right.resourceKey) ?? 0;
    const leftPressure = left.capacity > 0 ? leftDemand / left.capacity : (leftDemand > 0 ? Number.POSITIVE_INFINITY : 0);
    const rightPressure = right.capacity > 0 ? rightDemand / right.capacity : (rightDemand > 0 ? Number.POSITIVE_INFINITY : 0);
    return rightPressure - leftPressure || left.resourceKey.localeCompare(right.resourceKey);
  });
  const analyzed = rankedResources.slice(0, maxResources);
  const baselineSelected = new Set(baseline.selectedOpportunityIds);

  const values = analyzed.map(resource => {
    const expandedBudgets = effectiveBudgets.map(budget => budget.resourceKey === resource.resourceKey
      ? { ...budget, capacity: budget.capacity + addedCapacityUnits }
      : budget);
    const expanded = optimizeNixGenBids(profitBids, expandedBudgets, {
      now,
      exactBidLimit: options.exactBidLimit,
    });
    const gain = Math.max(0, expanded.totalCanonicalNetProfitUsd - baseline.totalCanonicalNetProfitUsd);
    const aggregateDemandUnits = demand.get(resource.resourceKey) ?? 0;
    return {
      resourceKey: resource.resourceKey,
      baselineCapacity: resource.capacity,
      addedCapacityUnits,
      aggregateDemandUnits,
      demandToCapacityRatio: resource.capacity > 0
        ? aggregateDemandUnits / resource.capacity
        : aggregateDemandUnits > 0 ? null : 0,
      marginalCanonicalProfitUsd: gain,
      marginalCanonicalProfitUsdPerUnit: gain / addedCapacityUnits,
      newlySelectedOpportunityIds: expanded.selectedOpportunityIds.filter(id => !baselineSelected.has(id)),
    } satisfies NixGenMarginalResourceValue;
  });

  return {
    generatedAt: now,
    authority: 'nix_gen_advisory_marginal_resource_value',
    executionAuthority: false,
    resourceAuthority: false,
    canonicalEconomicsAuthority: false,
    filtersCanonicalCandidates: false,
    isDualShadowPrice: false,
    baselineCanonicalNetProfitUsd: baseline.totalCanonicalNetProfitUsd,
    analyzedResourceCount: values.length,
    truncatedResourceCount: Math.max(0, rankedResources.length - values.length),
    values,
  };
}
