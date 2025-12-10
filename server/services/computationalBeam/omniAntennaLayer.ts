/**
 * Omni-Directional Antenna Layer
 * 
 * Lightweight API gateway that accepts crawler tasks and auto-distributes
 * initial tasks to low-power nodes (Cloudflare, GitHub Actions, Railway).
 * Handles small events like websocket pings and basic parsing.
 */

import { 
  Task, 
  TaskType, 
  TaskIntensity, 
  ComputeNode, 
  ComputeProvider, 
  ComputeLayer,
  RoutingDecision 
} from './types';
import { EventEmitter } from 'events';

export class OmniAntennaLayer extends EventEmitter {
  private antennaNodes: Map<string, ComputeNode> = new Map();
  private requestQueue: Task[] = [];
  private activeRequests: Map<string, Task> = new Map();
  private roundRobinIndex = 0;

  constructor() {
    super();
    this.initializeAntennaNodes();
  }

  /**
   * Initialize lightweight antenna nodes
   */
  private initializeAntennaNodes(): void {
    // Cloudflare Workers Node
    this.antennaNodes.set('cloudflare-antenna-1', {
      id: 'cloudflare-antenna-1',
      provider: ComputeProvider.CLOUDFLARE_WORKERS,
      layer: ComputeLayer.ANTENNA,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: 100,
        cpuCores: 1,
        memoryMB: 128,
        supportedTaskTypes: [
          TaskType.WEBSOCKET_PING,
          TaskType.BASIC_PARSING,
        ],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 50,
        successRate: 99.5,
        totalTasksCompleted: 0,
      },
      health: {
        lastHealthCheck: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });

    // Railway Antenna Node
    this.antennaNodes.set('railway-antenna-1', {
      id: 'railway-antenna-1',
      provider: ComputeProvider.RAILWAY,
      layer: ComputeLayer.ANTENNA,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: 50,
        cpuCores: 2,
        memoryMB: 512,
        supportedTaskTypes: [
          TaskType.WEBSOCKET_PING,
          TaskType.BASIC_PARSING,
        ],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 100,
        successRate: 98.5,
        totalTasksCompleted: 0,
      },
      health: {
        lastHealthCheck: new Date(),
        cpuUsage: 0,
        memoryUsage: 0,
      },
    });

    // Google Cloud Functions Antenna Node
    this.antennaNodes.set('gcf-antenna-1', {
      id: 'gcf-antenna-1',
      provider: ComputeProvider.GOOGLE_CLOUD_FUNCTIONS,
      layer: ComputeLayer.ANTENNA,
      status: 'active',
      capabilities: {
        maxConcurrentTasks: 200,
        cpuCores: 1,
        memoryMB: 256,
        supportedTaskTypes: [
          TaskType.WEBSOCKET_PING,
          TaskType.BASIC_PARSING,
        ],
      },
      metrics: {
        currentLoad: 0,
        avgResponseTime: 75,
        successRate: 99.0,
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
   * Accept incoming crawler task
   */
  public async acceptTask(task: Task): Promise<string> {
    // Validate task is suitable for antenna layer
    if (!this.isLightweightTask(task)) {
      throw new Error(`Task ${task.id} is too heavy for antenna layer`);
    }

    // Add to queue
    this.requestQueue.push(task);
    this.emit('task-queued', task);

    // Process queue
    await this.processQueue();

    return task.id;
  }

  /**
   * Check if task is lightweight enough for antenna layer
   */
  private isLightweightTask(task: Task): boolean {
    return task.intensity === TaskIntensity.LIGHTWEIGHT ||
           task.type === TaskType.WEBSOCKET_PING ||
           task.type === TaskType.BASIC_PARSING;
  }

  /**
   * Process task queue
   */
  private async processQueue(): Promise<void> {
    while (this.requestQueue.length > 0) {
      const task = this.requestQueue.shift();
      if (!task) break;

      const node = this.selectNode(task);
      if (node) {
        await this.routeToNode(task, node);
      } else {
        // No available nodes, put back in queue
        this.requestQueue.unshift(task);
        break;
      }
    }
  }

  /**
   * Select best node for task using round-robin with load awareness
   */
  private selectNode(task: Task): ComputeNode | null {
    const availableNodes = Array.from(this.antennaNodes.values())
      .filter(node => 
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type) &&
        node.metrics.currentLoad < node.capabilities.maxConcurrentTasks
      );

    if (availableNodes.length === 0) {
      return null;
    }

    // Round-robin selection
    this.roundRobinIndex = (this.roundRobinIndex + 1) % availableNodes.length;
    return availableNodes[this.roundRobinIndex];
  }

  /**
   * Route task to selected node
   */
  private async routeToNode(task: Task, node: ComputeNode): Promise<void> {
    this.activeRequests.set(task.id, task);
    node.metrics.currentLoad++;

    this.emit('task-routed', {
      taskId: task.id,
      nodeId: node.id,
      provider: node.provider,
    });

    // Simulate async task execution
    setTimeout(() => {
      this.completeTask(task.id, node.id);
    }, Math.random() * 1000 + 100);
  }

  /**
   * Mark task as completed
   */
  private completeTask(taskId: string, nodeId: string): void {
    this.activeRequests.delete(taskId);
    
    const node = this.antennaNodes.get(nodeId);
    if (node) {
      node.metrics.currentLoad--;
      node.metrics.totalTasksCompleted++;
    }

    this.emit('task-completed', { taskId, nodeId });
  }

  /**
   * Get routing decision for task
   */
  public getRoutingDecision(task: Task): RoutingDecision | null {
    const selectedNode = this.selectNode(task);
    if (!selectedNode) {
      return null;
    }

    const alternativeNodes = Array.from(this.antennaNodes.values())
      .filter(node => 
        node.id !== selectedNode.id &&
        node.status === 'active' &&
        node.capabilities.supportedTaskTypes.includes(task.type)
      );

    return {
      taskId: task.id,
      selectedNode,
      reason: `Selected based on round-robin with current load: ${selectedNode.metrics.currentLoad}/${selectedNode.capabilities.maxConcurrentTasks}`,
      alternativeNodes,
      confidence: 0.85,
    };
  }

  /**
   * Get current status
   */
  public getStatus() {
    return {
      totalNodes: this.antennaNodes.size,
      activeNodes: Array.from(this.antennaNodes.values()).filter(n => n.status === 'active').length,
      queuedTasks: this.requestQueue.length,
      activeTasks: this.activeRequests.size,
      nodes: Array.from(this.antennaNodes.values()).map(node => ({
        id: node.id,
        provider: node.provider,
        status: node.status,
        currentLoad: node.metrics.currentLoad,
        maxLoad: node.capabilities.maxConcurrentTasks,
        completed: node.metrics.totalTasksCompleted,
      })),
    };
  }

  /**
   * Health check all nodes
   */
  public async healthCheck(): Promise<void> {
    for (const node of this.antennaNodes.values()) {
      node.health.lastHealthCheck = new Date();
      
      // Simulate health check
      const isHealthy = Math.random() > 0.05; // 95% uptime
      node.status = isHealthy ? 'active' : 'offline';
      
      if (isHealthy) {
        node.health.cpuUsage = Math.random() * 50; // 0-50% for lightweight
        node.health.memoryUsage = Math.random() * 40; // 0-40% for lightweight
      }
    }

    this.emit('health-check-complete', this.getStatus());
  }

  /**
   * Get all antenna nodes
   */
  public getNodes(): ComputeNode[] {
    return Array.from(this.antennaNodes.values());
  }
}

// Export singleton instance
export const omniAntennaLayer = new OmniAntennaLayer();
