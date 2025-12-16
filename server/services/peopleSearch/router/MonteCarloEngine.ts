/**
 * MonteCarloEngine - Monte Carlo Confidence Engine (Step 4)
 * 
 * ARCHITECTURE: Wraps Step 3 deterministic pipeline with Monte Carlo perturbations
 * 
 * 1. MONTE CARLO WRAPPER:
 *    - Runs N perturbation passes over the deterministic pipeline
 *    - Perturbations: input noise within safe bounds (weight jitter, minor variations)
 *    - Collects distribution of confidence scores
 * 
 * 2. BUDGETS:
 *    - Caps on runs (N), wall-clock time, and max cost
 *    - Aborts if exceeded; returns partial distribution + reason
 * 
 * 3. DECISION GOVERNOR:
 *    - stop/escalate rule: if P(confidence ≥ θ) > p*, stop; else escalate
 *    - θ and p* configurable
 * 
 * 4. OUTPUT:
 *    {samples, summary: {mean, p10, p50, p90, stdev}, decision, reason, provenance}
 * 
 * 5. NO BROWSER: No Playwright/browser invoked
 */

import type { SearchQuery } from '../types';
import type { RequiredField } from './CapabilityRouter';
import type { ExtractionResult, ClaimsRecord, ConfidenceBreakdown } from './ExtractionLedger';
import { 
  calculateDeterministicConfidence, 
  CONFIDENCE_WEIGHTS, 
  SOURCE_QUALITY_SCORES 
} from './ExtractionLedger';

// ============================================
// BUDGET TYPES
// ============================================

/**
 * Budget constraints for Monte Carlo runs
 */
export interface MonteCarlobudget {
  /** Maximum number of simulation runs */
  maxRuns: number;
  
  /** Maximum wall-clock time in milliseconds */
  maxTimeMs: number;
  
  /** Maximum total cost (sum of tier costs) */
  maxCost: number;
}

/**
 * Default budget values
 */
export const DEFAULT_BUDGET: MonteCarlobudget = {
  maxRuns: 100,
  maxTimeMs: 5000,  // 5 seconds
  maxCost: 1000,
};

/**
 * Budget usage tracking
 */
export interface BudgetUsage {
  runsUsed: number;
  timeUsedMs: number;
  costUsed: number;
  runsRemaining: number;
  timeRemainingMs: number;
  costRemaining: number;
  percentComplete: number;
}

// ============================================
// PERTURBATION TYPES
// ============================================

/**
 * Perturbation configuration
 */
export interface PerturbationConfig {
  /** Weight jitter magnitude (e.g., 0.1 = ±10%) */
  weightJitter: number;
  
  /** Source quality jitter (e.g., 0.05 = ±5%) */
  sourceQualityJitter: number;
  
  /** Recency jitter in milliseconds */
  recencyJitterMs: number;
  
  /** Random seed for reproducibility (optional) */
  seed?: number;
}

/**
 * Default perturbation settings
 */
export const DEFAULT_PERTURBATION: PerturbationConfig = {
  weightJitter: 0.1,        // ±10% weight variation
  sourceQualityJitter: 0.05, // ±5% source quality variation  
  recencyJitterMs: 60000,    // ±1 minute time variation
};

/**
 * Record of perturbations applied in a single run
 */
export interface PerturbationRecord {
  runIndex: number;
  weightJitters: {
    fieldCoverage: number;
    sourceQuality: number;
    recency: number;
  };
  sourceQualityJitters: Record<string, number>;
  recencyOffsetMs: number;
}

// ============================================
// DECISION GOVERNOR
// ============================================

/**
 * Thresholds for stop/escalate decision
 */
export interface DecisionThresholds {
  /** Confidence threshold θ (e.g., 0.7 = 70%) */
  confidenceThreshold: number;
  
  /** Probability threshold p* (e.g., 0.8 = 80% of samples must meet θ) */
  probabilityThreshold: number;
}

/**
 * Default decision thresholds
 */
