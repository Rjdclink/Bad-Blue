/**
 * EVOLUTIONARY CYCLE ENGINE
 * 
 * Bounded evolutionary cycles for crawler optimization.
 * 
 * CORE CONSTRAINTS:
 * - Maximum 4 active crawler candidates at any time
 * - Training exposure proportional to Monte Carlo posterior confidence
 * - Exploration probability retained for lower-ranked candidates
 * - Architecture frozen after convergence; only parameters evolve
 * 
 * THE LOOP:
 * 1. Pick 4 (select from pool)
 * 2. Stress them under randomness (stochastic simulation)
 * 3. Score them (discovery, extraction, speed, reliability)
 * 4. Keep the best (retain top performers)
 * 5. Introduce new blood (up to 2 new variants after convergence)
 * 6. Repeat
 * 
 * This is controlled evolution, not chaos.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../../logger';
import {
  CrawlerId,
  CrawlerCandidate,
  MONTE_CARLO_CRAWLERS,
} from './MonteCarloConfig';

const log = createLogger('EvolutionaryCycleEngine');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum active crawler candidates - NEVER EXCEED */
const MAX_ACTIVE_CRAWLERS = 4;

/** Maximum new variants to introduce per cycle */
const MAX_NEW_VARIANTS_PER_CYCLE = 2;

/** Minimum exploration probability for lowest-ranked crawler */
const MIN_EXPLORATION_PROBABILITY = 0.05;

/** Cycles required for convergence before introducing new variants */
const CONVERGENCE_CYCLES_REQUIRED = 3;

// ============================================================================
// TYPES
// ============================================================================

export interface CrawlerVariant {
  id: string;
  baseCrawlerId: CrawlerId;
  name: string;
  generation: number;
  parameters: VariantParameters;
  performance: PerformanceMetrics;
  posteriorConfidence: number;
  trainingExposure: number;
  explorationProbability: number;
  status: 'active' | 'archived' | 'frozen';
  createdAt: Date;
  archivedAt?: Date;
  frozenAt?: Date;
}

export interface VariantParameters {
  // These CAN evolve after convergence
  aggressiveness: number;      // 0-1
  concurrencyMultiplier: number; // 0.5-2.0
  depthPreference: number;     // 1-10
  retryStrategy: 'none' | 'linear' | 'exponential';
  delayRange: [number, number]; // [min, max] ms
  extractionMode: 'shallow' | 'deep' | 'adaptive';
  linkFollowBias: number;      // 0-1
}

export interface PerformanceMetrics {
  discoveryYield: number;
  extractionQuality: number;
  timeToSignal: number;
  failureRate: number;
  totalScore: number;
  runCount: number;
  averageScore: number;
}

export interface EvolutionaryCycle {
  cycleId: string;
  cycleNumber: number;
  startedAt: Date;
  completedAt?: Date;
  activeCrawlers: CrawlerVariant[];
  archivedCrawlers: CrawlerVariant[];
  newVariantsIntroduced: number;
  convergenceAchieved: boolean;
  topPerformers: string[];
  architectureFrozen: boolean;
}

export interface EvolutionaryState {
  currentCycle: number;
  totalCycles: number;
  status: 'idle' | 'running' | 'converged' | 'frozen';
  activeCrawlers: CrawlerVariant[];
  archivedCrawlers: CrawlerVariant[];
  variantPool: CrawlerVariant[];
  cycles: EvolutionaryCycle[];
  convergenceStreak: number;
  architectureFrozen: boolean;
  lastTopPerformers: string[];
}

// ============================================================================
// EVOLUTIONARY CYCLE ENGINE
// ============================================================================

export class EvolutionaryCycleEngine extends EventEmitter {
  private state: EvolutionaryState;
  private rng: () => number;

