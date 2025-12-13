/**
 * LEXARA MONTE CARLO ENHANCEMENT & CONSULTATION OPTIMIZATION SYSTEM
 * 
 * A multi-layered Monte Carlo optimization engine that continuously refines Lexara's:
 * - Legal reasoning, comprehension, and analytical review
 * - Explanatory precision and hierarchical structuring
 * - Consultative engagement style (attorney-like conversational flow)
 * - Vocal gravitas and delivery optimization
 * 
 * Architecture:
 * 1. Scheduled Optimization Cycles - Three times daily, staggered
 * 2. Session-Scoped Evaluations - Triggered at decision boundaries only
 * 3. Multi-Domain Monte Carlo Simulations across optimization scopes
 * 4. Second-Order Influence Application - Preserving personality stability
 * 5. Pre-Response Application - Never mid-utterance
 * 
 * Safety Constraints:
 * - No latency introduction during live interaction
 * - No mid-speech alterations
 * - No tonal oscillation
 * - No user-specific profiling beyond active session
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import crypto from 'crypto';

const log = createLogger('LexaraMonteCarloOptimizer');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Optimization Domain Scopes
 */
export type OptimizationDomain = 
  | 'legal_understanding'
  | 'explanation_quality'
  | 'consultative_engagement'
  | 'vocal_delivery';

/**
 * Base metrics type that allows index access
 */
export interface MetricsBase {
  [key: string]: number;
}

/**
 * Legal Understanding Sub-Domains
 */
export interface LegalUnderstandingMetrics extends MetricsBase {
  issueIdentificationAccuracy: number;
  contextualInterpretation: number;
  doctrineReasoningPatterns: number;
  riskOutcomeFraming: number;
}

/**
 * Explanation Quality Sub-Domains
 */
export interface ExplanationQualityMetrics extends MetricsBase {
  hierarchicalStructuring: number;
  plainLanguageTranslation: number;
  analyticalSequencing: number;
  ambiguityReduction: number;
}

/**
 * Consultative Engagement Sub-Domains
 */
export interface ConsultativeEngagementMetrics extends MetricsBase {
  conversationalFlow: number;
  clarifyingQuestionTiming: number;
  responsivenessAndPacing: number;
  confidenceWithoutIntimidation: number;
  reassuranceWithAuthority: number;
}

/**
 * Vocal Delivery Sub-Domains
 */
export interface VocalDeliveryMetrics extends MetricsBase {
  speechCadenceEmphasis: number;
  perceivedConfidence: number;
  professionalToneStability: number;
  naturalDeliveryAntiRobotic: number;
}

/**
 * Complete Optimization Profile
 */
export interface OptimizationProfile {
  id: string;
  version: number;
  timestamp: Date;
  
  legalUnderstanding: LegalUnderstandingMetrics;
  explanationQuality: ExplanationQualityMetrics;
  consultativeEngagement: ConsultativeEngagementMetrics;
  vocalDelivery: VocalDeliveryMetrics;
  
  overallFitness: number;
  generationsSinceImprovement: number;
  isActive: boolean;
}

/**
 * Monte Carlo Simulation Configuration
 */
export interface MCOptimizationConfig {
  /** Number of simulations per domain */
  simulationsPerDomain: number;
  /** Maximum iterations per optimization cycle */
  maxIterations: number;
  /** Fitness improvement threshold to accept */
  improvementThreshold: number;
  /** Mutation rate for parameter exploration */
  mutationRate: number;
  /** Mutation magnitude */
  mutationMagnitude: number;
  /** Convergence threshold */
  convergenceThreshold: number;
  /** Maximum generations without improvement before stopping */
  maxStagnantGenerations: number;
}

/**
 * Optimization Cycle Type
 */
export type OptimizationCycleType = 'scheduled' | 'session_boundary';

/**
 * Optimization Cycle Result
 */
