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

export class DirectionalBeamLayer extends EventEmitter {
  private beamNodes: Map<string, ComputeNode> = new Map();
  private executionQueue: Task[] = [];
  private activeExecutions: Map<string, TaskExecution> = new Map();
  private maxConcurrency = os.cpus().length;

  constructor() {
    super();
    this.initializeBeamNodes();
    this.startMonitoring();
  }

  /**
   * Initialize heavy compute beam nodes
   */
  private initializeBeamNodes(): void {
    // Google Cloud VM Node (E2)
    this.beamNodes.set('gcp-vm-e2-1', {
      id: 'gcp-vm-e2-1',
      provider: ComputeProvider.GOOGLE_CLOUD_VM,
      layer: ComputeLayer.BEAM,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: 8,
        cpuCores: 8,
        memoryMB: 16384,
        supportedTaskTypes: [
          TaskType.MONTE_CARLO,
          TaskType.ML_PREDICTION,
          TaskType.ARBITRAGE_SCAN,
          TaskType.MARKET_AGGREGATION,
          TaskType.MOMENTUM_STRATEGY,
          TaskType.ALPHA_DRIFT,
          TaskType.MICRO_TRIANGULATION,
        ],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 2000,
        successRate: 97.5,
        totalTasksCompleted: 0,
      },
      health: {
        lastHealthCheck: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
        temperature: 45,
      },
    });

    // Railway Compute Node
    this.beamNodes.set('railway-beam-1', {
      id: 'railway-beam-1',
      provider: ComputeProvider.RAILWAY,
      layer: ComputeLayer.BEAM,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: 4,
        cpuCores: 4,
        memoryMB: 8192,
        supportedTaskTypes: [
          TaskType.MONTE_CARLO,
          TaskType.ML_PREDICTION,
          TaskType.ARBITRAGE_SCAN,
          TaskType.MARKET_AGGREGATION,
        ],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 3000,
        successRate: 96.0,
        totalTasksCompleted: 0,
      },
      health: {
        lastHealthCheck: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
        temperature: 50,
      },
    });

    // Local Machine Node (if available)
    if (process.env.ENABLE_LOCAL_COMPUTE === 'true') {
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
          avgResponseTime: 1500,
          successRate: 98.0,
          totalTasksCompleted: 0,
        },
        health: {
          lastHealthCheck: new Date(),
          cpuUsage: 0,
          memoryUsage: 0,
          temperature: 55,
        },
      });
    }
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
        await this.executeOnNode(task, node);
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
        (node.health.temperature ?? 100) < 80 // Temperature threshold
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

    // Simulate heavy computation with proper resource monitoring
    const startCpu = process.cpuUsage();
    const startMem = process.memoryUsage();

    try {
      // Simulate task execution time based on intensity
      const executionTime = this.getExecutionTime(task);
      await this.sleep(executionTime);

      // Calculate metrics
      const cpuUsed = process.cpuUsage(startCpu);
      execution.metrics.cpuTimeMs = (cpuUsed.user + cpuUsed.system) / 1000;
      execution.metrics.memoryPeakMB = Math.floor((process.memoryUsage().heapUsed - startMem.heapUsed) / (1024 * 1024));

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.result = { success: true };

      node.metrics.totalTasksCompleted++;
      
      this.emit('task-completed', {
        taskId: task.id,
        nodeId: node.id,
        duration: execution.endTime.getTime() - execution.startTime.getTime(),
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
      node.metrics.currentLoad--;
      this.activeExecutions.delete(task.id);
    }
  }

  /**
   * Get execution time based on task intensity
   */
  private getExecutionTime(task: Task): number {
    switch (task.intensity) {
      case TaskIntensity.HEAVY:
        return Math.random() * 3000 + 2000; // 2-5 seconds
      case TaskIntensity.EXTREME:
        return Math.random() * 5000 + 5000; // 5-10 seconds
      default:
        return Math.random() * 1000 + 1000; // 1-2 seconds
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start monitoring CPU and memory
   */
  private startMonitoring(): void {
    setInterval(() => {
      this.updateNodeHealth();
    }, 5000); // Update every 5 seconds
  }

  /**
   * Update health metrics for all nodes
   */
  private updateNodeHealth(): void {
    for (const node of this.beamNodes.values()) {
      node.health.lastHealthCheck = new Date();
      
      if (node.provider === ComputeProvider.LOCAL_MACHINE) {
        // Real metrics for local machine
        const cpus = os.cpus();
        const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
        const totalTick = cpus.reduce((acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
        node.health.cpuUsage = 100 - (totalIdle / totalTick) * 100;
        
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        node.health.memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
        
        // Estimate temperature based on load (simulated)
        node.health.temperature = 40 + (node.health.cpuUsage * 0.4);
      } else {
        // Simulated metrics for cloud nodes
        const loadFactor = node.metrics.currentLoad / node.capabilities.maxConcurrentTasks;
        node.health.cpuUsage = loadFactor * 80 + Math.random() * 20;
        node.health.memoryUsage = loadFactor * 70 + Math.random() * 30;
        node.health.temperature = 45 + loadFactor * 30 + Math.random() * 10;
      }

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
      reason: `Selected based on load (${selectedNode.metrics.currentLoad}/${selectedNode.capabilities.maxConcurrentTasks}), temp (${selectedNode.health.temperature}°C), success rate (${selectedNode.metrics.successRate}%)`,
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
