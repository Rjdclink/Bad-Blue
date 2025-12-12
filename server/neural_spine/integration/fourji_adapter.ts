/**
 * Neural Spine - 4Ji Adapter
 * 
 * Integration layer for 4Ji (Executive Cortex - Central Orchestrator).
 * 
 * 4Ji sits at the top of the neural hierarchy. For each domain sub-agent
 * 4Ji spins up (family-law, OSINT, inmate locator, etc.):
 * - Records completion events
 * - Computes rewards from correctness metrics, user feedback, validators
 * - Uses learned patterns to select best sub-agent clusters and tool-chains
 * 
 * Respects Evolution Lock: When locked, 4Ji's synapses cannot be modified.
 */

import {
  recordExperience,
  querySynapses,
  getSynapsesForContext,
  recordCrossRegionExperience,
  NeuralSynapse
} from '../spine_hub';
import { makeInputFingerprint, makeContextHash } from '../context_fingerprint';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SubAgentTaskResult {
  domainId: string;
  taskType: string;
  success: boolean;
  correctnessScore: number;      // 0-1 from validators
  userFeedback?: 'positive' | 'negative' | 'neutral';
  monteCarloAgreement?: number;  // 0-1 agreement score
  redundancyChecks?: number;     // Number of redundancy validations passed
  durationMs: number;
  outputSummary?: string;
}

export interface OrchestratorDecision {
  requestType: string;
  subAgentsUsed: string[];
  crawlersUsed: string[];
  llmEnsembleUsed: string[];
  toolChain: string[];
  success: boolean;
  confidenceScore: number;
}

export interface EvolutionLockState {
  locked: boolean;
  lockedAt?: Date;
  reason?: string;
}

export interface FourJiPatternHint {
  synapse: NeuralSynapse;
  suggestion: string;
  confidence: number;
  recommendedSubAgents?: string[];
  recommendedToolChain?: string[];
}

// ============================================================================
// EVOLUTION LOCK CHECKER
// ============================================================================

let evolutionLockState: EvolutionLockState = {
  locked: false
};

/**
 * Check if 4Ji's evolution is locked
 * When locked, 4Ji's synapses cannot be modified, but can still be queried
 */
export function isEvolutionLocked(): boolean {
  return evolutionLockState.locked;
}

/**
 * Set evolution lock state
 */
export function setEvolutionLock(locked: boolean, reason?: string): void {
  evolutionLockState = {
    locked,
    lockedAt: locked ? new Date() : undefined,
    reason
  };
  console.log(`[4JiAdapter] Evolution lock ${locked ? 'ENGAGED' : 'RELEASED'}: ${reason || 'no reason'}`);
}

/**
 * Get current evolution lock state
 */
export function getEvolutionLockState(): EvolutionLockState {
  return { ...evolutionLockState };
}

// ============================================================================
// 4JI ADAPTER CLASS
// ============================================================================

class FourJiAdapter {
  private static instance: FourJiAdapter;

  private constructor() {}

  static getInstance(): FourJiAdapter {
    if (!FourJiAdapter.instance) {
      FourJiAdapter.instance = new FourJiAdapter();
    }
    return FourJiAdapter.instance;
  }

  /**
   * Record a sub-agent task completion
   * 
   * Respects Evolution Lock - when locked, events are logged but synapses
   * for 4ji_core region are NOT updated.
   */
  async recordSubAgentTask(
    taskDescription: string,
    params: Record<string, unknown>,
    result: SubAgentTaskResult
  ): Promise<void> {
    // Calculate reward score
    let rewardScore = result.correctnessScore * 0.4;
    
    if (result.success) rewardScore += 0.2;
    
    if (result.userFeedback === 'positive') rewardScore += 0.2;
    else if (result.userFeedback === 'negative') rewardScore -= 0.1;
    
    if (result.monteCarloAgreement !== undefined) {
      rewardScore += result.monteCarloAgreement * 0.1;
    }
    
    if (result.redundancyChecks !== undefined && result.redundancyChecks > 0) {
      rewardScore += Math.min(0.1, result.redundancyChecks * 0.02);
    }
    
    rewardScore = Math.min(1, Math.max(0, rewardScore));

    // Check Evolution Lock
    if (isEvolutionLocked()) {
      console.log(`[4JiAdapter] Evolution LOCKED - logging event but NOT updating synapses`);
      // Still log the event for audit purposes, but with a flag
      await recordExperience({
        region: '4ji_core',
        agent: `4ji-subagent-${result.domainId}`,
        prompt: taskDescription,
        params: {
          ...params,
          _evolutionLocked: true,
          _skipSynapseUpdate: true
        },
        result: {
          domain: result.domainId,
          taskType: result.taskType,
          success: result.success,
          correctness: result.correctnessScore
        },
        rewardScore: 0, // Zero reward when locked - no synapse updates
        tags: ['4ji', 'subagent', result.domainId, result.taskType, 'evolution-locked'],
        metadata: {
          durationMs: result.durationMs,
          userFeedback: result.userFeedback,
          monteCarloAgreement: result.monteCarloAgreement,
          actualRewardScore: rewardScore // Store actual for reference
        }
      });
      return;
    }

    // Normal recording with synapse updates
    await recordExperience({
      region: '4ji_core',
      agent: `4ji-subagent-${result.domainId}`,
      prompt: taskDescription,
      params,
      result: {
        domain: result.domainId,
        taskType: result.taskType,
        success: result.success,
        correctness: result.correctnessScore,
        output: result.outputSummary
      },
      rewardScore,
      tags: ['4ji', 'subagent', result.domainId, result.taskType],
      metadata: {
        durationMs: result.durationMs,
        userFeedback: result.userFeedback,
        monteCarloAgreement: result.monteCarloAgreement,
        redundancyChecks: result.redundancyChecks
      }
    });

    console.log(`[4JiAdapter] Recorded sub-agent task: ${result.domainId}/${result.taskType}, reward=${rewardScore.toFixed(3)}`);
  }

