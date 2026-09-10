// Canonical CryptoCrawler capital-free namespace.
//
// Historical barter, partnership, Eden-placement, Starburst-scaling, autonomous
// optimizer, and synthetic protocol-orchestration systems are intentionally not
// exported as production capabilities. Canonical zero-capital execution is owned by
// core/zero-capital-engine.ts plus its governed funding/receiver/settlement adapters.
// Ordinary chain access and pending-transaction evidence are provider-mesh owned.

export {
  AlchemyIntegration,
  alchemyIntegration,
  type TokenBalance,
  type TokenMetadata,
  type TokenData,
  type PendingTransaction,
  type MempoolAnalysis,
  type AlchemySubscription,
} from './alchemy-integration.js';

export {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingNetwork,
  type ProviderMeshPendingTransaction,
  type ProviderMeshPendingStats,
} from './provider-mesh-pending-stream.js';

export {
  getProviderMeshMempoolAnalysis,
  refreshProviderMeshMempoolAnalysis,
  getProviderMeshMempoolPressureSnapshot,
} from './provider-mesh-mempool-analysis.js';

export const CAPITAL_FREE_VERSION = 'canonical';
export const CAPITAL_FREE_NAME = 'CryptoCrawler canonical zero-capital boundary';
export const CAPITAL_FREE_CAPABILITIES = [
  'Free/configured multi-provider RPC telemetry',
  'Alchemy-free measured pending-transaction and txpool pressure evidence',
  'Governed zero-capital execution via core/zero-capital-engine',
  'Verified settlement before learning',
] as const;