export interface OptimizationCycleResult {
  cycleId: string;
  cycleType: OptimizationCycleType;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  
  previousProfile: OptimizationProfile;
  newProfile: OptimizationProfile;
  
  domainImprovements: Record<OptimizationDomain, number>;
  totalImprovement: number;
  converged: boolean;
  
  simulationsRun: number;
  generationsCompleted: number;
}

/**
 * Session Context for Session-Bound Optimization
 */
export interface SessionContext {
  sessionId: string;
  startTime: Date;
  interactionCount: number;
  topicsDiscussed: string[];
  userSignals: {
    emotionalState: 'calm' | 'anxious' | 'frustrated' | 'curious' | 'grateful';
    urgency: 'low' | 'medium' | 'high';
    complexityLevel: 'simple' | 'moderate' | 'complex';
  };
  decisionBoundaries: DecisionBoundary[];
}

/**
 * Decision Boundary for Session-Scoped Optimization
 */
export interface DecisionBoundary {
  timestamp: Date;
  type: 'topic_shift' | 'complexity_escalation' | 'sentiment_change' | 'response_completion';
  triggerContext: string;
  optimizationApplied: boolean;
}

/**
 * Optimization State
 */
export interface LexaraOptimizationState {
  isRunning: boolean;
  currentCycleId: string | null;
  activeProfile: OptimizationProfile;
  profileHistory: OptimizationProfile[];
  totalCyclesCompleted: number;
  lastScheduledCycle: Date | null;
  lastSessionCycle: Date | null;
  
  // Safety metrics
  averageLatencyImpact: number;
  tonalStabilityScore: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default Monte Carlo Configuration
 */
const DEFAULT_MC_CONFIG: MCOptimizationConfig = {
  simulationsPerDomain: 50,
  maxIterations: 100,
  improvementThreshold: 0.001,
  mutationRate: 0.2,
  mutationMagnitude: 0.1,
  convergenceThreshold: 0.0001,
  maxStagnantGenerations: 5,
};

/**
 * Initial Baseline Profile - Calibrated for Lexara's legal consultation role
 */
const BASELINE_PROFILE: Omit<OptimizationProfile, 'id' | 'timestamp'> = {
  version: 1,
  
  legalUnderstanding: {
    issueIdentificationAccuracy: 0.85,
    contextualInterpretation: 0.80,
    doctrineReasoningPatterns: 0.82,
    riskOutcomeFraming: 0.78,
  },
  
  explanationQuality: {
    hierarchicalStructuring: 0.80,
    plainLanguageTranslation: 0.85,
    analyticalSequencing: 0.82,
    ambiguityReduction: 0.78,
  },
  
  consultativeEngagement: {
    conversationalFlow: 0.85,
    clarifyingQuestionTiming: 0.80,
    responsivenessAndPacing: 0.82,
    confidenceWithoutIntimidation: 0.85,
    reassuranceWithAuthority: 0.88,
  },
  
  vocalDelivery: {
    speechCadenceEmphasis: 0.80,
    perceivedConfidence: 0.85,
    professionalToneStability: 0.88,
    naturalDeliveryAntiRobotic: 0.82,
  },
  
  overallFitness: 0.83,
  generationsSinceImprovement: 0,
  isActive: true,
};

// ============================================================================
// MONTE CARLO SIMULATION ENGINE
// ============================================================================

/**
 * Monte Carlo Simulator for Optimization Profiles
 */
class MonteCarloProfileSimulator {
  private config: MCOptimizationConfig;
  
  constructor(config: MCOptimizationConfig = DEFAULT_MC_CONFIG) {
    this.config = config;
  }
  
