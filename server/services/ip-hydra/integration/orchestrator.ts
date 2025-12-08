/**
 * IP-HYDRA Integration with CryptoCrawl Hydra Network
 * Enhances the existing blockchain crawler system with intelligent IP/MAC rotation,
 * predictive subnet selection, and comprehensive network stealth capabilities
 */

import { LuxSwarm, type Opportunity, type AgentState, type ChainId } from '../../cryptocrawl/core/lux-swarm';
import { ShadowPool } from '../shadow-swarm/pool';
import { PriorityTaskManager } from '../shadow-swarm/priority-manager';
import { PredictiveSelector } from '../brain/predictive-selector';
import { CooldownController } from '../brain/cooldown-controller';
import { EventLogger } from '../utils/event-logger';
import type { ShadowCrawler, PriorityTask, AssetDetectionEvent } from '../types';

/**
 * Enhanced LuxSignal with IP-HYDRA capabilities
 */
export interface EnhancedLuxSignal {
  // Original LuxSwarm data
  opportunities: Opportunity[];
  agentStates: Map<string, AgentState>;
  blockHeight: Record<ChainId, number>;
  claimed: Set<string>;
  
  // IP-HYDRA enhancements
  shadowPool: Map<string, ShadowCrawler>;
  priorityQueue: PriorityTask[];
  networkIntensity: Record<ChainId, number>;
  cooldownStatus: Record<ChainId, boolean>;
  detectionAlerts: number;
  
  timestamp: number;
}

/**
 * IP-HYDRA Enhanced Orchestrator
 * Integrates shadow crawlers, predictive subnet selection, and stealth capabilities
 * into the existing CryptoCrawl Hydra network
 */
export class IPHydraOrchestrator {
  private shadowPool: ShadowPool;
  private priorityManager: PriorityTaskManager;
  private predictiveSelector: PredictiveSelector;
  private cooldownController: CooldownController;
  private logger: EventLogger;
  private running: boolean = false;
  private startTime?: Date;

  constructor() {
    this.shadowPool = new ShadowPool();
    this.priorityManager = new PriorityTaskManager();
    this.predictiveSelector = new PredictiveSelector();
    this.cooldownController = new CooldownController();
    this.logger = EventLogger.getInstance();
  }

  /**
   * Initialize and start the IP-HYDRA enhanced system
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[IP-HYDRA] System already running');
      return;
    }

    console.log('[IP-HYDRA] 🚀 Starting enhanced Hydra network...');
    
    // Initialize shadow pool
    await this.shadowPool.initialize();
    
    // Start background processes
    this.startHealthMonitoring();
    this.startIntegrationLoop();
    
    this.running = true;
    this.startTime = new Date();
    
    console.log('[IP-HYDRA] ✅ System started successfully');
  }

  /**
   * Stop the IP-HYDRA system
   */
  async stop(): Promise<void> {
    if (!this.running) {
      console.log('[IP-HYDRA] System not running');
      return;
    }

    console.log('[IP-HYDRA] 🛑 Stopping enhanced Hydra network...');
    
    this.running = false;
    
    // Log shutdown event
    await this.logger.logEvent({
      id: this.generateId(),
      type: 'shadow-obsolete',
      crawlerId: 'system',
      metadata: { reason: 'manual-shutdown' },
      timestamp: new Date(),
    });
    
    console.log('[IP-HYDRA] ✅ System stopped');
  }

  /**
   * Integration loop: Enhance LuxSwarm with IP-HYDRA capabilities
   */
  private startIntegrationLoop(): void {
    const processInterval = setInterval(async () => {
      if (!this.running) {
        clearInterval(processInterval);
        return;
      }

      try {
        // Observe current LuxSwarm state
        const luxState = LuxSwarm.observe();
        
        // Process opportunities with shadow crawler assignment
        await this.processOpportunities(luxState.opportunities);
        
        // Update agent states with shadow crawler mapping
        await this.updateAgentShadowMapping(luxState.agentStates);
        
        // Emit enhanced state back to LuxSwarm
        this.emitEnhancedState();
        
      } catch (error) {
        console.error('[IP-HYDRA] Integration loop error:', error);
      }
    }, 1000); // Process every second
  }

