/**
 * Neural Spine - Kriptera Adapter
 * 
 * Integration layer for Kriptera (Crypto/Crawler sensorimotor core).
 * 
 * Whenever Kriptera:
 * - Completes a crawl
 * - Finishes a Monte Carlo enhancement pass
 * - Generates a report
 * - Executes an arbitrage decision
 * 
 * This adapter records the experience and queries for learned patterns.
 */

import {
  recordExperience,
  querySynapses,
  getSynapsesForContext,
  recordCrossRegionExperience,
  NeuralSynapse
} from '../spine_hub';
import { makeInputFingerprint } from '../context_fingerprint';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CrawlResult {
  crawlerType: 'osint' | 'legal' | 'crypto' | 'gps';
  sourcesProcessed: number;
  itemsCrawled: number;
  errors: number;
  durationMs: number;
  findings?: unknown;
}

export interface MonteCarloResult {
  targetComponent: string;
  passesCompleted: number;
  scoreBefore: number;
  scoreAfter: number;
  improvementPercent: number;
}

export interface ArbitrageDecision {
  pair: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedProfit: number;
  actualProfit?: number;
  executed: boolean;
}

export interface KripteraPatternHint {
  synapse: NeuralSynapse;
  suggestion: string;
  confidence: number;
}

// ============================================================================
// KRIPTERA ADAPTER CLASS
// ============================================================================

class KripteraAdapter {
  private static instance: KripteraAdapter;

  private constructor() {}

  static getInstance(): KripteraAdapter {
    if (!KripteraAdapter.instance) {
      KripteraAdapter.instance = new KripteraAdapter();
    }
    return KripteraAdapter.instance;
  }

  /**
   * Record a completed crawl experience
   */
  async recordCrawlExperience(
    taskSummary: string,
    config: Record<string, unknown>,
    result: CrawlResult
  ): Promise<void> {
    // Calculate reward based on crawl quality
    const successRate = result.sourcesProcessed > 0
      ? (result.itemsCrawled - result.errors) / result.sourcesProcessed
      : 0;
    
    const rewardScore = Math.min(1, Math.max(0,
      successRate * 0.6 +
      (result.errors === 0 ? 0.2 : 0) +
      (result.durationMs < 30000 ? 0.2 : 0.1)  // Bonus for fast crawls
    ));

    await recordExperience({
      region: 'kriptera',
      agent: 'kriptera-crawler',
      prompt: taskSummary,
      params: config,
      result: {
        crawlerType: result.crawlerType,
        itemsCrawled: result.itemsCrawled,
        successRate,
        durationMs: result.durationMs
      },
      rewardScore,
      tags: ['crypto', 'crawler', result.crawlerType],
      metadata: {
        sourcesProcessed: result.sourcesProcessed,
        errors: result.errors,
        latencyMs: result.durationMs
      }
    });

    console.log(`[KripteraAdapter] Recorded crawl experience: reward=${rewardScore.toFixed(3)}`);
  }

  /**
   * Record a Monte Carlo enhancement pass
   */
  async recordMonteCarloExperience(
    taskSummary: string,
    config: Record<string, unknown>,
    result: MonteCarloResult
  ): Promise<void> {
    // Reward based on improvement achieved
    const rewardScore = Math.min(1, Math.max(0,
      result.improvementPercent / 20 +  // Up to 0.5 for 10% improvement
      (result.scoreAfter > result.scoreBefore ? 0.3 : 0) +
      (result.passesCompleted >= 10 ? 0.2 : 0.1)
    ));

    await recordExperience({
      region: 'kriptera',
      agent: 'kriptera-montecarlo',
      prompt: taskSummary,
      params: config,
      result: {
        component: result.targetComponent,
        scoreBefore: result.scoreBefore,
        scoreAfter: result.scoreAfter,
        improvement: result.improvementPercent
      },
      rewardScore,
      tags: ['crypto', 'montecarlo', 'optimization'],
      metadata: {
        passes: result.passesCompleted,
        improvementPct: result.improvementPercent
      }
    });

    console.log(`[KripteraAdapter] Recorded Monte Carlo experience: improvement=${result.improvementPercent.toFixed(2)}%`);
  }

