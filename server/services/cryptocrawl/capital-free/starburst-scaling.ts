// Starburst Scaling System - CPU/RAM Resource Architecture
// 8 Canes (6 Original + 2 Purpose) + Crawlers (scalable to millions)
// Implements Starburst Waves for dynamic resource allocation

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId, Opportunity } from '../core/lux-swarm';
import { LuxSwarm } from '../core/lux-swarm';

// Configuration constants
const MAX_CRAWLER_CAPACITY = 1000000; // 1M crawlers (scalable architecture supports 100M+)
const IDLE_THRESHOLD_MS = 30000; // 30 seconds
const CANE_BOOST_MIN_PERCENT = 5;
const CANE_BOOST_MAX_PERCENT = 20;
const CANE_BOOST_DURATION_MS = 5000;
const MICRO_CRAWLER_LIFESPAN_MS = 1000;
const CATACLYSM_HIGH_LOAD_THRESHOLD = 80;
const CATACLYSM_AFFECTED_CANES_THRESHOLD = 3;
const CANE_BOOST_PROBABILITY_THRESHOLD = 0.7;
const CRAWLER_BLOOM_PROBABILITY_THRESHOLD = 0.5;
const CRAWLER_PRUNE_THRESHOLD = 100;

// Cane Types - The 8 specialized agents
export type CaneType = 
  | 'arb_prime'           // Main arbitrage brain
  | 'gas_allocator'       // Gas allocation controller
  | 'flash_orchestrator'  // Flash loan orchestrator
  | 'risk_evaluator'      // Risk assessment engine
  | 'mempool_mapper'      // Mempool monitoring
  | 'eden_distributor'    // Eden state distribution
  | 'reaper_watcher'      // Cataclysm detection (purpose cane)
  | 'gravity_coordinator'; // Crawler overseer (purpose cane)

export interface Cane {
  id: string;
  type: CaneType;
  cpuAllocation: number; // Percentage of total CPU
  ramAllocation: number; // MB of RAM
  status: 'active' | 'boosted' | 'idle' | 'safe_mode';
  currentLoad: number; // 0-100
  profitGenerated: number;
  crawlersManaged: number;
  lastActivity: number;
}

export interface Crawler {
  id: string;
  parentCane: string;
  type: 'micro' | 'standard' | 'heavy';
  chain: ChainId;
  target: string;
  status: 'active' | 'executing' | 'completed' | 'dissolved';
  createdAt: number;
  dissolvedAt: number | null;
}

export interface StarburstWave {
  id: string;
  type: 'boost' | 'bloom' | 'flash' | 'dissolve';
  targetCanes: string[];
  intensity: number; // 1-10
  triggeredAt: number;
  completedAt: number | null;
}

export interface ScalingMetrics {
  totalCanes: number;
  activeCanes: number;
  totalCrawlers: number;
  activeCrawlers: number;
  cpuUsage: number;
  ramUsage: number;
  profitGenerated: number;
  wavesTriggered: number;
}

// Default Cane configurations
const CANE_CONFIGS: Record<CaneType, { cpuBase: number; ramBase: number }> = {
  arb_prime: { cpuBase: 20, ramBase: 512 },
  gas_allocator: { cpuBase: 10, ramBase: 256 },
  flash_orchestrator: { cpuBase: 15, ramBase: 384 },
  risk_evaluator: { cpuBase: 12, ramBase: 320 },
  mempool_mapper: { cpuBase: 15, ramBase: 384 },
  eden_distributor: { cpuBase: 8, ramBase: 256 },
  reaper_watcher: { cpuBase: 10, ramBase: 256 },
  gravity_coordinator: { cpuBase: 10, ramBase: 256 },
};

/**
 * Starburst Scaling System
 * Manages 8 Canes + crawlers (scalable to millions) with dynamic resource allocation
 */
export class StarburstScalingSystem {
  private canes: Map<string, Cane> = new Map();
  private crawlers: Map<string, Crawler> = new Map();
  private waves: Map<string, StarburstWave> = new Map();
  private isRunning: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private maxCrawlers: number = MAX_CRAWLER_CAPACITY;
  private wavesTriggered: number = 0;

  constructor() {
    this.initializeCanes();
    
    logger.info('[Starburst] Scaling System initialized', {
      component: 'StarburstScalingSystem',
      canes: this.canes.size,
    });
  }