  constructor() {
    super();
    this.rng = Math.random;
    this.state = this.initializeState();

    log.info('EvolutionaryCycleEngine initialized', {
      maxActiveCrawlers: MAX_ACTIVE_CRAWLERS,
      convergenceCyclesRequired: CONVERGENCE_CYCLES_REQUIRED,
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initializeState(): EvolutionaryState {
    // Create initial variants from base crawlers
    const initialVariants = MONTE_CARLO_CRAWLERS.map(crawler => 
      this.createVariantFromBase(crawler, 0)
    );

    // Select initial 4 (take highest initial weights)
    const sorted = [...initialVariants].sort((a, b) => 
      b.posteriorConfidence - a.posteriorConfidence
    );
    const activeCrawlers = sorted.slice(0, MAX_ACTIVE_CRAWLERS);
    const variantPool = sorted.slice(MAX_ACTIVE_CRAWLERS);

    return {
      currentCycle: 0,
      totalCycles: 0,
      status: 'idle',
      activeCrawlers,
      archivedCrawlers: [],
      variantPool,
      cycles: [],
      convergenceStreak: 0,
      architectureFrozen: false,
      lastTopPerformers: [],
    };
  }

  private createVariantFromBase(
    crawler: CrawlerCandidate,
    generation: number,
    parentParams?: VariantParameters
  ): CrawlerVariant {
    const baseParams: VariantParameters = parentParams || {
      aggressiveness: 0.5 + this.rng() * 0.3,
      concurrencyMultiplier: 0.8 + this.rng() * 0.4,
      depthPreference: Math.floor(3 + this.rng() * 4),
      retryStrategy: this.randomChoice(['none', 'linear', 'exponential']),
      delayRange: [100 + Math.floor(this.rng() * 200), 500 + Math.floor(this.rng() * 1000)],
      extractionMode: this.randomChoice(['shallow', 'deep', 'adaptive']),
      linkFollowBias: 0.3 + this.rng() * 0.5,
    };

    return {
      id: `${crawler.id}-gen${generation}-${randomUUID().slice(0, 8)}`,
      baseCrawlerId: crawler.id,
      name: `${crawler.name} v${generation}.${Math.floor(this.rng() * 100)}`,
      generation,
      parameters: baseParams,
      performance: {
        discoveryYield: 0,
        extractionQuality: 0,
        timeToSignal: 0,
        failureRate: 0,
        totalScore: 0,
        runCount: 0,
        averageScore: 0,
      },
      posteriorConfidence: crawler.initialWeight,
      trainingExposure: 0,
      explorationProbability: MIN_EXPLORATION_PROBABILITY,
      status: 'active',
      createdAt: new Date(),
    };
  }

  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // ============================================================================
  // CORE EVOLUTIONARY LOOP
  // ============================================================================

  /**
   * Run a single evolutionary cycle
   * 
   * Each cycle:
   * 1. Select no more than 4 crawler candidates
   * 2. Run stochastic simulations
   * 3. Score candidates
   * 4. Retain top performers
   * 5. Discard/archive underperformers
   * 6. After convergence, introduce up to 2 new variants
   */
  async runCycle(): Promise<EvolutionaryCycle> {
    const cycleId = randomUUID();
    const cycleNumber = ++this.state.currentCycle;

    log.info('Starting evolutionary cycle', { cycleNumber, cycleId });

    this.state.status = 'running';

    const cycle: EvolutionaryCycle = {
      cycleId,
      cycleNumber,
      startedAt: new Date(),
      activeCrawlers: [...this.state.activeCrawlers],
      archivedCrawlers: [],
      newVariantsIntroduced: 0,
      convergenceAchieved: false,
      topPerformers: [],
      architectureFrozen: this.state.architectureFrozen,
    };

    try {
      // STEP 1: Ensure we have exactly MAX_ACTIVE_CRAWLERS
      this.enforceActiveCrawlerLimit();

      // STEP 2: Calculate training exposure based on posterior confidence
      this.calculateTrainingExposure();

      // STEP 3: Run stochastic simulations
      await this.runStochasticSimulations();

      // STEP 4: Score and rank crawlers
      const rankings = this.scoreAndRankCrawlers();

      // STEP 5: Check convergence
      const converged = this.checkConvergence(rankings);
      cycle.convergenceAchieved = converged;

      // STEP 6: Retain top performers, archive underperformers
      const { archived, retained } = this.selectSurvivors(rankings);
      cycle.archivedCrawlers = archived;
      cycle.topPerformers = retained.map(c => c.id);

      // STEP 7: If converged, potentially introduce new variants
      if (converged && !this.state.architectureFrozen) {
        const newVariants = this.introduceNewVariants(retained);
        cycle.newVariantsIntroduced = newVariants.length;

        // Check if we should freeze architecture
        if (this.state.convergenceStreak >= CONVERGENCE_CYCLES_REQUIRED * 2) {
          this.freezeArchitecture();
          cycle.architectureFrozen = true;
        }
      }

      // STEP 8: Update state
      cycle.completedAt = new Date();
      this.state.cycles.push(cycle);
      this.state.totalCycles++;

      if (this.state.architectureFrozen) {
        this.state.status = 'frozen';
      } else if (converged) {
        this.state.status = 'converged';
      }

      log.info('Evolutionary cycle complete', {
        cycleNumber,
        converged,
        archived: archived.length,
        newVariants: cycle.newVariantsIntroduced,
        architectureFrozen: cycle.architectureFrozen,
      });

      this.emit('cycle-complete', cycle);
      return cycle;

    } catch (error) {
      log.error('Evolutionary cycle failed', { cycleNumber, error });
      throw error;
    }
  }

  // ============================================================================
  // TRAINING EXPOSURE CALCULATION
  // ============================================================================

  /**
   * Training exposure must be proportional to Monte Carlo posterior confidence,
   * with exploration probability retained for lower-ranked candidates.
   */
  private calculateTrainingExposure(): void {
    const totalConfidence = this.state.activeCrawlers.reduce(
      (sum, c) => sum + c.posteriorConfidence, 0
    );

    // Sort by posterior confidence
    const sorted = [...this.state.activeCrawlers].sort(
      (a, b) => b.posteriorConfidence - a.posteriorConfidence
    );

    for (let i = 0; i < sorted.length; i++) {
      const crawler = sorted[i];
      const rank = i + 1;

      // Base exposure from posterior confidence
      const baseExposure = crawler.posteriorConfidence / totalConfidence;

      // Exploration bonus for lower-ranked (prevents premature convergence)
      // Higher rank = lower exploration bonus
      const explorationBonus = MIN_EXPLORATION_PROBABILITY * (sorted.length - rank + 1) / sorted.length;

      // Final training exposure
      crawler.trainingExposure = baseExposure * (1 - MIN_EXPLORATION_PROBABILITY * sorted.length) + explorationBonus;

      // Set exploration probability (inverse of confidence)
      crawler.explorationProbability = Math.max(
        MIN_EXPLORATION_PROBABILITY,
        (1 - crawler.posteriorConfidence) * 0.2
      );

      log.debug('Training exposure calculated', {
        crawlerId: crawler.id,
        rank,
        posteriorConfidence: crawler.posteriorConfidence,
        trainingExposure: crawler.trainingExposure,
        explorationProbability: crawler.explorationProbability,
      });
    }
  }

  // ============================================================================
  // STOCHASTIC SIMULATION
  // ============================================================================

  private async runStochasticSimulations(): Promise<void> {
    const runsPerCrawler = 50; // Base runs

    for (const crawler of this.state.activeCrawlers) {
      // Runs proportional to training exposure
      const runs = Math.ceil(runsPerCrawler * crawler.trainingExposure * MAX_ACTIVE_CRAWLERS);

      for (let i = 0; i < runs; i++) {
        // Simulate with parameter variance
        const result = this.simulateCrawlerRun(crawler);

        // Update performance metrics
        crawler.performance.discoveryYield += result.discoveryYield;
        crawler.performance.extractionQuality += result.extractionQuality;
        crawler.performance.timeToSignal += result.timeToSignal;
        crawler.performance.failureRate += result.failureRate;
        crawler.performance.runCount++;
      }

      // Calculate averages
      if (crawler.performance.runCount > 0) {
        crawler.performance.discoveryYield /= crawler.performance.runCount;
        crawler.performance.extractionQuality /= crawler.performance.runCount;
        crawler.performance.timeToSignal /= crawler.performance.runCount;
        crawler.performance.failureRate /= crawler.performance.runCount;

        // Calculate total score
        crawler.performance.totalScore = this.calculateTotalScore(crawler.performance);
        crawler.performance.averageScore = crawler.performance.totalScore;
      }
    }
  }

  private simulateCrawlerRun(crawler: CrawlerVariant): {
    discoveryYield: number;
    extractionQuality: number;
    timeToSignal: number;
    failureRate: number;
  } {
    // Base performance varies by crawler type
    const basePerformance = this.getBasePerformance(crawler.baseCrawlerId);

    // Apply parameter modifiers
    const params = crawler.parameters;
    const discoveryModifier = 1 + (params.depthPreference / 10) * 0.3;
    const extractionModifier = params.extractionMode === 'deep' ? 1.2 : params.extractionMode === 'adaptive' ? 1.1 : 1.0;
    const speedModifier = 1 / (params.delayRange[1] / 500);
    const reliabilityModifier = params.retryStrategy === 'exponential' ? 0.9 : params.retryStrategy === 'linear' ? 0.95 : 1.0;

    // Add stochastic variance
    const variance = () => 0.8 + this.rng() * 0.4;

    return {
      discoveryYield: basePerformance.discovery * discoveryModifier * variance(),
      extractionQuality: basePerformance.extraction * extractionModifier * variance(),
      timeToSignal: basePerformance.speed * speedModifier * variance(),
      failureRate: basePerformance.failure * reliabilityModifier * variance(),
    };
  }

  private getBasePerformance(crawlerId: CrawlerId): {
    discovery: number;
    extraction: number;
    speed: number;
    failure: number;
  } {
    const profiles: Record<CrawlerId, any> = {
      STARTREK: { discovery: 0.85, extraction: 0.70, speed: 0.80, failure: 0.10 },
      BLIZZARD: { discovery: 0.75, extraction: 0.85, speed: 0.65, failure: 0.12 },
      BIRDOFPREY: { discovery: 0.70, extraction: 0.80, speed: 0.75, failure: 0.15 },
      HYDRA: { discovery: 0.80, extraction: 0.75, speed: 0.70, failure: 0.08 },
    };
    return profiles[crawlerId];
  }

  private calculateTotalScore(metrics: PerformanceMetrics): number {
    // Weighted scoring (same as MonteCarloConfig)
    return (
      metrics.discoveryYield * 0.30 +
      metrics.extractionQuality * 0.35 +
      metrics.timeToSignal * 0.20 +
      (1 - metrics.failureRate) * 0.15
    );
  }

  // ============================================================================
  // SCORING AND RANKING
  // ============================================================================

  private scoreAndRankCrawlers(): CrawlerVariant[] {
    // Sort by total score descending
    const ranked = [...this.state.activeCrawlers].sort(
      (a, b) => b.performance.averageScore - a.performance.averageScore
    );

    // Update posterior confidence based on performance
    const totalScore = ranked.reduce((sum, c) => sum + c.performance.averageScore, 0);
    for (const crawler of ranked) {
      if (totalScore > 0) {
        // Blend current confidence with performance-based confidence
        const performanceConfidence = crawler.performance.averageScore / totalScore;
        crawler.posteriorConfidence = 
          crawler.posteriorConfidence * 0.3 + performanceConfidence * 0.7;
      }
    }

    return ranked;
  }

  // ============================================================================
  // CONVERGENCE DETECTION
  // ============================================================================

  private checkConvergence(rankings: CrawlerVariant[]): boolean {
    const topPerformers = rankings.slice(0, 2).map(c => c.id);

    // Check if top 2 are same as last cycle
    const sameTop = this.state.lastTopPerformers.length === 2 &&
      topPerformers[0] === this.state.lastTopPerformers[0] &&
      topPerformers[1] === this.state.lastTopPerformers[1];

    if (sameTop) {
      this.state.convergenceStreak++;
    } else {
      this.state.convergenceStreak = 0;
    }

    this.state.lastTopPerformers = topPerformers;

    const converged = this.state.convergenceStreak >= CONVERGENCE_CYCLES_REQUIRED;

    log.info('Convergence check', {
      topPerformers,
      streak: this.state.convergenceStreak,
      required: CONVERGENCE_CYCLES_REQUIRED,
      converged,
    });

    return converged;
  }

  // ============================================================================
  // SURVIVOR SELECTION
  // ============================================================================

  private selectSurvivors(rankings: CrawlerVariant[]): {
    archived: CrawlerVariant[];
    retained: CrawlerVariant[];
  } {
    // Always keep top performers
    const retained = rankings.slice(0, Math.min(MAX_ACTIVE_CRAWLERS - 1, rankings.length));
    const candidates = rankings.slice(Math.min(MAX_ACTIVE_CRAWLERS - 1, rankings.length));

    const archived: CrawlerVariant[] = [];

    // Archive clear underperformers
    for (const crawler of candidates) {
      if (crawler.performance.averageScore < 0.3) {
        crawler.status = 'archived';
        crawler.archivedAt = new Date();
        archived.push(crawler);
        this.state.archivedCrawlers.push(crawler);
      } else if (retained.length < MAX_ACTIVE_CRAWLERS) {
        retained.push(crawler);
      }
    }

    this.state.activeCrawlers = retained;

    return { archived, retained };
  }

  // ============================================================================
  // NEW VARIANT INTRODUCTION
  // ============================================================================

  /**
   * After convergence, introduce up to 2 new crawler variants
   */
  private introduceNewVariants(retained: CrawlerVariant[]): CrawlerVariant[] {
    const newVariants: CrawlerVariant[] = [];
    const slotsAvailable = MAX_ACTIVE_CRAWLERS - retained.length;
    const variantsToCreate = Math.min(MAX_NEW_VARIANTS_PER_CYCLE, slotsAvailable);

    for (let i = 0; i < variantsToCreate; i++) {
      // Select base from pool or mutate from top performer
      let newVariant: CrawlerVariant;

      if (this.state.variantPool.length > 0 && this.rng() < 0.5) {
        // Pull from pool
        const poolVariant = this.state.variantPool.shift()!;
        poolVariant.status = 'active';
        newVariant = poolVariant;
      } else {
        // Mutate from top performer
        const topPerformer = retained[0];
        const baseCrawler = MONTE_CARLO_CRAWLERS.find(c => c.id === topPerformer.baseCrawlerId)!;
        newVariant = this.createMutatedVariant(baseCrawler, topPerformer);
      }

      newVariants.push(newVariant);
      this.state.activeCrawlers.push(newVariant);
    }

    log.info('New variants introduced', {
      count: newVariants.length,
      ids: newVariants.map(v => v.id),
    });

    return newVariants;
  }

  private createMutatedVariant(
    baseCrawler: CrawlerCandidate,
    parent: CrawlerVariant
  ): CrawlerVariant {
    const mutatedParams: VariantParameters = {
      aggressiveness: this.mutateValue(parent.parameters.aggressiveness, 0, 1),
      concurrencyMultiplier: this.mutateValue(parent.parameters.concurrencyMultiplier, 0.5, 2.0),
      depthPreference: Math.round(this.mutateValue(parent.parameters.depthPreference, 1, 10)),
      retryStrategy: this.rng() < 0.1 
        ? this.randomChoice(['none', 'linear', 'exponential']) 
        : parent.parameters.retryStrategy,
      delayRange: [
        Math.round(this.mutateValue(parent.parameters.delayRange[0], 50, 500)),
        Math.round(this.mutateValue(parent.parameters.delayRange[1], 200, 2000)),
      ],
      extractionMode: this.rng() < 0.1
        ? this.randomChoice(['shallow', 'deep', 'adaptive'])
        : parent.parameters.extractionMode,
      linkFollowBias: this.mutateValue(parent.parameters.linkFollowBias, 0, 1),
    };

    return this.createVariantFromBase(baseCrawler, parent.generation + 1, mutatedParams);
  }

  private mutateValue(value: number, min: number, max: number): number {
    const mutation = (this.rng() - 0.5) * 0.2 * (max - min);
    return Math.max(min, Math.min(max, value + mutation));
  }

  // ============================================================================
  // ARCHITECTURE FREEZE
  // ============================================================================

  /**
   * Freeze crawler architecture after convergence;
   * only parameterization may evolve between cycles.
   */
  private freezeArchitecture(): void {
    this.state.architectureFrozen = true;

    for (const crawler of this.state.activeCrawlers) {
      crawler.status = 'frozen';
      crawler.frozenAt = new Date();
    }

    log.warn('ARCHITECTURE FROZEN - Only parameters may evolve from this point');
    this.emit('architecture-frozen', {
      activeCrawlers: this.state.activeCrawlers.map(c => ({
        id: c.id,
        name: c.name,
        posteriorConfidence: c.posteriorConfidence,
      })),
    });
  }

  // ============================================================================
  // ENFORCEMENT
  // ============================================================================

  /**
   * The system must never train or operate more than 4 active crawler candidates
   */
  private enforceActiveCrawlerLimit(): void {
    if (this.state.activeCrawlers.length > MAX_ACTIVE_CRAWLERS) {
      log.warn('Active crawler limit exceeded - enforcing limit', {
        current: this.state.activeCrawlers.length,
        max: MAX_ACTIVE_CRAWLERS,
      });

      // Sort by posterior confidence and keep top 4
      this.state.activeCrawlers.sort((a, b) => b.posteriorConfidence - a.posteriorConfidence);
      const excess = this.state.activeCrawlers.splice(MAX_ACTIVE_CRAWLERS);
      
      for (const crawler of excess) {
        crawler.status = 'archived';
        crawler.archivedAt = new Date();
        this.state.archivedCrawlers.push(crawler);
      }
    }

    // Fill slots if under limit
    while (this.state.activeCrawlers.length < MAX_ACTIVE_CRAWLERS && this.state.variantPool.length > 0) {
      const variant = this.state.variantPool.shift()!;
      variant.status = 'active';
      this.state.activeCrawlers.push(variant);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getState(): EvolutionaryState {
    return { ...this.state };
  }

  getActiveCrawlers(): CrawlerVariant[] {
    return [...this.state.activeCrawlers];
  }

  isArchitectureFrozen(): boolean {
    return this.state.architectureFrozen;
  }

  getCycleHistory(): EvolutionaryCycle[] {
    return [...this.state.cycles];
  }

  reset(): void {
    this.state = this.initializeState();
    log.info('EvolutionaryCycleEngine reset');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const evolutionaryCycleEngine = new EvolutionaryCycleEngine();
export default EvolutionaryCycleEngine;
