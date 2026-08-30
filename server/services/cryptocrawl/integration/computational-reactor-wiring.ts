import { createLogger } from '../../../logger.js';
import {
  computationalReactor,
  getHeatMonitor,
  getReactorStatus,
  initializeReactor,
  reactorEvents,
  type ReactorJob,
} from '../../../reactor/computationalReactor.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
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

function averageProviderQuality(): number {
  const active = getProviderQualityAuctionSnapshot().bids.filter(bid => !bid.temporarilyDeprioritized);
  if (!active.length) return 0;
  return Math.max(0, Math.min(1, active.reduce((sum, bid) => sum + bid.qualityScore, 0) / active.length));
}

function priorityMultiplier(priority: ComputationalSearchPlan['cryptaraPriority']): number {
  if (priority === 'critical') return 1.25;
  if (priority === 'high') return 1.12;
  if (priority === 'low') return 0.85;
  return 1;
}

function buildMeasuredSearchScorer() {
  const modes = getCexFourModeSnapshot().filter(mode => Number.isFinite(mode.riskAdjustedBpsToBreakEven));
  const providerQuality = averageProviderQuality();
  const cortex = getCryptaraSovereignCortexSnapshot();
  const cryptaraPriority = cortex?.requestPriority ?? null;
  const heat = getHeatMonitor();
  const uniqueSymbols = new Set(modes.map(mode => mode.symbol)).size;

  const scorer = (params: Record<string, number>): number => {
    const breadthFactor = Math.max(0.25, Math.min(1, params.breadthFactor));
    const intervalFactor = Math.max(0.5, Math.min(2.5, params.intervalFactor));
    const symbolBudget = Math.max(1, Math.ceil(uniqueSymbols * breadthFactor));
    const ranked = [...modes].sort((a, b) =>
      a.riskAdjustedBpsToBreakEven - b.riskAdjustedBpsToBreakEven
      || a.bpsToBreakEven - b.bpsToBreakEven
      || b.feeFreshnessScore - a.feeFreshnessScore,
    );
    const chosenSymbols = new Set<string>();
    const selected = ranked.filter(mode => {
      if (chosenSymbols.has(mode.symbol)) return false;
      if (chosenSymbols.size >= symbolBudget) return false;
      chosenSymbols.add(mode.symbol);
      return true;
    });
    if (!selected.length) return 0;

    const opportunityValue = selected.reduce((sum, mode) => {
      const gap = Math.max(0, mode.riskAdjustedBpsToBreakEven);
      const gapValue = Math.exp(-gap / 25);
      const recovery = Math.max(0.01, Math.min(1, mode.recoveryEfficiency));
      const freshness = Math.max(0, Math.min(1, mode.feeFreshnessScore));
      return sum + gapValue * (0.5 + 0.5 * recovery) * (0.5 + 0.5 * freshness);
    }, 0) / selected.length;

    const coverage = selected.length / Math.max(1, uniqueSymbols);
    const heatCost = heat.throttleLevel === 'heavy' ? 1 : heat.throttleLevel === 'moderate' ? 0.6 : heat.throttleLevel === 'light' ? 0.3 : 0.1;
    const requestCost = breadthFactor / intervalFactor;
    return (opportunityValue * (0.75 + 0.25 * providerQuality) * priorityMultiplier(cryptaraPriority) * (0.65 + 0.35 * coverage))
      - (0.08 * heatCost * requestCost);
  };

  return { modes, providerQuality, cryptaraPriority, scorer };
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
  latestSearchPlan = {
    observedAt: Date.now(),
    breadthFactor: Math.max(0.25, Math.min(1, Number(best.breadthFactor) || 1)),
    intervalFactor: Math.max(0.5, Math.min(2.5, Number(best.intervalFactor) || 1)),
    sourceModes: modes.length,
    providerQuality: averageProviderQuality(),
    cryptaraPriority: getCryptaraSovereignCortexSnapshot()?.requestPriority ?? null,
    authority: 'measured_compute_search_scheduling_only',
    executionAuthority: false,
  };
}

async function calibrateSearchAllocation(): Promise<void> {
  const heat = getHeatMonitor();
  if (heat.throttleLevel === 'heavy') return;
  const { modes, scorer } = buildMeasuredSearchScorer();
  if (modes.length < 4) return;
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
  }, calibrationIntervalMs());
  calibrationTimer.unref?.();
}

export function ensureComputationalReactorWiring(): void {
  if (installed) return;
  installed = true;

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
      searchAllocationCalibration: 'measured_cex_gap_freshness_provider_quality_compute_cost',
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
  return { ...latestSearchPlan };
}

export function getComputationalReactorStartPromise(): Promise<void> | null {
  return startPromise;
}
