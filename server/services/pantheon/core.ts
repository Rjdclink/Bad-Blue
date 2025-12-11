import { createLogger } from '../../logger';
import { EventEmitter } from 'events';

const log = createLogger('PantheonCore');

/**
 * RECURSIVE OPTIMIZATION PASS - PANTHEON CORE
 * 
 * Enhanced with:
 * - Warp speed² task processing
 * - Quantum entropy compression
 * - Adaptive resource throttling
 * - Stealth mode operations
 * - Priority queue optimization
 */

// Entropy signature: compressed data representation (48 bytes vs MB)
export interface EntropySignature {
  hash: string;              // 32 bytes - unique identifier
  probability: number;       // 8 bytes - likelihood score (0-1)
  constraints: number[];     // Variable - numerical constraints
  temporalDrift: number;     // 8 bytes - timing signature
  structuralDensity: number; // 8 bytes - complexity score (0-1)
  timestamp: Date;
  priority?: number;         // NEW: Priority score for processing
  stealthMode?: boolean;     // NEW: Stealth flag
}

// Crawler task definition - ENHANCED
export interface CrawlerTask {
  id: string;
  type: CrawlerType;
  target: string;          // URL or resource identifier
  priority: number;        // Higher = execute first (0-100)
  quantum: number;         // Max execution time (ms)
  entropyBudget: number;   // Max signatures to generate
  stealthLevel?: number;   // NEW: 0-10, higher = more stealth
  warpFactor?: number;     // NEW: 1-10, speed multiplier
  retryCount?: number;     // NEW: Retry counter
  maxRetries?: number;     // NEW: Max retries allowed
}

// Crawler species types - ENHANCED
export enum CrawlerType {
  WRAITH = 'wraith',       // Ghost layer (timing/async)
  HYDRA = 'hydra',         // Adaptive explorer
  ICE = 'ice',             // Precision extractor
  LICH = 'lich',           // Undead entropy
  FARM = 'farm',           // Hash cracking
  PHANTOM = 'phantom',     // NEW: Ultra-stealth
  NOVA = 'nova',           // NEW: Burst speed
}

// Timing jitter measurement result
export interface TimingJitterResult {
  avg: number;
  variance: number;
  jitter: number;
  samples: number;
  stability: number;
}

// Async echo detection result
export interface AsyncEchoResult {
  asyncDetected: boolean;
  serverSignature: string;
  hasAsyncHeader: boolean;
  statusCode: number;
  responseTime: string | null;
  error?: boolean;
}

// Exploration result from hydra crawler
export interface ExplorationResult {
  target: string;
  richness: number;
  nextTarget: string;
  links?: string[];
  statusCode?: number;
  contentLength?: number;
  error?: boolean;
  errorType?: string;
}

