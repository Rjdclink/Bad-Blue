import { createLogger } from '../../logger';
import { EventEmitter } from 'events';

const log = createLogger('PantheonCore');

// Entropy signature: compressed data representation (48 bytes vs MB)
export interface EntropySignature {
  hash: string;              // 32 bytes - unique identifier
  probability: number;       // 8 bytes - likelihood score (0-1)
  constraints: number[];     // Variable - numerical constraints
  temporalDrift: number;     // 8 bytes - timing signature
  structuralDensity: number; // 8 bytes - complexity score (0-1)
  timestamp: Date;
}

// Crawler task definition
export interface CrawlerTask {
  id: string;
  type: CrawlerType;
  target: string;          // URL or resource identifier
  priority: number;        // Higher = execute first
  quantum: number;         // Max execution time (ms)
  entropyBudget: number;   // Max signatures to generate
}

// Crawler species types
export enum CrawlerType {
  WRAITH = 'wraith',       // Ghost layer (timing/async)
  HYDRA = 'hydra',         // Adaptive explorer
  ICE = 'ice',             // Precision extractor
  LICH = 'lich',           // Undead entropy
  FARM = 'farm'            // Hash cracking
}

// Timing jitter measurement result
export interface TimingJitterResult {
  avg?: number;
  variance: number;
  jitter: number;
  samples: number | number[];
  stability?: number;
  avgResponseTime?: number;
}

// Async echo detection result
export interface AsyncEchoResult {
  asyncDetected?: boolean;
  serverSignature?: string;
  hasAsyncHeader?: boolean;
  statusCode?: number;
  responseTime?: string | null;
  error?: boolean;
  echoCount?: number;
  echoSignatures?: string[];
  asyncDelay?: number;
}

// Exploration result from hydra crawler
export interface ExplorationResult {
  target?: string;
  richness?: number;
  nextTarget?: string;
  links?: string[];
  statusCode?: number;
  contentLength?: number;
  error?: boolean;
  errorType?: string;
  discovered?: string[];
  explored?: number;
  depth?: number;
  branches?: number;
}

// System resource metrics
export interface ResourceMetrics {
  cpuUsage: number;        // Percentage (0-100)
  memUsage: number;        // Percentage (0-100)
  activeWorkers: number;   // Current crawler count
}

// Extended result types for backward compatibility
// Note: Core interfaces are defined above (TimingJitterResult, AsyncEchoResult, ExplorationResult)
// These extended versions support additional optional fields used in various crawlers

/**
 * PANTHEON Core - The Brain
 * Manages crawlers, resources, and entropy field
 */
export class PantheonCore extends EventEmitter {
  private taskQueue: CrawlerTask[] = [];
  private entropyField: Map<string, EntropySignature> = new Map();
  private resourceMonitor: NodeJS.Timeout | null = null;
  private swarmActive = false;
  private lastCpuUsage: NodeJS.CpuUsage = { user: 0, system: 0 };

  constructor(private config: PantheonConfig) {
    super();
  }

  async initialize() {
    log.info('Pantheon Core initializing...', {
      cpuThreshold: this.config.cpuThreshold,
      quantumSlice: this.config.quantumSlice
    });
    
    this.startResourceMonitor();
    this.emit('initialized');
  }

  /**
   * Adaptive resource monitoring
   * Hibernates swarm if CPU > threshold
   * Activates swarm if CPU < threshold/2
   */
  private startResourceMonitor() {
    this.resourceMonitor = setInterval(async () => {
      const metrics = await this.getResourceMetrics();
      
      // Adaptive throttling
      if (metrics.cpuUsage > this.config.cpuThreshold) {
        this.hibernate();
      } else if (metrics.cpuUsage < this.config.cpuThreshold * 0.5 && !this.swarmActive) {
        this.activate();
      }
      
      this.emit('metrics', metrics);
    }, 1000);
  }

