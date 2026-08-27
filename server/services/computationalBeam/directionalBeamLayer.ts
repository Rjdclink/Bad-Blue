/**
 * Directional Beam Compute Layer
 *
 * Compatibility facade for heavy compute. Quanti Comp now owns measured local
 * scheduling, deadline/timeout enforcement, validation, and execution telemetry
 * while existing Beam callers and events remain stable during migration.
 */

import {
  Task,
  TaskType,
  TaskIntensity,
  ComputeNode,
  ComputeProvider,
  ComputeLayer,
  TaskExecution,
  RoutingDecision,
} from './types.js';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { quantiComp, type QuantiLane } from '../quantiComp/index.js';

const MAX_LOCAL_CONCURRENCY = Math.max(1, Math.min(
  os.availableParallelism?.() || os.cpus().length,
  Number(process.env.COMPUTATIONAL_BEAM_MAX_CONCURRENCY || os.availableParallelism?.() || os.cpus().length) || 1,
));

const intensityFeature: Record<TaskIntensity, number> = {
  [TaskIntensity.LIGHTWEIGHT]: 1,
  [TaskIntensity.MODERATE]: 2,
  [TaskIntensity.HEAVY]: 3,
  [TaskIntensity.EXTREME]: 4,
};

function toQuantiLane(task: Task): QuantiLane {
  if (task.metadata.priority >= 100) return 'ultra_hot';
  if (task.type === TaskType.MONTE_CARLO || task.type === TaskType.ARBITRAGE_SCAN) return 'hot';
  if (task.intensity === TaskIntensity.EXTREME) return 'hot';
  if (task.intensity === TaskIntensity.HEAVY) return 'warm';
  return 'warm';
}

