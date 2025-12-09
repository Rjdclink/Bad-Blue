// Master Orchestrator - Coordinates all advanced crawler systems
// Integrates Eden, Cain, Neurofusion, Twins, Starburst, Microtasks, Light Communication, and Stealth

import logger from '../../../logger.js';
import { EdenStorage, type EvolutionResult } from './eden-storage';
import { CainCrawler, CainManager } from './cain-crawler';
import { NeurofusionEngine } from './neurofusion';
import { ConjoinedTwinCrawler, TwinManager } from '../agents/conjoined-twin-crawler';
import { StarburstEngine } from '../agents/starburst-replication';
import { MicrotaskEngine } from './microtask-engine';
import { LightCommunicationSystem, ShrinkGrowEngine } from './light-communication';
import { InvisibleMode, CyanideProtocol, DiscoBallMirror, EmbeddedNetworkKnowledge } from './stealth-security';
import { LuxSwarm, type Opportunity, type ChainId } from './lux-swarm';

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

  /**
   * Activate emergency stealth for all crawlers
   */
  private static activateEmergencyStealth(): void {
    const lux = LuxSwarm.observe();
    
    for (const [agentId] of lux.agentStates.entries()) {
      InvisibleMode.activate(agentId, 'invisible');
      CyanideProtocol.arm(agentId, 'capture', 60000); // 60 second self-destruct timer
    }

    logger.warn('Emergency stealth activated', {
      component: 'MasterOrchestrator',
      crawlers: lux.agentStates.size
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
}
