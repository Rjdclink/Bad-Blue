/**
 * Self-Improvement Engine for Sub-Agent System
 * 
 * Implements autonomous learning and performance optimization:
 * - KPI tracking: success_rate, lead_quality, latency, cost_per_officer, provider_efficiency
 * - Multi-armed bandit strategy selection (epsilon-greedy: 80% exploit, 20% explore)
 * - Provider performance optimization with safety guardrails
 * - Audit logging for all self-modifications
 * - Rollback capability for failed improvements
 * 
 * Uses database tables:
 * - subagent_self_improvement_actions: logs changes with rollback capability
 * - subagent_learning_patterns: stores learned patterns and confidence scores
 * - subagent_performance_metrics: tracks KPIs over time
 */

import { db } from './db';
import { 
  subAgentSelfImprovementActions, 
  subAgentLearningPatterns, 
  subAgentPerformanceMetrics,
  type InsertSubAgentSelfImprovementAction,
  type InsertSubAgentLearningPattern,
  type InsertSubAgentPerformanceMetric,
  type SubAgentSelfImprovementAction,
  type SubAgentLearningPattern,
  type SubAgentPerformanceMetric
} from '@shared/schema';
import { eq, and, gte, lte, desc, sql, asc } from 'drizzle-orm';

export type AIProviderName = 'mistral' | 'groq' | 'gemini' | 'claude';

export interface ProviderBounds {
  min: number;
  max: number;
  target: number;
}

export interface ProviderDistribution {
  mistral: number;
  groq: number;
  gemini: number;
  claude: number;
}

export interface ProviderStats {
  provider: AIProviderName;
  totalRequests: number;
  successfulRequests: number;
  successRate: number;
  averageLatencyMs: number;
  totalTokensUsed: number;
  totalCost: number;
  efficiency: number;
}

export interface SearchStrategy {
  id: string;
  name: string;
  description: string;
  score: number;
  successCount: number;
  failureCount: number;
  lastUsed: Date | null;
  parameters: Record<string, any>;
}

export interface KPISnapshot {
  timestamp: Date;
  successRate: number;
  leadQuality: number;
  averageLatencyMs: number;
  costPerOfficer: number;
  providerEfficiency: Record<AIProviderName, number>;
}

export interface OutcomeContext {
  department?: string;
  state?: string;
  queryType?: string;
  searchQuery?: string;
  sourceUrl?: string;
  errorDetails?: string;
  [key: string]: any;
}

export interface RollbackResult {
  success: boolean;
  actionId: string;
  reason?: string;
  restoredState?: Record<string, any>;
}

export interface EvaluationResult {
  timestamp: Date;
  kpis: KPISnapshot;
  recommendations: string[];
  actionsApplied: string[];
  rollbacksPerformed: string[];
}

const PROVIDER_BOUNDS: Record<AIProviderName, ProviderBounds> = {
  mistral: { min: 45, max: 55, target: 50 },
  groq: { min: 25, max: 40, target: 32.5 },
  gemini: { min: 5, max: 15, target: 10 },
  claude: { min: 3, max: 15, target: 7.5 }
};

const DEFAULT_STRATEGIES: SearchStrategy[] = [
  {
    id: 'direct_name_search',
    name: 'Direct Name Search',
    description: 'Search directly by officer name and department',
    score: 70,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    parameters: { useExactMatch: false, includeVariations: true }
  },
  {
    id: 'department_roster',
    name: 'Department Roster',
    description: 'Fetch full department roster and filter',
    score: 65,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    parameters: { includeRetired: false, maxResults: 100 }
  },
  {
    id: 'news_aggregation',
    name: 'News Aggregation',
    description: 'Search news articles for officer mentions',
    score: 55,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    parameters: { sources: ['local_news', 'public_records'], dateRange: 365 }
  },
  {
    id: 'court_records',
    name: 'Court Records Search',
    description: 'Search court case records for officer appearances',
    score: 50,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    parameters: { caseTypes: ['civil', 'criminal'], includeWitness: true }
  },
  {
    id: 'foia_database',
    name: 'FOIA Database',
    description: 'Search public FOIA responses for officer data',
    score: 45,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    parameters: { requestTypes: ['payroll', 'misconduct', 'hiring'] }
  }
];

const EPSILON = 0.2;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const SCORE_INCREMENT = 3;
const SCORE_DECREMENT = 5;
const CONFIDENCE_INCREMENT = 5;
const CONFIDENCE_DECREMENT = 8;
const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 100;