export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  confidenceThreshold: 0.7,   // θ = 70% confidence needed
  probabilityThreshold: 0.8,  // p* = 80% of samples must meet θ
};

/**
 * Decision outcome
 */
export type MonteCarloDecision = 'stop' | 'escalate';

// ============================================
// RESULT TYPES
// ============================================

/**
 * Statistical summary of Monte Carlo distribution
 */
export interface DistributionSummary {
  /** Mean confidence across all samples */
  mean: number;
  
  /** 10th percentile (pessimistic) */
  p10: number;
  
  /** 50th percentile (median) */
  p50: number;
  
  /** 90th percentile (optimistic) */
  p90: number;
  
  /** Standard deviation */
  stdev: number;
  
  /** Minimum value */
  min: number;
  
  /** Maximum value */
  max: number;
  
  /** Number of samples */
  sampleCount: number;
}

/**
 * Provenance for Monte Carlo run
 */
export interface MonteCarloProvenance {
  /** Number of runs completed */
  runs: number;
  
  /** Budget usage */
  budgetUsed: BudgetUsage;
  
  /** Perturbation config used */
  perturbationConfig: PerturbationConfig;
  
  /** Thresholds used for decision */
  thresholds: DecisionThresholds;
  
  /** Whether run was aborted early */
  aborted: boolean;
  
  /** Reason for abort (if any) */
  abortReason?: string;
  
  /** Timing info */
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
  
  /** Sample of perturbation records (first few for debugging) */
  perturbationSamples: PerturbationRecord[];
}

/**
 * Monte Carlo result - main output type
 */
export interface MonteCarloResult {
  /** All confidence samples collected */
  samples: number[];
  
  /** Statistical summary of distribution */
  summary: DistributionSummary;
  
  /** Decision: stop or escalate */
  decision: MonteCarloDecision;
  
  /** Human-readable reason for decision */
  reason: string;
  
  /** Full provenance */
  provenance: MonteCarloProvenance;
  
  /** Original extraction result (base case) */
  baseExtraction: ExtractionResult;
  
  /** Probability that confidence >= threshold */
  probabilityMeetsThreshold: number;
}

// ============================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================

/**
 * Simple seeded PRNG for reproducibility
 * Uses mulberry32 algorithm
 */
class SeededRandom {
  private state: number;
  
  constructor(seed?: number) {
    // Use timestamp if no seed provided
    this.state = seed ?? Date.now();
  }
  