  /**
   * Record an arbitrage decision and outcome
   */
  async recordArbitrageExperience(
    marketContext: string,
    decision: ArbitrageDecision
  ): Promise<void> {
    // Reward based on actual profit or expected profit if not executed
    let rewardScore: number;
    
    if (decision.executed && decision.actualProfit !== undefined) {
      // Real outcome - reward based on actual profit
      rewardScore = Math.min(1, Math.max(0,
        decision.actualProfit > 0 ? 0.7 + (decision.actualProfit / 100) * 0.3 : 0.2
      ));
    } else {
      // Predicted outcome - moderate reward based on confidence
      rewardScore = decision.confidence * 0.5;
    }

    await recordExperience({
      region: 'kriptera',
      agent: 'kriptera-arbitrage',
      prompt: marketContext,
      params: {
        pair: decision.pair,
        action: decision.action
      },
      result: {
        executed: decision.executed,
        expectedProfit: decision.expectedProfit,
        actualProfit: decision.actualProfit,
        success: decision.actualProfit !== undefined ? decision.actualProfit > 0 : null
      },
      rewardScore,
      tags: ['crypto', 'arbitrage', decision.pair],
      metadata: {
        confidence: decision.confidence,
        profitPct: decision.actualProfit
      }
    });

    console.log(`[KripteraAdapter] Recorded arbitrage experience: ${decision.action} ${decision.pair}`);
  }

  /**
   * Query learned patterns for a new crypto task
   */
  async getPatternHints(
    taskDescription: string,
    params?: Record<string, unknown>
  ): Promise<KripteraPatternHint[]> {
    const fingerprint = makeInputFingerprint(taskDescription, 'kriptera', 'kriptera-core', params);
    
    const synapses = await querySynapses({
      region: 'kriptera',
      fingerprint,
      maxResults: 10,
      minWeight: 0.3,
      minConfidence: 0.4
    });

    return synapses.map(synapse => ({
      synapse,
      suggestion: this.generateSuggestion(synapse),
      confidence: synapse.weight * synapse.confidence
    }));
  }

  /**
   * Get best crawler configuration based on learned patterns
   */
  async getBestCrawlerConfig(
    crawlerType: string,
    targetDescription: string
  ): Promise<{ endpoints?: string[]; params?: Record<string, unknown>; confidence: number }> {
    const patterns = await this.getPatternHints(
      `${crawlerType} crawler: ${targetDescription}`,
      { crawlerType }
    );

    if (patterns.length === 0) {
      return { confidence: 0 };
    }

    // Use the strongest pattern
    const best = patterns[0];
    
    return {
      confidence: best.confidence,
      // Extract learned parameters from synapse metadata if available
      params: {
        learnedFromSynapse: best.synapse.id,
        weight: best.synapse.weight
      }
    };
  }

  /**
   * Record when Kriptera helps 4Ji
   */
  async recordCollaborationWith4Ji(
    request: string,
    result: unknown,
    success: boolean
  ): Promise<void> {
    await recordCrossRegionExperience(
      '4ji_core',
      'kriptera',
      request,
      result,
      success ? 0.8 : 0.3,
      { collaborationType: '4ji-to-kriptera' }
    );
  }

  /**
   * Generate a suggestion string from a synapse
   */
  private generateSuggestion(synapse: NeuralSynapse): string {
    const tags = synapse.tags.join(', ');
    return `Pattern (weight: ${synapse.weight.toFixed(2)}, confidence: ${synapse.confidence.toFixed(2)}): ${tags}`;
  }
}

// Export singleton
export const kripteraAdapter = KripteraAdapter.getInstance();

// Export convenience functions
export async function recordCrawlExperience(
  taskSummary: string,
  config: Record<string, unknown>,
  result: CrawlResult
): Promise<void> {
  await kripteraAdapter.recordCrawlExperience(taskSummary, config, result);
}

export async function recordMonteCarloExperience(
  taskSummary: string,
  config: Record<string, unknown>,
  result: MonteCarloResult
): Promise<void> {
  await kripteraAdapter.recordMonteCarloExperience(taskSummary, config, result);
}

export async function recordArbitrageExperience(
  marketContext: string,
  decision: ArbitrageDecision
): Promise<void> {
  await kripteraAdapter.recordArbitrageExperience(marketContext, decision);
}

export async function getKripteraPatternHints(
  taskDescription: string,
  params?: Record<string, unknown>
): Promise<KripteraPatternHint[]> {
  return kripteraAdapter.getPatternHints(taskDescription, params);
}

export async function getBestCrawlerConfig(
  crawlerType: string,
  targetDescription: string
) {
  return kripteraAdapter.getBestCrawlerConfig(crawlerType, targetDescription);
}

export default kripteraAdapter;
