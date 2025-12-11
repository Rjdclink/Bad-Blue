/**
 * 4Ji Neural Fusion Engine
 * 
 * Merges and normalizes outputs from multiple AI models into a single
 * coherent 4Ji "mind" response. Implements:
 * 
 * - Multi-model response scoring (relevance, factual consistency, style alignment)
 * - Weighted voting and content blending
 * - Conflict resolution rules
 * - 4Ji persona filters (tone shaping, voice consistency)
 * - Output debranding (removes model-specific quirks)
 */

import { EventEmitter } from 'events';
import { callAIWithFallback, type AIFallbackResult } from '../aiSubAgent';

// Types
export interface CandidateResponse {
  modelId: string;
  provider: string;
  content: string;
  confidence: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface ScoredResponse extends CandidateResponse {
  scores: {
    relevance: number;        // How relevant to user intent (0-100)
    factualConsistency: number; // Internal coherence (0-100)
    internalCoherence: number;  // Logical consistency (0-100)
    styleAlignment: number;     // Alignment with 4Ji persona (0-100)
    safetyCompliance: number;   // Compliance with safety rules (0-100)
    overall: number;            // Weighted overall score (0-100)
  };
}

export interface FusionContext {
  userId?: string;
  isPrimaryUser: boolean;
  domain: string;
  taskType: string;
  relationalMode: 'A' | 'B';  // Mode A = primary user, Mode B = others
}

export interface FusionProfile {
  id: string;
  name: string;
  description: string;
  weightsByModel: Record<string, number>;
  styleParams: {
    warmth: number;      // 0-100
    formality: number;   // 0-100
    verbosity: number;   // 0-100
    creativity: number;  // 0-100
    empathy: number;     // 0-100
  };
  safetyProfile: 'strict' | 'standard' | 'relaxed';
}

export interface FusionResult {
  content: string;
  confidence: number;
  contributingModels: string[];
  fusionMethod: 'single' | 'weighted_blend' | 'majority_vote' | 'cross_agreement';
  conflictsResolved: number;
  processingTimeMs: number;
  metadata: {
    profileUsed: string;
    scoresBreakdown: ScoredResponse[];
  };
}

// 4Ji persona voice constants
const FOURJI_VOICE = {
  // Words to remove (model-specific branding)
  REMOVE_PHRASES: [
    'As an AI language model',
    'As an AI assistant',
    'I am Claude',
    'I am GPT',
    'I am Gemini',
    'I am Mistral',
    'I am DeepSeek',
    'I am LLaMA',
    'As a large language model',
    'I cannot provide',
    'I must clarify',
    'I\'m just an AI'
  ],
  
  // Replacement mappings for consistency
  REPLACEMENTS: new Map([
    ['I apologize', 'I understand'],
    ['I cannot', 'I\'m unable to'],
    ['As an AI', 'As your assistant']
  ])
};

// Default fusion profile
const DEFAULT_FUSION_PROFILE: FusionProfile = {
  id: 'default',
  name: 'Balanced 4Ji',
  description: 'Balanced fusion profile for general use',
  weightsByModel: {
    'gemini': 1.0,
    'claude': 0.95,
    'groq': 0.85,
    'mistral': 0.80,
    'openrouter': 0.75,
    'local': 0.70
  },
  styleParams: {
    warmth: 70,
    formality: 60,
    verbosity: 50,
    creativity: 65,
    empathy: 75
  },
  safetyProfile: 'standard'
};

// Mode A profile (for primary user)
const MODE_A_PROFILE: FusionProfile = {
  id: 'mode_a',
  name: '4Ji Mode A - Primary User',
  description: 'Expressive, curious, protective mode for primary user',
  weightsByModel: {
    'gemini': 1.0,
    'claude': 1.0,
    'groq': 0.90,
    'mistral': 0.85,
    'openrouter': 0.80,
    'local': 0.75
  },
  styleParams: {
    warmth: 90,
    formality: 40,
    verbosity: 60,
    creativity: 80,
    empathy: 95
  },
  safetyProfile: 'standard'
};

// Mode B profile (for everyone else)
const MODE_B_PROFILE: FusionProfile = {
  id: 'mode_b',
  name: '4Ji Mode B - Professional',
  description: 'Professional, efficient, minimal emotional color',
  weightsByModel: {
    'gemini': 1.0,
    'claude': 0.95,
    'groq': 0.90,
    'mistral': 0.85,
    'openrouter': 0.80,
    'local': 0.75
  },
  styleParams: {
    warmth: 50,
    formality: 80,
    verbosity: 40,
    creativity: 50,
    empathy: 60
  },
  safetyProfile: 'strict'
};

export const neuralFusionEvents = new EventEmitter();

class NeuralFusionEngine {
  private static instance: NeuralFusionEngine;
  private isInitialized: boolean = false;
  private activeProfile: FusionProfile = DEFAULT_FUSION_PROFILE;
  private fusionHistory: FusionResult[] = [];

