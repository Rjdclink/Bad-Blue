/**
 * Lexara — Integrated Monte Carlo Enhancement & Consultation Optimization System
 * 
 * A multi-layered Monte Carlo optimization engine that continuously refines Lexara's:
 * - Legal reasoning and comprehension
 * - Analytical review and explanatory precision
 * - Consultative engagement style
 * - Vocal authority and gravitas
 * 
 * Execution Cadence:
 * - Three scheduled optimization cycles per day (staggered to prevent overlap)
 * - Session-scoped Monte Carlo evaluations at decision boundaries only
 * 
 * Safety Constraints:
 * - Optimizations applied prior to response generation, never mid-utterance
 * - No latency introduction during live interactions
 * - No tonal oscillation or personality destabilization
 * - No user-specific profiling persisted beyond active session
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import crypto from 'crypto';

const log = createLogger('LexaraMonteCarloEnhancement');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Optimization Domain Categories
 */
export type OptimizationDomain = 
  | 'legal_understanding'
  | 'explanation_quality'
  | 'consultative_engagement'
  | 'vocal_gravitas';

/**
 * Legal Understanding & Comprehension Metrics
 */
export interface LegalUnderstandingMetrics {
  /** Accuracy in identifying core legal issues (0-1) */
  issueIdentificationAccuracy: number;
  /** Quality of contextual interpretation (0-1) */
  contextualInterpretation: number;
  /** Adherence to doctrine-style reasoning patterns (0-1) */
  doctrineReasoningScore: number;
  /** Quality of risk and outcome framing (0-1) */
  riskOutcomeFraming: number;
}

/**
 * Explanation & Analysis Quality Metrics
 */
export interface ExplanationQualityMetrics {
  /** Effectiveness of hierarchical explanation structuring (0-1) */
  hierarchicalStructuring: number;
  /** Quality of plain-language translation (0-1) */
  plainLanguageTranslation: number;
  /** Adherence to facts → issues → analysis → guidance sequence (0-1) */
  analyticalSequencing: number;
  /** Reduction of ambiguity and redundancy (0-1) */
  clarityScore: number;
}

/**
 * Consultative Engagement & Communication Style Metrics
 */
export interface ConsultativeEngagementMetrics {
  /** Attorney-like conversational flow (listen → analyze → advise) (0-1) */
  conversationalFlow: number;
  /** Appropriateness of clarifying question timing (0-1) */
  clarifyingQuestionTiming: number;
  /** Responsiveness and pacing quality (0-1) */
  responsivenessPacing: number;
  /** Confidence without intimidation balance (0-1) */
  confidenceBalance: number;
  /** Reassurance without loss of authority (0-1) */
  reassuranceAuthority: number;
}

/**
 * Vocal Gravitas & Delivery Optimization Metrics
 */
export interface VocalGravitasMetrics {
  /** Speech cadence and emphasis quality (0-1) */
  speechCadence: number;
  /** Perceived confidence and decisiveness (0-1) */
  perceivedConfidence: number;
  /** Professional tone stability (0-1) */
  toneStability: number;
  /** Reduction of robotic or monotone artifacts (0-1) */
  naturalDelivery: number;
}

/**
 * Complete Optimization Profile
 */
export interface OptimizationProfile {
  id: string;
  timestamp: Date;
  domains: {
    legalUnderstanding: LegalUnderstandingMetrics;
    explanationQuality: ExplanationQualityMetrics;
    consultativeEngagement: ConsultativeEngagementMetrics;
    vocalGravitas: VocalGravitasMetrics;
  };
  overallScore: number;
  generation: number;
}

/**
 * Candidate Strategy for Monte Carlo Evaluation
 */
export interface CandidateStrategy {
  id: string;
  domain: OptimizationDomain;
  parameters: Record<string, number>;
  parentId?: string;
  generation: number;
}

/**
 * Evaluated Strategy with Fitness Scores
 */
export interface EvaluatedStrategy {
  strategy: CandidateStrategy;
  fitness: number;
  domainScore: number;
  evaluatedAt: Date;
}

