import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { BigNumber, providers } from 'ethers';
import {
  SkaleExternalGasPowAdapter,
  type SkaleExternalGasPowRequest,
  type SkaleExternalGasPowSolution,
} from '../cryptocrawl/execution/adapters/skale-pow-adapter.js';
import { computationalBeam } from './index.js';
import { CrawlerStrategy, type ComputeWorkload } from './types.js';

export interface SkalePowBeamMetrics {
  workersUsed: number;
  attempts: number;
  elapsedMs: number;
  winningPartition?: number;
  fallbackUsed: boolean;
}

export interface SkalePowBeamResult {
  solution: SkaleExternalGasPowSolution;
  metrics: SkalePowBeamMetrics;
}

type WorkerMessage =
  | { type: 'candidate'; gasPriceWei: string; externalGas: string; attempts: number; partitionId: number }
  | { type: 'cancelled'; attempts: number }
  | { type: 'exhausted'; attempts: number; partitionId: number };

export class SkalePowBeamWorkloadAdapter {
  constructor(private readonly provider: providers.Provider) {}

  async findProof(request: SkaleExternalGasPowRequest, options?: { workerCount?: number; signal?: AbortSignal }): Promise<SkalePowBeamResult> {
    if (request.signal?.aborted || options?.signal?.aborted) throw this.abortError();
    const availableCpus = Math.max(1, os.availableParallelism?.() || os.cpus().length);
    const workerCount = Math.max(1, Math.min(options?.workerCount || availableCpus, availableCpus, 32));
    const startedAt = Date.now();
    const fallback = new SkaleExternalGasPowAdapter(this.provider);

    if (workerCount === 1) {
      const solution = await fallback.findProof(request);
      return {
        solution,
        metrics: { workersUsed: 1, attempts: solution.attempts, elapsedMs: Date.now() - startedAt, winningPartition: 0, fallbackUsed: true },
      };
    }

    const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const cancellation = new Int32Array(cancellationBuffer);
    const workers: Worker[] = [];
    let totalAttempts = 0;

    try {
      const solution = await new Promise<SkaleExternalGasPowSolution>((resolve, reject) => {
        let settledWorkers = 0;
        let settled = false;
        let candidateVerificationInFlight = false;
        const completedPartitions = new Set<number>();
        const finish = (result?: SkaleExternalGasPowSolution, error?: Error) => {
          if (settled) return;
          settled = true;
          Atomics.store(cancellation, 0, 1);
          for (const worker of workers) void worker.terminate();
          if (result) resolve(result);
          else reject(error || new Error('All SKALE PoW worker partitions exhausted'));
        };
        const workerFinished = (partitionId: number) => {
          if (completedPartitions.has(partitionId)) return;
          completedPartitions.add(partitionId);
          settledWorkers += 1;
          if (settledWorkers === workerCount && !settled && !candidateVerificationInFlight) {
            finish(undefined, new Error('All SKALE PoW worker partitions exhausted'));
          }
        };
        const onAbort = () => finish(undefined, this.abortError());
        request.signal?.addEventListener('abort', onAbort, { once: true });
        options?.signal?.addEventListener('abort', onAbort, { once: true });

        for (let partitionId = 0; partitionId < workerCount; partitionId += 1) {
          const worker = new Worker(new URL('./skale-pow-worker.cjs', import.meta.url), {
            workerData: {
              workloadId: request.workloadId,
              sender: request.sender,
              nonce: request.nonce,
              difficulty: request.externalGasDifficulty.toString(),
              requiredGas: request.requiredGas.toString(),
              partitionId,
              partitionCount: workerCount,
              maxAttempts: request.maxAttempts,
              cancellationBuffer,
            },
          });
          workers.push(worker);
          worker.once('error', error => {
            if (!settled) workerFinished(partitionId);
            if (workerCount === 1) finish(undefined, error);
          });
          worker.once('exit', () => {
            if (!settled) workerFinished(partitionId);
          });
          worker.on('message', async (message: WorkerMessage) => {
            totalAttempts += message.attempts;
            if (message.type !== 'candidate' || settled) return;
            candidateVerificationInFlight = true;
            const candidate: SkaleExternalGasPowSolution = {
              gasPriceWei: message.gasPriceWei,
              externalGas: BigInt(message.externalGas),
              attempts: message.attempts,
              partitionId: message.partitionId,
            };
            try {
              if (await fallback.verifyProof(request, candidate)) finish(candidate);
            } finally {
              candidateVerificationInFlight = false;
              if (settledWorkers === workerCount && !settled) {
                finish(undefined, new Error('All SKALE PoW worker candidates failed independent validation'));
              }
            }
          });
        }
      });
      return {
        solution,
        metrics: {
          workersUsed: workerCount,
          attempts: totalAttempts,
          elapsedMs: Date.now() - startedAt,
          winningPartition: solution.partitionId,
          fallbackUsed: false,
        },
      };
    } catch {
      if (request.signal?.aborted || options?.signal?.aborted) throw this.abortError();
      const solution = await fallback.findProof({ ...request, partitionId: 0, partitionCount: 1 });
      return {
        solution,
        metrics: {
          workersUsed: workerCount,
          attempts: totalAttempts + solution.attempts,
          elapsedMs: Date.now() - startedAt,
          winningPartition: solution.partitionId,
          fallbackUsed: true,
        },
      };
    } finally {
      Atomics.store(cancellation, 0, 1);
      for (const worker of workers) void worker.terminate();
    }
  }

  async findProofThroughBeam(request: SkaleExternalGasPowRequest, options?: { workerCount?: number; timeoutMs?: number }): Promise<SkalePowBeamResult> {
    if (!computationalBeam.isOperational()) {
      await computationalBeam.initialize();
    }
    const timeoutMs = Math.max(1_000, options?.timeoutMs || 120_000);
    const workload: ComputeWorkload<SkaleExternalGasPowRequest, SkalePowBeamResult> = {
      id: `skale-pow:${request.workloadId}`,
      type: 'SKALE_TRANSACTION_POW',
      input: request,
      timeoutMs,
      execute: (input, context) => this.findProof(
        { ...input, signal: context.signal },
        { workerCount: options?.workerCount, signal: context.signal },
      ),
      validate: async (result, input) => {
        return result.solution.externalGas >= input.requiredGas &&
          await new SkaleExternalGasPowAdapter(this.provider).verifyProof(input, result.solution);
      },
    };
    const execution = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.ARBITRAGE,
      { workloadId: request.workloadId, type: workload.type },
      { timeout: timeoutMs, workload },
    );
    return execution.result as SkalePowBeamResult;
  }

  private abortError(): Error {
    const error = new Error('SKALE Beam PoW workload cancelled');
    error.name = 'AbortError';
    return error;
  }
}