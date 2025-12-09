// Starburst Replication - Explosive Agent Multiplication
// Crawlers explode into millions of replicas upon sensing high-value events

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import { LuxSwarm, type Opportunity, type ChainId } from '../core/lux-swarm';
import { EdenStorage } from '../core/eden-storage';

export interface StarburstTrigger {
  type: 'high-value' | 'cascade' | 'emergency' | 'opportunity-surge';
  threshold: number;
  replicationFactor: number; // How many replicas to create
  priority: number;
}

export interface ReplicaAgent {
  id: string;
  parentId: string;
  generation: number;
  role: 'scanner' | 'executor' | 'validator' | 'monitor';
  target: Opportunity;
  status: 'active' | 'completed' | 'failed' | 'dormant';
  spawnTime: number;
  lifetime: number; // ms until auto-termination
  executionCount: number;
}

export interface StarburstEvent {
  id: string;
  triggerType: StarburstTrigger['type'];
  sourceAgent: string;
  replicasCreated: number;
  timestamp: number;
  value: number; // Value that triggered the starburst
  chain: ChainId;
  success: boolean;
}

/**
 * Starburst Engine - Manages explosive agent replication
 */
export class StarburstEngine {
  private static triggers: StarburstTrigger[] = [
    {
      type: 'high-value',
      threshold: 10000, // $10k+ opportunity
      replicationFactor: 100,
      priority: 95
    },
    {
      type: 'opportunity-surge',
      threshold: 10, // 10+ opportunities appear simultaneously
      replicationFactor: 50,
      priority: 85
    },
    {
      type: 'cascade',
      threshold: 5, // Multiple chains with opportunities
      replicationFactor: 200,
      priority: 90
    },
    {
      type: 'emergency',
      threshold: 1, // Manual trigger
      replicationFactor: 1000,
      priority: 100
    }
  ];

  private static replicas = new Map<string, ReplicaAgent>();
  private static events: StarburstEvent[] = [];
  private static maxReplicas = 10000; // 10k replicas max (reduced for memory efficiency)
  private static memoryThresholdMB = 500; // Max 500MB for replica storage
  private static isMonitoring = false;
  private static monitorInterval: NodeJS.Timeout | null = null;

