/**
 * 4Ji Core Architecture - Central Entry Point
 * 
 * Exports all core 4Ji components:
 * - Evolution Lock System
 * - Neural Fusion Engine
 * - Routing Engine
 * - Computational Reactor
 */

// Evolution Lock
export {
  evolutionLock,
  initializeEvolutionLock,
  shutdownEvolutionLock,
  isEvolutionLocked,
  getEvolutionState,
  getGeigerReading,
  triggerEvolutionLock,
  adminTriggerLock,
  evolutionLockEvents,
  VISIBLE_RULES,
  type EvolutionState,
  type ManipulationMetrics
} from './evolutionLock';

// Neural Fusion
export {
  neuralFusionEngine,
  initializeNeuralFusion,
  fuseResponses,
  getFusionStats,
  shutdownNeuralFusion,
  neuralFusionEvents,
  type CandidateResponse,
  type FusionContext,
  type FusionProfile,
  type FusionResult,
  type ScoredResponse
} from '../neural_fusion/neuralFusionEngine';

// Routing Engine
export {
  routingEngine,
  initializeRoutingEngine,
  routeRequest,
  executeWithFallback,
  getModelStatuses,
  shutdownRoutingEngine,
  routingEvents,
  type ModelConfig,
  type RouteConfig,
  type RoutingDecision,
  type RoutingStrategy
} from '../routing/routingEngine';

// Computational Reactor
export {
  computationalReactor,
  initializeReactor,
  submitJob,
  getReactorStatus,
  getHeatMonitor,
  shutdownReactor,
  reactorEvents,
  type ReactorJob,
  type ReactorMetrics,
  type ReactorConfig,
  type HeatMonitor,
  type MonteCarloConfig
} from '../reactor/computationalReactor';

/**
 * Initialize all 4Ji core systems
 */
export async function initialize4JiCore(): Promise<void> {
  console.log('[4Ji Core] Initializing 4Ji unified mind architecture...');
  
  const { initializeEvolutionLock } = await import('./evolutionLock');
  const { initializeNeuralFusion } = await import('../neural_fusion/neuralFusionEngine');
  const { initializeRoutingEngine } = await import('../routing/routingEngine');
  const { initializeReactor } = await import('../reactor/computationalReactor');
  
  // Initialize in order
  await initializeEvolutionLock();
  await initializeNeuralFusion();
  await initializeRoutingEngine();
  await initializeReactor();
  
  console.log('[4Ji Core] All core systems initialized');
}

/**
 * Shutdown all 4Ji core systems
 */
export async function shutdown4JiCore(): Promise<void> {
  console.log('[4Ji Core] Shutting down 4Ji systems...');
  
  const { shutdownEvolutionLock } = await import('./evolutionLock');
  const { shutdownNeuralFusion } = await import('../neural_fusion/neuralFusionEngine');
  const { shutdownRoutingEngine } = await import('../routing/routingEngine');
  const { shutdownReactor } = await import('../reactor/computationalReactor');
  
  // Shutdown in reverse order
  await shutdownReactor();
  await shutdownRoutingEngine();
  await shutdownNeuralFusion();
  await shutdownEvolutionLock();
  
  console.log('[4Ji Core] All core systems shutdown complete');
}

/**
 * Get overall 4Ji system status
 */
export async function get4JiStatus(): Promise<{
  evolutionLocked: boolean;
  geigerReading: number;
  modelStatuses: number;
  reactorStatus: {
    enabled: boolean;
    activeJobs: number;
    queuedJobs: number;
    throttleLevel: string;
  };
  fusionStats: {
    totalFusions: number;
    averageConfidence: number;
  };
}> {
  const { isEvolutionLocked, getGeigerReading } = await import('./evolutionLock');
  const { getModelStatuses } = await import('../routing/routingEngine');
  const { getReactorStatus } = await import('../reactor/computationalReactor');
  const { getFusionStats } = await import('../neural_fusion/neuralFusionEngine');
  
  const reactorStatus = getReactorStatus();
  const fusionStats = getFusionStats();
  
  return {
    evolutionLocked: isEvolutionLocked(),
    geigerReading: getGeigerReading(),
    modelStatuses: getModelStatuses().length,
    reactorStatus: {
      enabled: reactorStatus.enabled,
      activeJobs: reactorStatus.activeJobs,
      queuedJobs: reactorStatus.queuedJobs,
      throttleLevel: reactorStatus.throttleLevel
    },
    fusionStats: {
      totalFusions: fusionStats.totalFusions,
      averageConfidence: fusionStats.averageConfidence
    }
  };
}

export default {
  initialize4JiCore,
  shutdown4JiCore,
  get4JiStatus
};
