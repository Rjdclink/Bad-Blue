// Microtask Engine - Subdivide tasks into infinitely small independent units
// Enables massive parallelization and radial expansion from central nodes

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

export interface Microtask {
  id: string;
  parentId?: string; // Parent task if subdivided
  type: 'scan' | 'validate' | 'execute' | 'monitor' | 'aggregate';
  priority: number;
  size: 'nano' | 'micro' | 'mini' | 'small'; // Task granularity
  chain: ChainId;
  data: Record<string, any>;
  dependencies: string[]; // IDs of tasks that must complete first
  status: 'pending' | 'assigned' | 'executing' | 'completed' | 'failed';
  assignedTo?: string; // Agent ID
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  canSubdivide: boolean;
}

export interface MicrotaskNode {
  id: string;
  type: 'central' | 'branch' | 'leaf';
  tasks: Microtask[];
  children: string[]; // Child node IDs
  parentId?: string;
  depth: number; // Distance from central node
  capacity: number; // Max tasks this node can handle
  load: number; // Current task count
}

export interface RadialLayer {
  layer: number; // Distance from center (0 = center)
  nodes: MicrotaskNode[];
  totalTasks: number;
  completionRate: number;
}

export interface TaskSubdivisionResult {
  originalTask: Microtask;
  subtasks: Microtask[];
  subdivisionFactor: number;
}

/**
 * Microtask Engine - Manages infinitely small task subdivision
 */
export class MicrotaskEngine {
  private static tasks = new Map<string, Microtask>();
  private static nodes = new Map<string, MicrotaskNode>();
  private static centralNode: MicrotaskNode | null = null;
  private static maxDepth = 10; // Maximum radial expansion depth
  private static subdivisionThreshold = 100; // Subdivide tasks larger than this
  private static isRunning = false;

  /**
   * Initialize with a central node
   */
  static initialize(capacity: number = 1000): void {
    if (this.centralNode) {
      logger.warn('Microtask engine already initialized', { component: 'MicrotaskEngine' });
      return;
    }

    this.centralNode = {
      id: 'central-node',
      type: 'central',
      tasks: [],
      children: [],
      depth: 0,
      capacity,
      load: 0
    };

    this.nodes.set(this.centralNode.id, this.centralNode);

    logger.info('Microtask engine initialized', {
      component: 'MicrotaskEngine',
      centralCapacity: capacity
    });
  }

  /**
   * Create a task and automatically subdivide if needed
   */
  static createTask(
    type: Microtask['type'],
    chain: ChainId,
    priority: number,
    data: Record<string, any>,
    complexity: number = 1
  ): Microtask[] {
    const taskSize = this.determineTaskSize(complexity);
    const canSubdivide = complexity > this.subdivisionThreshold;

    const task: Microtask = {
      id: `task-${Date.now()}-${randomUUID().split('-')[0]}`,
      type,
      priority,
      size: taskSize,
      chain,
      data,
      dependencies: [],
      status: 'pending',
      createdAt: Date.now(),
      canSubdivide
    };

    this.tasks.set(task.id, task);

    // Automatically subdivide if task is too large
    if (canSubdivide) {
      const subdivisionResult = this.subdivide(task);
      
      logger.info('Task auto-subdivided', {
        component: 'MicrotaskEngine',
        originalId: task.id,
        subtasks: subdivisionResult.subtasks.length,
        factor: subdivisionResult.subdivisionFactor
      });

      return subdivisionResult.subtasks;
    }

    // Assign to central node
    this.assignToNode(task, this.centralNode!.id);

    return [task];
  }

  /**
   * Determine task size based on complexity
   */
  private static determineTaskSize(complexity: number): Microtask['size'] {
    if (complexity <= 10) return 'nano';
    if (complexity <= 50) return 'micro';
    if (complexity <= 100) return 'mini';
    return 'small';
  }