  /**
   * Initialize the 8 Canes
   */
  private initializeCanes(): void {
    const caneTypes: CaneType[] = [
      'arb_prime',
      'gas_allocator', 
      'flash_orchestrator',
      'risk_evaluator',
      'mempool_mapper',
      'eden_distributor',
      'reaper_watcher',
      'gravity_coordinator',
    ];

    for (const type of caneTypes) {
      const config = CANE_CONFIGS[type];
      const cane: Cane = {
        id: `cane-${type}-${randomUUID().slice(0, 8)}`,
        type,
        cpuAllocation: config.cpuBase,
        ramAllocation: config.ramBase,
        status: 'active',
        currentLoad: 0,
        profitGenerated: 0,
        crawlersManaged: 0,
        lastActivity: Date.now(),
      };
      this.canes.set(cane.id, cane);
    }
  }

  /**
   * Start the scaling system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[Starburst] Already running', { component: 'StarburstScalingSystem' });
      return;
    }

    this.isRunning = true;

    // Start monitoring loop
    this.monitorInterval = setInterval(() => {
      this.monitorAndScale().catch(err => {
        logger.error('[Starburst] Monitor error', {
          component: 'StarburstScalingSystem',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 2000); // Every 2 seconds

    logger.info('[Starburst] Scaling system started', { component: 'StarburstScalingSystem' });
  }

  /**
   * Stop the scaling system
   */
  stop(): void {
    this.isRunning = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    // Dissolve all crawlers
    for (const crawler of this.crawlers.values()) {
      crawler.status = 'dissolved';
      crawler.dissolvedAt = Date.now();
    }
    
    logger.info('[Starburst] Scaling system stopped', { component: 'StarburstScalingSystem' });
  }

  /**
   * STARBURST WAVE 1: Cane Boost
   * CPU sends 5-20% extra power to canes predicting profit
   */
  async triggerCaneBoost(profitPredictors: string[]): Promise<StarburstWave> {
    const boostRange = CANE_BOOST_MAX_PERCENT - CANE_BOOST_MIN_PERCENT;
    const wave: StarburstWave = {
      id: `wave-boost-${randomUUID().slice(0, 8)}`,
      type: 'boost',
      targetCanes: profitPredictors,
      intensity: CANE_BOOST_MIN_PERCENT + Math.random() * boostRange,
      triggeredAt: Date.now(),
      completedAt: null,
    };

    // Apply boost to target canes
    for (const caneId of profitPredictors) {
      const cane = this.canes.get(caneId);
      if (cane) {
        cane.cpuAllocation += wave.intensity;
        cane.status = 'boosted';
        cane.lastActivity = Date.now();
      }
    }

    this.waves.set(wave.id, wave);
    this.wavesTriggered++;

    logger.info('[Starburst] Wave 1 CANE BOOST triggered', {
      component: 'StarburstScalingSystem',
      waveId: wave.id,
      targets: profitPredictors.length,
      intensity: wave.intensity.toFixed(1),
    });

    // Complete wave after short duration
    setTimeout(() => {
      wave.completedAt = Date.now();
      // Reset CPU allocations
      for (const caneId of profitPredictors) {
        const cane = this.canes.get(caneId);
        if (cane) {
          const config = CANE_CONFIGS[cane.type];
          cane.cpuAllocation = config.cpuBase;
          cane.status = 'active';
        }
      }
    }, CANE_BOOST_DURATION_MS);

    return wave;
  }

  /**
   * STARBURST WAVE 2: Crawler Bloom
   * Short bursts of crawlers launch ONLY when profitable routes appear
   */
  async triggerCrawlerBloom(opportunities: Opportunity[]): Promise<StarburstWave> {
    const gravityCoordinator = Array.from(this.canes.values())
      .find(c => c.type === 'gravity_coordinator');

    if (!gravityCoordinator) {
      throw new Error('Gravity Coordinator not found');
    }

    const wave: StarburstWave = {
      id: `wave-bloom-${randomUUID().slice(0, 8)}`,
      type: 'bloom',
      targetCanes: [gravityCoordinator.id],
      intensity: opportunities.length,
      triggeredAt: Date.now(),
      completedAt: null,
    };

    // Spawn crawlers for each opportunity
    const newCrawlers: Crawler[] = [];
    for (const opp of opportunities) {
      // Skip if at max capacity
      if (this.crawlers.size >= this.maxCrawlers) break;

      const crawler: Crawler = {
        id: `crawler-${randomUUID().slice(0, 8)}`,
        parentCane: gravityCoordinator.id,
        type: opp.priority > 70 ? 'heavy' : opp.priority > 40 ? 'standard' : 'micro',
        chain: opp.chain,
        target: opp.asset,
        status: 'active',
        createdAt: Date.now(),
        dissolvedAt: null,
      };
      this.crawlers.set(crawler.id, crawler);
      newCrawlers.push(crawler);
    }

    gravityCoordinator.crawlersManaged += newCrawlers.length;
    gravityCoordinator.lastActivity = Date.now();

    this.waves.set(wave.id, wave);
    this.wavesTriggered++;

    logger.info('[Starburst] Wave 2 CRAWLER BLOOM triggered', {
      component: 'StarburstScalingSystem',
      waveId: wave.id,
      crawlersSpawned: newCrawlers.length,
      totalCrawlers: this.crawlers.size,
    });

    // Mark wave complete
    wave.completedAt = Date.now();

    return wave;
  }

