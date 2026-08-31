import { createLogger } from '../../../logger.js';
import {
  computationalReactor,
  getHeatMonitor,
  getReactorStatus,
  initializeReactor,
  reactorEvents,
  type ReactorJob,
} from '../../../reactor/computationalReactor.js';
import { getAdaptiveProfitOperatingEnvelope } from '../governance/adaptive-profit-operating-envelope.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { buildHyperdynamicBpsPlan } from '../optimization/hyperdynamic-bps-solution-engine.js';
import { ensureBpsCompressionMesh, getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';
import { getCryptaraSovereignCortexSnapshot } from './cryptara-sovereign-cortex-wiring.js';

const log = createLogger('ComputationalReactorWiring');
let installed = false;
let startPromise: Promise<void> | null = null;
let calibrationTimer: NodeJS.Timeout | null = null;

export interface ComputationalSearchPlan {
  observedAt: number;
  breadthFactor: number;
  intervalFactor: number;
  sourceModes: number;
  providerQuality: number;
  cryptaraPriority: 'critical' | 'high' | 'normal' | 'low' | null;
  cexAttentionShare: number | null;
  zeroCapitalAttentionShare: number | null;
  explorationShare: number | null;
  hyperdynamicActiveSolutions: number;
  mcSearchMultiplier: number;
  feeRefreshMaxAgeMs: number | null;
  runtimeRiskBufferMultiplier: number;
  runtimeEvidenceRefreshMultiplier: number;
  profitLadderMaxNotionalUsd: number;
  dollarValuePerBpsUsd: number;
  profitLadderComputeMultiplier: number;
  authority: 'measured_compute_search_scheduling_only';
  executionAuthority: false;
}

let latestSearchPlan: ComputationalSearchPlan = {
  observedAt: 0,
  breadthFactor: 1,
  intervalFactor: 1,
  sourceModes: 0,
  providerQuality: 0,
  cryptaraPriority: null,
  cexAttentionShare: null,
  zeroCapitalAttentionShare: null,
  explorationShare: null,
  hyperdynamicActiveSolutions: 0,
  mcSearchMultiplier: 1,
  feeRefreshMaxAgeMs: null,
  runtimeRiskBufferMultiplier: 1,
  runtimeEvidenceRefreshMultiplier: 1,
  profitLadderMaxNotionalUsd: 0,
  dollarValuePerBpsUsd: 0,
  profitLadderComputeMultiplier: 1,
  authority: 'measured_compute_search_scheduling_only',
  executionAuthority: false,
};

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function calibrationIntervalMs(): number {
  const parsed = Number(process.env.REACTOR_SEARCH_CALIBRATION_INTERVAL_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, Math.trunc(parsed))) : 15_000;
}

function heatPressure(): number {
  const level = getHeatMonitor().throttleLevel;
  if (level === 'heavy') return 1;
  if (level === 'moderate') return 0.70;
  if (level === 'light') return 0.40;
  return 0.15;
}

function averageProviderQuality(): number {
  const active = getProviderQualityAuctionSnapshot().bids.filter(bid => !bid.temporarilyDeprioritized);
  if (!active.length) return 0;
  return Math.max(0, Math.min(1, active.reduce((sum, bid) => sum + bid.qualityScore, 0) / active.length));
}

function runtimeHyperdynamicPlan() {
  return buildHyperdynamicBpsPlan({
    providerQuality: averageProviderQuality(),
    heatPressure: heatPressure(),
  });
}

function effectiveMcMultiplier(): number {
  const mesh = getBpsCompressionMeshSnapshot();
  const runtime = runtimeHyperdynamicPlan();
  return Math.max(0.70, Math.min(1.85, (mesh?.hyperdynamic.mcSearchMultiplier ?? 1) * runtime.mcSearchMultiplier));
}

