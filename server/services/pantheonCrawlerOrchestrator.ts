/**
 * PANTHEON Crawler Orchestrator
 * 
 * Central orchestration system for all PANTHEON crawler functions.
 * Utilizes every aspect of the crawler systems as originally intended:
 * 
 * TRINITY CRAWLERS:
 * - Blizzard: Mass parallel scraping with unique fingerprints
 * - Cerberus: Three-headed adaptive defense system (Ice, Hydra, Zombie)
 * - Lich: Immortal necromancer with zombie army and ghost swarm
 * 
 * SPECIALIZED CRAWLERS:
 * - StarTrek: Federation explorer with warp drive and phasers
 * - BirdOfPrey: Klingon predator with perfect cloaking
 * - SixDegrees: Social graph mapper for relationship discovery
 * 
 * ADDITIONAL CRAWLERS:
 * - ICE: Stealthy intelligence crawler
 * - HYDRA: Multi-headed parallel crawler
 * - WRAITH: Ghost-mode stealth crawler
 * 
 * MUTUAL EXCLUSION:
 * - PANTHEON is NOT available when cryptocrawler system is running
 * - Resource contention is prevented through system state management
 * - AI providers are shared but crawler systems are exclusive
 * 
 * ZERO-API MODE:
 * - Crawlers operate independently of AI API availability
 * - Local intelligence engine provides analysis when APIs unavailable
 */

import { PhylacterySystem } from './storage/PhylacterySystem';
import { StealthInfrastructure } from './stealth/StealthInfrastructure';
import type { PantheonPrimaryCrawlerId } from './pantheon/PantheonCrawlerCapabilityMatrix';
import {
  createPantheonDeadline,
  pantheonAbortableDelay,
  racePantheonAbort,
  throwIfPantheonAborted,
} from './pantheon/PantheonDeadline';

// Crawler imports
import { 
  BlizzardCrawler, 
  CerberusCrawler, 
  LichCrawler 
} from './crawlers/TrinityCrawlers';
import { StarTrekCrawler } from './crawlers/StarTrekCrawler';
import { BirdOfPreyCrawler } from './crawlers/BirdOfPreyCrawler';
import { SixDegreesCrawler } from './crawlers/SixDegreesCrawler';

// ==================== SYSTEM STATE ====================

/**
 * System mode - determines which crawler system is active
 */
export enum SystemMode {
  PANTHEON = 'pantheon',
  CRYPTOCRAWLER = 'cryptocrawler',
  STANDBY = 'standby',
}

/**
 * Global system state for mutual exclusion
 */
interface SystemState {
  currentMode: SystemMode;
  modeStartTime: number;
  lastModeSwitch: number;
  panteonActive: boolean;
  cryptocrawlerActive: boolean;
  lockedBy?: string;
  lockExpiry?: number;
}

const systemState: SystemState = {
  currentMode: SystemMode.STANDBY,
  modeStartTime: Date.now(),
  lastModeSwitch: Date.now(),
  panteonActive: false,
  cryptocrawlerActive: false,
};

// ==================== MUTUAL EXCLUSION ====================

/**
 * Check if PANTHEON is available (not running cryptocrawler)
 */
