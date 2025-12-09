// Eden Storage System - Multi-Network State Replication & Knowledge Persistence
// The central knowledge repository where all crawler learnings are stored and evolved

import logger from '../../../logger.js';
import type { ChainId } from './lux-swarm';

export interface KnowledgeEntry {
  id: string;
  type: 'strategy' | 'pattern' | 'risk' | 'opportunity' | 'failure';
  timestamp: number;
  chain: ChainId;
  data: Record<string, any>;
  confidence: number; // 0-1 confidence score
  successRate: number; // Historical success rate
  profitability: number; // Average profit generated
  usageCount: number; // How many times applied
  lastUpdated: number;
}

export interface EdenState {
  generation: number; // Evolution generation counter
  totalKnowledge: number; // Total entries in knowledge base
  strategies: Map<string, KnowledgeEntry>;
  patterns: Map<string, KnowledgeEntry>;
  risks: Map<string, KnowledgeEntry>;
  opportunities: Map<string, KnowledgeEntry>;
  failures: Map<string, KnowledgeEntry>;
  globalMetrics: GlobalMetrics;
  networkStates: Map<ChainId, NetworkKnowledge>;
}

export interface GlobalMetrics {
  totalExecutions: number;
  totalProfit: number;
  totalLosses: number;
  successRate: number;
  avgExecutionTime: number;
  bestStrategy: string;
  bestChain: ChainId;
  lastEvolution: number;
}

export interface NetworkKnowledge {
  chain: ChainId;
  bestDex: string;
  avgGasPrice: number;
  optimalTiming: number[]; // Hours of day with best opportunities
  riskLevel: number;
  totalOpportunities: number;
  successRate: number;
}

export interface EvolutionResult {
  generation: number;
  changesApplied: number;
  strategiesOptimized: number;
  patternsDiscovered: number;
  risksIdentified: number;
  improvementScore: number; // 0-1 score of how much system improved
}

/**
 * Eden Storage - The persistent knowledge base for the crawler system
 * Replicated across multiple networks for ultra-low latency and resilience
 */
export class EdenStorage {
  private static instances = new Map<ChainId, EdenState>();
  private static primaryChain: ChainId = 'polygon';
  private static replicationInterval: NodeJS.Timeout | null = null;
  private static evolutionHistory: EvolutionResult[] = [];

  /**
   * Initialize Eden on a specific chain
   */
  static initialize(chain: ChainId): void {
    if (this.instances.has(chain)) {
      logger.warn(`Eden already initialized on ${chain}`, {
        component: 'EdenStorage'
      });
      return;
    }

    const state: EdenState = {
      generation: 0,
      totalKnowledge: 0,
      strategies: new Map(),
      patterns: new Map(),
      risks: new Map(),
      opportunities: new Map(),
      failures: new Map(),
      globalMetrics: {
        totalExecutions: 0,
        totalProfit: 0,
        totalLosses: 0,
        successRate: 0,
        avgExecutionTime: 0,
        bestStrategy: '',
        bestChain: chain,
        lastEvolution: Date.now()
      },
      networkStates: new Map()
    };

    this.instances.set(chain, state);
    
    logger.info(`Eden initialized on ${chain}`, {
      component: 'EdenStorage',
      chain,
      generation: 0
    });
  }

  /**
   * Get Eden state for a specific chain
   */
  static getState(chain: ChainId = this.primaryChain): EdenState | undefined {
    return this.instances.get(chain);
  }

