/**
 * Workload Router
 *
 * Accepts crawler tasks, assesses compute intensity, and chooses between
 * lightweight Antenna work and heavyweight Beam work. Market-data transport
 * work is explicitly pinned to Antenna by task semantics so a default intensity
 * cannot accidentally send an ordered hot-path task to Beam.
 */

import {
  Task,
  TaskType,
  TaskIntensity,
  RoutingDecision,
  ComputeLayer,
  TaskRoutingError,
} from './types';
import { EventEmitter } from 'events';
import { omniAntennaLayer } from './omniAntennaLayer';
import { directionalBeamLayer } from './directionalBeamLayer';
import { superBatteryLayer } from './superBatteryLayer';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

const ANTENNA_HOT_TASKS = new Set<TaskType>([
  TaskType.WEBSOCKET_PING,
  TaskType.BASIC_PARSING,
  TaskType.ORDER_BOOK_FRAME,
  TaskType.ORDER_BOOK_APPLY,
  TaskType.TRADE_STREAM,
  TaskType.STREAM_LIVENESS,
  TaskType.FRESHNESS_VALIDATION,
  TaskType.FEE_RESOLUTION,
]);

const NON_REPLAYABLE_MARKET_TASKS = new Set<TaskType>([
  TaskType.WEBSOCKET_PING,
  TaskType.ORDER_BOOK_FRAME,
  TaskType.ORDER_BOOK_APPLY,
  TaskType.TRADE_STREAM,
  TaskType.STREAM_LIVENESS,
  TaskType.FRESHNESS_VALIDATION,
]);

function isNonRetryableTaskFailure(error?: string): boolean {
  const message = String(error || '').toLowerCase();
  return message.includes('task_cancelled') ||
    message.includes('cancelled') ||
    message.includes('canceled') ||
    message.includes('aborted') ||
    message.includes('deadline expired') ||
    message.includes('deadline_expired');
}

export class WorkloadRouter extends EventEmitter {
  private taskHistory: Map<string, RoutingDecision> = new Map();
  private routedTasks: Map<string, Task> = new Map();
  private taskOutcomes: Map<string, { result?: unknown; error?: string }> = new Map();
  private retryAttempts: Map<string, number> = new Map();
  private readonly MAX_RETRIES = MAX_RETRIES;

  constructor() {
    super();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    omniAntennaLayer.on('task-completed', (data) => {
      this.taskOutcomes.set(data.taskId, { result: data.result });
      this.clearCompletedTask(data.taskId);
      this.emit('task-completed', { ...data, layer: 'antenna' });
    });

    omniAntennaLayer.on('task-failed', (data) => {
      void this.handleTaskFailure(data.taskId, 'antenna', data.error);
    });

    directionalBeamLayer.on('task-completed', (data) => {
      this.taskOutcomes.set(data.taskId, { result: data.result });
      this.clearCompletedTask(data.taskId);
      this.emit('task-completed', { ...data, layer: 'beam' });
    });

    directionalBeamLayer.on('task-failed', (data) => {
      void this.handleTaskFailure(data.taskId, 'beam', data.error);
    });

    directionalBeamLayer.on('cpu-overuse', (data) => {
      this.emit('cpu-warning', data);
    });
  }

  public async routeTask(task: Task): Promise<RoutingDecision> {
    try {
      const optimizedTask = await superBatteryLayer.optimizeTask(task);
      const intensity = this.assessIntensity(optimizedTask);
      optimizedTask.intensity = intensity;
      const layer = this.selectLayer(optimizedTask);
      const decision = await this.getRoutingDecision(optimizedTask, layer);
      await this.executeRouting(optimizedTask, layer);

      this.taskHistory.set(task.id, decision);
      this.routedTasks.set(task.id, optimizedTask);

      this.emit('task-routed', {
        taskId: task.id,
        layer,
        intensity,
        provider: decision.selectedNode.provider,
        latencyCriticalAntennaTask: ANTENNA_HOT_TASKS.has(task.type),
        executionAuthority: false,
      });

      return decision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.taskOutcomes.set(task.id, { error: message });
      this.emit('task-failed', { taskId: task.id, error: message });
      throw new TaskRoutingError(
        `Failed to route task ${task.id}: ${message}`,
        { taskId: task.id, error },
      );
    }
  }

