import logger from '../../../logger.js';
import { ensureFilteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureAcrossBridgeObservability } from './across-bridge-observability.js';
import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';
import { ensureDynamicProfitabilityAdmissionWiring } from './dynamic-profitability-admission-wiring.js';
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
  // Installed after CEX/zero-capital correctness wiring so adaptive scoring can
  // only admit candidates that have already passed their current-evidence gates.
  ensureDynamicProfitabilityAdmissionWiring();
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
    adaptiveAdmissionFormula: '(NetProfitUSD / ExecutionRisk) * ConfidenceLevel',
    historicalProofRequiredBeforeFirstExecution: false,
    adaptiveThresholdAuthority: 'terminal_realized_outcomes',
    legacyMasterOrchestratorRequired: false,
    executionAuthorityGranted: false,
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'multi_axis_search_formation_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    filteredMempoolEvidence: 'alchemy_provider_filtered_hash_first_exact_chain',
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeExecutionAuthority: false,
    zeroCapitalFlashLoanEconomics: 'measured_provider_fee_and_liquidity',
    zeroCapitalAtomicStacking: 'same_chain_same_token_exact_simulation_shared_principal',
    zeroCapitalAtomicStackExecutionAuthority: false,
    zeroCapitalExecutionAdmission: 'resource_leases_plus_dynamic_profitability_confidence',
    runtimeHeartbeat: true,
  });
}
