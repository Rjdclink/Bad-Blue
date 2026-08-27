import logger from '../../../logger.js';
import {
  createCryptoCrawlerCoreLifecycle,
  type CryptoCrawlerCoreLifecycle,
} from './core-runtime-lifecycle.js';

let lifecyclePromise: Promise<CryptoCrawlerCoreLifecycle> | null = null;
let started = false;

async function getLifecycle(): Promise<CryptoCrawlerCoreLifecycle> {
  if (!lifecyclePromise) {
    lifecyclePromise = Promise.all([
      import('../discovery/opportunity-graph.js'),
      import('../execution/canonical-execution-scheduler.js'),
    ]).then(([discoveryModule, schedulerModule]) => createCryptoCrawlerCoreLifecycle({
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
  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime started', {
    component: 'CryptoCoreRuntime',
    discovery: 'measured_opportunity_graph',
    executionScheduler: 'canonical_resource_leased_scheduler',
    topology: 'CEX_CEX',
    optionalProviderFailureBlocksCore: false,
  });
}

export async function stopCryptoCrawlerCoreRuntime(): Promise<void> {
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
