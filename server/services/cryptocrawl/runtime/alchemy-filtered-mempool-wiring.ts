import logger from '../../../logger.js';
import { alchemyFilteredMempool } from '../capital-free/alchemy-filtered-mempool.js';
import { alchemyIntegration, type MempoolAnalysis } from '../capital-free/alchemy-integration.js';

let installed = false;

function shouldStartFilteredMempool(): boolean {
  return process.env.ALCHEMY_FILTERED_MEMPOOL_ENABLED?.trim().toLowerCase() === 'true'
    && !!process.env.ALCHEMY_API_KEY?.trim();
}

/**
 * Optional Alchemy server-side filtered pending-transaction evidence.
 * This is deliberately opt-in because subscription traffic is billable and can
 * become high-volume even when the application itself is restarted quickly.
 * Set ALCHEMY_FILTERED_MEMPOOL_ENABLED=true only when a bounded paid-provider
 * observation budget has been intentionally approved.
 */
export function ensureAlchemyFilteredMempoolWiring(): void {
  if (installed) return;
  installed = true;

  const target = alchemyIntegration as any;
  const originalStart = target.start.bind(target);
  const originalStop = target.stop.bind(target);
  const originalGetMempoolAnalysis = target.getMempoolAnalysis.bind(target) as () => MempoolAnalysis;
  const originalGetStatistics = target.getStatistics.bind(target);

  target.start = async (networks?: string[]): Promise<void> => {
    await originalStart(networks);
    if (shouldStartFilteredMempool()) {
      await alchemyFilteredMempool.start().catch((error: unknown) => {
        logger.warn('[AlchemyFilteredMempool] Filtered stream startup degraded', {
          component: 'AlchemyFilteredMempool',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };

  target.stop = (): void => {
    alchemyFilteredMempool.stop();
    originalStop();
  };

  target.getMempoolAnalysis = (): MempoolAnalysis => {
    const filtered = alchemyFilteredMempool.getAnalysis();
    if (filtered.available || filtered.totalPending > 0) return filtered;
    return originalGetMempoolAnalysis();
  };

  target.getStatistics = () => ({
    ...originalGetStatistics(),
    filteredMempool: alchemyFilteredMempool.getStatistics(),
  });

  logger.info('[AlchemyFilteredMempool] Filtered mempool compatibility wiring installed', {
    component: 'AlchemyFilteredMempool',
    enabledByDefaultWhenConfigured: false,
    explicitOptInRequired: true,
    optInVariable: 'ALCHEMY_FILTERED_MEMPOOL_ENABLED=true',
    serverSideToAddressFiltering: true,
    fullTransactionPayload: true,
    perHashDetailRpcRequired: false,
    broadPendingDefault: false,
  });
}