function profitLadderFields(): Pick<ComputationalSearchPlan,
  'profitLadderMaxNotionalUsd' | 'dollarValuePerBpsUsd' | 'profitLadderComputeMultiplier'> {
  const envelope = getAdaptiveProfitOperatingEnvelope();
  const profitLadderMaxNotionalUsd = Math.max(0, Number(envelope.recommendedMaxNotionalUsd) || 0);
  const dollarValuePerBpsUsd = profitLadderMaxNotionalUsd / 10_000;
  const realizedBps = Number(envelope.recent10AverageProfitBps ?? envelope.rolling50AverageProfitBps ?? 0);
  const performanceMultiplier = envelope.performanceDegraded
    ? 0.80
    : 1 + Math.min(0.25, Math.max(0, Number.isFinite(realizedBps) ? realizedBps : 0) / 40);
  const streakMultiplier = 1 + Math.min(0.15, Math.max(0, envelope.consecutiveProfitableCycles) * 0.01);
  const capitalMultiplier = 1 + Math.min(0.20, Math.log10(1 + dollarValuePerBpsUsd) / 5);
  const profitLadderComputeMultiplier = Math.max(0.75, Math.min(1.35,
    performanceMultiplier * streakMultiplier * capitalMultiplier,
  ));
  return {
    profitLadderMaxNotionalUsd,
    dollarValuePerBpsUsd,
    profitLadderComputeMultiplier,
  };
}

function dynamicCalibrationIntervalMs(): number {
  const base = calibrationIntervalMs();
  const ladder = profitLadderFields();
  return Math.max(5_000, Math.min(120_000, Math.round(
    base / Math.max(0.70, effectiveMcMultiplier() * ladder.profitLadderComputeMultiplier),
  )));
}

function searchPlanMaxAgeMs(): number {
  const parsed = Number(process.env.REACTOR_SEARCH_PLAN_MAX_AGE_MS || 45_000);
  return Number.isFinite(parsed) ? Math.max(15_000, Math.min(180_000, Math.trunc(parsed))) : 45_000;
}

function priorityMultiplier(priority: ComputationalSearchPlan['cryptaraPriority']): number {
  if (priority === 'critical') return 1.25;
  if (priority === 'high') return 1.12;
  if (priority === 'low') return 0.85;
  return 1;
}

function meshFields(): Pick<ComputationalSearchPlan,
  'cexAttentionShare' | 'zeroCapitalAttentionShare' | 'explorationShare' |
  'hyperdynamicActiveSolutions' | 'mcSearchMultiplier' | 'feeRefreshMaxAgeMs' |
  'runtimeRiskBufferMultiplier' | 'runtimeEvidenceRefreshMultiplier'> {
  const mesh = getBpsCompressionMeshSnapshot();
  const runtime = runtimeHyperdynamicPlan();
  const activeIds = new Set([...(mesh?.hyperdynamic.activeSolutionIds ?? []), ...runtime.activeSolutionIds]);
  return {
    cexAttentionShare: mesh?.cex.attentionShare ?? null,
    zeroCapitalAttentionShare: mesh?.zeroCapital.attentionShare ?? null,
    explorationShare: mesh?.exploration.attentionShare ?? null,
    hyperdynamicActiveSolutions: activeIds.size,
    mcSearchMultiplier: effectiveMcMultiplier(),
    feeRefreshMaxAgeMs: mesh?.hyperdynamic.feeRefreshMaxAgeMs ?? null,
    runtimeRiskBufferMultiplier: runtime.riskBufferMultiplier,
    runtimeEvidenceRefreshMultiplier: runtime.evidenceRefreshMultiplier,
  };
}

function neutralSearchPlan(sourceModes: number, observedAt = Date.now()): ComputationalSearchPlan {
  return {
    observedAt,
    breadthFactor: 1,
    intervalFactor: 1,
    sourceModes: Math.max(0, sourceModes),
    providerQuality: averageProviderQuality(),
    cryptaraPriority: getCryptaraSovereignCortexSnapshot()?.requestPriority ?? null,
    ...meshFields(),
    ...profitLadderFields(),
    authority: 'measured_compute_search_scheduling_only',
    executionAuthority: false,
  };
}