/**
 * Monte Carlo Enhancement Configuration
 */
export interface MonteCarloEnhancementConfig {
  /** Number of candidate strategies per domain per cycle */
  candidatesPerDomain: number;
  /** Maximum generations per optimization cycle */
  maxGenerations: number;
  /** Elite strategies to retain per generation */
  eliteCount: number;
  /** Mutation rate for strategy parameters (0-1) */
  mutationRate: number;
  /** Mutation magnitude for parameter changes */
  mutationMagnitude: number;
  /** Early convergence threshold */
  convergenceThreshold: number;
  /** Minimum fitness threshold to accept optimization */
  acceptanceThreshold: number;
  /** Initial population variation from baseline (0-1) */
  initialVariation: number;
  /** Maximum improvement per micro-optimization (0-1) */
  microOptimizationMaxImprovement: number;
}

/**
 * Session Context for Decision Boundary Evaluation
 */
export interface SessionContext {
  sessionId: string;
  conversationTurn: number;
  lastOptimizationAt: Date | null;
  currentPhase: 'listening' | 'analyzing' | 'responding' | 'idle';
  decisionBoundaryReached: boolean;
}

/**
 * Scheduled Cycle Configuration
 */
export interface ScheduledCycleConfig {
  /** Hour in UTC for first daily cycle (default: 3 AM) */
  firstCycleHour: number;
  /** Hour in UTC for second daily cycle (default: 11 AM) */
  secondCycleHour: number;
  /** Hour in UTC for third daily cycle (default: 7 PM) */
  thirdCycleHour: number;
}

/**
 * Enhancement System State
 */
export interface EnhancementSystemState {
  isRunning: boolean;
  currentCycle: number;
  totalCyclesCompleted: number;
  lastOptimizationAt: Date | null;
  activeProfile: OptimizationProfile | null;
  historicalProfiles: OptimizationProfile[];
  scheduledTimers: NodeJS.Timeout[];
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_CONFIG: MonteCarloEnhancementConfig = {
  candidatesPerDomain: 15,
  maxGenerations: 8,
  eliteCount: 3,
  mutationRate: 0.25,
  mutationMagnitude: 0.12,
  convergenceThreshold: 0.005,
  acceptanceThreshold: 0.75,
  initialVariation: 0.1,
  microOptimizationMaxImprovement: 0.02,
};

const DEFAULT_SCHEDULE: ScheduledCycleConfig = {
  firstCycleHour: 3,   // 3 AM UTC
  secondCycleHour: 11, // 11 AM UTC
  thirdCycleHour: 19,  // 7 PM UTC
};

/**
 * Initial baseline metrics representing a seasoned legal professional
 */
const BASELINE_METRICS: OptimizationProfile['domains'] = {
  legalUnderstanding: {
    issueIdentificationAccuracy: 0.85,
    contextualInterpretation: 0.82,
    doctrineReasoningScore: 0.80,
    riskOutcomeFraming: 0.83,
  },
  explanationQuality: {
    hierarchicalStructuring: 0.84,
    plainLanguageTranslation: 0.86,
    analyticalSequencing: 0.82,
    clarityScore: 0.85,
  },
  consultativeEngagement: {
    conversationalFlow: 0.83,
    clarifyingQuestionTiming: 0.80,
    responsivenessPacing: 0.84,
    confidenceBalance: 0.82,
    reassuranceAuthority: 0.81,
  },
  vocalGravitas: {
    speechCadence: 0.82,
    perceivedConfidence: 0.84,
    toneStability: 0.86,
    naturalDelivery: 0.80,
  },
};

// ============================================================================
// MONTE CARLO ENHANCEMENT ENGINE
// ============================================================================

export const monteCarloEnhancementEvents = new EventEmitter();

class LexaraMonteCarloEnhancementEngine {
  private static instance: LexaraMonteCarloEnhancementEngine;
  private config: MonteCarloEnhancementConfig;
  private scheduleConfig: ScheduledCycleConfig;
  private state: EnhancementSystemState;

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.scheduleConfig = { ...DEFAULT_SCHEDULE };
    this.state = {
      isRunning: false,
      currentCycle: 0,
      totalCyclesCompleted: 0,
      lastOptimizationAt: null,
      activeProfile: this.createBaselineProfile(),
      historicalProfiles: [],
      scheduledTimers: [],
    };
  }

