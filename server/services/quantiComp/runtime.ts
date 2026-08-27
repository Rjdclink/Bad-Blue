import { EventEmitter } from 'node:events';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { QuantiInteractionModel } from './interactionModel.js';
import { QuantiResourceProfiler } from './resourceProfiler.js';
import {
  QUANTI_COMP_VERSION,
  QuantiCompError,
  type QuantiExecutionMetrics,
  type QuantiExecutionResult,
  type QuantiLane,
  type QuantiProfileSummary,
  type QuantiRuntimeStatus,
  type QuantiWorkload,
} from './types.js';

type QueueItem<Input = unknown, Result = unknown> = {
  workload: QuantiWorkload<Input, Result>;
  queuedAt: number;
  queueDepthAtSubmit: number;
  activeAtSubmit: number;
  resolve: (value: QuantiExecutionResult<Result>) => void;
  reject: (error: Error) => void;
};

type ProfileState = {
  latencies: number[];
  cpu: number[];
  throughput: number[];
  failures: number;
};

const PROFILE_WINDOW = 512;
const LANE_RANK: Record<QuantiLane, number> = {
  background: 1,
  batch: 2,
  warm: 3,
  hot: 4,
  ultra_hot: 5,
};

function clampPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, priority));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const lane = LANE_RANK[a.workload.lane] - LANE_RANK[b.workload.lane];
  if (lane !== 0) return lane;

  const aDeadline = a.workload.policy.deadlineAt ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.workload.policy.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return bDeadline - aDeadline;

  const priority = clampPriority(a.workload.priority) - clampPriority(b.workload.priority);
  if (priority !== 0) return priority;

  return b.queuedAt - a.queuedAt;
}

class MaxHeap {
  private items: QueueItem[] = [];

  get size(): number { return this.items.length; }

  push(item: QueueItem): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareQueueItems(this.items[index], this.items[parent]) <= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  pop(): QueueItem | undefined {
    if (this.items.length === 0) return undefined;
    const root = this.items[0];
    const tail = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = tail;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && compareQueueItems(this.items[left], this.items[best]) > 0) best = left;
        if (right < this.items.length && compareQueueItems(this.items[right], this.items[best]) > 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return root;
  }

  drain(): QueueItem[] {
    const out: QueueItem[] = [];
    let item: QueueItem | undefined;
    while ((item = this.pop())) out.push(item);
    return out;
  }
}

export interface QuantiCompRuntimeOptions {
  maxConcurrency?: number;
  workerId?: string;
}

export class QuantiCompRuntime extends EventEmitter {
  private readonly queue = new MaxHeap();
  private readonly profiler = new QuantiResourceProfiler();
  private readonly interactionModel = new QuantiInteractionModel();
  private readonly profiles = new Map<string, ProfileState>();
  private readonly inFlightByKey = new Map<string, Promise<QuantiExecutionResult<unknown>>>();
  private readonly maxConcurrency: number;
  private readonly workerId: string;
  private activeExecutions = 0;
  private completedExecutions = 0;
  private failedExecutions = 0;
  private initialized = true;
  private pumping = false;

  constructor(options: QuantiCompRuntimeOptions = {}) {
    super();
    const available = Math.max(1, os.availableParallelism?.() || os.cpus().length);
    const configured = Number(process.env.QUANTI_COMP_MAX_CONCURRENCY || options.maxConcurrency || available);
    this.maxConcurrency = Math.max(1, Math.min(64, available, Number.isFinite(configured) ? Math.floor(configured) : available));
    this.workerId = options.workerId || `quanti-local-${process.pid}`;
  }

  submit<Input, Result>(workload: QuantiWorkload<Input, Result>): Promise<QuantiExecutionResult<Result>> {
    this.assertWorkload(workload);
    if (!this.initialized) {
      return Promise.reject(new QuantiCompError('Quanti Comp runtime is shut down', 'SHUTDOWN', { workloadId: workload.id }));
    }

    const dedupeKey = workload.policy.allowDeduplication ? workload.policy.dedupeKey : undefined;
    if (dedupeKey) {
      const existing = this.inFlightByKey.get(dedupeKey);
      if (existing) {
        this.emit('workload-deduplicated', { workloadId: workload.id, dedupeKey });
        return existing as Promise<QuantiExecutionResult<Result>>;
      }
    }

    const promise = new Promise<QuantiExecutionResult<Result>>((resolve, reject) => {
      const queuedAt = Date.now();
      this.queue.push({
        workload,
        queuedAt,
        queueDepthAtSubmit: this.queue.size,
        activeAtSubmit: this.activeExecutions,
        resolve,
        reject,
      });
      this.emit('workload-queued', {
        workloadId: workload.id,
        kind: workload.kind,
        lane: workload.lane,
        queued: this.queue.size,
      });
      this.schedulePump();
    });

    if (dedupeKey) {
      this.inFlightByKey.set(dedupeKey, promise as Promise<QuantiExecutionResult<unknown>>);
      void promise.finally(() => {
        if (this.inFlightByKey.get(dedupeKey) === promise) this.inFlightByKey.delete(dedupeKey);
      }).catch(() => undefined);
    }
    return promise;
  }

