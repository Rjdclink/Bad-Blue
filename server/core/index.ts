/**
 * 4Ji Core Architecture - Central Entry Point
 * 
 * Exports all core 4Ji components:
 * - Evolution Lock System
 * - Neural Fusion Engine
 * - Routing Engine
 * - Computational Reactor
 * - Lexara Power System (PowerSpine, PowerReactor, PowerMesh, Heartline)
 * - API Optimizer (Semantic caching, deduplication, batching, coherency)
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

// API Optimizer
export {
  getAPIOptimizer,
  shutdownAPIOptimizer,
  APIOptimizer,
  SemanticCache,
  RequestBatcher,
  CoherencyManager,
  type OptimizedRequest,
  type OptimizationResult,
  type BatchedRequest,
  type CoherencyState
} from './apiOptimizer';

// Database Cache
export {
  getDatabaseCache,
  shutdownDatabaseCache,
  TTL_PRESETS,
  type CachedQuery,
  type DbCacheStats
} from './databaseCache';

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

// Lexara Power System
export {
  // Power System Main
  initializeLexaraPowerSystem,
  shutdownLexaraPowerSystem,
  getPowerSystemStatus,
  getPowerSystemHealth,
  type PowerSystemStatus,
  
  // PowerSpine
  powerSpine,
  initializePowerSpine,
  requestCompute,
  releaseCompute,
  ensureStability,
  reportHealth,
  activateBurstMode,
  getQueueStatus,
  shutdownPowerSpine,
  powerSpineEvents,
  type TaskPriority,
  type ComputeTask,
  type SpineHealth,
  type ThrottleLevel,
  type SpineConfig,
  
  // PowerReactor
  powerReactor,
  initializePowerReactor,
  amplify,
  refine,
  boostIfNeeded,
  queueForBackgroundRefinement,
  getReactorStats,
  shutdownPowerReactor,
  reactorEvents as powerReactorEvents,
  type TaskContext,
  type AmplificationResult,
  type RefinementResult,
  type ReactorStats as PowerReactorStats,
  type ReactorConfig as PowerReactorConfig,
  type PowerLevel,
  
  // PowerMesh
  powerMesh,
  initializePowerMesh,
  fuseRequest,
  getPowerMeshHealth,
  getConnectorStatuses,
  setConnectorStatus,
  shutdownPowerMesh,
  powerMeshEvents,
  type ModelProvider,
  type ModelConnector,
  type FusionRequest,
  type FusionStrategy,
  type FusionResult as PowerFusionResult,
  type PowerMeshHealth,
  type PowerMeshConfig,
  
  // Heartline
  heartline,
  initializeHeartline,
  defineIdentity,
  getIdentity,
  isOwner,
  maintainContinuity,
  recordTask,
  updateTaskProgress,
  pauseTask,
  resumeTask,
  completeTask,
  stabilizeEmotion,
  getEmotionalState,
  governReasoning,
  getHeartlineStatus,
  shutdownHeartline,
  heartlineEvents,
  type LexaraIdentity,
  type PersonalityTraits,
  type OwnerProfile,
  type TaskMemory,
  type TaskCheckpoint,
  type EmotionalState,
  type EmotionType,
  type ReasoningCheck,
  type HeartlineStatus,
  type HeartlineConfig
} from './power';

/**
 * Initialize all 4Ji core systems
 */
export async function initialize4JiCore(): Promise<void> {
  console.log('[4Ji Core] Initializing 4Ji unified mind architecture...');
  
  const { initializeEvolutionLock } = await import('./evolutionLock');
  const { initializeNeuralFusion } = await import('../neural_fusion/neuralFusionEngine');
  const { initializeRoutingEngine } = await import('../routing/routingEngine');
  const { initializeReactor } = await import('../reactor/computationalReactor');
  const { initializeLexaraPowerSystem } = await import('./power');
  
  // Initialize in order
  await initializeEvolutionLock();
  await initializeNeuralFusion();
  await initializeRoutingEngine();
  await initializeReactor();
  
  // Initialize Lexara Power System (order matters: Spine → Reactor → Mesh → Heartline)
  await initializeLexaraPowerSystem();
  
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
  const { shutdownLexaraPowerSystem } = await import('./power');
  const { shutdownAPIOptimizer } = await import('./apiOptimizer');
  const { shutdownDatabaseCache } = await import('./databaseCache');
  
  // Shutdown in reverse order
  // Shutdown API Optimizer and Database Cache
  shutdownAPIOptimizer();
  shutdownDatabaseCache();
  
  // Shutdown Lexara Power System first (most dependent)
  await shutdownLexaraPowerSystem();
  
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
  powerSystem: {
    initialized: boolean;
    spineStatus: string;
    reactorStatus: string;
    meshStatus: string;
    heartlineStatus: string;
  };
  apiOptimizer: {
    totalRequests: number;
    cacheHits: number;
    savedApiCalls: number;
    savingsPercent: number;
  };
}> {
  const { isEvolutionLocked, getGeigerReading } = await import('./evolutionLock');
  const { getModelStatuses } = await import('../routing/routingEngine');
  const { getReactorStatus } = await import('../reactor/computationalReactor');
  const { getFusionStats } = await import('../neural_fusion/neuralFusionEngine');
  const { getPowerSystemStatus } = await import('./power');
  const { getAPIOptimizer } = await import('./apiOptimizer');
  
  const reactorStatus = getReactorStatus();
  const fusionStats = getFusionStats();
  const powerSystemStatus = getPowerSystemStatus();
  const optimizerMetrics = getAPIOptimizer().getMetrics();
  
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
    },
    powerSystem: {
      initialized: powerSystemStatus.initialized,
      spineStatus: powerSystemStatus.spineStatus,
      reactorStatus: powerSystemStatus.reactorStatus,
      meshStatus: powerSystemStatus.meshStatus,
      heartlineStatus: powerSystemStatus.heartlineStatus
    },
    apiOptimizer: {
      totalRequests: optimizerMetrics.totalRequests,
      cacheHits: optimizerMetrics.cacheHits,
      savedApiCalls: optimizerMetrics.savedApiCalls,
      savingsPercent: optimizerMetrics.savingsPercent,
    }
  };
}

export default {
  initialize4JiCore,
  shutdown4JiCore,
  get4JiStatus
};
