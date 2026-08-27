import { alchemyIntegration } from '../capital-free/alchemy-integration.js';

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
 * Capability is intentionally conservative. The current Alchemy integration
 * aggregates pending observations without attaching a chain to each returned
 * candidate, so it cannot be promoted to chain-bound backrun execution evidence.
 */
export function getMempoolCapabilities(): MempoolCapabilityRecord[] {
  const statistics = alchemyIntegration.getStatistics();
  const active = new Set(statistics.readiness.activeNetworks.map(String));
  const configured = statistics.readiness.configured;
  const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
  const observedAt = Date.now();
  return chains.map(chain => ({
    chain,
    provider: 'alchemy',
    capability: configured && active.has(chain) ? 'provider_specific_pending_feed' : 'none',
    active: configured && active.has(chain),
    transactionChainBinding: false,
    decodedRouteState: false,
    executableBackrunEvidence: false,
    reason: configured && active.has(chain)
      ? 'Measured pending feed is active, but per-transaction chain binding and post-transaction pool-state simulation are not authoritative yet'
      : 'No active measured pending feed for this chain',
    observedAt,
  }));
}