  getStatus(): QuantiRuntimeStatus {
    return {
      version: QUANTI_COMP_VERSION,
      initialized: this.initialized,
      maxConcurrency: this.maxConcurrency,
      activeExecutions: this.activeExecutions,
      queuedExecutions: this.queue.size,
      inFlightDeduplicatedKeys: this.inFlightByKey.size,
      completedExecutions: this.completedExecutions,
      failedExecutions: this.failedExecutions,
      resource: this.profiler.snapshot(),
      profiles: Array.from(this.profiles.keys()).map(kind => this.getProfile(kind)),
      interactionObservationKinds: this.interactionModel.getObservationKindCount(),
    };
  }

  getProfile(kind: string): QuantiProfileSummary {
    const state = this.profiles.get(kind) || { latencies: [], cpu: [], throughput: [], failures: 0 };
    const successes = state.latencies.length;
    const total = successes + state.failures;
    return {
      kind,
      samples: successes,
      failures: state.failures,
      successRate: total ? successes / total : 0,
      latencyP50Ms: percentile(state.latencies, 0.50),
      latencyP95Ms: percentile(state.latencies, 0.95),
      latencyP99Ms: percentile(state.latencies, 0.99),
      cpuP50Ms: percentile(state.cpu, 0.50),
      throughputP50PerSecond: percentile(state.throughput, 0.50),
    };
  }

  getInteractionInsights(kind: string, limit = 20) {
    return this.interactionModel.getInsights(kind, limit);
  }

  shutdown(): void {
    if (!this.initialized) return;
    this.initialized = false;
    for (const item of this.queue.drain()) {
      item.reject(new QuantiCompError('Quanti Comp runtime shut down before execution', 'SHUTDOWN', {
        workloadId: item.workload.id,
      }));
    }
    this.inFlightByKey.clear();
    this.profiler.shutdown();
    this.emit('shutdown');
  }

  private assertWorkload(workload: QuantiWorkload): void {
    if (!workload || typeof workload !== 'object') throw new QuantiCompError('Workload is required', 'INVALID_WORKLOAD');
    if (!workload.id || !workload.kind) throw new QuantiCompError('Workload id and kind are required', 'INVALID_WORKLOAD');
    if (!(workload.lane in LANE_RANK)) throw new QuantiCompError(`Invalid Quanti lane: ${String(workload.lane)}`, 'INVALID_WORKLOAD');
    if (!workload.policy || !Number.isFinite(workload.policy.timeoutMs) || workload.policy.timeoutMs <= 0) {
      throw new QuantiCompError('Workload timeoutMs must be a positive finite number', 'INVALID_WORKLOAD', { workloadId: workload.id });
    }
    if (typeof workload.execute !== 'function' || typeof workload.validate !== 'function') {
      throw new QuantiCompError('Workload execute and validate functions are required', 'INVALID_WORKLOAD', { workloadId: workload.id });
    }
  }

