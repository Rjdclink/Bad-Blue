/**
 * Volunteer Compute Manager
 * 
 * Manages volunteer GPU/CPU pool for distributed compute:
 * - Worker registration with attestation
 * - Signed task bundles
 * - Verifiable outputs
 * - Credit system
 * - BOINC-style task distribution
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';
import type {
  VolunteerWorker,
  ComputeTask,
  ComputeTaskResult
} from './fourJITypes';

const log = createLogger('VolunteerComputeManager');

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_TRUST_SCORE = 50;
const MAX_TASK_DURATION_HOURS = 24;
const CREDIT_RATE_PER_GPU_HOUR = 10;
const CREDIT_RATE_PER_CPU_HOUR = 1;
const MAX_RETRIES = 3;
const TASK_ASSIGNMENT_TIMEOUT_MS = 60000;

// ============================================================================
// VOLUNTEER COMPUTE MANAGER
// ============================================================================

export class VolunteerComputeManager extends EventEmitter {
  private workers: Map<string, VolunteerWorker> = new Map();
  private tasks: Map<string, ComputeTask> = new Map();
  private taskResults: Map<string, ComputeTaskResult> = new Map();
  private initialized: boolean = false;

  // Task queue
  private taskQueue: string[] = [];

  constructor() {
    super();
  }

  /**
   * Initialize the volunteer compute manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing Volunteer Compute Manager...');

    // Start task assignment loop
    setInterval(() => this.processTaskQueue(), 10000);

    this.initialized = true;
    this.emit('initialized');
    log.info('Volunteer Compute Manager initialized');
  }

  /**
   * Register a new volunteer worker
   */
  async registerWorker(
    ownerId: string,
    attestation: string,
    publicKey: string,
    hardware: VolunteerWorker['hardware'],
    environment: VolunteerWorker['environment'],
    consent: { scope: string[]; expiresAt: string }
  ): Promise<VolunteerWorker> {
    const id = `volunteer-${crypto.randomBytes(6).toString('hex')}`;

    // Verify attestation (in production, use actual attestation verification)
    const attestationValid = this.verifyAttestation(attestation, publicKey);
    if (!attestationValid) {
      throw new Error('Invalid attestation');
    }

    // Sign consent
    const consentSignature = crypto.createHmac('sha256', 'consent-key')
      .update(JSON.stringify(consent))
      .digest('hex');

    const worker: VolunteerWorker = {
      id,
      ownerId,
      registration: {
        attestation,
        publicKey,
        registeredAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        consent: {
          ...consent,
          signature: consentSignature
        }
      },
      hardware,
      environment,
      status: 'available',
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalComputeHours: 0,
        averageLatencyMs: 0,
        creditsEarned: 0
      },
      trustScore: 70, // Start with default trust
      lastActive: new Date().toISOString()
    };

    this.workers.set(id, worker);

    this.emit('worker-registered', { workerId: id, ownerId });
    log.info('Volunteer worker registered', { workerId: id, ownerId });

    return worker;
  }

  /**
   * Verify worker attestation (stub)
   */
  private verifyAttestation(attestation: string, publicKey: string): boolean {
    // In production, verify TPM/SGX attestation or reproducible build proof
    return attestation.length > 0 && publicKey.length > 0;
  }

  /**
   * Submit a compute task
   */
  async submitTask(
    type: ComputeTask['type'],
    bundle: ComputeTask['bundle'],
    resources: ComputeTask['resources'],
    scheduling: Partial<ComputeTask['scheduling']> = {}
  ): Promise<ComputeTask> {
    const id = `compute-${crypto.randomBytes(6).toString('hex')}`;

    // Calculate input checksum
    const checksumInputs = crypto.createHash('sha256')
      .update(JSON.stringify({ bundle, resources }))
      .digest('hex');

    const task: ComputeTask = {
      id,
      type,
      priority: this.getPriorityFromType(type),
      bundle,
      resources,
      verification: {
        reproducible: true,
        checksumInputs
      },
      scheduling: {
        window: scheduling.window,
        deadline: scheduling.deadline || new Date(Date.now() + MAX_TASK_DURATION_HOURS * 3600000).toISOString(),
        retryCount: 0,
        maxRetries: MAX_RETRIES
      },
      created: new Date().toISOString(),
      status: 'pending'
    };

    this.tasks.set(id, task);
    this.taskQueue.push(id);

    this.emit('task-submitted', { taskId: id, type });
    log.info('Compute task submitted', { taskId: id, type });

    return task;
  }

  /**
   * Get priority from task type
   */
  private getPriorityFromType(type: ComputeTask['type']): number {
    switch (type) {
      case 'inference': return 8;
      case 'monte-carlo': return 5;
      case 'distillation': return 4;
      case 'training': return 3;
      default: return 5;
    }
  }

  /**
   * Process task queue and assign to workers
   */
  private async processTaskQueue(): Promise<void> {
    if (this.taskQueue.length === 0) return;

    // Sort by priority
    this.taskQueue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);
      if (!taskA || !taskB) return 0;
      return taskB.priority - taskA.priority;
    });

    // Get available workers sorted by trust score
    const availableWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'available' && w.trustScore >= MIN_TRUST_SCORE)
      .sort((a, b) => b.trustScore - a.trustScore);

    if (availableWorkers.length === 0) return;

    // Assign tasks to workers
    const assignedTasks: string[] = [];

    for (const taskId of this.taskQueue) {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;

      // Check if within scheduling window
      if (task.scheduling.window) {
        const now = new Date();
        const start = new Date(task.scheduling.window.start);
        const end = new Date(task.scheduling.window.end);
        if (now < start || now > end) continue;
      }

      // Find suitable worker
      const worker = this.findSuitableWorker(availableWorkers, task);
      if (!worker) continue;

      // Assign task
      task.assignedTo = worker.id;
      task.status = 'assigned';
      worker.status = 'busy';

      assignedTasks.push(taskId);

      this.emit('task-assigned', { taskId, workerId: worker.id });
      log.info('Task assigned to volunteer', { taskId, workerId: worker.id });

      // Remove worker from available list
      const index = availableWorkers.indexOf(worker);
      if (index > -1) availableWorkers.splice(index, 1);
    }

    // Remove assigned tasks from queue
    this.taskQueue = this.taskQueue.filter(id => !assignedTasks.includes(id));
  }

  /**
   * Find suitable worker for a task
   */
  private findSuitableWorker(
    workers: VolunteerWorker[],
    task: ComputeTask
  ): VolunteerWorker | null {
    for (const worker of workers) {
      // Check hardware requirements
      if (task.resources.preferGpu && !worker.hardware.gpuModel) continue;
      if (task.resources.minGpuMemory && 
          (!worker.hardware.gpuMemory || worker.hardware.gpuMemory < task.resources.minGpuMemory)) continue;
      if (worker.hardware.cpuCores < task.resources.minCpuCores) continue;
      if (worker.hardware.ramGb < task.resources.minRamGb) continue;

      // Check environment compatibility
      if (task.bundle.image.includes('docker') && worker.environment.type !== 'docker') continue;
      if (task.bundle.image.includes('wasm') && worker.environment.type !== 'wasm') continue;

      // Check consent scope
      if (!worker.registration.consent.scope.includes(task.type)) continue;

      // Check consent expiry
      if (new Date(worker.registration.consent.expiresAt) < new Date()) continue;

      return worker;
    }
    return null;
  }

  /**
   * Report task started
   */
  taskStarted(taskId: string, workerId: string): boolean {
    const task = this.tasks.get(taskId);
    const worker = this.workers.get(workerId);

    if (!task || !worker) return false;
    if (task.assignedTo !== workerId) return false;

    task.status = 'running';
    worker.lastActive = new Date().toISOString();

    this.emit('task-started', { taskId, workerId });
    log.info('Task started', { taskId, workerId });

    return true;
  }

  /**
   * Submit task result
   */
  async submitTaskResult(
    taskId: string,
    workerId: string,
    success: boolean,
    outputs: ComputeTaskResult['outputs'],
    verification: ComputeTaskResult['verification'],
    usage: ComputeTaskResult['usage']
  ): Promise<ComputeTaskResult> {
    const task = this.tasks.get(taskId);
    const worker = this.workers.get(workerId);

    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!worker) throw new Error(`Worker not found: ${workerId}`);
    if (task.assignedTo !== workerId) throw new Error('Task not assigned to this worker');

    // Verify outputs
    const verified = this.verifyOutputs(task, outputs, verification);

    // Calculate credits
    const credits = this.calculateCredits(usage, worker.hardware);

    const result: ComputeTaskResult = {
      taskId,
      workerId,
      success: success && verified,
      outputs,
      verification,
      usage,
      credits,
      completed: new Date().toISOString()
    };

    this.taskResults.set(taskId, result);

    // Update task status
    task.status = success && verified ? 'completed' : 'failed';

    // Update worker metrics
    worker.status = 'available';
    worker.lastActive = new Date().toISOString();
    
    if (success && verified) {
      worker.metrics.tasksCompleted++;
      worker.metrics.creditsEarned += credits.earned;
      worker.trustScore = Math.min(100, worker.trustScore + 1);
    } else {
      worker.metrics.tasksFailed++;
      worker.trustScore = Math.max(0, worker.trustScore - 5);

      // Retry if allowed
      if (task.scheduling.retryCount < task.scheduling.maxRetries) {
        task.scheduling.retryCount++;
        task.status = 'pending';
        task.assignedTo = undefined;
        this.taskQueue.push(taskId);
        log.info('Task queued for retry', { taskId, attempt: task.scheduling.retryCount });
      }
    }

    // Update compute hours
    worker.metrics.totalComputeHours += usage.durationHours;
    worker.metrics.averageLatencyMs = 
      (worker.metrics.averageLatencyMs * (worker.metrics.tasksCompleted - 1) + usage.durationHours * 3600000) /
      worker.metrics.tasksCompleted;

    this.emit('task-completed', { taskId, workerId, success: success && verified });
    log.info('Task result submitted', { taskId, workerId, success: success && verified });

    return result;
  }

  /**
   * Verify task outputs
   */
  private verifyOutputs(
    task: ComputeTask,
    outputs: ComputeTaskResult['outputs'],
    verification: ComputeTaskResult['verification']
  ): boolean {
    // In production, implement actual verification:
    // - Check reproducibility
    // - Verify attestation
    // - Compare checksums with expected (if available)

    if (!verification.signature || !verification.attestation) {
      return false;
    }

    // Verify output checksums exist
    if (outputs.artifactIds.length > 0 && 
        Object.keys(verification.outputChecksums).length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Calculate credits for completed work
   */
  private calculateCredits(
    usage: ComputeTaskResult['usage'],
    hardware: VolunteerWorker['hardware']
  ): ComputeTaskResult['credits'] {
    let earned = 0;
    const breakdown: Record<string, number> = {};

    // GPU credits
    if (usage.gpuHours && usage.gpuHours > 0) {
      const gpuCredits = usage.gpuHours * CREDIT_RATE_PER_GPU_HOUR;
      earned += gpuCredits;
      breakdown['gpu'] = gpuCredits;
    }

    // CPU credits
    const cpuCredits = usage.cpuHours * CREDIT_RATE_PER_CPU_HOUR;
    earned += cpuCredits;
    breakdown['cpu'] = cpuCredits;

    // Bonus for quick completion
    const expectedDuration = usage.durationHours;
    if (expectedDuration < 1) {
      const bonus = earned * 0.1;
      earned += bonus;
      breakdown['speed_bonus'] = bonus;
    }

    return { earned: Math.round(earned * 100) / 100, breakdown };
  }

  /**
   * Update worker status
   */
  updateWorkerStatus(workerId: string, status: VolunteerWorker['status']): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    worker.status = status;
    worker.lastActive = new Date().toISOString();

    return true;
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): VolunteerWorker | null {
    return this.workers.get(workerId) || null;
  }

  /**
   * List workers
   */
  listWorkers(filter?: {
    status?: VolunteerWorker['status'];
    minTrustScore?: number;
    hasGpu?: boolean;
  }): VolunteerWorker[] {
    let workers = Array.from(this.workers.values());

    if (filter?.status) {
      workers = workers.filter(w => w.status === filter.status);
    }
    if (filter?.minTrustScore !== undefined) {
      workers = workers.filter(w => w.trustScore >= filter.minTrustScore!);
    }
    if (filter?.hasGpu) {
      workers = workers.filter(w => !!w.hardware.gpuModel);
    }

    return workers;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ComputeTask | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get task result
   */
  getTaskResult(taskId: string): ComputeTaskResult | null {
    return this.taskResults.get(taskId) || null;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueLength: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const tasks = Array.from(this.tasks.values());

    return {
      queueLength: this.taskQueue.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      runningTasks: tasks.filter(t => t.status === 'running').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length
    };
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): {
    totalWorkers: number;
    availableWorkers: number;
    busyWorkers: number;
    totalGpuMemoryGb: number;
    totalCpuCores: number;
    totalCreditsDistributed: number;
    averageTrustScore: number;
  } {
    const workers = Array.from(this.workers.values());
    const available = workers.filter(w => w.status === 'available');

    const totalCredits = workers.reduce((sum, w) => sum + w.metrics.creditsEarned, 0);
    const avgTrust = workers.length > 0 
      ? workers.reduce((sum, w) => sum + w.trustScore, 0) / workers.length 
      : 0;

    return {
      totalWorkers: workers.length,
      availableWorkers: available.length,
      busyWorkers: workers.filter(w => w.status === 'busy').length,
      totalGpuMemoryGb: workers.reduce((sum, w) => sum + (w.hardware.gpuMemory || 0), 0),
      totalCpuCores: workers.reduce((sum, w) => sum + w.hardware.cpuCores, 0),
      totalCreditsDistributed: totalCredits,
      averageTrustScore: Math.round(avgTrust * 10) / 10
    };
  }

  /**
   * Unregister a worker
   */
  unregisterWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    // Don't unregister if worker has running tasks
    const runningTasks = Array.from(this.tasks.values())
      .filter(t => t.assignedTo === workerId && t.status === 'running');
    
    if (runningTasks.length > 0) {
      throw new Error('Cannot unregister worker with running tasks');
    }

    this.workers.delete(workerId);

    this.emit('worker-unregistered', { workerId });
    log.info('Volunteer worker unregistered', { workerId });

    return true;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Volunteer Compute Manager...');
    this.workers.clear();
    this.tasks.clear();
    this.taskResults.clear();
    this.taskQueue = [];
    this.initialized = false;
    log.info('Volunteer Compute Manager shutdown complete');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: VolunteerComputeManager | null = null;

export function getVolunteerComputeManager(): VolunteerComputeManager {
  if (!instance) {
    instance = new VolunteerComputeManager();
  }
  return instance;
}

export async function initializeVolunteerComputeManager(): Promise<VolunteerComputeManager> {
  const manager = getVolunteerComputeManager();
  await manager.initialize();
  return manager;
}

export async function shutdownVolunteerComputeManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  VolunteerComputeManager,
  getVolunteerComputeManager,
  initializeVolunteerComputeManager,
  shutdownVolunteerComputeManager
};
