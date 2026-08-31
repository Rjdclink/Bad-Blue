import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { filteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';

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
 * Capability is intentionally conservative. The newer provider-filtered stream
 * carries exact per-transaction chain identity on Ethereum/Polygon, while the
 * legacy aggregate Alchemy integration does not. Neither feed by itself proves
 * post-victim state or deterministic backrun profit, so executable evidence stays
 * false until an exact topology compiler supplies those facts.
 */
export function getMempoolCapabilities(): MempoolCapabilityRecord[] {
  const legacy = alchemyIntegration.getStatistics();
  const legacyActive = new Set(legacy.readiness.activeNetworks.map(String));
  const legacyConfigured = legacy.readiness.configured;
  const filtered = filteredAlchemyPendingStream.getStatistics();
  const filteredActive = new Set(filtered.activeNetworks.map(String));
  const filteredConfigured = new Set(filtered.configuredNetworks.map(String));
  const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
  const observedAt = Date.now();

  return chains.map(chain => {
    const exactFilteredConfigured = filteredConfigured.has(chain);
    const exactFilteredActive = filteredActive.has(chain);
    const legacyIsActive = legacyConfigured && legacyActive.has(chain);
    const active = exactFilteredActive || legacyIsActive;
    const capability: MempoolCapability = exactFilteredConfigured
      ? 'provider_specific_pending_feed'
      : legacyIsActive
        ? 'provider_specific_pending_feed'
        : 'none';
    const transactionChainBinding = exactFilteredConfigured && filtered.exactChainBinding;

    return {
      chain,
      provider: 'alchemy',
      capability,
      active,
      transactionChainBinding,
      decodedRouteState: false,
      executableBackrunEvidence: false,
      reason: transactionChainBinding
        ? 'Provider-filtered pending observations carry exact chain identity; decoded route completeness is measured per transaction, but post-victim state and deterministic backrun economics are not yet executable evidence'
        : active
          ? 'Legacy measured pending feed is active, but its aggregate observations do not carry authoritative per-transaction chain binding or post-victim state'
          : exactFilteredConfigured
            ? 'Exact-chain filtered pending monitoring is configured but not currently active'
            : 'No active measured pending feed for this chain',
      observedAt,
    };
  });
}