  /**
   * Get current resource usage
   */
  private async getResourceMetrics(): Promise<ResourceMetrics> {
    const usage = process.cpuUsage(this.lastCpuUsage);
    const mem = process.memoryUsage();
    
    // Calculate CPU percentage over the last interval
    // cpuUsage returns microseconds, so divide by interval (1000ms = 1,000,000μs) for percentage
    const cpuPercent = ((usage.user + usage.system) / 10000); // Approximation for 1s interval
    
    this.lastCpuUsage = process.cpuUsage();
    
    return {
      cpuUsage: Math.min(cpuPercent, 100), // Cap at 100%
      memUsage: mem.heapUsed / mem.heapTotal * 100,
      activeWorkers: this.taskQueue.length
    };
  }

  /**
   * Hibernate swarm (pause all crawlers)
   */
  hibernate() {
    if (this.swarmActive) {
      log.info('🌙 Hibernating swarm (resource conservation)');
      this.swarmActive = false;
      this.emit('hibernate');
    }
  }

  /**
   * Activate swarm (resume crawlers)
   */
  activate() {
    if (!this.swarmActive) {
      log.info('⚡ Activating swarm (resources available)');
      this.swarmActive = true;
      this.emit('activate');
    }
  }

  /**
   * Add task to priority queue
   */
  enqueueTask(task: CrawlerTask) {
    this.taskQueue.push(task);
    // Sort by priority (highest first)
    this.taskQueue.sort((a, b) => b.priority - a.priority);
    this.emit('taskQueued', task);
    log.info(`Task queued: ${task.type} -> ${task.target}`);
  }

  /**
   * Get next task from queue
   */
  dequeueTask(): CrawlerTask | undefined {
    return this.taskQueue.shift();
  }

  /**
   * Store entropy signature in field
   */
  storeEntropy(signature: EntropySignature) {
    this.entropyField.set(signature.hash, signature);
    this.emit('entropyStored', signature);
  }

  /**
   * Get all stored entropy signatures
   */
  getEntropyField(): EntropySignature[] {
    return Array.from(this.entropyField.values());
  }

  /**
   * Compress solution space by eliminating low-probability signatures
   * Returns top 10% of signatures by score
   */
  compressSolutionSpace(signatures: EntropySignature[]): EntropySignature[] {
    type ScoredSignature = EntropySignature & { score: number };
    
    return signatures
      .map(s => ({
        ...s,
        // Score = probability / constraint complexity
        score: s.probability * (1 / (s.constraints.length + 1))
      } as ScoredSignature))
      .sort((a: ScoredSignature, b: ScoredSignature) => b.score - a.score)
      .slice(0, Math.ceil(signatures.length * 0.1)) // Top 10%
      .map(({ score, ...sig }) => sig); // Remove score property
  }

  /**
   * Shutdown core and cleanup
   */
  shutdown() {
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }
    this.swarmActive = false;
    this.taskQueue = [];
    this.entropyField.clear();
    this.emit('shutdown');
    log.info('Pantheon Core shutdown complete');
  }

  /**
   * Get swarm status
   */
  isActive(): boolean {
    return this.swarmActive;
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.taskQueue.length;
  }
}

/**
 * Configuration interface
 */
export interface PantheonConfig {
  cpuThreshold: number;    // Max CPU % before hibernation (default: 30)
  memThreshold: number;    // Max memory % before hibernation (default: 70)
  quantumSlice: number;    // Work chunk duration in ms (default: 50)
  sleepBetween: number;    // Cooldown between chunks in ms (default: 10)
  stealthMode: boolean;    // Enable stealth features (default: true)
}

/**
 * Default configuration
 * Optimized for Railway/GCP free tier (0.25 vCPU, 256MB RAM)
 */
export const DEFAULT_CONFIG: PantheonConfig = {
  cpuThreshold: 30,     // Activate only if CPU < 30%
  memThreshold: 70,     // Hibernate if memory > 70%
  quantumSlice: 50,     // 50ms work chunks
  sleepBetween: 10,     // 10ms cooldown between chunks
  stealthMode: true     // Zero-trace ghost protocol
};
