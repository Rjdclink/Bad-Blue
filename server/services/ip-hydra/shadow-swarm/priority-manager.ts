/**
 * PR 3: Shadow Swarm - Priority Task Management
 * Calculates priority and manages task queue with preemption support
 */

import { PriorityTask, AssetDetectionEvent } from '../types';
import { randomBytes } from 'crypto';

export class PriorityTaskManager {
  private tasks: Map<string, PriorityTask> = new Map();
  private queue: PriorityTask[] = [];

  /**
   * Calculate priority from multiple factors
   * Priority = (value * 0.4) + (urgency * 0.3) + (chainMultiplier * 0.2) - (detectionRisk * 0.1)
   */
  calculatePriority(
    value: number,
    urgency: number,
    chain: string,
    detectionRisk: number
  ): number {
    // Chain multipliers (higher = better network)
    const chainMultipliers: Record<string, number> = {
      arbitrum: 30, // Fast L2
      optimism: 28,
      polygon: 25,
      avalanche: 25,
      bsc: 22,
      ethereum: 20, // More expensive
    };

    const chainMultiplier = chainMultipliers[chain] || 15;

    // Calculate weighted priority (0-100)
    const priority = Math.min(100, Math.max(0,
      (value * 0.4) +
      (urgency * 0.3) +
      (chainMultiplier * 0.2) -
      (detectionRisk * 0.1)
    ));

    return Math.round(priority);
  }

  /**
   * Create and queue a new task
   */
  createTask(
    asset: string,
    chain: string,
    value: number,
    urgency: number,
    detectionRisk: number
  ): PriorityTask {
    const priority = this.calculatePriority(value, urgency, chain, detectionRisk);

    const task: PriorityTask = {
      id: this.generateTaskId(),
      asset,
      chain,
      value,
      urgency,
      detectionRisk,
      priority,
      status: 'queued',
      createdAt: new Date(),
    };

    this.tasks.set(task.id, task);
    this.addToQueue(task);

    console.log(`[PriorityTaskManager] Created task ${task.id} with priority ${priority}`);
    return task;
  }

  /**
   * Create task from asset detection event
   */
  createTaskFromDetection(event: AssetDetectionEvent): PriorityTask {
    return this.createTask(
      event.assetType,
      event.chain,
      event.assetValue,
      event.urgency,
      event.detectionRisk
    );
  }

  /**
   * Add task to priority queue (sorted by priority)
   */
  private addToQueue(task: PriorityTask): void {
    // Insert task in sorted order (highest priority first)
    const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
  }

  /**
   * Get next highest priority task
   */
  getNextTask(): PriorityTask | null {
    const task = this.queue.find(t => t.status === 'queued');
    return task || null;
  }

  /**
   * Assign task to a crawler
   */
  assignTask(taskId: string, crawlerId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'queued') return false;

    task.status = 'in-progress';
    task.assignedCrawler = crawlerId;
    task.startedAt = new Date();
    this.tasks.set(taskId, task);

    console.log(`[PriorityTaskManager] Assigned task ${taskId} to crawler ${crawlerId}`);
    return true;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, success: boolean = true): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = success ? 'completed' : 'failed';
    task.completedAt = new Date();
    this.tasks.set(taskId, task);

    // Remove from queue
    this.queue = this.queue.filter(t => t.id !== taskId);

    console.log(`[PriorityTaskManager] Task ${taskId} ${task.status}`);
    return true;
  }

  /**
   * Preempt lower priority tasks for flash-loan/arbitrage events
   * Returns list of preempted task IDs
   */
  preemptForUrgentTask(newTask: PriorityTask, threshold: number = 80): string[] {
    if (newTask.priority < threshold) {
      return []; // Not urgent enough to preempt
    }

    const preempted: string[] = [];

    // Find in-progress tasks with lower priority
    for (const task of this.tasks.values()) {
      if (task.status === 'in-progress' && task.priority < newTask.priority) {
        // Pause the task and reassign its crawler
        task.status = 'queued';
        task.assignedCrawler = undefined;
        task.startedAt = undefined;
        this.tasks.set(task.id, task);
        
        // Re-add to queue
        this.addToQueue(task);
        preempted.push(task.id);
      }
    }

    if (preempted.length > 0) {
      console.log(`[PriorityTaskManager] Preempted ${preempted.length} tasks for urgent task ${newTask.id}`);
    }

    return preempted;
  }

  /**
   * Check if a task is flash-loan or arbitrage type (high urgency + high value)
   */
  isFlashLoanOrArbitrage(task: PriorityTask): boolean {
    return task.urgency >= 80 && task.value >= 80;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    total: number;
    queued: number;
    inProgress: number;
    completed: number;
    failed: number;
    topPriorities: PriorityTask[];
  } {
    const tasks = Array.from(this.tasks.values());
    
    return {
      total: tasks.length,
      queued: tasks.filter(t => t.status === 'queued').length,
      inProgress: tasks.filter(t => t.status === 'in-progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      topPriorities: this.queue.slice(0, 10), // Top 10
    };
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): PriorityTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks by chain
   */
  getTasksByChain(chain: string): PriorityTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.chain === chain);
  }

  /**
   * Get all tasks by status
   */
  getTasksByStatus(status: PriorityTask['status']): PriorityTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === status);
  }

  /**
   * Get current queue (all queued tasks in priority order)
   */
  getQueue(): PriorityTask[] {
    return [...this.queue];
  }

  /**
   * Clear completed/failed tasks older than specified age
   */
  clearOldTasks(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleared = 0;

    for (const [id, task] of this.tasks.entries()) {
      if (
        (task.status === 'completed' || task.status === 'failed') &&
        task.completedAt &&
        now - task.completedAt.getTime() > maxAgeMs
      ) {
        this.tasks.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`[PriorityTaskManager] Cleared ${cleared} old tasks`);
    }

    return cleared;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }
}
