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
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { evaluateMakerRecoveryCandidate } from '../execution/stablecoin-maker-strategy.js';

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

function liveMakerTargetNotionalUsd(): number {
  const ladder = getProfitLadderNotionalAuthority();
  return ladder.maxNotionalUsd > 0 ? ladder.maxNotionalUsd : paperProbeNotionalUsd();
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
 * Maker discovery has two evidence levels:
 * 1) a fully measured live Kraken/OKX post-only plan produced by the canonical
 *    maker evaluator may be promoted to eligible; it still has to pass every
 *    downstream governance, inventory, product, execution and settlement gate;
 * 2) otherwise the existing paper microstructure proof remains blocked and can
 *    only improve calibration. Paper fills never become live authority.
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

  const liveTargetNotionalUsd = liveMakerTargetNotionalUsd();
  for (const { symbol, usableBooks } of viable) {
    const livePlan = await evaluateMakerRecoveryCandidate({
      symbol,
      notionalUsd: liveTargetNotionalUsd,
      maxQuoteAgeMs,
    }).catch(() => null);

    if (livePlan && Number.isFinite(livePlan.netProfitUsd) && livePlan.netProfitUsd > 0) {
      const observedAt = Date.now() - Math.max(0, livePlan.quoteAgeMs);
      const buyBook = usableBooks.find(book => book.venue === livePlan.buyVenue)?.quote ?? null;
      const sellBook = usableBooks.find(book => book.venue === livePlan.sellVenue)?.quote ?? null;
      output.push(measuredCandidateRegistry.record({
        opportunityId: `maker-live:${livePlan.buyVenue}->${livePlan.sellVenue}:${symbol}:${observedAt}`,
        topology: 'MAKER_CEX',
        observedAt,
        expiresAt: observedAt + Math.max(1_000, Math.min(ttlMs, livePlan.makerExecution.ttlMs)),
        status: 'eligible',
        assets: [symbol],
        venues: [livePlan.buyVenue, livePlan.sellVenue],
        chains: ['cex'],
        rawQuotes: [
          ...(buyBook ? [{
            source: `${livePlan.buyVenue}:order_book`, venue: livePlan.buyVenue, symbol,
            observedAt: buyBook.timestamp, bid: buyBook.bid, ask: buyBook.ask,
            executable: true, provenance: ['measured_bbo', 'maker_post_only_plan', 'websocket_hot_path'],
          }] : []),
          ...(sellBook ? [{
            source: `${livePlan.sellVenue}:order_book`, venue: livePlan.sellVenue, symbol,
            observedAt: sellBook.timestamp, bid: sellBook.bid, ask: sellBook.ask,
            executable: true, provenance: ['measured_bbo', 'maker_post_only_plan', 'websocket_hot_path'],
          }] : []),
        ],
        depth: {
          status: 'measured',
          detail: `Canonical post-only maker plan: baseQty=${livePlan.baseQty}, jointFill=${livePlan.makerExecution.queueEcho.jointFillProbability.toFixed(4)}, stressPersistence=${livePlan.makerExecution.spreadStress.persistenceProbability.toFixed(4)}`,
        },
        economics: {
          grossProfitUsd: livePlan.grossProfitUsd,
          deterministicNetProfitUsd: livePlan.netProfitUsd,
          feeUsd: livePlan.costs.totalCostsUsd,
          gasUsd: livePlan.costs.gasUsd,
          bridgeUsd: livePlan.costs.bridgeFeeUsd,
          expectedSlippageBps: livePlan.expectedSlippageBps,
          expectedPriceImpactBps: livePlan.expectedPriceImpactBps,
        },
        quoteAgeMs: livePlan.quoteAgeMs,
        executableCapability: true,
        executionCapabilityReason: 'Fully measured Kraken/OKX post-only maker plan; downstream inventory, governance, canary, product, execution and terminal settlement gates remain mandatory',
        missingInformation: [],
        provenance: [
          'canonical_maker_recovery_plan',
          `maker_strategy:${livePlan.makerExecution.strategy}`,
          `profit_ladder_target_notional_usd:${liveTargetNotionalUsd}`,
          'maker_canary_is_tightening_only_beneath_profit_ladder',
          'authenticated_maker_fee_evidence',
          `maker_book_authority:${livePlan.makerExecution.bookAuthority}`,
          `queue_authority:${livePlan.makerExecution.queueEcho.authority}`,
          `canary_sizing_authority:${livePlan.makerExecution.canarySizingAuthority}`,
          'post_only:true',
          'taker_fallback:false',
          'coinbase_maker:false',
          'strict_all_in_net_profit_gt_zero:true',
          'terminal_settlement_still_required:true',
          'synthetic_evidence:false',
        ],
      }));
    }

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
          executionCapabilityReason: 'Paper maker proof accelerates calibration but cannot substitute for a fully measured live maker plan or terminal settlement evidence',
          missingInformation: [
            ...(makerFeeKnown ? [] : ['authenticated_maker_fee_evidence']),
            'fully_measured_canonical_maker_plan',
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