  private assessIntensity(task: Task): TaskIntensity {
    // Transport semantics outrank a caller's generic/default intensity. Ordered
    // market frames must never be moved to Beam simply because createTask()
    // started them as MODERATE.
    if (ANTENNA_HOT_TASKS.has(task.type)) return TaskIntensity.LIGHTWEIGHT;

    switch (task.type) {
      case TaskType.ARBITRAGE_SCAN:
      case TaskType.MARKET_AGGREGATION:
        return task.intensity || TaskIntensity.MODERATE;

      case TaskType.MONTE_CARLO:
      case TaskType.ML_PREDICTION:
        return TaskIntensity.HEAVY;

      case TaskType.MOMENTUM_STRATEGY:
      case TaskType.ALPHA_DRIFT:
      case TaskType.MICRO_TRIANGULATION:
        return TaskIntensity.EXTREME;

      default:
        return task.intensity || TaskIntensity.MODERATE;
    }
  }

  private selectLayer(task: Task): ComputeLayer {
    if (task.routing?.requiredLayer) return task.routing.requiredLayer;
    if (ANTENNA_HOT_TASKS.has(task.type)) return ComputeLayer.ANTENNA;

    switch (task.intensity) {
      case TaskIntensity.LIGHTWEIGHT:
        return ComputeLayer.ANTENNA;
      case TaskIntensity.MODERATE:
      case TaskIntensity.HEAVY:
      case TaskIntensity.EXTREME:
        return ComputeLayer.BEAM;
      default:
        return ComputeLayer.BEAM;
    }
  }

  private async getRoutingDecision(task: Task, layer: ComputeLayer): Promise<RoutingDecision> {
    let decision: RoutingDecision | null = null;
    if (layer === ComputeLayer.ANTENNA) decision = omniAntennaLayer.getRoutingDecision(task);
    else if (layer === ComputeLayer.BEAM) decision = directionalBeamLayer.getRoutingDecision(task);

    if (!decision) {
      throw new TaskRoutingError(
        `No available nodes in ${layer} layer for task ${task.id}`,
        { taskId: task.id, layer },
      );
    }
    return decision;
  }

  private async executeRouting(task: Task, layer: ComputeLayer): Promise<void> {
    if (layer === ComputeLayer.ANTENNA) await omniAntennaLayer.acceptTask(task);
    else if (layer === ComputeLayer.BEAM) await directionalBeamLayer.acceptTask(task);
  }

  /** Cancellation follows the actual routing decision. Both Beam and Antenna
   * support cancellation; neither cancellation path changes trade authority. */
  public cancelTask(taskId: string): boolean {
    const decision = this.taskHistory.get(taskId);
    if (!decision) return false;
    if (decision.selectedNode.layer === ComputeLayer.ANTENNA) return omniAntennaLayer.cancelTask(taskId);
    if (decision.selectedNode.layer === ComputeLayer.BEAM) return directionalBeamLayer.cancelTask(taskId);
    return false;
  }

  private async handleTaskFailure(taskId: string, layer: string, error?: string): Promise<void> {
    const attempts = this.retryAttempts.get(taskId) || 0;
    const task = this.routedTasks.get(taskId);
    const maxRetries = Math.min(task?.metadata.maxRetries ?? 0, this.MAX_RETRIES);
    const nonReplayable = task ? NON_REPLAYABLE_MARKET_TASKS.has(task.type) : false;
    const nonRetryable = nonReplayable || isNonRetryableTaskFailure(error);

    // Sequence-dependent market frames are observations, not commands. Replaying
    // one after a generic one-second retry would resurrect stale evidence. The
    // canonical socket/book layer must resnapshot/reacquire instead.
    if (task && !nonRetryable && attempts < maxRetries) {
      this.retryAttempts.set(taskId, attempts + 1);
      task.metadata.retries = attempts + 1;

      this.emit('task-retrying', {
        taskId,
        layer,
        attempt: attempts + 1,
        maxRetries,
      });

      const backoffMs = Math.pow(2, attempts) * BACKOFF_BASE_MS;
      const timer = setTimeout(() => {
        this.retryTask(task, layer).catch(retryError => {
          void this.handleTaskFailure(taskId, layer, retryError instanceof Error ? retryError.message : String(retryError));
        });
      }, backoffMs);
      timer.unref();
    } else {
      this.retryAttempts.delete(taskId);
      this.routedTasks.delete(taskId);
      this.taskOutcomes.set(taskId, { error });
      this.emit('task-failed', {
        taskId,
        layer,
        attempts,
        error,
        nonRetryable,
        nonReplayableMarketObservation: nonReplayable,
        reacquisitionAuthority: nonReplayable ? 'canonical_market_stream_resnapshot' : null,
      });
    }
  }

