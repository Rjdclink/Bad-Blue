import logger from '../../../logger.js';
import { MasterOrchestrator, type PerformanceMetrics } from '../core/master-orchestrator.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getMeasuredEvolutionMetrics } from '../evolution/measured-execution-feedback.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';

const installed = new WeakSet<object>();

type MasterOrchestratorInternals = typeof MasterOrchestrator & {
  performanceMetrics: PerformanceMetrics;
  updateMetrics: () => void;
};

export function ensureMasterOrchestratorMeasuredWiring(): void {
  const target = MasterOrchestrator as unknown as MasterOrchestratorInternals;
  if (installed.has(target)) return;
  installed.add(target);
  logZeroCapitalReadinessDiagnostics();
  ensureLearningLifecycleWiring();
  ensureMonteCarloCalibrationWiring();
  ensureOracleEvidenceWiring();
  ensureDynamicScalePressureWiring();
  ensureZeroCapitalResourceWiring();
  ensureOrderBookEvolutionWiring();
  measuredOpportunityGraph.start();
  multiTopologyDiscoveryController.start();
  logLegacyIntelligenceQuarantine();
  ensureCryptoRuntimeObservability();

  const originalUpdateMetrics = target.updateMetrics.bind(target);
  target.updateMetrics = (): void => {
    originalUpdateMetrics();

    const measured = getMeasuredEvolutionMetrics();
    const opportunities = canonicalOpportunityState.getMetrics(60 * 60 * 1000);
    target.performanceMetrics.opportunitiesDiscovered = opportunities.observedOpportunities;

    if (measured.sampleCount > 0) {
      target.performanceMetrics.totalExecutions = measured.sampleCount;
      target.performanceMetrics.opportunitiesExecuted = measured.sampleCount;
      target.performanceMetrics.successRate = measured.successRate;
      target.performanceMetrics.totalProfit = measured.totalProfitUsd;
      target.performanceMetrics.avgProfitPerExecution = measured.averageProfitUsd;
      target.performanceMetrics.avgExecutionTime = measured.averageLatencyMs ?? 0;

      const priorEfficiency = Number.isFinite(target.performanceMetrics.systemEfficiency)
        ? target.performanceMetrics.systemEfficiency
        : 0;
      target.performanceMetrics.systemEfficiency = Math.max(0, Math.min(1,
        measured.successRate * 0.7 + priorEfficiency * 0.3,
      ));
    }
  };

  logger.info('MasterOrchestrator measured feedback wiring installed', {
    component: 'MasterOrchestratorMeasuredWiring',
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    measuredOpportunityGraph: 'continuous_multi_topology',
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'dual_axis_search_and_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    zeroCapitalExecutionAdmission: 'resource_leases',
    runtimeHeartbeat: true,
  });
}