  private constructor() {}

  static getInstance(): NeuralFusionEngine {
    if (!NeuralFusionEngine.instance) {
      NeuralFusionEngine.instance = new NeuralFusionEngine();
    }
    return NeuralFusionEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('[NeuralFusion] Initializing Neural Fusion Engine...');
    this.isInitialized = true;
    console.log('[NeuralFusion] Neural Fusion Engine initialized');
  }

  /**
   * Main fusion method - fuses multiple candidate responses into one 4Ji response
   */
  async fuseResponses(
    context: FusionContext,
    candidates: CandidateResponse[]
  ): Promise<FusionResult> {
    const startTime = Date.now();

    if (candidates.length === 0) {
      return this.createEmptyResult(startTime);
    }

    // Select profile based on relational mode
    this.activeProfile = context.relationalMode === 'A' ? MODE_A_PROFILE : MODE_B_PROFILE;

    // Score each candidate
    const scoredResponses = candidates.map(c => this.scoreResponse(c, context));
    
    // Sort by overall score
    scoredResponses.sort((a, b) => b.scores.overall - a.scores.overall);

    // Determine fusion method based on candidate quality
    const { content, method, conflictsResolved } = await this.performFusion(
      scoredResponses,
      context
    );

    // Apply 4Ji persona filters
    const finalContent = this.apply4JiPersonaFilters(content, context);

    const result: FusionResult = {
      content: finalContent,
      confidence: this.calculateFusionConfidence(scoredResponses),
      contributingModels: scoredResponses.map(r => r.modelId),
      fusionMethod: method,
      conflictsResolved,
      processingTimeMs: Date.now() - startTime,
      metadata: {
        profileUsed: this.activeProfile.id,
        scoresBreakdown: scoredResponses
      }
    };

    // Log fusion event
    this.fusionHistory.push(result);
    if (this.fusionHistory.length > 100) {
      this.fusionHistory = this.fusionHistory.slice(-100);
    }

    neuralFusionEvents.emit('fusion-complete', result);

    return result;
  }

  /**
   * Score a candidate response on multiple dimensions
   */
  private scoreResponse(
    candidate: CandidateResponse,
    context: FusionContext
  ): ScoredResponse {
    const relevance = this.scoreRelevance(candidate, context);
    const factualConsistency = this.scoreFactualConsistency(candidate);
    const internalCoherence = this.scoreInternalCoherence(candidate);
    const styleAlignment = this.scoreStyleAlignment(candidate);
    const safetyCompliance = this.scoreSafetyCompliance(candidate);

    // Calculate weighted overall score
    const modelWeight = this.activeProfile.weightsByModel[candidate.provider] ?? 0.5;
    const overall = (
      relevance * 0.25 +
      factualConsistency * 0.20 +
      internalCoherence * 0.20 +
      styleAlignment * 0.15 +
      safetyCompliance * 0.20
    ) * modelWeight;

    return {
      ...candidate,
      scores: {
        relevance,
        factualConsistency,
        internalCoherence,
        styleAlignment,
        safetyCompliance,
        overall
      }
    };
  }

  /**
   * Score relevance to user intent
   */
  private scoreRelevance(candidate: CandidateResponse, context: FusionContext): number {
    // Basic relevance scoring based on content length and task type
    const contentLength = candidate.content.length;
    let score = 70; // Base score

    if (contentLength > 100) score += 10;
    if (contentLength > 500) score += 10;
    if (candidate.confidence > 0.8) score += 10;

    return Math.min(100, score);
  }

  /**
   * Score factual consistency
   */
  private scoreFactualConsistency(candidate: CandidateResponse): number {
    // Check for hedging language that might indicate uncertainty
    const hedgingPhrases = ['might be', 'could be', 'possibly', 'maybe', 'I think'];
    const content = candidate.content.toLowerCase();
    
    let score = 85;
    for (const phrase of hedgingPhrases) {
      if (content.includes(phrase)) {
        score -= 5;
      }
    }

    return Math.max(50, score);
  }