  private async retryTask(task: Task, layer: string): Promise<void> {
    const selectedLayer = this.selectLayer(task);
    if (selectedLayer !== layer) {
      throw new TaskRoutingError(`Retry changed task ${task.id} routing layer`, { taskId: task.id, layer, selectedLayer });
    }
    await this.executeRouting(task, selectedLayer);
    this.emit('task-retry-started', { taskId: task.id, layer, attempt: task.metadata.retries });
  }

  private clearCompletedTask(taskId: string): void {
    this.retryAttempts.delete(taskId);
    this.routedTasks.delete(taskId);
  }

  public consumeTaskOutcome(taskId: string): { result?: unknown; error?: string } | undefined {
    const outcome = this.taskOutcomes.get(taskId);
    this.taskOutcomes.delete(taskId);
    return outcome;
  }

  public getRoutingStats() {
    const history = Array.from(this.taskHistory.values());
    const byLayer = history.reduce((acc, decision) => {
      const layer = decision.selectedNode.layer;
      acc[layer] = (acc[layer] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byProvider = history.reduce((acc, decision) => {
      const provider = decision.selectedNode.provider;
      acc[provider] = (acc[provider] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRouted: history.length,
      byLayer,
      byProvider,
      avgConfidence: history.reduce((sum, d) => sum + d.confidence, 0) / (history.length || 1),
      antennaHotTaskTypes: [...ANTENNA_HOT_TASKS],
      nonReplayableMarketTaskTypes: [...NON_REPLAYABLE_MARKET_TASKS],
      executionAuthority: false,
    };
  }

  public getSystemStatus() {
    return {
      router: this.getRoutingStats(),
      antenna: omniAntennaLayer.getStatus(),
      beam: directionalBeamLayer.getStatus(),
      battery: superBatteryLayer.getOptimizationStats(),
      activeRetries: this.retryAttempts.size,
    };
  }

  public createTask(
    type: TaskType,
    payload: any,
    options?: {
      intensity?: TaskIntensity;
      priority?: number;
      requiredLayer?: ComputeLayer;
    },
  ): Task {
    const taskId = this.generateTaskId();
    const latencyCritical = ANTENNA_HOT_TASKS.has(type);
    return {
      id: taskId,
      type,
      intensity: latencyCritical ? TaskIntensity.LIGHTWEIGHT : (options?.intensity || TaskIntensity.MODERATE),
      payload,
      metadata: {
        created: new Date(),
        priority: options?.priority ?? (latencyCritical ? 100 : 5),
        retries: 0,
        maxRetries: NON_REPLAYABLE_MARKET_TASKS.has(type) ? 0 : this.MAX_RETRIES,
      },
      routing: options?.requiredLayer ? {
        requiredLayer: options.requiredLayer,
        cpuIntensive: false,
        memoryIntensive: false,
        ioIntensive: false,
      } : undefined,
    };
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public getTaskHistory(taskId: string): RoutingDecision | undefined {
    return this.taskHistory.get(taskId);
  }

  public clearHistory(): void {
    this.taskHistory.clear();
    this.retryAttempts.clear();
    this.routedTasks.clear();
    this.taskOutcomes.clear();
    this.emit('history-cleared');
  }
}

export const workloadRouter = new WorkloadRouter();