  /**
   * STARBURST WAVE 3: Micro-Crawler Flashing
   * Micros launch only to collect atomic data from mempools/price feeds
   */
  async triggerMicroFlash(dataTargets: { chain: ChainId; target: string }[]): Promise<StarburstWave> {
    const mempoolMapper = Array.from(this.canes.values())
      .find(c => c.type === 'mempool_mapper');

    if (!mempoolMapper) {
      throw new Error('Mempool Mapper not found');
    }

    const wave: StarburstWave = {
      id: `wave-flash-${randomUUID().slice(0, 8)}`,
      type: 'flash',
      targetCanes: [mempoolMapper.id],
      intensity: dataTargets.length,
      triggeredAt: Date.now(),
      completedAt: null,
    };

    // Spawn micro-crawlers for data collection
    const microCrawlers: Crawler[] = [];
    for (const target of dataTargets) {
      if (this.crawlers.size >= this.maxCrawlers) break;

      const micro: Crawler = {
        id: `micro-${randomUUID().slice(0, 8)}`,
        parentCane: mempoolMapper.id,
        type: 'micro',
        chain: target.chain,
        target: target.target,
        status: 'active',
        createdAt: Date.now(),
        dissolvedAt: null,
      };
      this.crawlers.set(micro.id, micro);
      microCrawlers.push(micro);
    }

    mempoolMapper.crawlersManaged += microCrawlers.length;
    mempoolMapper.lastActivity = Date.now();

    this.waves.set(wave.id, wave);
    this.wavesTriggered++;

    logger.debug('[Starburst] Wave 3 MICRO FLASH triggered', {
      component: 'StarburstScalingSystem',
      waveId: wave.id,
      microsSpawned: microCrawlers.length,
    });

    // Auto-dissolve micros after data collection (short lifespan)
    setTimeout(() => {
      for (const micro of microCrawlers) {
        micro.status = 'dissolved';
        micro.dissolvedAt = Date.now();
      }
      wave.completedAt = Date.now();
    }, MICRO_CRAWLER_LIFESPAN_MS);

    return wave;
  }

  /**
   * STARBURST WAVE 4: Dissolution
   * Unused crawlers vanish instantly → memory stays low
   */
  async triggerDissolution(): Promise<StarburstWave> {
    const now = Date.now();

    const wave: StarburstWave = {
      id: `wave-dissolve-${randomUUID().slice(0, 8)}`,
      type: 'dissolve',
      targetCanes: [],
      intensity: 0,
      triggeredAt: now,
      completedAt: null,
    };

    let dissolved = 0;
    for (const [, crawler] of this.crawlers) {
      // Dissolve completed or idle crawlers
      if (
        crawler.status === 'completed' ||
        (crawler.status === 'active' && now - crawler.createdAt > IDLE_THRESHOLD_MS)
      ) {
        crawler.status = 'dissolved';
        crawler.dissolvedAt = now;
        dissolved++;
      }
    }

    // Actually remove dissolved crawlers
    for (const [id, crawler] of this.crawlers) {
      if (crawler.status === 'dissolved') {
        this.crawlers.delete(id);
      }
    }

    wave.intensity = dissolved;
    wave.completedAt = now;

    this.waves.set(wave.id, wave);
    this.wavesTriggered++;

    if (dissolved > 0) {
      logger.info('[Starburst] Wave 4 DISSOLUTION triggered', {
        component: 'StarburstScalingSystem',
        waveId: wave.id,
        dissolved,
        remaining: this.crawlers.size,
      });
    }

    return wave;
  }