  /**
   * Generate random number in [0, 1)
   */
  next(): number {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  /**
   * Generate random number in range [-magnitude, +magnitude]
   */
  jitter(magnitude: number): number {
    return (this.next() * 2 - 1) * magnitude;
  }
}

// ============================================
// PERTURBATION ENGINE
// ============================================

/**
 * Apply perturbations to confidence weights
 */
function perturbWeights(
  config: PerturbationConfig,
  rng: SeededRandom
): { fieldCoverage: number; sourceQuality: number; recency: number } {
  // Jitter each weight, keeping them positive and normalizing
  const jitteredFieldCoverage = Math.max(0.01, 
    CONFIDENCE_WEIGHTS.fieldCoverage + rng.jitter(config.weightJitter * CONFIDENCE_WEIGHTS.fieldCoverage));
  const jitteredSourceQuality = Math.max(0.01,
    CONFIDENCE_WEIGHTS.sourceQuality + rng.jitter(config.weightJitter * CONFIDENCE_WEIGHTS.sourceQuality));
  const jitteredRecency = Math.max(0.01,
    CONFIDENCE_WEIGHTS.recency + rng.jitter(config.weightJitter * CONFIDENCE_WEIGHTS.recency));
  
  // Normalize to sum to 1
  const total = jitteredFieldCoverage + jitteredSourceQuality + jitteredRecency;
  
  return {
    fieldCoverage: jitteredFieldCoverage / total,
    sourceQuality: jitteredSourceQuality / total,
    recency: jitteredRecency / total,
  };
}

/**
 * Apply perturbations to source quality scores
 */
function perturbSourceQuality(
  config: PerturbationConfig,
  rng: SeededRandom
): Record<string, number> {
  const perturbed: Record<string, number> = {};
  
  for (const [source, baseScore] of Object.entries(SOURCE_QUALITY_SCORES)) {
    const jitter = rng.jitter(config.sourceQualityJitter);
    // Keep in valid range [0, 1]
    perturbed[source] = Math.max(0, Math.min(1, baseScore + jitter));
  }
  
  return perturbed;
}

/**
 * Calculate perturbed confidence score
 */
function calculatePerturbedConfidence(
  claims: ClaimsRecord,
  requiredFields: RequiredField[],
  referenceTime: Date,
  perturbedWeights: { fieldCoverage: number; sourceQuality: number; recency: number },
  perturbedSourceQuality: Record<string, number>,
  recencyOffsetMs: number
): number {
  // Apply recency offset to reference time
  const adjustedTime = new Date(referenceTime.getTime() + recencyOffsetMs);
  
  // 1. Field Coverage Score (same as deterministic)
  const satisfiedCount = Object.values(claims).filter(c => c !== null).length;
  const totalRequired = requiredFields.length;
  const fieldCoverageScore = totalRequired > 0 ? satisfiedCount / totalRequired : 0;
  
  // 2. Source Quality Score with perturbed values
  const claimsWithValues = Object.values(claims).filter(c => c !== null) as any[];
  const sourceQualityScore = claimsWithValues.length > 0
    ? claimsWithValues.reduce((sum: number, claim: any) => {
        const quality = perturbedSourceQuality[claim.method] || perturbedSourceQuality['unknown'] || 0.5;
        return sum + quality;
      }, 0) / claimsWithValues.length
    : 0;
  
  // 3. Recency Score with adjusted time
  const ONE_HOUR_MS = 3600000;
  const ONE_DAY_MS = 86400000;
  const recencyScore = claimsWithValues.length > 0
    ? claimsWithValues.reduce((sum: number, claim: any) => {
        const ageMs = adjustedTime.getTime() - new Date(claim.extractedAt).getTime();
        if (ageMs < ONE_HOUR_MS) return sum + 1.0;
        if (ageMs < ONE_DAY_MS) return sum + 0.8;
        return sum + 0.5;
      }, 0) / claimsWithValues.length
    : 0;
  
  // 4. Final weighted score with perturbed weights
  return (
    (fieldCoverageScore * perturbedWeights.fieldCoverage) +
    (sourceQualityScore * perturbedWeights.sourceQuality) +
    (recencyScore * perturbedWeights.recency)
  );
}

// ============================================
// STATISTICS FUNCTIONS
// ============================================

/**
 * Calculate mean of array
 */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate standard deviation
 */
function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squaredDiffs = arr.map(val => Math.pow(val - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, val) => sum + val, 0) / (arr.length - 1));
}

/**
 * Calculate percentile
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate distribution summary
 */
function calculateSummary(samples: number[]): DistributionSummary {
  if (samples.length === 0) {
    return {
      mean: 0,
      p10: 0,
      p50: 0,
      p90: 0,
      stdev: 0,
      min: 0,
      max: 0,
      sampleCount: 0,
    };
  }
  
  const sorted = [...samples].sort((a, b) => a - b);
  
  return {
    mean: mean(samples),
    p10: percentile(samples, 10),
    p50: percentile(samples, 50),
    p90: percentile(samples, 90),
    stdev: stdev(samples),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sampleCount: samples.length,
  };
}

// ============================================
// MONTE CARLO ENGINE
// ============================================

/**
 * Monte Carlo request descriptor
 */
export interface MonteCarloRequest {
  /** Base extraction result from Step 3 */
  extraction: ExtractionResult;
  
  /** Budget constraints */
  budget?: Partial<MonteCarlobudget>;
  
  /** Perturbation configuration */
  perturbation?: Partial<PerturbationConfig>;
  
