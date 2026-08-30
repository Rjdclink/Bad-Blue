import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { getHeatMonitor } from '../../../reactor/computationalReactor.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { cexOrderBookStreams, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { getCryptaraSovereignCortexSnapshot } from './cryptara-sovereign-cortex-wiring.js';

const log = createLogger('CryptaraPredictivePrefetchWiring');
const installed = new WeakSet<object>();
const inFlight = new Map<string, Promise<void>>();
const lastPrefetchAt = new Map<string, number>();
let universeInFlight: Promise<unknown> | null = null;
let lastUniversePrefetchAt = 0;

function minIntervalMs(): number {
  const value = Number(process.env.CRYPTARA_PREFETCH_MIN_INTERVAL_MS || 2_000);
  return Number.isFinite(value) ? Math.max(250, Math.min(30_000, Math.trunc(value))) : 2_000;
}

function universeIntervalMs(): number {
  const value = Number(process.env.CRYPTARA_PREFETCH_UNIVERSE_INTERVAL_MS || 15_000);
  return Number.isFinite(value) ? Math.max(2_000, Math.min(120_000, Math.trunc(value))) : 15_000;
}

function maxQuoteAgeMs(): number {
  const value = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(value) ? Math.max(250, Math.min(15_000, Math.trunc(value))) : 5_000;
}

function shouldPrefetch(assessment: CryptaraOpportunityAssessment): boolean {
  if (assessment.netProfitUsd === null || !(assessment.netProfitUsd > 0)) return false;
  if (assessment.recommendation === 'reject') return false;
  if (getHeatMonitor().throttleLevel === 'heavy') return false;
  const cortex = getCryptaraSovereignCortexSnapshot();
  if (!cortex || cortex.opportunityId !== assessment.opportunityId) return assessment.dataCompleteness >= 0.75;
  return cortex.requestPriority === 'critical' || cortex.requestPriority === 'high';
}

function rankedVenues(): CexStreamVenue[] {
  const auction = getProviderQualityAuctionSnapshot();
  const active = auction.bids
    .filter(bid => !bid.temporarilyDeprioritized && (bid.venue === 'kraken' || bid.venue === 'okx'))
    .map(bid => bid.venue);
  const fallback: CexStreamVenue[] = ['kraken', 'okx'];
  return [...new Set([...active, ...fallback])];
}

function prefetchUniverseIfDue(now: number): Promise<unknown> | null {
  if (now - lastUniversePrefetchAt < universeIntervalMs()) return universeInFlight;
  if (universeInFlight) return universeInFlight;
  lastUniversePrefetchAt = now;
  universeInFlight = Promise.resolve(marketDataProviders.discoverUniverse())
    .catch(error => {
      log.debug('Cryptara universe prefetch failed', { error: error instanceof Error ? error.message : String(error) });
      return null;
    })
    .finally(() => { universeInFlight = null; });
  return universeInFlight;
}

function prefetch(symbol: string): void {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || inFlight.has(normalized)) return;
  const heat = getHeatMonitor();
  if (heat.throttleLevel === 'heavy') return;

  const now = Date.now();
  const pressureMultiplier = heat.throttleLevel === 'moderate' ? 2 : heat.throttleLevel === 'light' ? 1.5 : 1;
  if (now - (lastPrefetchAt.get(normalized) || 0) < minIntervalMs() * pressureMultiplier) return;
  lastPrefetchAt.set(normalized, now);

  const venues = rankedVenues();
  const quoteTasks = venues.map(venue => cexOrderBookStreams.getQuote(venue, normalized, maxQuoteAgeMs()));
  const universeTask = prefetchUniverseIfDue(now);
  const tasks: Promise<unknown>[] = [...quoteTasks];
  if (universeTask) tasks.push(universeTask);

  const task = Promise.allSettled(tasks).then(results => {
    const fulfilled = results.filter(result => result.status === 'fulfilled').length;
    log.debug('Cryptara predictive prefetch completed', {
      symbol: normalized,
      fulfilled,
      attempted: results.length,
      providerOrder: venues,
      universeRefreshAttempted: !!universeTask,
      computeThrottleLevel: heat.throttleLevel,
      requestPriorityAuthority: 'cryptara_sovereign_cortex_advisory',
      executionAuthority: false,
    });
  }).finally(() => {
    inFlight.delete(normalized);
  });
  inFlight.set(normalized, task);
}

export function ensureCryptaraPredictivePrefetchWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as {
    assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
  };
  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async context => {
    const assessment = await originalAssessOpportunity(context);
    if (shouldPrefetch(assessment)) prefetch(context.symbol);
    return assessment;
  };

  log.info('Cryptara predictive prefetch wiring installed', {
    trigger: 'positive_non_rejected_high_priority_assessment',
    warmedEvidence: ['bounded_market_universe', 'provider_ranked_kraken_okx_books'],
    providerQualityAware: true,
    computePressureAware: true,
    boundedPerSymbolIntervalMs: minIntervalMs(),
    boundedUniverseIntervalMs: universeIntervalMs(),
    duplicateInFlightCollapsed: true,
    backgroundIntervalCreated: false,
    executionAuthority: false,
  });
  return instance;
}
