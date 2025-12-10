/**
 * Edge Worker Manager
 * 
 * Manages edge workers (user devices) for:
 * - WASM/WebGPU inference
 * - IndexedDB caching
 * - Federated learning contributions
 * - CRDT synchronization
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';
import type {
  EdgeWorker,
  EdgeTask,
  EdgeTaskResult,
  CRDTDocument,
  CRDTOperation,
  SyncState
} from './fourJITypes';

const log = createLogger('EdgeWorkerManager');

// ============================================================================
// CONSTANTS
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 30000;
const WORKER_TIMEOUT_MS = 120000;
const MAX_CACHED_MODELS = 5;
const MAX_PENDING_TASKS = 100;

// ============================================================================
// EDGE WORKER MANAGER
// ============================================================================

export class EdgeWorkerManager extends EventEmitter {
  private workers: Map<string, EdgeWorker> = new Map();
  private tasks: Map<string, EdgeTask> = new Map();
  private taskResults: Map<string, EdgeTaskResult> = new Map();
  private syncStates: Map<string, SyncState> = new Map();
  private initialized: boolean = false;

  // CRDT documents for sync
  private documents: Map<string, CRDTDocument> = new Map();
  private pendingOps: Map<string, CRDTOperation[]> = new Map();

  constructor() {
    super();
  }

  /**
   * Initialize the edge worker manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing Edge Worker Manager...');

    // Start cleanup interval
    setInterval(() => this.cleanupStaleWorkers(), HEARTBEAT_INTERVAL_MS);

    this.initialized = true;
    this.emit('initialized');
    log.info('Edge Worker Manager initialized');
  }

  /**
   * Register a new edge worker
   */
  registerWorker(
    deviceId: string,
    capabilities: EdgeWorker['capabilities'],
    userId?: string
  ): EdgeWorker {
    const id = `edge-${crypto.randomBytes(6).toString('hex')}`;

    const worker: EdgeWorker = {
      id,
      deviceId,
      userId,
      capabilities,
      status: 'online',
      lastHeartbeat: new Date().toISOString(),
      cachedModels: [],
      federatedLearning: {
        enabled: false,
        lastContribution: null,
        contributionsCount: 0,
        privacyLevel: 'high'
      },
      syncState: {
        lastSync: new Date().toISOString(),
        pendingChanges: 0,
        conflictsResolved: 0
      },
      registered: new Date().toISOString()
    };

    this.workers.set(id, worker);

    // Initialize sync state
    this.syncStates.set(id, {
      deviceId,
      collections: {},
      conflicts: [],
      status: 'synced'
    });

    this.emit('worker-registered', { workerId: id, deviceId });
    log.info('Edge worker registered', { workerId: id, deviceId });

    return worker;
  }

  /**
   * Update worker heartbeat
   */
  heartbeat(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    worker.lastHeartbeat = new Date().toISOString();
    worker.status = 'online';

    return true;
  }

  /**
   * Update worker capabilities
   */
  updateCapabilities(workerId: string, capabilities: Partial<EdgeWorker['capabilities']>): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    worker.capabilities = { ...worker.capabilities, ...capabilities };
    return true;
  }

  /**
   * Enable federated learning for a worker
   */
  enableFederatedLearning(
    workerId: string,
    privacyLevel: 'high' | 'medium' | 'low'
  ): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    worker.federatedLearning.enabled = true;
    worker.federatedLearning.privacyLevel = privacyLevel;

    this.emit('federated-learning-enabled', { workerId, privacyLevel });
    log.info('Federated learning enabled', { workerId, privacyLevel });

    return true;
  }

  /**
   * Submit a task to an edge worker
   */
  async submitTask(
    workerId: string,
    type: EdgeTask['type'],
    modelId: string,
    payload: EdgeTask['payload'],
    priority: EdgeTask['priority'] = 'normal'
  ): Promise<EdgeTask> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    if (worker.status !== 'online') {
      throw new Error(`Worker is not online: ${worker.status}`);
    }

    const id = `task-${crypto.randomBytes(6).toString('hex')}`;

    const task: EdgeTask = {
      id,
      type,
      modelId,
      priority,
      payload,
      constraints: {
        maxMemoryMb: worker.capabilities.memory * 0.8,
        maxDurationMs: payload.maxLatencyMs || 30000,
        requiresGpu: type === 'inference' && worker.capabilities.webgpu
      },
      created: new Date().toISOString(),
      deadline: new Date(Date.now() + (payload.maxLatencyMs || 30000)).toISOString()
    };

    this.tasks.set(id, task);
    worker.status = 'busy';

    this.emit('task-submitted', { taskId: id, workerId, type });
    log.info('Task submitted to edge worker', { taskId: id, workerId, type });

    return task;
  }

  /**
   * Report task result
   */
  reportTaskResult(
    taskId: string,
    workerId: string,
    success: boolean,
    output?: unknown,
    error?: string,
    metrics?: EdgeTaskResult['metrics']
  ): EdgeTaskResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'online';
    }

    const result: EdgeTaskResult = {
      taskId,
      workerId,
      success,
      output,
      error,
      metrics: metrics || {
        durationMs: Date.now() - new Date(task.created).getTime(),
        memoryUsedMb: 0
      },
      verification: {
        checksum: crypto.createHash('sha256')
          .update(JSON.stringify(output || error))
          .digest('hex'),
        signature: 'result-signature'
      },
      completed: new Date().toISOString()
    };

    this.taskResults.set(taskId, result);
    this.tasks.delete(taskId);

    this.emit('task-completed', { taskId, workerId, success });
    log.info('Task completed', { taskId, workerId, success });

    return result;
  }

  /**
   * Submit federated learning gradient
   */
  submitGradient(
    workerId: string,
    modelId: string,
    gradientData: Uint8Array,
    metadata: { samples: number; loss: number }
  ): { accepted: boolean; contributionId: string } {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    if (!worker.federatedLearning.enabled) {
      throw new Error('Federated learning not enabled for this worker');
    }

    // Apply differential privacy based on privacy level
    const noiseLevel = this.getNoiseLevel(worker.federatedLearning.privacyLevel);

    // In production, apply actual differential privacy noise
    const contributionId = `contrib-${crypto.randomBytes(6).toString('hex')}`;

    // Update worker stats
    worker.federatedLearning.lastContribution = new Date().toISOString();
    worker.federatedLearning.contributionsCount++;

    this.emit('gradient-submitted', {
      workerId,
      modelId,
      contributionId,
      samples: metadata.samples
    });

    log.info('Gradient submitted', {
      workerId,
      modelId,
      contributionId,
      samples: metadata.samples,
      noiseLevel
    });

    return { accepted: true, contributionId };
  }

  /**
   * Get noise level for differential privacy
   */
  private getNoiseLevel(privacyLevel: 'high' | 'medium' | 'low'): number {
    switch (privacyLevel) {
      case 'high': return 1.0;
      case 'medium': return 0.5;
      case 'low': return 0.1;
    }
  }

  /**
   * Update cached models for a worker
   */
  updateCachedModels(workerId: string, modelIds: string[]): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    // Limit cached models
    worker.cachedModels = modelIds.slice(0, MAX_CACHED_MODELS);
    return true;
  }

  /**
   * Sync document with CRDT
   */
  syncDocument<T>(
    workerId: string,
    collection: string,
    documentId: string,
    localValue: T,
    localVector: Record<string, number>
  ): CRDTDocument<T> {
    const docKey = `${collection}:${documentId}`;
    let doc = this.documents.get(docKey) as CRDTDocument<T> | undefined;

    if (!doc) {
      // Create new document
      doc = {
        id: documentId,
        collection,
        state: {
          value: localValue,
          vector: localVector,
          lastModified: new Date().toISOString(),
          modifiedBy: workerId
        },
        sync: {
          localVersion: 1,
          remoteVersion: 1,
          pendingOps: [],
          lastSync: new Date().toISOString()
        }
      };
      this.documents.set(docKey, doc);
    } else {
      // Merge with CRDT rules
      doc = this.mergeDocument(doc, localValue, localVector, workerId);
    }

    // Update sync state
    const syncState = this.syncStates.get(workerId);
    if (syncState) {
      syncState.collections[collection] = {
        localVersion: doc.sync.localVersion,
        remoteVersion: doc.sync.remoteVersion,
        pendingOps: doc.sync.pendingOps.length,
        lastSync: new Date().toISOString()
      };
      syncState.status = 'synced';
    }

    this.emit('document-synced', { workerId, collection, documentId });

    return doc;
  }

  /**
   * Merge document using CRDT rules (Last-Writer-Wins with vector clocks)
   */
  private mergeDocument<T>(
    existing: CRDTDocument<T>,
    newValue: T,
    newVector: Record<string, number>,
    modifiedBy: string
  ): CRDTDocument<T> {
    // Compare vector clocks
    const isNewer = this.isVectorNewer(newVector, existing.state.vector);
    const isConcurrent = this.isVectorConcurrent(newVector, existing.state.vector);

    if (isNewer) {
      // New value is strictly newer
      existing.state.value = newValue;
      existing.state.vector = this.mergeVectors(existing.state.vector, newVector);
      existing.state.lastModified = new Date().toISOString();
      existing.state.modifiedBy = modifiedBy;
      existing.sync.remoteVersion++;
    } else if (isConcurrent) {
      // Concurrent updates - use deterministic merge
      existing.state.value = this.deterministicMerge(existing.state.value, newValue);
      existing.state.vector = this.mergeVectors(existing.state.vector, newVector);
      existing.state.lastModified = new Date().toISOString();
      existing.state.modifiedBy = 'merge';
      existing.sync.remoteVersion++;
    }
    // If not newer and not concurrent, keep existing

    existing.sync.lastSync = new Date().toISOString();
    return existing;
  }

  /**
   * Check if vector A is strictly newer than vector B
   */
  private isVectorNewer(a: Record<string, number>, b: Record<string, number>): boolean {
    let anyNewer = false;
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const key of allKeys) {
      const aVal = a[key] || 0;
      const bVal = b[key] || 0;
      if (aVal < bVal) return false;
      if (aVal > bVal) anyNewer = true;
    }

    return anyNewer;
  }

  /**
   * Check if vectors are concurrent (neither is strictly newer)
   */
  private isVectorConcurrent(a: Record<string, number>, b: Record<string, number>): boolean {
    let aHasNewer = false;
    let bHasNewer = false;
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const key of allKeys) {
      const aVal = a[key] || 0;
      const bVal = b[key] || 0;
      if (aVal > bVal) aHasNewer = true;
      if (bVal > aVal) bHasNewer = true;
    }

    return aHasNewer && bHasNewer;
  }

  /**
   * Merge two vector clocks
   */
  private mergeVectors(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = { ...a };
    for (const [key, val] of Object.entries(b)) {
      result[key] = Math.max(result[key] || 0, val);
    }
    return result;
  }

  /**
   * Deterministic merge for concurrent updates
   * Uses sorted keys JSON stringify for consistent ordering
   */
  private deterministicMerge<T>(a: T, b: T): T {
    // Use sorted keys JSON stringify for consistent ordering across JS engines
    const sortedStringify = (obj: unknown): string => {
      if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
      }
      if (Array.isArray(obj)) {
        return '[' + obj.map(sortedStringify).join(',') + ']';
      }
      const keys = Object.keys(obj as object).sort();
      return '{' + keys.map(k => `"${k}":${sortedStringify((obj as Record<string, unknown>)[k])}`).join(',') + '}';
    };
    
    const aStr = sortedStringify(a);
    const bStr = sortedStringify(b);
    return aStr > bStr ? a : b;
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): EdgeWorker | null {
    return this.workers.get(workerId) || null;
  }

  /**
   * List workers
   */
  listWorkers(filter?: { status?: EdgeWorker['status'] }): EdgeWorker[] {
    let workers = Array.from(this.workers.values());

    if (filter?.status) {
      workers = workers.filter(w => w.status === filter.status);
    }

    return workers;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): EdgeTask | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get task result
   */
  getTaskResult(taskId: string): EdgeTaskResult | null {
    return this.taskResults.get(taskId) || null;
  }

  /**
   * Get sync state for a worker
   */
  getSyncState(workerId: string): SyncState | null {
    return this.syncStates.get(workerId) || null;
  }

  /**
   * Cleanup stale workers
   */
  private cleanupStaleWorkers(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, worker] of this.workers) {
      const lastHeartbeat = new Date(worker.lastHeartbeat).getTime();
      if (now - lastHeartbeat > WORKER_TIMEOUT_MS) {
        worker.status = 'offline';
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info('Marked stale workers as offline', { count: cleaned });
    }
  }

  /**
   * Unregister a worker
   */
  unregisterWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    this.workers.delete(workerId);
    this.syncStates.delete(workerId);

    this.emit('worker-unregistered', { workerId });
    log.info('Edge worker unregistered', { workerId });

    return true;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalWorkers: number;
    onlineWorkers: number;
    busyWorkers: number;
    offlineWorkers: number;
    pendingTasks: number;
    completedTasks: number;
    federatedLearningEnabled: number;
    totalContributions: number;
  } {
    const workers = Array.from(this.workers.values());
    const totalContributions = workers.reduce(
      (sum, w) => sum + w.federatedLearning.contributionsCount, 0
    );

    return {
      totalWorkers: workers.length,
      onlineWorkers: workers.filter(w => w.status === 'online').length,
      busyWorkers: workers.filter(w => w.status === 'busy').length,
      offlineWorkers: workers.filter(w => w.status === 'offline').length,
      pendingTasks: this.tasks.size,
      completedTasks: this.taskResults.size,
      federatedLearningEnabled: workers.filter(w => w.federatedLearning.enabled).length,
      totalContributions
    };
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
    log.info('Shutting down Edge Worker Manager...');
    this.workers.clear();
    this.tasks.clear();
    this.taskResults.clear();
    this.syncStates.clear();
    this.documents.clear();
    this.initialized = false;
    log.info('Edge Worker Manager shutdown complete');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EdgeWorkerManager | null = null;

export function getEdgeWorkerManager(): EdgeWorkerManager {
  if (!instance) {
    instance = new EdgeWorkerManager();
  }
  return instance;
}

export async function initializeEdgeWorkerManager(): Promise<EdgeWorkerManager> {
  const manager = getEdgeWorkerManager();
  await manager.initialize();
  return manager;
}

export async function shutdownEdgeWorkerManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  EdgeWorkerManager,
  getEdgeWorkerManager,
  initializeEdgeWorkerManager,
  shutdownEdgeWorkerManager
};
