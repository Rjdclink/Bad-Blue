// Swarm Orchestrator - Ultimate Hyper-Evolving Swarm Strategy
// Coordinates Cain crawlers, micro-crawlers, and Eden knowledge repository

import { randomUUID } from 'crypto';
import { eden, EdenService } from '../eden/service';
import { EDEN_CONFIG } from '../eden/config';
import { CainCrawler, type CainType } from './cain-crawler';
import { EnhancedMicroCrawler } from './enhanced-micro-crawler';
import { LuxSwarm } from '../core/lux-swarm';

export class SwarmOrchestrator {
  private cainCrawlers: Map<string, CainCrawler> = new Map();
  private microCrawlers: Map<string, EnhancedMicroCrawler> = new Map();
  private isRunning: boolean = false;
  private warmMicroReplicasPerCain: number = 3;

  constructor() {
    console.log('[SWARM] 🐝 Swarm Orchestrator initialized');
  }

  // Initialize the entire swarm
  async initialize(): Promise<void> {
    console.log('[SWARM] 🚀 Initializing Ultimate Hyper-Evolving Swarm...');

    // Initialize Eden first
    await eden.initialize();

    // Initialize Cain crawlers
    await this.initializeCainCrawlers();

    // Initialize warm micro-replica pools
    await this.initializeMicroReplicaPools();

    console.log('[SWARM] ✅ Swarm initialization complete');
    console.log(`[SWARM] 📊 ${this.cainCrawlers.size} Cain crawlers, ${this.microCrawlers.size} micro crawlers`);
  }

  // Initialize 10 Cain crawlers (5 cataclysm, 5 probability)
  private async initializeCainCrawlers(): Promise<void> {
    console.log('[SWARM] 🔧 Initializing Cain Crawlers...');

    // Create Cataclysm Detection Cains (5)
    for (let i = 0; i < EDEN_CONFIG.CATACLYSM_DETECTION_CAINS; i++) {
      const cainId = `cain-cataclysm-${i + 1}`;
      const cain = new CainCrawler(cainId, 'cataclysm_detection');
      this.cainCrawlers.set(cainId, cain);
    }

    // Create Probability Monitoring Cains (5)
    for (let i = 0; i < EDEN_CONFIG.PROBABILITY_MONITORING_CAINS; i++) {
      const cainId = `cain-probability-${i + 1}`;
      const cain = new CainCrawler(cainId, 'probability_monitoring');
      this.cainCrawlers.set(cainId, cain);
    }

    console.log(`[SWARM] ✅ Initialized ${this.cainCrawlers.size} Cain Crawlers`);
  }

  // Initialize warm micro-replica pools for each Cain
  private async initializeMicroReplicaPools(): Promise<void> {
    console.log('[SWARM] 🔧 Initializing warm micro-replica pools...');

    for (const [cainId, _] of this.cainCrawlers) {
      for (let i = 0; i < this.warmMicroReplicasPerCain; i++) {
        const micro = new EnhancedMicroCrawler(cainId, 'micro');
        this.microCrawlers.set(micro.id, micro);
      }
    }

    console.log(`[SWARM] ✅ Initialized ${this.microCrawlers.size} warm micro-replicas`);
  }

