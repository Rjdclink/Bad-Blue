import logger from '../../../logger.js';
import {
  createCryptoCrawlerCoreLifecycle,
  type CryptoCrawlerCoreLifecycle,
} from './core-runtime-lifecycle.js';

let lifecyclePromise: Promise<CryptoCrawlerCoreLifecycle> | null = null;
let fundingMonitorPromise: Promise<typeof import('../discovery/funding-rate-monitor.js')> | null = null;
let started = false;

async function getFundingMonitor() {
  if (!fundingMonitorPromise) {
    fundingMonitorPromise = import('../discovery/funding-rate-monitor.js').catch(error => {
      fundingMonitorPromise = null;
      throw error;
    });
  }
  return fundingMonitorPromise;
}

async function getLifecycle(): Promise<CryptoCrawlerCoreLifecycle> {
  if (!lifecyclePromise) {
    lifecyclePromise = Promise.all([
      import('./positive-profit-capture-wiring.js'),
      import('./expanded-market-universe-wiring.js'),
      import('./alchemy-filtered-mempool-wiring.js'),
    ]).then(([profitPolicy, universePolicy, mempoolPolicy]) => {
      // Install narrow compatibility policies before graph/scheduler/provider
      // modules are started. This preserves one deterministic startup order and
      // avoids a cycle through execution -> automatic-stage-progression -> telemetry.
      profitPolicy.ensurePositiveProfitCaptureWiring();
      universePolicy.ensureExpandedMarketUniverseWiring();
      mempoolPolicy.ensureAlchemyFilteredMempoolWiring();
      return Promise.all([
        import('../discovery/opportunity-graph.js'),
        import('../execution/canonical-execution-scheduler.js'),
      ]);
    }).then(([discoveryModule, schedulerModule]) => createCryptoCrawlerCoreLifecycle({
      startDiscovery: () => discoveryModule.measuredOpportunityGraph.start(),
      stopDiscovery: () => discoveryModule.measuredOpportunityGraph.stop(),
      startScheduler: () => schedulerModule.canonicalExecutionScheduler.start(),
      stopScheduler: () => schedulerModule.canonicalExecutionScheduler.stop(),
    })).catch(error => {
      lifecyclePromise = null;
      throw error;
    });
  }
  return lifecyclePromise;
}

/**
 * Sole lifecycle authority for the topology-independent CryptoCrawler core.
 * Provider/topology-specific monitors initialize separately and may degrade
 * without stopping canonical CEX_CEX discovery or scheduler admission.
 *
 * The concrete graph/scheduler modules are loaded lazily to avoid creating a
 * startup cycle through execution -> automatic-stage-progression -> telemetry.
 */
export async function ensureCryptoCrawlerCoreRuntime(): Promise<void> {
  const lifecycle = await getLifecycle();
  const changed = lifecycle.start();
  started = lifecycle.isStarted();

  if (process.env.NO_INTERVALS !== 'true' && String(process.env.CRYPTARA_MODE || '').toUpperCase() !== 'SILENT_WATCHER_ONLY') {
    try {
      (await getFundingMonitor()).fundingRateMonitor.start();
    } catch (error) {
      logger.warn('[CryptoCoreRuntime] Optional funding-rate monitor unavailable; canonical core remains active', {
        component: 'CryptoCoreRuntime',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime started', {
    component: 'CryptoCoreRuntime',
    discovery: 'measured_opportunity_graph',
    executionScheduler: 'canonical_resource_leased_scheduler',
    topology: 'CEX_CEX',
    optionalProviderFailureBlocksCore: false,
    positiveProfitCapturePolicy: 'strict_all_in_net_gt_zero',
    expandedMarketUniverse: true,
    filteredMempoolPolicyInstalled: true,
    fundingRateDiscovery: process.env.NO_INTERVALS === 'true' ? 'withheld_no_intervals' : 'optional_parallel_monitor',
  });
}

export async function stopCryptoCrawlerCoreRuntime(): Promise<void> {
  if (fundingMonitorPromise) {
    try {
      (await fundingMonitorPromise).fundingRateMonitor.stop();
    } catch {
      // Optional topology monitor must not prevent canonical shutdown.
    }
  }
  if (!lifecyclePromise) {
    started = false;
    return;
  }
  const lifecycle = await lifecyclePromise;
  const changed = lifecycle.stop();
  started = lifecycle.isStarted();
  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime stopped', {
    component: 'CryptoCoreRuntime',
  });
}

export function getCryptoCrawlerCoreRuntimeStatus(): { started: boolean } {
  return { started };
}
