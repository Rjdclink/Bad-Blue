import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';

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
  ensureOrderBookEvolutionWiring();
  // Durable learning memory rehydrates independently of market discovery and
  // execution. A database outage therefore degrades historical intelligence only.
  void canonicalIntelligenceRepository.hydrate();
  // Durable retry/restart recovery is also isolated from the trading hot path.
  ensureCanonicalIntelligenceOutbox();
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
    measuredOpportunityGraph: 'continuous_multi_topology',
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'dual_axis_search_and_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    intelligenceMemoryExecutionDependency: false,
    durableLearningOutbox: 'private_postgres_deduped_retry_recovery',
    durableLearningOutboxExecutionDependency: false,
    zeroCapitalExecutionAdmission: 'resource_leases',
    runtimeHeartbeat: true,
  });
}
