import logger from '../../../logger.js';
import {
  discoverPredictionMarketParityOpportunities,
  type PredictionParityOpportunity,
} from '../discovery/prediction-market-opportunity-generator.js';

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let latest: PredictionParityOpportunity[] = [];
let cycles = 0;
let errors = 0;
let lastCompletedAt: number | null = null;

function intervalMs(): number {
  const configured = Number(process.env.PREDICTION_MARKET_SCAN_INTERVAL_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(300_000, Math.trunc(configured))) : 15_000;
}

async function scan(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      latest = await discoverPredictionMarketParityOpportunities();
      cycles += 1;
      lastCompletedAt = Date.now();
    } catch (error) {
      errors += 1;
      logger.warn('[PredictionMarketDiscovery] Runtime scan failed closed', {
        component: 'PredictionMarketDiscoveryWiring',
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function getPredictionMarketDiscoverySnapshot() {
  return {
    cycles,
    errors,
    lastCompletedAt,
    opportunities: latest.map(item => ({ ...item, provenance: [...item.provenance] })),
    executionAuthority: false as const,
  };
}

export function ensurePredictionMarketDiscoveryWiring(): void {
  if (timer || process.env.PREDICTION_MARKET_DISCOVERY_ENABLED === 'false') return;
  void scan();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void scan(), intervalMs());
    timer.unref?.();
  }
  logger.info('[PredictionMarketDiscovery] Public no-auth discovery wiring installed', {
    component: 'PredictionMarketDiscoveryWiring',
    venue: 'polymarket',
    intervalMs: intervalMs(),
    apiKeyRequiredForDiscovery: false,
    signUpRequiredForDiscovery: false,
    executionAuthority: false,
    exactNetProfitAuthority: false,
  });
}