  /**
   * Start monitoring for starburst triggers
   */
  static startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('Starburst monitoring already active', { component: 'StarburstEngine' });
      return;
    }

    this.isMonitoring = true;
    this.monitorInterval = setInterval(() => {
      this.checkTriggers();
    }, 1000); // Check every second

    logger.info('Starburst monitoring started', {
      component: 'StarburstEngine',
      triggers: this.triggers.length
    });
  }

  /**
   * Stop monitoring
   */
  static stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    logger.info('Starburst monitoring stopped', { component: 'StarburstEngine' });
  }

  /**
   * Check for starburst triggers
   */
  private static checkTriggers(): void {
    const lux = LuxSwarm.observe();

    // Check high-value opportunities
    const highValueOpps = lux.opportunities.filter(o => o.profitEstimate >= 10000);
    if (highValueOpps.length > 0) {
      for (const opp of highValueOpps) {
        this.triggerStarburst('high-value', opp, opp.profitEstimate);
      }
    }

    // Check opportunity surge
    if (lux.opportunities.length >= 10) {
      const avgValue = lux.opportunities.reduce((sum, o) => sum + o.profitEstimate, 0) / lux.opportunities.length;
      this.triggerStarburst('opportunity-surge', lux.opportunities[0], avgValue);
    }

    // Check cascade (multiple chains active)
    const activeChains = new Set(lux.opportunities.map(o => o.chain));
    if (activeChains.size >= 5) {
      this.triggerStarburst('cascade', lux.opportunities[0], activeChains.size);
    }

    // Cleanup dead replicas
    this.cleanupReplicas();
  }

  /**
   * Trigger a starburst event with memory monitoring
   */
  static triggerStarburst(
    type: StarburstTrigger['type'],
    opportunity: Opportunity,
    value: number
  ): StarburstEvent {
    const trigger = this.triggers.find(t => t.type === type);
    if (!trigger) {
      throw new Error(`Unknown starburst trigger type: ${type}`);
    }

    // Check memory usage before creating replicas
    const memoryUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024);
    if (memoryUsageMB > this.memoryThresholdMB) {
      logger.warn('Memory threshold reached, starburst suppressed', {
        component: 'StarburstEngine',
        memoryUsageMB: memoryUsageMB.toFixed(2),
        threshold: this.memoryThresholdMB
      });

      return {
        id: `starburst-${Date.now()}`,
        triggerType: type,
        sourceAgent: 'engine',
        replicasCreated: 0,
        timestamp: Date.now(),
        value,
        chain: opportunity.chain,
        success: false
      };
    }

    // Check if already at max replicas
    if (this.replicas.size >= this.maxReplicas) {
      logger.warn('Max replicas reached, starburst suppressed', {
        component: 'StarburstEngine',
        currentReplicas: this.replicas.size,
        maxReplicas: this.maxReplicas
      });

      return {
        id: `starburst-${Date.now()}`,
        triggerType: type,
        sourceAgent: 'engine',
        replicasCreated: 0,
        timestamp: Date.now(),
        value,
        chain: opportunity.chain,
        success: false
      };
    }

    // Calculate how many replicas to create with memory constraint
    const spaceAvailable = this.maxReplicas - this.replicas.size;
    
    // Further limit based on available memory (estimate ~50KB per replica)
    const estimatedReplicaSizeKB = 50;
    const memoryAvailableMB = this.memoryThresholdMB - memoryUsageMB;
    const memoryBasedLimit = Math.floor((memoryAvailableMB * 1024) / estimatedReplicaSizeKB);
    
    const replicasToCreate = Math.min(
      trigger.replicationFactor,
      spaceAvailable,
      memoryBasedLimit
    );

    logger.info('STARBURST TRIGGERED!', {
      component: 'StarburstEngine',
      type,
      value,
      replicasToCreate,
      currentReplicas: this.replicas.size,
      memoryUsageMB: memoryUsageMB.toFixed(2),
      memoryLimit: memoryBasedLimit
    });

    // Create replicas with specialized roles
    const replicaIds: string[] = [];
    const roles: ReplicaAgent['role'][] = ['scanner', 'executor', 'validator', 'monitor'];

    for (let i = 0; i < replicasToCreate; i++) {
      const role = roles[i % roles.length];
      const replica = this.createReplica(opportunity, role, 'starburst-parent');
      replicaIds.push(replica.id);
    }

    // Create starburst event
    const event: StarburstEvent = {
      id: `starburst-${Date.now()}-${randomUUID().split('-')[0]}`,
      triggerType: type,
      sourceAgent: 'engine',
      replicasCreated: replicasToCreate,
      timestamp: Date.now(),
      value,
      chain: opportunity.chain,
      success: true
    };

    this.events.push(event);

    // Store event in Eden
    EdenStorage.storeKnowledge({
      type: 'strategy',
      chain: opportunity.chain,
      data: {
        starburstEvent: event,
        replicaIds
      },
      confidence: 0.9,
      successRate: 1,
      profitability: value,
      usageCount: 1
    });

    logger.info('Starburst complete', {
      component: 'StarburstEngine',
      eventId: event.id,
      replicas: replicasToCreate,
      totalReplicas: this.replicas.size
    });

    return event;
  }

  /**
   * Create a replica agent
   */
  private static createReplica(
    target: Opportunity,
    role: ReplicaAgent['role'],
    parentId: string,
    generation: number = 0
  ): ReplicaAgent {
    const replica: ReplicaAgent = {
      id: `replica-${role}-${Date.now()}-${randomUUID().split('-')[0]}`,
      parentId,
      generation,
      role,
      target,
      status: 'active',
      spawnTime: Date.now(),
      lifetime: this.calculateLifetime(role, target),
      executionCount: 0
    };

    this.replicas.set(replica.id, replica);

    // Update swarm state
    const lux = LuxSwarm.observe();
    const agentStates = new Map(lux.agentStates);
    
    agentStates.set(replica.id, {
      id: replica.id,
      target: target.asset,
      priority: target.priority,
      status: 'pursuing',
      lastUpdate: Date.now()
    });

    LuxSwarm.emit({ agentStates });

    return replica;
  }

  /**
   * Calculate replica lifetime based on role and opportunity
   */
  private static calculateLifetime(role: ReplicaAgent['role'], target: Opportunity): number {
    const baseLifetime = 60000; // 1 minute

    const roleMultiplier = {
      scanner: 2, // Scanners live longer
      executor: 1, // Executors are short-lived
      validator: 1.5,
      monitor: 3 // Monitors live longest
    };

    const priorityBonus = target.priority * 100; // Higher priority = longer life

    return baseLifetime * roleMultiplier[role] + priorityBonus;
  }

  /**
   * Execute a replica's task
   */
  static async executeReplica(replicaId: string): Promise<boolean> {
    const replica = this.replicas.get(replicaId);
    if (!replica || replica.status !== 'active') return false;

    try {
      let result = false;

      switch (replica.role) {
        case 'scanner':
          result = await this.scanTask(replica);
          break;
        case 'executor':
          result = await this.executeTask(replica);
          break;
        case 'validator':
          result = await this.validateTask(replica);
          break;
        case 'monitor':
          result = await this.monitorTask(replica);
          break;
      }

      replica.executionCount++;

      if (result) {
        replica.status = 'completed';
      } else {
        replica.status = 'failed';
      }

      return result;

    } catch (error) {
      logger.error('Replica execution failed', {
        component: 'StarburstEngine',
        replicaId,
        role: replica.role,
        error: error instanceof Error ? error.message : String(error)
      });

      replica.status = 'failed';
      return false;
    }
  }

  /**
   * Scan task
   */
  private static async scanTask(replica: ReplicaAgent): Promise<boolean> {
    // Scan for opportunities related to target
    const lux = LuxSwarm.observe();
    const relatedOpps = lux.opportunities.filter(o => 
      o.chain === replica.target.chain || o.pair.includes(replica.target.asset)
    );

    if (relatedOpps.length > 0) {
      logger.debug('Scanner replica found opportunities', {
        component: 'StarburstEngine',
        replicaId: replica.id,
        found: relatedOpps.length
      });
      return true;
    }

    return false;
  }

  /**
   * Execute task
   */
  private static async executeTask(replica: ReplicaAgent): Promise<boolean> {
    // Execute the opportunity
    logger.debug('Executor replica executing', {
      component: 'StarburstEngine',
      replicaId: replica.id,
      target: replica.target.asset
    });

    // Placeholder for actual execution
    return true;
  }

  /**
   * Validate task
   */
  private static async validateTask(replica: ReplicaAgent): Promise<boolean> {
    // Validate opportunity before execution
    const isValid = replica.target.profitEstimate > 0 && replica.target.priority > 50;

    logger.debug('Validator replica validated', {
      component: 'StarburstEngine',
      replicaId: replica.id,
      valid: isValid
    });

    return isValid;
  }

  /**
   * Monitor task
   */
  private static async monitorTask(replica: ReplicaAgent): Promise<boolean> {
    // Monitor for changes in opportunity
    logger.debug('Monitor replica monitoring', {
      component: 'StarburstEngine',
      replicaId: replica.id
    });

    return true;
  }

  /**
   * Cleanup dead or expired replicas
   */
  private static cleanupReplicas(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, replica] of this.replicas.entries()) {
      const age = now - replica.spawnTime;
      
      if (
        age > replica.lifetime ||
        replica.status === 'completed' ||
        replica.status === 'failed'
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.replicas.delete(id);
    }

    if (toRemove.length > 0) {
      logger.debug('Replicas cleaned up', {
        component: 'StarburstEngine',
        removed: toRemove.length,
        remaining: this.replicas.size
      });
    }
  }

  /**
   * Get active replicas
   */
  static getActiveReplicas(): ReplicaAgent[] {
    return Array.from(this.replicas.values()).filter(r => r.status === 'active');
  }

  /**
   * Get replicas by role
   */
  static getReplicasByRole(role: ReplicaAgent['role']): ReplicaAgent[] {
    return Array.from(this.replicas.values()).filter(r => r.role === role);
  }

  /**
   * Get starburst events
   */
  static getEvents(limit: number = 100): StarburstEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get statistics
   */
  static getStatistics(): {
    totalReplicas: number;
    activeReplicas: number;
    totalEvents: number;
    successfulEvents: number;
    replicasByRole: Record<ReplicaAgent['role'], number>;
  } {
    const active = this.getActiveReplicas();
    const successful = this.events.filter(e => e.success).length;

    const replicasByRole: Record<ReplicaAgent['role'], number> = {
      scanner: 0,
      executor: 0,
      validator: 0,
      monitor: 0
    };

    for (const replica of this.replicas.values()) {
      replicasByRole[replica.role]++;
    }

    return {
      totalReplicas: this.replicas.size,
      activeReplicas: active.length,
      totalEvents: this.events.length,
      successfulEvents: successful,
      replicasByRole
    };
  }

  /**
   * Manual starburst trigger (emergency)
   */
  static manualStarburst(opportunity: Opportunity, replicationFactor?: number): StarburstEvent {
    const trigger = this.triggers.find(t => t.type === 'emergency');
    if (trigger && replicationFactor) {
      trigger.replicationFactor = replicationFactor;
    }

    return this.triggerStarburst('emergency', opportunity, opportunity.profitEstimate);
  }

  /**
   * Set max replicas
   */
  static setMaxReplicas(max: number): void {
    this.maxReplicas = max;
    logger.info('Max replicas updated', {
      component: 'StarburstEngine',
      maxReplicas: this.maxReplicas
    });
  }

  /**
   * Reset (for testing)
   */
  static reset(): void {
    this.stopMonitoring();
    this.replicas.clear();
    this.events = [];
    logger.info('Starburst engine reset', { component: 'StarburstEngine' });
  }
}