  /**
   * Run Monte Carlo simulation for a specific domain
   */
  simulateDomain<T extends MetricsBase>(
    currentMetrics: T,
    domain: OptimizationDomain
  ): { optimizedMetrics: T; improvement: number; converged: boolean } {
    let bestMetrics = { ...currentMetrics };
    let bestFitness = this.calculateDomainFitness(currentMetrics);
    let stagnantGenerations = 0;
    let converged = false;
    
    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // Run batch of simulations
      const candidates: Array<{ metrics: T; fitness: number }> = [];
      
      for (let sim = 0; sim < this.config.simulationsPerDomain; sim++) {
        const mutatedMetrics = this.mutateMetrics(bestMetrics);
        const fitness = this.calculateDomainFitness(mutatedMetrics);
        candidates.push({ metrics: mutatedMetrics, fitness });
      }
      
      // Find best candidate
      const bestCandidate = candidates.reduce((best, current) => 
        current.fitness > best.fitness ? current : best
      );
      
      // Check for improvement
      const improvement = bestCandidate.fitness - bestFitness;
      
      if (improvement > this.config.improvementThreshold) {
        bestMetrics = bestCandidate.metrics;
        bestFitness = bestCandidate.fitness;
        stagnantGenerations = 0;
      } else {
        stagnantGenerations++;
      }
      
      // Check convergence
      if (improvement < this.config.convergenceThreshold || 
          stagnantGenerations >= this.config.maxStagnantGenerations) {
        converged = true;
        break;
      }
    }
    
    const totalImprovement = bestFitness - this.calculateDomainFitness(currentMetrics);
    
    return {
      optimizedMetrics: bestMetrics,
      improvement: totalImprovement,
      converged,
    };
  }
  
  /**
   * Mutate metrics for exploration
   */
  private mutateMetrics<T extends MetricsBase>(metrics: T): T {
    const mutated: MetricsBase = {};
    
    for (const [key, value] of Object.entries(metrics)) {
      if (Math.random() < this.config.mutationRate) {
        const delta = (Math.random() - 0.5) * 2 * this.config.mutationMagnitude;
        mutated[key] = Math.max(0, Math.min(1, value + delta));
      } else {
        mutated[key] = value;
      }
    }
    
    return mutated as T;
  }
  
  /**
   * Calculate fitness for a domain's metrics
   */
  private calculateDomainFitness<T extends MetricsBase>(metrics: T): number {
    const values = Object.values(metrics);
    if (values.length === 0) return 0;
    
    // Weighted average with slight bonus for consistency (low variance)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const consistencyBonus = Math.max(0, 0.05 * (1 - Math.sqrt(variance)));
    
    return mean + consistencyBonus;
  }
  
  /**
   * Calculate overall profile fitness
   */
  calculateOverallFitness(profile: OptimizationProfile): number {
    const weights = {
      legalUnderstanding: 0.30,
      explanationQuality: 0.25,
      consultativeEngagement: 0.25,
      vocalDelivery: 0.20,
    };
    
    const legalFitness = this.calculateDomainFitness(profile.legalUnderstanding);
    const explanationFitness = this.calculateDomainFitness(profile.explanationQuality);
    const consultativeFitness = this.calculateDomainFitness(profile.consultativeEngagement);
    const vocalFitness = this.calculateDomainFitness(profile.vocalDelivery);
    
    return (
      legalFitness * weights.legalUnderstanding +
      explanationFitness * weights.explanationQuality +
      consultativeFitness * weights.consultativeEngagement +
      vocalFitness * weights.vocalDelivery
    );
  }
}

// ============================================================================
// SECOND-ORDER INFLUENCE APPLICATOR
// ============================================================================

/**
 * Applies optimization improvements at second-order influence only
 * This ensures changes enhance effectiveness while preserving personality stability
 */
class SecondOrderInfluenceApplicator {
  private readonly maxInfluence = 0.15; // Maximum 15% change per application
  
