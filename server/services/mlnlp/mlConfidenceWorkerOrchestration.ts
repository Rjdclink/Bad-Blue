/**
 * ML Confidence Worker for Orchestration
 * 
 * Scores and ranks outputs from multiple AI models/agents in the orchestrated system.
 * This worker analyzes model responses, assigns confidence scores, and helps determine
 * which model's output should be prioritized.
 */

import { createLogger } from '../../logger';

const log = createLogger('MLConfidenceWorkerOrchestration');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ModelOutput {
  modelName: string;
  response: string;
  metadata?: {
    tokensUsed?: number;
    responseTime?: number;
    temperature?: number;
    [key: string]: any;
  };
  timestamp: Date;
}

export interface ConfidenceScore {
  modelName: string;
  score: number; // 0-1
  factors: {
    consistency: number; // 0-1 - how consistent with other models
    specificity: number; // 0-1 - how specific/detailed
    coherence: number; // 0-1 - logical coherence
    relevance: number; // 0-1 - relevance to task
  };
  reasoning: string;
}

export interface RankedOutput {
  modelName: string;
  response: string;
  confidenceScore: number;
  rank: number;
  recommendedUse: 'primary' | 'supporting' | 'discard';
}

export interface ConfidenceAnalysisResult {
  rankedOutputs: RankedOutput[];
  consensusScore: number; // 0-1 - how much models agree
  conflicts: string[];
  recommendation: {
    primaryModel: string;
    reasoning: string;
    shouldCombine: boolean;
  };
}

// ============================================================================
// CONFIDENCE SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate consistency score by comparing response with other responses
 */
function calculateConsistency(response: string, otherResponses: string[]): number {
  if (otherResponses.length === 0) return 0.5;

  const responseWords = new Set(
    response.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );

  let totalSimilarity = 0;
  for (const other of otherResponses) {
    const otherWords = new Set(
      other.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    
    const intersection = new Set([...responseWords].filter(w => otherWords.has(w)));
    const union = new Set([...responseWords, ...otherWords]);
    
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    totalSimilarity += similarity;
  }

  return totalSimilarity / otherResponses.length;
}

/**
 * Calculate specificity score based on detail level
 */
function calculateSpecificity(response: string): number {
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = response.split(/\s+/).filter(w => w.length > 0);
  
  // More sentences and words indicate more detail
  const sentenceScore = Math.min(sentences.length / 10, 1);
  const wordScore = Math.min(words.length / 100, 1);
  
  // Presence of numbers, citations, specific terms increases specificity
  const numbers = (response.match(/\d+/g) || []).length;
  const citations = (response.match(/\[.*?\]|\(.*?\)/g) || []).length;
  const specificTerms = (response.match(/pursuant to|section|subsection|§|statute|regulation/gi) || []).length;
  
  const detailScore = Math.min((numbers + citations + specificTerms) / 10, 1);
  
  return (sentenceScore * 0.3 + wordScore * 0.3 + detailScore * 0.4);
}

/**
 * Calculate coherence score based on logical structure
 */
function calculateCoherence(response: string): number {
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  if (sentences.length === 0) return 0;
  if (sentences.length === 1) return 0.5;
  
  // Check for logical connectors
  const connectors = ['therefore', 'however', 'moreover', 'furthermore', 'consequently', 
                      'additionally', 'similarly', 'conversely', 'thus', 'hence'];
  let connectorCount = 0;
  for (const connector of connectors) {
    connectorCount += (response.toLowerCase().match(new RegExp(connector, 'g')) || []).length;
  }
  
  const connectorScore = Math.min(connectorCount / sentences.length, 1);
  
  // Check for structure (numbered points, bullet points, paragraphs)
  const hasNumberedPoints = /\d+\.|^\d+\)/gm.test(response);
  const hasBulletPoints = /^[-•*]/gm.test(response);
  const paragraphs = response.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  const structureScore = (hasNumberedPoints || hasBulletPoints || paragraphs.length > 2) ? 0.8 : 0.5;
  
  return (connectorScore * 0.5 + structureScore * 0.5);
}

