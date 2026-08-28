// Canonical CryptoCrawler capital-free namespace.
//
// Historical barter, partnership, Eden-placement, Starburst-scaling, autonomous
// optimizer, and synthetic protocol-orchestration systems are intentionally not
// exported as production capabilities. Canonical zero-capital execution is owned by
// core/zero-capital-engine.ts plus its governed funding/receiver/settlement adapters.
// Alchemy remains a measured telemetry integration used by the current runtime.

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

export const CAPITAL_FREE_VERSION = 'canonical';
export const CAPITAL_FREE_NAME = 'CryptoCrawler canonical zero-capital boundary';
export const CAPITAL_FREE_CAPABILITIES = [
  'Measured Alchemy telemetry',
  'Governed zero-capital execution via core/zero-capital-engine',
  'Verified settlement before learning',
] as const;
