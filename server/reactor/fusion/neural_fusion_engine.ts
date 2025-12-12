/**
 * Reactor Fusion - Neural Fusion Engine
 * 
 * Accepts candidate model responses and scores them based on:
 * - Consistency
 * - Completeness
 * - Domain relevance
 * - Historical performance
 * 
 * Optionally runs Monte Carlo passes to assign confidence scores.
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CandidateResponse {
  modelId: string;
  provider: string;
  response: unknown;
  latencyMs: number;
  tokensUsed?: number;
  metadata?: Record<string, unknown>;
}

export interface ScoringWeights {
  consistency: number;
  completeness: number;
  relevance: number;
  historicalPerformance: number;
  latency: number;
}

export interface FusionResult {
  selectedResponse: unknown;
  selectedModelId: string;
  confidence: number;
  scores: Record<string, number>;
  rankings: Array<{ modelId: string; score: number }>;
  fusionMethod: 'single' | 'averaged' | 'weighted' | 'consensus';
}

export interface FusionConfig {
  weights: ScoringWeights;
  minConfidenceThreshold: number;
  enableMonteCarlo: boolean;
  monteCarloPassCount: number;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_WEIGHTS: ScoringWeights = {
  consistency: 0.25,
  completeness: 0.25,
  relevance: 0.30,
  historicalPerformance: 0.15,
  latency: 0.05
};

const DEFAULT_CONFIG: FusionConfig = {
  weights: DEFAULT_WEIGHTS,
  minConfidenceThreshold: 0.5,
  enableMonteCarlo: false,
  monteCarloPassCount: 10
};

// ============================================================================
// NEURAL FUSION ENGINE CLASS
// ============================================================================

export const fusionEvents = new EventEmitter();

class NeuralFusionEngine {
  private static instance: NeuralFusionEngine;
  private config: FusionConfig = DEFAULT_CONFIG;
  private historicalScores: Map<string, number[]> = new Map();

  private constructor() {}

  static getInstance(): NeuralFusionEngine {
    if (!NeuralFusionEngine.instance) {
      NeuralFusionEngine.instance = new NeuralFusionEngine();
    }
    return NeuralFusionEngine.instance;
  }

  /**
   * Configure the fusion engine
   */
  configure(config: Partial<FusionConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.weights) {
      this.config.weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    }
  }

  /**
   * Fuse multiple candidate responses into a single best result
   */
  async fuse(
    candidates: CandidateResponse[],
    context?: { domain?: string; expectedFormat?: string; query?: string }
  ): Promise<FusionResult> {
    if (candidates.length === 0) {
      throw new Error('No candidates to fuse');
    }

    if (candidates.length === 1) {
      // Single candidate - return directly with confidence based on historical
      const score = this.scoreCandidate(candidates[0], [], context);
      return {
        selectedResponse: candidates[0].response,
        selectedModelId: candidates[0].modelId,
        confidence: score,
        scores: { [candidates[0].modelId]: score },
        rankings: [{ modelId: candidates[0].modelId, score }],
        fusionMethod: 'single'
      };
    }

    // Score all candidates
    const scores: Record<string, number> = {};
    for (const candidate of candidates) {
      const otherCandidates = candidates.filter(c => c.modelId !== candidate.modelId);
      scores[candidate.modelId] = this.scoreCandidate(candidate, otherCandidates, context);
    }

    // Rank candidates
    const rankings = Object.entries(scores)
      .map(([modelId, score]) => ({ modelId, score }))
      .sort((a, b) => b.score - a.score);

    // Select best candidate
    const bestModelId = rankings[0].modelId;
    const bestCandidate = candidates.find(c => c.modelId === bestModelId)!;
    let confidence = rankings[0].score;

    // Optional Monte Carlo refinement
    if (this.config.enableMonteCarlo && candidates.length > 1) {
      const mcResult = await this.runMonteCarlo(candidates, context);
      confidence = (confidence + mcResult.confidence) / 2;
    }

    // Record historical score
    this.recordHistoricalScore(bestModelId, confidence);

    const result: FusionResult = {
      selectedResponse: bestCandidate.response,
      selectedModelId: bestModelId,
      confidence,
      scores,
      rankings,
      fusionMethod: candidates.length > 2 ? 'consensus' : 'weighted'
    };

    fusionEvents.emit('fusion-complete', result);
    return result;
  }

  /**
   * Score a single candidate
   */
  private scoreCandidate(
    candidate: CandidateResponse,
    others: CandidateResponse[],
    context?: { domain?: string; expectedFormat?: string; query?: string }
  ): number {
    const weights = this.config.weights;
    let totalScore = 0;

    // Consistency score (agreement with other responses)
    const consistencyScore = this.calculateConsistency(candidate, others);
    totalScore += consistencyScore * weights.consistency;

    // Completeness score
    const completenessScore = this.calculateCompleteness(candidate.response);
    totalScore += completenessScore * weights.completeness;

    // Relevance score
    const relevanceScore = this.calculateRelevance(candidate.response, context);
    totalScore += relevanceScore * weights.relevance;

    // Historical performance
    const historicalScore = this.getHistoricalScore(candidate.modelId);
    totalScore += historicalScore * weights.historicalPerformance;

    // Latency score (lower is better)
    const latencyScore = this.calculateLatencyScore(candidate.latencyMs);
    totalScore += latencyScore * weights.latency;

    return Math.min(1, Math.max(0, totalScore));
  }

  /**
   * Calculate consistency with other responses
   */
  private calculateConsistency(candidate: CandidateResponse, others: CandidateResponse[]): number {
    if (others.length === 0) return 0.7; // Default for single response

    const candidateStr = JSON.stringify(candidate.response).toLowerCase();
    let agreementScore = 0;

    for (const other of others) {
      const otherStr = JSON.stringify(other.response).toLowerCase();
      
      // Simple overlap calculation
      const candidateWords = new Set(candidateStr.split(/\s+/).filter(w => w.length > 3));
      const otherWords = new Set(otherStr.split(/\s+/).filter(w => w.length > 3));
      
      const intersection = new Set([...candidateWords].filter(w => otherWords.has(w)));
      const union = new Set([...candidateWords, ...otherWords]);
      
      if (union.size > 0) {
        agreementScore += intersection.size / union.size;
      }
    }

    return agreementScore / others.length;
  }

  /**
   * Calculate completeness of response
   */
  private calculateCompleteness(response: unknown): number {
    if (!response) return 0;

    const str = JSON.stringify(response);
    
    // Basic completeness heuristics
    let score = 0;

    // Length-based (up to a point)
    const lengthScore = Math.min(1, str.length / 500);
    score += lengthScore * 0.3;

    // Has structure
    if (typeof response === 'object') {
      const keys = Object.keys(response as object);
      score += Math.min(1, keys.length / 5) * 0.3;
    }

    // No error indicators
    const hasError = str.toLowerCase().includes('error') || 
                     str.toLowerCase().includes('failed') ||
                     str.toLowerCase().includes('cannot');
    if (!hasError) score += 0.4;

    return score;
  }

  /**
   * Calculate relevance to context
   */
  private calculateRelevance(response: unknown, context?: { domain?: string; query?: string }): number {
    if (!context) return 0.5;

    const responseStr = JSON.stringify(response).toLowerCase();
    let score = 0.5; // Base relevance

    // Check domain keywords
    if (context.domain) {
      const domainKeywords: Record<string, string[]> = {
        'legal': ['law', 'statute', 'case', 'court', 'legal', 'rights'],
        'crypto': ['token', 'wallet', 'blockchain', 'transaction', 'ethereum', 'bitcoin'],
        'osint': ['record', 'public', 'information', 'data', 'source'],
        'gps': ['location', 'coordinate', 'map', 'area', 'distance']
      };

      const keywords = domainKeywords[context.domain] || [];
      const matches = keywords.filter(kw => responseStr.includes(kw)).length;
      score += (matches / Math.max(1, keywords.length)) * 0.3;
    }

    // Check query relevance
    if (context.query) {
      const queryWords = context.query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matches = queryWords.filter(w => responseStr.includes(w)).length;
      score += (matches / Math.max(1, queryWords.length)) * 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Get historical performance score for a model
   */
  private getHistoricalScore(modelId: string): number {
    const scores = this.historicalScores.get(modelId);
    if (!scores || scores.length === 0) return 0.5;

    // Average of last 20 scores
    const recent = scores.slice(-20);
    return recent.reduce((sum, s) => sum + s, 0) / recent.length;
  }

  /**
   * Record a historical score
   */
  private recordHistoricalScore(modelId: string, score: number): void {
    if (!this.historicalScores.has(modelId)) {
      this.historicalScores.set(modelId, []);
    }
    
    const scores = this.historicalScores.get(modelId)!;
    scores.push(score);
    
    // Keep only last 100
    if (scores.length > 100) {
      scores.shift();
    }
  }

  /**
   * Calculate latency score (lower latency = higher score)
   */
  private calculateLatencyScore(latencyMs: number): number {
    // 100ms = 1.0, 1000ms = 0.5, 5000ms = 0.1
    if (latencyMs <= 100) return 1.0;
    if (latencyMs <= 500) return 0.8;
    if (latencyMs <= 1000) return 0.6;
    if (latencyMs <= 2000) return 0.4;
    if (latencyMs <= 5000) return 0.2;
    return 0.1;
  }

  /**
   * Run Monte Carlo evaluation
   */
  private async runMonteCarlo(
    candidates: CandidateResponse[],
    context?: { domain?: string; query?: string }
  ): Promise<{ confidence: number; bestModelId: string }> {
    const votes: Record<string, number> = {};
    
    for (let i = 0; i < this.config.monteCarloPassCount; i++) {
      // Randomly perturb weights slightly
      const perturbedWeights = { ...this.config.weights };
      for (const key of Object.keys(perturbedWeights) as Array<keyof ScoringWeights>) {
        perturbedWeights[key] *= 0.8 + Math.random() * 0.4; // ±20% variation
      }

      // Score with perturbed weights
      const tempConfig = { ...this.config, weights: perturbedWeights };
      const originalConfig = this.config;
      this.config = tempConfig;

      const scores = candidates.map(c => ({
        modelId: c.modelId,
        score: this.scoreCandidate(c, candidates.filter(x => x.modelId !== c.modelId), context)
      }));

      this.config = originalConfig;

      // Vote for best
      const best = scores.reduce((a, b) => a.score > b.score ? a : b);
      votes[best.modelId] = (votes[best.modelId] || 0) + 1;
    }

    // Find winner
    const entries = Object.entries(votes);
    const winner = entries.reduce((a, b) => a[1] > b[1] ? a : b);
    
    return {
      bestModelId: winner[0],
      confidence: winner[1] / this.config.monteCarloPassCount
    };
  }

  /**
   * Get current config
   */
  getConfig(): FusionConfig {
    return { ...this.config };
  }
}

// Export singleton
export const neuralFusionEngine = NeuralFusionEngine.getInstance();

export function configureFusion(config: Partial<FusionConfig>): void {
  neuralFusionEngine.configure(config);
}

export async function fuseResponses(
  candidates: CandidateResponse[],
  context?: { domain?: string; expectedFormat?: string; query?: string }
): Promise<FusionResult> {
  return neuralFusionEngine.fuse(candidates, context);
}

export default neuralFusionEngine;