export function isPantheonAvailable(): boolean {
  // PANTHEON is NOT available when cryptocrawler is active
  if (systemState.cryptocrawlerActive) {
    console.log('[PANTHEON] Unavailable - Cryptocrawler system is running');
    return false;
  }
  
  // Check for expired locks
  if (systemState.lockedBy && systemState.lockExpiry) {
    if (Date.now() > systemState.lockExpiry) {
      console.log('[PANTHEON] Lock expired, releasing');
      systemState.lockedBy = undefined;
      systemState.lockExpiry = undefined;
    } else if (systemState.lockedBy === 'cryptocrawler') {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if cryptocrawler is available (not running PANTHEON)
 */
export function isCryptocrawlerAvailable(): boolean {
  // Cryptocrawler is NOT available when PANTHEON is active
  if (systemState.panteonActive) {
    console.log('[CRYPTOCRAWLER] Unavailable - PANTHEON system is running');
    return false;
  }
  
  // Check for expired locks
  if (systemState.lockedBy && systemState.lockExpiry) {
    if (Date.now() > systemState.lockExpiry) {
      systemState.lockedBy = undefined;
      systemState.lockExpiry = undefined;
    } else if (systemState.lockedBy === 'pantheon') {
      return false;
    }
  }
  
  return true;
}

/**
 * Acquire system lock for exclusive access
 */
export function acquireSystemLock(system: 'pantheon' | 'cryptocrawler', durationMs: number = 300000): boolean {
  const now = Date.now();
  
  // Check for existing valid lock
  if (systemState.lockedBy && systemState.lockExpiry && now < systemState.lockExpiry) {
    if (systemState.lockedBy !== system) {
      console.log(`[SYSTEM] Lock denied - ${systemState.lockedBy} holds exclusive access until ${new Date(systemState.lockExpiry).toISOString()}`);
      return false;
    }
    // Extend existing lock
    systemState.lockExpiry = now + durationMs;
    return true;
  }
  
  // Acquire new lock
  systemState.lockedBy = system;
  systemState.lockExpiry = now + durationMs;
  systemState.currentMode = system === 'pantheon' ? SystemMode.PANTHEON : SystemMode.CRYPTOCRAWLER;
  systemState.modeStartTime = now;
  systemState.lastModeSwitch = now;
  
  if (system === 'pantheon') {
    systemState.panteonActive = true;
    systemState.cryptocrawlerActive = false;
  } else {
    systemState.panteonActive = false;
    systemState.cryptocrawlerActive = true;
  }
  
  console.log(`[SYSTEM] Lock acquired by ${system} for ${durationMs}ms`);
  return true;
}

/**
 * Release system lock
 */
export function releaseSystemLock(system: 'pantheon' | 'cryptocrawler'): boolean {
  if (systemState.lockedBy !== system) {
    console.log(`[SYSTEM] Cannot release lock - owned by ${systemState.lockedBy}, not ${system}`);
    return false;
  }
  
  systemState.lockedBy = undefined;
  systemState.lockExpiry = undefined;
  systemState.currentMode = SystemMode.STANDBY;
  systemState.lastModeSwitch = Date.now();
  systemState.panteonActive = false;
  systemState.cryptocrawlerActive = false;
  
  console.log(`[SYSTEM] Lock released by ${system}`);
  return true;
}

/**
 * Get current system status
 */
export function getSystemStatus(): SystemState & { available: { pantheon: boolean; cryptocrawler: boolean } } {
  return {
    ...systemState,
    available: {
      pantheon: isPantheonAvailable(),
      cryptocrawler: isCryptocrawlerAvailable(),
    },
  };
}

// ==================== PANTHEON CRAWLER ORCHESTRATOR ====================

/**
 * Crawler result from any PANTHEON crawler
 */
export interface CrawlerResult {
  crawler: string;
  target: string;
  content: string;
  confidence: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface CrawlerSourceOutcome {
  sourceUrl: string;
  status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
  retrievedAt: string;
  durationMs: number;
  error?: string;
  route?: 'primary' | 'fallback';
  fallbackFor?: string;
}

export interface CrawlerExecutionAudit {
  crawler: string;
  capabilityClass: 'primary';
  status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
  evidenceCount: number;
  attempts: number;
  targets: number;
  durationMs?: number;
  sourceOutcomes?: CrawlerSourceOutcome[];
  error?: string;
  route?: 'primary' | 'fallback';
  fallbackFor?: string;
}

/**
 * PANTHEON search options
 */
export interface PantheonSearchOptions {
  /** Search depth level (1-4) */
  depth: 1 | 2 | 3 | 4;
  /** Specific crawlers to use (default: all applicable) */
  crawlers?: PantheonPrimaryCrawlerId[];
  /** Maximum results per crawler */
  maxResultsPerCrawler?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable stealth mode */
  stealth?: boolean;
  /** Storm intensity for Blizzard crawler */
  stormIntensity?: 'flurry' | 'snow' | 'storm' | 'blizzard' | 'whiteout';
  signal?: AbortSignal;
  /** Preserve crawler failures for attributable per-capability audits. */
  strictErrors?: boolean;
}

/**
 * PANTHEON Crawler Orchestrator
 * 
 * Coordinates all crawler systems for comprehensive data gathering.
 */
export class PantheonCrawlerOrchestrator {
  private phylactery: PhylacterySystem;
  private stealth: StealthInfrastructure;
  
  // Crawler instances
  private blizzard: BlizzardCrawler | null = null;
  private cerberus: CerberusCrawler | null = null;
  private lich: LichCrawler | null = null;
  private startrek: StarTrekCrawler | null = null;
  private birdofprey: BirdOfPreyCrawler | null = null;
  private sixdegrees: SixDegreesCrawler | null = null;
  
  private initialized = false;
  
  constructor() {
    // Initialize infrastructure lazily
    this.phylactery = new PhylacterySystem();
    this.stealth = new StealthInfrastructure();
  }
  
  /**
   * Initialize all crawler systems
   */
  async initialize(lockDurationMs: number = 600000): Promise<void> {
    if (this.initialized) {
      acquireSystemLock('pantheon', Math.max(600000, lockDurationMs));
      return;
    }
    
    // Check if PANTHEON is available
    if (!isPantheonAvailable()) {
      throw new Error('PANTHEON unavailable - Cryptocrawler system is running');
    }
    
    // Acquire system lock
    if (!acquireSystemLock('pantheon', Math.max(600000, lockDurationMs))) {
      throw new Error('Failed to acquire system lock for PANTHEON');
    }
    
    console.log('[PANTHEON] Initializing crawler systems...');
    
    try {
      // Initialize Trinity Crawlers (require phylactery and stealth)
      this.blizzard = new BlizzardCrawler(this.phylactery, this.stealth);
      this.cerberus = new CerberusCrawler(this.phylactery, this.stealth);
      this.lich = new LichCrawler(this.phylactery, this.stealth);
      
      // Initialize Specialized Crawlers
      // StarTrekCrawler: No constructor arguments
      // BirdOfPreyCrawler, SixDegreesCrawler: Require stealth and phylactery
      this.startrek = new StarTrekCrawler();
      this.birdofprey = new BirdOfPreyCrawler(this.stealth, this.phylactery);
      this.sixdegrees = new SixDegreesCrawler(this.stealth, this.phylactery);
      
      this.initialized = true;
      console.log('[PANTHEON] All crawler systems initialized');
      console.log('[PANTHEON] Available crawlers: Blizzard, Cerberus, Lich, StarTrek, BirdOfPrey, SixDegrees');
    } catch (error) {
      releaseSystemLock('pantheon');
      throw error;
    }
  }
  
  /**
   * Shutdown PANTHEON and release resources
   */
  async shutdown(): Promise<void> {
    console.log('[PANTHEON] Shutting down crawler systems...');
    
    this.blizzard = null;
    this.cerberus = null;
    this.lich = null;
    this.startrek = null;
    this.birdofprey = null;
    this.sixdegrees = null;
    
    this.initialized = false;
    releaseSystemLock('pantheon');
    
    console.log('[PANTHEON] Shutdown complete');
  }
  
  /**
   * Execute comprehensive PANTHEON search
   */
  async search(targets: string[], options: PantheonSearchOptions): Promise<CrawlerResult[]> {
    throwIfPantheonAborted(options.signal);
    const requestedBudgetMs = Math.max(600000, options.timeout || 0);
    if (!this.initialized) {
      await this.initialize(requestedBudgetMs);
    } else {
      acquireSystemLock('pantheon', requestedBudgetMs);
    }
    
    const results: CrawlerResult[] = [];
    const crawlersToUse = options.crawlers || this.getCrawlersForDepth(options.depth);
    
    console.log(`[PANTHEON] Executing search with depth ${options.depth}`);
    console.log(`[PANTHEON] Targets: ${targets.length}, Crawlers: ${crawlersToUse.join(', ')}`);
    
    // Level 1: StarTrek (fast reconnaissance)
    if (crawlersToUse.includes('startrek') && this.startrek) {
      try {
        console.log('[PANTHEON] Activating STAR TREK crawler...');
        for (const target of targets) {
          throwIfPantheonAborted(options.signal);
          const result = await this.startrek.warpTo(target);
          if (result) {
            results.push({
              crawler: 'startrek',
              target,
              content: result.content || '',
              confidence: Number.isFinite(result.confidence) ? result.confidence : 0.7,
              timestamp: Date.now(),
              metadata: { warpFactor: result.metadata?.warpFactor || 5 },
            });
          }
        }
      } catch (error) {
        console.warn('[PANTHEON] StarTrek crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    // Level 2: BirdOfPrey (stealth reconnaissance)
    if (crawlersToUse.includes('birdofprey') && this.birdofprey) {
      try {
        console.log('[PANTHEON] Activating BIRD OF PREY crawler (cloaked)...');
        for (const target of targets) {
          throwIfPantheonAborted(options.signal);
          const result = await this.birdofprey.hunt(target);
          if (result) {
            results.push({
              crawler: 'birdofprey',
              target,
              content: result.content || '',
              confidence: Number.isFinite(result.confidence) ? result.confidence : 0.8,
              timestamp: Date.now(),
              metadata: { cloakStatus: 'engaged' },
            });
          }
        }
      } catch (error) {
        console.warn('[PANTHEON] BirdOfPrey crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    // Level 2+: SixDegrees (relationship mapping)
    if (crawlersToUse.includes('sixdegrees') && this.sixdegrees) {
      try {
        console.log('[PANTHEON] Activating SIX DEGREES crawler...');
        for (const target of targets) {
          throwIfPantheonAborted(options.signal);
          const graph = await this.sixdegrees.mapConnections(target, 2);
          if (graph) {
            results.push({
              crawler: 'sixdegrees',
              target,
              content: JSON.stringify(graph.nodes || []),
              confidence: 0.75,
              timestamp: Date.now(),
              metadata: { 
                nodeCount: graph.nodes?.length || 0,
                edgeCount: graph.edges?.length || 0,
                discoveredCandidates: (graph.nodes || [])
                  .map(node => node.domain)
                  .filter(Boolean)
                  .map(domain => `https://${domain}`)
                  .slice(0, 20),
              },
            });
          }
        }
      } catch (error) {
        console.warn('[PANTHEON] SixDegrees crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    // Level 3: Cerberus (triple-headed attack)
    if (crawlersToUse.includes('cerberus') && this.cerberus) {
      try {
        console.log('[PANTHEON] Activating CERBERUS crawler (three-headed)...');
        for (const target of targets) {
          throwIfPantheonAborted(options.signal);
          const result = await this.cerberus.attack(target);
          if (result) {
            results.push({
              crawler: 'cerberus',
              target,
              content: result.content || '',
              confidence: Number.isFinite(result.confidence) ? result.confidence : 0.85,
              timestamp: result.timestamp,
              metadata: { headUsed: result.headUsed },
            });
          }
        }
      } catch (error) {
        console.warn('[PANTHEON] Cerberus crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    // Level 3+: Blizzard (mass parallel scraping)
    if (crawlersToUse.includes('blizzard') && this.blizzard) {
      try {
        const intensity = options.stormIntensity || 'snow';
        console.log(`[PANTHEON] Activating BLIZZARD crawler (${intensity} intensity)...`);
        throwIfPantheonAborted(options.signal);
        const blizzardResults = await this.blizzard.deploy(targets, intensity);
        throwIfPantheonAborted(options.signal);
        for (const result of blizzardResults) {
          results.push({
            crawler: 'blizzard',
            target: result.target,
            content: result.content || '',
            confidence: Number.isFinite(result.confidence) ? result.confidence : 0.8,
            timestamp: result.timestamp,
            metadata: { intensity },
          });
        }
      } catch (error) {
        console.warn('[PANTHEON] Blizzard crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    // Level 4: Lich (necromancer with army)
    if (crawlersToUse.includes('lich') && this.lich) {
      try {
        console.log('[PANTHEON] Activating LICH crawler (forbidden magic)...');
        for (const target of targets) {
          throwIfPantheonAborted(options.signal);
          const spellType = options.depth >= 4 ? 'forbidden' : options.depth >= 3 ? 'complex' : 'simple';
          const result = await this.lich.castSpell(target, spellType);
          if (result) {
            results.push({
              crawler: 'lich',
              target,
              content: result.content || '',
              confidence: Number.isFinite(result.confidence) ? result.confidence : 0.9,
              timestamp: result.timestamp,
              metadata: { 
                spellType,
                lichStatus: this.lich.getStatus(),
              },
            });
          }
        }
      } catch (error) {
        console.warn('[PANTHEON] Lich crawler error:', error);
        if (options.strictErrors) throw error;
      }
    }
    
    console.log(`[PANTHEON] Search complete: ${results.length} results from ${new Set(results.map(r => r.crawler)).size} crawlers`);
    
    return results;
  }
  
  /**
   * Background-report fan-out: run each selected primary crawler as an
   * independent route so one failure or slow path cannot cancel the others.
   */
  async searchAllIsolatedWithAudit(
    targets: string[],
    options: PantheonSearchOptions,
  ): Promise<{ results: CrawlerResult[]; audit: CrawlerExecutionAudit[] }> {
    const requestedBudgetMs = Math.max(1_000, options.timeout || 60_000);
    throwIfPantheonAborted(options.signal);
    await this.initialize(requestedBudgetMs);

    const validTargets = [...new Set(targets)].filter(target => {
      try {
        const url = new URL(target);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    });
    const crawlersToUse = options.crawlers || this.getCrawlersForDepth(options.depth);
    const executions = await Promise.all(
      crawlersToUse.map(async crawler => {
        const executionStartedAt = Date.now();
        let attempts = 0;
        let results: CrawlerResult[] = [];
        let lastError = '';

        const routeBudgetMs = Math.max(1_000, Math.floor(requestedBudgetMs / 2));
        for (let attempt = 0; attempt < 2; attempt++) {
          attempts += 1;
          try {
            const routeDeadline = createPantheonDeadline(Date.now() + routeBudgetMs, options.signal);
            try {
              const searchPromise = this.search(validTargets, {
                ...options,
                timeout: routeBudgetMs,
                crawlers: [crawler],
                signal: routeDeadline.signal,
                strictErrors: true,
              });
              results = await racePantheonAbort(searchPromise, routeDeadline.signal);
            } finally {
              routeDeadline.dispose();
            }
            if (results.some(result => Boolean(result.content) && result.confidence > 0)) break;
            const reportedError = results.find(result => result.metadata?.error || result.metadata?.failed);
            if (reportedError) {
              lastError = String(reportedError.metadata?.error || 'Crawler reported an acquisition failure');
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }

          if (attempt === 0 && requestedBudgetMs > routeBudgetMs) {
            await pantheonAbortableDelay(250, options.signal);
          }
        }

        const evidenceCount = results.filter(result => Boolean(result.content) && result.confidence > 0).length;
        const durationMs = Date.now() - executionStartedAt;
        const sourceOutcomes: CrawlerSourceOutcome[] = validTargets.map(target => {
          const result = results.find(candidate => candidate.target === target);
          return {
            sourceUrl: target,
            status: result && result.content && result.confidence > 0
              ? 'completed_with_evidence'
              : /timed out/i.test(lastError)
                ? 'timed_out'
                : lastError
                  ? 'failed'
                  : 'completed_no_evidence',
            retrievedAt: new Date().toISOString(),
            durationMs,
            ...(lastError ? { error: lastError.slice(0, 300) } : {}),
          };
        });
        const audit: CrawlerExecutionAudit = {
          crawler,
          capabilityClass: 'primary',
          status: evidenceCount > 0
            ? 'completed_with_evidence'
            : /timed out/i.test(lastError)
              ? 'timed_out'
              : lastError
                ? 'failed'
                : 'completed_no_evidence',
          evidenceCount,
          attempts,
          targets: validTargets.length,
          durationMs,
          sourceOutcomes,
          route: 'primary',
          ...(lastError ? { error: lastError.slice(0, 300) } : {}),
        };

        return { results, audit };
      })
    );

    return {
      results: executions.flatMap(execution => execution.results),
      audit: executions.map(execution => execution.audit),
    };
  }

  async searchAllIsolated(targets: string[], options: PantheonSearchOptions): Promise<CrawlerResult[]> {
    return (await this.searchAllIsolatedWithAudit(targets, options)).results;
  }

  /**
   * Get appropriate crawlers based on search depth
   */
  private getCrawlersForDepth(depth: 1 | 2 | 3 | 4): PantheonPrimaryCrawlerId[] {
    switch (depth) {
      case 1:
        return ['startrek'];
      case 2:
        return ['startrek', 'birdofprey', 'sixdegrees'];
      case 3:
        return ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard'];
      case 4:
        return ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich'];
      default:
        return ['startrek'];
    }
  }
  
  /**
   * Execute avalanche mode (cascading data retrieval)
   */
  async avalanche(initialTarget: string): Promise<CrawlerResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!this.blizzard) {
      throw new Error('Blizzard crawler not initialized');
    }
    
    console.log('[PANTHEON] Triggering AVALANCHE mode...');
    const results = await this.blizzard.triggerAvalanche(initialTarget);
    
    return results.map(r => ({
      crawler: 'blizzard-avalanche',
      target: r.target,
      content: r.content || '',
      confidence: r.confidence || 0.8,
      timestamp: r.timestamp,
      metadata: { mode: 'avalanche' },
    }));
  }
  
  /**
   * Get crawler system status
   */
  getStatus(): {
    initialized: boolean;
    systemStatus: ReturnType<typeof getSystemStatus>;
    crawlers: Record<string, { available: boolean; status?: any }>;
  } {
    return {
      initialized: this.initialized,
      systemStatus: getSystemStatus(),
      crawlers: {
        blizzard: { available: !!this.blizzard },
        cerberus: { available: !!this.cerberus, status: this.cerberus?.getMetrics() },
        lich: { available: !!this.lich, status: this.lich?.getStatus() },
        startrek: { available: !!this.startrek },
        birdofprey: { available: !!this.birdofprey },
        sixdegrees: { available: !!this.sixdegrees },
      },
    };
  }
}

// ==================== SINGLETON INSTANCE ====================

export const pantheonOrchestrator = new PantheonCrawlerOrchestrator();

// ==================== CONVENIENCE FUNCTIONS ====================

/**
 * Quick PANTHEON search with automatic initialization
 */
export async function pantheonSearch(
  targets: string[],
  depth: 1 | 2 | 3 | 4 = 2
): Promise<CrawlerResult[]> {
  return pantheonOrchestrator.search(targets, { depth });
}

/**
 * Check if PANTHEON can be activated
 */
export function canActivatePantheon(): { available: boolean; reason?: string } {
  if (systemState.cryptocrawlerActive) {
    return { 
      available: false, 
      reason: 'Cryptocrawler system is currently active. PANTHEON will be available when cryptocrawler completes.' 
    };
  }
  
  if (systemState.lockedBy === 'cryptocrawler') {
    const remainingMs = (systemState.lockExpiry || 0) - Date.now();
    if (remainingMs > 0) {
      return { 
        available: false, 
        reason: `Cryptocrawler holds system lock for ${Math.ceil(remainingMs / 1000)} more seconds.` 
      };
    }
  }
  
  return { available: true };
}

/**
 * Notify PANTHEON that cryptocrawler is starting
 * This will make PANTHEON unavailable
 */
export function notifyCryptocrawlerStarting(): boolean {
  if (systemState.panteonActive) {
    console.log('[SYSTEM] Cannot start cryptocrawler - PANTHEON is active');
    return false;
  }
  
  return acquireSystemLock('cryptocrawler', 3600000); // 1 hour lock for cryptocrawler
}

/**
 * Notify PANTHEON that cryptocrawler has completed
 * This will make PANTHEON available again
 */
export function notifyCryptocrawlerComplete(): void {
  releaseSystemLock('cryptocrawler');
  console.log('[SYSTEM] Cryptocrawler complete - PANTHEON is now available');
}

console.log('[PANTHEON] Crawler Orchestrator module loaded');
console.log('[PANTHEON] System status:', getSystemStatus().currentMode);
