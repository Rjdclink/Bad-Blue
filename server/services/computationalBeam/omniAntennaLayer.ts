/**
 * Omni-Directional Antenna Layer
 *
 * Real low-latency in-process transport/parse execution substrate. The Antenna
 * accelerates lightweight work but never owns market truth, trade admission, or
 * execution authority. Heavy compute remains owned by Directional Beam/Quanti.
 */

import { EventEmitter } from 'node:events';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  Task,
  TaskType,
  TaskIntensity,
  ComputeNode,
  ComputeProvider,
  ComputeLayer,
  RoutingDecision,
  type ComputeWorkloadContext,
} from './types.js';
import { quantiParallelismGovernor, type QuantiLane } from '../quantiComp/index.js';

const HOT_LATENCY_SAMPLE_LIMIT = Math.max(64, Math.min(4096, Number(process.env.CRYPTOCRAWL_ANTENNA_HOT_LATENCY_SAMPLES || 512)));
const availableParallelism = Math.max(1, os.availableParallelism?.() || os.cpus().length);
const configuredConcurrency = Number(process.env.COMPUTATIONAL_ANTENNA_MAX_CONCURRENCY || Math.max(4, availableParallelism * 2));
const MAX_LOCAL_CONCURRENCY = Math.max(1, Math.min(64, Number.isFinite(configuredConcurrency) ? Math.floor(configuredConcurrency) : 4));

const ANTENNA_TASK_TYPES = new Set<TaskType>([
  TaskType.WEBSOCKET_PING,
  TaskType.BASIC_PARSING,
  TaskType.ORDER_BOOK_FRAME,
  TaskType.ORDER_BOOK_APPLY,
  TaskType.TRADE_STREAM,
  TaskType.STREAM_LIVENESS,
  TaskType.FRESHNESS_VALIDATION,
  TaskType.FEE_RESOLUTION,
]);

type AntennaTaskHandler = (
  payload: unknown,
  context: ComputeWorkloadContext,
) => Promise<unknown> | unknown;

type HotPathStats = {
  samples: number[];
  calls: number;
  failures: number;
};

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return Number(sorted[index].toFixed(3));
}

function deadlineFromTask(task: Task): number | undefined {
  if (!task.payload || typeof task.payload !== 'object') return undefined;
  const value = Number((task.payload as Record<string, unknown>).quantiDeadlineAt);
  return Number.isFinite(value) ? value : undefined;
}

function laneForTask(task: Task): QuantiLane {
  if (task.metadata.priority >= 100 || [TaskType.ORDER_BOOK_FRAME, TaskType.ORDER_BOOK_APPLY].includes(task.type)) return 'ultra_hot';
  return 'hot';
}

export class OmniAntennaLayer extends EventEmitter {
  private readonly antennaNodes = new Map<string, ComputeNode>();
  private readonly requestQueue: Task[] = [];
  private readonly activeRequests = new Map<string, Task>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly handlers = new Map<TaskType, AntennaTaskHandler>();
  private readonly hotPath = new Map<TaskType, HotPathStats>();
  private failedTasks = 0;
  private cancelledTasks = 0;

  constructor() {
    super();
    this.initializeAntennaNodes();
  }

