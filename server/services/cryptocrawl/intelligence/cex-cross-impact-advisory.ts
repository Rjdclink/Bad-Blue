import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { canonicalOpportunityState } from './canonical-opportunity-state.js';
import type { CexStreamVenue } from './cex-order-book-stream.js';
import {
  orderBookEvolutionStore,
  type OrderBookEvolutionSnapshot,
} from '../validation/order-book-evolution-store.js';

export interface CexCrossImpactPriorityAdvisory {
  priorityFactor: number;
  competingPlans: number;
  measuredPairs: number;
  maxPositiveCorrelation: number | null;
  aggregateMeasuredPressure: number;
  authority: 'measured_cross_impact_scheduling_advisory_only';
  economicAuthority: false;
  executionAuthority: false;
  eligibilityAuthority: false;
  provenance: string[];
}

type Side = 'buy' | 'sell';

type ReturnPoint = {
  observedAt: number;
  returnBps: number;
};

function maxQuoteAgeMs(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(30_000, Math.trunc(parsed))) : 5_000;
}

function alignmentToleranceMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CROSS_IMPACT_ALIGNMENT_MS || 1_500);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(5_000, Math.trunc(parsed))) : 1_500;
}

function splitSpotSymbol(symbol: string): { base: string; quote: string } | null {
  const normalized = symbol.trim().toUpperCase();
  const match = normalized.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function asCexVenue(value: string): CexStreamVenue | null {
  const venue = value.trim().toLowerCase();
  return venue === 'coinbase' || venue === 'kraken' || venue === 'okx' ? venue : null;
}

function venueSide(plan: VerifiedArbitragePlan, venue: CexStreamVenue): Side | null {
  if (plan.buyVenue === venue) return 'buy';
  if (plan.sellVenue === venue) return 'sell';
  return null;
}

function mid(snapshot: OrderBookEvolutionSnapshot): number {
  return (snapshot.bid + snapshot.ask) / 2;
}

function returns(snapshots: readonly OrderBookEvolutionSnapshot[]): ReturnPoint[] {
  const output: ReturnPoint[] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const next = snapshots[index];
    const previousMid = mid(previous);
    const nextMid = mid(next);
    if (!(previousMid > 0) || !(nextMid > 0) || next.observedAt <= previous.observedAt) continue;
    output.push({
      observedAt: next.observedAt,
      returnBps: ((nextMid - previousMid) / previousMid) * 10_000,
    });
  }
  return output;
}

function alignReturns(left: readonly ReturnPoint[], right: readonly ReturnPoint[]): Array<[number, number]> {
  const tolerance = alignmentToleranceMs();
  const pairs: Array<[number, number]> = [];
  let rightIndex = 0;
  for (const point of left) {
    while (
      rightIndex + 1 < right.length &&
      Math.abs(right[rightIndex + 1].observedAt - point.observedAt) <= Math.abs(right[rightIndex].observedAt - point.observedAt)
    ) rightIndex += 1;
    const match = right[rightIndex];
    if (!match || Math.abs(match.observedAt - point.observedAt) > tolerance) continue;
    pairs.push([point.returnBps, match.returnBps]);
  }
  return pairs;
}

