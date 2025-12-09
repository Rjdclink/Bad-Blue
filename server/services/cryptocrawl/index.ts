// Advanced Crawler Evolution System - Main Export
// Complete integration of all revolutionary crawler systems
// Enhanced with Monte Carlo validation, multi-oracle pricing, and advanced risk management

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

// Enhanced Validation & Risk Management Systems (Real-World Ready)
export {
  MonteCarloEngine,
  createMonteCarloEngine,
  MARKET_CONDITIONS,
  type MonteCarloConfig,
  type MarketCondition,
  type SimulationResult,
  type StrengthWeakness,
  type StrategyProfile,
  // NEW: Performance level types for variable results
  type PerformanceLevel,
  type PerformanceBreakdown,
  type ScenarioResults
} from './validation/monte-carlo-engine';

export {
  MultiOraclePriceValidator,
  type OracleConfig,
  type OracleType,
  type PriceData,
  type PriceValidationResult,
  type ManipulationCheck,
  type ValidationDetail
} from './validation/multi-oracle-validator';

export {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type BreakerState,
  type BreakerMetrics,
  type BreakerLevel
} from './risk/circuit-breaker';

export {
  KellyCriterion,
  calculateKellyPosition,
  type KellyParams,
  type PositionSizeResult,
  type HistoricalStats
} from './risk/kelly-criterion';

// Capital-Free Arbitrage Engine (Hyper-Evolved System)
export {
  // Flash Liquidity
  FlashLiquidityLayer,
  flashLiquidityLayer,
  type FlashLoanRoute,
  type MicroLiquidityRequest,
  type LiquidityIntakeResult,
  // Gas Acquisition
  GasAcquisitionSystem,
  gasAcquisitionSystem,
  type GasPoolConfig,
  type GasRequest,
  type GasAcquisitionResult,
  // Partnership Formation
  PartnershipFormationSystem,
  partnershipFormationSystem,
  type Partner,
  type ProfitSharingRoute,
  type MicroAlliance,
  type PartnershipResult,
  // Barter System
  BarterSystem,
  barterSystem,
  type BarterResourceType,
  type BarterResource,
  type BarterOffer,
  type BarterExecution,
  type BarterResult,
  // NexGen Protocol Layer
  NexGenProtocolLayer,
  nexGenProtocolLayer,
  type ProtocolRoute,
  type ProfitProbability,
  type RiskProfile,
  type ExecutionDecision,
  // Eden Placement Strategy
  EdenPlacementStrategy,
  edenPlacementStrategy,
  type NodePlacement,
  type PlacementCluster,
  type PlacementResult,
  // Starburst Scaling
  StarburstScalingSystem,
  starburstScalingSystem,
  type CaneType,
  type Cane,
  type Crawler,
  type StarburstWave,
  type ScalingMetrics,
  // Module info
  CAPITAL_FREE_VERSION,
  CAPITAL_FREE_NAME,
  CAPITAL_FREE_CAPABILITIES,
} from './capital-free';

/**
 * Quick Start Example
 * 
 * ```typescript
 * import { MasterOrchestrator } from './server/services/cryptocrawl';
 * 
 * // Initialize and start the entire advanced crawler system
 * await MasterOrchestrator.initialize();
 * await MasterOrchestrator.start();
 * 
 * // Monitor system status
 * const status = MasterOrchestrator.getStatus();
 * console.log('System Health:', status.systemHealth);
 * console.log('Active Crawlers:', status.totalCrawlers);
 * console.log('Neurofusion Accuracy:', status.neurofusionAccuracy);
 * 
 * // Get performance metrics
 * const metrics = MasterOrchestrator.getMetrics();
 * console.log('Success Rate:', metrics.successRate);
 * console.log('Total Profit:', metrics.totalProfit);
 * 
 * // Force evolution cycle
 * const evolutions = await MasterOrchestrator.forceEvolution();
 * console.log('Evolutions:', evolutions);
 * 
 * // Stop system
 * MasterOrchestrator.stop();
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
 */

export const SYSTEM_VERSION = '3.0.0';
export const SYSTEM_NAME = 'Advanced Crawler Evolution System with Capital-Free Arbitrage';
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
  // v2.0 capabilities
  'Monte Carlo profitability simulation',
  'Multi-oracle price validation',
  'Circuit breaker risk management',
  'Kelly criterion position sizing',
  'Stress testing under extreme conditions',
  'Manipulation detection',
  'Statistical confidence intervals',
  // v3.0 Capital-Free Arbitrage Engine
  'Flash liquidity intake layer',
  'Zero-collateral micro-liquidity',
  'Request-bursting for profitable routes',
  'Same-block flash loan repayment',
  'Autonomous gas acquisition',
  'P2P gas networks',
  'On-chain gas escrows',
  'Flash-gas pools',
  'Autonomous partnership formation',
  'Micro-alliance creation',
  'Profit-sharing routes',
  'Reputation scoring',
  'Bot-to-bot financial barter',
  'Gas-for-routing exchange',
  'Liquidity-for-position barter',
  'NexGen protocol layer',
  'Graph-based discovery',
  'Zero-capital orchestration',
  'Mempool simulation',
  'Auto-rebalancing risk',
  'Eden placement strategy',
  'RPC endpoint optimization',
  'Block builder integration',
  'Starburst scaling system',
  '8-Cane architecture',
  'Crawler bloom waves',
  '100M+ crawler capacity',
];