  /**
   * Process opportunities and create priority tasks with shadow assignment
   */
  private async processOpportunities(opportunities: Opportunity[]): Promise<void> {
    for (const opp of opportunities) {
      // Create priority task
      const task = this.priorityManager.createTask(
        opp.asset,
        opp.chain,
        opp.profitEstimate * 100, // Convert to 0-100 scale
        opp.priority,
        this.calculateDetectionRisk(opp)
      );

      // Check if task qualifies for preemption
      if (this.priorityManager.isFlashLoanOrArbitrage(task)) {
        const preempted = this.priorityManager.preemptForUrgentTask(task);
        if (preempted.length > 0) {
          await this.logger.logEvent({
            id: this.generateId(),
            type: 'urgency-override',
            crawlerId: 'system',
            chain: opp.chain,
            metadata: { 
              taskId: task.id,
              preempted: preempted.length,
            },
            timestamp: new Date(),
          });
        }
      }

      // Assign shadow crawler with predictive subnet selection
      await this.assignOptimalShadow(task);
    }
  }

  /**
   * Assign optimal shadow crawler to a task using predictive selection
   */
  private async assignOptimalShadow(task: PriorityTask): Promise<void> {
    // Check cooldown status
    const cooledDown = await this.cooldownController.canExecute(
      task.chain,
      task.urgency
    );

    if (!cooledDown) {
      console.log(`[IP-HYDRA] Task ${task.id} delayed due to cooldown`);
      return;
    }

    // Get predictive subnet recommendation
    const prediction = this.predictiveSelector.predictBestSubnet(
      task.chain,
      task.asset
    );

    if (!prediction) {
      console.log(`[IP-HYDRA] No suitable subnet for ${task.chain}/${task.asset}`);
      return;
    }

    console.log(
      `[IP-HYDRA] 🎯 Best subnet for ${task.chain}: ${prediction.subnet} ` +
      `(confidence: ${(prediction.confidence * 100).toFixed(1)}%, ` +
      `latency: ${prediction.estimatedLatency}ms)`
    );

    // Promote shadow crawler
    const shadow = await this.shadowPool.promoteShadow(
      task.chain,
      task.id,
      task.asset
    );

    if (shadow) {
      this.priorityManager.assignTask(task.id, shadow.id);
      
      // Record swap for intensity tracking
      await this.cooldownController.recordSwap(task.chain);
      
      // Start execution monitoring
      this.monitorExecution(shadow, task, prediction.subnet);
    }
  }

  /**
   * Monitor shadow crawler execution and record performance
   */
  private monitorExecution(
    shadow: ShadowCrawler,
    task: PriorityTask,
    subnet: string
  ): void {
    const startTime = Date.now();

    // Simulate execution (in real implementation, monitor actual blockchain execution)
    setTimeout(async () => {
      const latency = Date.now() - startTime;
      const success = Math.random() > 0.2; // 80% success rate

      // Record performance for ML learning
      this.predictiveSelector.recordPerformance(
        subnet,
        task.chain,
        latency,
        success,
        task.asset
      );

      // Complete task
      this.priorityManager.completeTask(task.id, success);

      if (success) {
        console.log(`[IP-HYDRA] ✅ Task ${task.id} completed (${latency}ms)`);
      } else {
        console.log(`[IP-HYDRA] ❌ Task ${task.id} failed - initiating failover`);
        
        // Log detection and swap shadow
        await this.logger.logDetection({
          id: this.generateId(),
          crawlerId: shadow.id,
          type: 'connection-failed',
          severity: 'medium',
          subnet,
          chain: task.chain,
          timestamp: new Date(),
        });

        // Check if crawler should be flagged
        if (this.logger.shouldFlagCrawler(shadow.id)) {
          console.log(`[IP-HYDRA] 🚩 Crawler ${shadow.id} flagged - retiring`);
        }

        // Swap to new shadow
        await this.shadowPool.swapShadow(shadow.id, 'execution-failed');
      }
    }, Math.random() * 2000 + 1000); // 1-3 second execution
  }

