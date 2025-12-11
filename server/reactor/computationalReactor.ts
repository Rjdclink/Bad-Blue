/**
 * 4Ji Computational Reactor (OPIF)
 * 
 * Central compute and optimization engine responsible for:
 * - Job scheduling and prioritization
 * - Resource monitoring (CPU, memory, rate limits)
 * - Monte Carlo training passes
 * - Crawler coordination
 * - Heat monitoring and throttling
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Types
export interface ReactorJob {
  id: string;
  type: 'monte_carlo' | 'crawler_training' | 'osint_sweep' | 'heatmap_update' | 'model_optimization' | 'batch_inference';
  payload: Record<string, unknown>;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;  // 1-10, higher = more urgent
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
}

export interface ReactorMetrics {
  jobId: string;
  cpuUsage: number;        // 0-100%
  memoryUsage: number;     // 0-100%
  requestsUsed: number;    // API requests consumed
  durationMs: number;
  scoreBefore: number;
  scoreAfter: number;
  improvementPercent: number;
}

export interface HeatMonitor {
  cpuUsage: number;
  memoryUsage: number;
  rateLimitUsage: number;
  jobQueueSize: number;
  activeJobs: number;
  throttleLevel: 'none' | 'light' | 'moderate' | 'heavy';
}

export interface MonteCarloConfig {
  passesPerCycle: number;
  scoringFunction: string;
  targetImprovement: number;
  maxIterations: number;
  cooldownMs: number;
}

export interface ReactorConfig {
  enabled: boolean;
  maxConcurrentJobs: number;
  maxJobsPerHour: number;
  monteCarloConfig: MonteCarloConfig;
  maintenanceWindow: { start: string; end: string };
  timezone: string;
}

// Default configuration
const DEFAULT_CONFIG: ReactorConfig = {
  enabled: true,
  maxConcurrentJobs: 3,
  maxJobsPerHour: 100,
  monteCarloConfig: {
    passesPerCycle: 10,
    scoringFunction: 'weighted_accuracy',
    targetImprovement: 5,  // 5%
    maxIterations: 1000,
    cooldownMs: 1000
  },
  maintenanceWindow: { start: '02:00', end: '04:00' },
  timezone: 'America/Chicago'
};

// Throttle thresholds
const THROTTLE_THRESHOLDS = {
  light: { cpu: 60, memory: 70, rateLimit: 50, queueSize: 20 },
  moderate: { cpu: 75, memory: 80, rateLimit: 70, queueSize: 50 },
  heavy: { cpu: 85, memory: 90, rateLimit: 85, queueSize: 100 }
};

export const reactorEvents = new EventEmitter();

class ComputationalReactor {
  private static instance: ComputationalReactor;
  private isInitialized: boolean = false;
  private config: ReactorConfig = DEFAULT_CONFIG;
  
  // Job management
  private jobQueue: ReactorJob[] = [];
  private activeJobs: Map<string, ReactorJob> = new Map();
  private jobHistory: ReactorJob[] = [];
  private metricsHistory: ReactorMetrics[] = [];
  
  // Resource tracking
  private heatMonitor: HeatMonitor = {
    cpuUsage: 0,
    memoryUsage: 0,
    rateLimitUsage: 0,
    jobQueueSize: 0,
    activeJobs: 0,
    throttleLevel: 'none'
  };
  
  // Intervals
  private jobProcessorInterval: NodeJS.Timeout | null = null;
  private heatMonitorInterval: NodeJS.Timeout | null = null;
  private jobsProcessedThisHour: number = 0;
  private lastHourReset: Date = new Date();

  private constructor() {}

  static getInstance(): ComputationalReactor {
    if (!ComputationalReactor.instance) {
      ComputationalReactor.instance = new ComputationalReactor();
    }
    return ComputationalReactor.instance;
  }

  async initialize(config?: Partial<ReactorConfig>): Promise<void> {
    if (this.isInitialized) return;

    console.log('[Reactor] Initializing Computational Reactor...');

    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // Start job processor
    this.startJobProcessor();
    
    // Start heat monitor
    this.startHeatMonitor();

    this.isInitialized = true;
    console.log('[Reactor] Computational Reactor initialized');
    reactorEvents.emit('reactor-initialized', { config: this.config });
  }

  /**
   * Submit a job to the reactor
   */
  async submitJob(
    type: ReactorJob['type'],
    payload: Record<string, unknown>,
    priority: number = 5,
    options: { maxRetries?: number; scheduledAt?: Date } = {}
  ): Promise<string> {
    const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
    
    const job: ReactorJob = {
      id: jobId,
      type,
      payload,
      status: 'pending',
      priority: Math.min(10, Math.max(1, priority)),
      scheduledAt: options.scheduledAt || new Date(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      createdAt: new Date()
    };

    this.jobQueue.push(job);
    this.sortJobQueue();
    
    this.updateHeatMonitor();

    console.log(`[Reactor] Job submitted: ${jobId} (type: ${type}, priority: ${priority})`);
    reactorEvents.emit('job-submitted', job);

    return jobId;
  }

  /**
   * Schedule a Monte Carlo optimization run
   */
  async scheduleMonteCarloRun(
    targetComponent: string,
    scoringFunction: (params: unknown) => Promise<number>,
    parameterSpace: Record<string, { min: number; max: number }>
  ): Promise<string> {
    const payload = {
      targetComponent,
      parameterSpace,
      config: this.config.monteCarloConfig
    };

    return this.submitJob('monte_carlo', payload, 7);
  }

  /**
   * Schedule a crawler training cycle
   */
  async scheduleCrawlerTraining(
    crawlerType: 'osint' | 'legal' | 'crypto' | 'gps',
    config: Record<string, unknown>
  ): Promise<string> {
    return this.submitJob('crawler_training', { crawlerType, config }, 5);
  }

  /**
   * Start the job processor
   */
  private startJobProcessor(): void {
    if (this.jobProcessorInterval) {
      clearInterval(this.jobProcessorInterval);
    }

    this.jobProcessorInterval = setInterval(async () => {
      await this.processNextJobs();
    }, 1000); // Check every second
  }

  /**
   * Process the next available jobs
   */
  private async processNextJobs(): Promise<void> {
    if (!this.config.enabled) return;

    // Check if we're in maintenance window
    if (this.isInMaintenanceWindow()) {
      return;
    }

    // Check hourly job limit
    this.checkHourlyReset();
    if (this.jobsProcessedThisHour >= this.config.maxJobsPerHour) {
      console.log('[Reactor] Hourly job limit reached');
      return;
    }

    // Check throttle level
    if (this.heatMonitor.throttleLevel === 'heavy') {
      console.log('[Reactor] Heavy throttle active, skipping job processing');
      return;
    }

    // Get jobs ready to run
    const readyJobs = this.jobQueue.filter(
      job => job.status === 'pending' && job.scheduledAt <= new Date()
    );

    // Calculate how many jobs we can run
    let slotsAvailable = this.config.maxConcurrentJobs - this.activeJobs.size;
    
    // Reduce slots based on throttle level
    if (this.heatMonitor.throttleLevel === 'moderate') {
      slotsAvailable = Math.max(1, Math.floor(slotsAvailable / 2));
    } else if (this.heatMonitor.throttleLevel === 'light') {
      slotsAvailable = Math.max(1, slotsAvailable - 1);
    }

    // Process jobs up to available slots
    const jobsToProcess = readyJobs.slice(0, slotsAvailable);
    
    for (const job of jobsToProcess) {
      this.executeJob(job);
    }
  }

  /**
   * Execute a single job
   */
  private async executeJob(job: ReactorJob): Promise<void> {
    // Remove from queue
    this.jobQueue = this.jobQueue.filter(j => j.id !== job.id);
    
    // Update status
    job.status = 'running';
    job.startedAt = new Date();
    this.activeJobs.set(job.id, job);
    
    this.updateHeatMonitor();
    reactorEvents.emit('job-started', job);

    console.log(`[Reactor] Executing job: ${job.id} (type: ${job.type})`);

    try {
      const startTime = Date.now();
      const result = await this.runJobLogic(job);
      const duration = Date.now() - startTime;

      // Record metrics
      const metrics: ReactorMetrics = {
        jobId: job.id,
        cpuUsage: this.heatMonitor.cpuUsage,
        memoryUsage: this.heatMonitor.memoryUsage,
        requestsUsed: result.requestsUsed ?? 0,
        durationMs: duration,
        scoreBefore: result.scoreBefore ?? 0,
        scoreAfter: result.scoreAfter ?? 0,
        improvementPercent: result.improvementPercent ?? 0
      };
      this.metricsHistory.push(metrics);

      // Keep only last 1000 metrics
      if (this.metricsHistory.length > 1000) {
        this.metricsHistory = this.metricsHistory.slice(-1000);
      }

      // Complete job
      job.status = 'completed';
      job.finishedAt = new Date();
      
      console.log(`[Reactor] Job completed: ${job.id} (duration: ${duration}ms)`);
      reactorEvents.emit('job-completed', { job, metrics, result });

    } catch (error: any) {
      console.error(`[Reactor] Job failed: ${job.id}`, error.message);
      
      job.errorMessage = error.message;
      
      // Check if we should retry
      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        job.status = 'pending';
        job.scheduledAt = new Date(Date.now() + 5000 * job.retryCount); // Exponential backoff
        this.jobQueue.push(job);
        this.sortJobQueue();
        console.log(`[Reactor] Job queued for retry: ${job.id} (attempt ${job.retryCount}/${job.maxRetries})`);
      } else {
        job.status = 'failed';
        job.finishedAt = new Date();
      }

      reactorEvents.emit('job-failed', { job, error: error.message });
    } finally {
      // Remove from active
      this.activeJobs.delete(job.id);
      
      // Add to history
      this.jobHistory.push(job);
      if (this.jobHistory.length > 1000) {
        this.jobHistory = this.jobHistory.slice(-1000);
      }

      this.jobsProcessedThisHour++;
      this.updateHeatMonitor();
    }
  }

  /**
   * Run the actual job logic based on type
   */
  private async runJobLogic(job: ReactorJob): Promise<{
    requestsUsed?: number;
    scoreBefore?: number;
    scoreAfter?: number;
    improvementPercent?: number;
    result?: unknown;
  }> {
    switch (job.type) {
      case 'monte_carlo':
        return this.runMonteCarloJob(job);
      case 'crawler_training':
        return this.runCrawlerTrainingJob(job);
      case 'osint_sweep':
        return this.runOsintSweepJob(job);
      case 'heatmap_update':
        return this.runHeatmapUpdateJob(job);
      case 'model_optimization':
        return this.runModelOptimizationJob(job);
      case 'batch_inference':
        return this.runBatchInferenceJob(job);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * Monte Carlo optimization job
   */
  private async runMonteCarloJob(job: ReactorJob): Promise<{
    requestsUsed: number;
    scoreBefore: number;
    scoreAfter: number;
    improvementPercent: number;
  }> {
    const config = job.payload.config as MonteCarloConfig;
    const passCount = config.passesPerCycle;
    
    let scoreBefore = 50; // Baseline
    let scoreAfter = 50;
    let requestsUsed = 0;

    // Simulate Monte Carlo passes
    for (let i = 0; i < passCount; i++) {
      // Add small random improvement per pass
      const improvement = Math.random() * 2 - 0.5; // -0.5 to +1.5
      scoreAfter = Math.min(100, Math.max(0, scoreAfter + improvement));
      requestsUsed++;
      
      // Cooldown between passes
      await this.sleep(config.cooldownMs);
    }

    const improvementPercent = ((scoreAfter - scoreBefore) / scoreBefore) * 100;

    return { requestsUsed, scoreBefore, scoreAfter, improvementPercent };
  }

  /**
   * Crawler training job
   */
  private async runCrawlerTrainingJob(job: ReactorJob): Promise<{
    requestsUsed: number;
    scoreBefore: number;
    scoreAfter: number;
    improvementPercent: number;
  }> {
    const crawlerType = job.payload.crawlerType as string;
    
    console.log(`[Reactor] Training crawler: ${crawlerType}`);
    
    // Simulate training
    await this.sleep(2000);

    return {
      requestsUsed: 10,
      scoreBefore: 70,
      scoreAfter: 75,
      improvementPercent: 7.14
    };
  }

  /**
   * OSINT sweep job
   */
  private async runOsintSweepJob(job: ReactorJob): Promise<{ requestsUsed: number }> {
    console.log('[Reactor] Running OSINT sweep');
    await this.sleep(3000);
    return { requestsUsed: 25 };
  }

  /**
   * Heatmap update job
   */
  private async runHeatmapUpdateJob(job: ReactorJob): Promise<{ requestsUsed: number }> {
    console.log('[Reactor] Updating heatmaps');
    await this.sleep(1500);
    return { requestsUsed: 5 };
  }

  /**
   * Model optimization job
   */
  private async runModelOptimizationJob(job: ReactorJob): Promise<{
    scoreBefore: number;
    scoreAfter: number;
    improvementPercent: number;
  }> {
    console.log('[Reactor] Optimizing model');
    await this.sleep(5000);
    
    const scoreBefore = 80;
    const scoreAfter = 83;
    
    return {
      scoreBefore,
      scoreAfter,
      improvementPercent: ((scoreAfter - scoreBefore) / scoreBefore) * 100
    };
  }

  /**
   * Batch inference job
   */
  private async runBatchInferenceJob(job: ReactorJob): Promise<{ requestsUsed: number; result: unknown }> {
    const items = (job.payload.items as unknown[]) || [];
    console.log(`[Reactor] Running batch inference on ${items.length} items`);
    
    await this.sleep(items.length * 100);
    
    return {
      requestsUsed: items.length,
      result: { processedCount: items.length, status: 'complete' }
    };
  }

  /**
   * Start heat monitoring
   */
  private startHeatMonitor(): void {
    if (this.heatMonitorInterval) {
      clearInterval(this.heatMonitorInterval);
    }

    this.heatMonitorInterval = setInterval(() => {
      this.updateHeatMonitor();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Update heat monitor readings
   */
  private updateHeatMonitor(): void {
    // Get system metrics
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    this.heatMonitor.cpuUsage = Math.min(100, Math.random() * 30 + 20); // Simulated
    this.heatMonitor.memoryUsage = Math.min(100, heapUsedPercent);
    this.heatMonitor.rateLimitUsage = Math.min(100, (this.jobsProcessedThisHour / this.config.maxJobsPerHour) * 100);
    this.heatMonitor.jobQueueSize = this.jobQueue.length;
    this.heatMonitor.activeJobs = this.activeJobs.size;

    // Determine throttle level
    this.heatMonitor.throttleLevel = this.calculateThrottleLevel();

    reactorEvents.emit('heat-update', this.heatMonitor);
  }

  /**
   * Calculate throttle level based on current metrics
   */
  private calculateThrottleLevel(): HeatMonitor['throttleLevel'] {
    const { cpuUsage, memoryUsage, rateLimitUsage, jobQueueSize } = this.heatMonitor;

    if (
      cpuUsage >= THROTTLE_THRESHOLDS.heavy.cpu ||
      memoryUsage >= THROTTLE_THRESHOLDS.heavy.memory ||
      rateLimitUsage >= THROTTLE_THRESHOLDS.heavy.rateLimit ||
      jobQueueSize >= THROTTLE_THRESHOLDS.heavy.queueSize
    ) {
      return 'heavy';
    }

    if (
      cpuUsage >= THROTTLE_THRESHOLDS.moderate.cpu ||
      memoryUsage >= THROTTLE_THRESHOLDS.moderate.memory ||
      rateLimitUsage >= THROTTLE_THRESHOLDS.moderate.rateLimit ||
      jobQueueSize >= THROTTLE_THRESHOLDS.moderate.queueSize
    ) {
      return 'moderate';
    }

    if (
      cpuUsage >= THROTTLE_THRESHOLDS.light.cpu ||
      memoryUsage >= THROTTLE_THRESHOLDS.light.memory ||
      rateLimitUsage >= THROTTLE_THRESHOLDS.light.rateLimit ||
      jobQueueSize >= THROTTLE_THRESHOLDS.light.queueSize
    ) {
      return 'light';
    }

    return 'none';
  }

  /**
   * Check if we're in maintenance window
   */
  private isInMaintenanceWindow(): boolean {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    return currentTime >= this.config.maintenanceWindow.start && 
           currentTime <= this.config.maintenanceWindow.end;
  }

  /**
   * Check and reset hourly job counter
   */
  private checkHourlyReset(): void {
    const now = new Date();
    const hourDiff = (now.getTime() - this.lastHourReset.getTime()) / (1000 * 60 * 60);
    
    if (hourDiff >= 1) {
      this.jobsProcessedThisHour = 0;
      this.lastHourReset = now;
    }
  }

  /**
   * Sort job queue by priority (higher first) and scheduled time
   */
  private sortJobQueue(): void {
    this.jobQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): ReactorJob | undefined {
    return this.activeJobs.get(jobId) || 
           this.jobQueue.find(j => j.id === jobId) ||
           this.jobHistory.find(j => j.id === jobId);
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    const queueIndex = this.jobQueue.findIndex(j => j.id === jobId);
    if (queueIndex >= 0) {
      const job = this.jobQueue[queueIndex];
      job.status = 'cancelled';
      job.finishedAt = new Date();
      this.jobQueue.splice(queueIndex, 1);
      this.jobHistory.push(job);
      reactorEvents.emit('job-cancelled', job);
      return true;
    }
    return false;
  }

  /**
   * Get current heat monitor state
   */
  getHeatMonitor(): HeatMonitor {
    return { ...this.heatMonitor };
  }

  /**
   * Get reactor status
   */
  getStatus(): {
    enabled: boolean;
    activeJobs: number;
    queuedJobs: number;
    jobsProcessedThisHour: number;
    throttleLevel: string;
    heatMonitor: HeatMonitor;
  } {
    return {
      enabled: this.config.enabled,
      activeJobs: this.activeJobs.size,
      queuedJobs: this.jobQueue.length,
      jobsProcessedThisHour: this.jobsProcessedThisHour,
      throttleLevel: this.heatMonitor.throttleLevel,
      heatMonitor: { ...this.heatMonitor }
    };
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(limit: number = 100): ReactorMetrics[] {
    return this.metricsHistory.slice(-limit);
  }

  /**
   * Enable/disable reactor
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[Reactor] ${enabled ? 'Enabled' : 'Disabled'}`);
    reactorEvents.emit('reactor-state-change', { enabled });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReactorConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[Reactor] Configuration updated');
    reactorEvents.emit('config-updated', this.config);
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[Reactor] Shutting down...');

    if (this.jobProcessorInterval) {
      clearInterval(this.jobProcessorInterval);
      this.jobProcessorInterval = null;
    }

    if (this.heatMonitorInterval) {
      clearInterval(this.heatMonitorInterval);
      this.heatMonitorInterval = null;
    }

    // Cancel all queued jobs
    for (const job of this.jobQueue) {
      job.status = 'cancelled';
      job.finishedAt = new Date();
    }

    this.isInitialized = false;
    console.log('[Reactor] Shutdown complete');
    reactorEvents.emit('reactor-shutdown');
  }
}

// Export singleton
export const computationalReactor = ComputationalReactor.getInstance();

// Export functions
export async function initializeReactor(config?: Partial<ReactorConfig>): Promise<void> {
  await computationalReactor.initialize(config);
}

export async function submitJob(
  type: ReactorJob['type'],
  payload: Record<string, unknown>,
  priority?: number
): Promise<string> {
  return computationalReactor.submitJob(type, payload, priority);
}

export function getReactorStatus() {
  return computationalReactor.getStatus();
}

export function getHeatMonitor(): HeatMonitor {
  return computationalReactor.getHeatMonitor();
}

export async function shutdownReactor(): Promise<void> {
  await computationalReactor.shutdown();
}

export default computationalReactor;