  /**
   * Monitor system and apply scaling decisions
   */
  private async monitorAndScale(): Promise<void> {
    const lux = LuxSwarm.observe();

    // Update cane loads
    for (const cane of this.canes.values()) {
      // Simulate load based on opportunities
      const chainOpps = lux.opportunities.filter(o => true); // All chains
      cane.currentLoad = Math.min(100, chainOpps.length * 5);
      cane.lastActivity = Date.now();
    }

    // REAPER WATCHER: Detect cataclysms
    const reaperWatcher = Array.from(this.canes.values())
      .find(c => c.type === 'reaper_watcher');
    
    if (reaperWatcher) {
      // Check for system-wide threats
      const highLoadCanes = Array.from(this.canes.values())
        .filter(c => c.currentLoad > CATACLYSM_HIGH_LOAD_THRESHOLD);
      
      if (highLoadCanes.length > CATACLYSM_AFFECTED_CANES_THRESHOLD) {
        // Enter safe mode
        for (const cane of this.canes.values()) {
          if (cane.status !== 'safe_mode') {
            cane.status = 'safe_mode';
            logger.warn('[Starburst] CATACLYSM DETECTED - entering safe mode', {
              component: 'StarburstScalingSystem',
              affectedCanes: highLoadCanes.length,
            });
          }
        }
      }
    }

    // ARB PRIME: Predict profits and trigger boosts
    const arbPrime = Array.from(this.canes.values())
      .find(c => c.type === 'arb_prime');
    
    if (arbPrime && lux.opportunities.length > 0) {
      // Find profit-predicting canes and boost them
      const profitCanes = Array.from(this.canes.values())
        .filter(c => c.type === 'flash_orchestrator' || c.type === 'gas_allocator')
        .map(c => c.id);
      
      if (profitCanes.length > 0 && Math.random() > CANE_BOOST_PROBABILITY_THRESHOLD) {
        await this.triggerCaneBoost(profitCanes);
      }
    }

    // GRAVITY COORDINATOR: Spawn crawlers for opportunities
    if (lux.opportunities.length > 0 && Math.random() > CRAWLER_BLOOM_PROBABILITY_THRESHOLD) {
      await this.triggerCrawlerBloom(lux.opportunities.slice(0, 10));
    }

    // Periodic dissolution to keep memory low
    if (this.crawlers.size > CRAWLER_PRUNE_THRESHOLD) {
      await this.triggerDissolution();
    }
  }

  /**
   * Get a specific cane by type
   */
  getCane(type: CaneType): Cane | null {
    for (const cane of this.canes.values()) {
      if (cane.type === type) {
        return cane;
      }
    }
    return null;
  }

  /**
   * Get all canes
   */
  getAllCanes(): Cane[] {
    return Array.from(this.canes.values());
  }

  /**
   * Get active crawlers count by chain
   */
  getActiveCrawlersByChain(): Record<ChainId, number> {
    const counts: Record<ChainId, number> = {
      ethereum: 0,
      polygon: 0,
      bsc: 0,
      avalanche: 0,
      arbitrum: 0,
      optimism: 0,
    };

    for (const crawler of this.crawlers.values()) {
      if (crawler.status === 'active' || crawler.status === 'executing') {
        counts[crawler.chain]++;
      }
    }

    return counts;
  }

  /**
   * Get scaling statistics
   */
  getStatistics(): ScalingMetrics {
    const activeCanes = Array.from(this.canes.values())
      .filter(c => c.status === 'active' || c.status === 'boosted');
    
    const activeCrawlers = Array.from(this.crawlers.values())
      .filter(c => c.status === 'active' || c.status === 'executing');

    const totalCpu = Array.from(this.canes.values())
      .reduce((sum, c) => sum + c.cpuAllocation, 0);
    
    const totalRam = Array.from(this.canes.values())
      .reduce((sum, c) => sum + c.ramAllocation, 0);

    const totalProfit = Array.from(this.canes.values())
      .reduce((sum, c) => sum + c.profitGenerated, 0);

    return {
      totalCanes: this.canes.size,
      activeCanes: activeCanes.length,
      totalCrawlers: this.crawlers.size,
      activeCrawlers: activeCrawlers.length,
      cpuUsage: totalCpu,
      ramUsage: totalRam,
      profitGenerated: totalProfit,
      wavesTriggered: this.wavesTriggered,
    };
  }

  /**
   * Reset system (for testing)
   */
  reset(): void {
    this.stop();
    this.canes.clear();
    this.crawlers.clear();
    this.waves.clear();
    this.wavesTriggered = 0;
    this.initializeCanes();
  }
}

export const starburstScalingSystem = new StarburstScalingSystem();
