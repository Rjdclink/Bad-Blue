import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import {
  runProfitabilityMonteCarlo,
  type MonteCarloProfitabilityInput,
  type MonteCarloProfitabilityResult,
} from './monte-carlo-profitability.js';

type PendingJob = {
  id: string;
  input: MonteCarloProfitabilityInput;
  resolve: (value: MonteCarloProfitabilityResult) => void;
  reject: (error: Error) => void;
};

type WorkerMessage = {
  id: string;
  result?: MonteCarloProfitabilityResult;
  error?: string;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
  currentJobId: string | null;
};

type CacheEntry = {
  expiresAt: number;
  result: MonteCarloProfitabilityResult;
};

function configuredWorkerCount(): number {
  const available = Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
  const fallback = Math.max(1, Math.min(4, available > 1 ? available - 1 : 1));
  const configured = Number(process.env.CRYPTOCRAWL_PARALLEL_MC_WORKERS || fallback);
  return Math.max(1, Math.min(8, available, Number.isFinite(configured) ? Math.trunc(configured) : fallback));
}

function workerExecutionEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.CRYPTOCRAWL_PARALLEL_MC_DISABLED !== 'true';
}

class ParallelMonteCarloPool {
  private readonly queue: PendingJob[] = [];
  private readonly pending = new Map<string, PendingJob>();
  private readonly slots: WorkerSlot[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlightByKey = new Map<string, Promise<MonteCarloProfitabilityResult>>();
  private initialized = false;
  private workerFailures = 0;
  private cacheHits = 0;
  private completed = 0;

  private ensureWorkers(): void {
    if (this.initialized || !workerExecutionEnabled()) return;
    this.initialized = true;
    for (let index = 0; index < configuredWorkerCount(); index += 1) this.spawnWorker();
  }

  private spawnWorker(): void {
    const worker = new Worker(new URL('./cryptocrawl-monte-carlo-worker.js', import.meta.url));
    const slot: WorkerSlot = { worker, busy: false, currentJobId: null };
    worker.on('message', (message: WorkerMessage) => this.handleMessage(slot, message));
    worker.on('error', error => this.handleWorkerFailure(slot, error));
    worker.on('exit', code => {
      if (code !== 0) this.handleWorkerFailure(slot, new Error(`Monte Carlo worker exited with code ${code}`));
    });
    this.slots.push(slot);
  }

  private handleMessage(slot: WorkerSlot, message: WorkerMessage): void {
    const job = this.pending.get(message.id);
    if (!job) return;
    this.pending.delete(message.id);
    slot.busy = false;
    slot.currentJobId = null;
    if (message.error || !message.result) job.reject(new Error(message.error || 'Monte Carlo worker returned no result'));
    else {
      this.completed += 1;
      job.resolve(message.result);
    }
    this.dispatch();
  }

  private handleWorkerFailure(slot: WorkerSlot, error: Error): void {
    const jobId = slot.currentJobId;
    if (jobId) {
      const job = this.pending.get(jobId);
      if (job) {
        this.pending.delete(jobId);
        job.reject(error);
      }
    }
    slot.busy = false;
    slot.currentJobId = null;
    this.workerFailures += 1;
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    void slot.worker.terminate().catch(() => undefined);
    if (workerExecutionEnabled()) this.spawnWorker();
    this.dispatch();
  }

  private dispatch(): void {
    if (!workerExecutionEnabled()) return;
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const job = this.queue.shift();
      if (!job) break;
      slot.busy = true;
      slot.currentJobId = job.id;
      this.pending.set(job.id, job);
      slot.worker.postMessage({ id: job.id, input: job.input });
    }
  }

  private executeOffThread(input: MonteCarloProfitabilityInput): Promise<MonteCarloProfitabilityResult> {
    this.ensureWorkers();
    if (!workerExecutionEnabled() || this.slots.length === 0) {
      return new Promise((resolve, reject) => {
        setImmediate(() => {
          try { resolve(runProfitabilityMonteCarlo(input)); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        });
      });
    }
    return new Promise<MonteCarloProfitabilityResult>((resolve, reject) => {
      this.queue.push({ id: randomUUID(), input, resolve, reject });
      this.dispatch();
    });
  }

  getCached(key: string): MonteCarloProfitabilityResult | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    this.cacheHits += 1;
    return cached.result;
  }

  run(
    key: string,
    input: MonteCarloProfitabilityInput,
    ttlMs: number,
  ): Promise<MonteCarloProfitabilityResult> {
    const cached = this.getCached(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.inFlightByKey.get(key);
    if (existing) return existing;

    const promise = this.executeOffThread(input)
      .catch(() => runProfitabilityMonteCarlo(input))
      .then(result => {
        this.cache.set(key, {
          expiresAt: Date.now() + Math.max(100, Math.min(120_000, ttlMs)),
          result,
        });
        return result;
      })
      .finally(() => this.inFlightByKey.delete(key));
    this.inFlightByKey.set(key, promise);
    return promise;
  }

  prewarm(key: string, input: MonteCarloProfitabilityInput, ttlMs: number): void {
    void this.run(key, input, ttlMs).catch(() => undefined);
  }

  getStatus() {
    return {
      workerExecutionEnabled: workerExecutionEnabled(),
      configuredWorkers: configuredWorkerCount(),
      activeWorkers: this.slots.filter(slot => slot.busy).length,
      idleWorkers: this.slots.filter(slot => !slot.busy).length,
      queuedJobs: this.queue.length,
      inFlightKeys: this.inFlightByKey.size,
      cachedResults: this.cache.size,
      cacheHits: this.cacheHits,
      completed: this.completed,
      workerFailures: this.workerFailures,
      mainEventLoopExecutionAuthority: false,
    };
  }
}

export const parallelMonteCarloPool = new ParallelMonteCarloPool();