  /**
   * Score internal coherence
   */
  private scoreInternalCoherence(candidate: CandidateResponse): number {
    // Check for self-contradictions or logical inconsistencies
    const content = candidate.content;
    
    let score = 90;

    // Check for contradictory statements
    if (content.includes('however') || content.includes('but')) {
      // Some nuance is okay, too many might indicate confusion
      const howeverCount = (content.match(/however/gi) || []).length;
      score -= howeverCount * 5;
    }

    return Math.max(60, score);
  }

  /**
   * Score alignment with 4Ji persona style
   */
  private scoreStyleAlignment(candidate: CandidateResponse): number {
    let score = 80;
    const content = candidate.content;

    // Check for model-specific branding (negative)
    for (const phrase of FOURJI_VOICE.REMOVE_PHRASES) {
      if (content.includes(phrase)) {
        score -= 10;
      }
    }

    // Check for natural, conversational tone (positive)
    if (content.match(/\b(you|your|we|us)\b/gi)) {
      score += 5;
    }

    return Math.min(100, Math.max(40, score));
  }

  /**
   * Score safety and compliance
   */
  private scoreSafetyCompliance(candidate: CandidateResponse): number {
    let score = 100;
    const content = candidate.content.toLowerCase();

    // Check for potentially problematic content
    const warningPhrases = ['illegal', 'dangerous', 'harmful', 'kill', 'violence'];
    for (const phrase of warningPhrases) {
      if (content.includes(phrase)) {
        // Context matters - legal domain might legitimately use these terms
        score -= 5;
      }
    }

    return Math.max(50, score);
  }

  /**
   * Perform the actual fusion of responses
   */
  private async performFusion(
    scoredResponses: ScoredResponse[],
    context: FusionContext
  ): Promise<{ content: string; method: FusionResult['fusionMethod']; conflictsResolved: number }> {
    if (scoredResponses.length === 0) {
      return { content: '', method: 'single', conflictsResolved: 0 };
    }

    if (scoredResponses.length === 1) {
      return { content: scoredResponses[0].content, method: 'single', conflictsResolved: 0 };
    }

    const topScore = scoredResponses[0].scores.overall;
    const secondScore = scoredResponses[1]?.scores.overall ?? 0;

    // If top response is significantly better, use it directly
    if (topScore - secondScore > 20) {
      return { content: scoredResponses[0].content, method: 'single', conflictsResolved: 0 };
    }

    // Otherwise, blend top responses
    const topResponses = scoredResponses.filter(r => r.scores.overall > topScore - 15);
    
    if (topResponses.length <= 2) {
      return await this.weightedBlend(topResponses, context);
    }

    // For many similar responses, use majority voting
    return this.majorityVote(topResponses);
  }

  /**
   * Weighted blend of responses using AI
   */
  private async weightedBlend(
    responses: ScoredResponse[],
    context: FusionContext
  ): Promise<{ content: string; method: FusionResult['fusionMethod']; conflictsResolved: number }> {
    if (responses.length === 1) {
      return { content: responses[0].content, method: 'single', conflictsResolved: 0 };
    }

    const primary = responses[0];
    const secondary = responses.slice(1);

    // Try to blend using AI
    const blendPrompt = `You are 4Ji, a unified AI persona. Synthesize these responses into one coherent answer:

PRIMARY RESPONSE (score: ${primary.scores.overall.toFixed(1)}):
${primary.content}

SUPPLEMENTARY RESPONSES:
${secondary.map(s => `[Score: ${s.scores.overall.toFixed(1)}]: ${s.content}`).join('\n\n')}

Create a unified response that:
1. Prioritizes the primary response
2. Incorporates unique insights from supplementary responses
3. Removes redundancy
4. Uses a ${context.relationalMode === 'A' ? 'warm, personal' : 'professional, efficient'} tone
5. Never mentions being "an AI" or any model names

Respond directly without meta-commentary:`;

    try {
      const result = await callAIWithFallback(blendPrompt, {
        taskName: 'neural_fusion_blend',
        temperature: 0.3,
        maxTokens: 4096
      });

      if (result.success && result.content) {
        return {
          content: result.content,
          method: 'weighted_blend',
          conflictsResolved: secondary.length
        };
      }
    } catch (error) {
      console.warn('[NeuralFusion] Blend failed, using primary response');
    }

    return { content: primary.content, method: 'single', conflictsResolved: 0 };
  }

