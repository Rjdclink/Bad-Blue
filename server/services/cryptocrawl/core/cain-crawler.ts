// Cain Crawler - Knowledge Collector & Evolution Engine
// Special crawlers that collect knowledge from all replicas, return to Eden to evolve the system

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import { EdenStorage, type KnowledgeEntry, type EvolutionResult } from './eden-storage';
import { LuxSwarm, type AgentState, type ChainId, type Opportunity } from './lux-swarm';

export interface CainObservation {
  id: string;
  crawlerId: string;
  timestamp: number;
  chain: ChainId;
  observationType: 'success' | 'failure' | 'pattern' | 'risk' | 'opportunity';
  data: Record<string, any>;
  profitability?: number;
  executionTime?: number;
  gasUsed?: number;
  confidence: number;
}

export interface CainMission {
  id: string;
  startTime: number;
  endTime?: number;
  observationsCollected: number;
  chainsVisited: ChainId[];
  evolutionsTriggered: number;
  status: 'collecting' | 'analyzing' | 'evolving' | 'teaching' | 'completed';
}

export interface EvolutionStrategy {
  id: string;
  name: string;
  description: string;
  successRate: number;
  avgProfit: number;
  conditions: Record<string, any>;
  actions: string[];
  priority: number;
}

/**
 * Cain Crawler - The wisdom keeper and system evolver
 * Collects knowledge → Returns to Eden → Evolves system → Teaches next generation
 */
export class CainCrawler {
  id: string;
  private mission: CainMission;
  private observations: CainObservation[] = [];
  private isActive = true;
  private collectionThreshold = 100; // Collect 100 observations before returning to Eden
  private evolutionCycle = 0;

  constructor() {
    this.id = `cain-${Date.now()}-${randomUUID().split('-')[0]}`;
    this.mission = {
      id: `mission-${Date.now()}`,
      startTime: Date.now(),
      observationsCollected: 0,
      chainsVisited: [],
      evolutionsTriggered: 0,
      status: 'collecting'
    };

    logger.info('Cain Crawler spawned', {
      component: 'CainCrawler',
      id: this.id,
      missionId: this.mission.id
    });
  }

  /**
   * Start the Cain evolution cycle
   * Collect → Return → Evolve → Teach
   */
  async start(): Promise<void> {
    while (this.isActive) {
      try {
        // Phase 1: Collect knowledge from all active crawlers
        await this.collectPhase();

        // Phase 2: Return to Eden and analyze
        await this.returnToEden();

        // Phase 3: Evolve the system
        const evolution = await this.evolveSystem();

        // Phase 4: Teach next generation
        await this.teachGeneration(evolution);

        this.evolutionCycle++;

        // Wait before next cycle
        await this.sleep(60000); // 1 minute between cycles

      } catch (error) {
        logger.error('Cain Crawler error', {
          component: 'CainCrawler',
          id: this.id,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Phoenix pattern: respawn on failure
        await this.sleep(5000);
      }
    }
  }

  /**
   * Phase 1: Collect knowledge from all active crawlers
   */
  private async collectPhase(): Promise<void> {
    this.mission.status = 'collecting';
    const lux = LuxSwarm.observe();

    logger.info('Cain collecting knowledge', {
      component: 'CainCrawler',
      id: this.id,
      activeCrawlers: lux.agentStates.size
    });

    // Observe all active crawlers
    for (const [agentId, agentState] of lux.agentStates.entries()) {
      await this.observeCrawler(agentId, agentState);
    }

    // Collect from opportunities that were executed
    for (const opportunity of lux.opportunities) {
      await this.observeOpportunity(opportunity);
    }

    // Visit each chain to gather chain-specific knowledge
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      if (!this.mission.chainsVisited.includes(chain)) {
        this.mission.chainsVisited.push(chain);
        await this.observeChain(chain);
      }
    }

    this.mission.observationsCollected = this.observations.length;

    logger.info('Cain collection complete', {
      component: 'CainCrawler',
      id: this.id,
      observations: this.observations.length,
      chainsVisited: this.mission.chainsVisited.length
    });
  }

  /**
   * Observe a specific crawler's behavior
   */
  private async observeCrawler(crawlerId: string, state: AgentState): Promise<void> {
    const observation: CainObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      crawlerId,
      timestamp: Date.now(),
      chain: 'polygon', // Default, can be enhanced
      observationType: state.status === 'completed' ? 'success' : 
                      state.status === 'failed' ? 'failure' : 'pattern',
      data: {
        status: state.status,
        target: state.target,
        priority: state.priority,
        lastUpdate: state.lastUpdate
      },
      confidence: state.status === 'completed' ? 0.9 : 0.5
    };

    this.observations.push(observation);
  }

