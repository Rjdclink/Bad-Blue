import logger from '../../../logger.js';
import { alchemyFilteredMempool } from '../capital-free/alchemy-filtered-mempool.js';
import { alchemyIntegration, type MempoolAnalysis } from '../capital-free/alchemy-integration.js';

let installed = false;

function shouldStartFilteredMempool(): boolean {
  return process.env.ALCHEMY_FILTERED_MEMPOOL_ENABLED?.trim().toLowerCase() !== 'false'
    && !!process.env.ALCHEMY_API_KEY?.trim();
}

/**
 * Replaces the expensive broad-hash->detail-RPC evidence path with Alchemy's
 * server-side filtered full-transaction subscription. The filtered path is an
 * independent low-cost capability and therefore does not require enabling the
 * legacy broad pending-transaction firehose. Set ALCHEMY_FILTERED_MEMPOOL_ENABLED=false
 * to opt out explicitly; the legacy unfiltered path remains separately fail-closed.
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
    enabledByDefaultWhenConfigured: true,
    serverSideToAddressFiltering: true,
    fullTransactionPayload: true,
    perHashDetailRpcRequired: false,
    broadPendingDefault: false,
  });
}
