import { getActiveExecutableQuoteVenues } from './venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { primeCexFeeEvidence, getCachedCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';

/**
 * Maker topology is deliberately discovery-only until terminal maker orders have
 * produced enough measured fill/adverse-selection/cancel-latency evidence. No
 * maker order is assumed filled and no conditional maker spread is promoted to
 * deterministic executable profit.
 *
 * Coinbase Advanced Trade is intentionally excluded from this legacy maker-book
 * producer. Coinbase taker/IOC execution uses the v3 product-book authority; its
 * old Exchange WebSocket schema is not accepted as maker evidence. Coinbase may
 * join MAKER_CEX only after an Advanced Trade post-only + queue/fill calibration
 * path is separately settlement-proven.
 */
export async function discoverMeasuredMakerCandidates(): Promise<MeasuredCandidate[]> {
  const venues = getActiveExecutableQuoteVenues().filter((venue): venue is 'kraken' | 'okx' => venue !== 'coinbase');
  if (venues.length < 2) return [];
  const symbols = getLastOrderedMarketUniverseSymbols().slice(0, Math.max(1, Math.min(24,
    Number(process.env.CRYPTOCRAWL_MAKER_DISCOVERY_SYMBOLS || 12),
  )));
  if (symbols.length === 0) return [];
  await primeCexFeeEvidence(symbols).catch(() => null);

  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MAKER_CANDIDATE_TTL_MS || 5_000));
  const maxQuoteAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const output: MeasuredCandidate[] = [];

  for (const symbol of symbols) {
    const quotes = await Promise.all(venues.map(async venue => ({
      venue,
      quote: await cexOrderBookStreams.getQuote(venue, symbol, maxQuoteAgeMs).catch(() => null),
      fee: getCachedCexFeeEvidence(venue, symbol),
    })));
    const usable = quotes.filter(entry => entry.quote);
    if (usable.length < 2) continue;

    for (const buy of usable) {
      for (const sell of usable) {
        if (buy.venue === sell.venue || !buy.quote || !sell.quote) continue;
        const observedAt = Math.min(buy.quote.timestamp, sell.quote.timestamp);
        const makerFeeKnown = buy.fee?.makerFeeBps !== null && buy.fee?.makerFeeBps !== undefined ||
          buy.fee?.makerRebateBps !== null && buy.fee?.makerRebateBps !== undefined ||
          sell.fee?.makerFeeBps !== null && sell.fee?.makerFeeBps !== undefined ||
          sell.fee?.makerRebateBps !== null && sell.fee?.makerRebateBps !== undefined;
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
              executable: false, provenance: ['measured_bbo', 'maker_conditional_only'],
            },
            {
              source: `${sell.venue}:order_book`, venue: sell.venue, symbol,
              observedAt: sell.quote.timestamp, bid: sell.quote.bid, ask: sell.quote.ask,
              executable: false, provenance: ['measured_bbo', 'maker_conditional_only'],
            },
          ],
          depth: { status: 'measured', detail: 'Live CEX order-book evidence exists; maker queue position/fill is not inferred from visible depth' },
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
          executionCapabilityReason: 'Maker topology remains discovery-only until order placement/cancel semantics and empirical maker fill/adverse-selection calibration are settlement-proven',
          missingInformation: [
            ...(makerFeeKnown ? [] : ['authenticated_maker_fee_evidence']),
            'empirical_maker_fill_probability',
            'maker_queue_position_proxy',
            'maker_adverse_selection_calibration',
            'maker_cancel_latency_calibration',
            'settlement_safe_maker_order_adapter',
          ],
          provenance: [
            'maker_order_not_assumed_filled',
            'conditional_topology_only',
            ...(buy.fee ? [`fee:${buy.venue}:${buy.fee.source}`] : []),
            ...(sell.fee ? [`fee:${sell.venue}:${sell.fee.source}`] : []),
            'synthetic_evidence:false',
          ],
        }));
      }
    }
  }
  return output;
}
