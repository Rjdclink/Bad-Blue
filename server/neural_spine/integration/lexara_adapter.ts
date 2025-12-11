/**
 * Neural Spine - Lexara Adapter
 * 
 * Integration layer for Lexara (Voice/Communications interface).
 * 
 * Whenever Lexara:
 * - Processes a two-way conversation
 * - Resolves a command
 * - Routes something to 4Ji
 * - Fixes a user-facing failure
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

export interface ConversationResult {
  utteranceCount: number;
  turnsTaken: number;
  resolved: boolean;
  userSatisfied?: boolean;
  errorOccurred: boolean;
  routedTo4Ji: boolean;
  durationMs: number;
}

export interface CommandResolution {
  command: string;
  intent: string;
  resolved: boolean;
  actionTaken: string;
  confidence: number;
  fallbackUsed: boolean;
}

export interface VoiceInteraction {
  inputText: string;
  outputText: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  clarificationNeeded: boolean;
  successfulResponse: boolean;
}

export interface LexaraPatternHint {
  synapse: NeuralSynapse;
  suggestion: string;
  confidence: number;
  recommendedFlow?: string;
}

// ============================================================================
// LEXARA ADAPTER CLASS
// ============================================================================

class LexaraAdapter {
  private static instance: LexaraAdapter;

  private constructor() {}

  static getInstance(): LexaraAdapter {
    if (!LexaraAdapter.instance) {
      LexaraAdapter.instance = new LexaraAdapter();
    }
    return LexaraAdapter.instance;
  }

  /**
   * Record a conversation experience
   */
  async recordConversationExperience(
    userUtterances: string[],
    context: Record<string, unknown>,
    result: ConversationResult
  ): Promise<void> {
    // Calculate reward based on conversation quality
    let rewardScore = 0;
    
    // Base score for resolution
    if (result.resolved) rewardScore += 0.4;
    
    // Bonus for user satisfaction
    if (result.userSatisfied === true) rewardScore += 0.3;
    else if (result.userSatisfied === false) rewardScore -= 0.2;
    
    // Penalty for errors
    if (result.errorOccurred) rewardScore -= 0.2;
    
    // Bonus for efficient conversations (fewer turns)
    if (result.turnsTaken <= 3) rewardScore += 0.2;
    else if (result.turnsTaken <= 5) rewardScore += 0.1;
    
    // Normalize to 0-1
    rewardScore = Math.min(1, Math.max(0, rewardScore));

    const prompt = userUtterances.join(' | ');

    await recordExperience({
      region: 'lexara',
      agent: 'lexara-conversation',
      prompt,
      params: context,
      result: {
        resolved: result.resolved,
        turns: result.turnsTaken,
        satisfied: result.userSatisfied,
        routed: result.routedTo4Ji
      },
      rewardScore,
      tags: ['voice', 'conversation', result.resolved ? 'resolved' : 'unresolved'],
      metadata: {
        utteranceCount: result.utteranceCount,
        durationMs: result.durationMs,
        errorOccurred: result.errorOccurred
      }
    });

    console.log(`[LexaraAdapter] Recorded conversation: turns=${result.turnsTaken}, reward=${rewardScore.toFixed(3)}`);
  }

  /**
   * Record a command resolution
   */
  async recordCommandExperience(
    userInput: string,
    resolution: CommandResolution
  ): Promise<void> {
    // Reward based on resolution success and confidence
    let rewardScore = 0;
    
    if (resolution.resolved) {
      rewardScore = 0.5 + resolution.confidence * 0.3;
    } else {
      rewardScore = 0.2;
    }
    
    // Penalty for fallback usage
    if (resolution.fallbackUsed) {
      rewardScore -= 0.1;
    }
    
    rewardScore = Math.min(1, Math.max(0, rewardScore));

    await recordExperience({
      region: 'lexara',
      agent: 'lexara-command',
      prompt: userInput,
      params: { intent: resolution.intent },
      result: {
        command: resolution.command,
        action: resolution.actionTaken,
        resolved: resolution.resolved
      },
      rewardScore,
      tags: ['voice', 'command', resolution.intent],
      metadata: {
        confidence: resolution.confidence,
        fallbackUsed: resolution.fallbackUsed
      }
    });

    console.log(`[LexaraAdapter] Recorded command: ${resolution.command} -> ${resolution.actionTaken}`);
  }

  /**
   * Record a voice interaction
   */
  async recordVoiceInteraction(
    interaction: VoiceInteraction
  ): Promise<void> {
    // Reward based on interaction quality
    let rewardScore = 0;
    
    if (interaction.successfulResponse) rewardScore += 0.5;
    if (interaction.sentiment === 'positive') rewardScore += 0.3;
    else if (interaction.sentiment === 'neutral') rewardScore += 0.1;
    if (!interaction.clarificationNeeded) rewardScore += 0.2;
    
    rewardScore = Math.min(1, Math.max(0, rewardScore));

    await recordExperience({
      region: 'lexara',
      agent: 'lexara-voice',
      prompt: interaction.inputText,
      result: {
        response: interaction.outputText.slice(0, 200), // Truncate for storage
        sentiment: interaction.sentiment,
        successful: interaction.successfulResponse
      },
      rewardScore,
      tags: ['voice', 'ui', 'assistant', interaction.sentiment],
      metadata: {
        clarificationNeeded: interaction.clarificationNeeded
      }
    });
  }

  /**
   * Record when Lexara routes to 4Ji
   */
  async recordRoutingTo4Ji(
    userRequest: string,
    routingReason: string,
    result: unknown,
    success: boolean
  ): Promise<void> {
    await recordCrossRegionExperience(
      'lexara',
      '4ji_core',
      userRequest,
      result,
      success ? 0.8 : 0.3,
      { 
        routingReason,
        collaborationType: 'lexara-to-4ji'
      }
    );
  }

  /**
   * Record when Lexara works with Kriptera
   */
  async recordCollaborationWithKriptera(
    request: string,
    result: unknown,
    success: boolean
  ): Promise<void> {
    await recordCrossRegionExperience(
      'lexara',
      'kriptera',
      request,
      result,
      success ? 0.75 : 0.25,
      { collaborationType: 'lexara-to-kriptera' }
    );
  }

  /**
   * Query learned patterns for handling a new utterance
   */
  async getPatternHints(
    utterance: string
  ): Promise<LexaraPatternHint[]> {
    const fingerprint = makeInputFingerprint(utterance, 'lexara', 'lexara-voice');
    
    const synapses = await querySynapses({
      region: 'lexara',
      fingerprint,
      maxResults: 10,
      minWeight: 0.3,
      minConfidence: 0.4
    });

    return synapses.map(synapse => ({
      synapse,
      suggestion: this.generateSuggestion(synapse),
      confidence: synapse.weight * synapse.confidence,
      recommendedFlow: this.inferFlow(synapse.tags)
    }));
  }

  /**
   * Get best response strategy based on learned patterns
   */
  async getBestResponseStrategy(
    userUtterance: string,
    context?: Record<string, unknown>
  ): Promise<{
    recommendedTone: 'warm' | 'professional' | 'empathetic';
    suggestedIntents: string[];
    confidence: number;
  }> {
    const patterns = await this.getPatternHints(userUtterance);

    if (patterns.length === 0) {
      return {
        recommendedTone: 'professional',
        suggestedIntents: [],
        confidence: 0
      };
    }

    // Analyze patterns to determine best approach
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    
    // Extract intents from tags
    const intents = new Set<string>();
    patterns.forEach(p => {
      p.synapse.tags
        .filter(t => !['voice', 'ui', 'assistant', 'conversation', 'command'].includes(t))
        .forEach(t => intents.add(t));
    });

    // Determine tone based on successful patterns
    const positivePatterns = patterns.filter(p => 
      p.synapse.tags.includes('positive') || p.synapse.tags.includes('resolved')
    );
    
    let recommendedTone: 'warm' | 'professional' | 'empathetic' = 'professional';
    if (positivePatterns.length > patterns.length / 2) {
      recommendedTone = 'warm';
    }

    return {
      recommendedTone,
      suggestedIntents: Array.from(intents),
      confidence: avgConfidence
    };
  }

  /**
   * Generate a suggestion string from a synapse
   */
  private generateSuggestion(synapse: NeuralSynapse): string {
    const tags = synapse.tags.filter(t => !['voice', 'ui', 'assistant'].includes(t)).join(', ');
    return `Voice pattern (w: ${synapse.weight.toFixed(2)}, c: ${synapse.confidence.toFixed(2)}): ${tags || 'general'}`;
  }

  /**
   * Infer flow from tags
   */
  private inferFlow(tags: string[]): string | undefined {
    if (tags.includes('command')) return 'command-resolution';
    if (tags.includes('conversation')) return 'multi-turn-dialog';
    if (tags.includes('resolved')) return 'quick-response';
    return undefined;
  }
}

// Export singleton
export const lexaraAdapter = LexaraAdapter.getInstance();

// Export convenience functions
export async function recordConversationExperience(
  userUtterances: string[],
  context: Record<string, unknown>,
  result: ConversationResult
): Promise<void> {
  await lexaraAdapter.recordConversationExperience(userUtterances, context, result);
}

export async function recordCommandExperience(
  userInput: string,
  resolution: CommandResolution
): Promise<void> {
  await lexaraAdapter.recordCommandExperience(userInput, resolution);
}

export async function recordVoiceInteraction(
  interaction: VoiceInteraction
): Promise<void> {
  await lexaraAdapter.recordVoiceInteraction(interaction);
}

export async function getLexaraPatternHints(
  utterance: string
): Promise<LexaraPatternHint[]> {
  return lexaraAdapter.getPatternHints(utterance);
}

export async function getBestResponseStrategy(
  userUtterance: string,
  context?: Record<string, unknown>
) {
  return lexaraAdapter.getBestResponseStrategy(userUtterance, context);
}

export default lexaraAdapter;
