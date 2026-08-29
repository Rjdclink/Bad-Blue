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
  makerFillProbability: number | null;
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

/**
 * Measures all TT/MT/TM/MM price-and-fee topologies on the same fresh books.
 * Hybrid modes are advisory until a sequential partial-fill-safe executor exists.
 * MM and TT continue through their existing authoritative executors.
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
        if (!(netAfterExchangeFeesBps > 0)) continue;

        const makerProbabilities: number[] = [];
        if (candidate.buyMode === 'maker') {
          makerProbabilities.push(observeAriesQueueEcho(buyBook, 'buy', ttlMs, 0.02).fillProbabilityWithinTtl);
        }
        if (candidate.sellMode === 'maker') {
          makerProbabilities.push(observeAriesQueueEcho(sellBook, 'sell', ttlMs, 0.02).fillProbabilityWithinTtl);
        }
        const makerFillProbability = makerProbabilities.length > 0
          ? makerProbabilities.reduce((product, value) => product * Math.max(0, Math.min(1, value)), 1)
          : null;
        const expectedFeeAdjustedBps = makerFillProbability === null
          ? netAfterExchangeFeesBps
          : netAfterExchangeFeesBps * makerFillProbability;
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
          makerFillProbability,
          expectedFeeAdjustedBps,
          observedAt: Math.min(buyBook.timestamp, sellBook.timestamp),
          authority: 'measured_advisory',
          executionAuthority: false,
          missingExecutionInformation: hybrid
            ? ['sequential_partial_fill_safe_hybrid_executor', 'fresh_taker_requote_after_maker_fill']
            : [],
        });
      }
    }
  }
  return output.sort((left, right) => right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps);
}
