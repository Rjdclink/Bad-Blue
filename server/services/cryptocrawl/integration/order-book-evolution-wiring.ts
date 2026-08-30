import logger from '../../../logger.js';
import { getHeatMonitor } from '../../../reactor/computationalReactor.js';
import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { recordAntennaProviderObservation } from '../intelligence/sovereign-antenna-quality.js';
import { orderBookEvolutionStore } from '../validation/order-book-evolution-store.js';
import { getComputationalSearchPlan } from './computational-reactor-wiring.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastAuctionLogAt = 0;

function baseSymbolLimit(): number {
  const configured = Number(process.env.CRYPTOCRAWL_ANTENNA_SYMBOLS || process.env.CRYPTOCRAWL_BOOK_EVOLUTION_SYMBOLS || 32);
  return Math.max(8, Math.min(64, Number.isFinite(configured) ? Math.trunc(configured) : 32));
}

function providerAuctionLogIntervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_PROVIDER_AUCTION_LOG_INTERVAL_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, configured)) : 15_000;
}

function requestBatchSize(): number {
  const configured = Number(process.env.CRYPTOCRAWL_ANTENNA_REQUEST_BATCH || 16);
  return Number.isFinite(configured) ? Math.max(2, Math.min(64, Math.trunc(configured))) : 16;
}

function adaptivePlan(): { symbolLimit: number; intervalMs: number; maxAgeMs: number } {
  const heat = getHeatMonitor();
  const auction = getProviderQualityAuctionSnapshot();
  const computePlan = getComputationalSearchPlan();
  const activeBids = auction.bids.filter(bid => !bid.temporarilyDeprioritized);
  const failurePressure = activeBids.length
    ? activeBids.reduce((sum, bid) => sum + bid.failureRate, 0) / activeBids.length
    : 0;
  const p95Latency = activeBids
    .map(bid => bid.p95LatencyMs)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);

  const heatFactor = heat.throttleLevel === 'heavy' ? 0.25 : heat.throttleLevel === 'moderate' ? 0.5 : heat.throttleLevel === 'light' ? 0.75 : 1;
  const providerFactor = failurePressure >= 0.5 ? 0.5 : failurePressure >= 0.25 ? 0.75 : 1;
  const computeBreadth = computePlan.observedAt > 0 ? computePlan.breadthFactor : 1;
  const symbolLimit = Math.max(4, Math.min(baseSymbolLimit(), Math.floor(baseSymbolLimit() * heatFactor * providerFactor * computeBreadth)));

  const baseInterval = Math.max(250, Number(process.env.CRYPTOCRAWL_BOOK_EVOLUTION_INTERVAL_MS || 1_000));
  const latencyFactor = p95Latency > 2_000 ? 2 : p95Latency > 750 ? 1.5 : 1;
  const pressureFactor = heat.throttleLevel === 'heavy' ? 4 : heat.throttleLevel === 'moderate' ? 2 : heat.throttleLevel === 'light' ? 1.25 : 1;
  const failureFactor = failurePressure >= 0.5 ? 2 : failurePressure >= 0.25 ? 1.5 : 1;
  const computeInterval = computePlan.observedAt > 0 ? computePlan.intervalFactor : 1;
  const intervalMs = Math.max(250, Math.min(15_000, Math.round(baseInterval * Math.max(latencyFactor, pressureFactor, failureFactor) * computeInterval)));

  const configuredMaxAge = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const maxAgeMs = Math.max(500, Math.min(configuredMaxAge, Math.max(500, intervalMs * 2)));
  return { symbolLimit, intervalMs, maxAgeMs };
}

async function observeOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const venues = getActiveExecutableQuoteVenues();
    const plan = adaptivePlan();
    const symbols = getLastOrderedMarketUniverseSymbols().slice(0, plan.symbolLimit);
    // Interleave venues per symbol so every request batch contains both Kraken
    // and OKX whenever both are executable. Provider quality may change attention
    // and cadence, but it never removes an executable venue from observation.
    const tasks = symbols.flatMap(symbol => venues.map(venue => async () => {
      const startedAt = Date.now();
      try {
        const quote = await cexOrderBookStreams.getQuote(venue, symbol, plan.maxAgeMs);
        recordAntennaProviderObservation({ venue, latencyMs: Math.max(0, Date.now() - startedAt), outcome: quote ? 'quote' : 'miss' });
        if (quote) orderBookEvolutionStore.record(quote);
      } catch (error) {
        recordAntennaProviderObservation({ venue, latencyMs: Math.max(0, Date.now() - startedAt), outcome: 'failure' });
        logger.debug('[OrderBookEvolution] antenna observation failed', {
          venue,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    const batchSize = requestBatchSize();
    for (let offset = 0; offset < tasks.length; offset += batchSize) {
      await Promise.allSettled(tasks.slice(offset, offset + batchSize).map(task => task()));
      if (getHeatMonitor().throttleLevel === 'heavy') break;
    }

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
        adaptivePlan: plan,
        computeSearchPlan: getComputationalSearchPlan(),
        allExecutableVenuesStillObservedSimultaneously: true,
        providerAuctionAuthority: auction.authority,
        executionAuthority: false,
      });
    }
  } finally {
    running = false;
  }
}

function scheduleNext(): void {
  const plan = adaptivePlan();
  timer = setTimeout(async () => {
    await observeOnce();
    scheduleNext();
  }, plan.intervalMs);
  timer.unref?.();
}

export function ensureOrderBookEvolutionWiring(): void {
  if (timer) return;
  void observeOnce().finally(() => scheduleNext());
  logger.info('[OrderBookEvolution] Adaptive measured short-horizon book observer installed', {
    component: 'OrderBookEvolutionWiring',
    initialPlan: adaptivePlan(),
    baseSymbolLimit: baseSymbolLimit(),
    authoritativeVenues: getActiveExecutableQuoteVenues(),
    connectionModel: 'persistent_venue_socket_multi_symbol',
    computePressureAware: true,
    computeSearchAllocationAware: true,
    providerFailureLatencyAware: true,
    boundedRequestBatches: requestBatchSize(),
    providerQualityTelemetry: 'measured_latency_hit_rate_failure_rate_recency',
    providerAuction: 'measured_quality_weighted_attention_advisory_only',
    allExecutableVenuesStillObservedSimultaneously: true,
    syntheticTransitions: false,
    executionAuthority: false,
  });
}