class SelfImprovementEngine {
  private static instance: SelfImprovementEngine;
  private strategies: Map<string, SearchStrategy> = new Map();
  private providerDistribution: ProviderDistribution;
  private isInitialized = false;
  private lastEvaluationTime: Date | null = null;

  private constructor() {
    this.providerDistribution = {
      mistral: PROVIDER_BOUNDS.mistral.target,
      groq: PROVIDER_BOUNDS.groq.target,
      gemini: PROVIDER_BOUNDS.gemini.target,
      claude: PROVIDER_BOUNDS.claude.target
    };
    
    DEFAULT_STRATEGIES.forEach(s => this.strategies.set(s.id, { ...s }));
  }

  static getInstance(): SelfImprovementEngine {
    if (!SelfImprovementEngine.instance) {
      SelfImprovementEngine.instance = new SelfImprovementEngine();
    }
    return SelfImprovementEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[SelfImprovementEngine] Initializing...');

    try {
      await this.loadStrategiesFromDatabase();
      await this.loadProviderDistributionFromDatabase();
      this.isInitialized = true;
      console.log('[SelfImprovementEngine] ✓ Initialized successfully');
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Initialization error:', error.message);
      this.isInitialized = true;
    }
  }

  private async loadStrategiesFromDatabase(): Promise<void> {
    try {
      const patterns = await db
        .select()
        .from(subAgentLearningPatterns)
        .where(eq(subAgentLearningPatterns.patternType, 'search_strategy'));

      for (const pattern of patterns) {
        const data = pattern.patternData as any;
        if (data?.strategyId && this.strategies.has(data.strategyId)) {
          const strategy = this.strategies.get(data.strategyId)!;
          strategy.score = pattern.confidenceScore;
          strategy.successCount = data.successCount || 0;
          strategy.failureCount = data.failureCount || 0;
          strategy.lastUsed = pattern.lastObserved;
          if (data.parameters) {
            strategy.parameters = { ...strategy.parameters, ...data.parameters };
          }
        }
      }
    } catch (error: any) {
      console.warn('[SelfImprovementEngine] Could not load strategies:', error.message);
    }
  }

  private async loadProviderDistributionFromDatabase(): Promise<void> {
    try {
      const patterns = await db
        .select()
        .from(subAgentLearningPatterns)
        .where(eq(subAgentLearningPatterns.patternType, 'provider_distribution'))
        .orderBy(desc(subAgentLearningPatterns.lastObserved))
        .limit(1);

      if (patterns.length > 0) {
        const data = patterns[0].patternData as any;
        if (data?.distribution) {
          this.providerDistribution = this.normalizeDistribution(data.distribution);
        }
      }
    } catch (error: any) {
      console.warn('[SelfImprovementEngine] Could not load provider distribution:', error.message);
    }
  }

  private normalizeDistribution(dist: Partial<ProviderDistribution>): ProviderDistribution {
    const result: ProviderDistribution = {
      mistral: this.clampToRange(dist.mistral ?? PROVIDER_BOUNDS.mistral.target, PROVIDER_BOUNDS.mistral),
      groq: this.clampToRange(dist.groq ?? PROVIDER_BOUNDS.groq.target, PROVIDER_BOUNDS.groq),
      gemini: this.clampToRange(dist.gemini ?? PROVIDER_BOUNDS.gemini.target, PROVIDER_BOUNDS.gemini),
      claude: this.clampToRange(dist.claude ?? PROVIDER_BOUNDS.claude.target, PROVIDER_BOUNDS.claude)
    };

    const total = result.mistral + result.groq + result.gemini + result.claude;
    if (Math.abs(total - 100) > 0.01) {
      const scale = 100 / total;
      result.mistral *= scale;
      result.groq *= scale;
      result.gemini *= scale;
      result.claude *= scale;
    }

    return result;
  }

  private clampToRange(value: number, bounds: ProviderBounds): number {
    return Math.min(Math.max(value, bounds.min), bounds.max);
  }