function correlation(pairs: readonly [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [left, right] of pairs) {
    const leftDelta = left - leftMean;
    const rightDelta = right - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (!(denominator > 0)) return null;
  return Math.max(-1, Math.min(1, covariance / denominator));
}

function sideDepthUsd(snapshot: OrderBookEvolutionSnapshot, side: Side): number {
  return side === 'buy' ? snapshot.askDepthUsd : snapshot.bidDepthUsd;
}

function sharedAsset(left: VerifiedArbitragePlan, right: VerifiedArbitragePlan): boolean {
  const leftPair = splitSpotSymbol(left.symbol);
  const rightPair = splitSpotSymbol(right.symbol);
  if (!leftPair || !rightPair) return false;
  return leftPair.base === rightPair.base || leftPair.quote === rightPair.quote;
}

function emptyAdvisory(): CexCrossImpactPriorityAdvisory {
  return {
    priorityFactor: 1,
    competingPlans: 0,
    measuredPairs: 0,
    maxPositiveCorrelation: null,
    aggregateMeasuredPressure: 0,
    authority: 'measured_cross_impact_scheduling_advisory_only',
    economicAuthority: false,
    executionAuthority: false,
    eligibilityAuthority: false,
    provenance: [],
  };
}

/**
 * Measure whether other currently-positive plans are likely to consume the same
 * venue-side liquidity while their distinct assets are moving together. The
 * result can only reduce scheduling priority among already eligible plans. It
 * never edits canonical BPS, notional, recommendation, eligibility, or execution.
 */
export function evaluateCexCrossImpactPriority(
  opportunityId: string,
  plan: VerifiedArbitragePlan,
): CexCrossImpactPriorityAdvisory {
  const now = Date.now();
  const ageLimit = maxQuoteAgeMs();
  const active = canonicalOpportunityState.getRecent(256)
    .filter(snapshot => snapshot.opportunityId !== opportunityId)
    .filter(snapshot => snapshot.status === 'eligible' && snapshot.plan)
    .filter(snapshot => now - snapshot.observedAt <= ageLimit)
    .map(snapshot => snapshot.plan!)
    .filter(other => other.symbol !== plan.symbol)
    .filter(other => Number.isFinite(other.netProfitUsd) && other.netProfitUsd > 0)
    .filter(other => sharedAsset(plan, other));

  if (active.length === 0) return emptyAdvisory();

  let aggregatePressure = 0;
  let measuredPairs = 0;
  let maxPositiveCorrelation: number | null = null;
  let competingPlans = 0;
  const provenance = new Set<string>();

  for (const other of active) {
    const venues = [asCexVenue(String(plan.buyVenue)), asCexVenue(String(plan.sellVenue))]
      .filter((venue): venue is CexStreamVenue => venue !== null);
    let competitorMeasured = false;

    for (const venue of venues) {
      const currentSide = venueSide(plan, venue);
      const otherSide = venueSide(other, venue);
      // Opposite-side traffic is not assumed adverse. Only measured same-side
      // competition is treated as self-generated liquidity pressure.
      if (!currentSide || currentSide !== otherSide) continue;

      const currentSnapshots = orderBookEvolutionStore.getRecentSnapshots(venue, plan.symbol, 64, 120_000);
      const otherSnapshots = orderBookEvolutionStore.getRecentSnapshots(venue, other.symbol, 64, 120_000);
      const aligned = alignReturns(returns(currentSnapshots), returns(otherSnapshots));
      const measuredCorrelation = correlation(aligned);
      if (measuredCorrelation === null) continue;

      measuredPairs += aligned.length;
      const positiveCorrelation = Math.max(0, measuredCorrelation);
      maxPositiveCorrelation = Math.max(maxPositiveCorrelation ?? 0, positiveCorrelation);
      const currentLatest = currentSnapshots[currentSnapshots.length - 1];
      const measuredDepthUsd = currentLatest ? sideDepthUsd(currentLatest, currentSide) : 0;
      if (!(measuredDepthUsd > 0)) continue;

      // The load ratio is directly measured requested notional divided by live
      // same-side displayed depth. Correlation scales only the scheduling burden;
      // it is not converted into synthetic BPS or predicted P/L.
      const loadRatio = Math.max(0, Math.min(1, other.notionalUsd / measuredDepthUsd));
      aggregatePressure += positiveCorrelation * loadRatio;
      competitorMeasured = true;
      provenance.add(`${venue}:measured_book_history`);
      provenance.add(`${venue}:same_side_liquidity_overlap`);
      provenance.add('time_aligned_cross_asset_returns');
    }
    if (competitorMeasured) competingPlans += 1;
  }

  if (measuredPairs === 0 || aggregatePressure <= 0) {
    return {
      ...emptyAdvisory(),
      competingPlans,
      measuredPairs,
      maxPositiveCorrelation,
      provenance: [...provenance],
    };
  }

  const boundedPressure = Math.max(0, Math.min(4, aggregatePressure));
  return {
    priorityFactor: 1 / (1 + boundedPressure),
    competingPlans,
    measuredPairs,
    maxPositiveCorrelation,
    aggregateMeasuredPressure: boundedPressure,
    authority: 'measured_cross_impact_scheduling_advisory_only',
    economicAuthority: false,
    executionAuthority: false,
    eligibilityAuthority: false,
    provenance: [...provenance, 'cross_impact_priority_only'],
  };
}
