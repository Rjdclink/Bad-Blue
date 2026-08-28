// LEGACY COMPATIBILITY SHELL
//
// The historical Eden/LuxSwarm swarm orchestrator used simulated micro-crawler
// execution and synthetic profit. It is retained only to preserve old imports
// and shutdown compatibility. It has no CryptoCrawler discovery, execution,
// learning, scaling, or profitability authority.

import logger from '../../../logger.js';

export class SwarmOrchestrator {
  private isRunning = false;

  constructor() {
    logger.debug('Legacy swarm compatibility shell constructed', {
      component: 'LegacySwarmOrchestrator',
      authority: 'none',
    });
  }

  async initialize(): Promise<void> {
    this.isRunning = false;
    logger.info('Legacy Eden/LuxSwarm orchestrator is quarantined', {
      component: 'LegacySwarmOrchestrator',
      authority: 'compatibility_only',
      canonicalReplacement: 'canonical measured CryptoCrawler runtime',
    });
  }

  /**
   * Historical callers may still invoke start(). Keep the call harmless rather
   * than spawning simulated Cain/micro-crawler loops.
   */
  async start(): Promise<void> {
    this.isRunning = false;
    logger.warn('Legacy swarm start ignored: simulated swarm authority is retired', {
      component: 'LegacySwarmOrchestrator',
    });
  }

  /** Safe for the global kill switch and historical shutdown callers. */
  async stop(): Promise<void> {
    this.isRunning = false;
  }

  async emergencyDecommission(): Promise<void> {
    this.isRunning = false;
  }

  getStatistics(): any {
    return {
      isRunning: false,
      authority: 'compatibility_only',
      cainCrawlers: {
        total: 0,
        original: 0,
        cataclysm: 0,
        reaper: 0,
        details: [],
      },
      microCrawlers: {
        total: 0,
        byMode: { micro: 0, full: 0 },
        byStatus: { idle: 0, scanning: 0, executing: 0, growing: 0, shrinking: 0 },
        details: [],
      },
      metrics: {
        totalProfit: 0,
        avgProfitPerCrawler: 0,
      },
    };
  }
}

export const swarmOrchestrator = new SwarmOrchestrator();