  /**
   * Store knowledge in Eden
   */
  static storeKnowledge(
    entry: Omit<KnowledgeEntry, 'id' | 'timestamp' | 'lastUpdated'>,
    chain: ChainId = this.primaryChain
  ): string {
    const state = this.instances.get(chain);
    if (!state) {
      logger.error(`Eden not initialized on ${chain}`, {
        component: 'EdenStorage'
      });
      throw new Error(`Eden not initialized on ${chain}`);
    }

    const id = `${entry.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const knowledgeEntry: KnowledgeEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
      lastUpdated: Date.now()
    };

    // Store in appropriate map
    switch (entry.type) {
      case 'strategy':
        state.strategies.set(id, knowledgeEntry);
        break;
      case 'pattern':
        state.patterns.set(id, knowledgeEntry);
        break;
      case 'risk':
        state.risks.set(id, knowledgeEntry);
        break;
      case 'opportunity':
        state.opportunities.set(id, knowledgeEntry);
        break;
      case 'failure':
        state.failures.set(id, knowledgeEntry);
        break;
    }

    state.totalKnowledge++;

    logger.debug(`Knowledge stored in Eden`, {
      component: 'EdenStorage',
      chain,
      type: entry.type,
      id
    });

    // Trigger replication to other networks
    this.replicateToNetwork(knowledgeEntry, chain);

    return id;
  }

  /**
   * Retrieve knowledge from Eden
   */
  static retrieveKnowledge(
    type: KnowledgeEntry['type'],
    filters?: Partial<Pick<KnowledgeEntry, 'chain' | 'confidence'>>,
    chain: ChainId = this.primaryChain
  ): KnowledgeEntry[] {
    const state = this.instances.get(chain);
    if (!state) return [];

    let entries: KnowledgeEntry[] = [];

    switch (type) {
      case 'strategy':
        entries = Array.from(state.strategies.values());
        break;
      case 'pattern':
        entries = Array.from(state.patterns.values());
        break;
      case 'risk':
        entries = Array.from(state.risks.values());
        break;
      case 'opportunity':
        entries = Array.from(state.opportunities.values());
        break;
      case 'failure':
        entries = Array.from(state.failures.values());
        break;
    }

    // Apply filters
    if (filters?.chain) {
      entries = entries.filter(e => e.chain === filters.chain);
    }
    if (filters?.confidence !== undefined) {
      entries = entries.filter(e => e.confidence >= filters.confidence!);
    }

    return entries.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Update existing knowledge entry
   */
  static updateKnowledge(
    id: string,
    updates: Partial<Omit<KnowledgeEntry, 'id' | 'type' | 'timestamp'>>,
    chain: ChainId = this.primaryChain
  ): boolean {
    const state = this.instances.get(chain);
    if (!state) return false;

    // Find entry across all maps
    const maps = [state.strategies, state.patterns, state.risks, state.opportunities, state.failures];
    
    for (const map of maps) {
      const entry = map.get(id);
      if (entry) {
        const updated: KnowledgeEntry = {
          ...entry,
          ...updates,
          lastUpdated: Date.now()
        };
        map.set(id, updated);
        
        logger.debug(`Knowledge updated in Eden`, {
          component: 'EdenStorage',
          chain,
          id
        });
        
        return true;
      }
    }

    return false;
  }

  /**
   * Replicate knowledge to other networks for redundancy
   */
  private static replicateToNetwork(entry: KnowledgeEntry, sourceChain: ChainId): void {
    const targetChains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism']
      .filter(c => c !== sourceChain) as ChainId[];

    for (const targetChain of targetChains) {
      const targetState = this.instances.get(targetChain);
      if (!targetState) continue;

      // Replicate to target chain
      switch (entry.type) {
        case 'strategy':
          targetState.strategies.set(entry.id, entry);
          break;
        case 'pattern':
          targetState.patterns.set(entry.id, entry);
          break;
        case 'risk':
          targetState.risks.set(entry.id, entry);
          break;
        case 'opportunity':
          targetState.opportunities.set(entry.id, entry);
          break;
        case 'failure':
          targetState.failures.set(entry.id, entry);
          break;
      }

      targetState.totalKnowledge++;
    }
  }

  /**
   * Start continuous replication across all networks
   */
  static startReplication(intervalMs: number = 5000): void {
    if (this.replicationInterval) {
      logger.warn('Replication already running', { component: 'EdenStorage' });
      return;
    }

    this.replicationInterval = setInterval(() => {
      this.syncAllNetworks();
    }, intervalMs);

    logger.info('Eden replication started', {
      component: 'EdenStorage',
      intervalMs
    });
  }

  /**
   * Stop replication
   */
  static stopReplication(): void {
    if (this.replicationInterval) {
      clearInterval(this.replicationInterval);
      this.replicationInterval = null;
      logger.info('Eden replication stopped', { component: 'EdenStorage' });
    }
  }

  /**
   * Sync knowledge across all networks
   */
  private static syncAllNetworks(): void {
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    const primaryState = this.instances.get(this.primaryChain);
    
    if (!primaryState) return;

    for (const chain of chains) {
      if (chain === this.primaryChain) continue;
      
      const state = this.instances.get(chain);
      if (!state) continue;

      // Sync each knowledge type
      this.syncKnowledgeMap(primaryState.strategies, state.strategies);
      this.syncKnowledgeMap(primaryState.patterns, state.patterns);
      this.syncKnowledgeMap(primaryState.risks, state.risks);
      this.syncKnowledgeMap(primaryState.opportunities, state.opportunities);
      this.syncKnowledgeMap(primaryState.failures, state.failures);
    }

    logger.debug('Eden networks synced', {
      component: 'EdenStorage',
      networks: chains.length
    });
  }

  /**
   * Sync individual knowledge maps
   */
  private static syncKnowledgeMap(
    source: Map<string, KnowledgeEntry>,
    target: Map<string, KnowledgeEntry>
  ): void {
    for (const [id, entry] of source.entries()) {
      const targetEntry = target.get(id);
      
      // Add missing entries or update if source is newer
      if (!targetEntry || entry.lastUpdated > targetEntry.lastUpdated) {
        target.set(id, { ...entry });
      }
    }
  }

  /**
   * Update global metrics
   */
  static updateGlobalMetrics(
    updates: Partial<GlobalMetrics>,
    chain: ChainId = this.primaryChain
  ): void {
    const state = this.instances.get(chain);
    if (!state) return;

    state.globalMetrics = {
      ...state.globalMetrics,
      ...updates
    };

    // Replicate metrics to all networks
    for (const [targetChain, targetState] of this.instances.entries()) {
      if (targetChain !== chain) {
        targetState.globalMetrics = { ...state.globalMetrics };
      }
    }
  }

  /**
   * Record evolution result
   */
  static recordEvolution(result: EvolutionResult): void {
    this.evolutionHistory.push(result);
    
    // Keep only last 100 evolutions
    if (this.evolutionHistory.length > 100) {
      this.evolutionHistory.shift();
    }

    logger.info('Evolution recorded', {
      component: 'EdenStorage',
      generation: result.generation,
      improvementScore: result.improvementScore
    });
  }

  /**
   * Get evolution history
   */
  static getEvolutionHistory(): EvolutionResult[] {
    return [...this.evolutionHistory];
  }

  /**
   * Get best strategies from Eden
   */
  static getBestStrategies(
    limit: number = 10,
    chain: ChainId = this.primaryChain
  ): KnowledgeEntry[] {
    const state = this.instances.get(chain);
    if (!state) return [];

    return Array.from(state.strategies.values())
      .filter(s => s.successRate > 0.5 && s.confidence > 0.7)
      .sort((a, b) => (b.profitability * b.successRate) - (a.profitability * a.successRate))
      .slice(0, limit);
  }

  /**
   * Prune old or low-performing knowledge
   */
  static pruneKnowledge(
    maxAge: number = 7 * 24 * 60 * 60 * 1000, // 7 days
    minConfidence: number = 0.3,
    chain: ChainId = this.primaryChain
  ): number {
    const state = this.instances.get(chain);
    if (!state) return 0;

    const now = Date.now();
    let prunedCount = 0;

    const pruneMap = (map: Map<string, KnowledgeEntry>) => {
      for (const [id, entry] of map.entries()) {
        const age = now - entry.timestamp;
        if (age > maxAge || entry.confidence < minConfidence) {
          map.delete(id);
          prunedCount++;
        }
      }
    };

    pruneMap(state.strategies);
    pruneMap(state.patterns);
    pruneMap(state.risks);
    pruneMap(state.opportunities);
    pruneMap(state.failures);

    state.totalKnowledge -= prunedCount;

    logger.info('Knowledge pruned from Eden', {
      component: 'EdenStorage',
      chain,
      prunedCount
    });

    return prunedCount;
  }

  /**
   * Reset Eden (for testing)
   */
  static reset(): void {
    this.stopReplication();
    this.instances.clear();
    this.evolutionHistory = [];
    logger.info('Eden reset', { component: 'EdenStorage' });
  }
}
