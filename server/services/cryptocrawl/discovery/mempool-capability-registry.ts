import { providerMeshPendingStream } from '../capital-free/provider-mesh-pending-stream.js';

export type MempoolCapability =
  | 'filtered_full_pending_transaction_feed'
  | 'standard_pending_transactions'
  | 'sequencer_feed'
  | 'provider_specific_pending_feed'
  | 'logs_or_blocks_only'
  | 'none';

export interface MempoolCapabilityRecord {
  chain: string;
  provider: string;
  capability: MempoolCapability;
  active: boolean;
  transactionChainBinding: boolean;
  decodedRouteState: boolean;
  executableBackrunEvidence: boolean;
  reason: string;
  observedAt: number;
}

/**
 * Capability is intentionally conservative. The Alchemy-free provider mesh carries
 * exact per-transaction chain identity on Ethereum/Polygon. Pending visibility by
 * itself still does not prove post-victim state or deterministic backrun profit, so
 * executable evidence remains false until the topology compiler proves those facts.
 */
export function getMempoolCapabilities(): MempoolCapabilityRecord[] {
  const pending = providerMeshPendingStream.getStatistics();
  const activeNetworks = new Set(pending.activeNetworks.map(String));
  const configuredNetworks = new Set(pending.configuredNetworks.map(String));
  const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
  const observedAt = Date.now();

  return chains.map(chain => {
    const configured = configuredNetworks.has(chain);
    const active = activeNetworks.has(chain);
    const transactionChainBinding = configured && pending.exactChainBinding;
    const capability: MempoolCapability = configured
      ? pending.hashesOnly ? 'standard_pending_transactions' : 'provider_specific_pending_feed'
      : 'none';

    return {
      chain,
      provider: configured ? 'provider_mesh' : 'none',
      capability,
      active,
      transactionChainBinding,
      decodedRouteState: false,
      executableBackrunEvidence: false,
      reason: transactionChainBinding
        ? 'Alchemy-free pending observations carry exact chain identity; decoded route completeness remains measured per transaction, while post-victim state and deterministic backrun economics still require compiler proof'
        : configured
          ? 'Alchemy-free pending monitoring is configured but not currently active on this chain'
          : 'No active measured pending feed for this chain',
      observedAt,
    };
  });
}
