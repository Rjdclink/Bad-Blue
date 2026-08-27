/**
 * 4Ji Computational Reactor (OPIF) - Quanti Comp compatibility facade.
 *
 * The Reactor keeps its public job/status/event contract while Quanti Comp owns
 * measured local scheduling, timeout enforcement, validation, and resource
 * telemetry. Legacy simulated executors are never reported as successful work.
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  QuantiCompError,
  quantiComp,
  type QuantiLane,
} from '../services/quantiComp/index.js';

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

export interface ReactorJobExecutionResult {
  requestsUsed?: number;
  scoreBefore?: number;
  scoreAfter?: number;
  improvementPercent?: number;
  result?: unknown;
}

export interface ReactorJobExecutorContext {
  signal: AbortSignal;
  executionId: string;
  workerId: string;
  startedAt: number;
}

export type ReactorJobExecutor = (
  job: ReactorJob,
  context: ReactorJobExecutorContext,
) => Promise<ReactorJobExecutionResult> | ReactorJobExecutionResult;

const DEFAULT_CONFIG: ReactorConfig = {
  enabled: true,
  maxConcurrentJobs: 3,
  maxJobsPerHour: 100,
  monteCarloConfig: {
    passesPerCycle: 10,
    scoringFunction: 'weighted_accuracy',
    targetImprovement: 5,
    maxIterations: 1000,
    cooldownMs: 1000,
  },
  maintenanceWindow: { start: '02:00', end: '04:00' },
  timezone: 'America/Chicago',
};

const THROTTLE_THRESHOLDS = {
  light: { cpu: 60, memory: 70, rateLimit: 50, queueSize: 20 },
  moderate: { cpu: 75, memory: 80, rateLimit: 70, queueSize: 50 },
  heavy: { cpu: 85, memory: 90, rateLimit: 85, queueSize: 100 },
};

const DEFAULT_JOB_TIMEOUT_MS = Math.max(1_000, Number(process.env.REACTOR_JOB_TIMEOUT_MS || 60_000));
const TELEMETRY_INTERVAL_MS = Math.max(1_000, Number(process.env.REACTOR_TELEMETRY_INTERVAL_MS || 5_000));
const MAX_HISTORY = 1000;
const HALTON_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

export const reactorEvents = new EventEmitter();

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isExecutionResult(value: unknown): value is ReactorJobExecutionResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as ReactorJobExecutionResult;
  return ['requestsUsed', 'scoreBefore', 'scoreAfter', 'improvementPercent'].every(key => {
    const candidate = result[key as keyof ReactorJobExecutionResult];
    return candidate === undefined || Number.isFinite(Number(candidate));
  });
}

function laneForPriority(priority: number): QuantiLane {
  if (priority >= 9) return 'ultra_hot';
  if (priority >= 7) return 'hot';
  if (priority >= 4) return 'warm';
  return 'batch';
}

function halton(index: number, base: number): number {
  let fraction = 1;
  let result = 0;
  let value = index;
  while (value > 0) {
    fraction /= base;
    result += fraction * (value % base);
    value = Math.floor(value / base);
  }
  return result;
}

function primeForDimension(index: number): number {
  if (index < HALTON_PRIMES.length) return HALTON_PRIMES[index];
  let candidate = HALTON_PRIMES[HALTON_PRIMES.length - 1] + 2;
  let found = HALTON_PRIMES.length;
  while (true) {
    let prime = true;
    for (let divisor = 3; divisor * divisor <= candidate; divisor += 2) {
      if (candidate % divisor === 0) { prime = false; break; }
    }
    if (prime) {
      if (found === index) return candidate;
      found += 1;
    }
    candidate += 2;
  }
}

class ComputationalReactor {
  private static instance: ComputationalReactor;
  private isInitialized = false;
  private config: ReactorConfig = DEFAULT_CONFIG;
  private jobQueue: ReactorJob[] = [];
  private activeJobs = new Map<string, ReactorJob>();
  private activeControllers = new Map<string, AbortController>();
  private jobExecutors = new Map<string, ReactorJobExecutor>();
  private typeExecutors = new Map<ReactorJob['type'], ReactorJobExecutor>();
  private jobHistory: ReactorJob[] = [];
  private metricsHistory: ReactorMetrics[] = [];
  private heatMonitor: HeatMonitor = {
    cpuUsage: 0,
    memoryUsage: 0,
    rateLimitUsage: 0,
    jobQueueSize: 0,
    activeJobs: 0,
    throttleLevel: 'none',
  };
  private processorTimer: NodeJS.Timeout | null = null;
  private processorDueAt: number | null = null;
  private telemetryInterval: NodeJS.Timeout | null = null;
  private processing = false;
  private jobsProcessedThisHour = 0;
  private lastHourReset = new Date();

  private constructor() {}

  static getInstance(): ComputationalReactor {
    if (!ComputationalReactor.instance) ComputationalReactor.instance = new ComputationalReactor();
    return ComputationalReactor.instance;
  }

  async initialize(config?: Partial<ReactorConfig>): Promise<void> {
    if (this.isInitialized) return;
    console.log('[Reactor] Initializing Quanti-backed Computational Reactor...');
    if (config) {
      this.config = {
        ...DEFAULT_CONFIG,
        ...config,
        monteCarloConfig: { ...DEFAULT_CONFIG.monteCarloConfig, ...(config.monteCarloConfig || {}) },
        maintenanceWindow: { ...DEFAULT_CONFIG.maintenanceWindow, ...(config.maintenanceWindow || {}) },
      };
    }
    this.isInitialized = true;
    this.startTelemetry();
    this.updateHeatMonitor();
    this.scheduleProcessing(0);
    console.log('[Reactor] Quanti-backed Computational Reactor initialized');
    reactorEvents.emit('reactor-initialized', { config: this.config, computeAuthority: 'quanti-comp' });
  }

  async submitJob(
    type: ReactorJob['type'],
    payload: Record<string, unknown>,
    priority = 5,
    options: { maxRetries?: number; scheduledAt?: Date; executor?: ReactorJobExecutor } = {},
  ): Promise<string> {
    const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
    const job: ReactorJob = {
      id: jobId,
      type,
      payload,
      status: 'pending',
      priority: Math.min(10, Math.max(1, finiteNumber(priority, 5))),
      scheduledAt: options.scheduledAt || new Date(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: Math.max(0, Math.floor(options.maxRetries ?? 3)),
      createdAt: new Date(),
    };
    if (options.executor) this.jobExecutors.set(jobId, options.executor);
    this.jobQueue.push(job);
    this.sortJobQueue();
    this.updateHeatMonitor();
    console.log(`[Reactor] Job submitted: ${jobId} (type: ${type}, priority: ${job.priority})`);
    reactorEvents.emit('job-submitted', job);
    this.scheduleProcessing(Math.max(0, job.scheduledAt.getTime() - Date.now()));
    return jobId;
  }

  async scheduleMonteCarloRun(
    targetComponent: string,
    scoringFunction: (params: unknown) => Promise<number>,
    parameterSpace: Record<string, { min: number; max: number }>,
  ): Promise<string> {
    const config = { ...this.config.monteCarloConfig };
    return this.submitJob('monte_carlo', { targetComponent, parameterSpace, config }, 7, {
      executor: (job, context) => this.runMeasuredMonteCarlo(job, scoringFunction, parameterSpace, config, context.signal),
    });
  }

  async scheduleCrawlerTraining(
    crawlerType: 'osint' | 'legal' | 'crypto' | 'gps',
    config: Record<string, unknown>,
  ): Promise<string> {
    return this.submitJob('crawler_training', { crawlerType, config }, 5);
  }

  registerExecutor(type: ReactorJob['type'], executor: ReactorJobExecutor): void {
    this.typeExecutors.set(type, executor);
    reactorEvents.emit('executor-registered', { type });
  }

  unregisterExecutor(type: ReactorJob['type']): boolean {
    const removed = this.typeExecutors.delete(type);
    if (removed) reactorEvents.emit('executor-unregistered', { type });
    return removed;
  }

  private scheduleProcessing(delayMs: number): void {
    if (!this.isInitialized || !this.config.enabled) return;
    const safeDelay = Math.max(0, Math.floor(delayMs));
    const dueAt = Date.now() + safeDelay;
    if (this.processorTimer && this.processorDueAt !== null && this.processorDueAt <= dueAt) return;
    if (this.processorTimer) clearTimeout(this.processorTimer);
    this.processorDueAt = dueAt;
    this.processorTimer = setTimeout(() => {
      this.processorTimer = null;
      this.processorDueAt = null;
      void this.processNextJobs();
    }, safeDelay);
  }

  private async processNextJobs(): Promise<void> {
    if (this.processing || !this.isInitialized || !this.config.enabled) return;
    this.processing = true;
    try {
      this.updateHeatMonitor();
      this.checkHourlyReset();
      if (this.isInMaintenanceWindow()) {
        this.scheduleProcessing(60_000);
        return;
      }
      if (this.jobsProcessedThisHour >= this.config.maxJobsPerHour) {
        const resetIn = Math.max(1_000, 60 * 60_000 - (Date.now() - this.lastHourReset.getTime()));
        this.scheduleProcessing(resetIn);
        return;
      }
      if (this.heatMonitor.throttleLevel === 'heavy') {
        this.scheduleProcessing(1_000);
        return;
      }

      let slotsAvailable = Math.max(0, this.config.maxConcurrentJobs - this.activeJobs.size);
      if (slotsAvailable <= 0) return;
      if (this.heatMonitor.throttleLevel === 'moderate') slotsAvailable = Math.max(1, Math.floor(slotsAvailable / 2));
      else if (this.heatMonitor.throttleLevel === 'light') slotsAvailable = Math.max(1, slotsAvailable - 1);

      const now = Date.now();
      const readyJobs = this.jobQueue
        .filter(job => job.status === 'pending' && job.scheduledAt.getTime() <= now)
        .slice(0, slotsAvailable);
      for (const job of readyJobs) void this.executeJob(job);

      const future = this.jobQueue
        .filter(job => job.status === 'pending')
        .map(job => job.scheduledAt.getTime())
        .sort((a, b) => a - b)[0];
      if (future !== undefined && readyJobs.length === 0) this.scheduleProcessing(Math.max(1, future - Date.now()));
    } finally {
      this.processing = false;
    }
  }

  private async executeJob(job: ReactorJob): Promise<void> {
    this.jobQueue = this.jobQueue.filter(candidate => candidate.id !== job.id);
    job.status = 'running';
    job.startedAt = new Date();
    job.errorMessage = null;
    this.activeJobs.set(job.id, job);
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);
    this.updateHeatMonitor();
    reactorEvents.emit('job-started', job);
    console.log(`[Reactor] Executing through Quanti Comp: ${job.id} (type: ${job.type})`);

    try {
      const executor = this.jobExecutors.get(job.id) || this.typeExecutors.get(job.type);
      if (!executor) throw new Error(`REACTOR_EXECUTOR_UNAVAILABLE: ${job.type}`);
      const timeoutMs = Math.max(1_000, optionalFinite(job.payload.timeoutMs) ?? DEFAULT_JOB_TIMEOUT_MS);
      const usefulWorkUnits = this.usefulWorkUnits(job);
      const quantiResult = await quantiComp.submit({
        id: `reactor:${job.id}:attempt:${job.retryCount}`,
        kind: `reactor.${job.type}`,
        lane: laneForPriority(job.priority),
        priority: job.priority * 10,
        createdAt: job.createdAt.getTime(),
        input: job,
        features: {
          reactorPriority: job.priority,
          retryCount: job.retryCount,
          queueDepth: this.jobQueue.length,
          usefulWorkUnits,
        },
        resourceHints: {
          cpuWeight: job.type === 'monte_carlo' || job.type === 'model_optimization' ? 1 : 0.5,
          ioWeight: job.type === 'osint_sweep' ? 1 : 0,
          parallelismHint: Math.max(1, Math.floor(optionalFinite(job.payload.quantiParallelismHint) ?? 1)),
          preferredBackend: 'inline',
        },
        policy: {
          timeoutMs,
          usefulWorkUnits,
          strictValidation: true,
        },
        execute: (_input, context) => executor(job, {
          signal: context.signal,
          executionId: context.executionId,
          workerId: context.workerId,
          startedAt: context.startedAt,
        }),
        validate: result => isExecutionResult(result),
      }, { signal: controller.signal });

      const result = quantiResult.result;
      const resource = quantiResult.metrics.resourceAfter;
      const memoryUsage = resource.totalMemoryBytes > 0
        ? (1 - resource.freeMemoryBytes / resource.totalMemoryBytes) * 100
        : 0;
      const metrics: ReactorMetrics = {
        jobId: job.id,
        cpuUsage: resource.cpuUtilizationPercent ?? this.heatMonitor.cpuUsage,
        memoryUsage,
        requestsUsed: finiteNumber(result.requestsUsed),
        durationMs: quantiResult.metrics.totalLatencyMs,
        scoreBefore: finiteNumber(result.scoreBefore),
        scoreAfter: finiteNumber(result.scoreAfter),
        improvementPercent: finiteNumber(result.improvementPercent),
      };
      this.metricsHistory.push(metrics);
      if (this.metricsHistory.length > MAX_HISTORY) this.metricsHistory.splice(0, this.metricsHistory.length - MAX_HISTORY);

      job.status = 'completed';
      job.finishedAt = new Date();
      console.log(`[Reactor] Job completed through Quanti Comp: ${job.id} (${metrics.durationMs.toFixed(1)}ms)`);
      reactorEvents.emit('job-completed', {
        job,
        metrics,
        result,
        quantiMetrics: quantiResult.metrics,
        computeAuthority: 'quanti-comp',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Reactor] Job failed: ${job.id}`, message);
      job.errorMessage = message;
      const aborted = controller.signal.aborted || (error instanceof QuantiCompError && error.code === 'ABORTED');
      const executorUnavailable = message.includes('REACTOR_EXECUTOR_UNAVAILABLE:');

      if (aborted) {
        job.status = 'cancelled';
        job.finishedAt = new Date();
        reactorEvents.emit('job-cancelled', job);
      } else if (!executorUnavailable && job.retryCount < job.maxRetries) {
        job.retryCount += 1;
        job.status = 'pending';
        job.scheduledAt = new Date(Date.now() + 5_000 * job.retryCount);
        this.jobQueue.push(job);
        this.sortJobQueue();
        console.log(`[Reactor] Job queued for retry: ${job.id} (attempt ${job.retryCount}/${job.maxRetries})`);
        reactorEvents.emit('job-retrying', { job, error: message });
      } else {
        job.status = 'failed';
        job.finishedAt = new Date();
        reactorEvents.emit('job-failed', {
          job,
          error: message,
          computeAuthority: 'quanti-comp',
          authoritativeResult: false,
        });
      }
    } finally {
      this.activeControllers.delete(job.id);
      this.activeJobs.delete(job.id);
      this.jobsProcessedThisHour += 1;
      if (job.status !== 'pending') {
        this.jobExecutors.delete(job.id);
        this.jobHistory.push({ ...job, payload: { ...job.payload } });
        if (this.jobHistory.length > MAX_HISTORY) this.jobHistory.splice(0, this.jobHistory.length - MAX_HISTORY);
      }
      this.updateHeatMonitor();
      this.scheduleProcessing(job.status === 'pending' ? Math.max(1, job.scheduledAt.getTime() - Date.now()) : 0);
    }
  }

  private async runMeasuredMonteCarlo(
    _job: ReactorJob,
    scoringFunction: (params: unknown) => Promise<number>,
    parameterSpace: Record<string, { min: number; max: number }>,
    config: MonteCarloConfig,
    signal: AbortSignal,
  ): Promise<ReactorJobExecutionResult> {
    const dimensions = Object.entries(parameterSpace);
    if (!dimensions.length) throw new Error('REACTOR_MONTE_CARLO_INVALID_PARAMETER_SPACE: no parameters');
    for (const [name, range] of dimensions) {
      if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max < range.min) {
        throw new Error(`REACTOR_MONTE_CARLO_INVALID_PARAMETER_SPACE: ${name}`);
      }
    }

    const midpoint = Object.fromEntries(dimensions.map(([name, range]) => [name, (range.min + range.max) / 2]));
    const scoreBefore = Number(await scoringFunction(midpoint));
    if (!Number.isFinite(scoreBefore)) throw new Error('REACTOR_MONTE_CARLO_INVALID_SCORE: baseline');

    let bestScore = scoreBefore;
    let bestParameters = midpoint;
    let evaluations = 1;
    const requestedPasses = Math.max(1, Math.floor(config.passesPerCycle));
    const maxIterations = Math.max(1, Math.floor(config.maxIterations));
    const passCount = Math.min(requestedPasses, maxIterations);

    for (let iteration = 1; iteration <= passCount; iteration += 1) {
      if (signal.aborted) throw new Error('REACTOR_MONTE_CARLO_ABORTED');
      const candidate: Record<string, number> = {};
      dimensions.forEach(([name, range], dimension) => {
        const fraction = halton(iteration, primeForDimension(dimension));
        candidate[name] = range.min + (range.max - range.min) * fraction;
      });
      const score = Number(await scoringFunction(candidate));
      evaluations += 1;
      if (!Number.isFinite(score)) throw new Error(`REACTOR_MONTE_CARLO_INVALID_SCORE: iteration ${iteration}`);
      if (score > bestScore) {
        bestScore = score;
        bestParameters = candidate;
      }
      const improvement = Math.abs(scoreBefore) > 1e-12
        ? ((bestScore - scoreBefore) / Math.abs(scoreBefore)) * 100
        : bestScore - scoreBefore;
      if (config.targetImprovement > 0 && improvement >= config.targetImprovement) break;
    }

    const improvementPercent = Math.abs(scoreBefore) > 1e-12
      ? ((bestScore - scoreBefore) / Math.abs(scoreBefore)) * 100
      : bestScore - scoreBefore;
    return {
      requestsUsed: evaluations,
      scoreBefore,
      scoreAfter: bestScore,
      improvementPercent,
      result: {
        target: 'measured_scoring_function',
        bestParameters,
        evaluations,
        deterministicSequence: 'halton',
      },
    };
  }

  private usefulWorkUnits(job: ReactorJob): number {
    if (job.type === 'monte_carlo') {
      const config = job.payload.config as Partial<MonteCarloConfig> | undefined;
      return Math.max(1, finiteNumber(config?.passesPerCycle, 1));
    }
    const items = Array.isArray(job.payload.items) ? job.payload.items.length : 0;
    return Math.max(1, items);
  }

  private startTelemetry(): void {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);
    this.telemetryInterval = setInterval(() => this.updateHeatMonitor(), TELEMETRY_INTERVAL_MS);
    this.telemetryInterval.unref();
  }

  private updateHeatMonitor(): void {
    const resource = quantiComp.getStatus().resource;
    if (resource.cpuUtilizationPercent !== null) this.heatMonitor.cpuUsage = resource.cpuUtilizationPercent;
    this.heatMonitor.memoryUsage = resource.totalMemoryBytes > 0
      ? Math.max(0, Math.min(100, (1 - resource.freeMemoryBytes / resource.totalMemoryBytes) * 100))
      : 0;
    this.heatMonitor.rateLimitUsage = Math.max(
      0,
      Math.min(100, (this.jobsProcessedThisHour / Math.max(1, this.config.maxJobsPerHour)) * 100),
    );
    this.heatMonitor.jobQueueSize = this.jobQueue.length;
    this.heatMonitor.activeJobs = this.activeJobs.size;
    this.heatMonitor.throttleLevel = this.calculateThrottleLevel();
    reactorEvents.emit('heat-update', { ...this.heatMonitor, source: 'quanti-comp-measured' });
  }

  private calculateThrottleLevel(): HeatMonitor['throttleLevel'] {
    const { cpuUsage, memoryUsage, rateLimitUsage, jobQueueSize } = this.heatMonitor;
    if (cpuUsage >= THROTTLE_THRESHOLDS.heavy.cpu || memoryUsage >= THROTTLE_THRESHOLDS.heavy.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.heavy.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.heavy.queueSize) return 'heavy';
    if (cpuUsage >= THROTTLE_THRESHOLDS.moderate.cpu || memoryUsage >= THROTTLE_THRESHOLDS.moderate.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.moderate.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.moderate.queueSize) return 'moderate';
    if (cpuUsage >= THROTTLE_THRESHOLDS.light.cpu || memoryUsage >= THROTTLE_THRESHOLDS.light.memory || rateLimitUsage >= THROTTLE_THRESHOLDS.light.rateLimit || jobQueueSize >= THROTTLE_THRESHOLDS.light.queueSize) return 'light';
    return 'none';
  }

  private isInMaintenanceWindow(): boolean {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    return currentTime >= this.config.maintenanceWindow.start && currentTime <= this.config.maintenanceWindow.end;
  }

  private checkHourlyReset(): void {
    const now = new Date();
    if ((now.getTime() - this.lastHourReset.getTime()) / (1000 * 60 * 60) >= 1) {
      this.jobsProcessedThisHour = 0;
      this.lastHourReset = now;
    }
  }

  private sortJobQueue(): void {
    this.jobQueue.sort((a, b) => b.priority - a.priority || a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  getJob(jobId: string): ReactorJob | undefined {
    return this.activeJobs.get(jobId) || this.jobQueue.find(job => job.id === jobId) || this.jobHistory.find(job => job.id === jobId);
  }

  cancelJob(jobId: string): boolean {
    const queueIndex = this.jobQueue.findIndex(job => job.id === jobId);
    if (queueIndex >= 0) {
      const [job] = this.jobQueue.splice(queueIndex, 1);
      job.status = 'cancelled';
      job.finishedAt = new Date();
      this.jobExecutors.delete(job.id);
      this.jobHistory.push({ ...job, payload: { ...job.payload } });
      reactorEvents.emit('job-cancelled', job);
      this.updateHeatMonitor();
      return true;
    }
    const controller = this.activeControllers.get(jobId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  getHeatMonitor(): HeatMonitor {
    this.updateHeatMonitor();
    return { ...this.heatMonitor };
  }

  getStatus(): {
    enabled: boolean;
    activeJobs: number;
    queuedJobs: number;
    jobsProcessedThisHour: number;
    throttleLevel: string;
    heatMonitor: HeatMonitor;
    computeAuthority: 'quanti-comp';
    simulatedComputeAuthoritative: false;
    quantiComp: ReturnType<typeof quantiComp.getStatus>;
  } {
    this.updateHeatMonitor();
    return {
      enabled: this.config.enabled,
      activeJobs: this.activeJobs.size,
      queuedJobs: this.jobQueue.length,
      jobsProcessedThisHour: this.jobsProcessedThisHour,
      throttleLevel: this.heatMonitor.throttleLevel,
      heatMonitor: { ...this.heatMonitor },
      computeAuthority: 'quanti-comp',
      simulatedComputeAuthoritative: false,
      quantiComp: quantiComp.getStatus(),
    };
  }

  getRecentMetrics(limit = 100): ReactorMetrics[] {
    return this.metricsHistory.slice(-Math.max(0, limit));
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled && this.processorTimer) {
      clearTimeout(this.processorTimer);
      this.processorTimer = null;
      this.processorDueAt = null;
    }
    if (enabled) this.scheduleProcessing(0);
    console.log(`[Reactor] ${enabled ? 'Enabled' : 'Disabled'}`);
    reactorEvents.emit('reactor-state-change', { enabled });
  }

  updateConfig(config: Partial<ReactorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      monteCarloConfig: { ...this.config.monteCarloConfig, ...(config.monteCarloConfig || {}) },
      maintenanceWindow: { ...this.config.maintenanceWindow, ...(config.maintenanceWindow || {}) },
    };
    this.scheduleProcessing(0);
    console.log('[Reactor] Configuration updated');
    reactorEvents.emit('config-updated', this.config);
  }

  async shutdown(): Promise<void> {
    console.log('[Reactor] Shutting down compatibility facade...');
    this.isInitialized = false;
    if (this.processorTimer) clearTimeout(this.processorTimer);
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);
    this.processorTimer = null;
    this.processorDueAt = null;
    this.telemetryInterval = null;
    for (const controller of this.activeControllers.values()) controller.abort();
    for (const job of this.jobQueue.splice(0)) {
      job.status = 'cancelled';
      job.finishedAt = new Date();
      this.jobExecutors.delete(job.id);
      this.jobHistory.push({ ...job, payload: { ...job.payload } });
    }
    this.updateHeatMonitor();
    console.log('[Reactor] Compatibility facade shut down; shared Quanti Comp remains active');
    reactorEvents.emit('reactor-shutdown');
  }
}

export const computationalReactor = ComputationalReactor.getInstance();

export async function initializeReactor(config?: Partial<ReactorConfig>): Promise<void> {
  await computationalReactor.initialize(config);
}

export async function submitJob(
  type: ReactorJob['type'],
  payload: Record<string, unknown>,
  priority?: number,
): Promise<string> {
  return computationalReactor.submitJob(type, payload, priority);
}

export function registerReactorExecutor(type: ReactorJob['type'], executor: ReactorJobExecutor): void {
  computationalReactor.registerExecutor(type, executor);
}

export function unregisterReactorExecutor(type: ReactorJob['type']): boolean {
  return computationalReactor.unregisterExecutor(type);
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