  /** Decision thresholds */
  thresholds?: Partial<DecisionThresholds>;
}

/**
 * Monte Carlo Engine - Main class for Step 4
 * 
 * Wraps the deterministic Step 3 pipeline with Monte Carlo perturbations
 * to produce confidence distributions and stop/escalate decisions.
 */
export class MonteCarloEngine {
  /**
   * Run Monte Carlo simulation
   * 
   * @param request - Monte Carlo request with extraction and config
   * @returns Monte Carlo result with distribution and decision
   */
  async runWithMonteCarlo(request: MonteCarloRequest): Promise<MonteCarloResult> {
    const startedAt = new Date();
    
    // Merge configs with defaults
    const budget: MonteCarlobudget = {
      ...DEFAULT_BUDGET,
      ...request.budget,
    };
    
    const perturbationConfig: PerturbationConfig = {
      ...DEFAULT_PERTURBATION,
      ...request.perturbation,
    };
    
    const thresholds: DecisionThresholds = {
      ...DEFAULT_THRESHOLDS,
      ...request.thresholds,
    };
    
    // Initialize RNG
    const rng = new SeededRandom(perturbationConfig.seed);
    
    // Run simulations
    const samples: number[] = [];
    const perturbationRecords: PerturbationRecord[] = [];
    let aborted = false;
    let abortReason: string | undefined;
    let costUsed = 0;
    
    const { extraction } = request;
    const referenceTime = extraction.timestamp;
    
    for (let i = 0; i < budget.maxRuns; i++) {
      // Check time budget
      const elapsed = Date.now() - startedAt.getTime();
      if (elapsed >= budget.maxTimeMs) {
        aborted = true;
        abortReason = `Time budget exceeded (${elapsed}ms >= ${budget.maxTimeMs}ms)`;
        break;
      }
      
      // Check cost budget
      if (costUsed >= budget.maxCost) {
        aborted = true;
        abortReason = `Cost budget exceeded (${costUsed} >= ${budget.maxCost})`;
        break;
      }
      
      // Generate perturbations
      const perturbedWeights = perturbWeights(perturbationConfig, rng);
      const perturbedSourceQuality = perturbSourceQuality(perturbationConfig, rng);
      const recencyOffsetMs = rng.jitter(perturbationConfig.recencyJitterMs);
      
      // Calculate perturbed confidence
      const confidence = calculatePerturbedConfidence(
        extraction.claims,
        extraction.requiredFields,
        referenceTime,
        perturbedWeights,
        perturbedSourceQuality,
        recencyOffsetMs
      );
      
      samples.push(confidence);
      
      // Record perturbations (keep first 10 for debugging)
      if (i < 10) {
        perturbationRecords.push({
          runIndex: i,
          weightJitters: {
            fieldCoverage: perturbedWeights.fieldCoverage - CONFIDENCE_WEIGHTS.fieldCoverage,
            sourceQuality: perturbedWeights.sourceQuality - CONFIDENCE_WEIGHTS.sourceQuality,
            recency: perturbedWeights.recency - CONFIDENCE_WEIGHTS.recency,
          },
          sourceQualityJitters: Object.fromEntries(
            Object.entries(perturbedSourceQuality).map(([k, v]) => [k, v - (SOURCE_QUALITY_SCORES[k] || 0.5)])
          ),
          recencyOffsetMs,
        });
      }
      
      // Increment cost (each run has minimal cost)
      costUsed += 1;
    }
    
    const completedAt = new Date();
    
    // Calculate summary
    const summary = calculateSummary(samples);
    
    // Calculate probability meeting threshold
    const meetsThreshold = samples.filter(s => s >= thresholds.confidenceThreshold).length;
    const probabilityMeetsThreshold = samples.length > 0 ? meetsThreshold / samples.length : 0;
    
    // Make decision
    const decision = this.makeDecision(probabilityMeetsThreshold, thresholds);
    const reason = this.generateDecisionReason(
      decision,
      probabilityMeetsThreshold,
      thresholds,
      summary,
      aborted,
      abortReason
    );
    
    // Build budget usage
    const budgetUsed: BudgetUsage = {
      runsUsed: samples.length,
      timeUsedMs: completedAt.getTime() - startedAt.getTime(),
      costUsed,
      runsRemaining: budget.maxRuns - samples.length,
      timeRemainingMs: Math.max(0, budget.maxTimeMs - (completedAt.getTime() - startedAt.getTime())),
      costRemaining: Math.max(0, budget.maxCost - costUsed),
      percentComplete: (samples.length / budget.maxRuns) * 100,
    };
    
    return {
      samples,
      summary,
      decision,
      reason,
      provenance: {
        runs: samples.length,
        budgetUsed,
        perturbationConfig,
        thresholds,
        aborted,
        abortReason,
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        perturbationSamples: perturbationRecords,
      },
      baseExtraction: extraction,
      probabilityMeetsThreshold,
    };
  }
  
