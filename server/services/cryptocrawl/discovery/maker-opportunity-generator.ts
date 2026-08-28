import { getActiveExecutableQuoteVenues } from './venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { primeCexFeeEvidence, getCachedCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
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

/**
 * Maker topology remains non-executable here. It now performs a parallel shadow
 * proof pass using live WebSocket books: queue depletion, microprice, imbalance,
 * adaptive TTL, paired paper fills and adverse-selection evidence. Paper results
 * are never promoted to realized P&L and never grant execution authority.
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