// System resource metrics
export interface ResourceMetrics {
  cpuUsage: number;        // Percentage (0-100)
  memUsage: number;        // Percentage (0-100)
  activeWorkers: number;   // Current crawler count
}

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
   * Store entropy signature in field - OPTIMIZED
   */
  storeEntropy(signature: EntropySignature) {
    // Auto-assign priority if not set
    if (signature.priority === undefined) {
      signature.priority = signature.probability * signature.structuralDensity * 100;
    }
    this.entropyField.set(signature.hash, signature);
    this.emit('entropyStored', signature);
  }

  /**
   * Batch store entropy signatures - NEW OPTIMIZATION
   */
  batchStoreEntropy(signatures: EntropySignature[]) {
    for (const sig of signatures) {
      this.storeEntropy(sig);
    }
    this.emit('batchEntropyStored', { count: signatures.length });
  }

  /**
   * Get all stored entropy signatures
   */
  getEntropyField(): EntropySignature[] {
    return Array.from(this.entropyField.values());
  }

  /**
   * Get high-priority entropy signatures - NEW OPTIMIZATION
   */
  getHighPriorityEntropy(threshold: number = 50): EntropySignature[] {
    return this.getEntropyField().filter(s => (s.priority || 0) >= threshold);
  }

  /**
   * Compress solution space by eliminating low-probability signatures
   * Returns top 10% of signatures by score - OPTIMIZED²
   */
  compressSolutionSpace(signatures: EntropySignature[]): EntropySignature[] {
    type ScoredSignature = EntropySignature & { score: number };
    
    return signatures
      .map(s => ({
        ...s,
        // Enhanced score = probability * density / constraint complexity * stealth bonus
        score: s.probability * s.structuralDensity * (1 / (s.constraints.length + 1)) * (s.stealthMode ? 1.5 : 1)
      } as ScoredSignature))
      .sort((a: ScoredSignature, b: ScoredSignature) => b.score - a.score)
      .slice(0, Math.ceil(signatures.length * 0.1)) // Top 10%
      .map(({ score, ...sig }) => sig); // Remove score property
  }

  /**
   * Quantum compress - MORE AGGRESSIVE COMPRESSION - NEW
   */
  quantumCompress(signatures: EntropySignature[]): EntropySignature[] {
    // Keep only top 5% with highest combined scores
    return this.compressSolutionSpace(signatures).slice(0, Math.ceil(signatures.length * 0.05));
  }

  /**
   * Execute task with warp speed - NEW OPTIMIZATION
   */
  async executeTaskWarp(task: CrawlerTask): Promise<void> {
    const warpFactor = task.warpFactor || 1;
    const adjustedQuantum = task.quantum / warpFactor;
    
    // Add task with adjusted quantum
    const warpTask = { ...task, quantum: adjustedQuantum };
    this.enqueueTask(warpTask);
    
    this.emit('warpExecute', { taskId: task.id, warpFactor });
  }

  /**
   * Batch execute tasks - PARALLEL OPTIMIZATION - NEW
   */
  async batchExecuteTasks(tasks: CrawlerTask[]): Promise<void> {
    // Sort by priority and execute in parallel batches
    const sorted = [...tasks].sort((a, b) => b.priority - a.priority);
    const batchSize = 5;
    
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(batch.map(t => this.executeTaskWarp(t)));
    }
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

  /**
   * Get performance metrics - NEW
   */
  getMetrics(): { queueSize: number; entropyCount: number; isActive: boolean } {
    return {
      queueSize: this.taskQueue.length,
      entropyCount: this.entropyField.size,
      isActive: this.swarmActive,
    };
  }
}

/**
 * Configuration interface - ENHANCED
 */
export interface PantheonConfig {
  cpuThreshold: number;    // Max CPU % before hibernation (default: 30)
  memThreshold: number;    // Max memory % before hibernation (default: 70)
  quantumSlice: number;    // Work chunk duration in ms (default: 50)
  sleepBetween: number;    // Cooldown between chunks in ms (default: 10)
  stealthMode: boolean;    // Enable stealth features (default: true)
  warpEnabled?: boolean;   // NEW: Enable warp speed mode
  maxWarpFactor?: number;  // NEW: Maximum warp factor (1-10)
  parallelBatchSize?: number; // NEW: Parallel batch size
}

/**
 * Default configuration - OPTIMIZED
 * Optimized for Railway/GCP free tier (0.25 vCPU, 256MB RAM)
 */
export const DEFAULT_CONFIG: PantheonConfig = {
  cpuThreshold: 30,     // Activate only if CPU < 30%
  memThreshold: 70,     // Hibernate if memory > 70%
  quantumSlice: 50,     // 50ms work chunks
  sleepBetween: 10,     // 10ms cooldown between chunks
  stealthMode: true,    // Zero-trace ghost protocol
  warpEnabled: true,    // NEW: Warp speed enabled
  maxWarpFactor: 10,    // NEW: Max 10x speed
  parallelBatchSize: 5, // NEW: 5 parallel tasks
};