/**
 * Enhanced Snake Shedding with Starburst Integration
 */
export class EnhancedSnakeAgent {
  id: string;
  private priority: number;
  private target: string;
  private chain: ChainId;
  private skins: EnhancedSnakeAgent[] = [];
  private canShed: boolean;
  private starburstEnabled: boolean;

  constructor(
    opp: Opportunity,
    canShed = true,
    starburstEnabled = true
  ) {
    this.id = `snake-enhanced-${Date.now()}-${randomUUID().split('-')[0]}`;
    this.priority = opp.priority;
    this.target = opp.asset;
    this.chain = opp.chain;
    this.canShed = canShed;
    this.starburstEnabled = starburstEnabled;
  }

  /**
   * Crawl with starburst awareness
   */
  async crawl(): Promise<void> {
    const lux = LuxSwarm.observe();

    // Check if this opportunity triggers a starburst
    const opportunity: Opportunity = {
      asset: this.target,
      pair: `${this.target}/USDT`,
      chain: this.chain,
      priority: this.priority,
      profitEstimate: this.priority * 100, // Estimate based on priority
      timestamp: Date.now()
    };

    // Trigger starburst if high-value
    if (this.starburstEnabled && opportunity.profitEstimate >= 10000) {
      logger.info('Snake triggering starburst', {
        component: 'EnhancedSnakeAgent',
        snakeId: this.id,
        value: opportunity.profitEstimate
      });

      StarburstEngine.triggerStarburst('high-value', opportunity, opportunity.profitEstimate);
    }

    // Check for higher priority (normal shedding)
    if (this.canShed) {
      const higherPriority = lux.opportunities.find(
        o => o.priority > this.priority && !lux.claimed.has(o.asset)
      );

      if (higherPriority) {
        // Shed skin
        const skin = this.shed(opportunity);
        skin.crawl().catch(err => 
          logger.error('Snake skin failed', { 
            component: 'EnhancedSnakeAgent',
            error: err instanceof Error ? err.message : String(err)
          })
        );

        // Pursue higher priority
        this.pursue(higherPriority);
      }
    }

    // Execute current target
    await this.strike();
  }

  /**
   * Shed skin
   */
  private shed(opp: Opportunity): EnhancedSnakeAgent {
    const skin = new EnhancedSnakeAgent(opp, false, false);
    this.skins.push(skin);
    
    logger.debug('Snake shed skin', {
      component: 'EnhancedSnakeAgent',
      parentId: this.id,
      skinId: skin.id
    });

    return skin;
  }

  /**
   * Pursue higher priority
   */
  private pursue(opp: Opportunity): void {
    this.target = opp.asset;
    this.priority = opp.priority;
    this.chain = opp.chain;

    logger.debug('Snake pursuing new target', {
      component: 'EnhancedSnakeAgent',
      snakeId: this.id,
      newTarget: this.target,
      newPriority: this.priority
    });
  }

  /**
   * Strike (execute)
   */
  private async strike(): Promise<void> {
    logger.debug('Snake striking', {
      component: 'EnhancedSnakeAgent',
      snakeId: this.id,
      target: this.target
    });

    // Placeholder for actual execution
  }
}
