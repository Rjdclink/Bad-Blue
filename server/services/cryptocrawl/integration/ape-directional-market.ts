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

const BPS_PRECISION_SCALE = 1_000_000n;

function tokenPath(opportunity: ZeroCapitalOpportunity): string[] {
  if (opportunity.route.length === 0) {
    return [opportunity.inputToken.toLowerCase(), opportunity.outputToken.toLowerCase()];
  }
  return [
    opportunity.route[0].tokenIn.toLowerCase(),
    ...opportunity.route.map(step => step.tokenOut.toLowerCase()),
  ];
}

function exactNetBps(opportunity: ZeroCapitalOpportunity): number {
  if (opportunity.flashLoanAmount <= 0n) return Number.NEGATIVE_INFINITY;
  return Number(
    (opportunity.expectedProfit * 10_000n * BPS_PRECISION_SCALE) / opportunity.flashLoanAmount,
  ) / Number(BPS_PRECISION_SCALE);
}

function compareExactEconomics(left: ZeroCapitalOpportunity, right: ZeroCapitalOpportunity): number {
  const leftPositive = left.expectedProfit > 0n;
  const rightPositive = right.expectedProfit > 0n;
  if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
  if (left.flashLoanAmount > 0n && right.flashLoanAmount > 0n) {
    const leftRatio = left.expectedProfit * right.flashLoanAmount;
    const rightRatio = right.expectedProfit * left.flashLoanAmount;
    if (leftRatio !== rightRatio) return leftRatio > rightRatio ? -1 : 1;
  }
  const leftBps = exactNetBps(left);
  const rightBps = exactNetBps(right);
  if (leftBps !== rightBps) return rightBps - leftBps;
  if (left.expiresAt !== right.expiresAt) return right.expiresAt - left.expiresAt;
  if (left.quoteLatencyMs !== right.quoteLatencyMs) return left.quoteLatencyMs - right.quoteLatencyMs;
  return left.id.localeCompare(right.id);
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

/**
 * Stage One hot-set selection is bounded by market structure, never by an arbitrary
 * BPS cutoff. The best measured direction enters first, the strongest independently
 * measured opposite direction is protected second when present, and the best remaining
 * variant becomes the hedge. Every other measured route stays in discovery/provider
 * repricing and can become hot on the next state update.
 */
export function selectApeStageOneHotSet(
  opportunities: readonly ZeroCapitalOpportunity[],
  maxPerMarket = 3,
): ZeroCapitalOpportunity[] {
  const boundedMax = Math.max(1, Math.min(5, Math.trunc(maxPerMarket)));
  const groups = new Map<string, ZeroCapitalOpportunity[]>();
  for (const opportunity of opportunities) {
    const key = apeDirectionalMarketKey(opportunity);
    const group = groups.get(key) ?? [];
    group.push(opportunity);
    groups.set(key, group);
  }

  const selected: ZeroCapitalOpportunity[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareExactEconomics);
    if (ordered.length === 0) continue;
    const winner = ordered[0];
    selected.push(winner);
    if (boundedMax === 1) continue;

    const winnerDirection = apeDirectionKey(winner);
    const reverse = ordered.find(candidate => apeDirectionKey(candidate) !== winnerDirection);
    if (reverse) selected.push(reverse);
    if (selected.length >= boundedMax * groups.size) continue;

    for (const candidate of ordered) {
      if (selected.length >= boundedMax * groups.size) break;
      if (candidate === winner || candidate === reverse) continue;
      const selectedForMarket = selected.filter(item => apeDirectionalMarketKey(item) === apeDirectionalMarketKey(winner)).length;
      if (selectedForMarket >= boundedMax) break;
      selected.push(candidate);
    }
  }
  return selected.sort(compareExactEconomics);
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
