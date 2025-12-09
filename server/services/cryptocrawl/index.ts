// Advanced Crawler Evolution System - Main Export
// Complete integration of all revolutionary crawler systems

export { EdenStorage, type KnowledgeEntry, type EvolutionResult, type EdenState } from './core/eden-storage';
export { CainCrawler, CainManager, type CainObservation, type CainMission } from './core/cain-crawler';
export { NeurofusionEngine, type NeuralConnection, type LearningPattern, type CognitiveState } from './core/neurofusion';
export { ConjoinedTwinCrawler, TwinManager, type TwinState, type Decision, type Task } from './agents/conjoined-twin-crawler';
export { StarburstEngine, EnhancedSnakeAgent, type StarburstEvent, type ReplicaAgent } from './agents/starburst-replication';
export { MicrotaskEngine, type Microtask, type MicrotaskNode, type RadialLayer } from './core/microtask-engine';
export { LightCommunicationSystem, ShrinkGrowEngine, type LightSignal, type CrawlerSize } from './core/light-communication';
export { 
  InvisibleMode, 
  CyanideProtocol, 
  DiscoBallMirror, 
  EmbeddedNetworkKnowledge,
  type StealthProfile,
  type SelfDestructProtocol,
  type NetworkMirror,
  type EmbeddedNetworkMap
} from './core/stealth-security';
export { MasterOrchestrator, type SystemStatus, type PerformanceMetrics, type CataclysmEvent } from './core/master-orchestrator';
export { LuxSwarm, type Opportunity, type AgentState, type ChainId, type LuxSignal } from './core/lux-swarm';

// Blockchain API Services (Alchemy + Etherscan)
export {
  BlockchainAPIService,
  AlchemyProvider,
  EtherscanProvider,
  AdvancedRateLimiter,
  blockchainAPI,
  type SupportedChain,
  type EdenRegion,
  type BlockchainProviderConfig,
  type RateLimitConfig,
  type GasData,
  type BlockData,
  type TransactionData,
  type TokenTransfer,
  type ContractVerification
} from './api/blockchain-providers';

// Eden Deployment (Hyper-Local Latency Optimization)
export {
  EdenDeploymentManager,
  edenDeployment,
  RESOURCE_QUOTAS,
  STARBURST_CONFIG,
  type EdenNode,
  type EdenTier,
  type EdenRole,
  type EdenStatus,
  type RegionLatencyProfile,
  type DeploymentStrategy,
  type ResourceQuota,
  type StarburstConfig
} from './eden/deployment';

// Intelligence Systems (Parallel Lanes, Gravity Crawler, Cataclysm Reaper, Six-Cane System)
export {
  ParallelIntelligenceLanes,
  parallelIntelligence,
  GravityCrawler,
  CataclysmReaper,
  gravityCrawler,
  cataclysmReaper,
  SixCaneSystem,
  sixCaneSystem,
  type LaneType,
  type LaneSignal,
  type MergedDecision,
  type LaneConfig,
  type OrderFlowMetrics,
  type LiquidityMetrics,
  type VolatilityMetrics,
  type BotFootprintMetrics,
  type LatencyMetrics,
  type GravityCenter,
  type LiquidityGravityMap,
  type CataclysmType,
  type ReaperStatistics,
  type CaneRole,
  type CaneState,
  type CaneStatus,
  type CaneMetrics,
  type OrchestratorDecision,
  type SwarmCoordinationState
} from './intelligence';

/**
 * Quick Start Example
 * 
 * ```typescript
 * import { MasterOrchestrator, sixCaneSystem, blockchainAPI } from './server/services/cryptocrawl';
 * 
 * // Initialize blockchain API services (Alchemy + Etherscan)
 * await blockchainAPI.initialize(['ethereum', 'polygon', 'arbitrum']);
 * 
 * // Initialize and start the Six Cane System
 * await sixCaneSystem.start();
 * 
 * // Get orchestrated trading decision
 * const decision = await sixCaneSystem.getDecision('polygon', 'ETH');
 * console.log('Decision:', decision.finalDecision);
 * console.log('Confidence:', decision.confidence);
 * console.log('Strategy:', decision.strategy);
 * 
 * // Get system overview
 * const overview = sixCaneSystem.getSystemOverview();
 * console.log('Active Canes:', overview.swarmState.activeCanes);
 * console.log('System Health:', overview.systemHealth.score);
 * 
 * // Stop system
 * sixCaneSystem.stop();
 * await blockchainAPI.destroy();
 * ```
 */

/**
 * System Features:
 * 
 * 1. **Eden Storage** - Multi-network state replication with knowledge persistence
 * 2. **Cain Crawler** - Knowledge collector and evolution engine
 * 3. **Neurofusion** - Instantaneous cognitive integration and learning
 * 4. **Conjoined Twin Crawlers** - Dual-bound agents with perfect synchronization
 * 5. **Starburst Replication** - Explosive agent multiplication on high-value events
 * 6. **Enhanced Snake Shedding** - Autonomous skin shedding for emerging priorities
 * 7. **Microtask Engine** - Infinitely small task subdivision with radial expansion
 * 8. **Light Communication** - Ultra-low bandwidth instant messaging
 * 9. **Shrink-Grow Adaptability** - Dynamic resource optimization
 * 10. **Invisible Mode** - Zero digital trace operation
 * 11. **Cyanide Protocol** - Self-destruct for strategy preservation
 * 12. **Disco Ball Mirroring** - Internal network condition replication
 * 13. **Embedded Network Knowledge** - Real-time network maps
 * 14. **Cataclysm Detection** - Systemic threat awareness and response
 * 15. **Profitability Logic** - Dynamic risk/reward balancing
 * 16. **Master Orchestrator** - Unified system coordination
 * 17. **Blockchain API (Alchemy + Etherscan)** - Dual-layer blockchain access with advanced rate limiting
 * 18. **Eden Deployment** - Hyper-local latency optimization with strategic node placement
 * 19. **Parallel Intelligence Lanes** - 5 parallel signal lanes (Order-Flow, Liquidity, Volatility, Bot-Footprint, Latency-Race)
 * 20. **Gravity Crawler** - Market activity detection and liquidity center tracking
 * 21. **Cataclysm Reaper** - Systemic instability monitoring (flash crashes, liquidation cascades, oracle manipulation)
 * 22. **Six Cane System** - Complete orchestrated swarm intelligence with Grand Orchestrator
 */

export const SYSTEM_VERSION = '2.0.0';
export const SYSTEM_NAME = 'Advanced Crawler Evolution System';
export const CAPABILITIES = [
  'Multi-network Eden storage',
  'Cain evolution engine',
  'Neurofusion intelligence',
  'Conjoined twin crawlers',
  'Starburst replication',
  'Snake skin shedding',
  'Microtask subdivision',
  'Radial expansion',
  'Light communication',
  'Shrink-grow adaptability',
  'Invisible mode',
  'Cyanide self-destruct',
  'Disco ball mirroring',
  'Embedded network knowledge',
  'Cataclysm awareness',
  'Master orchestration',
  // New capabilities
  'Alchemy blockchain access',
  'Etherscan data layer',
  'Advanced rate limiting',
  'Eden hyper-local deployment',
  'Parallel intelligence lanes',
  'Order-flow prediction',
  'Liquidity vision',
  'Volatility pulse',
  'Bot behavioral analysis',
  'Latency race detection',
  'Gravity crawler',
  'Cataclysm reaper',
  'Six cane orchestration',
  'Grand orchestrator decisions'
];