export class DirectionalBeamLayer extends EventEmitter {
  private beamNodes: Map<string, ComputeNode> = new Map();
  private executionQueue: Task[] = [];
  private activeExecutions: Map<string, TaskExecution> = new Map();
  private activeControllers: Map<string, AbortController> = new Map();
  private maxConcurrency = MAX_LOCAL_CONCURRENCY;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.initializeBeamNodes();
    this.startMonitoring();
  }

  private initializeBeamNodes(): void {
    this.beamNodes.set('local-beam-1', {
      id: 'local-beam-1',
      provider: ComputeProvider.LOCAL_MACHINE,
      layer: ComputeLayer.BEAM,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: this.maxConcurrency,
        cpuCores: os.availableParallelism?.() || os.cpus().length,
        memoryMB: Math.floor(os.totalmem() / (1024 * 1024)),
        supportedTaskTypes: Object.values(TaskType),
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

  public async acceptTask(task: Task): Promise<string> {
    if (!this.isHeavyTask(task)) {
      throw new Error(`Task ${task.id} is too lightweight for beam layer`);
    }
    this.executionQueue.push(task);
    this.emit('task-queued', task);
    await this.processQueue();
    return task.id;
  }

  private isHeavyTask(task: Task): boolean {
    return task.intensity === TaskIntensity.HEAVY ||
      task.intensity === TaskIntensity.EXTREME ||
      [
        TaskType.MONTE_CARLO,
        TaskType.ML_PREDICTION,
        TaskType.ARBITRAGE_SCAN,
        TaskType.MARKET_AGGREGATION,
      ].includes(task.type);
  }

  private async processQueue(): Promise<void> {
    while (this.executionQueue.length > 0) {
      const task = this.executionQueue[0];
      const node = this.selectOptimalNode(task);
      if (node) {
        this.executionQueue.shift();
        void this.executeOnNode(task, node).finally(() => void this.processQueue());
      } else {
        break;
      }
    }
  }

  private selectOptimalNode(task: Task): ComputeNode | null {
    const availableNodes = Array.from(this.beamNodes.values())
      .filter(node =>
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type) &&
        node.metrics.currentLoad < node.capabilities.maxConcurrentTasks &&
        !this.activeControllers.has(task.id),
      );

    if (availableNodes.length === 0) return null;

    availableNodes.sort((a, b) => {
      const aLoad = a.metrics.currentLoad / Math.max(1, a.capabilities.maxConcurrentTasks);
      const bLoad = b.metrics.currentLoad / Math.max(1, b.capabilities.maxConcurrentTasks);
      const aScore = aLoad * 0.6 + (a.health.cpuUsage / 100) * 0.25 + (a.health.memoryUsage / 100) * 0.15;
      const bScore = bLoad * 0.6 + (b.health.cpuUsage / 100) * 0.25 + (b.health.memoryUsage / 100) * 0.15;
      return aScore - bScore;
    });

    return availableNodes[0];
  }

  private async executeOnNode(task: Task, node: ComputeNode): Promise<void> {
    const execution: TaskExecution = {
      taskId: task.id,
      nodeId: node.id,
      startTime: new Date(),
      status: 'running',
      metrics: {
        cpuTimeMs: 0,
        memoryPeakMB: 0,
        networkRequests: 0,
        cacheHits: 0,
      },
    };

    this.activeExecutions.set(task.id, execution);
    node.metrics.currentLoad += 1;
    this.emit('task-started', { taskId: task.id, nodeId: node.id, provider: node.provider });

    const controller = new AbortController();
    this.activeControllers.set(task.id, controller);

    try {
      if (!task.workload) throw new Error(`Task ${task.id} has no executable workload`);

      const workload = task.workload;
      const quantiResult = await quantiComp.submit({
        id: task.id,
        kind: workload.type || task.type,
        lane: toQuantiLane(task),
        priority: task.metadata.priority,
        createdAt: task.metadata.created.getTime(),
        input: workload.input,
        features: {
          beamPriority: task.metadata.priority,
          beamIntensity: intensityFeature[task.intensity] || 0,
          cpuIntensive: task.routing?.cpuIntensive ? 1 : 0,
          memoryIntensive: task.routing?.memoryIntensive ? 1 : 0,
          ioIntensive: task.routing?.ioIntensive ? 1 : 0,
        },
        resourceHints: {
          cpuWeight: task.routing?.cpuIntensive ? 1 : 0.5,
          ioWeight: task.routing?.ioIntensive ? 1 : 0,
          preferredBackend: 'inline',
        },
        policy: {
          timeoutMs: workload.timeoutMs,
          usefulWorkUnits: 1,
          strictValidation: true,
        },
        execute: (input, context) => workload.execute(input, {
          signal: context.signal,
          workerId: node.id,
          startedAt: new Date(context.startedAt),
        }),
        validate: (result, input) => workload.validate(result, input),
      }, { signal: controller.signal });

      execution.metrics.cpuTimeMs = quantiResult.metrics.cpuTotalMs;
      execution.metrics.memoryPeakMB = Math.max(
        0,
        Math.ceil(Math.max(quantiResult.metrics.rssDeltaBytes, quantiResult.metrics.heapDeltaBytes) / (1024 * 1024)),
      );
      execution.status = 'completed';
      execution.endTime = new Date();
      execution.result = quantiResult.result;

      node.metrics.totalTasksCompleted += 1;
      node.metrics.avgResponseTime = (
        node.metrics.avgResponseTime * (node.metrics.totalTasksCompleted - 1) +
        (execution.endTime.getTime() - execution.startTime.getTime())
      ) / node.metrics.totalTasksCompleted;

      this.emit('task-completed', {
        taskId: task.id,
        nodeId: node.id,
        duration: execution.endTime.getTime() - execution.startTime.getTime(),
        result: quantiResult.result,
        metrics: execution.metrics,
        quantiMetrics: quantiResult.metrics,
        computeAuthority: 'quanti-comp',
      });
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.endTime = new Date();
      this.emit('task-failed', {
        taskId: task.id,
        nodeId: node.id,
        error: execution.error,
        computeAuthority: 'quanti-comp',
      });
    } finally {
      this.activeControllers.delete(task.id);
      node.metrics.currentLoad = Math.max(0, node.metrics.currentLoad - 1);
      this.activeExecutions.delete(task.id);
    }
  }

  public cancelTask(taskId: string): boolean {
    const controller = this.activeControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.updateNodeHealth();
    }, 5000);
    this.monitoringInterval.unref();
  }

  private updateNodeHealth(): void {
    const resource = quantiComp.getStatus().resource;
    for (const node of this.beamNodes.values()) {
      node.health.lastHealthCheck = new Date(resource.timestamp);
      if (resource.cpuUtilizationPercent !== null) node.health.cpuUsage = resource.cpuUtilizationPercent;
      node.health.memoryUsage = resource.totalMemoryBytes > 0
        ? (1 - resource.freeMemoryBytes / resource.totalMemoryBytes) * 100
        : 0;

      if (node.health.cpuUsage > 90) {
        this.emit('cpu-overuse', {
          nodeId: node.id,
          usage: node.health.cpuUsage,
          temperature: node.health.temperature,
        });
      }
    }
  }

  public getRoutingDecision(task: Task): RoutingDecision | null {
    const selectedNode = this.selectOptimalNode(task);
    if (!selectedNode) return null;

    const alternativeNodes = Array.from(this.beamNodes.values())
      .filter(node =>
        node.id !== selectedNode.id &&
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type),
      );

    const loadHeadroom = 1 - selectedNode.metrics.currentLoad / Math.max(1, selectedNode.capabilities.maxConcurrentTasks);
    const cpuHeadroom = 1 - selectedNode.health.cpuUsage / 100;
    const memoryHeadroom = 1 - selectedNode.health.memoryUsage / 100;
    const confidence = Math.max(0, Math.min(1, loadHeadroom * 0.5 + cpuHeadroom * 0.3 + memoryHeadroom * 0.2));

    return {
      taskId: task.id,
      selectedNode,
      reason: `Selected measured Quanti Comp local capacity with load ${selectedNode.metrics.currentLoad}/${selectedNode.capabilities.maxConcurrentTasks}`,
      alternativeNodes,
      confidence,
    };
  }

  public getStatus() {
    const quantiStatus = quantiComp.getStatus();
    return {
      totalNodes: this.beamNodes.size,
      activeNodes: Array.from(this.beamNodes.values()).filter(n => n.status === 'active').length,
      queuedTasks: this.executionQueue.length,
      executingTasks: this.activeExecutions.size,
      computeAuthority: 'quanti-comp',
      quantiComp: quantiStatus,
      nodes: Array.from(this.beamNodes.values()).map(node => ({
        id: node.id,
        provider: node.provider,
        status: node.status,
        currentLoad: node.metrics.currentLoad,
        maxLoad: node.capabilities.maxConcurrentTasks,
        completed: node.metrics.totalTasksCompleted,
        cpuUsage: node.health.cpuUsage.toFixed(1),
        memoryUsage: node.health.memoryUsage.toFixed(1),
        temperature: node.health.temperature?.toFixed(1),
      })),
    };
  }

  public getNodes(): ComputeNode[] {
    return Array.from(this.beamNodes.values());
  }

  public getActiveExecutions(): TaskExecution[] {
    return Array.from(this.activeExecutions.values());
  }
}

export const directionalBeamLayer = new DirectionalBeamLayer();