function compareModesForCompute(left: ReturnType<typeof getCexFourModeSnapshot>[number], right: ReturnType<typeof getCexFourModeSnapshot>[number]): number {
  const positiveDelta = Number(right.economicallyPositive) - Number(left.economicallyPositive);
  if (positiveDelta !== 0) return positiveDelta;
  if (left.economicallyPositive && right.economicallyPositive) {
    return right.expectedFeeAdjustedBps - left.expectedFeeAdjustedBps
      || right.netAfterExchangeFeesBps - left.netAfterExchangeFeesBps
      || right.feeFreshnessScore - left.feeFreshnessScore;
  }
  return left.riskAdjustedBpsToBreakEven - right.riskAdjustedBpsToBreakEven
    || left.bpsToBreakEven - right.bpsToBreakEven
    || right.feeFreshnessScore - left.feeFreshnessScore;
}

function buildMeasuredSearchScorer() {
  const modes = getCexFourModeSnapshot().filter(mode => Number.isFinite(mode.riskAdjustedBpsToBreakEven));
  const providerQuality = averageProviderQuality();
  const cortex = getCryptaraSovereignCortexSnapshot();
  const cryptaraPriority = cortex?.requestPriority ?? null;
  const heat = getHeatMonitor();
  const uniqueSymbols = new Set(modes.map(mode => mode.symbol)).size;
  const mesh = getBpsCompressionMeshSnapshot();
  const cexAttention = mesh?.cex.attentionShare ?? 0.5;
  const hyper = mesh?.hyperdynamic;
  const runtime = runtimeHyperdynamicPlan();
  const ladder = profitLadderFields();
  const mcMultiplier = Math.max(0.70, Math.min(1.85, (hyper?.mcSearchMultiplier ?? 1) * runtime.mcSearchMultiplier));

  const scorer = (params: Record<string, number>): number => {
    const breadthFactor = Math.max(0.25, Math.min(1, params.breadthFactor));
    const intervalFactor = Math.max(0.5, Math.min(2.5, params.intervalFactor));
    const symbolBudget = Math.max(1, Math.ceil(uniqueSymbols * breadthFactor));
    const ranked = [...modes].sort(compareModesForCompute);
    const chosenSymbols = new Set<string>();
    const selected = ranked.filter(mode => {
      if (chosenSymbols.has(mode.symbol)) return false;
      if (chosenSymbols.size >= symbolBudget) return false;
      chosenSymbols.add(mode.symbol);
      return true;
    });
    if (!selected.length) return 0;

    const opportunityValue = selected.reduce((sum, mode) => {
      const recovery = Math.max(0.01, Math.min(1, mode.recoveryEfficiency));
      const freshness = Math.max(0, Math.min(1, mode.feeFreshnessScore));
      if (mode.economicallyPositive) {
        const positiveBps = Math.max(0, mode.expectedFeeAdjustedBps, mode.netAfterExchangeFeesBps);
        const positiveValue = 1 + Math.min(2, positiveBps / 10);
        return sum + positiveValue * (0.65 + 0.35 * freshness);
      }
      // Risk/staleness multipliers affect only scheduling value. They do not
      // alter deterministic economics or any execution/admission threshold.
      const scheduledGap = Math.max(0, mode.riskAdjustedBpsToBreakEven)
        * runtime.riskBufferMultiplier
        * runtime.stalePenaltyMultiplier;
      const gapValue = Math.exp(-scheduledGap / 25);
      return sum + gapValue * (0.5 + 0.5 * recovery) * (0.5 + 0.5 * freshness);
    }, 0) / selected.length;

    const positiveModes = selected.filter(mode => mode.economicallyPositive);
    const positiveCoverage = positiveModes.length / Math.max(1, selected.length);
    const averagePositiveBps = positiveModes.length > 0
      ? positiveModes.reduce((sum, mode) => sum + Math.max(0, mode.expectedFeeAdjustedBps, mode.netAfterExchangeFeesBps), 0) / positiveModes.length
      : 0;
    const measuredDollarEdgeAtLadder = ladder.dollarValuePerBpsUsd * averagePositiveBps;
    const dollarLeverageMultiplier = 1 + Math.min(0.50, Math.log10(1 + Math.max(0, measuredDollarEdgeAtLadder)) / 6);
    const coverage = selected.length / Math.max(1, uniqueSymbols);
    const heatCost = heat.throttleLevel === 'heavy' ? 1 : heat.throttleLevel === 'moderate' ? 0.6 : heat.throttleLevel === 'light' ? 0.3 : 0.1;
    const requestCost = breadthFactor / intervalFactor;
    const meshOpportunityMultiplier = 0.75 + 0.50 * Math.max(0, Math.min(1, cexAttention));
    const hyperdynamicValue = mcMultiplier
      * ladder.profitLadderComputeMultiplier
      * dollarLeverageMultiplier
      * (0.90 + 0.10 * (hyper?.liquidityFocusMultiplier ?? 1))
      * (0.90 + 0.10 * (hyper?.latencyFocusMultiplier ?? 1))
      * (0.90 + 0.10 * (hyper?.sizeRefinementMultiplier ?? 1))
      * (0.90 + 0.10 * runtime.evidenceRefreshMultiplier);
    return (opportunityValue
      * meshOpportunityMultiplier
      * hyperdynamicValue
      * (1 + positiveCoverage * 0.50)
      * (0.75 + 0.25 * providerQuality)
      * priorityMultiplier(cryptaraPriority)
      * (0.65 + 0.35 * coverage))
      - (0.08 * heatCost * requestCost);
  };

  return { modes, providerQuality, cryptaraPriority, runtime, ladder, scorer };
}

