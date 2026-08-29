import logger from '../../../logger.js';
import { ensureFilteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
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
import { ensureZeroXBudgetObservability } from './zerox-budget-observability.js';

let installed = false;

/**
 * Canonical CryptoCrawler runtime lifecycle wiring.
 *
 * This module is intentionally independent of the historical MasterOrchestrator.
 * It starts only measured/current runtime services and does not grant execution
 * authority. Execution remains governed by the existing stage, economics, risk,
 * resource, settlement, and NO_EXECUTION boundaries.
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
  // Install after resource wiring so provider fee/liquidity evidence reprices the
  // complete configured + dynamic route surface before opportunities reach the queue.
  ensureZeroCapitalFlashProviderWiring();
  ensureOrderBookEvolutionWiring();
  // CEX_CEX assessment topology is corrected before discovery starts so absent
  // on-chain mempool evidence cannot become a synthetic completeness penalty for
  // Coinbase/Kraken/OKX plans. This adapter changes no economics or execution authority.
  ensureCryptaraCexEvidenceWiring();
  // Durable learning memory rehydrates independently of market discovery and
  // execution. A database outage therefore degrades historical intelligence only.
  void canonicalIntelligenceRepository.hydrate();
  // Durable retry/restart recovery is also isolated from the trading hot path.
  ensureCanonicalIntelligenceOutbox();
  // Mempool evidence is optional and cost-governed. When explicitly enabled,
  // provider-side router filters emit hashes first and exact-chain detail is
  // fetched only after relevance has already been established.
  ensureFilteredAlchemyPendingStream();
  ensureFilteredMempoolObservability();
  // 0x request-budget telemetry is local process admission truth only. It does
  // not claim provider quotas and cannot authorize execution.
  ensureZeroXBudgetObservability();
  // Across remains optional bridge evidence. Its health is observable but it
  // cannot become global readiness, profitability, settlement, or execution authority.
  ensureAcrossBridgeObservability();
  measuredOpportunityGraph.start();
  multiTopologyDiscoveryController.start();
  logLegacyIntelligenceQuarantine();
  ensureCryptoRuntimeObservability();

  logger.info('Canonical CryptoCrawler runtime wiring installed', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    lifecycleAuthority: 'canonical_measured_runtime',
    legacyMasterOrchestratorRequired: false,
    executionAuthorityGranted: false,
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    profitCeilingAuthority: false,
    cexCompetitionEvidence: 'topology_not_applicable_without_synthetic_zero',
    cexCompetitionEvidenceExecutionAuthority: false,
    measuredOpportunityGraph: 'continuous_multi_topology',
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'multi_axis_search_formation_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    intelligenceMemoryExecutionDependency: false,
    durableLearningOutbox: 'private_postgres_deduped_retry_recovery',
    durableLearningOutboxExecutionDependency: false,
    filteredMempoolEvidence: 'alchemy_provider_filtered_hash_first_exact_chain',
    filteredMempoolTelemetry: 'hash_to_detail_efficiency_and_budget_pressure',
    filteredMempoolExecutionAuthority: false,
    zeroXRequestAdmission: 'purpose_aware_local_budget_with_execution_reserve',
    zeroXProviderRateLimitClaim: false,
    zeroXRequestAdmissionExecutionAuthority: false,
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeTelemetry: 'configuration_catalog_quote_freshness_and_failure_health',
    acrossBridgeGlobalReadinessAuthority: false,
    acrossBridgeExecutionAuthority: false,
    zeroCapitalFlashLoanEconomics: 'measured_provider_fee_and_liquidity',
    zeroCapitalExecutionAdmission: 'resource_leases',
    runtimeHeartbeat: true,
  });
}
