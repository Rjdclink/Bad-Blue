/**
 * PowerSpine - Primary Compute Orchestrator for Lexara
 * 
 * Handles all compute distribution across features based on priority and available resources.
 * 
 * Features:
 * - Priority-based task routing (Lexara tasks > background tasks)
 * - Adaptive throttling (prevents overload)
 * - Event-driven compute bursts (allows momentary high-power focus)
 * - Cooldown logic (avoids runaway loops and keeps the system stable)
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface ComputeTask {
  id: string;
  type: string;
  priority: TaskPriority;
  weight: number;  // 0.0 to 1.0, compute intensity
  allocatedResources: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'throttled';
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata?: Record<string, unknown>;
}

export interface SpineHealth {
  status: 'healthy' | 'degraded' | 'critical' | 'overloaded';
  cpuUtilization: number;       // 0-100
  memoryUtilization: number;    // 0-100
  activeTaskCount: number;
  queuedTaskCount: number;
  throttleLevel: ThrottleLevel;
  burstModeActive: boolean;
  cooldownActive: boolean;
  lastHealthCheck: Date;
}

export type ThrottleLevel = 'none' | 'light' | 'moderate' | 'heavy' | 'emergency';

export interface SpineConfig {
  maxConcurrentTasks: number;
  maxQueueSize: number;
  burstCapacity: number;          // Extra tasks during burst
  burstDurationMs: number;        // How long a burst can last
  burstCooldownMs: number;        // Cooldown after burst
  throttleThresholds: {
    light: number;     // CPU % to trigger light throttle
    moderate: number;  // CPU % to trigger moderate throttle
    heavy: number;     // CPU % to trigger heavy throttle
    emergency: number; // CPU % to trigger emergency throttle
  };
  priorityWeights: Record<TaskPriority, number>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: SpineConfig = {
  maxConcurrentTasks: 10,
  maxQueueSize: 100,
  burstCapacity: 5,
  burstDurationMs: 10000,       // 10 seconds burst
  burstCooldownMs: 30000,       // 30 seconds cooldown after burst
  throttleThresholds: {
    light: 60,
    moderate: 75,
    heavy: 85,
    emergency: 95
  },
  priorityWeights: {
    critical: 10,   // Always runs immediately
    high: 8,        // Lexara speech, reasoning, UI
    normal: 5,      // Standard tasks
    low: 3,         // Can be delayed
    background: 1   // Only when idle
  }
};

// Task types that are Lexara-specific and get priority
const LEXARA_TASK_TYPES = [
  'lexara_speech',
  'lexara_reasoning',
  'lexara_ui_render',
  'lexara_response',
  'lexara_analysis',
  'lexara_document',
  'lexara_evidence'
];

// ============================================================================
// POWER SPINE CLASS
// ============================================================================

export const powerSpineEvents = new EventEmitter();

class PowerSpine {
  private static instance: PowerSpine;
  private isInitialized: boolean = false;
  private config: SpineConfig = DEFAULT_CONFIG;
  
  // Task management
  private taskQueue: ComputeTask[] = [];
  private activeTasks: Map<string, ComputeTask> = new Map();
  private taskHistory: ComputeTask[] = [];
  
  // Resource tracking
  private health: SpineHealth;
  private totalResourcesAllocated: number = 0;
  
  // Burst mode state
  private burstModeActive: boolean = false;
  private burstStartTime: Date | null = null;
  private cooldownUntil: Date | null = null;
  
  // Intervals
  private taskProcessorInterval: NodeJS.Timeout | null = null;
  private healthMonitorInterval: NodeJS.Timeout | null = null;
  private stabilityCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.health = this.initializeHealth();
  }

  static getInstance(): PowerSpine {
    if (!PowerSpine.instance) {
      PowerSpine.instance = new PowerSpine();
    }
    return PowerSpine.instance;
  }

  private initializeHealth(): SpineHealth {
    return {
      status: 'healthy',
      cpuUtilization: 0,
      memoryUtilization: 0,
      activeTaskCount: 0,
      queuedTaskCount: 0,
      throttleLevel: 'none',
      burstModeActive: false,
      cooldownActive: false,
      lastHealthCheck: new Date()
    };
  }

  async initialize(config?: Partial<SpineConfig>): Promise<void> {
    if (this.isInitialized) return;

    console.log('[PowerSpine] Initializing Primary Compute Orchestrator...');

    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // Start the task processor
    this.startTaskProcessor();
    
    // Start health monitoring
    this.startHealthMonitor();
    
    // Start stability checks
    this.startStabilityChecker();

    this.isInitialized = true;
    console.log('[PowerSpine] Primary Compute Orchestrator initialized');
    powerSpineEvents.emit('spine-initialized', { config: this.config });
  }

  /**
   * Request compute resources for a task
   * Returns task ID if accepted, throws if rejected
   */
  requestCompute(
    taskType: string,
    weight: number,
    options: {
      priority?: TaskPriority;
      metadata?: Record<string, unknown>;
    } = {}
  ): string {
    // Validate weight
    const normalizedWeight = Math.min(1.0, Math.max(0.0, weight));
    
    // Determine priority (auto-elevate Lexara tasks)
    let priority = options.priority || 'normal';
    if (LEXARA_TASK_TYPES.includes(taskType) && priority === 'normal') {
      priority = 'high';
    }

    // Check if we're at capacity
    if (this.taskQueue.length >= this.config.maxQueueSize) {
      // Emergency: Only accept critical tasks when queue is full
      if (priority !== 'critical') {
        throw new Error('Task queue at capacity. Only critical tasks accepted.');
      }
    }

    // Check throttle level
    if (this.health.throttleLevel === 'emergency' && priority !== 'critical') {
      throw new Error('System in emergency throttle. Only critical tasks accepted.');
    }

    // Create task
    const taskId = `task_${crypto.randomBytes(8).toString('hex')}`;
    const task: ComputeTask = {
      id: taskId,
      type: taskType,
      priority,
      weight: normalizedWeight,
      allocatedResources: 0,
      status: 'pending',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      metadata: options.metadata
    };

    // Add to queue
    this.taskQueue.push(task);
    this.sortTaskQueue();
    
    this.updateHealth();
    
    console.log(`[PowerSpine] Compute requested: ${taskId} (${taskType}, priority: ${priority})`);
    powerSpineEvents.emit('compute-requested', task);

    return taskId;
  }

  /**
   * Release compute resources for a completed/cancelled task
   */
  releaseCompute(taskId: string): boolean {
    // Check active tasks
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      activeTask.status = 'completed';
      activeTask.completedAt = new Date();
      this.totalResourcesAllocated -= activeTask.allocatedResources;
      this.activeTasks.delete(taskId);
      this.taskHistory.push(activeTask);
      
      // Trim history
      if (this.taskHistory.length > 1000) {
        this.taskHistory = this.taskHistory.slice(-1000);
      }

      this.updateHealth();
      console.log(`[PowerSpine] Compute released: ${taskId}`);
      powerSpineEvents.emit('compute-released', activeTask);
      return true;
    }

    // Check queue
    const queueIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (queueIndex >= 0) {
      const task = this.taskQueue[queueIndex];
      task.status = 'completed';
      task.completedAt = new Date();
      this.taskQueue.splice(queueIndex, 1);
      this.taskHistory.push(task);
      
      this.updateHealth();
      powerSpineEvents.emit('compute-released', task);
      return true;
    }

    return false;
  }

  /**
   * Ensure system stability - run checks and auto-correct issues
   */
  ensureStability(): {
    stable: boolean;
    actions: string[];
    recommendations: string[];
  } {
    const actions: string[] = [];
    const recommendations: string[] = [];
    let stable = true;

    // Check for stale tasks
    const now = Date.now();
    const staleTasks = Array.from(this.activeTasks.values()).filter(
      task => task.startedAt && (now - task.startedAt.getTime()) > 300000 // 5 minutes
    );
    
    if (staleTasks.length > 0) {
      for (const staleTask of staleTasks) {
        this.releaseCompute(staleTask.id);
        actions.push(`Released stale task: ${staleTask.id}`);
      }
      stable = false;
    }

    // Check for cooldown status
    if (this.cooldownUntil && this.cooldownUntil > new Date()) {
      recommendations.push('System in cooldown. Avoid intensive operations.');
    }

    // Check burst mode
    if (this.burstModeActive) {
      const burstDuration = this.burstStartTime ? 
        now - this.burstStartTime.getTime() : 0;
      
      if (burstDuration > this.config.burstDurationMs) {
        this.deactivateBurstMode();
        actions.push('Burst mode deactivated due to duration limit');
      }
    }

    // Check throttle level
    if (this.health.throttleLevel === 'heavy' || this.health.throttleLevel === 'emergency') {
      recommendations.push('High throttle level. Consider reducing task load.');
      stable = false;
    }

    // Check memory pressure
    if (this.health.memoryUtilization > 90) {
      recommendations.push('High memory utilization. Consider garbage collection.');
      stable = false;
    }

    // Auto-stabilize if needed
    if (!stable && this.health.status !== 'critical') {
      this.autoStabilize();
      actions.push('Auto-stabilization triggered');
    }

    powerSpineEvents.emit('stability-check', { stable, actions, recommendations });

    return { stable, actions, recommendations };
  }

  /**
   * Report comprehensive health status
   */
  reportHealth(): SpineHealth {
    this.updateHealth();
    return { ...this.health };
  }

  /**
   * Activate burst mode for complex tasks
   */
  activateBurstMode(): boolean {
    // Check if already in burst or cooldown
    if (this.burstModeActive) {
      console.log('[PowerSpine] Burst mode already active');
      return true;
    }

    if (this.cooldownUntil && this.cooldownUntil > new Date()) {
      console.log('[PowerSpine] Cannot activate burst mode during cooldown');
      return false;
    }

    this.burstModeActive = true;
    this.burstStartTime = new Date();
    this.health.burstModeActive = true;
    
    console.log('[PowerSpine] Burst mode activated');
    powerSpineEvents.emit('burst-activated', { startTime: this.burstStartTime });
    
    return true;
  }

  /**
   * Deactivate burst mode and enter cooldown
   */
  private deactivateBurstMode(): void {
    this.burstModeActive = false;
    this.burstStartTime = null;
    this.health.burstModeActive = false;
    this.cooldownUntil = new Date(Date.now() + this.config.burstCooldownMs);
    this.health.cooldownActive = true;
    
    console.log('[PowerSpine] Burst mode deactivated, entering cooldown');
    powerSpineEvents.emit('burst-deactivated', { cooldownUntil: this.cooldownUntil });
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ComputeTask | undefined {
    return this.activeTasks.get(taskId) || 
           this.taskQueue.find(t => t.id === taskId);
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queuedCount: number;
    activeCount: number;
    pendingByPriority: Record<TaskPriority, number>;
  } {
    const pendingByPriority: Record<TaskPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      background: 0
    };

    for (const task of this.taskQueue) {
      pendingByPriority[task.priority]++;
    }

    return {
      queuedCount: this.taskQueue.length,
      activeCount: this.activeTasks.size,
      pendingByPriority
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Start the task processor
   */
  private startTaskProcessor(): void {
    if (this.taskProcessorInterval) {
      clearInterval(this.taskProcessorInterval);
    }

    this.taskProcessorInterval = setInterval(() => {
      this.processTaskQueue();
    }, 100); // Process every 100ms
  }

  /**
   * Process tasks from the queue
   */
  private processTaskQueue(): void {
    // Check cooldown
    if (this.cooldownUntil && this.cooldownUntil <= new Date()) {
      this.cooldownUntil = null;
      this.health.cooldownActive = false;
      console.log('[PowerSpine] Cooldown period ended');
    }

    // Calculate available slots
    let maxSlots = this.config.maxConcurrentTasks;
    
    // Add burst capacity if in burst mode
    if (this.burstModeActive) {
      maxSlots += this.config.burstCapacity;
    }
    
    // Reduce slots based on throttle level
    switch (this.health.throttleLevel) {
      case 'light':
        maxSlots = Math.floor(maxSlots * 0.9);
        break;
      case 'moderate':
        maxSlots = Math.floor(maxSlots * 0.7);
        break;
      case 'heavy':
        maxSlots = Math.floor(maxSlots * 0.5);
        break;
      case 'emergency':
        maxSlots = 2; // Only critical tasks
        break;
    }

    const availableSlots = maxSlots - this.activeTasks.size;
    if (availableSlots <= 0) return;

    // Get tasks to process (already sorted by priority)
    const tasksToProcess = this.taskQueue
      .filter(t => t.status === 'pending')
      .slice(0, availableSlots);

    for (const task of tasksToProcess) {
      // Remove from queue
      this.taskQueue = this.taskQueue.filter(t => t.id !== task.id);
      
      // Allocate resources
      task.allocatedResources = task.weight * 10; // Scale factor
      this.totalResourcesAllocated += task.allocatedResources;
      
      // Start task
      task.status = 'running';
      task.startedAt = new Date();
      this.activeTasks.set(task.id, task);
      
      console.log(`[PowerSpine] Task started: ${task.id} (${task.type})`);
      powerSpineEvents.emit('task-started', task);
    }

    this.updateHealth();
  }

  /**
   * Sort task queue by priority and age
   */
  private sortTaskQueue(): void {
    this.taskQueue.sort((a, b) => {
      // Higher priority weight first
      const priorityDiff = this.config.priorityWeights[b.priority] - 
                          this.config.priorityWeights[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Older tasks first (FIFO within same priority)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitor(): void {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
    }

    this.healthMonitorInterval = setInterval(() => {
      this.updateHealth();
    }, 1000); // Update every second
  }

  /**
   * Update health metrics
   */
  private updateHealth(): void {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    // Estimate CPU from task load (simplified)
    const taskLoad = (this.activeTasks.size / this.config.maxConcurrentTasks) * 100;
    const weightedLoad = this.totalResourcesAllocated * 5; // Scale factor
    const estimatedCpu = Math.min(100, (taskLoad + weightedLoad) / 2);

    this.health.cpuUtilization = estimatedCpu;
    this.health.memoryUtilization = heapUsedPercent;
    this.health.activeTaskCount = this.activeTasks.size;
    this.health.queuedTaskCount = this.taskQueue.length;
    this.health.lastHealthCheck = new Date();

    // Determine throttle level
    this.health.throttleLevel = this.calculateThrottleLevel(estimatedCpu);

    // Determine overall status
    if (this.health.throttleLevel === 'emergency') {
      this.health.status = 'critical';
    } else if (this.health.throttleLevel === 'heavy') {
      this.health.status = 'overloaded';
    } else if (this.health.throttleLevel === 'moderate') {
      this.health.status = 'degraded';
    } else {
      this.health.status = 'healthy';
    }

    powerSpineEvents.emit('health-updated', this.health);
  }

  /**
   * Calculate throttle level based on CPU utilization
   */
  private calculateThrottleLevel(cpu: number): ThrottleLevel {
    const thresholds = this.config.throttleThresholds;
    
    if (cpu >= thresholds.emergency) return 'emergency';
    if (cpu >= thresholds.heavy) return 'heavy';
    if (cpu >= thresholds.moderate) return 'moderate';
    if (cpu >= thresholds.light) return 'light';
    return 'none';
  }

  /**
   * Start stability checker
   */
  private startStabilityChecker(): void {
    if (this.stabilityCheckInterval) {
      clearInterval(this.stabilityCheckInterval);
    }

    this.stabilityCheckInterval = setInterval(() => {
      this.ensureStability();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Auto-stabilize the system
   */
  private autoStabilize(): void {
    // Throttle background tasks
    const backgroundTasks = this.taskQueue.filter(t => 
      t.priority === 'background' && t.status === 'pending'
    );
    
    for (const task of backgroundTasks.slice(0, 5)) {
      task.status = 'throttled';
    }

    // If still overloaded, throttle low priority tasks
    if (this.health.status === 'critical' || this.health.status === 'overloaded') {
      const lowTasks = this.taskQueue.filter(t => 
        t.priority === 'low' && t.status === 'pending'
      );
      
      for (const task of lowTasks.slice(0, 3)) {
        task.status = 'throttled';
      }
    }

    console.log('[PowerSpine] Auto-stabilization complete');
    powerSpineEvents.emit('auto-stabilized', { 
      throttledCount: this.taskQueue.filter(t => t.status === 'throttled').length 
    });
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[PowerSpine] Shutting down...');

    if (this.taskProcessorInterval) {
      clearInterval(this.taskProcessorInterval);
      this.taskProcessorInterval = null;
    }

    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }

    if (this.stabilityCheckInterval) {
      clearInterval(this.stabilityCheckInterval);
      this.stabilityCheckInterval = null;
    }

    // Complete all active tasks
    Array.from(this.activeTasks.values()).forEach(task => {
      task.status = 'completed';
      task.completedAt = new Date();
    });
    this.activeTasks.clear();
    this.taskQueue = [];
    this.totalResourcesAllocated = 0;

    this.isInitialized = false;
    console.log('[PowerSpine] Shutdown complete');
    powerSpineEvents.emit('spine-shutdown');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const powerSpine = PowerSpine.getInstance();

export async function initializePowerSpine(config?: Partial<SpineConfig>): Promise<void> {
  await powerSpine.initialize(config);
}

export function requestCompute(
  taskType: string,
  weight: number,
  options?: { priority?: TaskPriority; metadata?: Record<string, unknown> }
): string {
  return powerSpine.requestCompute(taskType, weight, options);
}

export function releaseCompute(taskId: string): boolean {
  return powerSpine.releaseCompute(taskId);
}

export function ensureStability(): {
  stable: boolean;
  actions: string[];
  recommendations: string[];
} {
  return powerSpine.ensureStability();
}

export function reportHealth(): SpineHealth {
  return powerSpine.reportHealth();
}

export function activateBurstMode(): boolean {
  return powerSpine.activateBurstMode();
}

export function getQueueStatus() {
  return powerSpine.getQueueStatus();
}

export async function shutdownPowerSpine(): Promise<void> {
  await powerSpine.shutdown();
}

export default powerSpine;