function applyCompletedCalibration(event: unknown): void {
  const payload = event as {
    job?: ReactorJob;
    result?: { result?: { bestParameters?: Record<string, number> } };
  };
  if (payload.job?.type !== 'monte_carlo') return;
  if (payload.job.payload.targetComponent !== 'cryptocrawl_search_allocation') return;
  const best = payload.result?.result?.bestParameters;
  if (!best) return;
  const modes = getCexFourModeSnapshot();
  const mesh = getBpsCompressionMeshSnapshot();
  const runtime = runtimeHyperdynamicPlan();
  const meshBreadth = mesh?.cexBreadthBias ?? 1;
  const meshCadence = mesh?.cexCadenceBias ?? 1;
  latestSearchPlan = {
    observedAt: Date.now(),
    breadthFactor: Math.max(0.25, Math.min(1, (Number(best.breadthFactor) || 1) * meshBreadth * runtime.breadthMultiplier)),
    intervalFactor: Math.max(0.5, Math.min(2.5, (Number(best.intervalFactor) || 1) * meshCadence * runtime.cadenceMultiplier)),
    sourceModes: modes.length,
    providerQuality: averageProviderQuality(),
    cryptaraPriority: getCryptaraSovereignCortexSnapshot()?.requestPriority ?? null,
    ...meshFields(),
    ...profitLadderFields(),
    authority: 'measured_compute_search_scheduling_only',
    executionAuthority: false,
  };
}

