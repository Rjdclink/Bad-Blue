import { createLogger } from '../../../logger.js';
import { initializeReactor, getReactorStatus } from '../../../reactor/computationalReactor.js';

const log = createLogger('ComputationalReactorWiring');
let installed = false;
let startPromise: Promise<void> | null = null;

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export function ensureComputationalReactorWiring(): void {
  if (installed) return;
  installed = true;

  const maxConcurrentJobs = boundedInteger(process.env.REACTOR_MAX_CONCURRENT_JOBS, 3, 1, 16);
  const maxJobsPerHour = boundedInteger(process.env.REACTOR_MAX_JOBS_PER_HOUR, 100, 10, 10_000);
  const maintenanceStart = process.env.REACTOR_MAINTENANCE_START?.trim() || '00:00';
  const maintenanceEnd = process.env.REACTOR_MAINTENANCE_END?.trim() || '00:00';

  startPromise = initializeReactor({
    enabled: true,
    maxConcurrentJobs,
    maxJobsPerHour,
    maintenanceWindow: { start: maintenanceStart, end: maintenanceEnd },
  }).then(() => {
    log.info('Measured computational reactor wired into CryptoCrawler runtime', {
      component: 'ComputationalReactorWiring',
      scheduler: 'priority_plus_age_with_measured_resource_pressure',
      monteCarlo: 'caller_supplied_measured_scorer_only',
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
    log.error('Measured computational reactor failed to initialize', {
      component: 'ComputationalReactorWiring',
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => {
    startPromise = null;
  });
}

export function getComputationalReactorStartPromise(): Promise<void> | null {
  return startPromise;
}