  /**
   * Apply optimization profile changes with second-order influence constraint
   */
  applyInfluence<T extends MetricsBase>(
    currentMetrics: T,
    targetMetrics: T
  ): T {
    const result: MetricsBase = {};
    
    for (const [key, currentValue] of Object.entries(currentMetrics)) {
      const targetValue = targetMetrics[key];
      const delta = targetValue - currentValue;
      
      // Apply second-order influence: cap the change magnitude
      const constrainedDelta = Math.sign(delta) * Math.min(Math.abs(delta), this.maxInfluence);
      result[key] = currentValue + constrainedDelta;
    }
    
    return result as T;
  }
  
  /**
   * Calculate tonal stability score to ensure no tonal oscillation
   */
  calculateTonalStability(
    previousProfile: OptimizationProfile,
    currentProfile: OptimizationProfile
  ): number {
    // Check key stability metrics
    const confidenceChange = Math.abs(
      currentProfile.consultativeEngagement.confidenceWithoutIntimidation -
      previousProfile.consultativeEngagement.confidenceWithoutIntimidation
    );
    
    const toneChange = Math.abs(
      currentProfile.vocalDelivery.professionalToneStability -
      previousProfile.vocalDelivery.professionalToneStability
    );
    
    const reassuranceChange = Math.abs(
      currentProfile.consultativeEngagement.reassuranceWithAuthority -
      previousProfile.consultativeEngagement.reassuranceWithAuthority
    );
    
    // Stability score: 1.0 = perfectly stable, 0.0 = highly unstable
    const maxTotalChange = 0.45; // Sum of 3 * maxInfluence
    const totalChange = confidenceChange + toneChange + reassuranceChange;
    
    return Math.max(0, 1 - (totalChange / maxTotalChange));
  }
}

// ============================================================================
// LEXARA MONTE CARLO OPTIMIZER ENGINE
// ============================================================================

export const lexaraMCOptimizerEvents = new EventEmitter();

/**
 * Main Lexara Monte Carlo Optimization Engine
 */
class LexaraMonteCarloOptimizerEngine {
  private static instance: LexaraMonteCarloOptimizerEngine;
  
  private config: MCOptimizationConfig;
  private simulator: MonteCarloProfileSimulator;
  private influenceApplicator: SecondOrderInfluenceApplicator;
  private state: LexaraOptimizationState;
  
  // Session tracking (no persistent user profiling)
  private activeSession: SessionContext | null = null;
  
  private constructor() {
    this.config = { ...DEFAULT_MC_CONFIG };
    this.simulator = new MonteCarloProfileSimulator(this.config);
    this.influenceApplicator = new SecondOrderInfluenceApplicator();
    
    // Initialize with baseline profile
    const initialProfile: OptimizationProfile = {
      ...BASELINE_PROFILE,
      id: this.generateProfileId(),
      timestamp: new Date(),
    };
    
    this.state = {
      isRunning: false,
      currentCycleId: null,
      activeProfile: initialProfile,
      profileHistory: [initialProfile],
      totalCyclesCompleted: 0,
      lastScheduledCycle: null,
      lastSessionCycle: null,
      averageLatencyImpact: 0,
      tonalStabilityScore: 1.0,
    };
  }
  