async function calibrateSearchAllocation(): Promise<void> {
  const heat = getHeatMonitor();
  if (heat.throttleLevel === 'heavy') {
    // Heavy heat keeps the previous bounded plan rather than scheduling more MC.
    // Staleness protection in getComputationalSearchPlan still returns neutral.
    return;
  }
  const { modes, scorer } = buildMeasuredSearchScorer();
  if (modes.length < 4) {
    latestSearchPlan = neutralSearchPlan(modes.length);
    return;
  }
  try {
    await computationalReactor.scheduleMonteCarloRun(
      'cryptocrawl_search_allocation',
      async params => scorer(params as Record<string, number>),
      {
        breadthFactor: { min: 0.25, max: 1 },
        intervalFactor: { min: 0.5, max: 2.5 },
      },
    );
  } catch (error) {
    log.debug('Measured search-allocation calibration deferred', {
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }
}

function scheduleCalibration(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  calibrationTimer = setTimeout(async () => {
    calibrationTimer = null;
    await calibrateSearchAllocation();
    scheduleCalibration();
  }, dynamicCalibrationIntervalMs());
  calibrationTimer.unref?.();
}

export function ensureComputationalReactorWiring(): void {
  if (installed) return;
  installed = true;
  ensureBpsCompressionMesh();

  const maxConcurrentJobs = boundedInteger(process.env.REACTOR_MAX_CONCURRENT_JOBS, 3, 1, 16);
  const maxJobsPerHour = boundedInteger(process.env.REACTOR_MAX_JOBS_PER_HOUR, 100, 10, 10_000);
  const maintenanceStart = process.env.REACTOR_MAINTENANCE_START?.trim() || '00:00';
  const maintenanceEnd = process.env.REACTOR_MAINTENANCE_END?.trim() || '00:00';

  reactorEvents.on('job-completed', applyCompletedCalibration);
  startPromise = initializeReactor({
    enabled: true,
    maxConcurrentJobs,
    maxJobsPerHour,
    maintenanceWindow: { start: maintenanceStart, end: maintenanceEnd },
  }).then(() => {
    scheduleCalibration();
    log.info('Measured computational reactor wired into CryptoCrawler runtime', {
      component: 'ComputationalReactorWiring',
      scheduler: 'priority_plus_age_with_measured_resource_pressure',
      monteCarlo: 'caller_supplied_measured_scorer_only',
      searchAllocationCalibration: 'profit_ladder_dollar_bps_plus_100_solution_hyperdynamic_positive_first_cross_topology_gap_freshness_provider_quality_compute_cost',
      bpsCompressionMesh: getBpsCompressionMeshSnapshot(),
      runtimeHyperdynamic: runtimeHyperdynamicPlan(),
      profitLadderCompute: profitLadderFields(),
      dynamicCalibrationIntervalMs: dynamicCalibrationIntervalMs(),
      searchPlanMaxAgeMs: searchPlanMaxAgeMs(),
      insufficientEvidenceFallback: 'neutral_full_breadth_base_cadence',
      hotPathNetworkRequestsAdded: false,
      executionAuthorityUnchanged: true,
      syntheticOptimizationScores: false,
      crawlerExecutors: 'explicit_callback_only',
      adaptiveConcurrency: true,
      queueBackpressure: true,
      duplicateWorkCollapse: true,
      retryBackoff: 'bounded_exponential',
      maintenanceWindow: maintenanceStart === maintenanceEnd ? 'disabled' : `${maintenanceStart}-${maintenanceEnd}`,
      status: getReactorStatus(),
      executionAuthority: false,
    });
  }).catch(error => {
    installed = false;
    reactorEvents.off('job-completed', applyCompletedCalibration);
    log.error('Measured computational reactor failed to initialize', {
      component: 'ComputationalReactorWiring',
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => {
    startPromise = null;
  });
}

export function getComputationalSearchPlan(): ComputationalSearchPlan {
  const modes = getCexFourModeSnapshot();
  if (latestSearchPlan.observedAt > 0 && Date.now() - latestSearchPlan.observedAt > searchPlanMaxAgeMs()) {
    return neutralSearchPlan(modes.length, 0);
  }
  return { ...latestSearchPlan };
}

export function getComputationalReactorStartPromise(): Promise<void> | null {
  return startPromise;
}