  /**
   * Record an orchestrator decision
   */
  async recordOrchestratorDecision(
    userRequest: string,
    context: Record<string, unknown>,
    decision: OrchestratorDecision
  ): Promise<void> {
    if (isEvolutionLocked()) {
      console.log(`[4JiAdapter] Evolution LOCKED - skipping orchestrator synapse update`);
      return;
    }

    const rewardScore = decision.success
      ? 0.5 + decision.confidenceScore * 0.5
      : 0.2;

    await recordExperience({
      region: '4ji_core',
      agent: '4ji-orchestrator',
      prompt: userRequest,
      params: context,
      result: {
        requestType: decision.requestType,
        subAgents: decision.subAgentsUsed,
        crawlers: decision.crawlersUsed,
        toolChain: decision.toolChain,
        success: decision.success
      },
      rewardScore,
      tags: ['4ji', 'orchestrator', decision.requestType, ...decision.subAgentsUsed],
      metadata: {
        llmEnsemble: decision.llmEnsembleUsed,
        confidence: decision.confidenceScore
      }
    });

    console.log(`[4JiAdapter] Recorded orchestrator decision: ${decision.requestType}`);
  }

  /**
   * Record when 4Ji delegates to Kriptera
   */
  async recordDelegationToKriptera(
    request: string,
    result: unknown,
    success: boolean
  ): Promise<void> {
    if (isEvolutionLocked()) {
      console.log(`[4JiAdapter] Evolution LOCKED - cross-region synapse not updated`);
      return;
    }

    await recordCrossRegionExperience(
      '4ji_core',
      'kriptera',
      request,
      result,
      success ? 0.85 : 0.2,
      { delegationType: '4ji-to-kriptera' }
    );
  }

  /**
   * Record when 4Ji delegates to Lexara
   */
  async recordDelegationToLexara(
    request: string,
    result: unknown,
    success: boolean
  ): Promise<void> {
    if (isEvolutionLocked()) {
      console.log(`[4JiAdapter] Evolution LOCKED - cross-region synapse not updated`);
      return;
    }

    await recordCrossRegionExperience(
      '4ji_core',
      'lexara',
      request,
      result,
      success ? 0.85 : 0.2,
      { delegationType: '4ji-to-lexara' }
    );
  }

  /**
   * Query learned patterns for planning a new task
   * 
   * This is how 4Ji recalls successful tool-chains and sub-agent clusters
   * from similar past situations.
   */
  async getPatternHints(
    userRequest: string,
    context?: {
      intent?: string;
      domain?: string;
      riskLevel?: 'low' | 'medium' | 'high';
    }
  ): Promise<FourJiPatternHint[]> {
    const fingerprint = makeInputFingerprint(
      userRequest,
      '4ji_core',
      '4ji-orchestrator',
      context
    );

    const synapses = await querySynapses({
      region: '4ji_core',
      fingerprint,
      maxResults: 15,
      minWeight: 0.3,
      minConfidence: 0.4
    });

    return synapses.map(synapse => ({
      synapse,
      suggestion: this.generateSuggestion(synapse),
      confidence: synapse.weight * synapse.confidence,
      recommendedSubAgents: this.extractSubAgents(synapse.tags),
      recommendedToolChain: this.extractToolChain(synapse.tags)
    }));
  }

