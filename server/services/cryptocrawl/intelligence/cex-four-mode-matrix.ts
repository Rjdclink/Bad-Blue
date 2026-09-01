import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { cexOrderBookStreams, type CexStreamVenue, type StreamOrderBookQuote } from './cex-order-book-stream.js';
import {
  getCachedCexFeeEvidence,
  resolveCexFeeEvidence,
  type CexFeeEvidence,
  type CexFeeVenue,
} from './cex-fee-resolver.js';
import { observeAriesQueueEcho } from './aries-microstructure.js';

export type CexLegMode = 'maker' | 'taker';
export type CexFourMode = 'MM' | 'MT' | 'TM' | 'TT';

export interface CexModeEconomics {
  symbol: string;
  buyVenue: CexFeeVenue;
  sellVenue: CexFeeVenue;
  mode: CexFourMode;
  buyMode: CexLegMode;
  sellMode: CexLegMode;
  buyPrice: number;
  sellPrice: number;
  grossSpreadBps: number;
  combinedFeeBps: number;
  makerFeeSavingsVsTakerBps: number;
  netAfterExchangeFeesBps: number;
  bpsToBreakEven: number;
  recoveryEfficiency: number;
  makerLegCount: number;
  makerFillProbability: number | null;
  queueRiskPenaltyBps: number;
  feeEvidenceAgeMs: number;
  feeFreshnessScore: number;
  staleEvidencePenaltyBps: number;
  riskAdjustedBpsToBreakEven: number;
  economicallyPositive: boolean;
  observationOnly: boolean;
  expectedFeeAdjustedBps: number;
  observedAt: number;
  authority: 'measured_advisory';
  executionAuthority: false;
  missingExecutionInformation: string[];
}

function authenticatedFee(evidence: CexFeeEvidence | null, mode: CexLegMode): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (mode === 'taker') return Number.isFinite(evidence.takerFeeBps) ? Math.max(0, Number(evidence.takerFeeBps)) : null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Number(evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.abs(Number(evidence.makerRebateBps));
  return null;
}

async function evidence(venue: CexFeeVenue, symbol: string, maxAgeMs: number): Promise<CexFeeEvidence | null> {
  return getCachedCexFeeEvidence(venue, symbol, maxAgeMs)
    || await resolveCexFeeEvidence(venue, symbol, { maxAgeMs }).catch(() => null);
}

function modes(): Array<{ mode: CexFourMode; buyMode: CexLegMode; sellMode: CexLegMode }> {
  return [
    { mode: 'MM', buyMode: 'maker', sellMode: 'maker' },
    { mode: 'MT', buyMode: 'maker', sellMode: 'taker' },
    { mode: 'TM', buyMode: 'taker', sellMode: 'maker' },
    { mode: 'TT', buyMode: 'taker', sellMode: 'taker' },
  ];
}

function observationFloorBps(): number {
  const configured = Number(process.env.CRYPTOCRAWL_CEX_FOUR_MODE_OBSERVATION_FLOOR_BPS ?? -200);
  if (!Number.isFinite(configured)) return -200;
  return Math.max(-1_000, Math.min(0, configured));
}

function compareModes(left: CexModeEconomics, right: CexModeEconomics): number {
  const positiveDelta = Number(right.economicallyPositive) - Number(left.economicallyPositive);
  if (positiveDelta !== 0) return positiveDelta;
  if (left.economicallyPositive && right.economicallyPositive) {
    return right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps
      || right.makerFeeSavingsVsTakerBps - left.makerFeeSavingsVsTakerBps
      || right.feeFreshnessScore - left.feeFreshnessScore
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps
      || left.makerLegCount - right.makerLegCount;
  }
  return left.bpsToBreakEven - right.bpsToBreakEven
    || left.riskAdjustedBpsToBreakEven - right.riskAdjustedBpsToBreakEven
    || right.makerFeeSavingsVsTakerBps - left.makerFeeSavingsVsTakerBps
    || right.feeFreshnessScore - left.feeFreshnessScore
    || right.recoveryEfficiency - left.recoveryEfficiency
    || (right.makerFillProbability ?? 1) - (left.makerFillProbability ?? 1)
    || left.makerLegCount - right.makerLegCount;
}

