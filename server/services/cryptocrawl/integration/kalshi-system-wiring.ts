import logger from '../../../logger.js';
import { refreshKalshiPredictionIntelligence } from '../intelligence/kalshi-prediction-market-authority.js';
import { ensureKalshiBpsOptimizationWiring, getKalshiBpsOptimizationSnapshot } from './kalshi-bps-optimization-wiring.js';
import { ensureCryptaraKalshiPredictionWiring, getCryptaraKalshiPredictionSummary } from './cryptara-kalshi-prediction-wiring.js';
import { ensureKalshiMonteCarloContextWiring } from './kalshi-monte-carlo-context-wiring.js';
import { getKalshiQuantiStatus } from './kalshi-quanti-context.js';

let installed = false;
let predictionTimer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<void> | null = null;
let refreshCycles = 0;
let refreshErrors = 0;
let lastRefreshAt: number | null = null;

function predictionRefreshMs(): number {
  const configured = Number(process.env.KALSHI_PREDICTION_REFRESH_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(300_000, Math.trunc(configured))) : 15_000;
}

async function refreshPredictionSurface(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshKalshiPredictionIntelligence(true)
    .then(snapshot => {
      refreshCycles += 1;
      refreshErrors = snapshot.errors;
      lastRefreshAt = snapshot.observedAt;
      logger.debug('[KalshiSystem] Prediction intelligence refreshed', {
        component: 'KalshiSystemWiring',
        markets: snapshot.markets.length,
        incentives: snapshot.incentives.length,
        feeChanges: snapshot.feeChanges.length,
        executionAuthority: false,
      });
    })
    .catch(error => {
      refreshErrors += 1;
      lastRefreshAt = Date.now();
      logger.warn('[KalshiSystem] Prediction intelligence refresh isolated', {
        component: 'KalshiSystemWiring',
        error: error instanceof Error ? error.message : String(error),
        runtimeShutdownAuthority: false,
        executionAuthority: false,
      });
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function getKalshiSystemWiringStatus() {
  return {
    installed,
    predictionRefreshCycles: refreshCycles,
    predictionRefreshErrors: refreshErrors,
    lastPredictionRefreshAt: lastRefreshAt,
    bps: getKalshiBpsOptimizationSnapshot(),
    cryptara: getCryptaraKalshiPredictionSummary(),
    quanti: getKalshiQuantiStatus(),
    duplicateExecutionSchedulerCreated: false as const,
    canonicalEconomicAuthorityChanged: false as const,
    canonicalMonteCarloAuthorityChanged: false as const,
    executionAuthority: false as const,
  };
}

/**
 * Installs Kalshi as a measured input to existing canonical authorities only.
 * It creates no scheduler, execution authority, economics authority or synthetic
 * profit path. Live Kalshi execution remains separately gated until its dedicated
 * lifecycle proves margin, order, fill, funding and terminal settlement evidence.
 */
export function ensureKalshiSystemWiring(): void {
  if (installed || process.env.CRYPTOCRAWL_KALSHI_ENABLED === 'false') return;
  installed = true;

  ensureKalshiBpsOptimizationWiring();
  ensureCryptaraKalshiPredictionWiring();
  ensureKalshiMonteCarloContextWiring();
  void refreshPredictionSurface();

  if (process.env.NO_INTERVALS !== 'true') {
    predictionTimer = setInterval(() => void refreshPredictionSurface(), predictionRefreshMs());
    predictionTimer.unref?.();
  }

  logger.info('[KalshiSystem] Consolidated Kalshi measurement/intelligence wiring installed', {
    component: 'KalshiSystemWiring',
    bpsMeasurement: true,
    predictionMarketIntelligence: true,
    cryptaraContext: true,
    quantiCompContext: true,
    monteCarloLearningContext: true,
    duplicateEconomicAuthority: false,
    duplicateExecutionScheduler: false,
    legacyIntelligenceAuthorityRevived: false,
    liveKalshiExecutionGrantedByThisWiring: false,
  });
}
