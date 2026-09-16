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

function canonicalCyclicTokenPath(path: readonly string[]): string {
  if (path.length <= 1) return path.join('>');
  const cyclic = path[0] === path[path.length - 1];
  if (!cyclic) {
    const forward = path.join('>');
    const reverse = [...path].reverse().join('>');
    return forward <= reverse ? forward : reverse;
  }

  const core = path.slice(0, -1);
  if (core.length === 0) return path.join('>');
  const variants: string[] = [];
  for (const orientation of [core, [...core].reverse()] as const) {
    for (let offset = 0; offset < orientation.length; offset += 1) {
      const rotated = [...orientation.slice(offset), ...orientation.slice(0, offset)];
      variants.push(rotated.join('>'));
    }
  }
  variants.sort();
  return variants[0] ?? core.join('>');
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
 * Cyclic routes are canonicalized across both rotation and reversal, so borrowing A
 * for A->B->A and borrowing B for B->A->B are correctly treated as the same market.
 * Venue/provider/builder remain realization dimensions, not opportunity identity.
 */
export function apeDirectionalMarketKey(opportunity: ZeroCapitalOpportunity): string {
  return `${opportunity.chain}|${canonicalCyclicTokenPath(tokenPath(opportunity))}`;
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

    const marketSelected: ZeroCapitalOpportunity[] = [];
    const winner = ordered[0];
    marketSelected.push(winner);
    if (boundedMax > 1) {
      const winnerDirection = apeDirectionKey(winner);
      const reverse = ordered.find(candidate => apeDirectionKey(candidate) !== winnerDirection);
      if (reverse) marketSelected.push(reverse);
      for (const candidate of ordered) {
        if (marketSelected.length >= boundedMax) break;
        if (marketSelected.includes(candidate)) continue;
        marketSelected.push(candidate);
      }
    }
    selected.push(...marketSelected);
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
