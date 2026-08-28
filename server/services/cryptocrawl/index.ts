/**
 * CryptoCrawler canonical public surface.
 *
 * This barrel intentionally exposes only current measured/governed authorities.
 * Historical Eden/Cain/LuxSwarm/Starburst/Six-Cane/Divine systems are NOT
 * re-exported here. They remain available, explicitly non-authoritative, under:
 *   server/services/cryptocrawl/legacy/index.ts
 *
 * Authority rule: one responsibility -> one canonical owner.
 */

// Runtime lifecycle
export { ensureCanonicalCryptoCrawlerRuntimeWiring } from './integration/canonical-runtime-wiring.js';
export { ensureCryptaraAssessmentWiring } from './integration/cryptara-assessment-wiring.js';
export { ensureCryptaraBeamWiring } from './integration/cryptara-beam-wiring.js';
export { ensureAuthoritativeMonteCarloWiring } from './integration/authoritative-monte-carlo-wiring.js';

// Market intelligence / canonical opportunity state
export { getCryptara } from '../cryptara/index.js';
export { canonicalOpportunityState } from './intelligence/canonical-opportunity-state.js';
export { marketDataProviders } from './intelligence/market-data-providers.js';
export { measuredOpportunityGraph } from './discovery/opportunity-graph.js';
export { multiTopologyDiscoveryController } from './discovery/multi-topology-discovery-controller.js';
export { measuredCandidateRegistry } from './discovery/measured-candidate-registry.js';

// Economics / execution / settlement
export * from './arbitrage/arbitrage-verifier.js';
export { executeVerifiedArbitragePlan } from './execution/index.js';
export {
  assessCanonicalExecutionEnvironment,
  getCanonicalExecutionCapabilities,
  type CanonicalExecutionCapabilities,
  type CanonicalExecutionEnvironmentReadiness,
} from './execution/execution-readiness.js';
export { canonicalExecutionScheduler } from './execution/canonical-execution-scheduler.js';
export { executionResourceScheduler } from './execution/resource-scheduler.js';
export * from './execution/settlement-types.js';

// Canonical Monte Carlo uncertainty model and calibration
export { runProfitabilityMonteCarlo } from './execution/adapters/monte-carlo-profitability.js';
export { monteCarloCalibrationStore } from './validation/monte-carlo-calibration-store.js';
export { getMonteCarloPolicy, MONTE_CARLO_POLICY_VERSION } from './validation/monte-carlo-policy.js';

// Governance / safety
export {
  getCryptocrawlGovernance,
} from './governance/governance.js';
export {
  initializeGovernance,
  getGovernanceState,
  stageManager,
  riskGovernor,
  killSwitch,
  composer,
  profitLadder,
} from './governance/index.js';

// Provider authority
export { multiProviderRpcManager } from './api/blockchain-providers.js';

export const SYSTEM_VERSION = 'canonical-1.0.0';
export const SYSTEM_NAME = 'CryptoCrawler Canonical Measured Runtime';
export const CANONICAL_AUTHORITY_MODEL = 'one_authority_per_responsibility' as const;
export const LEGACY_ENTRYPOINT = 'server/services/cryptocrawl/legacy/index.ts' as const;