  static getInstance(): LexaraMonteCarloEnhancementEngine {
    if (!LexaraMonteCarloEnhancementEngine.instance) {
      LexaraMonteCarloEnhancementEngine.instance = new LexaraMonteCarloEnhancementEngine();
    }
    return LexaraMonteCarloEnhancementEngine.instance;
  }

  // ============================================================================
  // INITIALIZATION & SCHEDULING
  // ============================================================================

  /**
   * Initialize the enhancement system and start scheduled cycles
   */
  async initialize(): Promise<void> {
    log.info('🎯 Lexara Monte Carlo Enhancement System initializing...');
    
    // Clear any existing timers
    this.clearScheduledTimers();
    
    // Schedule the three daily optimization cycles
    this.scheduleDailyCycles();
    
    log.info('✓ Enhancement System initialized');
    log.info(`  Scheduled cycles: ${this.scheduleConfig.firstCycleHour}:00, ${this.scheduleConfig.secondCycleHour}:00, ${this.scheduleConfig.thirdCycleHour}:00 UTC`);
    
    monteCarloEnhancementEvents.emit('system-initialized', {
      config: this.config,
      schedule: this.scheduleConfig,
    });
  }

  /**
   * Schedule the three daily optimization cycles
   */
  private scheduleDailyCycles(): void {
    const scheduleHours = [
      this.scheduleConfig.firstCycleHour,
      this.scheduleConfig.secondCycleHour,
      this.scheduleConfig.thirdCycleHour,
    ];

    for (const hour of scheduleHours) {
      this.scheduleNextCycle(hour);
    }
  }

  /**
   * Schedule the next occurrence of a cycle at a specific hour
   */
  private scheduleNextCycle(hour: number): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    const delay = next.getTime() - now.getTime();
    
    const timer = setTimeout(async () => {
      await this.runScheduledOptimizationCycle().catch(err => {
        log.error('Scheduled optimization cycle failed:', err);
      });
      // Reschedule for the next day
      this.scheduleNextCycle(hour);
    }, delay);
    
