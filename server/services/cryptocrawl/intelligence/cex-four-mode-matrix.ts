import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { getCoinbaseAdvancedProductConstraints } from './coinbase-advanced-market-data.js';
import { cexOrderBookStreams, type CexStreamVenue, type StreamOrderBookQuote } from './cex-order-book-stream.js';
import {
  getCachedCexFeeEvidence,
  resolveCexFeeEvidence,
  type CexFeeEvidence,
  type CexFeeVenue,
} from './cex-fee-resolver.js';
import { observeAriesQueueEcho } from './aries-microstructure.js';
import { calibrateMakerFillProbability } from './maker-terminal-calibration.js';
import { observeLiquidityResilience, type LiquidityResilienceSnapshot } from './liquidity-resilience.js';
import { evaluateMakerTickQueueJump } from './maker-tick-queue-optimizer.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';

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
  makerCalibrationSamples: number;
  makerCalibrationMultiplier: number;
  makerQueueJumpAvailable: boolean;
  makerQueueJumpValueBps: number;
  takerLiquidityResilienceScore: number | null;
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

async function tickSize(venue: CexFeeVenue, symbol: string): Promise<number | null> {
  try {
    if (venue === 'coinbase') {
      const constraints = await getCoinbaseAdvancedProductConstraints(symbol);
      return Number.isFinite(constraints.priceIncrement) && constraints.priceIncrement > 0 ? constraints.priceIncrement : null;
    }
    const constraints = await getSpotProductConstraints(venue, symbol);
    return Number.isFinite(constraints.priceIncrement) && constraints.priceIncrement > 0 ? constraints.priceIncrement : null;
  } catch {
    return null;
  }
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
      || (right.takerLiquidityResilienceScore ?? 0.5) - (left.takerLiquidityResilienceScore ?? 0.5)
      || right.makerQueueJumpValueBps - left.makerQueueJumpValueBps
      || right.makerFeeSavingsVsTakerBps - left.makerFeeSavingsVsTakerBps
      || right.feeFreshnessScore - left.feeFreshnessScore
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps
      || left.makerLegCount - right.makerLegCount;
  }
  return left.bpsToBreakEven - right.bpsToBreakEven
    || left.riskAdjustedBpsToBreakEven - right.riskAdjustedBpsToBreakEven
    || right.makerQueueJumpValueBps - left.makerQueueJumpValueBps
    || (right.takerLiquidityResilienceScore ?? 0.5) - (left.takerLiquidityResilienceScore ?? 0.5)
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
 * terminal-calibrated fill probability and one-tick queue-jump potential. Taker
 * legs expose measured depth-replenishment resilience. These additions alter only
 * ranking/search pressure; they never change authenticated fees, fabricate BPS,
 * or grant execution authority. Positive observations are scheduling triggers only;
 * canonical execution still requires depth-aware all-in revalidation, inventory,
 * governance, product constraints, and terminal settlement.
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
    const [book, fee, productTickSize] = await Promise.all([
      cexOrderBookStreams.getQuote(venue as CexStreamVenue, symbol, maxQuoteAgeMs).catch(() => null),
      evidence(venue, symbol, maxFeeAgeMs),
      tickSize(venue, symbol),
    ]);
    return {
      venue,
      book,
      fee,
      tickSize: productTickSize,
      resilience: book ? observeLiquidityResilience(book) : null,
    };
  }));

  const books = new Map<CexFeeVenue, StreamOrderBookQuote>();
  const fees = new Map<CexFeeVenue, CexFeeEvidence>();
  const tickSizes = new Map<CexFeeVenue, number>();
  const resilience = new Map<CexFeeVenue, LiquidityResilienceSnapshot>();
  for (const observation of observations) {
    if (observation.book) books.set(observation.venue, observation.book);
    if (observation.fee) fees.set(observation.venue, observation.fee);
    if (observation.tickSize !== null) tickSizes.set(observation.venue, observation.tickSize);
    if (observation.resilience) resilience.set(observation.venue, observation.resilience);
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
        const calibrationMultipliers: number[] = [];
        let makerCalibrationSamples = 0;
        let makerQueueJumpAvailable = false;
        let makerQueueJumpValueBps = 0;

        if (candidate.buyMode === 'maker') {
          const raw = observeAriesQueueEcho(buyBook, 'buy', ttlMs, 0.02).fillProbabilityWithinTtl;
          const calibrated = calibrateMakerFillProbability({
            venue: buyVenue as CexStreamVenue,
            symbol,
            side: 'buy',
            rawFillProbability: raw,
          });
          makerProbabilities.push(calibrated.probability);
          calibrationMultipliers.push(calibrated.calibration.calibrationMultiplier);
          makerCalibrationSamples += calibrated.calibration.sampleCount;
          const venueTick = tickSizes.get(buyVenue);
          if (venueTick) {
            const decision = evaluateMakerTickQueueJump({ quote: buyBook, side: 'buy', tickSize: venueTick, rawFillProbability: calibrated.probability });
            makerQueueJumpAvailable ||= decision.queueJumpPotential;
            makerQueueJumpValueBps += decision.expectedQueueValueBps;
          }
        }
        if (candidate.sellMode === 'maker') {
          const raw = observeAriesQueueEcho(sellBook, 'sell', ttlMs, 0.02).fillProbabilityWithinTtl;
          const calibrated = calibrateMakerFillProbability({
            venue: sellVenue as CexStreamVenue,
            symbol,
            side: 'sell',
            rawFillProbability: raw,
          });
          makerProbabilities.push(calibrated.probability);
          calibrationMultipliers.push(calibrated.calibration.calibrationMultiplier);
          makerCalibrationSamples += calibrated.calibration.sampleCount;
          const venueTick = tickSizes.get(sellVenue);
          if (venueTick) {
            const decision = evaluateMakerTickQueueJump({ quote: sellBook, side: 'sell', tickSize: venueTick, rawFillProbability: calibrated.probability });
            makerQueueJumpAvailable ||= decision.queueJumpPotential;
            makerQueueJumpValueBps += decision.expectedQueueValueBps;
          }
        }

        const makerLegCount = makerProbabilities.length;
        const makerFillProbability = makerLegCount > 0
          ? makerProbabilities.reduce((product, value) => product * Math.max(0, Math.min(1, value)), 1)
          : null;
        const makerCalibrationMultiplier = calibrationMultipliers.length > 0
          ? calibrationMultipliers.reduce((sum, value) => sum + value, 0) / calibrationMultipliers.length
          : 1;

        const takerResilienceScores: number[] = [];
        if (candidate.buyMode === 'taker') {
          const row = resilience.get(buyVenue);
          if (row) takerResilienceScores.push(row.ask.resilienceScore);
        }
        if (candidate.sellMode === 'taker') {
          const row = resilience.get(sellVenue);
          if (row) takerResilienceScores.push(row.bid.resilienceScore);
        }
        const takerLiquidityResilienceScore = takerResilienceScores.length > 0
          ? takerResilienceScores.reduce((sum, value) => sum + value, 0) / takerResilienceScores.length
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
        // Accepted fee evidence is already bounded by the consumer's maxFeeAgeMs
        // and fails closed when older. Age is therefore a refresh/scheduling signal,
        // not an additional economic fee. Keep the compatibility field at zero so
        // accepted authenticated evidence cannot manufacture a synthetic BPS gap.
        const staleEvidencePenaltyBps = 0;
        const riskAdjustedBpsToBreakEven = economicallyPositive
          ? queueRiskPenaltyBps
          : bpsToBreakEven + queueRiskPenaltyBps;
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
          makerCalibrationSamples,
          makerCalibrationMultiplier,
          makerQueueJumpAvailable,
          makerQueueJumpValueBps,
          takerLiquidityResilienceScore,
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