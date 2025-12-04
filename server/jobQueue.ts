/**
 * Simple in-memory job queue for background tasks
 * Replaces setTimeout-based task scheduling with proper job queue
 * 
 * Features:
 * - Priority-based job execution
 * - Retry logic with exponential backoff
 * - Job status tracking
 * - Graceful shutdown support
 */

import { EventEmitter } from 'events';

export interface Job {
  id: string;
  type: string;
  priority: number; // Lower number = higher priority
  data: any;
  retries: number;
  maxRetries: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface JobQueueOptions {
  concurrency?: number;
  defaultRetries?: number;
  retryDelay?: number;
}

export type JobHandler = (job: Job) => Promise<void>;

class JobQueue extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private processing: Set<string> = new Set();
  private isRunning: boolean = false;
  private concurrency: number;
  private defaultRetries: number;
  private retryDelay: number;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: JobQueueOptions = {}) {
    super();
    this.concurrency = options.concurrency || 5;
    this.defaultRetries = options.defaultRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Register a handler for a specific job type
   */
  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Add a job to the queue
   */
  async addJob(
    type: string,
    data: any,
    options: {
      priority?: number;
      maxRetries?: number;
      id?: string;
    } = {}
  ): Promise<string> {
    const id = options.id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    
    const job: Job = {
      id,
      type,
      priority: options.priority || 10,
      data,
      retries: 0,
      maxRetries: options.maxRetries ?? this.defaultRetries,
      createdAt: new Date(),
      status: 'pending',
    };

    this.jobs.set(id, job);
    this.emit('job:added', job);
    
    // Start processing if not already running
    if (!this.isRunning) {
      this.start();
    } else {
      this.processNext();
    }

    return id;
  }

  /**
   * Start the job processor
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.emit('queue:started');
    
    // Start multiple workers based on concurrency
    for (let i = 0; i < this.concurrency; i++) {
      this.processNext();
    }
  }

  /**
   * Stop the job processor gracefully
   */
  async stop(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = new Promise<void>((resolve) => {
      this.isRunning = false;
      this.emit('queue:stopping');

      // Wait for all processing jobs to complete
      const checkInterval = setInterval(() => {
        if (this.processing.size === 0) {
          clearInterval(checkInterval);
          this.emit('queue:stopped');
          resolve();
        }
      }, 100);

      // Force stop after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        this.emit('queue:stopped');
        resolve();
      }, 30000);
    });

    return this.shutdownPromise;
  }

  /**
   * Get the next job to process based on priority
   */
  private getNextJob(): Job | null {
    const pendingJobs = Array.from(this.jobs.entries())
      .map(([, job]) => job)
      .filter(job => job.status === 'pending' && !this.processing.has(job.id))
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

    return pendingJobs[0] || null;
  }

  /**
   * Process the next available job
   */
  private async processNext(): Promise<void> {
    if (!this.isRunning || this.processing.size >= this.concurrency) {
      return;
    }

    const job = this.getNextJob();
    if (!job) {
      return;
    }

    await this.processJob(job);
    
    // Continue processing if there are more jobs
    if (this.isRunning) {
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(`[JobQueue] No handler registered for job type: ${job.type}`);
      job.status = 'failed';
      job.failedAt = new Date();
      job.error = 'No handler registered';
      this.emit('job:failed', job);
      return;
    }

    this.processing.add(job.id);
    job.status = 'processing';
    job.startedAt = new Date();
    this.emit('job:started', job);

    try {
      await handler(job);
      job.status = 'completed';
      job.completedAt = new Date();
      this.emit('job:completed', job);
      
      // Remove completed job after a delay
      setTimeout(() => this.jobs.delete(job.id), 60000);
    } catch (error: any) {
      job.retries++;
      job.error = error.message || String(error);
      
      if (job.retries < job.maxRetries) {
        // Retry with exponential backoff
        const delay = this.retryDelay * Math.pow(2, job.retries - 1);
        job.status = 'pending';
        this.emit('job:retry', job, delay);
        
        setTimeout(() => {
          if (this.isRunning) {
            this.processNext();
          }
        }, delay);
      } else {
        job.status = 'failed';
        job.failedAt = new Date();
        this.emit('job:failed', job);
      }
    } finally {
      this.processing.delete(job.id);
    }
  }

  /**
   * Get job status
   */
  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
    };
  }

  /**
   * Clear all completed and failed jobs
   */
  clearCompleted(): number {
    let cleared = 0;
    const jobsArray = Array.from(this.jobs.entries());
    for (const [id, job] of jobsArray) {
      if (job.status === 'completed' || job.status === 'failed') {
        this.jobs.delete(id);
        cleared++;
      }
    }
    return cleared;
  }
}

// Export singleton instance
export const jobQueue = new JobQueue({
  concurrency: 5,
  defaultRetries: 3,
  retryDelay: 1000,
});

// Register common job handlers
jobQueue.registerHandler('email', async (job) => {
  // Email job handler placeholder
  // Implement actual email sending logic as needed
  console.log('Email job processed:', job.id);
});

jobQueue.registerHandler('document-generation', async (job) => {
  // Document generation job handler placeholder
  // Implement actual document generation logic as needed
  console.log('Document generation job processed:', job.id);
});

// Start the queue
jobQueue.start();

// Handle graceful shutdown
process.on('SIGTERM', () => jobQueue.stop());
process.on('SIGINT', () => jobQueue.stop());
