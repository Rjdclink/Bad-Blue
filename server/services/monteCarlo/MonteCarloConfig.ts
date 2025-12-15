/**
 * MONTE CARLO CRAWLER OPTIMIZATION - CONFIGURATION
 * 
 * This file defines the 4 selected crawler candidates and their
 * initial weighting for Monte Carlo optimization.
 * 
 * SELECTED CRAWLERS:
 * ==================
 * 
 * A. STARTREK CRAWLER (40% initial weight)
 *    - Federation Explorer optimized for broad discovery
 *    - Warp speed jumps for vast territory coverage
 *    - Transporter beaming for instant deep URL access
 *    - Long-range sensors for discovery
 *    - Prime Directive mode for ethical constraints
 *    - Best for: Initial exploration, sitemap discovery, link mapping
 * 
 * B. BLIZZARD CRAWLER (30% initial weight)
 *    - Ice Storm mass parallel scraper
 *    - Unique fingerprints per request (snowflakes)
 *    - Storm intensity levels (flurry → whiteout)
 *    - Avalanche mode for cascading crawls
 *    - Best for: High-volume extraction, mass data gathering
 * 
 * C. BIRDOFPREY CRAWLER (20% initial weight)
 *    - Klingon Predator with stealth capabilities
 *    - Perfect cloaking (complete invisibility)
 *    - Fire while cloaked (advanced attacks)
 *    - Disruptors 50% more powerful than standard
 *    - Best for: Protected sites, anti-bot bypass, aggressive extraction
 * 
 * D. HYDRA CRAWLER (10% initial weight)
 *    - Adaptive Multi-Head Explorer
 *    - Dynamic head spawning (up to 5 concurrent)
 *    - Pheromone-based pathfinding
 *    - Richness assessment for content quality
 *    - Best for: Complex site structures, adaptive exploration
 * 
 * Monte Carlo will rebalance these weights based on performance.
 */

export type CrawlerId = 'STARTREK' | 'BLIZZARD' | 'BIRDOFPREY' | 'HYDRA';

export interface CrawlerCandidate {
  id: CrawlerId;
  name: string;
  description: string;
  initialWeight: number;
  capabilities: string[];
  bestFor: string[];
  importPath: string;
  className: string;
}

export interface MonteCarloConfig {
  // Seed configuration
  seeds: {
    count: number;
    diversityRequired: boolean;
    maxPerDomain: number;
  };
  
  // Iteration configuration
  iterations: {
    perSeed: number;
    totalRuns: number;
    batchSize: number;
  };
  
  // Randomization parameters (must change ≥2 per iteration)
  randomization: {
    minParamsToChange: number;
    parameters: RandomizationParameter[];
  };
  
  // Convergence rules
  convergence: {
    stableBatchesRequired: number;
    topStrategiesToTrack: number;
    maxIterationsBeforeForceStop: number;
  };
  
  // Scoring weights
  scoring: {
    pagesDiscovered: number;
    usableContentExtracted: number;
    timeToFirstResult: number;
    failureRate: number;
  };
  
  // Crawler candidates
  crawlers: CrawlerCandidate[];
}

export type RandomizationParameter = 
  | 'crawlerChoice'
  | 'crawlDepth'
  | 'renderVsFetch'
  | 'delayTiming'
  | 'linkFollowProbability'
  | 'extractionFocus';

/**
 * THE 4 SELECTED CRAWLER CANDIDATES
 */
export const MONTE_CARLO_CRAWLERS: CrawlerCandidate[] = [
  {
    id: 'STARTREK',
    name: 'StarTrek Crawler',
    description: 'Federation Explorer - Broad discovery with warp jumps and long-range sensors',
    initialWeight: 0.40,
    capabilities: [
      'Warp speed control (1-9)',
      'Transporter beaming',
      'Long-range sensors',
      'Phaser settings (1-10)',
      'Prime Directive mode',
    ],
    bestFor: [
      'Initial exploration',
      'Sitemap discovery',
      'Link mapping',
      'Domain reconnaissance',
    ],
    importPath: '../crawlers/StarTrekCrawler',
    className: 'StarTrekCrawler',
  },
  {
    id: 'BLIZZARD',
    name: 'Blizzard Crawler',
    description: 'Ice Storm - Mass parallel scraping with unique fingerprints',
    initialWeight: 0.30,
    capabilities: [
      'Unique fingerprints (snowflakes)',
      'Storm intensity levels',
      'Avalanche mode',
      'Parallel deployment',
      'Ice crystal caching',
    ],
    bestFor: [
      'High-volume extraction',
      'Mass data gathering',
      'Parallel processing',
      'Large site crawls',
    ],
    importPath: '../crawlers/TrinityCrawlers',
    className: 'BlizzardCrawler',
  },
  {
    id: 'BIRDOFPREY',
    name: 'Bird of Prey Crawler',
    description: 'Klingon Predator - Stealth operations with perfect cloaking',
    initialWeight: 0.20,
    capabilities: [
      'Perfect cloaking',
      'Fire while cloaked',
      'Disruptors (150% power)',
      'Aggressive patterns',
      'Quantum fingerprints',
    ],
    bestFor: [
      'Protected sites',
      'Anti-bot bypass',
      'Aggressive extraction',
      'Stealth operations',
    ],
    importPath: '../crawlers/BirdOfPreyCrawler',
    className: 'BirdOfPreyCrawler',
  },
  {
    id: 'HYDRA',
    name: 'Hydra Crawler',
    description: 'Multi-Head Explorer - Adaptive spawning with pheromone pathfinding',
    initialWeight: 0.10,
    capabilities: [
      'Dynamic head spawning',
      'Pheromone trails',
      'Richness assessment',
      'Auto-pruning',
      'Concurrent exploration',
    ],
    bestFor: [
      'Complex site structures',
      'Adaptive exploration',
      'Content-rich discovery',
      'Deep site navigation',
    ],
    importPath: '../pantheon/crawlers/hydra',
    className: 'HydraCrawler',
  },
];

/**
 * DEFAULT MONTE CARLO CONFIGURATION
 */
export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  seeds: {
    count: 50,
    diversityRequired: true,
    maxPerDomain: 5,
  },
  
  iterations: {
    perSeed: 10,
    totalRuns: 500, // 50 seeds × 10 iterations
    batchSize: 50,
  },
  
  randomization: {
    minParamsToChange: 2,
    parameters: [
      'crawlerChoice',
      'crawlDepth',
      'renderVsFetch',
      'delayTiming',
      'linkFollowProbability',
      'extractionFocus',
    ],
  },
  
  convergence: {
    stableBatchesRequired: 3,
    topStrategiesToTrack: 2,
    maxIterationsBeforeForceStop: 2000,
  },
  
  scoring: {
    pagesDiscovered: 0.30,
    usableContentExtracted: 0.35,
    timeToFirstResult: 0.20,
    failureRate: 0.15,
  },
  
  crawlers: MONTE_CARLO_CRAWLERS,
};

/**
 * Scale-up configurations for after initial optimization stabilizes
 */
export const SCALE_UP_CONFIGS = {
  phase2: {
    seeds: { count: 100, diversityRequired: true, maxPerDomain: 10 },
    iterations: { perSeed: 15, totalRuns: 1500, batchSize: 100 },
  },
  phase3: {
    seeds: { count: 200, diversityRequired: true, maxPerDomain: 20 },
    iterations: { perSeed: 20, totalRuns: 4000, batchSize: 200 },
  },
};