  /**
   * Subdivide a task into smaller microtasks
   */
  static subdivide(task: Microtask): TaskSubdivisionResult {
    if (!task.canSubdivide) {
      return {
        originalTask: task,
        subtasks: [task],
        subdivisionFactor: 1
      };
    }

    // Calculate subdivision factor based on task type and complexity
    const subdivisionFactor = this.calculateSubdivisionFactor(task);
    const subtasks: Microtask[] = [];

    for (let i = 0; i < subdivisionFactor; i++) {
      const subtask: Microtask = {
        id: `${task.id}-sub-${i}`,
        parentId: task.id,
        type: task.type,
        priority: task.priority,
        size: this.downsizeTask(task.size),
        chain: task.chain,
        data: {
          ...task.data,
          partition: i,
          totalPartitions: subdivisionFactor
        },
        dependencies: i > 0 ? [`${task.id}-sub-${i - 1}`] : [], // Sequential dependencies
        status: 'pending',
        createdAt: Date.now(),
        canSubdivide: false // Subtasks cannot be further subdivided
      };

      subtasks.push(subtask);
      this.tasks.set(subtask.id, subtask);
    }

    // Update original task
    task.status = 'completed'; // Parent task is now just a coordinator

    logger.debug('Task subdivided', {
      component: 'MicrotaskEngine',
      taskId: task.id,
      subtasks: subtasks.length,
      size: task.size
    });

    return {
      originalTask: task,
      subtasks,
      subdivisionFactor
    };
  }

  /**
   * Calculate subdivision factor
   */
  private static calculateSubdivisionFactor(task: Microtask): number {
    const sizeFactors = {
      nano: 2,
      micro: 4,
      mini: 8,
      small: 16
    };

    const typeFactor = task.type === 'scan' ? 2 : 1; // Scanning benefits from more subdivision

    return sizeFactors[task.size] * typeFactor;
  }

  /**
   * Downsize task granularity
   */
  private static downsizeTask(size: Microtask['size']): Microtask['size'] {
    const sizeOrder: Microtask['size'][] = ['small', 'mini', 'micro', 'nano'];
    const currentIndex = sizeOrder.indexOf(size);
    const nextIndex = Math.min(currentIndex + 1, sizeOrder.length - 1);
    return sizeOrder[nextIndex];
  }

  /**
   * Assign task to a node
   */
  static assignToNode(task: Microtask, nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // Check if node has capacity
    if (node.load >= node.capacity) {
      // Expand radially - create child node
      const childNode = this.expandRadially(node);
      return this.assignToNode(task, childNode.id);
    }

    node.tasks.push(task);
    node.load++;
    task.status = 'assigned';

    logger.debug('Task assigned to node', {
      component: 'MicrotaskEngine',
      taskId: task.id,
      nodeId,
      nodeLoad: node.load,
      nodeCapacity: node.capacity
    });

    return true;
  }

  /**
   * Expand radially - create child nodes when capacity is reached
   */
  static expandRadially(parentNode: MicrotaskNode): MicrotaskNode {
    const depth = parentNode.depth + 1;

    if (depth > this.maxDepth) {
      logger.warn('Max radial depth reached', {
        component: 'MicrotaskEngine',
        depth,
        maxDepth: this.maxDepth
      });
      // Return parent node (no expansion)
      return parentNode;
    }

    const childNode: MicrotaskNode = {
      id: `node-depth${depth}-${Date.now()}-${randomUUID().split('-')[0]}`,
      type: depth === this.maxDepth ? 'leaf' : 'branch',
      tasks: [],
      children: [],
      parentId: parentNode.id,
      depth,
      capacity: parentNode.capacity, // Same capacity as parent
      load: 0
    };

    this.nodes.set(childNode.id, childNode);
    parentNode.children.push(childNode.id);

    logger.info('Radial expansion', {
      component: 'MicrotaskEngine',
      parentId: parentNode.id,
      childId: childNode.id,
      depth
    });

    return childNode;
  }

