import {
  evaluateNixGenMarginalResourceValues,
  type NixGenMarginalResourceValueOptions,
} from './marginal-resource-value.js';
import type { NixGenResourceBudget, NixGenStrategyBid } from './types.js';

export type NixGenResourceCategory =
  | 'inventory_or_capital'
  | 'venue_capacity'
  | 'settlement_capacity'
  | 'nonce_or_private_account'
  | 'chain_or_protocol'
  | 'database_or_compute'
  | 'other';

export interface NixGenResourceOpportunityPrice {
  resourceKey: string;
  category: NixGenResourceCategory;
  marginalCanonicalProfitUsdPerUnit: number;
  marginalCanonicalProfitUsd: number;
  addedCapacityUnits: number;
  newlyUnlockedOpportunityIds: string[];
  capitalRoutingRelevant: boolean;
}

export interface NixGenResourceOpportunityPriceSnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_resource_opportunity_price';
  executionAuthority: false;
  resourceAuthority: false;
  treasuryAuthority: false;
  capitalMovementAuthority: false;
  isDualShadowPrice: false;
  objective: 'maximize_incremental_canonical_net_profit_per_scarce_resource_unit';
  values: NixGenResourceOpportunityPrice[];
}

function categoryFor(resourceKey: string): NixGenResourceCategory {
  const key = resourceKey.toLowerCase();
  if (key.includes(':inventory:') || key.includes(':capital') || key.includes(':funding')) return 'inventory_or_capital';
  if (key.includes(':settlement')) return 'settlement_capacity';
  if (key.includes(':nonce:') || key.includes(':private:')) return 'nonce_or_private_account';
  if (key.includes(':venue:')) return 'venue_capacity';
  if (key.startsWith('chain:') || key.includes(':protocol:') || key.includes(':relay:')) return 'chain_or_protocol';
  if (key.includes('db') || key.includes('compute') || key.includes('worker')) return 'database_or_compute';
  return 'other';
}

/**
 * Converts bounded finite-difference marginal values into an explicit advisory
 * opportunity-price surface. This is the economic signal Nix-Gen may use to say
 * where one more unit of a scarce resource would unlock the most canonical net
 * profit. It is not a LP/MIP dual and cannot move funds or reserve resources.
 */
export function priceNixGenResourceOpportunities(
  bids: readonly NixGenStrategyBid[],
  budgets: readonly NixGenResourceBudget[],
  options: NixGenMarginalResourceValueOptions = {},
): NixGenResourceOpportunityPriceSnapshot {
  const marginal = evaluateNixGenMarginalResourceValues(bids, budgets, options);
  const values = marginal.values
    .map(value => {
      const category = categoryFor(value.resourceKey);
      return {
        resourceKey: value.resourceKey,
        category,
        marginalCanonicalProfitUsdPerUnit: value.marginalCanonicalProfitUsdPerUnit,
        marginalCanonicalProfitUsd: value.marginalCanonicalProfitUsd,
        addedCapacityUnits: value.addedCapacityUnits,
        newlyUnlockedOpportunityIds: [...value.newlySelectedOpportunityIds],
        capitalRoutingRelevant: category === 'inventory_or_capital',
      } satisfies NixGenResourceOpportunityPrice;
    })
    .sort((left, right) =>
      right.marginalCanonicalProfitUsdPerUnit - left.marginalCanonicalProfitUsdPerUnit
      || right.marginalCanonicalProfitUsd - left.marginalCanonicalProfitUsd
      || left.resourceKey.localeCompare(right.resourceKey),
    );

  return {
    generatedAt: marginal.generatedAt,
    authority: 'nix_gen_advisory_resource_opportunity_price',
    executionAuthority: false,
    resourceAuthority: false,
    treasuryAuthority: false,
    capitalMovementAuthority: false,
    isDualShadowPrice: false,
    objective: 'maximize_incremental_canonical_net_profit_per_scarce_resource_unit',
    values,
  };
}
