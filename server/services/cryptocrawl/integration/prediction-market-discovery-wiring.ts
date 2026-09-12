import logger from '../../../logger.js';
import {
  discoverPredictionMarketParityOpportunities,
  type PredictionParityOpportunity,
} from '../discovery/prediction-market-opportunity-generator.js';
import {
  ensureKalshiSystemWiring,
  refreshKalshiSystemEvidenceNow,
} from './kalshi-system-wiring.js';
import { ensureStageOneSpreadObservability } from './stage-one-spread-observability.js';

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

function freshLatest(now = Date.now()): PredictionParityOpportunity[] {
  return latest.filter(item =>
    Number.isFinite(item.observedAt)
    && Number.isFinite(item.expiresAt)
    && item.observedAt > 0
    && item.expiresAt > now,
  );
}

async function scan(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [parityResult, kalshiResult] = await Promise.allSettled([
      discoverPredictionMarketParityOpportunities(),
      refreshKalshiSystemEvidenceNow(),
    ]);
    if (parityResult.status === 'fulfilled') {
      latest = parityResult.value;
    } else {
      errors += 1;
      const staleRowsCleared = latest.length;
      latest = [];
      logger.warn('[PredictionMarketDiscovery] Public parity scan failed closed', {
        component: 'PredictionMarketDiscoveryWiring',
        staleRowsCleared,
        staleOpportunityReadable: false,
        error: parityResult.reason instanceof Error ? parityResult.reason.message : String(parityResult.reason),
        siblingKalshiRefreshContinued: true,
        executionAuthority: false,
      });
    }
    if (kalshiResult.status === 'rejected') {
      errors += 1;
      logger.warn('[PredictionMarketDiscovery] Kalshi refresh isolated inside canonical prediction cadence', {
        component: 'PredictionMarketDiscoveryWiring',
        error: kalshiResult.reason instanceof Error ? kalshiResult.reason.message : String(kalshiResult.reason),
        publicParityRefreshContinued: true,
        executionAuthority: false,
      });
    }
    cycles += 1;
    lastCompletedAt = Date.now();
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function getPredictionMarketDiscoverySnapshot() {
  const fresh = freshLatest();
  if (fresh.length !== latest.length) latest = fresh;
  return {
    cycles,
    errors,
    lastCompletedAt,
    opportunities: fresh.map(item => ({ ...item, provenance: [...item.provenance] })),
    refreshCadenceAuthority: 'prediction_market_discovery_wiring' as const,
    kalshiRefreshUsesSameCadence: true as const,
    duplicateKalshiTimer: false as const,
    staleOpportunityReadable: false as const,
    executionAuthority: false as const,
  };
}

export function ensurePredictionMarketDiscoveryWiring(): void {
  // Stage-1 spread visibility is measurement-only and remains installed even if
  // one optional prediction discovery source is disabled. This piggybacks on an
  // already canonical runtime installer without creating another lifecycle owner.
  ensureStageOneSpreadObservability();
  if (timer || process.env.PREDICTION_MARKET_DISCOVERY_ENABLED === 'false') return;
  // One strategy cadence owns both public parity discovery and the Kalshi event
  // evidence surface. Targeted evidence repair joins the same in-flight Kalshi
  // refresh and cannot create an independent recurring loop.
  ensureKalshiSystemWiring();
  void scan();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void scan(), intervalMs());
    timer.unref?.();
  }
  logger.info('[PredictionMarketDiscovery] Canonical prediction-market discovery wiring installed', {
    component: 'PredictionMarketDiscoveryWiring',
    venues: ['polymarket', 'kalshi'],
    refreshCadenceAuthority: 'prediction_market_discovery_wiring',
    duplicateKalshiTimer: false,
    kalshiSidecarInstalled: process.env.CRYPTOCRAWL_KALSHI_ENABLED !== 'false',
    intervalMs: intervalMs(),
    apiKeyRequiredForPublicParityDiscovery: false,
    signUpRequiredForPublicParityDiscovery: false,
    staleOpportunityReadable: false,
    executionAuthority: false,
    exactNetProfitAuthority: false,
  });
}