  /**
   * Get available nodes for task assignment (radial distribution)
   */
  static getAvailableNodes(maxDepth?: number): MicrotaskNode[] {
    const depth = maxDepth ?? this.maxDepth;
    const available: MicrotaskNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.depth <= depth && node.load < node.capacity) {
        available.push(node);
      }
    }

    // Sort by load (least loaded first)
    return available.sort((a, b) => a.load - b.load);
  }

  /**
   * Distribute tasks radially from central node
   */
  static distributeRadially(tasks: Microtask[]): void {
    for (const task of tasks) {
      const availableNodes = this.getAvailableNodes();
      
      if (availableNodes.length === 0) {
        // All nodes at capacity - expand from central node
        const newNode = this.expandRadially(this.centralNode!);
        this.assignToNode(task, newNode.id);
      } else {
        // Assign to least loaded node
        this.assignToNode(task, availableNodes[0].id);
      }
    }

    logger.info('Tasks distributed radially', {
      component: 'MicrotaskEngine',
      tasksDistributed: tasks.length,
      totalNodes: this.nodes.size
    });
  }

  /**
   * Execute a microtask
   */
  static async executeTask(taskId: string, agentId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'assigned') return false;

    // Check dependencies
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== 'completed') {
        logger.debug('Task dependencies not met', {
          component: 'MicrotaskEngine',
          taskId,
          missingDependency: depId
        });
        return false;
      }
    }

    task.status = 'executing';
    task.assignedTo = agentId;
    task.startedAt = Date.now();

    try {
      // Execute based on type
      const result = await this.performTaskExecution(task);
      
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;

      // Update node load
      const node = this.findNodeByTask(taskId);
      if (node) {
        node.load--;
      }

      logger.debug('Task executed', {
        component: 'MicrotaskEngine',
        taskId,
        agentId,
        duration: task.completedAt - task.startedAt!
      });

      return true;

    } catch (error) {
      task.status = 'failed';
      logger.error('Task execution failed', {
        component: 'MicrotaskEngine',
        taskId,
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Perform actual task execution
   */
  private static async performTaskExecution(task: Microtask): Promise<any> {
    // Placeholder - would integrate with actual execution logic
    return {
      success: true,
      taskType: task.type,
      partition: task.data.partition
    };
  }

  /**
   * Find node containing a task
   */
  private static findNodeByTask(taskId: string): MicrotaskNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.tasks.some(t => t.id === taskId)) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Get radial layers (visualization of task distribution)
   */
  static getRadialLayers(): RadialLayer[] {
    const layers = new Map<number, RadialLayer>();

    for (const node of this.nodes.values()) {
      if (!layers.has(node.depth)) {
        layers.set(node.depth, {
          layer: node.depth,
          nodes: [],
          totalTasks: 0,
          completionRate: 0
        });
      }

      const layer = layers.get(node.depth)!;
      layer.nodes.push(node);
      layer.totalTasks += node.tasks.length;

      // Calculate completion rate
      const completedTasks = node.tasks.filter(t => t.status === 'completed').length;
      layer.completionRate = node.tasks.length > 0 
        ? completedTasks / node.tasks.length 
        : 0;
    }

    return Array.from(layers.values()).sort((a, b) => a.layer - b.layer);
  }

  /**
   * Get statistics
   */
  static getStatistics(): {
    totalTasks: number;
    pendingTasks: number;
    executingTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalNodes: number;
    maxDepth: number;
    averageLoadPerNode: number;
  } {
    const stats = {
      totalTasks: this.tasks.size,
      pendingTasks: 0,
      executingTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalNodes: this.nodes.size,
      maxDepth: 0,
      averageLoadPerNode: 0
    };

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending':
        case 'assigned':
          stats.pendingTasks++;
          break;
        case 'executing':
          stats.executingTasks++;
          break;
        case 'completed':
          stats.completedTasks++;
          break;
        case 'failed':
          stats.failedTasks++;
          break;
      }
    }

    for (const node of this.nodes.values()) {
      stats.maxDepth = Math.max(stats.maxDepth, node.depth);
    }

    const totalLoad = Array.from(this.nodes.values()).reduce((sum, n) => sum + n.load, 0);
    stats.averageLoadPerNode = this.nodes.size > 0 ? totalLoad / this.nodes.size : 0;

    return stats;
  }

  /**
   * Get pending tasks (for agent assignment)
   */
  static getPendingTasks(limit?: number): Microtask[] {
    const pending = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending' || t.status === 'assigned')
      .sort((a, b) => b.priority - a.priority);

    return limit ? pending.slice(0, limit) : pending;
  }

  /**
   * Aggregate results from subdivided tasks
   */
  static aggregateResults(parentTaskId: string): any {
    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) return null;

    // Find all subtasks
    const subtasks = Array.from(this.tasks.values())
      .filter(t => t.parentId === parentTaskId);

    // Check if all subtasks are completed
    const allCompleted = subtasks.every(t => t.status === 'completed');

    if (!allCompleted) {
      return {
        complete: false,
        progress: subtasks.filter(t => t.status === 'completed').length / subtasks.length
      };
    }

    // Aggregate results
    const aggregatedResults = {
      complete: true,
      subtaskCount: subtasks.length,
      results: subtasks.map(t => t.result),
      totalDuration: subtasks.reduce((sum, t) => 
        sum + ((t.completedAt || 0) - (t.startedAt || 0)), 0
      )
    };

    logger.info('Results aggregated', {
      component: 'MicrotaskEngine',
      parentTaskId,
      subtasks: subtasks.length
    });

    return aggregatedResults;
  }

  /**
   * Reset (for testing)
   */
  static reset(): void {
    this.tasks.clear();
    this.nodes.clear();
    this.centralNode = null;
    logger.info('Microtask engine reset', { component: 'MicrotaskEngine' });
  }
}
