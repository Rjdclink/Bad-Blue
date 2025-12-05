/**
 * ML/NLP Worker Orchestrator
 * 
 * Coordinates ML and NLP workers in the OSINT pipeline
 * Node-compatible implementation using TensorFlow.js and Node-native NLP tools
 */

import { logger } from '../../logger';

export interface WorkerInput {
  text?: string;
  entities?: any[];
  metadata?: Record<string, any>;
}

export interface WorkerOutput {
  success: boolean;
  data?: any;
  error?: string;
  confidence?: number;
  processingTime?: number;
}

export interface Worker {
  name: string;
  process(input: WorkerInput): Promise<WorkerOutput>;
  healthCheck(): Promise<boolean>;
}

/**
 * Worker orchestrator - manages execution of ML/NLP workers
 */
export class WorkerOrchestrator {
  private workers: Map<string, Worker> = new Map();

  /**
   * Register a worker
   */
  registerWorker(worker: Worker): void {
    this.workers.set(worker.name, worker);
    logger.info(`[ML/NLP Orchestrator] Registered worker: ${worker.name}`);
  }

  /**
   * Execute a specific worker
   */
  async executeWorker(workerName: string, input: WorkerInput): Promise<WorkerOutput> {
    const startTime = Date.now();
    const worker = this.workers.get(workerName);

    if (!worker) {
      return {
        success: false,
        error: `Worker not found: ${workerName}`,
      };
    }

    try {
      logger.debug(`[ML/NLP Orchestrator] Executing worker: ${workerName}`);
      const result = await worker.process(input);
      const processingTime = Date.now() - startTime;

      return {
        ...result,
        processingTime,
      };
    } catch (error) {
      logger.error(`[ML/NLP Orchestrator] Worker ${workerName} failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute multiple workers in sequence
   */
  async executeSequence(workerNames: string[], input: WorkerInput): Promise<WorkerOutput[]> {
    const results: WorkerOutput[] = [];

    for (const workerName of workerNames) {
      const result = await this.executeWorker(workerName, input);
      results.push(result);

      // If a critical worker fails, stop the sequence
      if (!result.success) {
        logger.warn(`[ML/NLP Orchestrator] Sequence stopped at ${workerName}`);
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple workers in parallel
   */
  async executeParallel(workerNames: string[], input: WorkerInput): Promise<WorkerOutput[]> {
    const promises = workerNames.map(workerName => 
      this.executeWorker(workerName, input)
    );

    return Promise.all(promises);
  }

  /**
   * Health check all workers
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const workersArray = Array.from(this.workers.entries());
    for (const [name, worker] of workersArray) {
      try {
        results[name] = await worker.healthCheck();
      } catch (error) {
        logger.error(`[ML/NLP Orchestrator] Health check failed for ${name}:`, error);
        results[name] = false;
      }
    }

    return results;
  }

  /**
   * Get list of registered workers
   */
  getRegisteredWorkers(): string[] {
    return Array.from(this.workers.keys());
  }
}

// Singleton instance
export const workerOrchestrator = new WorkerOrchestrator();
