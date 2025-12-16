/**
 * MONTE CARLO CRAWLER OPTIMIZER
 * 
 * Adaptive intelligence layer that continuously samples, scores, and refines
 * crawler behavior under uncertainty using stochastic simulation.
 * 
 * Features:
 * - Stochastic simulation over randomized crawl parameters
 * - Iterative convergence toward higher-yield search patterns
 * - Adaptive rebalancing of crawler weights based on outcomes
 * - Feeds results back into future crawl selection
 * 
 * One-Sentence Directive:
 * "Run Monte Carlo optimization over 50 seeds using 4 specialized crawlers
 * with 10 iterations per seed, randomizing crawler selection and crawl
 * parameters per run, scoring outcomes, and halting when strategy rankings stabilize."
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  MonteCarloConfig,
  DEFAULT_MONTE_CARLO_CONFIG,
  CrawlerId,
  CrawlerCandidate,
  RandomizationParameter,
  MONTE_CARLO_CRAWLERS,
} from './MonteCarloConfig';
import { createLogger } from '../../logger';

const log = createLogger('MonteCarloCrawlerOptimizer');

// ============================================================================
// TYPES
// ============================================================================

export interface SeedURL {
  id: string;
  url: string;
  domain: string;
  siteType: string;
  addedAt: Date;
}

export interface CrawlParameters {
  crawlerId: CrawlerId;
  crawlDepth: number;
  renderMode: 'fetch' | 'render';
  delayMs: number;
  linkFollowProbability: number;
  extractionFocus: 'content' | 'links' | 'metadata' | 'all';
  concurrency: number;
  retryAttempts: number;
}

export interface RunOutcome {
  runId: string;
  seedId: string;
  seedUrl: string;
  iteration: number;
  parameters: CrawlParameters;
  results: {
    pagesDiscovered: number;
    usableContentExtracted: number;
    timeToFirstResultMs: number;
    totalTimeMs: number;
    failureCount: number;
    totalRequests: number;
  };
  score: number;
  timestamp: Date;
}

export interface StrategyRanking {
  crawlerId: CrawlerId;
  totalScore: number;
  runCount: number;
  averageScore: number;
  rank: number;
  weight: number;
}

export interface ConvergenceState {
  batchNumber: number;
  rankings: StrategyRanking[];
  previousRankings: StrategyRanking[][];
  isStable: boolean;
  stabileBatchCount: number;
}

export interface OptimizationState {
  status: 'idle' | 'running' | 'converged' | 'stopped';
  currentBatch: number;
  totalRuns: number;
  completedRuns: number;
  seeds: SeedURL[];
  outcomes: RunOutcome[];
  currentWeights: Map<CrawlerId, number>;
  convergence: ConvergenceState;
  startTime: Date | null;
  endTime: Date | null;
}

// ============================================================================
// MONTE CARLO CRAWLER OPTIMIZER
// ============================================================================

export class MonteCarloCrawlerOptimizer extends EventEmitter {
  private config: MonteCarloConfig;
  private state: OptimizationState;
  private rng: () => number;

  constructor(config: Partial<MonteCarloConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MONTE_CARLO_CONFIG, ...config };
    this.rng = Math.random;
    this.state = this.initializeState();

    log.info('MonteCarloCrawlerOptimizer initialized', {
      seedCount: this.config.seeds.count,
      iterationsPerSeed: this.config.iterations.perSeed,
      totalRuns: this.config.iterations.totalRuns,
      crawlers: this.config.crawlers.map(c => c.id),
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initializeState(): OptimizationState {
    const initialWeights = new Map<CrawlerId, number>();
    for (const crawler of this.config.crawlers) {
      initialWeights.set(crawler.id, crawler.initialWeight);
    }

    return {
      status: 'idle',
      currentBatch: 0,
      totalRuns: this.config.iterations.totalRuns,
      completedRuns: 0,
      seeds: [],
      outcomes: [],
      currentWeights: initialWeights,
      convergence: {
        batchNumber: 0,
        rankings: [],
        previousRankings: [],
        isStable: false,
        stabileBatchCount: 0,
      },
      startTime: null,
      endTime: null,
    };
  }

  // ============================================================================
  // SEED MANAGEMENT
  // ============================================================================

  /**
   * Add seed URLs for optimization
   * "Select 50 diverse seed URLs spanning different site structures"
   */
  addSeeds(urls: string[]): void {
    const domains = new Map<string, number>();

    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const domain = parsed.hostname;

        // Enforce diversity - max seeds per domain
        const domainCount = domains.get(domain) || 0;
        if (domainCount >= this.config.seeds.maxPerDomain) {
          log.debug('Skipping URL - domain limit reached', { url, domain });
          continue;
        }

        if (this.state.seeds.length >= this.config.seeds.count) {
          log.warn('Seed limit reached', { limit: this.config.seeds.count });
          break;
        }

        const seed: SeedURL = {
          id: randomUUID(),
          url,
          domain,
          siteType: this.classifySiteType(url),
          addedAt: new Date(),
        };

        this.state.seeds.push(seed);
        domains.set(domain, domainCount + 1);

        log.debug('Seed added', { url, domain, siteType: seed.siteType });
      } catch (err) {
        log.warn('Invalid URL skipped', { url });
      }
    }

    log.info('Seeds added', {
      total: this.state.seeds.length,
      target: this.config.seeds.count,
    });

    this.emit('seeds-updated', { count: this.state.seeds.length });
  }

  private classifySiteType(url: string): string {
    const u = url.toLowerCase();
    if (u.includes('gov')) return 'government';
    if (u.includes('edu')) return 'education';
    if (u.includes('news') || u.includes('blog')) return 'media';
    if (u.includes('shop') || u.includes('store')) return 'ecommerce';
    if (u.includes('api') || u.includes('json')) return 'api';
    return 'general';
  }

  // ============================================================================
  // PARAMETER RANDOMIZATION
  // ============================================================================

  /**
   * Generate randomized crawl parameters
   * "Each iteration must change at least 2 of these, or it doesn't count"
   */
  generateRandomParameters(baseParams?: Partial<CrawlParameters>): CrawlParameters {
    const params: CrawlParameters = {
      crawlerId: this.selectCrawlerByWeight(),
      crawlDepth: this.randomInt(1, 10),
      renderMode: this.rng() < 0.3 ? 'render' : 'fetch',
      delayMs: this.randomInt(100, 3000),
      linkFollowProbability: 0.3 + this.rng() * 0.6,
      extractionFocus: this.randomChoice(['content', 'links', 'metadata', 'all']),
      concurrency: this.randomInt(1, 10),
      retryAttempts: this.randomInt(0, 3),
    };

    // Ensure minimum parameter changes if base provided
    if (baseParams) {
      let changedCount = 0;
      const paramKeys: (keyof CrawlParameters)[] = [
        'crawlerId', 'crawlDepth', 'renderMode', 'delayMs',
        'linkFollowProbability', 'extractionFocus',
      ];

      for (const key of paramKeys) {
        if (params[key] !== baseParams[key]) {
          changedCount++;
        }
      }

      // Force additional changes if needed
      while (changedCount < this.config.randomization.minParamsToChange) {
        const key = this.randomChoice(paramKeys);
        if (key === 'crawlerId') {
          params.crawlerId = this.selectCrawlerByWeight();
        } else if (key === 'crawlDepth') {
          params.crawlDepth = this.randomInt(1, 10);
        } else if (key === 'renderMode') {
          params.renderMode = params.renderMode === 'fetch' ? 'render' : 'fetch';
        } else if (key === 'delayMs') {
          params.delayMs = this.randomInt(100, 3000);
        } else if (key === 'linkFollowProbability') {
          params.linkFollowProbability = 0.3 + this.rng() * 0.6;
        } else if (key === 'extractionFocus') {
          params.extractionFocus = this.randomChoice(['content', 'links', 'metadata', 'all']);
        }
        changedCount++;
      }
    }

    return params;
  }

  /**
   * Select crawler based on current weights
   * Initial: A=40%, B=30%, C=20%, D=10%
   */
  private selectCrawlerByWeight(): CrawlerId {
    const totalWeight = Array.from(this.state.currentWeights.values()).reduce((a, b) => a + b, 0);
    let random = this.rng() * totalWeight;

    for (const [crawlerId, weight] of this.state.currentWeights) {
      random -= weight;
      if (random <= 0) {
        return crawlerId;
      }
    }

    return 'STARTREK'; // Fallback
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // ============================================================================
  // SCORING SYSTEM
  // ============================================================================

  /**
   * Score a run outcome
   * "Each run gets a score based on: pages discovered, usable content extracted,
   *  time to first result, failure rate. No fancy math needed at first."
   */
  calculateScore(outcome: Omit<RunOutcome, 'score'>): number {
    const { results } = outcome;
    const weights = this.config.scoring;

    // Normalize metrics to 0-1 scale
    const normalizedPages = Math.min(results.pagesDiscovered / 100, 1);
    const normalizedContent = Math.min(results.usableContentExtracted / 50, 1);
    const normalizedSpeed = Math.max(0, 1 - (results.timeToFirstResultMs / 30000));
    const failureRate = results.totalRequests > 0
      ? results.failureCount / results.totalRequests
      : 1;
    const normalizedReliability = 1 - failureRate;

    // Weighted sum
    const score =
      weights.pagesDiscovered * normalizedPages +
      weights.usableContentExtracted * normalizedContent +
      weights.timeToFirstResult * normalizedSpeed +
      weights.failureRate * normalizedReliability;

    return Math.round(score * 1000) / 1000;
  }

  // ============================================================================
  // OPTIMIZATION EXECUTION
  // ============================================================================

  /**
   * Run Monte Carlo optimization
   * "50 seeds × 10 = 500 runs minimum for real convergence"
   */
  async runOptimization(): Promise<void> {
    if (this.state.seeds.length < this.config.seeds.count) {
      log.warn('Not enough seeds', {
        have: this.state.seeds.length,
        need: this.config.seeds.count,
      });
    }

    this.state.status = 'running';
    this.state.startTime = new Date();
    this.state.currentBatch = 0;

    log.info('Starting Monte Carlo optimization', {
      seeds: this.state.seeds.length,
      iterationsPerSeed: this.config.iterations.perSeed,
      totalRuns: this.state.seeds.length * this.config.iterations.perSeed,
    });

    this.emit('optimization-started', {
      seeds: this.state.seeds.length,
      totalRuns: this.state.seeds.length * this.config.iterations.perSeed,
    });

    try {
      // Process in batches
      let runIndex = 0;
      let previousParams: Partial<CrawlParameters> | undefined;

      for (const seed of this.state.seeds) {
        for (let iteration = 0; iteration < this.config.iterations.perSeed; iteration++) {
          // Check convergence
          if (this.state.convergence.isStable) {
            log.info('Convergence reached - stopping optimization');
            this.state.status = 'converged';
            break;
          }

          // Generate randomized parameters
          const params = this.generateRandomParameters(previousParams);
          previousParams = params;

          // Execute crawl run
          const outcome = await this.executeRun(seed, iteration, params);
          this.state.outcomes.push(outcome);
          this.state.completedRuns++;
          runIndex++;

          // Emit progress
          this.emit('run-completed', {
            runIndex,
            totalRuns: this.state.seeds.length * this.config.iterations.perSeed,
            outcome,
          });

          // Process batch if threshold reached
          if (runIndex % this.config.iterations.batchSize === 0) {
            await this.processBatch();
          }
        }

        if (this.state.convergence.isStable) break;
      }

      // Final batch processing
      if (this.state.outcomes.length % this.config.iterations.batchSize !== 0) {
        await this.processBatch();
      }

      this.state.endTime = new Date();
      if (this.state.status !== 'converged') {
        this.state.status = 'stopped';
      }

      log.info('Monte Carlo optimization complete', {
        status: this.state.status,
        completedRuns: this.state.completedRuns,
        batches: this.state.currentBatch,
        finalWeights: Object.fromEntries(this.state.currentWeights),
      });

      this.emit('optimization-complete', this.getResults());

    } catch (err) {
      log.error('Optimization failed', { error: err });
      this.state.status = 'stopped';
      throw err;
    }
  }

  /**
   * Execute a single crawl run (simulated for now)
   */
  private async executeRun(
    seed: SeedURL,
    iteration: number,
    params: CrawlParameters
  ): Promise<RunOutcome> {
    const runId = randomUUID();
    const startTime = Date.now();

    // Simulate crawl execution based on crawler characteristics
    const crawlerProfile = this.getCrawlerProfile(params.crawlerId);
    const results = this.simulateCrawlResults(seed, params, crawlerProfile);

    const outcome: Omit<RunOutcome, 'score'> = {
      runId,
      seedId: seed.id,
      seedUrl: seed.url,
      iteration,
      parameters: params,
      results,
      timestamp: new Date(),
    };

    const score = this.calculateScore(outcome);

    return { ...outcome, score };
  }

  /**
   * Get crawler performance profile
   */
  private getCrawlerProfile(crawlerId: CrawlerId): {
    discoveryBonus: number;
    extractionBonus: number;
    speedBonus: number;
    reliabilityBonus: number;
  } {
    const profiles: Record<CrawlerId, any> = {
      STARTREK: { discoveryBonus: 1.3, extractionBonus: 1.0, speedBonus: 1.2, reliabilityBonus: 1.1 },
      BLIZZARD: { discoveryBonus: 1.1, extractionBonus: 1.3, speedBonus: 0.9, reliabilityBonus: 1.0 },
      BIRDOFPREY: { discoveryBonus: 1.0, extractionBonus: 1.2, speedBonus: 1.0, reliabilityBonus: 0.85 },
      HYDRA: { discoveryBonus: 1.2, extractionBonus: 1.1, speedBonus: 0.95, reliabilityBonus: 1.05 },
    };
    return profiles[crawlerId];
  }

  /**
   * Simulate crawl results based on parameters and crawler profile
   */
  private simulateCrawlResults(
    seed: SeedURL,
    params: CrawlParameters,
    profile: ReturnType<typeof this.getCrawlerProfile>
  ): RunOutcome['results'] {
    // Base values with randomness
    const basePagesDiscovered = 10 + Math.floor(this.rng() * 40);
    const baseContentExtracted = 5 + Math.floor(this.rng() * 25);
    const baseTimeToFirst = 500 + Math.floor(this.rng() * 5000);
    const baseFailureRate = 0.05 + this.rng() * 0.15;

    // Apply crawler profile bonuses
    const pagesDiscovered = Math.floor(basePagesDiscovered * profile.discoveryBonus * (params.crawlDepth / 5));
    const usableContentExtracted = Math.floor(baseContentExtracted * profile.extractionBonus);
    const timeToFirstResultMs = Math.floor(baseTimeToFirst / profile.speedBonus);
    const totalRequests = pagesDiscovered + Math.floor(this.rng() * 10);
    const failureCount = Math.floor(totalRequests * baseFailureRate / profile.reliabilityBonus);

    // Adjust for render vs fetch
    const renderPenalty = params.renderMode === 'render' ? 1.5 : 1;

    return {
      pagesDiscovered,
      usableContentExtracted,
      timeToFirstResultMs: Math.floor(timeToFirstResultMs * renderPenalty),
      totalTimeMs: timeToFirstResultMs * 10 + Math.floor(this.rng() * 5000),
      failureCount,
      totalRequests,
    };
  }

  // ============================================================================
  // BATCH PROCESSING & CONVERGENCE
  // ============================================================================

  /**
   * Process batch and check convergence
   */
  private async processBatch(): Promise<void> {
    this.state.currentBatch++;

    // Calculate strategy rankings
    const rankings = this.calculateRankings();

    // Store previous rankings
    this.state.convergence.previousRankings.push([...this.state.convergence.rankings]);
    if (this.state.convergence.previousRankings.length > 5) {
      this.state.convergence.previousRankings.shift();
    }

    this.state.convergence.rankings = rankings;
    this.state.convergence.batchNumber = this.state.currentBatch;

    // Check convergence
    this.checkConvergence();

    // Update weights based on performance
    if (!this.state.convergence.isStable) {
      this.updateWeights(rankings);
    }

    log.info('Batch processed', {
      batch: this.state.currentBatch,
      rankings: rankings.map(r => ({ id: r.crawlerId, rank: r.rank, avgScore: r.averageScore })),
      stableBatches: this.state.convergence.stabileBatchCount,
      isStable: this.state.convergence.isStable,
    });

    this.emit('batch-processed', {
      batch: this.state.currentBatch,
      rankings,
      isStable: this.state.convergence.isStable,
    });
  }

  /**
   * Calculate strategy rankings from outcomes
   */
  private calculateRankings(): StrategyRanking[] {
    const crawlerScores = new Map<CrawlerId, { totalScore: number; runCount: number }>();

    // Initialize
    for (const crawler of this.config.crawlers) {
      crawlerScores.set(crawler.id, { totalScore: 0, runCount: 0 });
    }

    // Aggregate scores
    for (const outcome of this.state.outcomes) {
      const stats = crawlerScores.get(outcome.parameters.crawlerId)!;
      stats.totalScore += outcome.score;
      stats.runCount++;
    }

    // Calculate rankings
    const rankings: StrategyRanking[] = [];
    for (const [crawlerId, stats] of crawlerScores) {
      rankings.push({
        crawlerId,
        totalScore: stats.totalScore,
        runCount: stats.runCount,
        averageScore: stats.runCount > 0 ? stats.totalScore / stats.runCount : 0,
        rank: 0,
        weight: this.state.currentWeights.get(crawlerId) || 0,
      });
    }

    // Sort by average score and assign ranks
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    rankings.forEach((r, i) => r.rank = i + 1);

    return rankings;
  }

  /**
   * Check convergence
   * "Stop Monte Carlo when the top 2 crawler strategies remain unchanged
   *  for 3 consecutive iteration batches."
   */
  private checkConvergence(): void {
    const { previousRankings, rankings } = this.state.convergence;
    const topN = this.config.convergence.topStrategiesToTrack;
    const requiredBatches = this.config.convergence.stableBatchesRequired;

    if (previousRankings.length < requiredBatches) {
      return;
    }

    // Get current top N
    const currentTopN = rankings.slice(0, topN).map(r => r.crawlerId);

    // Check if top N has been stable across required batches
    let stableCount = 0;
    for (let i = previousRankings.length - 1; i >= 0 && stableCount < requiredBatches; i--) {
      const prevTopN = previousRankings[i].slice(0, topN).map(r => r.crawlerId);
      const isMatch = currentTopN.every((id, idx) => prevTopN[idx] === id);
      if (isMatch) {
        stableCount++;
      } else {
        break;
      }
    }

    this.state.convergence.stabileBatchCount = stableCount;
    this.state.convergence.isStable = stableCount >= requiredBatches;

    if (this.state.convergence.isStable) {
      log.info('CONVERGENCE ACHIEVED', {
        topStrategies: currentTopN,
        stableBatches: stableCount,
      });
    }
  }

  /**
   * Update crawler weights based on performance
   */
  private updateWeights(rankings: StrategyRanking[]): void {
    const totalAvgScore = rankings.reduce((sum, r) => sum + r.averageScore, 0);
    if (totalAvgScore === 0) return;

    // Redistribute weights based on relative performance
    for (const ranking of rankings) {
      const newWeight = ranking.averageScore / totalAvgScore;
      // Smooth transition (blend 70% new, 30% old)
      const oldWeight = this.state.currentWeights.get(ranking.crawlerId) || 0;
      const blendedWeight = newWeight * 0.7 + oldWeight * 0.3;
      this.state.currentWeights.set(ranking.crawlerId, blendedWeight);
    }

    // Normalize to sum to 1
    const totalWeight = Array.from(this.state.currentWeights.values()).reduce((a, b) => a + b, 0);
    for (const [id, weight] of this.state.currentWeights) {
      this.state.currentWeights.set(id, weight / totalWeight);
    }
  }

  // ============================================================================
  // RESULTS & EXPORTS
  // ============================================================================

  /**
   * Get optimization results
   */
  getResults(): {
    status: OptimizationState['status'];
    completedRuns: number;
    batches: number;
    finalRankings: StrategyRanking[];
    finalWeights: Record<CrawlerId, number>;
    converged: boolean;
    duration: number;
    topStrategy: CrawlerId;
    recommendation: string;
  } {
    const finalRankings = this.state.convergence.rankings;
    const finalWeights: Record<CrawlerId, number> = {} as any;
    for (const [id, weight] of this.state.currentWeights) {
      finalWeights[id] = Math.round(weight * 1000) / 1000;
    }

    const topStrategy = finalRankings[0]?.crawlerId || 'STARTREK';
    const topCrawler = MONTE_CARLO_CRAWLERS.find(c => c.id === topStrategy);

    return {
      status: this.state.status,
      completedRuns: this.state.completedRuns,
      batches: this.state.currentBatch,
      finalRankings,
      finalWeights,
      converged: this.state.convergence.isStable,
      duration: this.state.endTime && this.state.startTime
        ? this.state.endTime.getTime() - this.state.startTime.getTime()
        : 0,
      topStrategy,
      recommendation: `Use ${topCrawler?.name || topStrategy} as primary crawler (${Math.round(finalWeights[topStrategy] * 100)}% allocation)`,
    };
  }

  /**
   * Get current state
   */
  getState(): OptimizationState {
    return { ...this.state };
  }

  /**
   * Reset optimizer
   */
  reset(): void {
    this.state = this.initializeState();
    log.info('Optimizer reset');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const monteCarloCrawlerOptimizer = new MonteCarloCrawlerOptimizer();
export default MonteCarloCrawlerOptimizer;
