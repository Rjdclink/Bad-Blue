/**
 * @deprecated Eden compatibility facade.
 *
 * Eden no longer owns durable learning memory or trading authority. The bounded
 * maps below preserve historical callers, while durable artifacts are mapped
 * asynchronously into the canonical private CryptoCrawler intelligence schema.
 * Only normalized terminal settlement may become authoritative learning truth.
 */

import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import type { ChainId } from './lux-swarm';
import { observeLegacyCompatibilityArtifact } from '../intelligence/canonical-legacy-knowledge-adapter.js';

export interface KnowledgeEntry {
  id: string;
  type: 'strategy' | 'pattern' | 'risk' | 'opportunity' | 'failure';
  timestamp: number;
  chain: ChainId;
  data: Record<string, any>;
  confidence: number;
  successRate: number;
  profitability: number;
  usageCount: number;
  lastUpdated: number;
}

export interface EdenState {
  generation: number;
  totalKnowledge: number;
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
  optimalTiming: number[];
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
  improvementScore: number;
}

const HOT_LIMIT_PER_TYPE = Math.max(32, Math.min(2048, Number(process.env.EDEN_COMPAT_HOT_LIMIT || 256)));
let artifactSequence = 0;

function emptyState(chain: ChainId): EdenState {
  return {
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
      lastEvolution: Date.now(),
    },
    networkStates: new Map(),
  };
}