  // Start the swarm
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[SWARM] ⚠️ Swarm already running');
      return;
    }

    console.log('[SWARM] 🚀 Starting swarm operations...');
    this.isRunning = true;

    // Start all Cain crawlers in parallel
    const cainPromises = Array.from(this.cainCrawlers.values()).map(cain =>
      this.runCainLifecycle(cain)
    );

    // Start micro-crawler monitoring loop
    const microPromise = this.runMicroCrawlerLoop();

    // Start Eden pulse monitoring
    const edenPromise = this.runEdenPulseLoop();

    // Wait for all operations (they run indefinitely)
    await Promise.race([
      Promise.all(cainPromises),
      microPromise,
      edenPromise,
    ]);
  }

  // Run Cain lifecycle continuously
  private async runCainLifecycle(cain: CainCrawler): Promise<void> {
    console.log(`[SWARM] 🌱 Starting lifecycle for ${cain.id}`);

    while (this.isRunning) {
      try {
        await cain.lifecycle();

        // Brief pause between cycles
        await this.sleep(5000);
      } catch (error) {
        console.error(`[SWARM] ❌ Cain ${cain.id} lifecycle error:`, error);
        await this.sleep(10000); // Wait longer on error
      }
    }
  }

  // Run micro-crawler monitoring loop
  private async runMicroCrawlerLoop(): Promise<void> {
    console.log('[SWARM] 🐝 Starting micro-crawler monitoring loop...');

    while (this.isRunning) {
      try {
        // Run all micro-crawlers in parallel
        const crawlPromises = Array.from(this.microCrawlers.values()).map(micro =>
          micro.crawl().catch(err => {
            console.error(`[SWARM] ⚠️ Micro ${micro.id} error:`, err);
          })
        );

        await Promise.all(crawlPromises);

        // Check if need to spawn more micro-crawlers
        await this.checkForMicroExpansion();

        // Prune inactive micro-crawlers
        await this.pruneInactiveMicros();

        // Brief pause between cycles
        await this.sleep(1000);
      } catch (error) {
        console.error('[SWARM] ❌ Micro-crawler loop error::', error);
        await this.sleep(5000);
      }
    }
  }

  // Run Eden pulse monitoring loop
  private async runEdenPulseLoop(): Promise<void> {
    console.log('[SWARM] 💓 Starting Eden pulse monitoring...');

    while (this.isRunning) {
      try {
        // Check if Eden pulse needed
        const now = Date.now();
        const timeSinceLastPulse = now - eden['lastReturnPulse'];

        if (timeSinceLastPulse >= EDEN_CONFIG.EDEN_RETURN_INTERVAL_MS) {
          console.log('[SWARM] 💓 Eden pulse due, performing return pulse...');
          await eden.performReturnPulse();
        }

        // Wait 1 minute before next check
        await this.sleep(60000);
      } catch (error) {
        console.error('[SWARM] ❌ Eden pulse error:', error);
        await this.sleep(60000);
      }
    }
  }

  // Check if should spawn more micro-crawlers
  private async checkForMicroExpansion(): Promise<void> {
    const lux = LuxSwarm.observe();

    // Calculate opportunity density
    const totalCrawlers = this.microCrawlers.size;
    const opportunityCount = lux.opportunities.length;
    const density = opportunityCount / Math.max(totalCrawlers, 1);

    // Spawn more if high density
    if (density > EDEN_CONFIG.OPPS_PER_NODE_THRESHOLD * 1.5) {
      const spawnCount = Math.min(10, Math.floor(density));
      console.log(`[SWARM] 📈 High opportunity density (${density.toFixed(2)}), spawning ${spawnCount} micro-crawlers`);

      for (let i = 0; i < spawnCount; i++) {
        // Randomly assign to a Cain
        const cainIds = Array.from(this.cainCrawlers.keys());
        const randomCainId = cainIds[Math.floor(Math.random() * cainIds.length)];
        
        const micro = new EnhancedMicroCrawler(randomCainId, 'micro');
        this.microCrawlers.set(micro.id, micro);
      }
    }
  }

  // Prune inactive micro-crawlers to save resources
  private async pruneInactiveMicros(): Promise<void> {
    const now = Date.now();
    const pruneThreshold = EDEN_CONFIG.IDLE_LIMIT_MS * 2; // 10 minutes

    const toPrune: string[] = [];

    for (const [id, micro] of this.microCrawlers) {
      const state = micro.getState();
      
      // Prune if idle too long and no profit generated
      if (
        state.status === 'idle' &&
        state.mode === 'micro' &&
        state.profitGenerated === 0 &&
        now - state.lastActivity > pruneThreshold
      ) {
        toPrune.push(id);
      }
    }

    if (toPrune.length > 0) {
      console.log(`[SWARM] 🧹 Pruning ${toPrune.length} inactive micro-crawlers`);
      toPrune.forEach(id => this.microCrawlers.delete(id));
    }
  }

  // Stop the swarm
  async stop(): Promise<void> {
    console.log('[SWARM] 🛑 Stopping swarm operations...');
    this.isRunning = false;

    // Perform final Eden return pulse
    await eden.performReturnPulse();

    console.log('[SWARM] ✅ Swarm stopped');
  }

  // Emergency decommission
  async emergencyDecommission(): Promise<void> {
    console.log('[SWARM] 🚨 EMERGENCY DECOMMISSION INITIATED');

    // Stop all operations
    await this.stop();

    // Trigger Eden emergency decommission
    await eden.emergencyDecommission();

    // Clear all crawlers
    this.cainCrawlers.clear();
    this.microCrawlers.clear();

    console.log('[SWARM] ✅ Emergency decommission complete');
  }

  // Get swarm statistics
  getStatistics(): any {
    const cainStats = Array.from(this.cainCrawlers.values()).map(cain => ({
      id: cain.id,
      type: cain.type,
      status: cain.status,
      cycleCount: cain.cycleCount,
      lessonsCollected: cain.lessonsCollected.length,
    }));

    const microStats = Array.from(this.microCrawlers.values()).map(micro => {
      const state = micro.getState();
      return {
        id: state.id,
        mode: state.mode,
        status: state.status,
        profitGenerated: state.profitGenerated,
      };
    });

    const microsByMode = {
      micro: microStats.filter(m => m.mode === 'micro').length,
      full: microStats.filter(m => m.mode === 'full').length,
    };

    const microsByStatus = {
      idle: microStats.filter(m => m.status === 'idle').length,
      scanning: microStats.filter(m => m.status === 'scanning').length,
      executing: microStats.filter(m => m.status === 'executing').length,
      growing: microStats.filter(m => m.status === 'growing').length,
      shrinking: microStats.filter(m => m.status === 'shrinking').length,
    };

    const totalProfit = microStats.reduce((sum, m) => sum + m.profitGenerated, 0);

    return {
      isRunning: this.isRunning,
      cainCrawlers: {
        total: this.cainCrawlers.size,
        cataclysm: cainStats.filter(c => c.type === 'cataclysm_detection').length,
        probability: cainStats.filter(c => c.type === 'probability_monitoring').length,
        details: cainStats,
      },
      microCrawlers: {
        total: this.microCrawlers.size,
        byMode: microsByMode,
        byStatus: microsByStatus,
        details: microStats,
      },
      metrics: {
        totalProfit,
        avgProfitPerCrawler: totalProfit / Math.max(this.microCrawlers.size, 1),
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const swarmOrchestrator = new SwarmOrchestrator();