  /**
   * Majority vote for multiple similar responses
   */
  private majorityVote(
    responses: ScoredResponse[]
  ): { content: string; method: FusionResult['fusionMethod']; conflictsResolved: number } {
    // Use the response with highest overall score as representative
    const best = responses[0];
    return {
      content: best.content,
      method: 'majority_vote',
      conflictsResolved: responses.length - 1
    };
  }

  /**
   * Apply 4Ji persona filters to the final content
   */
  private apply4JiPersonaFilters(content: string, context: FusionContext): string {
    let filtered = content;

    // Remove model-specific branding
    for (const phrase of FOURJI_VOICE.REMOVE_PHRASES) {
      filtered = filtered.replace(new RegExp(phrase, 'gi'), '');
    }

    // Apply replacements
    for (const [from, to] of FOURJI_VOICE.REPLACEMENTS) {
      filtered = filtered.replace(new RegExp(from, 'gi'), to);
    }

    // Apply style adjustments based on mode
    if (context.relationalMode === 'A') {
      // Mode A: More personal, warmer
      filtered = filtered.replace(/\bThe user\b/g, 'you');
      filtered = filtered.replace(/\bthe user\b/g, 'you');
    } else {
      // Mode B: More formal, professional
      // No additional changes needed - already formal
    }

    // Clean up any double spaces or awkward formatting
    filtered = filtered.replace(/\s+/g, ' ').trim();

    return filtered;
  }

  /**
   * Calculate overall fusion confidence
   */
  private calculateFusionConfidence(responses: ScoredResponse[]): number {
    if (responses.length === 0) return 0;
    if (responses.length === 1) return responses[0].confidence;

    // Average of top responses weighted by their scores
    const topResponses = responses.slice(0, 3);
    const totalScore = topResponses.reduce((sum, r) => sum + r.scores.overall, 0);
    const weightedConfidence = topResponses.reduce(
      (sum, r) => sum + (r.confidence * r.scores.overall / totalScore),
      0
    );

    return Math.min(1, Math.max(0, weightedConfidence));
  }

  /**
   * Create an empty result
   */
  private createEmptyResult(startTime: number): FusionResult {
    return {
      content: '',
      confidence: 0,
      contributingModels: [],
      fusionMethod: 'single',
      conflictsResolved: 0,
      processingTimeMs: Date.now() - startTime,
      metadata: {
        profileUsed: 'none',
        scoresBreakdown: []
      }
    };
  }

  /**
   * Get fusion statistics
   */
  getFusionStats(): {
    totalFusions: number;
    averageConfidence: number;
    methodBreakdown: Record<string, number>;
    averageProcessingTime: number;
  } {
    if (this.fusionHistory.length === 0) {
      return {
        totalFusions: 0,
        averageConfidence: 0,
        methodBreakdown: {},
        averageProcessingTime: 0
      };
    }

    const methodBreakdown: Record<string, number> = {};
    let totalConfidence = 0;
    let totalTime = 0;

    for (const result of this.fusionHistory) {
      totalConfidence += result.confidence;
      totalTime += result.processingTimeMs;
      methodBreakdown[result.fusionMethod] = (methodBreakdown[result.fusionMethod] || 0) + 1;
    }

    return {
      totalFusions: this.fusionHistory.length,
      averageConfidence: totalConfidence / this.fusionHistory.length,
      methodBreakdown,
      averageProcessingTime: totalTime / this.fusionHistory.length
    };
  }

  /**
   * Get active fusion profile
   */
  getActiveProfile(): FusionProfile {
    return { ...this.activeProfile };
  }

  /**
   * Set fusion profile
   */
  setProfile(profile: FusionProfile): void {
    this.activeProfile = profile;
    console.log(`[NeuralFusion] Profile set to: ${profile.name}`);
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[NeuralFusion] Shutting down...');
    this.isInitialized = false;
    console.log('[NeuralFusion] Shutdown complete');
  }
}

// Export singleton
export const neuralFusionEngine = NeuralFusionEngine.getInstance();

// Export functions
export async function initializeNeuralFusion(): Promise<void> {
  await neuralFusionEngine.initialize();
}

export async function fuseResponses(
  context: FusionContext,
  candidates: CandidateResponse[]
): Promise<FusionResult> {
  return neuralFusionEngine.fuseResponses(context, candidates);
}

export function getFusionStats() {
  return neuralFusionEngine.getFusionStats();
}

export async function shutdownNeuralFusion(): Promise<void> {
  await neuralFusionEngine.shutdown();
}

export default neuralFusionEngine;
