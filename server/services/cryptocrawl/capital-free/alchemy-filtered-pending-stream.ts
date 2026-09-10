/**
 * @deprecated Compatibility shim for the former filtered Alchemy pending stream.
 * Transport is now exclusively owned by providerMeshPendingStream.
 */

import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingNetwork,
  type ProviderMeshPendingTransaction,
} from './provider-mesh-pending-stream.js';

export type FilteredAlchemyNetwork = ProviderMeshPendingNetwork;
export type FilteredPendingTransaction = ProviderMeshPendingTransaction;

export interface FilteredAlchemyPendingStats {
  authority: 'mempool_evidence_only';
  executionAuthority: false;
  running: boolean;
  configuredNetworks: FilteredAlchemyNetwork[];
  activeNetworks: FilteredAlchemyNetwork[];
  providerFilteredHashes: number;
  detailFetches: number;
  detailFetchesBlockedByBudget: number;
  cachedTransactions: number;
  reconnects: number;
  errors: number;
  lastObservationAt: number | null;
  hashesOnly: false;
  providerSideAddressFilter: false;
  exactChainBinding: true;
  alchemyDependency: false;
}

class FilteredAlchemyPendingStreamCompatibility {
  start(): void {
    ensureProviderMeshPendingStream();
  }

  stop(): void {
    // Compatibility callers must not tear down the shared provider-mesh authority.
    // Canonical runtime lifecycle owns the underlying stream.
  }

  getRecentObservations(maxAgeMs = 15_000): FilteredPendingTransaction[] {
    return providerMeshPendingStream.getRecentObservations(maxAgeMs);
  }

  getStatistics(): FilteredAlchemyPendingStats {
    const stats = providerMeshPendingStream.getStatistics();
    return {
      authority: 'mempool_evidence_only',
      executionAuthority: false,
      running: stats.running,
      configuredNetworks: [...stats.configuredNetworks],
      activeNetworks: [...stats.activeNetworks],
      // Legacy field names remain so old diagnostics compile. Their values are
      // mapped from the replacement stream and are not claims of provider-side
      // Alchemy filtering.
      providerFilteredHashes: stats.fullTransactionPushes,
      detailFetches: stats.fallbackDetailFetches,
      detailFetchesBlockedByBudget: stats.fallbackDetailFetchesBlockedByBudget,
      cachedTransactions: stats.cachedTransactions,
      reconnects: stats.reconnects,
      errors: stats.errors,
      lastObservationAt: stats.lastObservationAt,
      hashesOnly: false,
      providerSideAddressFilter: false,
      exactChainBinding: stats.exactChainBinding,
      alchemyDependency: false,
    };
  }
}

export const filteredAlchemyPendingStream = new FilteredAlchemyPendingStreamCompatibility();

export function ensureFilteredAlchemyPendingStream(): FilteredAlchemyPendingStreamCompatibility {
  filteredAlchemyPendingStream.start();
  return filteredAlchemyPendingStream;
}
