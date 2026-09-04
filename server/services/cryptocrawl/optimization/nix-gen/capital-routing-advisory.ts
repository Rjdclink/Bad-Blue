import { priceNixGenResourceOpportunities, type NixGenResourceOpportunityPrice } from './resource-opportunity-pricing.js';
import type { NixGenResourceBudget, NixGenStrategyBid } from './types.js';

export interface NixGenCapitalRoutingRecommendation {
  resourceKey: string;
  marginalCanonicalProfitUsdPerUnit: number;
  incrementalCapacityUnit: number;
  newlyUnlockedOpportunityIds: string[];
  recommendation: 'increase_if_treasury_authority_allows' | 'no_positive_marginal_value';
}

export interface NixGenCapitalRoutingSnapshot {
  generatedAt: number;
  authority: 'nix_gen_capital_routing_advisory';
  executionAuthority: false;
  treasuryAuthority: false;
  payoutAuthority: false;
  capitalMovementAuthority: false;
  recommendations: NixGenCapitalRoutingRecommendation[];
}

/**
 * Advisory-only capital/inventory routing signal. It identifies which existing
 * canonical inventory/capital resource would yield the greatest incremental
 * canonical net profit if upstream treasury/allocation authority made another
 * unit available. Nix-Gen never transfers, sweeps, withholds or sizes capital.
 */
export function buildNixGenCapitalRoutingAdvisory(
  bids: readonly NixGenStrategyBid[],
  budgets: readonly NixGenResourceBudget[],
): NixGenCapitalRoutingSnapshot {
  const pricing = priceNixGenResourceOpportunities(bids, budgets);
  const capitalValues: NixGenResourceOpportunityPrice[] = pricing.values.filter(value => value.capitalRoutingRelevant);
  return {
    generatedAt: pricing.generatedAt,
    authority: 'nix_gen_capital_routing_advisory',
    executionAuthority: false,
    treasuryAuthority: false,
    payoutAuthority: false,
    capitalMovementAuthority: false,
    recommendations: capitalValues.map(value => ({
      resourceKey: value.resourceKey,
      marginalCanonicalProfitUsdPerUnit: value.marginalCanonicalProfitUsdPerUnit,
      incrementalCapacityUnit: value.addedCapacityUnits,
      newlyUnlockedOpportunityIds: [...value.newlyUnlockedOpportunityIds],
      recommendation: value.marginalCanonicalProfitUsdPerUnit > 0
        ? 'increase_if_treasury_authority_allows'
        : 'no_positive_marginal_value',
    })),
  };
}