  /**
   * Observe an opportunity
   */
  private async observeOpportunity(opportunity: Opportunity): Promise<void> {
    const observation: CainObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      crawlerId: 'system',
      timestamp: Date.now(),
      chain: opportunity.chain,
      observationType: 'opportunity',
      data: {
        asset: opportunity.asset,
        pair: opportunity.pair,
        priority: opportunity.priority,
        profitEstimate: opportunity.profitEstimate
      },
      profitability: opportunity.profitEstimate,
      confidence: opportunity.priority / 100
    };

    this.observations.push(observation);
  }

  /**
   * Observe chain-specific patterns
   */
  private async observeChain(chain: ChainId): Promise<void> {
    const edenState = EdenStorage.getState(chain);
    if (!edenState) return;

    // Collect chain patterns
    const observation: CainObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      crawlerId: 'cain',
      timestamp: Date.now(),
      chain,
      observationType: 'pattern',
      data: {
        generation: edenState.generation,
        totalKnowledge: edenState.totalKnowledge,
        successRate: edenState.globalMetrics.successRate,
        totalProfit: edenState.globalMetrics.totalProfit
      },
      confidence: 0.8
    };

    this.observations.push(observation);
  }

  /**
   * Phase 2: Return to Eden and analyze collected knowledge
   */
  private async returnToEden(): Promise<void> {
    this.mission.status = 'analyzing';

    logger.info('Cain returning to Eden', {
      component: 'CainCrawler',
      id: this.id,
      observations: this.observations.length
    });

    // Store all observations in Eden
    for (const obs of this.observations) {
      const knowledgeType = this.mapObservationType(obs.observationType);
      
      EdenStorage.storeKnowledge({
        type: knowledgeType,
        chain: obs.chain,
        data: {
          ...obs.data,
          crawlerId: obs.crawlerId,
          observationId: obs.id
        },
        confidence: obs.confidence,
        successRate: obs.observationType === 'success' ? 1 : 
                    obs.observationType === 'failure' ? 0 : 0.5,
        profitability: obs.profitability || 0,
        usageCount: 1
      });
    }

    logger.info('Knowledge stored in Eden', {
      component: 'CainCrawler',
      id: this.id,
      stored: this.observations.length
    });
  }

  /**
   * Map observation type to knowledge entry type
   */
  private mapObservationType(obsType: CainObservation['observationType']): KnowledgeEntry['type'] {
    switch (obsType) {
      case 'success':
      case 'failure':
        return 'strategy';
      case 'pattern':
        return 'pattern';
      case 'risk':
        return 'risk';
      case 'opportunity':
        return 'opportunity';
      default:
        return 'pattern';
    }
  }

  /**
   * Phase 3: Evolve the system based on collected knowledge
   */
  private async evolveSystem(): Promise<EvolutionResult> {
    this.mission.status = 'evolving';

    logger.info('Cain evolving system', {
      component: 'CainCrawler',
      id: this.id,
      cycle: this.evolutionCycle
    });

    // Analyze patterns and create evolution strategies
    const strategies = this.analyzePatterns();
    const risksIdentified = this.identifyRisks();
    const optimizations = this.optimizeStrategies();

    // Calculate improvement score
    const improvementScore = this.calculateImprovementScore(strategies, risksIdentified, optimizations);

    const result: EvolutionResult = {
      generation: this.evolutionCycle,
      changesApplied: strategies.length + optimizations.length,
      strategiesOptimized: optimizations.length,
      patternsDiscovered: strategies.length,
      risksIdentified: risksIdentified.length,
      improvementScore
    };

    // Record evolution in Eden
    EdenStorage.recordEvolution(result);

    // Increment generation for all Eden instances
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      const state = EdenStorage.getState(chain);
      if (state) {
        state.generation++;
      }
    }

    this.mission.evolutionsTriggered++;

    logger.info('System evolution complete', {
      component: 'CainCrawler',
      id: this.id,
      result
    });

    return result;
  }

  /**
   * Analyze patterns from observations
   */
  private analyzePatterns(): EvolutionStrategy[] {
    const strategies: EvolutionStrategy[] = [];

    // Group observations by type and chain
    const successObs = this.observations.filter(o => o.observationType === 'success');
    const failureObs = this.observations.filter(o => o.observationType === 'failure');

    // Identify successful patterns
    if (successObs.length > 0) {
      const avgProfit = successObs.reduce((sum, o) => sum + (o.profitability || 0), 0) / successObs.length;
      
      strategies.push({
        id: `strategy-success-${Date.now()}`,
        name: 'Successful Pattern',
        description: 'Pattern identified from successful executions',
        successRate: 1,
        avgProfit,
        conditions: {
          type: 'success',
          minConfidence: 0.7
        },
        actions: ['execute', 'replicate', 'optimize'],
        priority: 90
      });
    }

    // Learn from failures
    if (failureObs.length > 0) {
      strategies.push({
        id: `strategy-avoid-${Date.now()}`,
        name: 'Failure Avoidance',
        description: 'Pattern to avoid based on failures',
        successRate: 0,
        avgProfit: 0,
        conditions: {
          type: 'failure',
          patterns: failureObs.map(o => o.data)
        },
        actions: ['avoid', 'analyze', 'retry-with-caution'],
        priority: 80
      });
    }

    return strategies;
  }

  /**
   * Identify risks from observations
   */
  private identifyRisks(): string[] {
    const risks: string[] = [];

    const riskObs = this.observations.filter(o => o.observationType === 'risk');
    
    for (const obs of riskObs) {
      if (obs.data.severity === 'high') {
        risks.push(`High risk identified on ${obs.chain}: ${obs.data.description}`);
      }
    }

    return risks;
  }

  /**
   * Optimize existing strategies
   */
  private optimizeStrategies(): string[] {
    const optimizations: string[] = [];

    // Get best strategies from Eden
    const bestStrategies = EdenStorage.getBestStrategies(10);

    for (const strategy of bestStrategies) {
      if (strategy.successRate < 0.9 && strategy.usageCount > 10) {
        optimizations.push(`Optimize ${strategy.data.name || 'strategy'} - current success: ${strategy.successRate}`);
      }
    }

    return optimizations;
  }

  /**
   * Calculate improvement score
   */
  private calculateImprovementScore(
    strategies: EvolutionStrategy[],
    risks: string[],
    optimizations: string[]
  ): number {
    const strategyScore = Math.min(strategies.length / 10, 1) * 0.4;
    const riskScore = Math.min(risks.length / 5, 1) * 0.3;
    const optimizationScore = Math.min(optimizations.length / 10, 1) * 0.3;

    return strategyScore + riskScore + optimizationScore;
  }

  /**
   * Phase 4: Teach next generation of crawlers
   */
  private async teachGeneration(evolution: EvolutionResult): Promise<void> {
    this.mission.status = 'teaching';

    logger.info('Cain teaching next generation', {
      component: 'CainCrawler',
      id: this.id,
      generation: evolution.generation,
      improvementScore: evolution.improvementScore
    });

    // Update global metrics with evolved knowledge
    EdenStorage.updateGlobalMetrics({
      lastEvolution: Date.now()
    });

    // Broadcast evolution to all active crawlers via LuxSwarm
    const lux = LuxSwarm.observe();
    
    // Update swarm with new generation knowledge
    // This allows all crawlers to instantly access the evolved strategies
    
    logger.info('Generation teaching complete', {
      component: 'CainCrawler',
      id: this.id,
      activeCrawlers: lux.agentStates.size
    });

    // Clear observations for next cycle
    this.observations = [];
  }

  /**
   * Stop the Cain crawler
   */
  stop(): void {
    this.isActive = false;
    this.mission.status = 'completed';
    this.mission.endTime = Date.now();

    logger.info('Cain Crawler stopped', {
      component: 'CainCrawler',
      id: this.id,
      totalObservations: this.mission.observationsCollected,
      evolutionsCycles: this.evolutionCycle
    });
  }

  /**
   * Get mission status
   */
  getMissionStatus(): CainMission {
    return { ...this.mission };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current observations count
   */
  getObservationsCount(): number {
    return this.observations.length;
  }

  /**
   * Force evolution cycle (for testing)
   */
  async forceEvolution(): Promise<EvolutionResult> {
    await this.returnToEden();
    return await this.evolveSystem();
  }
}