function stableArtifactId(prefix: string, value: unknown, observedAt: number): string {
  const sequence = ++artifactSequence;
  const digest = createHash('sha256')
    .update(JSON.stringify({ prefix, value, observedAt, sequence }))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}:${observedAt}:${digest}`;
}

function mapFor(state: EdenState, type: KnowledgeEntry['type']): Map<string, KnowledgeEntry> {
  if (type === 'strategy') return state.strategies;
  if (type === 'pattern') return state.patterns;
  if (type === 'risk') return state.risks;
  if (type === 'opportunity') return state.opportunities;
  return state.failures;
}

function trimMap(map: Map<string, KnowledgeEntry>): void {
  while (map.size > HOT_LIMIT_PER_TYPE) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) return;
    map.delete(oldest);
  }
}

function compatibilityKind(type: KnowledgeEntry['type']) {
  if (type === 'strategy') return 'strategy_template' as const;
  if (type === 'pattern') return 'pattern' as const;
  if (type === 'risk') return 'risk' as const;
  if (type === 'opportunity') return 'opportunity' as const;
  return 'failure' as const;
}

export class EdenStorage {
  private static instances = new Map<ChainId, EdenState>();
  private static primaryChain: ChainId = 'polygon';
  private static evolutionHistory: EvolutionResult[] = [];

  static initialize(chain: ChainId): void {
    if (this.instances.has(chain)) return;
    this.instances.set(chain, emptyState(chain));
    logger.info('Eden compatibility facade initialized', {
      component: 'EdenStorage',
      chain,
      authority: 'legacy_advisory_facade',
      durableAuthority: 'canonical_private_intelligence_schema',
      executionAuthority: false,
    });
  }

  static getState(chain: ChainId = this.primaryChain): EdenState | undefined {
    return this.instances.get(chain);
  }

  static storeKnowledge(
    entry: Omit<KnowledgeEntry, 'id' | 'timestamp' | 'lastUpdated'>,
    chain: ChainId = this.primaryChain,
  ): string {
    const state = this.instances.get(chain);
    if (!state) throw new Error(`Eden not initialized on ${chain}`);
    const timestamp = Date.now();
    const id = stableArtifactId(`legacy-eden-${entry.type}-${chain}`, entry, timestamp);
    const knowledgeEntry: KnowledgeEntry = { ...entry, id, timestamp, lastUpdated: timestamp };
    const map = mapFor(state, entry.type);
    map.set(id, knowledgeEntry);
    trimMap(map);
    state.totalKnowledge = state.strategies.size + state.patterns.size + state.risks.size + state.opportunities.size + state.failures.size;

    observeLegacyCompatibilityArtifact({
      artifactId: id,
      kind: compatibilityKind(entry.type),
      observedAt: timestamp,
      chain,
      payload: knowledgeEntry,
      provenance: ['eden_compatibility_store'],
    });
    this.replicateHotCompatibility(knowledgeEntry, chain);
    return id;
  }

  static retrieveKnowledge(
    type: KnowledgeEntry['type'],
    filters?: Partial<Pick<KnowledgeEntry, 'chain' | 'confidence'>>,
    chain: ChainId = this.primaryChain,
  ): KnowledgeEntry[] {
    const state = this.instances.get(chain);
    if (!state) return [];
    let entries = [...mapFor(state, type).values()];
    if (filters?.chain) entries = entries.filter(entry => entry.chain === filters.chain);
    if (filters?.confidence !== undefined) entries = entries.filter(entry => entry.confidence >= filters.confidence!);
    return entries.sort((left, right) => right.confidence - left.confidence).map(entry => ({ ...entry, data: { ...entry.data } }));
  }

  static updateKnowledge(
    id: string,
    updates: Partial<Omit<KnowledgeEntry, 'id' | 'type' | 'timestamp'>>,
    chain: ChainId = this.primaryChain,
  ): boolean {
    const state = this.instances.get(chain);
    if (!state) return false;
    for (const map of [state.strategies, state.patterns, state.risks, state.opportunities, state.failures]) {
      const current = map.get(id);
      if (!current) continue;
      const updated = { ...current, ...updates, id: current.id, type: current.type, timestamp: current.timestamp, lastUpdated: Date.now() };
      map.set(id, updated);
      observeLegacyCompatibilityArtifact({
        artifactId: `${id}:update:${updated.lastUpdated}`,
        kind: compatibilityKind(updated.type),
        observedAt: updated.lastUpdated,
        chain,
        payload: updated,
        provenance: ['eden_compatibility_update'],
        sourceEventIds: [id],
      });
      return true;
    }
    return false;
  }

  private static replicateHotCompatibility(entry: KnowledgeEntry, sourceChain: ChainId): void {
    for (const [chain, state] of this.instances.entries()) {
      if (chain === sourceChain) continue;
      const map = mapFor(state, entry.type);
      map.set(entry.id, { ...entry, data: { ...entry.data } });
      trimMap(map);
      state.totalKnowledge = state.strategies.size + state.patterns.size + state.risks.size + state.opportunities.size + state.failures.size;
    }
  }

  /** Historical API retained. No background replication timer is needed because
   * the compatibility hot views are synchronized on writes and durable authority
   * is the single canonical private schema. */
  static startReplication(_intervalMs: number = 5000): void {
    logger.info('Eden background replication retired; canonical durable memory is authoritative', {
      component: 'EdenStorage',
      backgroundReplication: false,
      executionAuthority: false,
    });
  }

  static stopReplication(): void {
    // Compatibility no-op: there is no independent Eden replication timer.
  }

  static updateGlobalMetrics(updates: Partial<GlobalMetrics>, chain: ChainId = this.primaryChain): void {
    const state = this.instances.get(chain);
    if (!state) return;
    state.globalMetrics = { ...state.globalMetrics, ...updates };
    for (const [targetChain, targetState] of this.instances.entries()) {
      if (targetChain !== chain) targetState.globalMetrics = { ...state.globalMetrics };
    }
    const timestamp = Date.now();
    observeLegacyCompatibilityArtifact({
      artifactId: stableArtifactId(`legacy-eden-metrics-${chain}`, state.globalMetrics, timestamp),
      kind: 'state_snapshot',
      observedAt: timestamp,
      chain,
      payload: state.globalMetrics,
      provenance: ['eden_compatibility_metrics', 'profit_fields_unverified_advisory_only'],
    });
  }

  static recordEvolution(result: EvolutionResult): void {
    this.evolutionHistory.push({ ...result });
    this.evolutionHistory = this.evolutionHistory.slice(-100);
    const timestamp = Date.now();
    observeLegacyCompatibilityArtifact({
      artifactId: stableArtifactId('legacy-eden-evolution', result, timestamp),
      kind: 'evolution',
      observedAt: timestamp,
      payload: result,
      provenance: ['eden_compatibility_evolution', 'research_only'],
    });
  }

  static getEvolutionHistory(): EvolutionResult[] {
    return this.evolutionHistory.map(result => ({ ...result }));
  }

  /** Compatibility ranking only. This output is advisory and cannot grant live
   * execution; canonical economics/governance remain authoritative. */
  static getBestStrategies(limit: number = 10, chain: ChainId = this.primaryChain): KnowledgeEntry[] {
    const state = this.instances.get(chain);
    if (!state) return [];
    return [...state.strategies.values()]
      .filter(strategy => strategy.successRate > 0.5 && strategy.confidence > 0.7)
      .sort((left, right) => (right.profitability * right.successRate) - (left.profitability * left.successRate))
      .slice(0, Math.max(0, limit))
      .map(entry => ({ ...entry, data: { ...entry.data } }));
  }

  static pruneKnowledge(
    maxAge: number = 7 * 24 * 60 * 60 * 1000,
    minConfidence: number = 0.3,
    chain: ChainId = this.primaryChain,
  ): number {
    const state = this.instances.get(chain);
    if (!state) return 0;
    const now = Date.now();
    let pruned = 0;
    for (const map of [state.strategies, state.patterns, state.risks, state.opportunities, state.failures]) {
      for (const [id, entry] of map.entries()) {
        if (now - entry.timestamp > maxAge || entry.confidence < minConfidence) {
          map.delete(id);
          pruned++;
        }
      }
    }
    state.totalKnowledge = state.strategies.size + state.patterns.size + state.risks.size + state.opportunities.size + state.failures.size;
    return pruned;
  }

  static reset(): void {
    this.instances.clear();
    this.evolutionHistory = [];
    artifactSequence = 0;
  }
}

export const EDEN_STORAGE_AUTHORITY = 'legacy_advisory_facade' as const;
export const EDEN_DURABLE_AUTHORITY = 'canonical_private_intelligence_schema' as const;
export const EDEN_EXECUTION_AUTHORITY = false as const;
export const EDEN_SETTLEMENT_AUTHORITY = false as const;
