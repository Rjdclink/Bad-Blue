import logger from '../../../logger.js';
import { ensureFilteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureAcrossBridgeObservability } from './across-bridge-observability.js';
import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';
import { ensureFilteredMempoolObservability } from './filtered-mempool-observability.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';
import { ensureZeroCapitalFlashProviderWiring } from './zero-capital-flash-provider-wiring.js';
import { ensureZeroCapitalAtomicStackWiring } from './zero-capital-atomic-stack-wiring.js';
import { ensureZeroXBudgetObservability } from './zerox-budget-observability.js';

let installed = false;

/**
 * Canonical CryptoCrawler runtime lifecycle wiring.
 * Discovery is owned by MultiTopologyDiscoveryController, which invokes every
 * measured producer concurrently without a fixed source priority. This module
 * installs supporting authorities but grants no execution authority itself.
 */
export function ensureCanonicalCryptoCrawlerRuntimeWiring(): void {
  if (installed) return;
  installed = true;

  ensureStageProfitCapRetirement();
  logZeroCapitalReadinessDiagnostics();
  ensureLearningLifecycleWiring();
  ensureMonteCarloCalibrationWiring();
  ensureOracleEvidenceWiring();
  ensureDynamicScalePressureWiring();
  ensureZeroCapitalResourceWiring();
  ensureZeroCapitalFlashProviderWiring();
  ensureZeroCapitalAtomicStackWiring();
  ensureOrderBookEvolutionWiring();
  ensureCryptaraCexEvidenceWiring();
  void canonicalIntelligenceRepository.hydrate();
  ensureCanonicalIntelligenceOutbox();
  ensureFilteredAlchemyPendingStream();
  ensureFilteredMempoolObservability();
  ensureZeroXBudgetObservability();
  ensureAcrossBridgeObservability();
  multiTopologyDiscoveryController.start();
  logLegacyIntelligenceQuarantine();
  ensureCryptoRuntimeObservability();

  logger.info('Canonical CryptoCrawler runtime wiring installed', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    lifecycleAuthority: 'canonical_measured_runtime',
    discoveryAuthority: 'unified_multi_topology_parallel_controller',
    fixedDiscoveryPriority: false,
    legacyMasterOrchestratorRequired: false,
    executionAuthorityGranted: false,
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    profitCeilingAuthority: false,
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'multi_axis_search_formation_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    intelligenceMemoryExecutionDependency: false,
    durableLearningOutbox: 'private_postgres_deduped_retry_recovery',
    durableLearningOutboxExecutionDependency: false,
    filteredMempoolEvidence: 'alchemy_provider_filtered_hash_first_exact_chain',
    filteredMempoolExecutionAuthority: false,
    zeroXRequestAdmission: 'purpose_aware_local_budget_with_execution_reserve',
    zeroXProviderRateLimitClaim: false,
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeExecutionAuthority: false,
    zeroCapitalFlashLoanEconomics: 'measured_provider_fee_and_liquidity',
    zeroCapitalAtomicStacking: 'same_chain_same_token_exact_simulation_shared_principal',
    zeroCapitalAtomicStackExecutionAuthority: false,
    zeroCapitalExecutionAdmission: 'resource_leases_plus_dynamic_profitability_confidence',
    runtimeHeartbeat: true,
  });
}