  /**
   * Update agent states with shadow crawler mapping
   */
  private async updateAgentShadowMapping(
    agentStates: Map<string, AgentState>
  ): Promise<void> {
    // Map each active agent to its shadow crawler
    for (const [agentId, agent] of agentStates.entries()) {
      if (agent.status === 'executing' || agent.status === 'pursuing') {
        // Check if agent needs shadow support
        const shadows = this.shadowPool.getShadowsByChain(agent.target as ChainId);
        
        // Ensure minimum shadows available
        if (shadows.filter(s => s.status === 'ready').length < 2) {
          console.log(`[IP-HYDRA] ⚠️  Low shadow count for ${agent.target}, creating more`);
          // This will be handled by health check
        }
      }
    }
  }

  /**
   * Emit enhanced state for observability
   */
  private emitEnhancedState(): void {
    const poolHealth = this.shadowPool.getPoolHealth();
    const queueStatus = this.priorityManager.getQueueStatus();

    // Log state for monitoring (can be consumed by dashboard)
    if (Math.random() < 0.1) { // Log 10% of the time to avoid spam
      console.log(
        `[IP-HYDRA] 📊 Pool: ${poolHealth.ready}/${poolHealth.total} ready | ` +
        `Queue: ${queueStatus.queued} queued | ` +
        `Avg latency: ${poolHealth.avgLatency.toFixed(1)}ms`
      );
    }
  }

  /**
   * Health monitoring background process
   */
  private startHealthMonitoring(): void {
    const healthInterval = setInterval(async () => {
      if (!this.running) {
        clearInterval(healthInterval);
        return;
      }

      try {
        // Check shadow pool health
        await this.shadowPool.healthCheck();
        
        // Clear old tasks
        this.priorityManager.clearOldTasks();
        
        // Clear old metrics
        this.predictiveSelector.clearOldMetrics();
        
      } catch (error) {
        console.error('[IP-HYDRA] Health check error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Calculate detection risk for an opportunity
   */
  private calculateDetectionRisk(opp: Opportunity): number {
    // Higher priority = higher detection risk (more competitive)
    // More profit = higher detection risk (more bots watching)
    const priorityRisk = opp.priority * 0.6;
    const profitRisk = opp.profitEstimate * 100 * 0.4;
    return Math.min(100, priorityRisk + profitRisk);
  }

  /**
   * Get system status
   */
  getStatus(): {
    running: boolean;
    uptime: number;
    poolHealth: ReturnType<typeof this.shadowPool.getPoolHealth>;
    queueStatus: ReturnType<typeof this.priorityManager.getQueueStatus>;
    performanceSummary: ReturnType<typeof this.predictiveSelector.getPerformanceSummary>;
    eventStats: ReturnType<typeof this.logger.getStatistics>;
  } {
    return {
      running: this.running,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      poolHealth: this.shadowPool.getPoolHealth(),
      queueStatus: this.priorityManager.getQueueStatus(),
      performanceSummary: this.predictiveSelector.getPerformanceSummary(),
      eventStats: this.logger.getStatistics(),
    };
  }

  /**
   * Create asset detection event and spawn child crawler
   */
  async detectHighValueAsset(
    crawlerId: string,
    assetType: string,
    assetValue: number,
    chain: ChainId,
    urgency: number
  ): Promise<void> {
    const event: AssetDetectionEvent = {
      id: this.generateId(),
      assetType,
      assetValue,
      chain,
      urgency,
      detectionRisk: assetValue * 0.8, // High value = high risk
      timestamp: new Date(),
      crawlerId,
    };

    // Create priority task
    const task = this.priorityManager.createTaskFromDetection(event);

    // Spawn child crawler (Snake-Skin pattern)
    const shadow = this.shadowPool.getShadow(crawlerId);
    if (shadow) {
      const child = await this.shadowPool.spawnChild(crawlerId, assetType);
      if (child) {
        console.log(
          `[IP-HYDRA] 🐍 Spawned child crawler ${child.id} ` +
          `(gen ${child.generation}) for ${assetType}`
        );
        
        // Assign child to task
        this.priorityManager.assignTask(task.id, child.id);
      }
    }
  }

  private generateId(): string {
    return `hydra_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const ipHydraOrchestrator = new IPHydraOrchestrator();
