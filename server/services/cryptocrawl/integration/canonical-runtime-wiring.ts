import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureCryptaraLatencyInstrumentation } from './cryptara-latency-instrumentation.js';
import { ensureDiscoveryLatencyInstrumentation } from './discovery-latency-instrumentation.js';
import { ensureExecutionLatencyInstrumentation } from './execution-latency-instrumentation.js';
import { ensureLatencyObservability } from './latency-observability.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureMonteCarloPrecomputeWiring } from './monte-carlo-precompute-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';

let installed = false;

/** Canonical lifecycle wiring. No service started here grants execution authority. */
export function ensureCanonicalCryptoCrawlerRuntimeWiring(): void {
  if (installed) return;
  installed = true;

  ensureStageProfitCapRetirement();
  logZeroCapitalReadinessDiagnostics();
  ensureLearningLifecycleWiring();
  ensureMonteCarloCalibrationWiring();
  ensureMonteCarloPrecomputeWiring();
  ensureOracleEvidenceWiring();
  ensureDynamicScalePressureWiring();
  ensureZeroCapitalResourceWiring();
  ensureOrderBookEvolutionWiring();
  ensureCryptaraLatencyInstrumentation();
  ensureDiscoveryLatencyInstrumentation();
  ensureExecutionLatencyInstrumentation();
  ensureLatencyObservability();
  void canonicalIntelligenceRepository.hydrate();
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
    monteCarloPrecompute: 'quanti_comp_background_advisory_exact_key_ttl',
    monteCarloPrecomputeExecutionAuthority: false,
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    intelligenceMemoryExecutionDependency: false,
    cryptaraLatencyInstrumentation: ['mc_cache', 'ml_advisory'],
    discoveryLatencyInstrumentation: ['ingest', 'normalize', 'candidate', 'deterministic_economics'],
    executionLatencyInstrumentation: ['submit', 'exchange_rpc_ack'],
    latencyObservability: 'measured_percentiles_slo_pressure',
    latencyInstrumentationAuthority: 'telemetry_only',
    zeroCapitalExecutionAdmission: 'resource_leases',
    runtimeHeartbeat: true,
  });
}