  private schedulePump(): void {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.initialized && this.activeExecutions < this.maxConcurrency && this.queue.size > 0) {
      const item = this.queue.pop();
      if (!item) break;
      const deadline = item.workload.policy.deadlineAt;
      if (deadline !== undefined && Date.now() > deadline) {
        this.recordFailure(item.workload.kind);
        this.failedExecutions += 1;
        item.reject(new QuantiCompError('Workload deadline expired before execution', 'DEADLINE_EXPIRED', {
          workloadId: item.workload.id,
          deadlineAt: deadline,
        }));
        continue;
      }
      this.activeExecutions += 1;
      void this.executeItem(item).finally(() => {
        this.activeExecutions -= 1;
        this.schedulePump();
      });
    }
  }

  private async executeItem<Input, Result>(item: QueueItem<Input, Result>): Promise<void> {
    const { workload } = item;
    const executionId = `qc_${randomUUID()}`;
    const startedAtEpoch = Date.now();
    const startedAt = performance.now();
    const before = this.profiler.snapshot();
    const beforeCpu = process.cpuUsage();
    const beforeMemory = process.memoryUsage();
    const controller = new AbortController();
    const timeoutMs = Math.max(1, workload.policy.timeoutMs);
    const deadlineRemaining = workload.policy.deadlineAt === undefined
      ? timeoutMs
      : Math.max(1, workload.policy.deadlineAt - Date.now());
    const effectiveTimeout = Math.max(1, Math.min(timeoutMs, deadlineRemaining));
    let timeout: NodeJS.Timeout | null = null;

    this.emit('workload-started', {
      workloadId: workload.id,
      executionId,
      kind: workload.kind,
      lane: workload.lane,
      queueLatencyMs: Math.max(0, startedAtEpoch - item.queuedAt),
    });

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new QuantiCompError('Workload execution timed out', 'TIMEOUT', {
            workloadId: workload.id,
            timeoutMs: effectiveTimeout,
          }));
        }, effectiveTimeout);
        timeout.unref?.();
      });

      const executionStart = performance.now();
      const result = await Promise.race([
        Promise.resolve(workload.execute(workload.input, {
          signal: controller.signal,
          executionId,
          workerId: this.workerId,
          backend: 'inline',
          queuedAt: item.queuedAt,
          startedAt: startedAtEpoch,
        })),
        timeoutPromise,
      ]);
      const executionMs = performance.now() - executionStart;

      if (controller.signal.aborted) {
        throw new QuantiCompError('Workload aborted', 'ABORTED', { workloadId: workload.id });
      }

      const validationStart = performance.now();
      const valid = await workload.validate(result as Result, workload.input);
      const validationMs = performance.now() - validationStart;
      if (!valid) {
        throw new QuantiCompError('Workload result validation failed', 'VALIDATION_FAILED', { workloadId: workload.id });
      }

      const cpu = process.cpuUsage(beforeCpu);
      const afterMemory = process.memoryUsage();
      const after = this.profiler.snapshot();
      const totalLatencyMs = performance.now() - startedAt;
      const usefulWorkUnits = Number.isFinite(workload.policy.usefulWorkUnits)
        ? Math.max(0, Number(workload.policy.usefulWorkUnits))
        : 1;
      const usefulThroughputPerSecond = totalLatencyMs > 0
        ? usefulWorkUnits / (totalLatencyMs / 1000)
        : usefulWorkUnits * 1000;
      const metrics: QuantiExecutionMetrics = {
        queueLatencyMs: Math.max(0, startedAtEpoch - item.queuedAt),
        executionMs: Math.max(0, executionMs),
        validationMs: Math.max(0, validationMs),
        totalLatencyMs: Math.max(0, totalLatencyMs),
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        cpuTotalMs: (cpu.user + cpu.system) / 1000,
        rssDeltaBytes: afterMemory.rss - beforeMemory.rss,
        heapDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
        usefulWorkUnits,
        usefulThroughputPerSecond,
        backend: 'inline',
        resourceBefore: before,
        resourceAfter: after,
      };

      this.recordSuccess(workload.kind, metrics);
      this.interactionModel.record(
        workload.kind,
        workload.lane,
        workload.priority,
        item.queueDepthAtSubmit,
        item.activeAtSubmit,
        workload.features,
        metrics,
      );
      this.completedExecutions += 1;
      const executionResult: QuantiExecutionResult<Result> = {
        executionId,
        workloadId: workload.id,
        kind: workload.kind,
        validated: true,
        result: result as Result,
        metrics,
      };
      item.resolve(executionResult);
      this.emit('workload-completed', executionResult);
    } catch (error) {
      controller.abort();
      this.failedExecutions += 1;
      this.recordFailure(workload.kind);
      const normalized = error instanceof QuantiCompError
        ? error
        : new QuantiCompError(
          error instanceof Error ? error.message : String(error),
          'EXECUTION_FAILED',
          { workloadId: workload.id },
        );
      item.reject(normalized);
      this.emit('workload-failed', {
        workloadId: workload.id,
        executionId,
        kind: workload.kind,
        code: normalized.code,
        error: normalized.message,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private recordSuccess(kind: string, metrics: QuantiExecutionMetrics): void {
    const state = this.profiles.get(kind) || { latencies: [], cpu: [], throughput: [], failures: 0 };
    state.latencies.push(metrics.totalLatencyMs);
    state.cpu.push(metrics.cpuTotalMs);
    state.throughput.push(metrics.usefulThroughputPerSecond);
    if (state.latencies.length > PROFILE_WINDOW) state.latencies.splice(0, state.latencies.length - PROFILE_WINDOW);
    if (state.cpu.length > PROFILE_WINDOW) state.cpu.splice(0, state.cpu.length - PROFILE_WINDOW);
    if (state.throughput.length > PROFILE_WINDOW) state.throughput.splice(0, state.throughput.length - PROFILE_WINDOW);
    this.profiles.set(kind, state);
  }

  private recordFailure(kind: string): void {
    const state = this.profiles.get(kind) || { latencies: [], cpu: [], throughput: [], failures: 0 };
    state.failures += 1;
    this.profiles.set(kind, state);
  }
}

export const quantiComp = new QuantiCompRuntime();
