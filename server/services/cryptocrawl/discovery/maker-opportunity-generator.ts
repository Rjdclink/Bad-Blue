import { getActiveExecutableQuoteVenues } from './venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import {
  primeCexFeeEvidenceForVenueSymbols,
  getCachedCexFeeEvidence,
  type CexFeeEvidence,
} from '../intelligence/cex-fee-resolver.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { observeMakerPaperProof } from '../intelligence/maker-microstructure-proof.js';

function effectiveMakerFeeBps(fee: CexFeeEvidence | null | undefined): number | null {
  if (!fee || fee.source === 'configured_override') return null;
  if (fee.makerFeeBps !== null && Number.isFinite(fee.makerFeeBps)) return Math.max(0, fee.makerFeeBps);
  if (fee.makerRebateBps !== null && Number.isFinite(fee.makerRebateBps)) return -Math.max(0, fee.makerRebateBps);
  return null;
}

function paperProbeNotionalUsd(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_MAKER_PAPER_NOTIONAL_USD || 1_000);
  return Math.max(10, Math.min(5_000, Number.isFinite(parsed) ? parsed : 1_000));
}

function makerDiscoverySymbolBudget(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_MAKER_DISCOVERY_SYMBOLS || 72);
  return Math.max(12, Math.min(96, Number.isFinite(parsed) ? Math.floor(parsed) : 72));
}

function makerBookConcurrency(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_MAKER_BOOK_CONCURRENCY || 12);
  return Math.max(2, Math.min(24, Number.isFinite(parsed) ? Math.floor(parsed) : 12));
}

async function runBounded<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(items.length, concurrency));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

/**
 * Maker topology remains non-executable here. It performs a parallel shadow
 * proof pass using live WebSocket books: queue depletion, microprice, imbalance,
 * adaptive TTL, paired paper fills and adverse-selection evidence.
 *
 * Efficiency rule: market books are read from the already-running shared sockets,
 * then authenticated Kraken/OKX fee evidence is primed once per venue batch for
 * the entire measured symbol set. We do not issue one private fee request per
 * symbol and we never involve Coinbase in this no-new-key maker path.
 *
 * Paper results are never promoted to realized P&L and never grant execution
 * authority.
 */
