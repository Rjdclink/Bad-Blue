import logger from '../../../logger.js';
import { hedgedRpcRead } from '../api/hedged-rpc-read.js';
import type { SupportedChain } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { cexOrderBookStreams, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { predictiveCainPreparation, type PredictedLuxPreparationRecord } from '../intelligence/predictive-cain-preparation.js';

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let budgetWindowStartedAt = 0;
let budgetSpent = 0;
const preparedPredictions = new Set<string>();

const CHAIN_ALIASES: Record<string, SupportedChain> = {
  ethereum: 'ethereum', eth: 'ethereum', polygon: 'polygon', matic: 'polygon', arbitrum: 'arbitrum', arb: 'arbitrum',
  optimism: 'optimism', op: 'optimism', base: 'base', avalanche: 'avalanche', avax: 'avalanche', bsc: 'bsc', binance: 'bsc',
};
const CEX_VENUES = new Set<CexStreamVenue>(['coinbase', 'kraken', 'okx']);

function normalizeVenue(value: string): CexStreamVenue | null {
  const normalized = value.trim().toLowerCase();
  return CEX_VENUES.has(normalized as CexStreamVenue) ? normalized as CexStreamVenue : null;
}
function normalizeChain(value: string): SupportedChain | null {
  return CHAIN_ALIASES[value.trim().toLowerCase()] || null;
}
function consumePreparationBudget(units: number): boolean {
  const now = Date.now();
  if (now - budgetWindowStartedAt >= 60_000) {
    budgetWindowStartedAt = now;
    budgetSpent = 0;
  }
  const max = Math.max(1, Number(process.env.PREDICTIVE_CAIN_PREP_BUDGET_PER_MINUTE || 30));
  if (budgetSpent + units > max) return false;
  budgetSpent += units;
  return true;
}

async function prewarm(record: PredictedLuxPreparationRecord): Promise<void> {
  if (!record.predictedPositive || preparedPredictions.has(record.predictionId)) return;
  if (!consumePreparationBudget(1)) return;
  preparedPredictions.add(record.predictionId);
  const tasks: Promise<unknown>[] = [];

  // Warm shared market-universe/provider caches. This cannot produce eligibility.
  tasks.push(marketDataProviders.discoverUniverse().catch(() => []));

  const symbol = record.assets.find(asset => /(?:USD|USDT|USDC)$/i.test(asset)) || record.assets[0];
  if (symbol) {
    for (const rawVenue of record.venues.slice(0, 3)) {
      const venue = normalizeVenue(rawVenue);
      if (!venue || !consumePreparationBudget(1)) continue;
      tasks.push(cexOrderBookStreams.getQuote(venue, symbol, 7_500).catch(() => null));
    }
  }

  for (const rawChain of record.chains.slice(0, 2)) {
    const chain = normalizeChain(rawChain);
    if (!chain || !consumePreparationBudget(1)) continue;
    tasks.push(hedgedRpcRead<string>(chain, 'eth_blockNumber', [], {
      maxProviders: 2,
      deadlineMs: 2_500,
      validate: (value): value is string => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value),
    }).catch(() => null));
  }

  await Promise.allSettled(tasks);
}

async function sweep(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const candidates = measuredCandidateRegistry.getRecent(Math.max(64, Number(process.env.PREDICTIVE_CAIN_SCAN_LIMIT || 256)));
    for (const candidate of candidates) {
      const prediction = predictiveCainPreparation.observe(candidate);
      if (prediction?.predictedPositive) void prewarm(prediction);
    }

    const active = new Set(candidates.map(candidate => candidate.opportunityId));
    for (const predictionId of [...preparedPredictions]) {
      const record = predictiveCainPreparation.getPreparationRecords(4096).find(item => item.predictionId === predictionId);
      if (!record || !active.has(record.opportunityId)) preparedPredictions.delete(predictionId);
    }
  } catch (error) {
    logger.warn('[PredictiveCain] preparation sweep degraded', {
      component: 'PredictiveCainWiring',
      error: error instanceof Error ? error.message : String(error),
      executionBlocked: false,
    });
  } finally {
    inFlight = false;
  }
}

export function ensurePredictiveCainWiring(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(500, Number(process.env.PREDICTIVE_CAIN_SWEEP_MS || 2_000));
  void sweep();
  timer = setInterval(() => void sweep(), intervalMs);
  timer.unref();
  logger.info('[PredictiveCain] bounded advisory preparation wiring installed', {
    component: 'PredictiveCainWiring',
    intervalMs,
    actions: ['warm_market_data', 'warm_cex_l2', 'warm_validated_rpc'],
    predictionAuthority: 'advisory_preparation_only',
    executionAuthority: false,
    deterministicPositiveAuthority: false,
    verifiedOpportunitySuppressionAllowed: false,
  });
}

export function stopPredictiveCainWiring(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getPredictiveCainWiringHealth() {
  return {
    running: timer !== null,
    preparedPredictions: preparedPredictions.size,
    budgetSpent,
    ...predictiveCainPreparation.getMetrics(),
  };
}
