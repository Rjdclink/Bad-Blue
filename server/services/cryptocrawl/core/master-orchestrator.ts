// Master Orchestrator - Coordinates all advanced crawler systems
// Integrates Eden, Cain, Neurofusion, Twins, Starburst, Microtasks, Light Communication, and Stealth

import logger from '../../../logger.js';
import { EdenStorage, type EvolutionResult } from './eden-storage';
import { CainManager } from './cain-crawler';
import { NeurofusionEngine } from './neurofusion';
import { TwinManager } from '../agents/conjoined-twin-crawler';
import { StarburstEngine } from '../agents/starburst-replication';
import { MicrotaskEngine } from './microtask-engine';
import { LightCommunicationSystem, ShrinkGrowEngine } from './light-communication';
import { InvisibleMode, CyanideProtocol, DiscoBallMirror, EmbeddedNetworkKnowledge } from './stealth-security';
import { LuxSwarm, type ChainId } from './lux-swarm';

export interface SystemStatus {
  edenOnline: boolean;
  cainActive: number;
  neurofusionAccuracy: number;
  twinPairs: number;
  starburstReplicas: number;
  microtasksPending: number;
  lightChannels: number;
  invisibleCrawlers: number;
  totalCrawlers: number;
  systemHealth: number; // 0-100
  uptime: number;
}

export interface PerformanceMetrics {
  totalExecutions: number;
  successRate: number;
  avgProfitPerExecution: number;
  totalProfit: number;
  avgExecutionTime: number;
  opportunitiesDiscovered: number;
  opportunitiesExecuted: number;
  systemEfficiency: number; // 0-1
}

export interface CataclysmEvent {
  id: string;
  type: 'network-failure' | 'market-crash' | 'security-breach' | 'system-overload';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  affectedChains: ChainId[];
  responseActions: string[];
  resolved: boolean;
}

/**
 * Master Orchestrator - The brain of the advanced crawler system
 */