export async function discoverMeasuredMakerCandidates(): Promise<MeasuredCandidate[]> {
  const venues = getActiveExecutableQuoteVenues().filter((venue): venue is 'kraken' | 'okx' => venue !== 'coinbase');
  if (venues.length < 2) return [];
  const symbols = getLastOrderedMarketUniverseSymbols().slice(0, makerDiscoverySymbolBudget());
  if (symbols.length === 0) return [];

  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MAKER_CANDIDATE_TTL_MS || 5_000));
  const maxQuoteAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const output: MeasuredCandidate[] = [];

  const measured = await runBounded(symbols, makerBookConcurrency(), async symbol => {
    const measuredBooks = await Promise.all(venues.map(async venue => ({
      venue,
      quote: await cexOrderBookStreams.getQuote(venue, symbol, maxQuoteAgeMs).catch(() => null),
    })));
    return {
      symbol,
      usableBooks: measuredBooks.filter(entry => entry.quote !== null),
    };
  });

  const viable = measured.filter(entry => entry.usableBooks.length >= 2);
  if (viable.length === 0) return [];

  const krakenSymbols = viable
    .filter(entry => entry.usableBooks.some(book => book.venue === 'kraken'))
    .map(entry => entry.symbol);
  const okxSymbols = viable
    .filter(entry => entry.usableBooks.some(book => book.venue === 'okx'))
    .map(entry => entry.symbol);

  await primeCexFeeEvidenceForVenueSymbols({
    kraken: krakenSymbols,
    okx: okxSymbols,
  }).catch(() => null);

  for (const { symbol, usableBooks } of viable) {
    const quotes = usableBooks.map(entry => ({
      ...entry,
      fee: getCachedCexFeeEvidence(entry.venue, symbol),
    }));

    for (const buy of quotes) {
      for (const sell of quotes) {
        if (buy.venue === sell.venue || !buy.quote || !sell.quote) continue;
        const observedAt = Math.min(buy.quote.timestamp, sell.quote.timestamp);
        const buyMakerFeeBps = effectiveMakerFeeBps(buy.fee);
        const sellMakerFeeBps = effectiveMakerFeeBps(sell.fee);
        const makerFeeKnown = buyMakerFeeBps !== null && sellMakerFeeBps !== null;
        const paperProof = makerFeeKnown ? observeMakerPaperProof({
          symbol,
          buyVenue: buy.venue,
          sellVenue: sell.venue,
          buyQuote: buy.quote,
          sellQuote: sell.quote,
          buyFeeBps: buyMakerFeeBps!,
          sellFeeBps: sellMakerFeeBps!,
          notionalUsd: paperProbeNotionalUsd(),
        }) : null;
        const routeId = `${buy.venue}->${sell.venue}`;
        output.push(measuredCandidateRegistry.record({
          opportunityId: `maker-cex:${routeId}:${symbol}:${observedAt}`,
          topology: 'MAKER_CEX',
          observedAt,
          expiresAt: observedAt + ttlMs,
          status: 'blocked',
          assets: [symbol],
          venues: [buy.venue, sell.venue],
          chains: [],
          rawQuotes: [
            {
              source: `${buy.venue}:order_book`, venue: buy.venue, symbol,
              observedAt: buy.quote.timestamp, bid: buy.quote.bid, ask: buy.quote.ask,
              executable: false, provenance: ['measured_bbo', 'maker_conditional_only', 'websocket_hot_path'],
            },
            {
              source: `${sell.venue}:order_book`, venue: sell.venue, symbol,
              observedAt: sell.quote.timestamp, bid: sell.quote.bid, ask: sell.quote.ask,
              executable: false, provenance: ['measured_bbo', 'maker_conditional_only', 'websocket_hot_path'],
            },
          ],
          depth: {
            status: 'measured',
            detail: paperProof
              ? `Live books + paper microstructure probe: state=${paperProof.state}, ttlMs=${paperProof.adaptiveTtlMs}, buyImbalance=${paperProof.buyMicrostructure.imbalance.toFixed(3)}, sellImbalance=${paperProof.sellMicrostructure.imbalance.toFixed(3)}`
              : 'Live CEX order-book evidence exists; maker fee evidence is insufficient for a paired paper proof',
          },
          economics: {
            grossProfitUsd: null,
            deterministicNetProfitUsd: null,
            feeUsd: null,
            gasUsd: 0,
            bridgeUsd: 0,
            expectedSlippageBps: null,
            expectedPriceImpactBps: null,
          },
          quoteAgeMs: Math.max(0, Date.now() - observedAt),
          executableCapability: false,
          executionCapabilityReason: 'Paper maker proof accelerates calibration but cannot substitute for terminal settlement evidence or live execution authority',
          missingInformation: [
            ...(makerFeeKnown ? [] : ['authenticated_maker_fee_evidence']),
            'terminal_empirical_maker_fill_probability',
            'terminal_maker_adverse_selection_calibration',
            'terminal_maker_cancel_latency_calibration',
          ],
          provenance: [
            'maker_order_not_assumed_filled',
            'conditional_topology_only',
            'microprice_queue_imbalance_shadow_model',
            'adaptive_maker_ttl_shadow_model',
            'maker_fee_prime:single_batched_cycle',
            'coinbase_dependency:false',
            ...(paperProof ? [`paper_probe:${paperProof.state}`, `paper_probe_ttl_ms:${paperProof.adaptiveTtlMs}`] : []),
            ...(paperProof?.paperNetProfitUsd !== null && paperProof?.paperNetProfitUsd !== undefined
              ? [`paper_net_profit_usd:${paperProof.paperNetProfitUsd.toFixed(6)}`]
              : []),
            ...(buy.fee ? [`fee:${buy.venue}:${buy.fee.source}`] : []),
            ...(sell.fee ? [`fee:${sell.venue}:${sell.fee.source}`] : []),
            'paper_evidence_only:true',
            'realized_profit_credit:false',
          ],
        }));
      }
    }
  }
  return output;
}