  /**
   * Only advertise compute that physically exists in this process. Remote
   * Cloudflare/GCF nodes may be registered later only when a real executor is
   * connected; fictional capacity is prohibited.
   */
  private initializeAntennaNodes(): void {
    const railwayRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID);
    this.antennaNodes.set('local-antenna-1', {
      id: 'local-antenna-1',
      provider: railwayRuntime ? ComputeProvider.RAILWAY : ComputeProvider.LOCAL_MACHINE,
      layer: ComputeLayer.ANTENNA,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: MAX_LOCAL_CONCURRENCY,
        cpuCores: availableParallelism,
        memoryMB: Math.floor(os.totalmem() / (1024 * 1024)),
        supportedTaskTypes: [...ANTENNA_TASK_TYPES],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 0,
        successRate: 100,
        totalTasksCompleted: 0,
      },
      health: {
        lastHealthCheck: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });
  }

  /** Register a real lightweight task implementation. Registration never grants
   * market-data, profitability, or execution authority. */
  public registerTaskHandler(type: TaskType, handler: AntennaTaskHandler): void {
    if (!ANTENNA_TASK_TYPES.has(type)) throw new Error(`Task type ${type} is not an Antenna hot-path capability`);
    this.handlers.set(type, handler);
  }

  public unregisterTaskHandler(type: TaskType): void {
    this.handlers.delete(type);
  }

  /**
   * Execute latency-critical synchronous transport work inline so order-book
   * message order is preserved. This is the canonical fast path for frame parse,
   * normalization, sequence/freshness checks and local book application.
   */
  public executeHotPathSync<T>(type: TaskType, operation: () => T): T {
    if (!ANTENNA_TASK_TYPES.has(type)) throw new Error(`Task type ${type} is not an Antenna hot-path capability`);
    const started = performance.now();
    const stats = this.hotPath.get(type) || { samples: [], calls: 0, failures: 0 };
    stats.calls += 1;
    try {
      return operation();
    } catch (error) {
      stats.failures += 1;
      throw error;
    } finally {
      const elapsed = Math.max(0, performance.now() - started);
      stats.samples.push(elapsed);
      if (stats.samples.length > HOT_LATENCY_SAMPLE_LIMIT) stats.samples.splice(0, stats.samples.length - HOT_LATENCY_SAMPLE_LIMIT);
      this.hotPath.set(type, stats);
    }
  }

  public async acceptTask(task: Task): Promise<string> {
    if (!this.isLightweightTask(task)) throw new Error(`Task ${task.id} is too heavy for antenna layer`);
    this.requestQueue.push(task);
    this.sortQueue();
    this.emit('task-queued', task);
    void this.processQueue();
    return task.id;
  }

  private isLightweightTask(task: Task): boolean {
    return task.intensity === TaskIntensity.LIGHTWEIGHT || ANTENNA_TASK_TYPES.has(task.type);
  }

  private sortQueue(): void {
    this.requestQueue.sort((left, right) => {
      const leftDeadline = deadlineFromTask(left) ?? Number.POSITIVE_INFINITY;
      const rightDeadline = deadlineFromTask(right) ?? Number.POSITIVE_INFINITY;
      if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      if (left.metadata.priority !== right.metadata.priority) return right.metadata.priority - left.metadata.priority;
      return left.metadata.created.getTime() - right.metadata.created.getTime();
    });
  }

  private async processQueue(): Promise<void> {
    while (this.requestQueue.length > 0) {
      const task = this.requestQueue[0];
      const deadlineAt = deadlineFromTask(task);
      if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
        this.requestQueue.shift();
        this.failedTasks += 1;
        this.emit('task-failed', { taskId: task.id, error: 'DEADLINE_EXPIRED: Antenna task expired while queued' });
        continue;
      }
      const node = this.selectNode(task);
      if (!node) return;
      this.requestQueue.shift();
      void this.executeOnNode(task, node).finally(() => void this.processQueue());
    }
  }

  private selectNode(task: Task): ComputeNode | null {
    const candidates = [...this.antennaNodes.values()].filter(node =>
      node.status === 'active' &&
      node.capabilities.supportedTaskTypes.includes(task.type) &&
      node.metrics.currentLoad < node.capabilities.maxConcurrentTasks,
    );
    if (candidates.length === 0) return null;
    candidates.sort((left, right) => {
      const leftLoad = left.metrics.currentLoad / Math.max(1, left.capabilities.maxConcurrentTasks);
      const rightLoad = right.metrics.currentLoad / Math.max(1, right.capabilities.maxConcurrentTasks);
      if (leftLoad !== rightLoad) return leftLoad - rightLoad;
      return left.metrics.avgResponseTime - right.metrics.avgResponseTime;
    });
    return candidates[0];
  }

  private async executeOnNode(task: Task, node: ComputeNode): Promise<void> {
    const controller = new AbortController();
    const startedAt = Date.now();
    this.activeRequests.set(task.id, task);
    this.activeControllers.set(task.id, controller);
    node.metrics.currentLoad += 1;
    this.emit('task-started', { taskId: task.id, nodeId: node.id, provider: node.provider });

    let lease: Awaited<ReturnType<typeof quantiParallelismGovernor.acquire>> | null = null;
    try {
      const deadlineAt = deadlineFromTask(task);
      lease = await quantiParallelismGovernor.acquire({
        id: `antenna:${task.id}`,
        units: 1,
        lane: laneForTask(task),
        priority: task.metadata.priority,
        deadlineAt,
        signal: controller.signal,
        metadata: { component: 'OmniAntennaLayer', taskType: task.type },
      });

      const handler = this.handlers.get(task.type);
      if (!task.workload && !handler) throw new Error(`Task ${task.id} has no real Antenna workload or registered handler`);
      const context: ComputeWorkloadContext = {
        signal: controller.signal,
        workerId: node.id,
        startedAt: new Date(startedAt),
      };
      const result = task.workload
        ? await task.workload.execute(task.workload.input, context)
        : await handler!(task.payload, context);
      if (task.workload && !await task.workload.validate(result, task.workload.input)) {
        throw new Error(`Task ${task.id} failed Antenna workload validation`);
      }

      const duration = Math.max(0, Date.now() - startedAt);
      node.metrics.totalTasksCompleted += 1;
      node.metrics.avgResponseTime = (
        node.metrics.avgResponseTime * (node.metrics.totalTasksCompleted - 1) + duration
      ) / Math.max(1, node.metrics.totalTasksCompleted);
      const total = node.metrics.totalTasksCompleted + this.failedTasks;
      node.metrics.successRate = total > 0 ? node.metrics.totalTasksCompleted / total * 100 : 100;
      this.emit('task-completed', {
        taskId: task.id,
        nodeId: node.id,
        duration,
        result,
        quantiWaitMs: lease.waitedMs,
        computeAuthority: 'quanti-parallelism',
        executionAuthority: false,
      });
    } catch (error) {
      this.failedTasks += 1;
      this.emit('task-failed', {
        taskId: task.id,
        nodeId: node.id,
        error: error instanceof Error ? error.message : String(error),
        computeAuthority: 'quanti-parallelism',
        executionAuthority: false,
      });
    } finally {
      lease?.release();
      this.activeRequests.delete(task.id);
      this.activeControllers.delete(task.id);
      node.metrics.currentLoad = Math.max(0, node.metrics.currentLoad - 1);
    }
  }

  public cancelTask(taskId: string): boolean {
    const queuedIndex = this.requestQueue.findIndex(task => task.id === taskId);
    if (queuedIndex >= 0) {
      this.requestQueue.splice(queuedIndex, 1);
      this.cancelledTasks += 1;
      this.emit('task-failed', { taskId, error: 'TASK_CANCELLED: Antenna task cancelled while queued' });
      return true;
    }
    const controller = this.activeControllers.get(taskId);
    if (!controller) return false;
    this.cancelledTasks += 1;
    controller.abort();
    return true;
  }

  public getRoutingDecision(task: Task): RoutingDecision | null {
    const selectedNode = this.selectNode(task);
    if (!selectedNode) return null;
    const loadHeadroom = 1 - selectedNode.metrics.currentLoad / Math.max(1, selectedNode.capabilities.maxConcurrentTasks);
    const latencyConfidence = 1 / (1 + selectedNode.metrics.avgResponseTime / 25);
    return {
      taskId: task.id,
      selectedNode,
      reason: `Selected real local Antenna capacity; load ${selectedNode.metrics.currentLoad}/${selectedNode.capabilities.maxConcurrentTasks}, avg ${(selectedNode.metrics.avgResponseTime || 0).toFixed(2)}ms`,
      alternativeNodes: [],
      confidence: Math.max(0, Math.min(1, loadHeadroom * 0.7 + latencyConfidence * 0.3)),
    };
  }

  public getStatus() {
    return {
      totalNodes: this.antennaNodes.size,
      activeNodes: [...this.antennaNodes.values()].filter(node => node.status === 'active').length,
      queuedTasks: this.requestQueue.length,
      activeTasks: this.activeRequests.size,
      failedTasks: this.failedTasks,
      cancelledTasks: this.cancelledTasks,
      simulatedExecution: false,
      fictionalRemoteCapacityAdvertised: false,
      marketDataAuthority: false,
      executionAuthority: false,
      role: 'transport_parse_sequence_freshness_acceleration',
      quantiParallelism: quantiParallelismGovernor.getStatus(),
      hotPath: [...this.hotPath.entries()].map(([type, stats]) => ({
        type,
        calls: stats.calls,
        failures: stats.failures,
        samples: stats.samples.length,
        p50Ms: percentile(stats.samples, 0.50),
        p95Ms: percentile(stats.samples, 0.95),
        p99Ms: percentile(stats.samples, 0.99),
        maxMs: stats.samples.length > 0 ? Number(Math.max(...stats.samples).toFixed(3)) : null,
      })),
      nodes: [...this.antennaNodes.values()].map(node => ({
        id: node.id,
        provider: node.provider,
        status: node.status,
        currentLoad: node.metrics.currentLoad,
        maxLoad: node.capabilities.maxConcurrentTasks,
        completed: node.metrics.totalTasksCompleted,
        avgResponseTimeMs: Number(node.metrics.avgResponseTime.toFixed(3)),
        successRate: Number(node.metrics.successRate.toFixed(3)),
        cpuUsage: Number(node.health.cpuUsage.toFixed(2)),
        memoryUsage: Number(node.health.memoryUsage.toFixed(2)),
      })),
    };
  }

  /** Real process/host health only; no random/synthetic metrics. */
  public async healthCheck(): Promise<void> {
    const cpuUsage = Math.max(0, Math.min(100, os.loadavg()[0] / Math.max(1, availableParallelism) * 100));
    const memoryUsage = os.totalmem() > 0 ? (1 - os.freemem() / os.totalmem()) * 100 : 0;
    for (const node of this.antennaNodes.values()) {
      node.health.lastHealthCheck = new Date();
      node.health.cpuUsage = cpuUsage;
      node.health.memoryUsage = Math.max(0, Math.min(100, memoryUsage));
      node.status = 'active';
    }
    this.emit('health-check-complete', this.getStatus());
  }

  public getNodes(): ComputeNode[] {
    return [...this.antennaNodes.values()];
  }
}

export const omniAntennaLayer = new OmniAntennaLayer();
