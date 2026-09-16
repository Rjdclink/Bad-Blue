import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export interface ApeDirectionalMarketView {
  marketKey: string;
  directionKeys: string[];
  opportunityIds: string[];
  directions: Array<{
    directionKey: string;
    opportunityIds: string[];
  }>;
}

function tokenPath(opportunity: ZeroCapitalOpportunity): string[] {
  if (opportunity.route.length === 0) {
    return [opportunity.inputToken.toLowerCase(), opportunity.outputToken.toLowerCase()];
  }
  return [
    opportunity.route[0].tokenIn.toLowerCase(),
    ...opportunity.route.map(step => step.tokenOut.toLowerCase()),
  ];
}

export function apeDirectionKey(opportunity: ZeroCapitalOpportunity): string {
  return tokenPath(opportunity).join('>');
}

/**
 * The same discovered market competes as one resident object regardless of direction.
 * Direction remains attached metadata/economics, not a separate market identity.
 * Normalizing a path against its reverse preserves arbitrary multi-hop cycles while
 * avoiding a venue/provider dependency in the market key.
 */
export function apeDirectionalMarketKey(opportunity: ZeroCapitalOpportunity): string {
  const path = tokenPath(opportunity);
  const forward = path.join('>');
  const reverse = [...path].reverse().join('>');
  const canonicalPath = forward <= reverse ? forward : reverse;
  return `${opportunity.chain}|${canonicalPath}`;
}

export function buildApeDirectionalMarketViews(
  opportunities: readonly ZeroCapitalOpportunity[],
): ApeDirectionalMarketView[] {
  const markets = new Map<string, Map<string, string[]>>();
  for (const opportunity of opportunities) {
    const marketKey = apeDirectionalMarketKey(opportunity);
    const directionKey = apeDirectionKey(opportunity);
    const directions = markets.get(marketKey) ?? new Map<string, string[]>();
    const ids = directions.get(directionKey) ?? [];
    ids.push(opportunity.id);
    directions.set(directionKey, ids);
    markets.set(marketKey, directions);
  }

  return [...markets.entries()].map(([marketKey, directions]) => ({
    marketKey,
    directionKeys: [...directions.keys()],
    opportunityIds: [...directions.values()].flat(),
    directions: [...directions.entries()].map(([directionKey, opportunityIds]) => ({
      directionKey,
      opportunityIds: [...opportunityIds],
    })),
  }));
}