/**
 * Measures all TT/MT/TM/MM price-and-fee topologies across every currently
 * executable CEX venue on the same fresh evidence surface. Coinbase, Kraken and
 * OKX are peers here; venue-specific API details live below this layer.
 *
 * Negative modes inside a bounded observation envelope are retained so the BPS
 * optimizer can learn the exact recovery gap instead of seeing only winners.
 * Maker modes additionally expose queue-risk, authenticated fee-evidence freshness,
 * and exact authenticated fee savings relative to the same venue-pair TT baseline.
 * These are advisory and never change measured fees or grant execution authority.
 * Positive observations are scheduling triggers only; canonical execution still
 * requires depth-aware all-in revalidation, inventory, governance, product
 * constraints, and terminal settlement.
 */
export async function evaluateCexFourModeMatrix(input: {
  symbol: string;
  maxQuoteAgeMs?: number;
  maxFeeAgeMs?: number;
}): Promise<CexModeEconomics[]> {
  const symbol = input.symbol.trim().toUpperCase();
  const maxQuoteAgeMs = Math.max(250, Math.min(15_000, Number(input.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)));
  const maxFeeAgeMs = Math.max(5_000, Math.min(300_000, Number(input.maxFeeAgeMs || process.env.CRYPTOCRAWL_CEX_FOUR_MODE_FEE_MAX_AGE_MS || 60_000)));
  const venues = getActiveExecutableQuoteVenues() as CexFeeVenue[];
  if (venues.length < 2) return [];

  const observations = await Promise.all(venues.map(async venue => {
    const [book, fee] = await Promise.all([
      cexOrderBookStreams.getQuote(venue as CexStreamVenue, symbol, maxQuoteAgeMs).catch(() => null),
      evidence(venue, symbol, maxFeeAgeMs),
    ]);
    return { venue, book, fee };
  }));

  const books = new Map<CexFeeVenue, StreamOrderBookQuote>();
  const fees = new Map<CexFeeVenue, CexFeeEvidence>();
  for (const observation of observations) {
    if (observation.book) books.set(observation.venue, observation.book);
    if (observation.fee) fees.set(observation.venue, observation.fee);
  }

  const usableVenues = venues.filter(venue => books.has(venue) && fees.has(venue));
  if (usableVenues.length < 2) return [];

  const ttlMs = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || 30_000)));
  const feeFreshnessHalfLifeMs = Math.max(5_000, Math.min(30 * 60_000, Number(process.env.CRYPTOCRAWL_CEX_FEE_FRESHNESS_HALF_LIFE_MS || maxFeeAgeMs)));
  const floorBps = observationFloorBps();
  const output: CexModeEconomics[] = [];

  for (const buyVenue of usableVenues) {
    for (const sellVenue of usableVenues) {
      if (buyVenue === sellVenue) continue;
      const buyBook = books.get(buyVenue)!;
      const sellBook = books.get(sellVenue)!;
      const buyFee = fees.get(buyVenue)!;
      const sellFee = fees.get(sellVenue)!;
      const ttBuyFeeBps = authenticatedFee(buyFee, 'taker');
      const ttSellFeeBps = authenticatedFee(sellFee, 'taker');
      const ttCombinedFeeBps = ttBuyFeeBps !== null && ttSellFeeBps !== null
        ? ttBuyFeeBps + ttSellFeeBps
        : null;

      for (const candidate of modes()) {
        const buyPrice = candidate.buyMode === 'maker' ? buyBook.bid : buyBook.ask;
        const sellPrice = candidate.sellMode === 'maker' ? sellBook.ask : sellBook.bid;
        if (!(buyPrice > 0) || !(sellPrice > buyPrice)) continue;
        const buyFeeBps = authenticatedFee(buyFee, candidate.buyMode);
        const sellFeeBps = authenticatedFee(sellFee, candidate.sellMode);
        if (buyFeeBps === null || sellFeeBps === null) continue;
        const grossSpreadBps = (sellPrice - buyPrice) / buyPrice * 10_000;
        const combinedFeeBps = buyFeeBps + sellFeeBps;
        const makerFeeSavingsVsTakerBps = ttCombinedFeeBps === null
          ? 0
          : Math.max(0, ttCombinedFeeBps - combinedFeeBps);
        const netAfterExchangeFeesBps = grossSpreadBps - combinedFeeBps;
        if (netAfterExchangeFeesBps < floorBps) continue;
        const economicallyPositive = netAfterExchangeFeesBps > 0;
        const bpsToBreakEven = economicallyPositive ? 0 : Math.abs(netAfterExchangeFeesBps);
        const recoveryEfficiency = combinedFeeBps > 0
          ? Math.max(0, Math.min(2, grossSpreadBps / combinedFeeBps))
          : grossSpreadBps > 0 ? 2 : 0;

        const makerProbabilities: number[] = [];
        if (candidate.buyMode === 'maker') makerProbabilities.push(observeAriesQueueEcho(buyBook, 'buy', ttlMs, 0.02).fillProbabilityWithinTtl);
        if (candidate.sellMode === 'maker') makerProbabilities.push(observeAriesQueueEcho(sellBook, 'sell', ttlMs, 0.02).fillProbabilityWithinTtl);
        const makerLegCount = makerProbabilities.length;
        const makerFillProbability = makerLegCount > 0
          ? makerProbabilities.reduce((product, value) => product * Math.max(0, Math.min(1, value)), 1)
          : null;
        const expectedFeeAdjustedBps = makerFillProbability === null
          ? netAfterExchangeFeesBps
          : netAfterExchangeFeesBps * makerFillProbability;
        const queueRiskPenaltyBps = makerFillProbability === null
          ? 0
          : Math.max(0, grossSpreadBps) * (1 - makerFillProbability);
        const now = Date.now();
        const feeEvidenceAgeMs = Math.max(0, now - Math.min(buyFee.observedAt, sellFee.observedAt));
        const feeFreshnessScore = Number(Math.pow(0.5, feeEvidenceAgeMs / feeFreshnessHalfLifeMs).toFixed(6));
        const staleEvidencePenaltyBps = Math.max(0, combinedFeeBps) * (1 - feeFreshnessScore);
        const riskAdjustedBpsToBreakEven = economicallyPositive
          ? queueRiskPenaltyBps + staleEvidencePenaltyBps
          : bpsToBreakEven + queueRiskPenaltyBps + staleEvidencePenaltyBps;
        output.push({
          symbol,
          buyVenue,
          sellVenue,
          mode: candidate.mode,
          buyMode: candidate.buyMode,
          sellMode: candidate.sellMode,
          buyPrice,
          sellPrice,
          grossSpreadBps,
          combinedFeeBps,
          makerFeeSavingsVsTakerBps,
          netAfterExchangeFeesBps,
          bpsToBreakEven,
          recoveryEfficiency,
          makerLegCount,
          makerFillProbability,
          queueRiskPenaltyBps,
          feeEvidenceAgeMs,
          feeFreshnessScore,
          staleEvidencePenaltyBps,
          riskAdjustedBpsToBreakEven,
          economicallyPositive,
          observationOnly: !economicallyPositive,
          expectedFeeAdjustedBps,
          observedAt: Math.min(buyBook.timestamp, sellBook.timestamp),
          authority: 'measured_advisory',
          executionAuthority: false,
          missingExecutionInformation: economicallyPositive
            ? ['canonical_depth_aware_all_in_revalidation_required', 'inventory_governance_product_and_terminal_settlement_admission_required']
            : ['positive_all_in_economics_required'],
        });
      }
    }
  }
  return output.sort(compareModes);
}
