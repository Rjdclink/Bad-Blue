/**
 * @deprecated Compatibility facade for the former Alchemy filtered mempool.
 * The canonical provider-mesh stream and measured txpool analyzer now own this data.
 */

import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingNetwork,
} from './provider-mesh-pending-stream.js';
import {
  getProviderMeshMempoolAnalysis,
  refreshProviderMeshMempoolAnalysis,
  type MempoolAnalysis,
} from './provider-mesh-mempool-analysis.js';

export type FilteredAlchemyNetwork = ProviderMeshPendingNetwork;

class AlchemyFilteredMempoolCompatibility {
  async start(): Promise<void> {
    ensureProviderMeshPendingStream();
    await refreshProviderMeshMempoolAnalysis();
  }

  stop(): void {
    // Shared provider-mesh lifecycle is canonical and cannot be torn down by a
    // deprecated compatibility caller.
  }

  getAnalysis(): MempoolAnalysis {
    return getProviderMeshMempoolAnalysis();
  }

  getStatistics() {
    const stats = providerMeshPendingStream.getStatistics();
    return {
      activeNetworks: [...stats.activeNetworks],
      cachedTransactions: stats.cachedTransactions,
      analyzedTransactions: stats.fullTransactionPushes + stats.fallbackDetailFetches,
      serverSideFiltered: false,
      applicationSideFiltered: true,
      perHashDetailRpcRequired: stats.fallbackDetailFetches > 0,
      unfilteredPendingRequired: false,
      providerAuthority: 'provider_mesh',
      alchemyDependency: false,
    };
  }
}

export const alchemyFilteredMempool = new AlchemyFilteredMempoolCompatibility();
