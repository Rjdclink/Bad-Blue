import logger from '../../../logger.js';
import {
  getKalshiCrossVenueEventArbitrageSnapshot,
  refreshKalshiCrossVenueEventArbitrage,
} from '../discovery/kalshi-cross-venue-event-arbitrage.js';
import {
  getKalshiEventOpportunitySnapshot,
  refreshKalshiEventOpportunities,
} from '../discovery/kalshi-event-opportunity-generator.js';
import { ensureKalshiFundingLifecycleAdapterRegistered } from '../execution/kalshi-funding-lifecycle-adapter.js';
import {
  getKalshiEventSystemCashSnapshot,
  type KalshiEventSystemCashSnapshot,
} from '../execution/kalshi-event-system-owned-cash-ledger.js';
import {
  getKalshiEventMarketMakingSnapshot,
  refreshKalshiEventMarketMakingFrontier,
} from '../intelligence/kalshi-event-market-making-authority.js';
import {
  getKalshiProbabilityCalibrationStatus,
  runKalshiProbabilityCalibrationCycle,
} from '../intelligence/kalshi-probability-calibration-authority.js';
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
let eventCash: KalshiEventSystemCashSnapshot | null = null;
let eventCashError: string | null = null;

function predictionRefreshMs(): number {
  const configured = Number(process.env.KALSHI_PREDICTION_REFRESH_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(300_000, Math.trunc(configured))) : 15_000;
}

