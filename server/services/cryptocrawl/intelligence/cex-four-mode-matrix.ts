import { cexOrderBookStreams } from './cex-order-book-stream.js';
import { getCachedCexFeeEvidence, resolveCexFeeEvidence, type CexFeeEvidence } from './cex-fee-resolver.js';
import { observeAriesQueueEcho } from './aries-microstructure.js';

export type CexLegMode = 'maker' | 'taker';
export type CexFourMode = 'MM' | 'MT' | 'TM' | 'TT';

export interface CexModeEconomics {
  symbol: string;
  buyVenue: 'kraken' | 'okx';
  sellVenue: 'kraken' | 'okx';
  mode: CexFourMode;
  buyMode: CexLegMode;
  sellMode: CexLegMode;
  buyPrice: number;
  sellPrice: number;
  grossSpreadBps: number;
  combinedFeeBps: number;
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

async function evidence(venue: 'kraken' | 'okx', symbol: string): Promise<CexFeeEvidence | null> {
  return getCachedCexFeeEvidence(venue, symbol) || await resolveCexFeeEvidence(venue, symbol).catch(() => null);
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
      || right.feeFreshnessScore - left.feeFreshnessScore
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps
      || left.makerLegCount - right.makerLegCount;
  }
  return left.bpsToBreakEven - right.bpsToBreakEven
    || left.riskAdjustedBpsToBreakEven - right.riskAdjustedBpsToBreakEven
    || right.feeFreshnessScore - left.feeFreshnessScore
    || right.recoveryEfficiency - left.recoveryEfficiency
    || (right.makerFillProbability ?? 1) - (left.makerFillProbability ?? 1)
    || left.makerLegCount - right.makerLegCount;
}

/**
 * Measures all TT/MT/TM/MM price-and-fee topologies on the same fresh books.
 * Negative modes inside a bounded observation envelope are retained so the BPS
 * optimizer can learn the exact recovery gap instead of seeing only winners.
 * Maker modes additionally expose queue-risk and authenticated fee-evidence
 * freshness penalties. These are advisory and never change measured fees or
 * grant hybrid execution authority.
 */
export async function evaluateCexFourModeMatrix(input: {
  symbol: string;
  maxQuoteAgeMs?: number;
}): Promise<CexModeEconomics[]> {
  const symbol = input.symbol.trim().toUpperCase();
  const maxQuoteAgeMs = Math.max(250, Math.min(15_000, Number(input.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)));
  const [kraken, okx, krakenFee, okxFee] = await Promise.all([
    cexOrderBookStreams.getQuote('kraken', symbol, maxQuoteAgeMs).catch(() => null),
    cexOrderBookStreams.getQuote('okx', symbol, maxQuoteAgeMs).catch(() => null),
    evidence('kraken', symbol),
    evidence('okx', symbol),
  ]);
  if (!kraken || !okx) return [];
  const books = { kraken, okx } as const;
  const fees = { kraken: krakenFee, okx: okxFee } as const;
  const ttlMs = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || 30_000)));
  const feeFreshnessHalfLifeMs = Math.max(5_000, Math.min(30 * 60_000, Number(process.env.CRYPTOCRAWL_CEX_FEE_FRESHNESS_HALF_LIFE_MS || 300_000)));
  const floorBps = observationFloorBps();
  const output: CexModeEconomics[] = [];

  for (const buyVenue of ['kraken', 'okx'] as const) {
    for (const sellVenue of ['kraken', 'okx'] as const) {
      if (buyVenue === sellVenue) continue;
      const buyBook = books[buyVenue];
      const sellBook = books[sellVenue];
      for (const candidate of modes()) {
        const buyPrice = candidate.buyMode === 'maker' ? buyBook.bid : buyBook.ask;
        const sellPrice = candidate.sellMode === 'maker' ? sellBook.ask : sellBook.bid;
        if (!(buyPrice > 0) || !(sellPrice > buyPrice)) continue;
        const buyFeeBps = authenticatedFee(fees[buyVenue], candidate.buyMode);
        const sellFeeBps = authenticatedFee(fees[sellVenue], candidate.sellMode);
        if (buyFeeBps === null || sellFeeBps === null) continue;
        const grossSpreadBps = (sellPrice - buyPrice) / buyPrice * 10_000;
        const combinedFeeBps = buyFeeBps + sellFeeBps;
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
        const feeEvidenceAgeMs = Math.max(0, now - Math.min(fees[buyVenue]!.observedAt, fees[sellVenue]!.observedAt));
        const feeFreshnessScore = Number(Math.pow(0.5, feeEvidenceAgeMs / feeFreshnessHalfLifeMs).toFixed(6));
        const staleEvidencePenaltyBps = Math.max(0, combinedFeeBps) * (1 - feeFreshnessScore);
        const riskAdjustedBpsToBreakEven = economicallyPositive
          ? queueRiskPenaltyBps + staleEvidencePenaltyBps
          : bpsToBreakEven + queueRiskPenaltyBps + staleEvidencePenaltyBps;
        const hybrid = candidate.mode === 'MT' || candidate.mode === 'TM';
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
          observationOnly: !economicallyPositive || hybrid,
          expectedFeeAdjustedBps,
          observedAt: Math.min(buyBook.timestamp, sellBook.timestamp),
          authority: 'measured_advisory',
          executionAuthority: false,
          missingExecutionInformation: [
            ...(!economicallyPositive ? ['positive_all_in_economics_required'] : []),
            ...(hybrid ? ['sequential_partial_fill_safe_hybrid_executor', 'fresh_taker_requote_after_maker_fill'] : []),
          ],
        });
      }
    }
  }
  return output.sort(compareModes);
}
