/**
 * Directional Beam Compute Layer
 * 
 * Heavy compute layer for CPU-intensive tasks like Monte Carlo tests,
 * ML-driven prediction, cross-chain arbitrage scanning, and multi-market aggregation.
 * Uses multi-threading, concurrency primitives, and monitors CPU temperature.
 */

import { 
  Task, 
  TaskType, 
  TaskIntensity, 
  ComputeNode, 
  ComputeProvider, 
  ComputeLayer,
  TaskExecution,
  RoutingDecision 
} from './types';
import { EventEmitter } from 'events';
import os from 'os';

// Constants
const MAX_LOCAL_CONCURRENCY = Math.max(1, Math.min(
  os.cpus().length,
  Number(process.env.COMPUTATIONAL_BEAM_MAX_CONCURRENCY || os.cpus().length) || 1,
));

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

  /**
   * Initialize heavy compute beam nodes
   */
  private initializeBeamNodes(): void {
    this.beamNodes.set('local-beam-1', {
      id: 'local-beam-1',
      provider: ComputeProvider.LOCAL_MACHINE,
      layer: ComputeLayer.BEAM,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: this.maxConcurrency,
        cpuCores: os.cpus().length,
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

  /**
   * Accept heavy compute task
   */
  public async acceptTask(task: Task): Promise<string> {
    // Validate task is suitable for beam layer
    if (!this.isHeavyTask(task)) {
      throw new Error(`Task ${task.id} is too lightweight for beam layer`);
    }

    // Add to execution queue
    this.executionQueue.push(task);
    this.emit('task-queued', task);

    // Process queue
    await this.processQueue();

    return task.id;
  }

  /**
   * Check if task requires heavy compute
   */
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

  /**
   * Process execution queue
   */
  private async processQueue(): Promise<void> {
    while (this.executionQueue.length > 0) {
      const task = this.executionQueue[0];
      
      const node = this.selectOptimalNode(task);
      if (node) {
        this.executionQueue.shift();
        void this.executeOnNode(task, node).finally(() => void this.processQueue());
      } else {
        // No available nodes with capacity
        break;
      }
    }
  }

  /**
   * Select optimal node based on load, capabilities, and health
   */
  private selectOptimalNode(task: Task): ComputeNode | null {
    const availableNodes = Array.from(this.beamNodes.values())
      .filter(node => 
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type) &&
        node.metrics.currentLoad < node.capabilities.maxConcurrentTasks &&
        !this.activeControllers.has(task.id)
      );

    if (availableNodes.length === 0) {
      return null;
    }

    // Sort by least loaded with best health
    availableNodes.sort((a, b) => {
      const aScore = (a.metrics.currentLoad / a.capabilities.maxConcurrentTasks) * 0.6 +
                     ((a.health.temperature ?? 50) / 100) * 0.2 +
                     ((100 - a.metrics.successRate) / 100) * 0.2;
      const bScore = (b.metrics.currentLoad / b.capabilities.maxConcurrentTasks) * 0.6 +
                     ((b.health.temperature ?? 50) / 100) * 0.2 +
                     ((100 - b.metrics.successRate) / 100) * 0.2;
      return aScore - bScore;
    });

    return availableNodes[0];
  }

  /**
   * Execute task on selected node
   */
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
    node.metrics.currentLoad++;

    this.emit('task-started', {
      taskId: task.id,
      nodeId: node.id,
      provider: node.provider,
    });

    const startCpu = process.cpuUsage();
    const startMem = process.memoryUsage();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), task.workload?.timeoutMs || 0);
    this.activeControllers.set(task.id, controller);

    try {
      if (!task.workload) {
        throw new Error(`Task ${task.id} has no executable workload`);
      }

      const result = await task.workload.execute(task.workload.input, {
        signal: controller.signal,
        workerId: node.id,
        startedAt: execution.startTime,
      });
      if (controller.signal.aborted) {
        throw new Error(`Task ${task.id} timed out or was cancelled`);
      }
      if (!await task.workload.validate(result, task.workload.input)) {
        throw new Error(`Task ${task.id} produced an invalid workload result`);
      }

      const cpuUsed = process.cpuUsage(startCpu);
      execution.metrics.cpuTimeMs = (cpuUsed.user + cpuUsed.system) / 1000;
      execution.metrics.memoryPeakMB = Math.max(0, Math.floor((process.memoryUsage().heapUsed - startMem.heapUsed) / (1024 * 1024)));

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.result = result;

      node.metrics.totalTasksCompleted++;
      node.metrics.avgResponseTime = ((node.metrics.avgResponseTime * (node.metrics.totalTasksCompleted - 1)) +
        (execution.endTime.getTime() - execution.startTime.getTime())) / node.metrics.totalTasksCompleted;
      
      this.emit('task-completed', {
        taskId: task.id,
        nodeId: node.id,
        duration: execution.endTime.getTime() - execution.startTime.getTime(),
        result,
        metrics: execution.metrics,
      });
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.endTime = new Date();

      this.emit('task-failed', {
        taskId: task.id,
        nodeId: node.id,
        error: execution.error,
      });
    } finally {
      clearTimeout(timeout);
      this.activeControllers.delete(task.id);
      node.metrics.currentLoad--;
      this.activeExecutions.delete(task.id);
    }
  }

  public cancelTask(taskId: string): boolean {
    const controller = this.activeControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Start monitoring CPU and memory
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.updateNodeHealth();
    }, 5000); // Update every 5 seconds
    this.monitoringInterval.unref();
  }

  /**
   * Update health metrics for all nodes
   */
  private updateNodeHealth(): void {
    for (const node of this.beamNodes.values()) {
      node.health.lastHealthCheck = new Date();
      
      const cpus = os.cpus();
      const totalIdle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
      const totalTick = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((part, value) => part + value, 0), 0);
      node.health.cpuUsage = totalTick === 0 ? 0 : 100 - (totalIdle / totalTick) * 100;
      node.health.memoryUsage = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;

      // Log overuse warnings
      if (node.health.cpuUsage > 90) {
        this.emit('cpu-overuse', {
          nodeId: node.id,
          usage: node.health.cpuUsage,
          temperature: node.health.temperature,
        });
      }
    }
  }

  /**
   * Get routing decision
   */
  public getRoutingDecision(task: Task): RoutingDecision | null {
    const selectedNode = this.selectOptimalNode(task);
    if (!selectedNode) {
      return null;
    }

    const alternativeNodes = Array.from(this.beamNodes.values())
      .filter(node => 
        node.id !== selectedNode.id &&
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type)
      );

    return {
      taskId: task.id,
      selectedNode,
      reason: `Selected local measured capacity with load ${selectedNode.metrics.currentLoad}/${selectedNode.capabilities.maxConcurrentTasks}`,
      alternativeNodes,
      confidence: 0.92,
    };
  }

  /**
   * Get current status
   */
  public getStatus() {
    return {
      totalNodes: this.beamNodes.size,
      activeNodes: Array.from(this.beamNodes.values()).filter(n => n.status === 'active').length,
      queuedTasks: this.executionQueue.length,
      executingTasks: this.activeExecutions.size,
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

  /**
   * Get all beam nodes
   */
  public getNodes(): ComputeNode[] {
    return Array.from(this.beamNodes.values());
  }

  /**
   * Get execution history
   */
  public getActiveExecutions(): TaskExecution[] {
    return Array.from(this.activeExecutions.values());
  }
}

// Export singleton instance
export const directionalBeamLayer = new DirectionalBeamLayer();