/**
 * Calculate relevance score based on task keywords
 */
function calculateRelevance(response: string, taskContext?: string): number {
  if (!taskContext) return 0.7; // Default moderate relevance
  
  const contextWords = new Set(
    taskContext.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  
  const responseWords = response.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let matchCount = 0;
  
  for (const word of responseWords) {
    if (contextWords.has(word)) {
      matchCount++;
    }
  }
  
  return Math.min(matchCount / Math.max(contextWords.size, 1), 1);
}

// ============================================================================
// MAIN WORKER FUNCTIONS
// ============================================================================

/**
 * Score confidence for multiple model outputs
 */
export async function scoreModelOutputs(
  outputs: ModelOutput[],
  taskContext?: string
): Promise<ConfidenceScore[]> {
  log.info('Scoring confidence for model outputs', { count: outputs.length });

  const scores: ConfidenceScore[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    const otherResponses = outputs
      .filter((_, idx) => idx !== i)
      .map(o => o.response);

    const consistency = calculateConsistency(output.response, otherResponses);
    const specificity = calculateSpecificity(output.response);
    const coherence = calculateCoherence(output.response);
    const relevance = calculateRelevance(output.response, taskContext);

    // Weighted average
    const overallScore = (
      consistency * 0.3 +
      specificity * 0.25 +
      coherence * 0.25 +
      relevance * 0.2
    );

    scores.push({
      modelName: output.modelName,
      score: overallScore,
      factors: {
        consistency,
        specificity,
        coherence,
        relevance
      },
      reasoning: `Consistency: ${(consistency * 100).toFixed(1)}%, ` +
                `Specificity: ${(specificity * 100).toFixed(1)}%, ` +
                `Coherence: ${(coherence * 100).toFixed(1)}%, ` +
                `Relevance: ${(relevance * 100).toFixed(1)}%`
    });
  }

  log.info('Confidence scoring complete', {
    scores: scores.map(s => ({ model: s.modelName, score: s.score.toFixed(3) }))
  });

  return scores;
}

/**
 * Rank model outputs based on confidence scores
 */
export async function rankModelOutputs(
  outputs: ModelOutput[],
  scores: ConfidenceScore[]
): Promise<RankedOutput[]> {
  log.info('Ranking model outputs');

  // Combine outputs with scores
  const combined = outputs.map(output => {
    const score = scores.find(s => s.modelName === output.modelName);
    return {
      modelName: output.modelName,
      response: output.response,
      confidenceScore: score?.score || 0
    };
  });

  // Sort by confidence score (descending)
  combined.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Assign ranks and recommendations
  const ranked: RankedOutput[] = combined.map((item, index) => {
    let recommendedUse: 'primary' | 'supporting' | 'discard';
    
    if (index === 0 && item.confidenceScore > 0.7) {
      recommendedUse = 'primary';
    } else if (item.confidenceScore > 0.5) {
      recommendedUse = 'supporting';
    } else {
      recommendedUse = 'discard';
    }

    return {
      ...item,
      rank: index + 1,
      recommendedUse
    };
  });

  log.info('Ranking complete', {
    rankings: ranked.map(r => ({ 
      rank: r.rank, 
      model: r.modelName, 
      score: r.confidenceScore.toFixed(3),
      use: r.recommendedUse
    }))
  });

  return ranked;
}

/**
 * Detect conflicts between model outputs
 */
function detectConflicts(outputs: ModelOutput[]): string[] {
  const conflicts: string[] = [];

  // Check for contradictory conclusions
  const hasYes = outputs.some(o => /\b(yes|affirmative|correct|true|valid)\b/i.test(o.response));
  const hasNo = outputs.some(o => /\b(no|negative|incorrect|false|invalid)\b/i.test(o.response));
  
  if (hasYes && hasNo) {
    conflicts.push('Models provide contradictory yes/no conclusions');
  }

  // Check for conflicting numeric values
  const numbers = outputs.map(o => {
    const matches = o.response.match(/\b\d+(\.\d+)?\b/g);
    return matches ? matches.map(n => parseFloat(n)) : [];
  }).flat();

  if (numbers.length > 1) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const range = max - min;
    const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    
    if (range > avg * 0.5) {
      conflicts.push(`Significant numeric variance detected (range: ${min}-${max})`);
    }
  }

  return conflicts;
}