  /**
   * Get best sub-agent cluster for a task
   */
  async getBestSubAgentCluster(
    taskDescription: string,
    domain?: string
  ): Promise<{
    subAgents: string[];
    crawlers: string[];
    confidence: number;
  }> {
    const patterns = await this.getPatternHints(taskDescription, { domain });

    if (patterns.length === 0) {
      return { subAgents: [], crawlers: [], confidence: 0 };
    }

    // Aggregate recommendations from top patterns
    const subAgentVotes = new Map<string, number>();
    const crawlerVotes = new Map<string, number>();
    let totalConfidence = 0;

    for (const pattern of patterns.slice(0, 5)) {
      const weight = pattern.confidence;
      totalConfidence += weight;

      pattern.recommendedSubAgents?.forEach(agent => {
        subAgentVotes.set(agent, (subAgentVotes.get(agent) || 0) + weight);
      });

      // Extract crawlers from tags
      pattern.synapse.tags
        .filter(t => t.includes('crawler') || t.includes('osint') || t.includes('legal') || t.includes('crypto'))
        .forEach(crawler => {
          crawlerVotes.set(crawler, (crawlerVotes.get(crawler) || 0) + weight);
        });
    }

    // Get top voted
    const sortedAgents = Array.from(subAgentVotes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([agent]) => agent);

    const sortedCrawlers = Array.from(crawlerVotes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([crawler]) => crawler);

    return {
      subAgents: sortedAgents,
      crawlers: sortedCrawlers,
      confidence: totalConfidence / patterns.slice(0, 5).length
    };
  }

  /**
   * Get recommended LLM ensemble for a task type
   */
  async getRecommendedLLMEnsemble(
    taskType: string
  ): Promise<{
    models: string[];
    routingStrategy: string;
    confidence: number;
  }> {
    const patterns = await this.getPatternHints(`llm routing for ${taskType}`, {
      intent: taskType
    });

    if (patterns.length === 0) {
      return {
        models: ['gemini-pro', 'claude-sonnet'],  // Default ensemble
        routingStrategy: 'primary-fallback',
        confidence: 0.5
      };
    }

    // Default with confidence from patterns
    return {
      models: ['gemini-pro', 'claude-sonnet', 'groq-llama'],
      routingStrategy: 'weighted',
      confidence: patterns[0].confidence
    };
  }

  /**
   * Generate suggestion from synapse
   */
  private generateSuggestion(synapse: NeuralSynapse): string {
    const relevantTags = synapse.tags
      .filter(t => !['4ji', 'orchestrator', 'subagent'].includes(t))
      .join(', ');
    return `4Ji pattern (w: ${synapse.weight.toFixed(2)}, c: ${synapse.confidence.toFixed(2)}): ${relevantTags || 'general'}`;
  }

  /**
   * Extract sub-agents from tags
   */
  private extractSubAgents(tags: string[]): string[] {
    const subAgentPrefixes = ['family-law', 'criminal', 'civil', 'osint', 'inmate', 'legal', 'crypto'];
    return tags.filter(tag => 
      subAgentPrefixes.some(prefix => tag.toLowerCase().includes(prefix))
    );
  }

  /**
   * Extract tool chain from tags
   */
  private extractToolChain(tags: string[]): string[] {
    const toolKeywords = ['crawler', 'search', 'analyze', 'generate', 'validate'];
    return tags.filter(tag =>
      toolKeywords.some(keyword => tag.toLowerCase().includes(keyword))
    );
  }
}

// Export singleton
export const fourJiAdapter = FourJiAdapter.getInstance();

// Export convenience functions
export async function recordSubAgentTask(
  taskDescription: string,
  params: Record<string, unknown>,
  result: SubAgentTaskResult
): Promise<void> {
  await fourJiAdapter.recordSubAgentTask(taskDescription, params, result);
}

export async function recordOrchestratorDecision(
  userRequest: string,
  context: Record<string, unknown>,
  decision: OrchestratorDecision
): Promise<void> {
  await fourJiAdapter.recordOrchestratorDecision(userRequest, context, decision);
}

export async function getFourJiPatternHints(
  userRequest: string,
  context?: { intent?: string; domain?: string; riskLevel?: 'low' | 'medium' | 'high' }
): Promise<FourJiPatternHint[]> {
  return fourJiAdapter.getPatternHints(userRequest, context);
}

export async function getBestSubAgentCluster(
  taskDescription: string,
  domain?: string
) {
  return fourJiAdapter.getBestSubAgentCluster(taskDescription, domain);
}

export async function getRecommendedLLMEnsemble(taskType: string) {
  return fourJiAdapter.getRecommendedLLMEnsemble(taskType);
}

export default fourJiAdapter;
