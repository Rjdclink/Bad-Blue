import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import {
  QuantiParallelismError,
  quantiParallelismGovernor,
} from '../../../quantiComp/index.js';
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
  cleanupAbort?: () => void;
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

function quoteDeadlineAt(input: MonteCarloProfitabilityInput): number | undefined {
  const maxQuoteAgeMs = Number.isFinite(input.quoteMaxAgeMs)
    ? Math.max(1, Number(input.quoteMaxAgeMs))
    : Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const alreadyAgedMs = Math.max(0, Number(input.quoteLatencyMs) || 0);
  const remaining = maxQuoteAgeMs - alreadyAgedMs;
  return remaining > 0 ? Date.now() + remaining : Date.now();
}

function abortError(): Error {
  return new Error('MC_ABORTED: profitability Monte Carlo aborted');
}

class ParallelMonteCarloPool {
  private readonly queue: PendingJob[] = [];
  private readonly pending = new Map<string, PendingJob>();
  private readonly slots: WorkerSlot[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlightByKey = new Map<string, Promise<MonteCarloProfitabilityResult>>();
  private initialized = false;
  private workerFailures = 0;
  private workerCancellations = 0;
  private cacheHits = 0;
  private completed = 0;
  private governedRuns = 0;
  private deadlineRejects = 0;

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
    worker.unref?.();
    this.slots.push(slot);
  }

  private handleMessage(slot: WorkerSlot, message: WorkerMessage): void {
    const job = this.pending.get(message.id);
    if (!job) return;
    this.pending.delete(message.id);
    job.cleanupAbort?.();
    slot.busy = false;
    slot.currentJobId = null;
    slot.worker.unref?.();
    if (message.error || !message.result) job.reject(new Error(message.error || 'Monte Carlo worker returned no result'));
    else {
      this.completed += 1;
      job.resolve(message.result);
    }
    this.dispatch();
  }

  private handleWorkerFailure(slot: WorkerSlot, error: Error): void {
    const index = this.slots.indexOf(slot);
    // Worker 'error' is commonly followed by 'exit'. Process that physical
    // worker exactly once so one failure cannot create duplicate replacements.
    if (index < 0) return;
    this.slots.splice(index, 1);
    const jobId = slot.currentJobId;
    if (jobId) {
      const job = this.pending.get(jobId);
      if (job) {
        this.pending.delete(jobId);
        job.cleanupAbort?.();
        job.reject(error);
      }
    }
    slot.busy = false;
    slot.currentJobId = null;
    this.workerFailures += 1;
    void slot.worker.terminate().catch(() => undefined);
    if (workerExecutionEnabled()) this.spawnWorker();
    this.dispatch();
  }

  private cancelJob(job: PendingJob): void {
    const queuedIndex = this.queue.findIndex(candidate => candidate.id === job.id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      job.cleanupAbort?.();
      job.reject(abortError());
      return;
    }

    const slot = this.slots.find(candidate => candidate.currentJobId === job.id);
    if (!slot) return;
    const slotIndex = this.slots.indexOf(slot);
    if (slotIndex >= 0) this.slots.splice(slotIndex, 1);
    this.pending.delete(job.id);
    job.cleanupAbort?.();
    job.reject(abortError());
    slot.currentJobId = null;
    slot.busy = false;
    this.workerCancellations += 1;
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
      slot.worker.ref?.();
      this.pending.set(job.id, job);
      slot.worker.postMessage({ id: job.id, input: job.input });
    }
  }

  private executeOffThread(
    input: MonteCarloProfitabilityInput,
    signal?: AbortSignal,
  ): Promise<MonteCarloProfitabilityResult> {
    if (signal?.aborted) return Promise.reject(abortError());
    this.ensureWorkers();
    if (!workerExecutionEnabled() || this.slots.length === 0) {
      return new Promise((resolve, reject) => {
        setImmediate(() => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          try {
            const result = runProfitabilityMonteCarlo(input);
            if (signal?.aborted) reject(abortError());
            else resolve(result);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    }
    return new Promise<MonteCarloProfitabilityResult>((resolve, reject) => {
      const job: PendingJob = { id: randomUUID(), input, resolve, reject };
      if (signal) {
        const onAbort = () => this.cancelJob(job);
        signal.addEventListener('abort', onAbort, { once: true });
        job.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }
      this.queue.push(job);
      this.dispatch();
    });
  }

  private async executeGoverned(
    input: MonteCarloProfitabilityInput,
    signal?: AbortSignal,
  ): Promise<MonteCarloProfitabilityResult> {
    let lease;
    try {
      lease = await quantiParallelismGovernor.acquire({
        id: `execution-mc:${randomUUID()}`,
        units: 1,
        lane: 'hot',
        priority: 80,
        deadlineAt: quoteDeadlineAt(input),
        signal,
        metadata: { model: 'execution_profitability_monte_carlo', topology: input.topology || 'CEX_CEX' },
      });
    } catch (error) {
      if (error instanceof QuantiParallelismError && error.code === 'DEADLINE_EXPIRED') this.deadlineRejects += 1;
      throw error;
    }

    this.governedRuns += 1;
    try {
      try {
        return await this.executeOffThread(input, signal);
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.message.startsWith('MC_ABORTED:'))) throw error;
        // Worker startup/runtime degradation falls back to the exact same pure
        // model while retaining the Quanti resource lease. Resource-governor or
        // quote-deadline failures never bypass this authority.
        return runProfitabilityMonteCarlo(input);
      }
    } finally {
      lease.release();
    }
  }

  private followShared(
    promise: Promise<MonteCarloProfitabilityResult>,
    signal?: AbortSignal,
  ): Promise<MonteCarloProfitabilityResult> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        value => { cleanup(); resolve(value); },
        error => { cleanup(); reject(error); },
      );
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
    signal?: AbortSignal,
  ): Promise<MonteCarloProfitabilityResult> {
    const cached = this.getCached(key);
    if (cached) return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve(cached);
    const existing = this.inFlightByKey.get(key);
    if (existing) return this.followShared(existing, signal);

    const promise = this.executeGoverned(input, signal)
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
      workerCancellations: this.workerCancellations,
      governedRuns: this.governedRuns,
      deadlineRejects: this.deadlineRejects,
      parallelismAuthority: 'quanti_parallelism_governor',
      mainEventLoopExecutionAuthority: false,
    };
  }
}

export const parallelMonteCarloPool = new ParallelMonteCarloPool();