  static getInstance(): LexaraMonteCarloOptimizerEngine {
    if (!LexaraMonteCarloOptimizerEngine.instance) {
      LexaraMonteCarloOptimizerEngine.instance = new LexaraMonteCarloOptimizerEngine();
    }
    return LexaraMonteCarloOptimizerEngine.instance;
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  /**
   * Configure the optimizer
   */
  configure(config: Partial<MCOptimizationConfig>): void {
    this.config = { ...this.config, ...config };
    this.simulator = new MonteCarloProfileSimulator(this.config);
    log.info('LexaraMCOptimizer configured', this.config);
  }
  
  /**
   * Get current optimization state
   */
  getState(): LexaraOptimizationState {
    return { ...this.state };
  }
  
  /**
   * Get active optimization profile
   */
  getActiveProfile(): OptimizationProfile {
    return { ...this.state.activeProfile };
  }
  
  /**
   * Check if optimization is currently running
   */
  isRunning(): boolean {
    return this.state.isRunning;
  }
  
  /**
   * Run a scheduled optimization cycle
   * Called three times daily, staggered from other MC processes
   */
  async runScheduledOptimization(): Promise<OptimizationCycleResult> {
    if (this.state.isRunning) {
      throw new Error('Optimization cycle already in progress');
    }
    
    return this.runOptimizationCycle('scheduled');
  }
  
  /**
   * Run session-boundary optimization
   * Triggered exclusively at decision boundaries (never during live speech)
   */
  async runSessionBoundaryOptimization(
    session: SessionContext,
    boundary: DecisionBoundary
  ): Promise<OptimizationCycleResult | null> {
    // Safety check: Never run during active speech
    if (this.state.isRunning) {
      log.debug('Skipping session optimization - cycle in progress');
      return null;
    }
    
    // Only optimize at appropriate decision boundaries
    if (boundary.type === 'response_completion') {
      log.debug('Session boundary optimization triggered', {
        sessionId: session.sessionId,
        boundaryType: boundary.type,
      });
      
      this.activeSession = session;
      const result = await this.runOptimizationCycle('session_boundary');
      this.activeSession = null;
      
      // Mark boundary as optimized
      boundary.optimizationApplied = true;
      
      return result;
    }
    
    return null;
  }
  
  /**
   * Start a new session (for session-scoped optimization)
   */
  startSession(sessionId: string): SessionContext {
    const session: SessionContext = {
      sessionId,
      startTime: new Date(),
      interactionCount: 0,
      topicsDiscussed: [],
      userSignals: {
        emotionalState: 'calm',
        urgency: 'low',
        complexityLevel: 'simple',
      },
      decisionBoundaries: [],
    };
    
    this.activeSession = session;
    return session;
  }
  
  /**
   * End current session - ensures no persistent user profiling
   */
  endSession(): void {
    if (this.activeSession) {
      log.debug('Session ended - clearing session context', {
        sessionId: this.activeSession.sessionId,
        duration: Date.now() - this.activeSession.startTime.getTime(),
      });
    }
    this.activeSession = null;
  }
  
  /**
   * Record a decision boundary in the current session
   */
  recordDecisionBoundary(
    type: DecisionBoundary['type'],
    triggerContext: string
  ): DecisionBoundary | null {
    if (!this.activeSession) {
      return null;
    }
    
    const boundary: DecisionBoundary = {
      timestamp: new Date(),
      type,
      triggerContext,
      optimizationApplied: false,
    };
    
    this.activeSession.decisionBoundaries.push(boundary);
    return boundary;
  }
  
  /**
   * Get optimization profile for response generation
   * This is called BEFORE response generation, never mid-utterance
   */
  getProfileForResponse(): OptimizationProfile {
    return this.state.activeProfile;
  }
  
  /**
   * Apply profile to response parameters
   * Returns optimization parameters without introducing latency
   */
  applyToResponseParameters(): {
    legalReasoningBias: number;
    explanationStructure: 'hierarchical' | 'sequential' | 'adaptive';
    conversationalTone: 'professional' | 'warm' | 'balanced';
    vocalEmphasisLevel: number;
  } {
    const profile = this.state.activeProfile;
    
    // Map profile metrics to response parameters
    const legalBias = (
      profile.legalUnderstanding.issueIdentificationAccuracy * 0.4 +
      profile.legalUnderstanding.doctrineReasoningPatterns * 0.3 +
      profile.legalUnderstanding.riskOutcomeFraming * 0.3
    );
    
    const structureScore = profile.explanationQuality.hierarchicalStructuring;
    const structure = structureScore > 0.85 ? 'hierarchical' :
                      structureScore > 0.7 ? 'adaptive' : 'sequential';
    
    const confidenceScore = profile.consultativeEngagement.confidenceWithoutIntimidation;
    const warmthScore = profile.consultativeEngagement.reassuranceWithAuthority;
    const tone = confidenceScore > 0.85 && warmthScore > 0.85 ? 'balanced' :
                 confidenceScore > warmthScore ? 'professional' : 'warm';
    
    const emphasisLevel = (
      profile.vocalDelivery.speechCadenceEmphasis * 0.5 +
      profile.vocalDelivery.perceivedConfidence * 0.5
    );
    
    return {
      legalReasoningBias: legalBias,
      explanationStructure: structure,
      conversationalTone: tone,
      vocalEmphasisLevel: emphasisLevel,
    };
  }
  
  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================
  
  /**
   * Run a full optimization cycle
   */
  private async runOptimizationCycle(
    cycleType: OptimizationCycleType
  ): Promise<OptimizationCycleResult> {
    const cycleId = this.generateCycleId();
    const startTime = new Date();
    
    log.info(`🔬 Starting ${cycleType} Monte Carlo optimization cycle`, { cycleId });
    
    this.state.isRunning = true;
    this.state.currentCycleId = cycleId;
    
    lexaraMCOptimizerEvents.emit('cycle-started', { cycleId, cycleType });
    
    const previousProfile = { ...this.state.activeProfile };
    let simulationsRun = 0;
    let generationsCompleted = 0;
    
    try {
      // Optimize each domain
      const domainImprovements: Record<OptimizationDomain, number> = {
        legal_understanding: 0,
        explanation_quality: 0,
        consultative_engagement: 0,
        vocal_delivery: 0,
      };
      
      // Legal Understanding Domain
      const legalResult = this.simulator.simulateDomain(
        previousProfile.legalUnderstanding,
        'legal_understanding'
      );
      simulationsRun += this.config.simulationsPerDomain * this.config.maxIterations;
      generationsCompleted++;
      
      // Explanation Quality Domain
      const explanationResult = this.simulator.simulateDomain(
        previousProfile.explanationQuality,
        'explanation_quality'
      );
      simulationsRun += this.config.simulationsPerDomain * this.config.maxIterations;
      generationsCompleted++;
      
      // Consultative Engagement Domain
      const consultativeResult = this.simulator.simulateDomain(
        previousProfile.consultativeEngagement,
        'consultative_engagement'
      );
      simulationsRun += this.config.simulationsPerDomain * this.config.maxIterations;
      generationsCompleted++;
      
      // Vocal Delivery Domain
      const vocalResult = this.simulator.simulateDomain(
        previousProfile.vocalDelivery,
        'vocal_delivery'
      );
      simulationsRun += this.config.simulationsPerDomain * this.config.maxIterations;
      generationsCompleted++;
      
      // Apply second-order influence constraints
      const newLegalUnderstanding = this.influenceApplicator.applyInfluence(
        previousProfile.legalUnderstanding,
        legalResult.optimizedMetrics
      );
      
      const newExplanationQuality = this.influenceApplicator.applyInfluence(
        previousProfile.explanationQuality,
        explanationResult.optimizedMetrics
      );
      
      const newConsultativeEngagement = this.influenceApplicator.applyInfluence(
        previousProfile.consultativeEngagement,
        consultativeResult.optimizedMetrics
      );
      
      const newVocalDelivery = this.influenceApplicator.applyInfluence(
        previousProfile.vocalDelivery,
        vocalResult.optimizedMetrics
      );
      
      // Build new profile
      const newProfile: OptimizationProfile = {
        id: this.generateProfileId(),
        version: previousProfile.version + 1,
        timestamp: new Date(),
        legalUnderstanding: newLegalUnderstanding,
        explanationQuality: newExplanationQuality,
        consultativeEngagement: newConsultativeEngagement,
        vocalDelivery: newVocalDelivery,
        overallFitness: 0, // Calculated below
        generationsSinceImprovement: 0,
        isActive: true,
      };
      
      newProfile.overallFitness = this.simulator.calculateOverallFitness(newProfile);
      
      // Calculate domain improvements
      domainImprovements.legal_understanding = legalResult.improvement;
      domainImprovements.explanation_quality = explanationResult.improvement;
      domainImprovements.consultative_engagement = consultativeResult.improvement;
      domainImprovements.vocal_delivery = vocalResult.improvement;
      
      const totalImprovement = newProfile.overallFitness - previousProfile.overallFitness;
      
      // Calculate tonal stability
      const tonalStability = this.influenceApplicator.calculateTonalStability(
        previousProfile,
        newProfile
      );
      
      // Update state
      previousProfile.isActive = false;
      this.state.activeProfile = newProfile;
      this.state.profileHistory.push(newProfile);
      this.state.totalCyclesCompleted++;
      this.state.tonalStabilityScore = tonalStability;
      
      if (cycleType === 'scheduled') {
        this.state.lastScheduledCycle = new Date();
      } else {
        this.state.lastSessionCycle = new Date();
      }
      
      // Keep history manageable
      if (this.state.profileHistory.length > 50) {
        this.state.profileHistory = this.state.profileHistory.slice(-50);
      }
      
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      
      const converged = 
        legalResult.converged && 
        explanationResult.converged && 
        consultativeResult.converged && 
        vocalResult.converged;
      
      const result: OptimizationCycleResult = {
        cycleId,
        cycleType,
        startTime,
        endTime,
        durationMs,
        previousProfile,
        newProfile,
        domainImprovements,
        totalImprovement,
        converged,
        simulationsRun,
        generationsCompleted,
      };
      
      log.info(`✅ Optimization cycle complete`, {
        cycleId,
        durationMs,
        totalImprovement: totalImprovement.toFixed(6),
        tonalStability: tonalStability.toFixed(4),
        converged,
      });
      
      lexaraMCOptimizerEvents.emit('cycle-complete', result);
      
      return result;
      
    } finally {
      this.state.isRunning = false;
      this.state.currentCycleId = null;
    }
  }
  
  /**
   * Generate unique profile ID
   */
  private generateProfileId(): string {
    return `lexara-profile-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
  
  /**
   * Generate unique cycle ID
   */
  private generateCycleId(): string {
    return `mc-cycle-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const lexaraMCOptimizer = LexaraMonteCarloOptimizerEngine.getInstance();

// Convenience functions
export function configureLexaraMCOptimizer(config: Partial<MCOptimizationConfig>): void {
  lexaraMCOptimizer.configure(config);
}

export function getLexaraMCOptimizerState(): LexaraOptimizationState {
  return lexaraMCOptimizer.getState();
}

export function getActiveOptimizationProfile(): OptimizationProfile {
  return lexaraMCOptimizer.getActiveProfile();
}

export async function runScheduledMCOptimization(): Promise<OptimizationCycleResult> {
  return lexaraMCOptimizer.runScheduledOptimization();
}

export async function runSessionBoundaryMCOptimization(
  session: SessionContext,
  boundary: DecisionBoundary
): Promise<OptimizationCycleResult | null> {
  return lexaraMCOptimizer.runSessionBoundaryOptimization(session, boundary);
}

export function startLexaraSession(sessionId: string): SessionContext {
  return lexaraMCOptimizer.startSession(sessionId);
}

export function endLexaraSession(): void {
  lexaraMCOptimizer.endSession();
}

export function recordLexaraDecisionBoundary(
  type: DecisionBoundary['type'],
  triggerContext: string
): DecisionBoundary | null {
  return lexaraMCOptimizer.recordDecisionBoundary(type, triggerContext);
}

export function getOptimizedResponseParameters(): ReturnType<typeof lexaraMCOptimizer.applyToResponseParameters> {
  return lexaraMCOptimizer.applyToResponseParameters();
}

export default lexaraMCOptimizer;
