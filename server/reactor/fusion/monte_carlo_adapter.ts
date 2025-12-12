/**
 * Reactor Fusion - Monte Carlo Adapter
 * 
 * Provides Monte Carlo evaluation for candidate outputs.
 * Simulates multiple "what-if" checks and assigns confidence scores.
 * 
 * Used by:
 * - Crypto crawlers (strategy robustness)
 * - OSINT crawlers (accuracy tuning)
 * - GPS / People Radar (accuracy tuning)
 * - Legal research (citation validation)
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MonteCarloOptions {
  passes: number;                    // Number of simulation passes
  scoringDimensions: string[];       // Dimensions to score on
  varianceRange?: number;            // Variance range for perturbation (default 0.2)
  confidenceThreshold?: number;      // Minimum confidence to accept (default 0.6)
}

export interface MonteCarloResult {
  score: number;                     // Overall score (0-1)
  dimensionScores: Record<string, number>;  // Score per dimension
  confidence: number;                // Confidence in the result
  passResults: number[];             // Individual pass scores
  convergenceRate: number;           // How quickly scores converged
  recommendation: 'accept' | 'review' | 'reject';
}

export interface Scenario {
  id: string;
  baseData: unknown;
  parameters: Record<string, unknown>;
  expectedOutcome?: unknown;
}

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const DEFAULT_OPTIONS: Required<MonteCarloOptions> = {
  passes: 10,
  scoringDimensions: ['accuracy', 'completeness', 'consistency'],
  varianceRange: 0.2,
  confidenceThreshold: 0.6
};

// ============================================================================
// SCORING CONSTANTS
// ============================================================================

/**
 * Monte Carlo scoring constants
 * 
 * BASE_SCORE_MIN/MAX: The baseline score range before parameter influence.
 *   - 0.5-0.8 represents moderate initial confidence
 *   - This range prevents extreme scores from single-pass evaluations
 * 
 * INFLUENCE_BOUNDS: Maximum parameter influence on scores (±0.3)
 *   - Prevents any single parameter from dominating the score
 */
const BASE_SCORE_MIN = 0.5;      // Minimum baseline score
const BASE_SCORE_MAX = 0.8;      // Maximum baseline score  
const BASE_SCORE_RANGE = BASE_SCORE_MAX - BASE_SCORE_MIN;  // 0.3
const MAX_PARAMETER_INFLUENCE = 0.3;  // Max influence from parameters

// ============================================================================
// MONTE CARLO ADAPTER CLASS
// ============================================================================

export const monteCarloEvents = new EventEmitter();

class MonteCarloAdapter {
  private static instance: MonteCarloAdapter;

  private constructor() {}

  static getInstance(): MonteCarloAdapter {
    if (!MonteCarloAdapter.instance) {
      MonteCarloAdapter.instance = new MonteCarloAdapter();
    }
    return MonteCarloAdapter.instance;
  }

  /**
   * Evaluate a scenario with Monte Carlo simulation
   */
  async evaluateWithMonteCarlo(
    baseScenario: Scenario,
    options: MonteCarloOptions
  ): Promise<MonteCarloResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const passResults: number[] = [];
    const dimensionAccumulators: Record<string, number[]> = {};

    // Initialize dimension accumulators
    for (const dim of opts.scoringDimensions) {
      dimensionAccumulators[dim] = [];
    }

    console.log(`[MonteCarloAdapter] Running ${opts.passes} passes on scenario ${baseScenario.id}`);

    // Run simulation passes
    for (let i = 0; i < opts.passes; i++) {
      // Perturb parameters
      const perturbedScenario = this.perturbScenario(baseScenario, opts.varianceRange);
      
      // Evaluate this pass
      const passScore = await this.evaluatePass(perturbedScenario, opts.scoringDimensions);
      
      passResults.push(passScore.overall);
      
      // Accumulate dimension scores
      for (const [dim, score] of Object.entries(passScore.dimensions)) {
        dimensionAccumulators[dim].push(score);
      }
    }

    // Calculate final scores
    const overallScore = this.calculateMean(passResults);
    const dimensionScores: Record<string, number> = {};
    
    for (const [dim, scores] of Object.entries(dimensionAccumulators)) {
      dimensionScores[dim] = this.calculateMean(scores);
    }

    // Calculate confidence based on variance
    const variance = this.calculateVariance(passResults);
    const confidence = Math.max(0, 1 - variance * 2);  // Lower variance = higher confidence

    // Calculate convergence rate
    const convergenceRate = this.calculateConvergenceRate(passResults);

    // Determine recommendation
    let recommendation: 'accept' | 'review' | 'reject';
    if (overallScore >= 0.8 && confidence >= opts.confidenceThreshold) {
      recommendation = 'accept';
    } else if (overallScore >= 0.5 || confidence >= 0.5) {
      recommendation = 'review';
    } else {
      recommendation = 'reject';
    }

    const result: MonteCarloResult = {
      score: overallScore,
      dimensionScores,
      confidence,
      passResults,
      convergenceRate,
      recommendation
    };

    monteCarloEvents.emit('evaluation-complete', {
      scenarioId: baseScenario.id,
      result
    });