async function refreshPredictionSurface(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshKalshiPredictionIntelligence(true)
    .then(async snapshot => {
      const calibration = await runKalshiProbabilityCalibrationCycle(snapshot);
      const [makerResult, cashResult, opportunityResult, crossVenueResult] = await Promise.allSettled([
        refreshKalshiEventMarketMakingFrontier(true),
        getKalshiEventSystemCashSnapshot(true),
        refreshKalshiEventOpportunities(snapshot),
        refreshKalshiCrossVenueEventArbitrage(snapshot.markets),
      ]);
      const maker = makerResult.status === 'fulfilled' ? makerResult.value : null;
      const opportunity = opportunityResult.status === 'fulfilled' ? opportunityResult.value : null;
      const crossVenue = crossVenueResult.status === 'fulfilled' ? crossVenueResult.value : null;
      if (cashResult.status === 'fulfilled') {
        eventCash = cashResult.value;
        eventCashError = null;
      } else {
        eventCashError = cashResult.reason instanceof Error ? cashResult.reason.message : String(cashResult.reason);
      }
      refreshCycles += 1;
      refreshErrors = snapshot.errors
        + calibration.errors
        + (maker?.errors ?? (makerResult.status === 'rejected' ? 1 : 0))
        + (cashResult.status === 'rejected' ? 1 : 0)
        + (opportunity?.errors ?? (opportunityResult.status === 'rejected' ? 1 : 0))
        + (crossVenueResult.status === 'rejected' ? 1 : 0);
      lastRefreshAt = snapshot.observedAt;
      logger.debug('[KalshiSystem] Prediction intelligence refreshed', {
        component: 'KalshiSystemWiring',
        markets: snapshot.markets.length,
        marketRowsFetched: snapshot.marketRowsFetched,
        marketScanTruncated: snapshot.marketScanTruncated,
        incentives: snapshot.incentives.length,
        feeChanges: snapshot.feeChanges.length,
        calibrationObservations: calibration.observed,
        calibrationLabelsAttached: calibration.labelsAttached,
        calibrationAuthorityModels: calibration.authorityModels,
        calibrationUnresolved: calibration.unresolved,
        eventEligibleCandidates: opportunity?.eligible ?? 0,
        eventDataCollectionCandidates: opportunity?.dataCollection ?? 0,
        crossVenueCandidates: crossVenue?.length ?? 0,
        crossVenueExecutionAuthority: false,
        eventMakerCandidates: maker?.candidates.length ?? 0,
        eventMakerBestMeasuredSpreadAfterFeesBps: maker?.bestMeasuredMakerSpreadAfterFeesBps ?? null,
        eventMakerProjectedSpreadCanCreateProfitability: false,
        eventIncentiveRewardPrecredited: false,
        eventSystemOwnedCashUsd: eventCash?.ownedUsd ?? null,
        eventSystemOwnedCashReservedUsd: eventCash?.reservedUsd ?? null,
        eventSystemOwnedCashUsableUsd: eventCash?.usableUsd ?? null,
        eventAuthenticatedPredictionCashCapacityUsd: eventCash?.authenticatedAvailableUsd ?? null,
        eventPredictionBalancePromotedToOwnership: false,
        eventPerpsMarginPromotedToPredictionCash: false,
        rawMarketProbabilityExecutionAuthority: false,
        executionAuthority: 'exact_calibrated_event_candidates_only',
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

/**
 * Read-only evidence collection entrypoint used when admission discovers missing
 * Kalshi event/cross-venue evidence. It refreshes the existing canonical market,
 * fee, semantic, capital-capacity and calibration surfaces and never grants
 * execution authority itself.
 */
export async function refreshKalshiSystemEvidenceNow(): Promise<void> {
  await refreshPredictionSurface();
}

export function getKalshiSystemWiringStatus() {
  return {
    installed,
    predictionRefreshCycles: refreshCycles,
    predictionRefreshErrors: refreshErrors,
    lastPredictionRefreshAt: lastRefreshAt,
    bps: getKalshiBpsOptimizationSnapshot(),
    eventMarketMaking: getKalshiEventMarketMakingSnapshot(),
    eventOpportunities: getKalshiEventOpportunitySnapshot(),
    crossVenueEventArbitrage: getKalshiCrossVenueEventArbitrageSnapshot(),
    probabilityCalibration: getKalshiProbabilityCalibrationStatus(),
    eventCash: eventCash ? { ...eventCash } : null,
    eventCashError,
    cryptara: getCryptaraKalshiPredictionSummary(),
    quanti: getKalshiQuantiStatus(),
    fundingLifecycleAdapterRegistered: installed,
    duplicateExecutionSchedulerCreated: false as const,
    canonicalEconomicAuthorityChanged: false as const,
    canonicalMonteCarloAuthorityChanged: false as const,
    rawMarketProbabilityExecutionAuthority: false as const,
    crossVenueExecutionAuthority: false as const,
    eventMakerProjectedSpreadCanCreateProfitability: false as const,
    eventIncentiveRewardPrecredited: false as const,
    eventPredictionBalancePromotedToOwnership: false as const,
    eventPerpsMarginPromotedToPredictionCash: false as const,
    executionAuthority: 'exact_calibrated_event_candidates_only' as const,
  };
}

export function ensureKalshiSystemWiring(): void {
  if (installed || process.env.CRYPTOCRAWL_KALSHI_ENABLED === 'false') return;
  installed = true;

  ensureKalshiFundingLifecycleAdapterRegistered();
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
    probabilityCalibrationDataCollection: true,
    terminalOutcomeLabelsOnly: true,
    chronologicalHoldoutCalibration: true,
    calibrationDriftGate: true,
    automaticEventOpportunityGeneration: true,
    exactSemanticCrossVenueArbitrageDiscovery: true,
    crossVenueExecutionFailClosedUntilAuthenticatedSecondVenueAuthority: true,
    eventMarketDepthMeasurement: true,
    eventMarketMakingFrontier: true,
    eventSystemOwnedCashAuthority: true,
    eventPredictionBalancePromotedToOwnership: false,
    eventPerpsMarginPromotedToPredictionCash: false,
    eventMakerProjectedSpreadCanCreateProfitability: false,
    eventIncentiveRewardPrecredited: false,
    cryptaraContext: true,
    quantiCompContext: true,
    monteCarloLearningContext: true,
    fundingLifecycleAdapterRegistered: true,
    duplicateEconomicAuthority: false,
    duplicateExecutionScheduler: false,
    legacyIntelligenceAuthorityRevived: false,
    rawMarketProbabilityExecutionAuthority: false,
    liveKalshiExecutionGrantedByThisWiring: false,
    liveKalshiExecutionRequiresSystemOwnedCapitalAndFreshAdmission: true,
  });
}