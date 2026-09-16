import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';

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
let residentPricePrewarmInstalled = false;

function installResidentPricePrewarm(): void {
  if (residentPricePrewarmInstalled) return;
  residentPricePrewarmInstalled = true;
  measuredCandidateRegistry.onUpdate(candidate => {
    if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return;
    if (candidate.expiresAt <= Date.now()) return;
    if (!['observed', 'enriched', 'deterministic_positive', 'eligible'].includes(candidate.status)) return;
    const symbols = [...new Set(candidate.assets.map(symbol => symbol.trim()).filter(Boolean))];
    if (symbols.length === 0) return;
    // Acquisition only: start shared singleflight/cached price work immediately after
    // Stage One publishes measurement. No caller awaits this on the APE decision path.
    livePriceMesh.primeResidentSymbolPrices(symbols);
  });
}

installResidentPricePrewarm();

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export function apeStageOneGlobalHotLimit(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_APE_HOT_GLOBAL_LIMIT, 6, 2, 24);
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

function candidateHasExecutableMeasuredQuote(candidate: MeasuredCandidate, now: number): boolean {
  return candidate.rawQuotes.some(quote => {
    if (quote.executable === false) return false;
    if (!Number.isFinite(quote.observedAt) || quote.observedAt <= 0 || quote.observedAt > now) return false;
    return Boolean(quote.amountIn?.trim() && quote.amountOut?.trim());
  });
}

function activeGlobalMeasuredCandidates(now: number): MeasuredCandidate[] {
  return measuredCandidateRegistry.getRecent(4096).filter(candidate =>
    candidate.topology === 'ZERO_CAPITAL_ATOMIC'
    && candidate.expiresAt > now
    && ['observed', 'enriched', 'deterministic_positive', 'eligible'].includes(candidate.status)
    && candidate.depth.status !== 'unavailable'
    && candidate.canonicalBps.netBps !== null
    && Number.isFinite(candidate.canonicalBps.netBps)
    && candidateHasExecutableMeasuredQuote(candidate, now),
  );
}

function compareMeasuredRegistryPriority(left: MeasuredCandidate, right: MeasuredCandidate): number {
  const leftBps = Number(left.canonicalBps.netBps);
  const rightBps = Number(right.canonicalBps.netBps);
  const leftPositive = leftBps > 0;
  const rightPositive = rightBps > 0;
  if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
  if (leftBps !== rightBps) return rightBps - leftBps;
  if (left.expiresAt !== right.expiresAt) return right.expiresAt - left.expiresAt;
  const leftAge = left.quoteAgeMs ?? Math.max(0, Date.now() - left.updatedAt);
  const rightAge = right.quoteAgeMs ?? Math.max(0, Date.now() - right.updatedAt);
  if (leftAge !== rightAge) return leftAge - rightAge;
  return left.opportunityId.localeCompare(right.opportunityId);
}

/**
 * Cross-chain rescue admission is resident and zero-I/O. The measured candidate registry
 * is the shared scoreboard across every chain scan, so a very weak candidate on one chain
 * cannot consume a rescue lane while a materially better fresh measured candidate exists
 * on another chain. Strict-positive candidates are never blocked by this optimization gate.
 */
function globalMeasuredRescueFrontierIds(now = Date.now()): Set<string> {
  const active = activeGlobalMeasuredCandidates(now).sort(compareMeasuredRegistryPriority);
  const limit = apeStageOneGlobalHotLimit();
  const positives = active.filter(candidate => Number(candidate.canonicalBps.netBps) > 0);
  const negatives = active
    .filter(candidate => Number(candidate.canonicalBps.netBps) <= 0)
    .slice(0, limit);
  return new Set([...positives, ...negatives].map(candidate => candidate.opportunityId));
}

/**
 * Direction is the ordered execution orientation, not merely token order. A two-token
 * cycle A->B->A has the same token path in both arbitrage directions, so venue/fee
 * order must be part of the direction identity while remaining outside market identity.
 */
export function apeDirectionKey(opportunity: ZeroCapitalOpportunity): string {
  if (opportunity.route.length === 0) return tokenPath(opportunity).join('>');
  return opportunity.route.map(step => [
    step.tokenIn.toLowerCase(),
    step.tokenOut.toLowerCase(),
    step.protocol,
    Number.isFinite(step.fee) ? String(step.fee) : 'fee_unknown',
  ].join('@')).join('|');
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
 * Stage One hot-set selection is bounded twice without a BPS cutoff:
 * 1) every fresh measured candidate first competes on one cross-chain registry scoreboard;
 * 2) each surviving market contributes at most winner + strongest opposite direction + hedge.
 *
 * This adds no network call and no cross-chain wait. Candidates outside the frontier remain
 * measured discovery objects and continue through canonical provider repricing; they simply
 * do not spend expensive APE rescue work while stronger measured opportunities are resident.
 */
export function selectApeStageOneHotSet(
  opportunities: readonly ZeroCapitalOpportunity[],
  maxPerMarket = 3,
): ZeroCapitalOpportunity[] {
  const boundedMax = Math.max(1, Math.min(5, Math.trunc(maxPerMarket)));
  const globalLimit = apeStageOneGlobalHotLimit();
  const globalFrontier = globalMeasuredRescueFrontierIds();
  const globallyCompetitive = opportunities.filter(opportunity =>
    opportunity.expectedProfit > 0n || globalFrontier.has(opportunity.id),
  );

  const groups = new Map<string, ZeroCapitalOpportunity[]>();
  for (const opportunity of globallyCompetitive) {
    const key = apeDirectionalMarketKey(opportunity);
    const group = groups.get(key) ?? [];
    group.push(opportunity);
    groups.set(key, group);
  }

  const marketSelections: ZeroCapitalOpportunity[][] = [];
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
    marketSelections.push(marketSelected);
  }

  marketSelections.sort((left, right) => compareExactEconomics(left[0], right[0]));
  const selected: ZeroCapitalOpportunity[] = [];
  for (let lane = 0; lane < boundedMax && selected.length < globalLimit; lane += 1) {
    const laneCandidates = marketSelections
      .map(market => market[lane])
      .filter((candidate): candidate is ZeroCapitalOpportunity => Boolean(candidate))
      .sort(compareExactEconomics);
    for (const candidate of laneCandidates) {
      if (selected.length >= globalLimit) break;
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
