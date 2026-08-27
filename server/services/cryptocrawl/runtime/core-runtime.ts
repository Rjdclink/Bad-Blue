import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { createCryptoCrawlerCoreLifecycle } from './core-runtime-lifecycle.js';

const lifecycle = createCryptoCrawlerCoreLifecycle({
  startDiscovery: () => measuredOpportunityGraph.start(),
  stopDiscovery: () => measuredOpportunityGraph.stop(),
  startScheduler: () => canonicalExecutionScheduler.start(),
  stopScheduler: () => canonicalExecutionScheduler.stop(),
});

/**
 * Sole lifecycle authority for the topology-independent CryptoCrawler core.
 * Provider/topology-specific monitors initialize separately and may degrade
 * without stopping canonical CEX_CEX discovery or scheduler admission.
 */
export function ensureCryptoCrawlerCoreRuntime(): void {
  const changed = lifecycle.start();
  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime started', {
    component: 'CryptoCoreRuntime',
    discovery: 'measured_opportunity_graph',
    executionScheduler: 'canonical_resource_leased_scheduler',
    topology: 'CEX_CEX',
    optionalProviderFailureBlocksCore: false,
  });
}

export function stopCryptoCrawlerCoreRuntime(): void {
  const changed = lifecycle.stop();
  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime stopped', {
    component: 'CryptoCoreRuntime',
  });
}

export function getCryptoCrawlerCoreRuntimeStatus(): {
  started: boolean;
  discoveryCycle: ReturnType<typeof measuredOpportunityGraph.getLatestCycle>;
  scheduler: ReturnType<typeof canonicalExecutionScheduler.getStats>;
} {
  return {
    started: lifecycle.isStarted(),
    discoveryCycle: measuredOpportunityGraph.getLatestCycle(),
    scheduler: canonicalExecutionScheduler.getStats(),
  };
}