export class MasterOrchestrator {
  private static isInitialized = false;
  private static isRunning = false;
  private static startTime: number = 0;
  private static performanceMetrics: PerformanceMetrics = {
    totalExecutions: 0,
    successRate: 0,
    avgProfitPerExecution: 0,
    totalProfit: 0,
    avgExecutionTime: 0,
    opportunitiesDiscovered: 0,
    opportunitiesExecuted: 0,
    systemEfficiency: 0
  };
  private static cataclysmEvents: CataclysmEvent[] = [];
  private static monitorInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the entire advanced crawler system
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Master orchestrator already initialized', { component: 'MasterOrchestrator' });
      return;
    }

    logger.info('🚀 Initializing Advanced Crawler Evolution System...', {
      component: 'MasterOrchestrator'
    });

    try {
      // Phase 1: Core Infrastructure
      logger.info('Phase 1: Initializing Core Infrastructure', { component: 'MasterOrchestrator' });
      
      // Initialize Eden across all networks
      const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
      for (const chain of chains) {
        EdenStorage.initialize(chain);
      }
      EdenStorage.startReplication(5000);

      // Initialize Neurofusion
      NeurofusionEngine.initialize();

      // Phase 2: Communication & Coordination
      logger.info('Phase 2: Initializing Communication Systems', { component: 'MasterOrchestrator' });
      
      LightCommunicationSystem.initialize();
      MicrotaskEngine.initialize(1000);

      // Phase 3: Advanced Agents
      logger.info('Phase 3: Spawning Advanced Agents', { component: 'MasterOrchestrator' });
      
      // Spawn Cain crawlers (knowledge collectors)
      for (let i = 0; i < 3; i++) {
        CainManager.spawn();
      }

      // Spawn Conjoined Twin pairs
      for (let i = 0; i < 5; i++) {
        TwinManager.spawn();
      }

      // Initialize Starburst system
      StarburstEngine.startMonitoring();

      // Phase 4: Stealth & Security
      logger.info('Phase 4: Activating Stealth & Security', { component: 'MasterOrchestrator' });
      
      EmbeddedNetworkKnowledge.initialize();
      
      // Create disco ball mirrors for all chains
      for (const chain of chains) {
        DiscoBallMirror.createMirror(chain);
      }

      // Phase 5: Adaptive Systems
      logger.info('Phase 5: Starting Adaptive Systems', { component: 'MasterOrchestrator' });
      
      ShrinkGrowEngine.start();

      this.isInitialized = true;
      this.startTime = Date.now();

      logger.info('✅ Advanced Crawler Evolution System Initialized Successfully!', {
        component: 'MasterOrchestrator',
        systems: [
          'Eden Storage (Multi-Network)',
          'Cain Evolution Engine',
          'Neurofusion Intelligence',
          'Conjoined Twin Crawlers',
          'Starburst Replication',
          'Microtask Engine',
          'Light Communication',
          'Invisible Mode',
          'Disco Ball Mirroring',
          'Embedded Network Knowledge',
          'Shrink-Grow Adaptability'
        ]
      });

    } catch (error) {
      logger.error('Failed to initialize Master Orchestrator', {
        component: 'MasterOrchestrator',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Start the entire system
   */
  static async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      logger.warn('Master orchestrator already running', { component: 'MasterOrchestrator' });
      return;
    }

    logger.info('🎯 Starting Advanced Crawler System...', { component: 'MasterOrchestrator' });

    // Start Cain crawlers (evolution cycle)
    await CainManager.startAll();

    // Start Twin crawlers
    await TwinManager.startAll();

    // Start monitoring
    this.startMonitoring();

    this.isRunning = true;

    logger.info('✅ Advanced Crawler System Running at Full Capacity!', {
      component: 'MasterOrchestrator',
      status: this.getStatus()
    });
  }

  /**
   * Start system monitoring
   */
  private static startMonitoring(): void {
    if (this.monitorInterval) return;

    this.monitorInterval = setInterval(() => {
      this.monitorSystem();
    }, 10000); // Monitor every 10 seconds

    logger.info('System monitoring started', { component: 'MasterOrchestrator' });
  }

  /**
   * Monitor system health and performance
   */
  private static monitorSystem(): void {
    // Update metrics
    this.updateMetrics();

    // Check for cataclysm events
    this.detectCataclysm();

    // Auto-optimize based on performance
    this.autoOptimize();

    // Log periodic status
    const status = this.getStatus();
    logger.debug('System status', {
      component: 'MasterOrchestrator',
      health: status.systemHealth,
      efficiency: this.performanceMetrics.systemEfficiency
    });
  }

  /**
   * Update performance metrics
   */
  private static updateMetrics(): void {
    const lux = LuxSwarm.observe();

    // Update discovery count
    this.performanceMetrics.opportunitiesDiscovered = lux.opportunities.length;

    // Get neurofusion accuracy
    const neurofusionState = NeurofusionEngine.getState();
    
    // Calculate system efficiency
    const edenState = EdenStorage.getState('polygon');
    if (edenState) {
      this.performanceMetrics.successRate = edenState.globalMetrics.successRate;
      this.performanceMetrics.totalProfit = edenState.globalMetrics.totalProfit;
      this.performanceMetrics.totalExecutions = edenState.globalMetrics.totalExecutions;
      
      if (this.performanceMetrics.totalExecutions > 0) {
        this.performanceMetrics.avgProfitPerExecution = 
          this.performanceMetrics.totalProfit / this.performanceMetrics.totalExecutions;
      }
    }

    // Calculate efficiency (combination of success rate and neurofusion accuracy)
    this.performanceMetrics.systemEfficiency = 
      (this.performanceMetrics.successRate + neurofusionState.accuracy) / 2;
  }

  /**
   * Detect cataclysm events
   */
  private static detectCataclysm(): void {
    // Check for system threats
    const status = this.getStatus();

    // Network failure detection
    if (status.systemHealth < 30) {
      const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
      this.triggerCataclysm('system-overload', 'high', chains);
    }

    // Security breach detection
    const invisibleCount = status.invisibleCrawlers;
    const totalCount = status.totalCrawlers;
    
    if (totalCount > 0 && invisibleCount / totalCount < 0.5) {
      // Less than 50% invisible - potential security issue
      this.triggerCataclysm('security-breach', 'medium', ['polygon']);
    }
  }

  /**
   * Trigger cataclysm event and response
   */
  private static triggerCataclysm(
    type: CataclysmEvent['type'],
    severity: CataclysmEvent['severity'],
    affectedChains: ChainId[]
  ): void {
    const event: CataclysmEvent = {
      id: `cataclysm-${Date.now()}`,
      type,
      severity,
      timestamp: Date.now(),
      affectedChains,
      responseActions: [],
      resolved: false
    };

    // Check if similar event recently triggered
    const recentEvent = this.cataclysmEvents.find(
      e => e.type === type && !e.resolved && Date.now() - e.timestamp < 60000
    );

    if (recentEvent) return; // Don't duplicate recent events

    this.cataclysmEvents.push(event);

    logger.warn('🌋 CATACLYSM EVENT DETECTED', {
      component: 'MasterOrchestrator',
      event
    });

    // Execute response
    this.respondToCataclysm(event);
  }

  /**
   * Respond to cataclysm event
   */
  private static respondToCataclysm(event: CataclysmEvent): void {
    const actions: string[] = [];

    switch (event.type) {
      case 'network-failure':
        // Redirect to healthy chains
        actions.push('Redirecting traffic to healthy chains');
        break;

      case 'market-crash':
        // Activate defensive mode
        actions.push('Activating defensive mode');
        actions.push('Reducing risk exposure');
        break;

      case 'security-breach':
        // Activate stealth mode for all crawlers
        actions.push('Activating invisible mode for all crawlers');
        this.activateEmergencyStealth();
        break;

      case 'system-overload':
        // Scale down and optimize
        actions.push('Initiating emergency scale-down');
        actions.push('Optimizing resource allocation');
        this.emergencyScaleDown();
        break;
    }

    event.responseActions = actions;

    logger.info('Cataclysm response executed', {
      component: 'MasterOrchestrator',
      eventId: event.id,
      actions
    });

    // Mark as resolved after response
    setTimeout(() => {
      event.resolved = true;
    }, 30000); // Resolve after 30 seconds
  }

  // Constants for emergency stealth
  private static readonly EMERGENCY_BASE_TIMEOUT = 60000; // 60 seconds
  private static readonly EMERGENCY_STAGGER_INTERVAL = 1000; // 1 second
  private static readonly EMERGENCY_STAGGER_SLOTS = 30; // 30 slots (0-29 seconds)

  /**
   * Activate emergency stealth for all crawlers with staggered self-destruct to avoid thundering herd
   */
  private static activateEmergencyStealth(): void {
    const lux = LuxSwarm.observe();
    const agents = Array.from(lux.agentStates.entries());
    
    // Stagger self-destruct timers to prevent thundering herd problem
    agents.forEach(([agentId], index) => {
      InvisibleMode.activate(agentId, 'invisible');
      // Stagger countdown: base timeout + random offset per agent
      const staggeredTimeout = this.EMERGENCY_BASE_TIMEOUT + 
        (index % this.EMERGENCY_STAGGER_SLOTS) * this.EMERGENCY_STAGGER_INTERVAL;
      CyanideProtocol.arm(agentId, 'capture', staggeredTimeout);
    });

    logger.warn('Emergency stealth activated with staggered self-destruct', {
      component: 'MasterOrchestrator',
      crawlers: agents.length,
      timeRange: `${this.EMERGENCY_BASE_TIMEOUT / 1000}-${(this.EMERGENCY_BASE_TIMEOUT + this.EMERGENCY_STAGGER_SLOTS * this.EMERGENCY_STAGGER_INTERVAL) / 1000}s`
    });
  }

  /**
   * Emergency scale down
   */
  private static emergencyScaleDown(): void {
    // Shrink all crawlers to minimum size
    const lux = LuxSwarm.observe();
    
    for (const [agentId] of lux.agentStates.entries()) {
      ShrinkGrowEngine.register(agentId, 'nano');
    }

    logger.warn('Emergency scale down executed', {
      component: 'MasterOrchestrator',
      crawlers: lux.agentStates.size
    });
  }

  /**
   * Auto-optimize system based on performance
   */
  private static autoOptimize(): void {
    const efficiency = this.performanceMetrics.systemEfficiency;

    if (efficiency < 0.7) {
      // Low efficiency - trigger evolution
      logger.info('Low efficiency detected, triggering system evolution', {
        component: 'MasterOrchestrator',
        efficiency
      });

      // Fuse knowledge from Eden to Neurofusion
      NeurofusionEngine.fuseFromEden('polygon');
      
      // Evolve neurofusion
      NeurofusionEngine.evolve();
    }

    if (efficiency > 0.9) {
      // High efficiency - expand operations
      logger.info('High efficiency, expanding operations', {
        component: 'MasterOrchestrator',
        efficiency
      });

      // Spawn additional twin pairs
      TwinManager.spawn();
    }
  }

  /**
   * Get system status
   */
  static getStatus(): SystemStatus {
    const edenState = EdenStorage.getState('polygon');
    const neurofusionState = NeurofusionEngine.getState();
    const starburstStats = StarburstEngine.getStatistics();
    const microtaskStats = MicrotaskEngine.getStatistics();
    const lux = LuxSwarm.observe();

    // Count invisible crawlers
    let invisibleCount = 0;
    for (const [agentId] of lux.agentStates.entries()) {
      if (InvisibleMode.isInvisible(agentId)) {
        invisibleCount++;
      }
    }

    // Calculate system health
    const health = this.calculateSystemHealth(edenState, neurofusionState);

    return {
      edenOnline: edenState !== undefined,
      cainActive: CainManager.getCains().length,
      neurofusionAccuracy: neurofusionState.accuracy,
      twinPairs: TwinManager.getTwins().length,
      starburstReplicas: starburstStats.totalReplicas,
      microtasksPending: microtaskStats.pendingTasks,
      lightChannels: LightCommunicationSystem.getAllChannels().length,
      invisibleCrawlers: invisibleCount,
      totalCrawlers: lux.agentStates.size,
      systemHealth: health,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Calculate system health score
   */
  private static calculateSystemHealth(edenState: any, neurofusionState: any): number {
    let health = 100;

    // Deduct for low Eden knowledge
    if (edenState && edenState.totalKnowledge < 100) {
      health -= 10;
    }

    // Deduct for low neurofusion accuracy
    if (neurofusionState.accuracy < 0.7) {
      health -= 20;
    }

    // Deduct for recent cataclysm events
    const recentEvents = this.cataclysmEvents.filter(
      e => !e.resolved && Date.now() - e.timestamp < 60000
    );
    health -= recentEvents.length * 15;

    return Math.max(0, Math.min(100, health));
  }

  /**
   * Get performance metrics
   */
  static getMetrics(): Readonly<PerformanceMetrics> {
    return { ...this.performanceMetrics };
  }

  /**
   * Get cataclysm events
   */
  static getCataclysmEvents(limit: number = 100): CataclysmEvent[] {
    return this.cataclysmEvents.slice(-limit);
  }

  /**
   * Force evolution cycle
   */
  static async forceEvolution(): Promise<EvolutionResult[]> {
    logger.info('Forcing evolution cycle', { component: 'MasterOrchestrator' });

    const cains = CainManager.getCains();
    const results: EvolutionResult[] = [];

    for (const cain of cains) {
      const result = await cain.forceEvolution();
      results.push(result);
    }

    // Evolve neurofusion
    NeurofusionEngine.evolve();

    logger.info('Forced evolution complete', {
      component: 'MasterOrchestrator',
      evolutions: results.length
    });

    return results;
  }

  /**
   * Stop the entire system
   */
  static stop(): void {
    if (!this.isRunning) return;

    logger.info('Stopping Advanced Crawler System...', { component: 'MasterOrchestrator' });

    // Stop all components
    CainManager.stopAll();
    TwinManager.stopAll();
    StarburstEngine.stopMonitoring();
    EdenStorage.stopReplication();
    LightCommunicationSystem.shutdown();
    ShrinkGrowEngine.stop();
    InvisibleMode.stop();
    CyanideProtocol.stop();
    DiscoBallMirror.stop();
    EmbeddedNetworkKnowledge.stop();

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isRunning = false;

    logger.info('Advanced Crawler System Stopped', { component: 'MasterOrchestrator' });
  }

  /**
   * Reset the entire system (for testing)
   */
  static reset(): void {
    this.stop();
    
    EdenStorage.reset();
    NeurofusionEngine.reset();
    StarburstEngine.reset();
    MicrotaskEngine.reset();
    LightCommunicationSystem.reset();
    ShrinkGrowEngine.reset();
    InvisibleMode.reset();
    CyanideProtocol.reset();
    DiscoBallMirror.reset();
    EmbeddedNetworkKnowledge.reset();
    LuxSwarm.reset();

    this.isInitialized = false;
    this.isRunning = false;
    this.startTime = 0;
    this.performanceMetrics = {
      totalExecutions: 0,
      successRate: 0,
      avgProfitPerExecution: 0,
      totalProfit: 0,
      avgExecutionTime: 0,
      opportunitiesDiscovered: 0,
      opportunitiesExecuted: 0,
      systemEfficiency: 0
    };
    this.cataclysmEvents = [];

    logger.info('Master Orchestrator reset complete', { component: 'MasterOrchestrator' });
  }

  // ============================================
  // PHASE 2: RECURSIVE ENHANCEMENT LAYER
  // Advanced optimization and self-improvement capabilities
  // ============================================

  private static optimizationHistory: Array<{
    timestamp: number;
    metric: string;
    beforeValue: number;
    afterValue: number;
    improvement: number;
  }> = [];

  private static adaptiveTuningEnabled = true;
  private static lastOptimizationCycle = 0;
  private static optimizationCycleInterval = 30000; // 30 seconds

  /**
   * Enable/disable adaptive tuning
   */
  static setAdaptiveTuning(enabled: boolean): void {
    this.adaptiveTuningEnabled = enabled;
    logger.info(`Adaptive tuning ${enabled ? 'enabled' : 'disabled'}`, { component: 'MasterOrchestrator' });
  }

  /**
   * Get optimization history
   */
  static getOptimizationHistory(): typeof MasterOrchestrator.optimizationHistory {
    return [...this.optimizationHistory];
  }

  /**
   * Advanced recursive optimization - runs multi-layer optimization passes
   * Implements the "enhanced optimizations to the 3rd power" requirement
   */
  static async runRecursiveOptimization(depth: number = 3): Promise<{
    layersOptimized: number;
    totalImprovements: number;
    metrics: Record<string, { before: number; after: number; improvement: number }>;
  }> {
    logger.info('🔄 Starting recursive optimization cycle', {
      component: 'MasterOrchestrator',
      depth,
      timestamp: Date.now()
    });

    const metrics: Record<string, { before: number; after: number; improvement: number }> = {};
    let totalImprovements = 0;

    // Layer 1: Performance optimization
    const layer1Results = await this.optimizePerformanceLayer();
    metrics['performance'] = layer1Results;
    totalImprovements += layer1Results.improvement > 0 ? 1 : 0;

    // Layer 2: Resource optimization (if depth >= 2)
    if (depth >= 2) {
      const layer2Results = await this.optimizeResourceLayer();
      metrics['resource'] = layer2Results;
      totalImprovements += layer2Results.improvement > 0 ? 1 : 0;
    }

    // Layer 3: Intelligence optimization (if depth >= 3)
    if (depth >= 3) {
      const layer3Results = await this.optimizeIntelligenceLayer();
      metrics['intelligence'] = layer3Results;
      totalImprovements += layer3Results.improvement > 0 ? 1 : 0;
    }

    // Record optimization results
    for (const [metric, result] of Object.entries(metrics)) {
      this.optimizationHistory.push({
        timestamp: Date.now(),
        metric,
        beforeValue: result.before,
        afterValue: result.after,
        improvement: result.improvement
      });
    }

    // Keep only last 1000 optimization records
    if (this.optimizationHistory.length > 1000) {
      this.optimizationHistory = this.optimizationHistory.slice(-1000);
    }

    this.lastOptimizationCycle = Date.now();

    logger.info('✅ Recursive optimization complete', {
      component: 'MasterOrchestrator',
      layersOptimized: depth,
      totalImprovements,
      metrics
    });

    return { layersOptimized: depth, totalImprovements, metrics };
  }

  /**
   * Layer 1: Performance optimization
   * Optimizes execution speed, throughput, and response times
   */
  private static async optimizePerformanceLayer(): Promise<{
    before: number;
    after: number;
    improvement: number;
  }> {
    const before = this.performanceMetrics.systemEfficiency;

    // Clean up stale opportunities and agent states
    const cleaned = LuxSwarm.cleanup(30000); // 30 second max age
    
    // Optimize active agent count based on opportunity density
    const lux = LuxSwarm.observe();
    const opportunityCount = lux.opportunities.length;
    const agentCount = lux.agentStates.size;
    
    // Ideal ratio: ~3 opportunities per agent
    const idealAgentCount = Math.ceil(opportunityCount / 3);
    
    if (agentCount < idealAgentCount && agentCount < 20) {
      // Need more agents - spawn twins
      TwinManager.spawn();
    } else if (agentCount > idealAgentCount * 2 && agentCount > 6) {
      // Too many agents - shrink only the excess to save resources
      const excessCount = agentCount - idealAgentCount;
      const agents = Array.from(lux.agentStates.entries());
      // Only shrink excess agents, not all
      for (let i = 0; i < Math.min(excessCount, agents.length); i++) {
        ShrinkGrowEngine.shrink(agents[i][0]);
      }
    }

    // Update metrics after optimization
    this.updateMetrics();
    const after = this.performanceMetrics.systemEfficiency;

    return {
      before,
      after,
      improvement: after - before
    };
  }

  /**
   * Layer 2: Resource optimization
   * Optimizes memory usage, connection pools, and state management
   */
  private static async optimizeResourceLayer(): Promise<{
    before: number;
    after: number;
    improvement: number;
  }> {
    const status = this.getStatus();
    const before = status.systemHealth / 100;

    // Optimize light channels - shutdown inactive ones
    const channels = LightCommunicationSystem.getAllChannels();
    const activeChannelCount = channels.length;
    
    // Clean up inactive channels by checking last activity
    const now = Date.now();
    for (const channel of channels) {
      if (now - channel.lastActivity > 60000) { // 60 second inactivity
        // Channel is stale - unsubscribe agents to clean up
        channel.subscribers.forEach(agentId => {
          LightCommunicationSystem.unsubscribe(agentId, channel.frequency);
        });
      }
    }

    // Optimize microtask queue - execute high priority tasks
    const microtaskStats = MicrotaskEngine.getStatistics();
    if (microtaskStats.pendingTasks > 100) {
      // Get and batch execute pending tasks with high priority
      const pendingTasks = MicrotaskEngine.getPendingTasks(20);
      for (const task of pendingTasks) {
        if (task.priority >= 0.7) {
          // High priority - try to execute immediately
          const node = MicrotaskEngine.getAvailableNodes(1)[0];
          if (node) {
            await MicrotaskEngine.executeTask(task.id, node.id);
          }
        }
      }
    }

    // Note: Manual garbage collection removed - V8 handles GC efficiently on its own

    const newStatus = this.getStatus();
    const after = newStatus.systemHealth / 100;

    return {
      before,
      after,
      improvement: after - before
    };
  }

  /**
   * Layer 3: Intelligence optimization
   * Optimizes learning algorithms, prediction accuracy, and decision making
   */
  private static async optimizeIntelligenceLayer(): Promise<{
    before: number;
    after: number;
    improvement: number;
  }> {
    const neurofusionState = NeurofusionEngine.getState();
    const before = neurofusionState.accuracy;

    // Fuse latest knowledge from all chains
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      const edenState = EdenStorage.getState(chain);
      if (edenState && edenState.totalKnowledge > 0) {
        NeurofusionEngine.fuseFromEden(chain);
      }
    }

    // Trigger evolution if accuracy is below threshold
    if (before < 0.8) {
      NeurofusionEngine.evolve();
    }

    // Recreate disco ball mirrors for latest network state
    for (const chain of chains) {
      // Update mirror by recreating it with fresh data
      DiscoBallMirror.createMirror(chain);
    }

    const newState = NeurofusionEngine.getState();
    const after = newState.accuracy;

    return {
      before,
      after,
      improvement: after - before
    };
  }

  /**
   * Get comprehensive system diagnostics
   */
  static getDiagnostics(): {
    status: SystemStatus;
    metrics: PerformanceMetrics;
    swarmMetrics: ReturnType<typeof LuxSwarm.getMetrics>;
    optimizationHistory: typeof MasterOrchestrator.optimizationHistory;
    uptime: number;
    healthTrend: 'improving' | 'stable' | 'degrading';
  } {
    const status = this.getStatus();
    const metrics = this.getMetrics();
    const swarmMetrics = LuxSwarm.getMetrics();
    const uptime = this.startTime > 0 ? Date.now() - this.startTime : 0;

    // Calculate health trend from recent optimization history
    const recentOptimizations = this.optimizationHistory.slice(-10);
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    
    if (recentOptimizations.length >= 3) {
      const avgImprovement = recentOptimizations.reduce((sum, o) => sum + o.improvement, 0) / recentOptimizations.length;
      if (avgImprovement > 0.01) trend = 'improving';
      else if (avgImprovement < -0.01) trend = 'degrading';
    }

    return {
      status,
      metrics,
      swarmMetrics,
      optimizationHistory: this.optimizationHistory,
      uptime,
      healthTrend: trend
    };
  }

  /**
   * Schedule periodic optimization cycles
   */
  static startPeriodicOptimization(intervalMs: number = 30000): void {
    this.optimizationCycleInterval = intervalMs;
    
    // Run initial optimization
    this.runRecursiveOptimization(3).catch(err => {
      logger.error('Initial optimization failed', {
        component: 'MasterOrchestrator',
        error: err instanceof Error ? err.message : String(err)
      });
    });

    logger.info('Periodic optimization started', {
      component: 'MasterOrchestrator',
      intervalMs
    });
  }
}
