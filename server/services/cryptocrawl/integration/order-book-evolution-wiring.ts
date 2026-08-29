import logger from '../../../logger.js';
import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { recordAntennaProviderObservation } from '../intelligence/sovereign-antenna-quality.js';
import { orderBookEvolutionStore } from '../validation/order-book-evolution-store.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastAuctionLogAt = 0;

function warmSymbolLimit(): number {
  const configured = Number(
    process.env.CRYPTOCRAWL_ANTENNA_SYMBOLS
      || process.env.CRYPTOCRAWL_BOOK_EVOLUTION_SYMBOLS
      || 32,
  );
  return Math.max(8, Math.min(64, Number.isFinite(configured) ? configured : 32));
}

function providerAuctionLogIntervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_PROVIDER_AUCTION_LOG_INTERVAL_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, configured)) : 15_000;
}

async function observeOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const venues = getActiveExecutableQuoteVenues();
    const symbols = getLastOrderedMarketUniverseSymbols().slice(0, warmSymbolLimit());
    const maxAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
    await Promise.all(venues.flatMap(venue => symbols.map(async symbol => {
      const startedAt = Date.now();
      try {
        const quote = await cexOrderBookStreams.getQuote(venue, symbol, maxAgeMs);
        recordAntennaProviderObservation({
          venue,
          latencyMs: Math.max(0, Date.now() - startedAt),
          outcome: quote ? 'quote' : 'miss',
        });
        if (quote) orderBookEvolutionStore.record(quote);
      } catch (error) {
        recordAntennaProviderObservation({
          venue,
          latencyMs: Math.max(0, Date.now() - startedAt),
          outcome: 'failure',
        });
        logger.debug('[OrderBookEvolution] antenna observation failed', {
          venue,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })));

    const now = Date.now();
    if (now - lastAuctionLogAt >= providerAuctionLogIntervalMs()) {
      lastAuctionLogAt = now;
      const auction = getProviderQualityAuctionSnapshot();
      logger.info('[ProviderQualityAuction] Measured Antenna provider auction refreshed', {
        component: 'OrderBookEvolutionWiring',
        leader: auction.leader ? {
          venue: auction.leader.venue,
          auctionWeight: auction.leader.auctionWeight,
          qualityScore: auction.leader.qualityScore,
          p95LatencyMs: auction.leader.p95LatencyMs,
          hitRate: auction.leader.hitRate,
          failureRate: auction.leader.failureRate,
        } : null,
        bids: auction.bids.map(bid => ({
          venue: bid.venue,
          auctionWeight: bid.auctionWeight,
          temporarilyDeprioritized: bid.temporarilyDeprioritized,
          reasons: bid.reasons,
        })),
        allExecutableVenuesStillObservedSimultaneously: true,
        providerAuctionAuthority: auction.authority,
        executionAuthority: false,
      });
    }
  } finally {
    running = false;
  }
}

export function ensureOrderBookEvolutionWiring(): void {
  if (timer) return;
  const intervalMs = Math.max(500, Number(process.env.CRYPTOCRAWL_BOOK_EVOLUTION_INTERVAL_MS || 1_000));
  void observeOnce();
  timer = setInterval(() => void observeOnce(), intervalMs);
  timer.unref?.();
  logger.info('[OrderBookEvolution] Measured short-horizon book observer installed', {
    component: 'OrderBookEvolutionWiring',
    intervalMs,
    warmSymbolLimit: warmSymbolLimit(),
    authoritativeVenues: getActiveExecutableQuoteVenues(),
    connectionModel: 'persistent_venue_socket_multi_symbol',
    providerQualityTelemetry: 'measured_latency_hit_rate_failure_rate_recency',
    providerAuction: 'measured_quality_weighted_attention_advisory_only',
    allExecutableVenuesStillObservedSimultaneously: true,
    syntheticTransitions: false,
  });
}
