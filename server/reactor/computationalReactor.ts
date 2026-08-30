/**
 * 4Ji Computational Reactor (OPIF)
 *
 * Central measured compute and optimization engine responsible for:
 * - priority/age-aware job scheduling
 * - CPU, memory, queue and rate-budget pressure
 * - real scoring-function Monte Carlo optimization
 * - bounded crawler/model/inference executors
 * - adaptive concurrency and retry backoff
 *
 * The reactor never grants trade execution authority and never fabricates
 * optimization gains. Improvement metrics come from caller-supplied scorers.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import os from 'os';

export interface ReactorJob {
  id: string;
  type: 'monte_carlo' | 'crawler_training' | 'osint_sweep' | 'heatmap_update' | 'model_optimization' | 'batch_inference';
  payload: Record<string, unknown>;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
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
  cpuUsage: number;
  memoryUsage: number;
  requestsUsed: number;
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

type NumericParameterSpace = Record<string, { min: number; max: number }>;
type MonteCarloScorer = (params: Record<string, number>) => Promise<number> | number;
type ReactorExecutorResult = {
  requestsUsed?: number;
  scoreBefore?: number;
  scoreAfter?: number;
  improvementPercent?: number;
  result?: unknown;
};
type ReactorExecutor = (payload: Record<string, unknown>) => Promise<ReactorExecutorResult> | ReactorExecutorResult;

const DEFAULT_CONFIG: ReactorConfig = {
  enabled: true,
  maxConcurrentJobs: 3,
  maxJobsPerHour: 100,
  monteCarloConfig: {
    passesPerCycle: 10,
    scoringFunction: 'caller_supplied',
    targetImprovement: 5,
    maxIterations: 1000,
    cooldownMs: 0,
  },
  maintenanceWindow: { start: '02:00', end: '04:00' },
  timezone: 'America/Chicago',
};

const THROTTLE_THRESHOLDS = {
  light: { cpu: 60, memory: 70, rateLimit: 50, queueSize: 20 },
  moderate: { cpu: 75, memory: 80, rateLimit: 70, queueSize: 50 },
  heavy: { cpu: 85, memory: 90, rateLimit: 85, queueSize: 100 },
};

const MAX_QUEUE = Math.max(32, Math.min(10_000, Number(process.env.REACTOR_MAX_QUEUE || 1000)));
const MAX_MONTE_CARLO_BATCH = Math.max(1, Math.min(32, Number(process.env.REACTOR_MONTE_CARLO_BATCH || 8)));
const JOB_AGE_PRIORITY_MS = Math.max(5_000, Math.min(300_000, Number(process.env.REACTOR_JOB_AGE_PRIORITY_MS || 30_000)));

export const reactorEvents = new EventEmitter();

class ComputationalReactor {
  private static instance: ComputationalReactor;
  private isInitialized = false;
  private config: ReactorConfig = DEFAULT_CONFIG;
  private jobQueue: ReactorJob[] = [];
  private activeJobs = new Map<string, ReactorJob>();
  private jobHistory: ReactorJob[] = [];
  private metricsHistory: ReactorMetrics[] = [];
  private dedupeKeys = new Map<string, string>();
  private heatMonitor: HeatMonitor = {
    cpuUsage: 0,
    memoryUsage: 0,
    rateLimitUsage: 0,
    jobQueueSize: 0,
    activeJobs: 0,
    throttleLevel: 'none',
  };
  private jobProcessorInterval: NodeJS.Timeout | null = null;
  private heatMonitorInterval: NodeJS.Timeout | null = null;
  private jobsProcessedThisHour = 0;
  private lastHourReset = new Date();
  private previousCpu = process.cpuUsage();
  private previousCpuAt = process.hrtime.bigint();

  private constructor() {}

  static getInstance(): ComputationalReactor {
    if (!ComputationalReactor.instance) ComputationalReactor.instance = new ComputationalReactor();
    return ComputationalReactor.instance;
  }

  async initialize(config?: Partial<ReactorConfig>): Promise<void> {
    if (this.isInitialized) return;
    if (config) {
      this.config = {
        ...DEFAULT_CONFIG,
        ...config,
        monteCarloConfig: { ...DEFAULT_CONFIG.monteCarloConfig, ...(config.monteCarloConfig || {}) },
        maintenanceWindow: { ...DEFAULT_CONFIG.maintenanceWindow, ...(config.maintenanceWindow || {}) },
      };
    }
    this.startJobProcessor();
    this.startHeatMonitor();
    this.updateHeatMonitor();
    this.isInitialized = true;
    reactorEvents.emit('reactor-initialized', { config: this.config, syntheticScores: false, executionAuthority: false });
  }

  async submitJob(
    type: ReactorJob['type'],
    payload: Record<string, unknown>,
    priority = 5,
    options: { maxRetries?: number; scheduledAt?: Date; dedupeKey?: string } = {},
  ): Promise<string> {
    if (this.jobQueue.length >= MAX_QUEUE) throw new Error('REACTOR_QUEUE_CAPACITY_REACHED');
    const dedupeKey = options.dedupeKey?.trim();
    if (dedupeKey) {
      const existing = this.dedupeKeys.get(dedupeKey);
      if (existing && this.getJob(existing)) return existing;
    }

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
      maxRetries: Math.max(0, Math.min(10, options.maxRetries ?? 3)),
      createdAt: new Date(),
    };
    if (dedupeKey) {
      job.payload.__reactorDedupeKey = dedupeKey;
      this.dedupeKeys.set(dedupeKey, jobId);
    }
    this.jobQueue.push(job);
    this.sortJobQueue();
    this.updateHeatMonitor();
    reactorEvents.emit('job-submitted', job);
    return jobId;
  }

  async scheduleMonteCarloRun(
    targetComponent: string,
    scoringFunction: (params: unknown) => Promise<number>,
    parameterSpace: NumericParameterSpace,
  ): Promise<string> {
    if (typeof scoringFunction !== 'function') throw new Error('REACTOR_MONTE_CARLO_SCORER_REQUIRED');
    this.validateParameterSpace(parameterSpace);
    return this.submitJob('monte_carlo', {
      targetComponent,
      parameterSpace,
      scoringFunction: scoringFunction as MonteCarloScorer,
      config: this.config.monteCarloConfig,
    }, 7, { dedupeKey: `monte_carlo:${targetComponent}` });
  }

  async scheduleCrawlerTraining(
    crawlerType: 'osint' | 'legal' | 'crypto' | 'gps',
    config: Record<string, unknown>,
  ): Promise<string> {
    return this.submitJob('crawler_training', { crawlerType, config }, 5, { dedupeKey: `crawler_training:${crawlerType}` });
  }

  private startJobProcessor(): void {
    if (this.jobProcessorInterval) clearInterval(this.jobProcessorInterval);
    this.jobProcessorInterval = setInterval(() => void this.processNextJobs(), 250);
    this.jobProcessorInterval.unref?.();
  }

  private async processNextJobs(): Promise<void> {
    if (!this.config.enabled || this.isInMaintenanceWindow()) return;
    this.checkHourlyReset();
    if (this.jobsProcessedThisHour >= this.config.maxJobsPerHour) return;
    this.updateHeatMonitor();
    if (this.heatMonitor.throttleLevel === 'heavy') return;

    this.sortJobQueue();
    const readyJobs = this.jobQueue.filter(job => job.status === 'pending' && job.scheduledAt.getTime() <= Date.now());
    let slots = Math.max(0, this.config.maxConcurrentJobs - this.activeJobs.size);
    if (this.heatMonitor.throttleLevel === 'moderate') slots = Math.floor(slots / 2);
    else if (this.heatMonitor.throttleLevel === 'light') slots = Math.max(0, slots - 1);
    const hourlyRemaining = Math.max(0, this.config.maxJobsPerHour - this.jobsProcessedThisHour);
    for (const job of readyJobs.slice(0, Math.min(slots, hourlyRemaining))) void this.executeJob(job);
  }

  private async executeJob(job: ReactorJob): Promise<void> {
    this.jobQueue = this.jobQueue.filter(candidate => candidate.id !== job.id);
    job.status = 'running';
    job.startedAt = new Date();
    this.activeJobs.set(job.id, job);
    this.updateHeatMonitor();
    reactorEvents.emit('job-started', job);

    try {
      const started = Date.now();
      const result = await this.runJobLogic(job);
      const durationMs = Date.now() - started;
      const metrics: ReactorMetrics = {
        jobId: job.id,
        cpuUsage: this.heatMonitor.cpuUsage,
        memoryUsage: this.heatMonitor.memoryUsage,
        requestsUsed: result.requestsUsed ?? 0,
        durationMs,
        scoreBefore: result.scoreBefore ?? 0,
        scoreAfter: result.scoreAfter ?? 0,
        improvementPercent: result.improvementPercent ?? 0,
      };
      this.metricsHistory.push(metrics);
      if (this.metricsHistory.length > 1000) this.metricsHistory = this.metricsHistory.slice(-1000);
      job.status = 'completed';
      job.finishedAt = new Date();
      reactorEvents.emit('job-completed', { job, metrics, result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      job.errorMessage = message;
      if (job.retryCount < job.maxRetries) {
        job.retryCount += 1;
        job.status = 'pending';
        const backoff = Math.min(60_000, 1_000 * (2 ** (job.retryCount - 1)));
        job.scheduledAt = new Date(Date.now() + backoff);
        this.jobQueue.push(job);
        this.sortJobQueue();
      } else {
        job.status = 'failed';
        job.finishedAt = new Date();
      }
      reactorEvents.emit('job-failed', { job, error: message });
    } finally {
      this.activeJobs.delete(job.id);
      if (job.status !== 'pending') {
        this.releaseDedupe(job);
        this.jobHistory.push(job);
        if (this.jobHistory.length > 1000) this.jobHistory = this.jobHistory.slice(-1000);
      }
      this.jobsProcessedThisHour += 1;
      this.updateHeatMonitor();
    }
  }

  private async runJobLogic(job: ReactorJob): Promise<ReactorExecutorResult> {
    switch (job.type) {
      case 'monte_carlo': return this.runMonteCarloJob(job);
      case 'crawler_training': return this.runExecutorJob(job, 'trainer');
      case 'osint_sweep': return this.runExecutorJob(job, 'executor');
      case 'heatmap_update': return this.runExecutorJob(job, 'executor');
      case 'model_optimization': return this.runExecutorJob(job, 'optimizer');
      case 'batch_inference': return this.runBatchInferenceJob(job);
      default: throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async runMonteCarloJob(job: ReactorJob): Promise<ReactorExecutorResult> {
    const config = { ...this.config.monteCarloConfig, ...((job.payload.config || {}) as Partial<MonteCarloConfig>) };
    const parameterSpace = job.payload.parameterSpace as NumericParameterSpace;
    const scorer = job.payload.scoringFunction as MonteCarloScorer;
    if (typeof scorer !== 'function') throw new Error('REACTOR_MONTE_CARLO_SCORER_REQUIRED');
    this.validateParameterSpace(parameterSpace);

    const midpoint = Object.fromEntries(Object.entries(parameterSpace).map(([key, range]) => [key, (range.min + range.max) / 2]));
    const scoreBefore = this.requireFiniteScore(await scorer(midpoint));
    let bestScore = scoreBefore;
    let bestParameters = midpoint;
    let requestsUsed = 1;
    const passes = Math.max(1, Math.min(config.maxIterations, config.passesPerCycle));
    const target = Math.max(0, config.targetImprovement);

    for (let offset = 0; offset < passes; offset += MAX_MONTE_CARLO_BATCH) {
      if (this.heatMonitor.throttleLevel === 'heavy') break;
      const batchSize = Math.min(MAX_MONTE_CARLO_BATCH, passes - offset);
      const candidates = Array.from({ length: batchSize }, () => this.sampleParameters(parameterSpace));
      const scores = await Promise.all(candidates.map(candidate => Promise.resolve(scorer(candidate)).then(score => this.requireFiniteScore(score))));
      requestsUsed += scores.length;
      for (let index = 0; index < scores.length; index += 1) {
        if (scores[index] > bestScore) {
          bestScore = scores[index];
          bestParameters = candidates[index];
        }
      }
      const improvement = scoreBefore === 0 ? (bestScore > 0 ? 100 : 0) : ((bestScore - scoreBefore) / Math.abs(scoreBefore)) * 100;
      if (target > 0 && improvement >= target) break;
      if (config.cooldownMs > 0) await this.sleep(Math.min(5_000, config.cooldownMs));
    }

    const improvementPercent = scoreBefore === 0 ? (bestScore > 0 ? 100 : 0) : ((bestScore - scoreBefore) / Math.abs(scoreBefore)) * 100;
    return {
      requestsUsed,
      scoreBefore,
      scoreAfter: bestScore,
      improvementPercent,
      result: { bestParameters, measuredScorer: true, syntheticImprovement: false, executionAuthority: false },
    };
  }

  private async runExecutorJob(job: ReactorJob, key: 'trainer' | 'executor' | 'optimizer'): Promise<ReactorExecutorResult> {
    const executor = job.payload[key] as ReactorExecutor | undefined;
    if (typeof executor !== 'function') {
      return { requestsUsed: 0, result: { skipped: true, reason: `missing_${key}`, syntheticImprovement: false } };
    }
    return executor(job.payload);
  }

  private async runBatchInferenceJob(job: ReactorJob): Promise<ReactorExecutorResult> {
    const items = Array.isArray(job.payload.items) ? job.payload.items as unknown[] : [];
    const inference = job.payload.inferenceFunction as ((item: unknown) => Promise<unknown> | unknown) | undefined;
    if (typeof inference !== 'function') return { requestsUsed: 0, result: { processedCount: 0, skipped: true, reason: 'missing_inference_function' } };
    const concurrency = Math.max(1, Math.min(32, Number(job.payload.concurrency || 8)));
    const output: unknown[] = [];
    for (let offset = 0; offset < items.length; offset += concurrency) {
      if (this.heatMonitor.throttleLevel === 'heavy') break;
      output.push(...await Promise.all(items.slice(offset, offset + concurrency).map(item => inference(item))));
    }
    return { requestsUsed: output.length, result: { processedCount: output.length, output } };
  }

  private startHeatMonitor(): void {
    if (this.heatMonitorInterval) clearInterval(this.heatMonitorInterval);
    this.heatMonitorInterval = setInterval(() => this.updateHeatMonitor(), 1000);
    this.heatMonitorInterval.unref?.();
  }

  private updateHeatMonitor(): void {
    const nowCpu = process.cpuUsage();
    const nowAt = process.hrtime.bigint();
    const elapsedMicros = Number(nowAt - this.previousCpuAt) / 1000;
    const usedMicros = (nowCpu.user - this.previousCpu.user) + (nowCpu.system - this.previousCpu.system);
    const cpuCount = Math.max(1, os.cpus().length);
    const cpuUsage = elapsedMicros > 0 ? (usedMicros / elapsedMicros / cpuCount) * 100 : 0;
    this.previousCpu = nowCpu;
    this.previousCpuAt = nowAt;

    const memUsage = process.memoryUsage();
    const memoryUsage = memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0;
    this.heatMonitor.cpuUsage = Math.max(0, Math.min(100, cpuUsage));
    this.heatMonitor.memoryUsage = Math.max(0, Math.min(100, memoryUsage));
    this.heatMonitor.rateLimitUsage = Math.max(0, Math.min(100, (this.jobsProcessedThisHour / Math.max(1, this.config.maxJobsPerHour)) * 100));
    this.heatMonitor.jobQueueSize = this.jobQueue.length;
    this.heatMonitor.activeJobs = this.activeJobs.size;
    this.heatMonitor.throttleLevel = this.calculateThrottleLevel();
    reactorEvents.emit('heat-update', { ...this.heatMonitor, measuredCpu: true });
  }

  private calculateThrottleLevel(): HeatMonitor['throttleLevel'] {
    const { cpuUsage, memoryUsage, rateLimitUsage, jobQueueSize } = this.heatMonitor;
    if (cpuUsage >= THROTTLE_THRESHOLDS.heavy.cpu || memoryUsage >= THROTTLE_THRESHOLDS.heavy.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.heavy.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.heavy.queueSize) return 'heavy';
    if (cpuUsage >= THROTTLE_THRESHOLDS.moderate.cpu || memoryUsage >= THROTTLE_THRESHOLDS.moderate.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.moderate.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.moderate.queueSize) return 'moderate';
    if (cpuUsage >= THROTTLE_THRESHOLDS.light.cpu || memoryUsage >= THROTTLE_THRESHOLDS.light.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.light.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.light.queueSize) return 'light';
    return 'none';
  }

  private isInMaintenanceWindow(): boolean {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: this.config.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
    const currentTime = `${parts.hour}:${parts.minute}`;
    const { start, end } = this.config.maintenanceWindow;
    if (start === end) return false;
    return start < end ? currentTime >= start && currentTime <= end : currentTime >= start || currentTime <= end;
  }

  private checkHourlyReset(): void {
    const now = new Date();
    if (now.getTime() - this.lastHourReset.getTime() >= 3_600_000) {
      this.jobsProcessedThisHour = 0;
      this.lastHourReset = now;
    }
  }

  private sortJobQueue(): void {
    const now = Date.now();
    this.jobQueue.sort((a, b) => {
      const agedA = Math.min(10, a.priority + Math.floor((now - a.createdAt.getTime()) / JOB_AGE_PRIORITY_MS));
      const agedB = Math.min(10, b.priority + Math.floor((now - b.createdAt.getTime()) / JOB_AGE_PRIORITY_MS));
      return agedB - agedA || a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private validateParameterSpace(parameterSpace: NumericParameterSpace): void {
    const entries = Object.entries(parameterSpace || {});
    if (!entries.length) throw new Error('REACTOR_MONTE_CARLO_PARAMETER_SPACE_REQUIRED');
    for (const [name, range] of entries) {
      if (!Number.isFinite(range?.min) || !Number.isFinite(range?.max) || range.min > range.max) throw new Error(`REACTOR_INVALID_PARAMETER_RANGE:${name}`);
    }
  }

  private sampleParameters(parameterSpace: NumericParameterSpace): Record<string, number> {
    return Object.fromEntries(Object.entries(parameterSpace).map(([key, range]) => [key, range.min + Math.random() * (range.max - range.min)]));
  }

  private requireFiniteScore(score: number): number {
    if (!Number.isFinite(score)) throw new Error('REACTOR_NON_FINITE_SCORE');
    return score;
  }

  private releaseDedupe(job: ReactorJob): void {
    const key = typeof job.payload.__reactorDedupeKey === 'string' ? job.payload.__reactorDedupeKey : null;
    if (key && this.dedupeKeys.get(key) === job.id) this.dedupeKeys.delete(key);
  }

  private sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

  getJob(jobId: string): ReactorJob | undefined {
    return this.activeJobs.get(jobId) || this.jobQueue.find(job => job.id === jobId) || this.jobHistory.find(job => job.id === jobId);
  }

  cancelJob(jobId: string): boolean {
    const queueIndex = this.jobQueue.findIndex(job => job.id === jobId);
    if (queueIndex < 0) return false;
    const job = this.jobQueue[queueIndex];
    job.status = 'cancelled';
    job.finishedAt = new Date();
    this.jobQueue.splice(queueIndex, 1);
    this.releaseDedupe(job);
    this.jobHistory.push(job);
    reactorEvents.emit('job-cancelled', job);
    return true;
  }

  getHeatMonitor(): HeatMonitor { return { ...this.heatMonitor }; }

  getStatus() {
    return {
      enabled: this.config.enabled,
      activeJobs: this.activeJobs.size,
      queuedJobs: this.jobQueue.length,
      jobsProcessedThisHour: this.jobsProcessedThisHour,
      throttleLevel: this.heatMonitor.throttleLevel,
      heatMonitor: { ...this.heatMonitor },
    };
  }

  getRecentMetrics(limit = 100): ReactorMetrics[] { return this.metricsHistory.slice(-Math.max(0, limit)); }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    reactorEvents.emit('reactor-state-change', { enabled });
  }

  updateConfig(config: Partial<ReactorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      monteCarloConfig: { ...this.config.monteCarloConfig, ...(config.monteCarloConfig || {}) },
      maintenanceWindow: { ...this.config.maintenanceWindow, ...(config.maintenanceWindow || {}) },
    };
    reactorEvents.emit('config-updated', this.config);
  }

  async shutdown(): Promise<void> {
    if (this.jobProcessorInterval) clearInterval(this.jobProcessorInterval);
    if (this.heatMonitorInterval) clearInterval(this.heatMonitorInterval);
    this.jobProcessorInterval = null;
    this.heatMonitorInterval = null;
    for (const job of this.jobQueue) {
      job.status = 'cancelled';
      job.finishedAt = new Date();
      this.releaseDedupe(job);
    }
    this.jobQueue = [];
    this.isInitialized = false;
    reactorEvents.emit('reactor-shutdown');
  }
}

export const computationalReactor = ComputationalReactor.getInstance();

export async function initializeReactor(config?: Partial<ReactorConfig>): Promise<void> { await computationalReactor.initialize(config); }
export async function submitJob(type: ReactorJob['type'], payload: Record<string, unknown>, priority?: number): Promise<string> { return computationalReactor.submitJob(type, payload, priority); }
export function getReactorStatus() { return computationalReactor.getStatus(); }
export function getHeatMonitor(): HeatMonitor { return computationalReactor.getHeatMonitor(); }
export async function shutdownReactor(): Promise<void> { await computationalReactor.shutdown(); }
export default computationalReactor;