  async recordSuccess(
    searchId: string,
    officersFound: number,
    provider: AIProviderName,
    durationMs: number,
    tokensUsed: number,
    strategyId?: string,
    context?: OutcomeContext
  ): Promise<void> {
    await this.initialize();

    const leadQuality = Math.min(100, officersFound * 20);
    const efficiency = this.calculateEfficiency(tokensUsed, durationMs, officersFound);

    try {
      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'search_success',
        metricValue: 100,
        taskId: searchId,
        capabilityName: strategyId || 'officer_search',
        context: {
          officersFound,
          provider,
          durationMs,
          tokensUsed,
          leadQuality,
          efficiency,
          ...context
        } as any,
        metadata: { strategyId, searchId } as any
      });

      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'lead_quality',
        metricValue: leadQuality,
        taskId: searchId,
        capabilityName: strategyId || 'officer_search',
        context: { officersFound, provider } as any
      });

      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'latency',
        metricValue: durationMs,
        taskId: searchId,
        capabilityName: strategyId || 'officer_search',
        context: { provider } as any
      });

      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'provider_efficiency',
        metricValue: Math.round(efficiency),
        taskId: searchId,
        capabilityName: provider,
        context: { tokensUsed, durationMs, officersFound } as any
      });

      if (strategyId && this.strategies.has(strategyId)) {
        const strategy = this.strategies.get(strategyId)!;
        strategy.successCount++;
        strategy.score = Math.min(MAX_SCORE, strategy.score + SCORE_INCREMENT);
        strategy.lastUsed = new Date();
        await this.persistStrategyUpdate(strategy);
      }

      console.log(`[SelfImprovementEngine] ✓ Recorded success: ${searchId}, ${officersFound} officers, ${provider}, ${durationMs}ms`);
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error recording success:', error.message);
    }
  }

  async recordFailure(
    searchId: string,
    errorType: string,
    provider: AIProviderName,
    context?: OutcomeContext
  ): Promise<void> {
    await this.initialize();

    try {
      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'search_failure',
        metricValue: 0,
        taskId: searchId,
        capabilityName: context?.strategyId as string || 'officer_search',
        context: {
          errorType,
          provider,
          ...context
        } as any,
        metadata: { errorType, searchId } as any
      });

      const strategyId = context?.strategyId;
      if (strategyId && typeof strategyId === 'string' && this.strategies.has(strategyId)) {
        const strategy = this.strategies.get(strategyId)!;
        strategy.failureCount++;
        strategy.score = Math.max(MIN_SCORE, strategy.score - SCORE_DECREMENT);
        strategy.lastUsed = new Date();
        await this.persistStrategyUpdate(strategy);
      }

      console.log(`[SelfImprovementEngine] ✗ Recorded failure: ${searchId}, ${errorType}, ${provider}`);
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error recording failure:', error.message);
    }
  }

  async updatePatternConfidence(patternId: string, successful: boolean): Promise<void> {
    await this.initialize();

    try {
      const patterns = await db
        .select()
        .from(subAgentLearningPatterns)
        .where(eq(subAgentLearningPatterns.id, patternId))
        .limit(1);

      if (patterns.length === 0) {
        console.warn(`[SelfImprovementEngine] Pattern not found: ${patternId}`);
        return;
      }

      const pattern = patterns[0];
      const oldConfidence = pattern.confidenceScore;
      const adjustment = successful ? CONFIDENCE_INCREMENT : -CONFIDENCE_DECREMENT;
      const newConfidence = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, oldConfidence + adjustment));

      await db
        .update(subAgentLearningPatterns)
        .set({
          confidenceScore: newConfidence,
          timesObserved: pattern.timesObserved + 1,
          lastObserved: new Date(),
          updatedAt: new Date()
        })
        .where(eq(subAgentLearningPatterns.id, patternId));

      await this.logSelfImprovementAction(
        'pattern_learn',
        `Updated pattern ${patternId} confidence: ${oldConfidence} -> ${newConfidence}`,
        { confidenceScore: oldConfidence },
        { confidenceScore: newConfidence },
        'officer_search',
        successful ? 'positive' : 'negative'
      );

      console.log(`[SelfImprovementEngine] Pattern ${patternId} confidence: ${oldConfidence} -> ${newConfidence}`);
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error updating pattern confidence:', error.message);
    }
  }

  async getNextStrategy(): Promise<SearchStrategy> {
    await this.initialize();

    const strategiesArray = Array.from(this.strategies.values());
    
    if (strategiesArray.length === 0) {
      throw new Error('No strategies available');
    }

    if (Math.random() < EPSILON) {
      const randomIndex = Math.floor(Math.random() * strategiesArray.length);
      const selected = strategiesArray[randomIndex];
      console.log(`[SelfImprovementEngine] Exploring strategy: ${selected.name} (score: ${selected.score})`);
      return selected;
    }

    strategiesArray.sort((a, b) => b.score - a.score);
    const topTier = strategiesArray.filter(s => s.score >= strategiesArray[0].score - 5);
    
    const selected = topTier[Math.floor(Math.random() * topTier.length)];
    console.log(`[SelfImprovementEngine] Exploiting strategy: ${selected.name} (score: ${selected.score})`);
    return selected;
  }

  async recordProviderPerformance(
    provider: AIProviderName,
    success: boolean,
    latencyMs: number,
    cost: number,
    tokensUsed?: number
  ): Promise<void> {
    await this.initialize();

    try {
      await db.insert(subAgentPerformanceMetrics).values({
        metricName: `provider_${provider}_request`,
        metricValue: success ? 100 : 0,
        capabilityName: provider,
        context: {
          success,
          latencyMs,
          cost,
          tokensUsed
        } as any
      });

      const efficiency = success 
        ? Math.round(100 - (latencyMs / 100) - (cost * 10))
        : 0;

      await db.insert(subAgentPerformanceMetrics).values({
        metricName: 'provider_efficiency',
        metricValue: Math.max(0, Math.min(100, efficiency)),
        capabilityName: provider,
        context: { latencyMs, cost, tokensUsed, success } as any
      });
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error recording provider performance:', error.message);
    }
  }

  async adjustProviderWeights(): Promise<ProviderDistribution> {
    await this.initialize();

    const stats = await this.getProviderStats(24 * 60);
    const oldDistribution = { ...this.providerDistribution };

    for (const stat of stats) {
      const provider = stat.provider;
      const bounds = PROVIDER_BOUNDS[provider];
      
      if (stat.successRate >= 80 && stat.efficiency >= 70) {
        this.providerDistribution[provider] = Math.min(
          this.providerDistribution[provider] + 2,
          bounds.max
        );
      } else if (stat.successRate < 50 || stat.efficiency < 30) {
        this.providerDistribution[provider] = Math.max(
          this.providerDistribution[provider] - 3,
          bounds.min
        );
      }
    }

    this.providerDistribution = this.normalizeDistribution(this.providerDistribution);

    const hasChanged = Object.keys(this.providerDistribution).some(
      k => Math.abs(this.providerDistribution[k as AIProviderName] - oldDistribution[k as AIProviderName]) > 0.1
    );

    if (hasChanged) {
      await this.persistProviderDistribution();
      await this.logSelfImprovementAction(
        'strategy_change',
        'Adjusted provider distribution based on performance',
        { distribution: oldDistribution },
        { distribution: this.providerDistribution },
        'provider_routing',
        'neutral'
      );
    }

    return this.providerDistribution;
  }

  async evaluateAndImprove(): Promise<EvaluationResult> {
    await this.initialize();

    console.log('[SelfImprovementEngine] Starting nightly evaluation...');
    const startTime = Date.now();
    
    const recommendations: string[] = [];
    const actionsApplied: string[] = [];
    const rollbacksPerformed: string[] = [];

    const kpis = await this.getCurrentKPIs();

    if (kpis.successRate < 50) {
      recommendations.push('Success rate critically low - consider strategy rebalancing');
      await this.boostUnderutilizedStrategies();
      actionsApplied.push('Boosted underutilized strategies');
    }

    if (kpis.averageLatencyMs > 5000) {
      recommendations.push('High latency detected - optimize provider selection');
      const fastestProvider = await this.identifyFastestProvider();
      if (fastestProvider) {
        actionsApplied.push(`Increased weight for faster provider: ${fastestProvider}`);
      }
    }

    const providerEfficiency = Object.values(kpis.providerEfficiency);
    const avgEfficiency = providerEfficiency.reduce((a, b) => a + b, 0) / providerEfficiency.length;
    if (avgEfficiency < 40) {
      recommendations.push('Low overall efficiency - review token usage');
    }

    await this.adjustProviderWeights();
    actionsApplied.push('Rebalanced provider weights');

    const failedImprovements = await this.identifyFailedImprovements();
    for (const improvement of failedImprovements) {
      const result = await this.rollbackImprovement(improvement.id);
      if (result.success) {
        rollbacksPerformed.push(`Rolled back: ${improvement.description}`);
      }
    }

    await this.decayOldPatterns();

    this.lastEvaluationTime = new Date();
    const duration = Date.now() - startTime;

    console.log(`[SelfImprovementEngine] Evaluation completed in ${duration}ms`);
    console.log(`[SelfImprovementEngine] Actions: ${actionsApplied.length}, Rollbacks: ${rollbacksPerformed.length}`);

    const result: EvaluationResult = {
      timestamp: new Date(),
      kpis,
      recommendations,
      actionsApplied,
      rollbacksPerformed
    };

    await this.logSelfImprovementAction(
      'nightly_evaluation',
      `Nightly evaluation completed with ${actionsApplied.length} actions`,
      { previousKPIs: kpis },
      { result },
      'system_wide',
      recommendations.length > 2 ? 'negative' : 'positive',
      false
    );

    return result;
  }

  async rollbackImprovement(actionId: string): Promise<RollbackResult> {
    try {
      const actions = await db
        .select()
        .from(subAgentSelfImprovementActions)
        .where(
          and(
            eq(subAgentSelfImprovementActions.id, actionId),
            eq(subAgentSelfImprovementActions.rollbackAvailable, true),
            eq(subAgentSelfImprovementActions.rolledBack, false)
          )
        )
        .limit(1);

      if (actions.length === 0) {
        return { success: false, actionId, reason: 'Action not found or not rollbackable' };
      }

      const action = actions[0];
      const beforeState = action.beforeState as Record<string, any>;

      if (action.actionType === 'strategy_change' && beforeState?.distribution) {
        this.providerDistribution = this.normalizeDistribution(beforeState.distribution);
        await this.persistProviderDistribution();
      } else if (action.actionType === 'pattern_learn' && beforeState?.confidenceScore !== undefined) {
        const metadata = action.metadata as any;
        if (metadata?.patternId) {
          await db
            .update(subAgentLearningPatterns)
            .set({
              confidenceScore: beforeState.confidenceScore,
              updatedAt: new Date()
            })
            .where(eq(subAgentLearningPatterns.id, metadata.patternId));
        }
      }

      await db
        .update(subAgentSelfImprovementActions)
        .set({
          rolledBack: true,
          rollbackReason: 'Automated rollback due to negative impact',
          updatedAt: new Date()
        })
        .where(eq(subAgentSelfImprovementActions.id, actionId));

      await this.logSelfImprovementAction(
        'rollback',
        `Rolled back action: ${action.description}`,
        action.afterState as Record<string, any>,
        action.beforeState as Record<string, any>,
        action.capabilityAffected || 'unknown',
        'neutral'
      );

      console.log(`[SelfImprovementEngine] Rolled back action: ${actionId}`);

      return { success: true, actionId, restoredState: beforeState };
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Rollback error:', error.message);
      return { success: false, actionId, reason: error.message };
    }
  }

  async getCurrentKPIs(): Promise<KPISnapshot> {
    const windowMinutes = 24 * 60;
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    try {
      const successResults = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          successes: sql<number>`COUNT(*) FILTER (WHERE ${subAgentPerformanceMetrics.metricValue} = 100)::int`
        })
        .from(subAgentPerformanceMetrics)
        .where(
          and(
            sql`${subAgentPerformanceMetrics.metricName} IN ('search_success', 'search_failure')`,
            gte(subAgentPerformanceMetrics.measuredAt, windowStart)
          )
        );

      const total = successResults[0]?.total || 0;
      const successes = successResults[0]?.successes || 0;
      const successRate = total > 0 ? (successes / total) * 100 : 50;

      const qualityResults = await db
        .select({
          avgQuality: sql<number>`AVG(${subAgentPerformanceMetrics.metricValue})::int`
        })
        .from(subAgentPerformanceMetrics)
        .where(
          and(
            eq(subAgentPerformanceMetrics.metricName, 'lead_quality'),
            gte(subAgentPerformanceMetrics.measuredAt, windowStart)
          )
        );
      const leadQuality = qualityResults[0]?.avgQuality || 50;

      const latencyResults = await db
        .select({
          avgLatency: sql<number>`AVG(${subAgentPerformanceMetrics.metricValue})::int`
        })
        .from(subAgentPerformanceMetrics)
        .where(
          and(
            eq(subAgentPerformanceMetrics.metricName, 'latency'),
            gte(subAgentPerformanceMetrics.measuredAt, windowStart)
          )
        );
      const averageLatencyMs = latencyResults[0]?.avgLatency || 1000;

      const costResults = await db
        .select({
          totalTokens: sql<number>`SUM((${subAgentPerformanceMetrics.context}->>'tokensUsed')::int)::int`,
          officersFound: sql<number>`SUM((${subAgentPerformanceMetrics.context}->>'officersFound')::int)::int`
        })
        .from(subAgentPerformanceMetrics)
        .where(
          and(
            eq(subAgentPerformanceMetrics.metricName, 'search_success'),
            gte(subAgentPerformanceMetrics.measuredAt, windowStart)
          )
        );
      
      const totalTokens = costResults[0]?.totalTokens || 0;
      const officersFound = costResults[0]?.officersFound || 1;
      const costPerOfficer = officersFound > 0 ? (totalTokens * 0.00002) / officersFound : 0;

      const providerEfficiency: Record<AIProviderName, number> = {
        mistral: 50,
        groq: 50,
        gemini: 50,
        claude: 50
      };

      const providers: AIProviderName[] = ['mistral', 'groq', 'gemini', 'claude'];
      for (const provider of providers) {
        const effResults = await db
          .select({
            avgEfficiency: sql<number>`AVG(${subAgentPerformanceMetrics.metricValue})::int`
          })
          .from(subAgentPerformanceMetrics)
          .where(
            and(
              eq(subAgentPerformanceMetrics.metricName, 'provider_efficiency'),
              eq(subAgentPerformanceMetrics.capabilityName, provider),
              gte(subAgentPerformanceMetrics.measuredAt, windowStart)
            )
          );
        providerEfficiency[provider] = effResults[0]?.avgEfficiency || 50;
      }

      return {
        timestamp: new Date(),
        successRate,
        leadQuality,
        averageLatencyMs,
        costPerOfficer,
        providerEfficiency
      };
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error getting KPIs:', error.message);
      return {
        timestamp: new Date(),
        successRate: 50,
        leadQuality: 50,
        averageLatencyMs: 1000,
        costPerOfficer: 0,
        providerEfficiency: { mistral: 50, groq: 50, gemini: 50, claude: 50 }
      };
    }
  }

  async getProviderStats(windowMinutes: number = 60): Promise<ProviderStats[]> {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
    const stats: ProviderStats[] = [];

    const providers: AIProviderName[] = ['mistral', 'groq', 'gemini', 'claude'];

    for (const provider of providers) {
      try {
        const results = await db
          .select({
            total: sql<number>`COUNT(*)::int`,
            successes: sql<number>`COUNT(*) FILTER (WHERE ${subAgentPerformanceMetrics.metricValue} = 100)::int`,
            avgLatency: sql<number>`AVG((${subAgentPerformanceMetrics.context}->>'latencyMs')::int)::int`,
            totalTokens: sql<number>`SUM((${subAgentPerformanceMetrics.context}->>'tokensUsed')::int)::int`,
            totalCost: sql<number>`SUM((${subAgentPerformanceMetrics.context}->>'cost')::float)::float`
          })
          .from(subAgentPerformanceMetrics)
          .where(
            and(
              sql`${subAgentPerformanceMetrics.metricName} LIKE 'provider_${provider}%'`,
              gte(subAgentPerformanceMetrics.measuredAt, windowStart)
            )
          );

        const result = results[0];
        const total = result?.total || 0;
        const successes = result?.successes || 0;
        const successRate = total > 0 ? (successes / total) * 100 : 50;

        stats.push({
          provider,
          totalRequests: total,
          successfulRequests: successes,
          successRate,
          averageLatencyMs: result?.avgLatency || 0,
          totalTokensUsed: result?.totalTokens || 0,
          totalCost: result?.totalCost || 0,
          efficiency: this.calculateProviderEfficiency(successRate, result?.avgLatency || 1000, result?.totalCost || 0)
        });
      } catch (error: any) {
        console.warn(`[SelfImprovementEngine] Could not get stats for ${provider}:`, error.message);
        stats.push({
          provider,
          totalRequests: 0,
          successfulRequests: 0,
          successRate: 50,
          averageLatencyMs: 0,
          totalTokensUsed: 0,
          totalCost: 0,
          efficiency: 50
        });
      }
    }

    return stats;
  }

  getProviderDistribution(): ProviderDistribution {
    return { ...this.providerDistribution };
  }

  getStrategies(): SearchStrategy[] {
    return Array.from(this.strategies.values());
  }

  getProviderBounds(): Record<AIProviderName, ProviderBounds> {
    return { ...PROVIDER_BOUNDS };
  }

  private calculateEfficiency(tokensUsed: number, durationMs: number, officersFound: number): number {
    if (officersFound === 0) return 0;
    
    const tokenEfficiency = 100 - Math.min(100, (tokensUsed / 1000) * 10);
    const timeEfficiency = 100 - Math.min(100, (durationMs / 100));
    const resultEfficiency = Math.min(100, officersFound * 25);
    
    return (tokenEfficiency * 0.3 + timeEfficiency * 0.3 + resultEfficiency * 0.4);
  }

  private calculateProviderEfficiency(successRate: number, latencyMs: number, cost: number): number {
    const successWeight = successRate * 0.5;
    const latencyWeight = Math.max(0, 100 - (latencyMs / 50)) * 0.3;
    const costWeight = Math.max(0, 100 - (cost * 100)) * 0.2;
    
    return Math.round(successWeight + latencyWeight + costWeight);
  }

  private async persistStrategyUpdate(strategy: SearchStrategy): Promise<void> {
    try {
      const existing = await db
        .select()
        .from(subAgentLearningPatterns)
        .where(
          and(
            eq(subAgentLearningPatterns.patternType, 'search_strategy'),
            sql`${subAgentLearningPatterns.patternData}->>'strategyId' = ${strategy.id}`
          )
        )
        .limit(1);

      const patternData = {
        strategyId: strategy.id,
        name: strategy.name,
        description: strategy.description,
        successCount: strategy.successCount,
        failureCount: strategy.failureCount,
        parameters: strategy.parameters
      };

      if (existing.length > 0) {
        await db
          .update(subAgentLearningPatterns)
          .set({
            confidenceScore: strategy.score,
            patternData: patternData as any,
            lastObserved: new Date(),
            timesObserved: existing[0].timesObserved + 1,
            updatedAt: new Date()
          })
          .where(eq(subAgentLearningPatterns.id, existing[0].id));
      } else {
        await db.insert(subAgentLearningPatterns).values({
          patternType: 'search_strategy',
          patternData: patternData as any,
          confidenceScore: strategy.score,
          timesObserved: 1,
          lastObserved: new Date(),
          associatedCapabilities: ['officer_search'],
          impact: 'medium'
        });
      }
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error persisting strategy:', error.message);
    }
  }

  private async persistProviderDistribution(): Promise<void> {
    try {
      const existing = await db
        .select()
        .from(subAgentLearningPatterns)
        .where(eq(subAgentLearningPatterns.patternType, 'provider_distribution'))
        .limit(1);

      const patternData = {
        distribution: this.providerDistribution,
        bounds: PROVIDER_BOUNDS,
        updatedAt: new Date().toISOString()
      };

      if (existing.length > 0) {
        await db
          .update(subAgentLearningPatterns)
          .set({
            patternData: patternData as any,
            lastObserved: new Date(),
            timesObserved: existing[0].timesObserved + 1,
            updatedAt: new Date()
          })
          .where(eq(subAgentLearningPatterns.id, existing[0].id));
      } else {
        await db.insert(subAgentLearningPatterns).values({
          patternType: 'provider_distribution',
          patternData: patternData as any,
          confidenceScore: 80,
          timesObserved: 1,
          lastObserved: new Date(),
          associatedCapabilities: ['provider_routing'],
          impact: 'high'
        });
      }
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error persisting distribution:', error.message);
    }
  }

  private async logSelfImprovementAction(
    actionType: string,
    description: string,
    beforeState: Record<string, any> | null,
    afterState: Record<string, any> | null,
    capabilityAffected: string,
    impact: 'positive' | 'negative' | 'neutral',
    rollbackAvailable: boolean = true
  ): Promise<string> {
    try {
      const result = await db.insert(subAgentSelfImprovementActions).values({
        actionType,
        description,
        beforeState: beforeState as any,
        afterState: afterState as any,
        rollbackAvailable,
        rolledBack: false,
        impact,
        capabilityAffected,
        metadata: {
          timestamp: new Date().toISOString(),
          engine: 'SelfImprovementEngine'
        } as any
      }).returning({ id: subAgentSelfImprovementActions.id });

      const actionId = result[0]?.id || 'unknown';
      console.log(`[SelfImprovementEngine] Logged action: ${actionType} (${actionId})`);
      return actionId;
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error logging action:', error.message);
      return 'error';
    }
  }

  private async boostUnderutilizedStrategies(): Promise<void> {
    const strategies = Array.from(this.strategies.values());
    const avgScore = strategies.reduce((sum, s) => sum + s.score, 0) / strategies.length;

    for (const strategy of strategies) {
      if (strategy.score < avgScore && strategy.successCount + strategy.failureCount < 10) {
        strategy.score = Math.min(MAX_SCORE, strategy.score + 5);
        await this.persistStrategyUpdate(strategy);
      }
    }
  }

  private async identifyFastestProvider(): Promise<AIProviderName | null> {
    const stats = await this.getProviderStats(60);
    const validStats = stats.filter(s => s.totalRequests >= 5);
    
    if (validStats.length === 0) return null;
    
    validStats.sort((a, b) => a.averageLatencyMs - b.averageLatencyMs);
    return validStats[0].provider;
  }

  private async identifyFailedImprovements(): Promise<SubAgentSelfImprovementAction[]> {
    try {
      const recentActions = await db
        .select()
        .from(subAgentSelfImprovementActions)
        .where(
          and(
            eq(subAgentSelfImprovementActions.impact, 'negative'),
            eq(subAgentSelfImprovementActions.rollbackAvailable, true),
            eq(subAgentSelfImprovementActions.rolledBack, false),
            gte(subAgentSelfImprovementActions.implementedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
          )
        )
        .orderBy(desc(subAgentSelfImprovementActions.implementedAt))
        .limit(5);

      return recentActions;
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error identifying failed improvements:', error.message);
      return [];
    }
  }

  private async decayOldPatterns(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      await db
        .update(subAgentLearningPatterns)
        .set({
          confidenceScore: sql`GREATEST(0, ${subAgentLearningPatterns.confidenceScore} - 5)`,
          updatedAt: new Date()
        })
        .where(
          and(
            lte(subAgentLearningPatterns.lastObserved, cutoffDate),
            sql`${subAgentLearningPatterns.confidenceScore} > 20`
          )
        );

      console.log('[SelfImprovementEngine] Decayed old patterns');
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error decaying patterns:', error.message);
    }
  }

  async getImprovementHistory(limit: number = 50): Promise<SubAgentSelfImprovementAction[]> {
    try {
      return await db
        .select()
        .from(subAgentSelfImprovementActions)
        .orderBy(desc(subAgentSelfImprovementActions.implementedAt))
        .limit(limit);
    } catch (error: any) {
      console.error('[SelfImprovementEngine] Error getting history:', error.message);
      return [];
    }
  }

  async getPerformanceTrends(days: number = 7): Promise<KPISnapshot[]> {
    const snapshots: KPISnapshot[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const dayEnd = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);

      try {
        const successResults = await db
          .select({
            total: sql<number>`COUNT(*)::int`,
            successes: sql<number>`COUNT(*) FILTER (WHERE ${subAgentPerformanceMetrics.metricValue} = 100)::int`
          })
          .from(subAgentPerformanceMetrics)
          .where(
            and(
              sql`${subAgentPerformanceMetrics.metricName} IN ('search_success', 'search_failure')`,
              gte(subAgentPerformanceMetrics.measuredAt, dayStart),
              lte(subAgentPerformanceMetrics.measuredAt, dayEnd)
            )
          );

        const total = successResults[0]?.total || 0;
        const successes = successResults[0]?.successes || 0;
        const successRate = total > 0 ? (successes / total) * 100 : 50;

        snapshots.push({
          timestamp: dayStart,
          successRate,
          leadQuality: 50,
          averageLatencyMs: 1000,
          costPerOfficer: 0,
          providerEfficiency: { mistral: 50, groq: 50, gemini: 50, claude: 50 }
        });
      } catch (error: any) {
        snapshots.push({
          timestamp: dayStart,
          successRate: 50,
          leadQuality: 50,
          averageLatencyMs: 1000,
          costPerOfficer: 0,
          providerEfficiency: { mistral: 50, groq: 50, gemini: 50, claude: 50 }
        });
      }
    }

    return snapshots.reverse();
  }
}

export const selfImprovementEngine = SelfImprovementEngine.getInstance();
export default selfImprovementEngine;