  /**
   * Make stop/escalate decision based on probability threshold
   */
  private makeDecision(
    probability: number,
    thresholds: DecisionThresholds
  ): MonteCarloDecision {
    return probability >= thresholds.probabilityThreshold ? 'stop' : 'escalate';
  }
  
  /**
   * Generate human-readable decision reason
   */
  private generateDecisionReason(
    decision: MonteCarloDecision,
    probability: number,
    thresholds: DecisionThresholds,
    summary: DistributionSummary,
    aborted: boolean,
    abortReason?: string
  ): string {
    const pct = (n: number) => Math.round(n * 100);
    
    let reason = '';
    
    if (aborted) {
      reason = `[ABORTED: ${abortReason}] `;
    }
    
    if (decision === 'stop') {
      reason += `STOP: ${pct(probability)}% of ${summary.sampleCount} samples have confidence ≥ ${pct(thresholds.confidenceThreshold)}% `;
      reason += `(threshold: ${pct(thresholds.probabilityThreshold)}%). `;
      reason += `Mean confidence: ${pct(summary.mean)}%, range: [${pct(summary.min)}%, ${pct(summary.max)}%].`;
    } else {
      reason += `ESCALATE: Only ${pct(probability)}% of ${summary.sampleCount} samples have confidence ≥ ${pct(thresholds.confidenceThreshold)}% `;
      reason += `(need ${pct(thresholds.probabilityThreshold)}%). `;
      reason += `Mean confidence: ${pct(summary.mean)}%, P10: ${pct(summary.p10)}%, P90: ${pct(summary.p90)}%.`;
    }
    
    return reason;
  }
  
  /**
   * Quick check if escalation is recommended without full simulation
   */
  quickEscalationCheck(extraction: ExtractionResult, thresholds?: Partial<DecisionThresholds>): {
    shouldEscalate: boolean;
    reason: string;
  } {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    
    // If base confidence is already above threshold, no escalation needed
    if (extraction.confidence >= t.confidenceThreshold) {
      return {
        shouldEscalate: false,
        reason: `Base confidence (${Math.round(extraction.confidence * 100)}%) already meets threshold (${Math.round(t.confidenceThreshold * 100)}%)`,
      };
    }
    
    // If extraction is incomplete, likely need escalation
    if (!extraction.complete) {
      return {
        shouldEscalate: true,
        reason: `Extraction incomplete - ${extraction.gaps.entries.length} gaps remain`,
      };
    }
    
    // If confidence is very low, definitely escalate
    if (extraction.confidence < 0.3) {
      return {
        shouldEscalate: true,
        reason: `Confidence too low (${Math.round(extraction.confidence * 100)}%) - escalation recommended`,
      };
    }
    
    // Uncertain - need full Monte Carlo
    return {
      shouldEscalate: false,
      reason: `Confidence borderline (${Math.round(extraction.confidence * 100)}%) - run full Monte Carlo for definitive decision`,
    };
  }
}

// Export singleton
export const monteCarloEngine = new MonteCarloEngine();