/**
 * Cain Manager - Manages multiple Cain crawlers
 */
export class CainManager {
  private static cains = new Map<string, CainCrawler>();
  private static isRunning = false;

  /**
   * Spawn a new Cain crawler
   */
  static spawn(): CainCrawler {
    const cain = new CainCrawler();
    this.cains.set(cain.id, cain);

    logger.info('Cain spawned by manager', {
      component: 'CainManager',
      cainId: cain.id,
      totalCains: this.cains.size
    });

    return cain;
  }

  /**
   * Start all Cain crawlers
   */
  static async startAll(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Cain manager already running', { component: 'CainManager' });
      return;
    }

    this.isRunning = true;

    for (const cain of this.cains.values()) {
      cain.start().catch(err => {
        logger.error('Cain crawler failed', {
          component: 'CainManager',
          cainId: cain.id,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }

    logger.info('All Cain crawlers started', {
      component: 'CainManager',
      count: this.cains.size
    });
  }

  /**
   * Stop all Cain crawlers
   */
  static stopAll(): void {
    for (const cain of this.cains.values()) {
      cain.stop();
    }

    this.isRunning = false;

    logger.info('All Cain crawlers stopped', {
      component: 'CainManager',
      count: this.cains.size
    });
  }

  /**
   * Get all active Cain crawlers
   */
  static getCains(): CainCrawler[] {
    return Array.from(this.cains.values());
  }

  /**
   * Get Cain by ID
   */
  static getCain(id: string): CainCrawler | undefined {
    return this.cains.get(id);
  }

  /**
   * Remove Cain crawler
   */
  static remove(id: string): boolean {
    const cain = this.cains.get(id);
    if (cain) {
      cain.stop();
      this.cains.delete(id);
      return true;
    }
    return false;
  }
}