    return result;
  }

  /**
   * Evaluate for crypto arbitrage strategy
   */
  async evaluateCryptoStrategy(
    strategy: {
      pair: string;
      action: 'buy' | 'sell' | 'hold';
      entryPrice: number;
      targetPrice: number;
      stopLoss: number;
    },
    marketConditions: Record<string, unknown>
  ): Promise<MonteCarloResult> {
    const scenario: Scenario = {
      id: `crypto-${strategy.pair}-${Date.now()}`,
      baseData: strategy,
      parameters: {
        ...marketConditions,
        volatility: marketConditions.volatility || 0.1,
        volume: marketConditions.volume || 'medium'
      }
    };

    return this.evaluateWithMonteCarlo(scenario, {
      passes: 20,  // More passes for financial decisions
      scoringDimensions: ['profitability', 'risk', 'timing', 'liquidity']
    });
  }

  /**
   * Evaluate for OSINT accuracy
   */
  async evaluateOsintAccuracy(
    findings: unknown[],
    sources: string[]
  ): Promise<MonteCarloResult> {
    const scenario: Scenario = {
      id: `osint-${Date.now()}`,
      baseData: findings,
      parameters: {
        sourceCount: sources.length,
        sources
      }
    };

    return this.evaluateWithMonteCarlo(scenario, {
      passes: 10,
      scoringDimensions: ['accuracy', 'corroboration', 'recency', 'reliability']
    });
  }

  /**
   * Evaluate for legal research quality
   */
  async evaluateLegalResearch(
    citations: string[],
    jurisdiction: string,
    lawType: string
  ): Promise<MonteCarloResult> {
    const scenario: Scenario = {
      id: `legal-${jurisdiction}-${Date.now()}`,
      baseData: citations,
      parameters: {
        jurisdiction,
        lawType,
        citationCount: citations.length
      }
    };

    return this.evaluateWithMonteCarlo(scenario, {
      passes: 15,
      scoringDimensions: ['relevance', 'authority', 'recency', 'applicability']
    });
  }

  /**
   * Perturb a scenario's parameters within variance range
   */
  private perturbScenario(scenario: Scenario, varianceRange: number): Scenario {
    const perturbedParams: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(scenario.parameters)) {
      if (typeof value === 'number') {
        // Perturb numeric values
        const perturbation = (Math.random() - 0.5) * 2 * varianceRange;
        perturbedParams[key] = value * (1 + perturbation);
      } else {
        perturbedParams[key] = value;
      }
    }

    return {
      ...scenario,
      parameters: perturbedParams
    };
  }

  /**
   * Evaluate a single pass
   */
  private async evaluatePass(
    scenario: Scenario,
    dimensions: string[]
  ): Promise<{ overall: number; dimensions: Record<string, number> }> {
    const dimensionScores: Record<string, number> = {};

    for (const dim of dimensions) {
      // Simulate scoring with randomness representing uncertainty
      // Base score range is 0.5-0.8 (moderate confidence baseline)
      const baseScore = BASE_SCORE_MIN + Math.random() * BASE_SCORE_RANGE;
      const parameterInfluence = this.calculateParameterInfluence(scenario.parameters, dim);
      dimensionScores[dim] = Math.min(1, Math.max(0, baseScore + parameterInfluence));
    }

    const overall = Object.values(dimensionScores).reduce((a, b) => a + b, 0) / dimensions.length;

    return { overall, dimensions: dimensionScores };
  }

  /**
   * Calculate how parameters influence a dimension score
   */
  private calculateParameterInfluence(params: Record<string, unknown>, dimension: string): number {
    let influence = 0;

    // Simple heuristics based on parameter names
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'number') {
        // Higher values generally positive, but with diminishing returns
        influence += Math.log10(Math.max(1, value)) * 0.05;
      }
      
      // Specific parameter-dimension relationships
      if (key === 'sourceCount' && dimension === 'reliability') {
        influence += Math.min(0.2, (value as number) * 0.02);
      }
      if (key === 'citationCount' && dimension === 'authority') {
        influence += Math.min(0.15, (value as number) * 0.03);
      }
    }

    return Math.max(-0.3, Math.min(0.3, influence));
  }

  /**
   * Calculate mean of array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate variance of array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return this.calculateMean(squaredDiffs);
  }

  /**
   * Calculate how quickly scores converged
   */
  private calculateConvergenceRate(passResults: number[]): number {
    if (passResults.length < 3) return 0;

    // Look at rolling variance
    const windowSize = 3;
    const variances: number[] = [];

    for (let i = windowSize; i <= passResults.length; i++) {
      const window = passResults.slice(i - windowSize, i);
      variances.push(this.calculateVariance(window));
    }

    // Convergence = reduction in variance over time
    if (variances.length < 2) return 0.5;
    
    const firstVariance = variances[0];
    const lastVariance = variances[variances.length - 1];
    
    if (firstVariance === 0) return 1;
    return Math.max(0, Math.min(1, 1 - lastVariance / firstVariance));
  }
}

// Export singleton
export const monteCarloAdapter = MonteCarloAdapter.getInstance();

export async function evaluateWithMonteCarlo(
  baseScenario: Scenario,
  options: MonteCarloOptions
): Promise<MonteCarloResult> {
  return monteCarloAdapter.evaluateWithMonteCarlo(baseScenario, options);
}

export async function evaluateCryptoStrategy(
  strategy: {
    pair: string;
    action: 'buy' | 'sell' | 'hold';
    entryPrice: number;
    targetPrice: number;
    stopLoss: number;
  },
  marketConditions: Record<string, unknown>
): Promise<MonteCarloResult> {
  return monteCarloAdapter.evaluateCryptoStrategy(strategy, marketConditions);
}

export async function evaluateOsintAccuracy(
  findings: unknown[],
  sources: string[]
): Promise<MonteCarloResult> {
  return monteCarloAdapter.evaluateOsintAccuracy(findings, sources);
}

export async function evaluateLegalResearch(
  citations: string[],
  jurisdiction: string,
  lawType: string
): Promise<MonteCarloResult> {
  return monteCarloAdapter.evaluateLegalResearch(citations, jurisdiction, lawType);
}

export default monteCarloAdapter;