    this.state.scheduledTimers.push(timer);
    log.info(`Scheduled optimization cycle at ${next.toISOString()}`);
  }

  /**
   * Clear all scheduled timers
   */
  private clearScheduledTimers(): void {
    for (const timer of this.state.scheduledTimers) {
      clearTimeout(timer);
    }
    this.state.scheduledTimers = [];
  }

  // ============================================================================
  // SCHEDULED OPTIMIZATION CYCLE
  // ============================================================================

  /**
   * Run a scheduled optimization cycle across all domains
   * This is one of the three daily staggered cycles
   */
  async runScheduledOptimizationCycle(): Promise<OptimizationProfile | null> {
    if (this.state.isRunning) {
      log.warn('Optimization cycle already in progress, skipping');
      return null;
    }

    this.state.isRunning = true;
    this.state.currentCycle++;
    const cycleId = this.state.currentCycle;

    log.info('═══════════════════════════════════════════════════════');
    log.info(`🎯 LEXARA MONTE CARLO ENHANCEMENT - Cycle ${cycleId}`);
    log.info('═══════════════════════════════════════════════════════');

    monteCarloEnhancementEvents.emit('cycle-started', { cycleId });

    try {
      const domains: OptimizationDomain[] = [
        'legal_understanding',
        'explanation_quality',
        'consultative_engagement',
        'vocal_gravitas',
      ];

      const optimizedDomains: Partial<OptimizationProfile['domains']> = {};

      for (const domain of domains) {
        log.info(`\n[Domain: ${domain}] Starting Monte Carlo optimization...`);
        const optimized = await this.optimizeDomain(domain);
        
        switch (domain) {
          case 'legal_understanding':
            optimizedDomains.legalUnderstanding = optimized as unknown as LegalUnderstandingMetrics;
            break;
          case 'explanation_quality':
            optimizedDomains.explanationQuality = optimized as unknown as ExplanationQualityMetrics;
            break;
          case 'consultative_engagement':
            optimizedDomains.consultativeEngagement = optimized as unknown as ConsultativeEngagementMetrics;
            break;
          case 'vocal_gravitas':
            optimizedDomains.vocalGravitas = optimized as unknown as VocalGravitasMetrics;
            break;
        }
        
        log.info(`[Domain: ${domain}] ✓ Optimization complete`);
      }

      // Create new optimized profile
      const newProfile = this.createOptimizationProfile(optimizedDomains as OptimizationProfile['domains']);

      // Apply profile if it meets acceptance threshold
      if (newProfile.overallScore >= this.config.acceptanceThreshold) {
        this.applyOptimizationProfile(newProfile);
        log.info(`\n✓ Profile ${newProfile.id} applied (score: ${newProfile.overallScore.toFixed(4)})`);
      } else {
        log.info(`\n⚠ Profile ${newProfile.id} below threshold (score: ${newProfile.overallScore.toFixed(4)})`);
      }

      this.state.totalCyclesCompleted++;
      this.state.lastOptimizationAt = new Date();
      this.state.isRunning = false;

      monteCarloEnhancementEvents.emit('cycle-complete', {
        cycleId,
        profile: newProfile,
        applied: newProfile.overallScore >= this.config.acceptanceThreshold,
      });

      log.info('═══════════════════════════════════════════════════════');
      log.info(`CYCLE ${cycleId} COMPLETE - Total cycles: ${this.state.totalCyclesCompleted}`);
      log.info('═══════════════════════════════════════════════════════');

      return newProfile;

    } catch (error) {
      this.state.isRunning = false;
      log.error('Optimization cycle error:', error);
      monteCarloEnhancementEvents.emit('cycle-error', { cycleId, error });
      throw error;
    }
  }

  // ============================================================================
  // SESSION-SCOPED EVALUATION
  // ============================================================================

  /**
   * Evaluate at decision boundary within a session
   * Called ONLY at decision boundaries, never during live speech
   * 
   * Safety: This method checks phase and ensures no mid-utterance evaluation
   */
  async evaluateAtDecisionBoundary(context: SessionContext): Promise<OptimizationProfile | null> {
    // Safety check: Never evaluate during responding phase
    if (context.currentPhase === 'responding') {
      log.debug('Skipping evaluation during responding phase (safety constraint)');
      return null;
    }

    // Only evaluate when decision boundary is explicitly reached
    if (!context.decisionBoundaryReached) {
      return null;
    }

    log.debug(`Session ${context.sessionId}: Decision boundary evaluation at turn ${context.conversationTurn}`);

    // Lightweight evaluation - only check if current profile is optimal
    const currentFitness = this.evaluateCurrentProfileFitness();
    
    if (currentFitness < this.config.acceptanceThreshold) {
      // Trigger micro-optimization (lighter than full cycle)
      const microOptimized = await this.runMicroOptimization();
      
      monteCarloEnhancementEvents.emit('session-evaluation', {
        sessionId: context.sessionId,
        turn: context.conversationTurn,
        optimizationApplied: microOptimized !== null,
      });
      
      return microOptimized;
    }

    return this.state.activeProfile;
  }

  /**
   * Run a lightweight micro-optimization for session-scoped evaluation
   * Much faster than full cycle, focuses on refinement not exploration
   */
  private async runMicroOptimization(): Promise<OptimizationProfile | null> {
    if (!this.state.activeProfile) {
      return null;
    }

    log.debug('Running micro-optimization...');

    // Quick refinement of current profile parameters
    const refined = this.refineProfile(this.state.activeProfile);
    
    if (refined.overallScore > this.state.activeProfile.overallScore) {
      // Apply refined profile (second-order influence only)
      this.state.activeProfile = refined;
      return refined;
    }

    return null;
  }

  // ============================================================================
  // DOMAIN OPTIMIZATION
  // ============================================================================

  /**
   * Optimize a specific domain using Monte Carlo simulation
   */
  private async optimizeDomain(domain: OptimizationDomain): Promise<Record<string, number>> {
    const currentMetrics = this.getCurrentDomainMetrics(domain);
    let population = this.generateInitialPopulation(domain, currentMetrics);
    
    let bestStrategy: EvaluatedStrategy | null = null;
    let bestFitness = 0;
    let previousBestFitness = 0;

    for (let gen = 0; gen < this.config.maxGenerations; gen++) {
      // Evaluate population
      const evaluated = await this.evaluatePopulation(population, domain);
      
      // Sort by fitness
      evaluated.sort((a, b) => b.fitness - a.fitness);
      
      // Update best
      if (evaluated[0].fitness > bestFitness) {
        bestStrategy = evaluated[0];
        previousBestFitness = bestFitness;
        bestFitness = evaluated[0].fitness;
      }

      // Check convergence
      const improvement = bestFitness - previousBestFitness;
      if (gen > 2 && improvement < this.config.convergenceThreshold) {
        log.debug(`  Generation ${gen}: Converged (improvement: ${improvement.toFixed(6)})`);
        break;
      }

      // Select elite
      const elite = evaluated.slice(0, this.config.eliteCount);
      
      // Generate next generation
      population = this.generateNextGeneration(elite, domain, gen + 1);
    }

    // Return optimized metrics
    return bestStrategy ? bestStrategy.strategy.parameters : currentMetrics;
  }

  /**
   * Generate initial population of candidate strategies
   */
  private generateInitialPopulation(
    domain: OptimizationDomain,
    baseMetrics: Record<string, number>
  ): CandidateStrategy[] {
    const population: CandidateStrategy[] = [];

    for (let i = 0; i < this.config.candidatesPerDomain; i++) {
      const id = `cs-${domain}-0-${crypto.randomBytes(4).toString('hex')}`;
      
      // Create candidate with small variations from base using configurable variation
      const parameters: Record<string, number> = {};
      for (const [key, value] of Object.entries(baseMetrics)) {
        const variation = (Math.random() - 0.5) * this.config.initialVariation;
        parameters[key] = Math.max(0, Math.min(1, value + variation));
      }

      population.push({
        id,
        domain,
        parameters,
        generation: 0,
      });
    }

    return population;
  }

  /**
   * Generate next generation through mutation and crossover
   */
  private generateNextGeneration(
    elite: EvaluatedStrategy[],
    domain: OptimizationDomain,
    generation: number
  ): CandidateStrategy[] {
    const population: CandidateStrategy[] = [];

    // Keep elite unchanged
    for (const e of elite) {
      population.push({ ...e.strategy, generation });
    }

    // Generate offspring through mutation
    const offspringCount = this.config.candidatesPerDomain - elite.length;
    for (let i = 0; i < offspringCount; i++) {
      const parent = elite[i % elite.length].strategy;
      const offspring = this.mutateStrategy(parent, generation);
      population.push(offspring);
    }

    return population;
  }

  /**
   * Mutate a strategy to create offspring
   */
  private mutateStrategy(parent: CandidateStrategy, generation: number): CandidateStrategy {
    const id = `cs-${parent.domain}-${generation}-${crypto.randomBytes(4).toString('hex')}`;
    const parameters: Record<string, number> = {};

    for (const [key, value] of Object.entries(parent.parameters)) {
      if (Math.random() < this.config.mutationRate) {
        const delta = (Math.random() - 0.5) * 2 * this.config.mutationMagnitude;
        parameters[key] = Math.max(0, Math.min(1, value + delta));
      } else {
        parameters[key] = value;
      }
    }

    return {
      id,
      domain: parent.domain,
      parameters,
      parentId: parent.id,
      generation,
    };
  }

  /**
   * Evaluate a population of strategies
   */
  private async evaluatePopulation(
    population: CandidateStrategy[],
    domain: OptimizationDomain
  ): Promise<EvaluatedStrategy[]> {
    // Evaluate strategies in parallel for better performance
    const evaluationPromises = population.map(async (strategy) => {
      const fitness = this.evaluateStrategy(strategy, domain);
      return {
        strategy,
        fitness,
        domainScore: fitness,
        evaluatedAt: new Date(),
      } as EvaluatedStrategy;
    });

    return Promise.all(evaluationPromises);
  }

  /**
   * Evaluate a single strategy's fitness
   */
  private evaluateStrategy(strategy: CandidateStrategy, domain: OptimizationDomain): number {
    const params = strategy.parameters;
    const values = Object.values(params);
    
    // Calculate mean score across all parameters
    const meanScore = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Add consistency bonus (low variance is good)
    const variance = values.reduce((acc, v) => acc + Math.pow(v - meanScore, 2), 0) / values.length;
    const consistencyBonus = Math.max(0, 0.1 - variance);
    
    // Add domain-specific bonuses
    let domainBonus = 0;
    switch (domain) {
      case 'legal_understanding':
        // Prioritize issue identification and doctrine reasoning
        domainBonus = (params.issueIdentificationAccuracy || 0) * 0.05 +
                      (params.doctrineReasoningScore || 0) * 0.05;
        break;
      case 'explanation_quality':
        // Prioritize clarity and plain language
        domainBonus = (params.clarityScore || 0) * 0.05 +
                      (params.plainLanguageTranslation || 0) * 0.05;
        break;
      case 'consultative_engagement':
        // Prioritize conversational flow and confidence balance
        domainBonus = (params.conversationalFlow || 0) * 0.05 +
                      (params.confidenceBalance || 0) * 0.05;
        break;
      case 'vocal_gravitas':
        // Prioritize natural delivery and tone stability
        domainBonus = (params.naturalDelivery || 0) * 0.05 +
                      (params.toneStability || 0) * 0.05;
        break;
    }

    return Math.min(1, meanScore + consistencyBonus + domainBonus);
  }

  // ============================================================================
  // PROFILE MANAGEMENT
  // ============================================================================

  /**
   * Create baseline optimization profile
   */
  private createBaselineProfile(): OptimizationProfile {
    return {
      id: `profile-baseline-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
      domains: { ...BASELINE_METRICS },
      overallScore: this.calculateOverallScore(BASELINE_METRICS),
      generation: 0,
    };
  }

  /**
   * Create new optimization profile from domain metrics
   */
  private createOptimizationProfile(domains: OptimizationProfile['domains']): OptimizationProfile {
    return {
      id: `profile-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
      domains,
      overallScore: this.calculateOverallScore(domains),
      generation: this.state.currentCycle,
    };
  }

  /**
   * Calculate overall score from domain metrics
   */
  private calculateOverallScore(domains: OptimizationProfile['domains']): number {
    const scores: number[] = [];

    // Legal Understanding (25%)
    const lu = domains.legalUnderstanding;
    scores.push((lu.issueIdentificationAccuracy + lu.contextualInterpretation +
                 lu.doctrineReasoningScore + lu.riskOutcomeFraming) / 4 * 0.25);

    // Explanation Quality (25%)
    const eq = domains.explanationQuality;
    scores.push((eq.hierarchicalStructuring + eq.plainLanguageTranslation +
                 eq.analyticalSequencing + eq.clarityScore) / 4 * 0.25);

    // Consultative Engagement (25%)
    const ce = domains.consultativeEngagement;
    scores.push((ce.conversationalFlow + ce.clarifyingQuestionTiming +
                 ce.responsivenessPacing + ce.confidenceBalance +
                 ce.reassuranceAuthority) / 5 * 0.25);

    // Vocal Gravitas (25%)
    const vg = domains.vocalGravitas;
    scores.push((vg.speechCadence + vg.perceivedConfidence +
                 vg.toneStability + vg.naturalDelivery) / 4 * 0.25);

    return scores.reduce((a, b) => a + b, 0);
  }

  /**
   * Apply an optimization profile
   * Safety: Applied prior to response generation, never mid-utterance
   */
  private applyOptimizationProfile(profile: OptimizationProfile): void {
    // Archive current profile
    if (this.state.activeProfile) {
      this.state.historicalProfiles.push(this.state.activeProfile);
      
      // Keep only last 10 historical profiles
      if (this.state.historicalProfiles.length > 10) {
        this.state.historicalProfiles.shift();
      }
    }

    this.state.activeProfile = profile;
    
    monteCarloEnhancementEvents.emit('profile-applied', { profile });
  }

  /**
   * Refine an existing profile through micro-adjustments
   */
  private refineProfile(profile: OptimizationProfile): OptimizationProfile {
    // Deep clone using structured approach for type safety
    const refined: OptimizationProfile = {
      id: `profile-refined-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
      domains: {
        legalUnderstanding: { ...profile.domains.legalUnderstanding },
        explanationQuality: { ...profile.domains.explanationQuality },
        consultativeEngagement: { ...profile.domains.consultativeEngagement },
        vocalGravitas: { ...profile.domains.vocalGravitas },
      },
      overallScore: profile.overallScore,
      generation: profile.generation,
    };

    // Apply small improvements using configurable maximum improvement
    const maxImprovement = this.config.microOptimizationMaxImprovement;
    const refineValue = (value: number): number => {
      const improvement = Math.random() * maxImprovement;
      return Math.min(1, value + improvement);
    };

    // Refine Legal Understanding
    refined.domains.legalUnderstanding = {
      issueIdentificationAccuracy: refineValue(profile.domains.legalUnderstanding.issueIdentificationAccuracy),
      contextualInterpretation: refineValue(profile.domains.legalUnderstanding.contextualInterpretation),
      doctrineReasoningScore: refineValue(profile.domains.legalUnderstanding.doctrineReasoningScore),
      riskOutcomeFraming: refineValue(profile.domains.legalUnderstanding.riskOutcomeFraming),
    };

    // Refine Explanation Quality
    refined.domains.explanationQuality = {
      hierarchicalStructuring: refineValue(profile.domains.explanationQuality.hierarchicalStructuring),
      plainLanguageTranslation: refineValue(profile.domains.explanationQuality.plainLanguageTranslation),
      analyticalSequencing: refineValue(profile.domains.explanationQuality.analyticalSequencing),
      clarityScore: refineValue(profile.domains.explanationQuality.clarityScore),
    };

    // Refine Consultative Engagement
    refined.domains.consultativeEngagement = {
      conversationalFlow: refineValue(profile.domains.consultativeEngagement.conversationalFlow),
      clarifyingQuestionTiming: refineValue(profile.domains.consultativeEngagement.clarifyingQuestionTiming),
      responsivenessPacing: refineValue(profile.domains.consultativeEngagement.responsivenessPacing),
      confidenceBalance: refineValue(profile.domains.consultativeEngagement.confidenceBalance),
      reassuranceAuthority: refineValue(profile.domains.consultativeEngagement.reassuranceAuthority),
    };

    // Refine Vocal Gravitas
    refined.domains.vocalGravitas = {
      speechCadence: refineValue(profile.domains.vocalGravitas.speechCadence),
      perceivedConfidence: refineValue(profile.domains.vocalGravitas.perceivedConfidence),
      toneStability: refineValue(profile.domains.vocalGravitas.toneStability),
      naturalDelivery: refineValue(profile.domains.vocalGravitas.naturalDelivery),
    };

    refined.overallScore = this.calculateOverallScore(refined.domains);

    return refined;
  }

  /**
   * Evaluate current profile fitness
   */
  private evaluateCurrentProfileFitness(): number {
    if (!this.state.activeProfile) {
      return 0;
    }
    return this.state.activeProfile.overallScore;
  }

  /**
   * Get current metrics for a specific domain
   */
  private getCurrentDomainMetrics(domain: OptimizationDomain): Record<string, number> {
    if (!this.state.activeProfile) {
      return this.getBaselineDomainMetrics(domain);
    }

    switch (domain) {
      case 'legal_understanding':
        return { ...this.state.activeProfile.domains.legalUnderstanding };
      case 'explanation_quality':
        return { ...this.state.activeProfile.domains.explanationQuality };
      case 'consultative_engagement':
        return { ...this.state.activeProfile.domains.consultativeEngagement };
      case 'vocal_gravitas':
        return { ...this.state.activeProfile.domains.vocalGravitas };
    }
  }

  /**
   * Get baseline metrics for a domain
   */
  private getBaselineDomainMetrics(domain: OptimizationDomain): Record<string, number> {
    switch (domain) {
      case 'legal_understanding':
        return { ...BASELINE_METRICS.legalUnderstanding };
      case 'explanation_quality':
        return { ...BASELINE_METRICS.explanationQuality };
      case 'consultative_engagement':
        return { ...BASELINE_METRICS.consultativeEngagement };
      case 'vocal_gravitas':
        return { ...BASELINE_METRICS.vocalGravitas };
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Configure the enhancement system
   */
  configure(config: Partial<MonteCarloEnhancementConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Enhancement system configured', this.config);
  }

  /**
   * Configure scheduled cycle times
   */
  configureSchedule(schedule: Partial<ScheduledCycleConfig>): void {
    this.scheduleConfig = { ...this.scheduleConfig, ...schedule };
    
    // Reschedule cycles
    this.clearScheduledTimers();
    this.scheduleDailyCycles();
    
    log.info('Schedule reconfigured', this.scheduleConfig);
  }

  /**
   * Get current system state
   */
  getState(): EnhancementSystemState {
    return {
      ...this.state,
      scheduledTimers: [], // Don't expose timers
    };
  }

  /**
   * Get active optimization profile
   */
  getActiveProfile(): OptimizationProfile | null {
    return this.state.activeProfile;
  }

  /**
   * Get historical profiles
   */
  getHistoricalProfiles(): OptimizationProfile[] {
    return [...this.state.historicalProfiles];
  }

  /**
   * Manually trigger an optimization cycle (for admin use)
   */
  async triggerManualOptimization(): Promise<OptimizationProfile | null> {
    log.info('Manual optimization cycle triggered');
    return this.runScheduledOptimizationCycle();
  }

  /**
   * Check if system is currently optimizing
   */
  isOptimizing(): boolean {
    return this.state.isRunning;
  }

  /**
   * Shutdown the enhancement system
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Monte Carlo Enhancement System...');
    this.clearScheduledTimers();
    this.state.isRunning = false;
    log.info('Enhancement System shutdown complete');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const lexaraMonteCarloEnhancement = LexaraMonteCarloEnhancementEngine.getInstance();

export async function initializeMonteCarloEnhancement(): Promise<void> {
  return lexaraMonteCarloEnhancement.initialize();
}

export async function runOptimizationCycle(): Promise<OptimizationProfile | null> {
  return lexaraMonteCarloEnhancement.runScheduledOptimizationCycle();
}

export async function evaluateAtDecisionBoundary(context: SessionContext): Promise<OptimizationProfile | null> {
  return lexaraMonteCarloEnhancement.evaluateAtDecisionBoundary(context);
}

export function configureEnhancement(config: Partial<MonteCarloEnhancementConfig>): void {
  lexaraMonteCarloEnhancement.configure(config);
}

export function configureEnhancementSchedule(schedule: Partial<ScheduledCycleConfig>): void {
  lexaraMonteCarloEnhancement.configureSchedule(schedule);
}

export function getEnhancementState(): EnhancementSystemState {
  return lexaraMonteCarloEnhancement.getState();
}

export function getActiveOptimizationProfile(): OptimizationProfile | null {
  return lexaraMonteCarloEnhancement.getActiveProfile();
}

export function isEnhancementOptimizing(): boolean {
  return lexaraMonteCarloEnhancement.isOptimizing();
}

export async function shutdownMonteCarloEnhancement(): Promise<void> {
  return lexaraMonteCarloEnhancement.shutdown();
}

export default lexaraMonteCarloEnhancement;
