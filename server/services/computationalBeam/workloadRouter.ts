/**
 * Workload Router
 * 
 * Accepts crawler tasks, assesses compute intensity, and chooses between
 * lightweight endpoints (antenna layer) or heavyweight VMs (beam layer).
 * Implements retry logic and fallback mechanisms.
 */

import { 
  Task, 
  TaskType, 
  TaskIntensity, 
  RoutingDecision,
  ComputeLayer,
  TaskRoutingError 
} from './types';
import { EventEmitter } from 'events';
import { omniAntennaLayer } from './omniAntennaLayer';
import { directionalBeamLayer } from './directionalBeamLayer';
import { superBatteryLayer } from './superBatteryLayer';

// Constants
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

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

  /**
   * Setup event listeners for layers
   */
  private setupEventListeners(): void {
    // Antenna layer events
    omniAntennaLayer.on('task-completed', (data) => {
      this.taskOutcomes.set(data.taskId, { result: data.result });
      this.clearCompletedTask(data.taskId);
      this.emit('task-completed', { ...data, layer: 'antenna' });
    });

    omniAntennaLayer.on('task-failed', (data) => {
      void this.handleTaskFailure(data.taskId, 'antenna', data.error);
    });

    // Beam layer events
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

  /**
   * Route task to appropriate layer
   */
  public async routeTask(task: Task): Promise<RoutingDecision> {
    try {
      // Step 1: Optimize task with battery layer
      const optimizedTask = await superBatteryLayer.optimizeTask(task);

      // Step 2: Assess compute intensity
      const intensity = this.assessIntensity(optimizedTask);
      optimizedTask.intensity = intensity;

      // Step 3: Select appropriate layer
      const layer = this.selectLayer(optimizedTask);

      // Step 4: Get routing decision
      const decision = await this.getRoutingDecision(optimizedTask, layer);

      // Step 5: Execute routing
      await this.executeRouting(optimizedTask, layer);

      // Store decision
      this.taskHistory.set(task.id, decision);
      this.routedTasks.set(task.id, optimizedTask);

      this.emit('task-routed', {
        taskId: task.id,
        layer,
        intensity,
        provider: decision.selectedNode.provider,
      });

      return decision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.taskOutcomes.set(task.id, { error: message });
      this.emit('task-failed', { taskId: task.id, error: message });
      throw new TaskRoutingError(
        `Failed to route task ${task.id}`,
        { taskId: task.id, error }
      );
    }
  }

  /**
   * Assess task compute intensity
   */
  private assessIntensity(task: Task): TaskIntensity {
    // If intensity already set, use it
    if (task.intensity) {
      return task.intensity;
    }

    // Assess based on task type
    switch (task.type) {
      case TaskType.WEBSOCKET_PING:
      case TaskType.BASIC_PARSING:
        return TaskIntensity.LIGHTWEIGHT;

      case TaskType.ARBITRAGE_SCAN:
      case TaskType.MARKET_AGGREGATION:
        return TaskIntensity.MODERATE;

      case TaskType.MONTE_CARLO:
      case TaskType.ML_PREDICTION:
        return TaskIntensity.HEAVY;

      case TaskType.MOMENTUM_STRATEGY:
      case TaskType.ALPHA_DRIFT:
      case TaskType.MICRO_TRIANGULATION:
        return TaskIntensity.EXTREME;

      default:
        return TaskIntensity.MODERATE;
    }
  }

  /**
   * Select appropriate compute layer
   */
  private selectLayer(task: Task): ComputeLayer {
    if (task.routing?.requiredLayer) {
      return task.routing.requiredLayer;
    }

    switch (task.intensity) {
      case TaskIntensity.LIGHTWEIGHT:
        return ComputeLayer.ANTENNA;
      
      case TaskIntensity.MODERATE:
        // Use antenna if task type is suitable, otherwise beam
        if ([TaskType.WEBSOCKET_PING, TaskType.BASIC_PARSING].includes(task.type)) {
          return ComputeLayer.ANTENNA;
        }
        return ComputeLayer.BEAM;
      
      case TaskIntensity.HEAVY:
      case TaskIntensity.EXTREME:
        return ComputeLayer.BEAM;
      
      default:
        return ComputeLayer.ANTENNA;
    }
  }

  /**
   * Get routing decision from selected layer
   */
  private async getRoutingDecision(task: Task, layer: ComputeLayer): Promise<RoutingDecision> {
    let decision: RoutingDecision | null = null;

    if (layer === ComputeLayer.ANTENNA) {
      decision = omniAntennaLayer.getRoutingDecision(task);
    } else if (layer === ComputeLayer.BEAM) {
      decision = directionalBeamLayer.getRoutingDecision(task);
    }

    if (!decision) {
      throw new TaskRoutingError(
        `No available nodes in ${layer} layer for task ${task.id}`,
        { taskId: task.id, layer }
      );
    }

    return decision;
  }

  /**
   * Execute routing to selected layer
   */
  private async executeRouting(task: Task, layer: ComputeLayer): Promise<void> {
    if (layer === ComputeLayer.ANTENNA) {
      await omniAntennaLayer.acceptTask(task);
    } else if (layer === ComputeLayer.BEAM) {
      await directionalBeamLayer.acceptTask(task);
    }
  }

  /**
   * Handle task failure with retry logic
   */
  private async handleTaskFailure(taskId: string, layer: string, error?: string): Promise<void> {
    const attempts = this.retryAttempts.get(taskId) || 0;
    const task = this.routedTasks.get(taskId);
    const maxRetries = Math.min(task?.metadata.maxRetries ?? 0, this.MAX_RETRIES);

    if (task && attempts < maxRetries) {
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
      this.emit('task-failed', { taskId, layer, attempts, error });
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

  /**
   * Get routing statistics
   */
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
    };
  }

  /**
   * Get comprehensive system status
   */
  public getSystemStatus() {
    return {
      router: this.getRoutingStats(),
      antenna: omniAntennaLayer.getStatus(),
      beam: directionalBeamLayer.getStatus(),
      battery: superBatteryLayer.getOptimizationStats(),
      activeRetries: this.retryAttempts.size,
    };
  }

  /**
   * Create a task
   */
  public createTask(
    type: TaskType,
    payload: any,
    options?: {
      intensity?: TaskIntensity;
      priority?: number;
      requiredLayer?: ComputeLayer;
    }
  ): Task {
    const taskId = this.generateTaskId();
    
    return {
      id: taskId,
      type,
      intensity: options?.intensity || TaskIntensity.MODERATE,
      payload,
      metadata: {
        created: new Date(),
        priority: options?.priority || 5,
        retries: 0,
        maxRetries: this.MAX_RETRIES,
      },
      routing: options?.requiredLayer ? {
        requiredLayer: options.requiredLayer,
        cpuIntensive: false,
        memoryIntensive: false,
        ioIntensive: false,
      } : undefined,
    };
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get task routing history
   */
  public getTaskHistory(taskId: string): RoutingDecision | undefined {
    return this.taskHistory.get(taskId);
  }

  /**
   * Clear routing history
   */
  public clearHistory(): void {
    this.taskHistory.clear();
    this.retryAttempts.clear();
    this.routedTasks.clear();
    this.taskOutcomes.clear();
    this.emit('history-cleared');
  }
}

// Export singleton instance
export const workloadRouter = new WorkloadRouter();
