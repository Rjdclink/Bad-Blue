import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { getCryptaraSovereignCortexSnapshot } from './cryptara-sovereign-cortex-wiring.js';

const log = createLogger('CryptaraPredictivePrefetchWiring');
const installed = new WeakSet<object>();
const inFlight = new Map<string, Promise<void>>();
const lastPrefetchAt = new Map<string, number>();

function minIntervalMs(): number {
  const value = Number(process.env.CRYPTARA_PREFETCH_MIN_INTERVAL_MS || 2_000);
  return Number.isFinite(value) ? Math.max(250, Math.min(30_000, Math.trunc(value))) : 2_000;
}

function maxQuoteAgeMs(): number {
  const value = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(value) ? Math.max(250, Math.min(15_000, Math.trunc(value))) : 5_000;
}

function shouldPrefetch(assessment: CryptaraOpportunityAssessment): boolean {
  if (assessment.netProfitUsd === null || !(assessment.netProfitUsd > 0)) return false;
  if (assessment.recommendation === 'reject') return false;
  const cortex = getCryptaraSovereignCortexSnapshot();
  if (!cortex || cortex.opportunityId !== assessment.opportunityId) return assessment.dataCompleteness >= 0.75;
  return cortex.requestPriority === 'critical' || cortex.requestPriority === 'high';
}

function prefetch(symbol: string): void {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || inFlight.has(normalized)) return;
  const now = Date.now();
  if (now - (lastPrefetchAt.get(normalized) || 0) < minIntervalMs()) return;
  lastPrefetchAt.set(normalized, now);

  const task = Promise.allSettled([
    marketDataProviders.discoverUniverse(),
    cexOrderBookStreams.getQuote('kraken', normalized, maxQuoteAgeMs()),
    cexOrderBookStreams.getQuote('okx', normalized, maxQuoteAgeMs()),
  ]).then(results => {
    const fulfilled = results.filter(result => result.status === 'fulfilled').length;
    log.debug('Cryptara predictive prefetch completed', {
      symbol: normalized,
      fulfilled,
      attempted: results.length,
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
    warmedEvidence: ['market_universe', 'kraken_order_book', 'okx_order_book'],
    boundedPerSymbolIntervalMs: minIntervalMs(),
    duplicateInFlightCollapsed: true,
    backgroundIntervalCreated: false,
    executionAuthority: false,
  });
  return instance;
}