/**
 * Calculate consensus score
 */
function calculateConsensus(scores: ConfidenceScore[]): number {
  if (scores.length < 2) return 1;

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s.score - avgScore, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  // Lower standard deviation = higher consensus
  // Normalize to 0-1 scale
  return Math.max(0, 1 - (stdDev * 2));
}

/**
 * Perform complete confidence analysis
 */
export async function analyzeConfidence(
  outputs: ModelOutput[],
  taskContext?: string
): Promise<ConfidenceAnalysisResult> {
  log.info('Starting confidence analysis', { outputCount: outputs.length });

  if (outputs.length === 0) {
    throw new Error('No outputs provided for confidence analysis');
  }

  if (outputs.length === 1) {
    // Single output - simplified analysis
    return {
      rankedOutputs: [{
        modelName: outputs[0].modelName,
        response: outputs[0].response,
        confidenceScore: 0.8,
        rank: 1,
        recommendedUse: 'primary'
      }],
      consensusScore: 1,
      conflicts: [],
      recommendation: {
        primaryModel: outputs[0].modelName,
        reasoning: 'Single model output - used by default',
        shouldCombine: false
      }
    };
  }

  // Score and rank outputs
  const scores = await scoreModelOutputs(outputs, taskContext);
  const rankedOutputs = await rankModelOutputs(outputs, scores);

  // Detect conflicts
  const conflicts = detectConflicts(outputs);

  // Calculate consensus
  const consensusScore = calculateConsensus(scores);

  // Generate recommendation
  const topRanked = rankedOutputs[0];
  const shouldCombine = consensusScore > 0.7 && rankedOutputs.filter(r => r.confidenceScore > 0.6).length > 1;

  const recommendation = {
    primaryModel: topRanked.modelName,
    reasoning: shouldCombine
      ? `High consensus (${(consensusScore * 100).toFixed(1)}%) - consider combining insights from top ${rankedOutputs.filter(r => r.confidenceScore > 0.6).length} models`
      : `Use ${topRanked.modelName} output (confidence: ${(topRanked.confidenceScore * 100).toFixed(1)}%)`,
    shouldCombine
  };

  log.info('Confidence analysis complete', {
    primaryModel: topRanked.modelName,
    consensusScore: consensusScore.toFixed(3),
    conflictCount: conflicts.length
  });

  return {
    rankedOutputs,
    consensusScore,
    conflicts,
    recommendation
  };
}

/**
 * Health check for confidence worker
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  try {
    // Test scoring with sample data
    const testOutputs: ModelOutput[] = [
      {
        modelName: 'test-model-1',
        response: 'This is a test response with some legal context.',
        timestamp: new Date()
      },
      {
        modelName: 'test-model-2',
        response: 'This is another test response with similar legal context.',
        timestamp: new Date()
      }
    ];

    const scores = await scoreModelOutputs(testOutputs);
    
    if (scores.length === 2 && scores.every(s => s.score >= 0 && s.score <= 1)) {
      return { status: 'healthy', message: 'ML Confidence Worker for Orchestration is operational' };
    }

    return { status: 'unhealthy', message: 'Confidence scoring produced invalid results' };
  } catch (error) {
    log.error('Health check failed', error);
    return { status: 'unhealthy', message: `Health check failed: ${error}` };
  }
}
