import {
  primeCryptaraSharedInformation,
  requestCryptaraSharedInformation,
  type CryptaraInformationClass,
} from './cryptara-super-worker.js';
import {
  isCryptaraParallelProxyConfigured,
  type CryptaraParallelProxyWorkload,
} from './cryptara-supabase-overflow-worker.js';

/**
 * Dedicated control worker for the overflow Supabase lane.
 *
 * It does not create another cache, database pool, timer, or authority surface.
 * The primary and overflow workers communicate through the existing process-local
 * Cryptara shared-information broker. That broker is the coherence directory:
 * either worker can publish a fresh non-authoritative value and the other sees it
 * without a database round trip. A request routed to overflow therefore performs
 * a local shared-memory lookup first and, on a miss, talks only to overflow.
 * It never contacts the authoritative primary database as part of an overflow read.
 */

const LOCAL_ONLY_MISS = 'CRYPTARA_OVERFLOW_SUPER_WORKER_LOCAL_ONLY_MISS';
const MAX_SHARED_FRESH_MS = 5_000;

export type CryptaraOverflowSuperWorkerRequest<T> = {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
  loadOverflow: () => Promise<T | null>;
  isUsable?: (value: T | null) => boolean;
  freshForMs?: number;
  estimatedBytes?: number;
};

type ShareInput<T> = {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
  value: T;
  freshForMs?: number;
  estimatedBytes?: number;
};

const inFlight = new Map<string, Promise<unknown>>();
let started = false;
let localSharedHits = 0;
let overflowLoads = 0;
let coalescedOverflowLoads = 0;
let overflowMisses = 0;
let primaryToOverflowShares = 0;
let overflowToPrimaryShares = 0;
let loadFailures = 0;

function boundedFreshMs(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 250;
  return Math.max(1, Math.min(MAX_SHARED_FRESH_MS, Math.trunc(parsed)));
}

function informationClassFor(workload: CryptaraParallelProxyWorkload): CryptaraInformationClass {
  if (workload === 'telemetry' || workload === 'observability') return 'resource_snapshot';
  return 'background';
}

function sharedKey(workload: CryptaraParallelProxyWorkload, topic: string, key: string): string {
  return `overflow-super-worker:${workload}:${topic.trim()}:${key.trim()}`;
}

function usable<T>(request: CryptaraOverflowSuperWorkerRequest<T>, value: T | null): boolean {
  return request.isUsable ? request.isUsable(value) : value !== null;
}

async function readLocalSharedOnly<T>(request: CryptaraOverflowSuperWorkerRequest<T>): Promise<T | null> {
  try {
    const lease = await requestCryptaraSharedInformation<T>({
      key: sharedKey(request.workload, request.topic, request.key),
      consumer: 'cryptara-overflow-super-worker',
      informationClass: informationClassFor(request.workload),
      // Zero requested freshness deliberately disables the broker's own overflow
      // lookup on a cache miss. This turns the existing broker into a local-only
      // coherence directory; no primary or overflow DB request is emitted here.
      freshForMs: 0,
      loader: () => {
        throw new Error(LOCAL_ONLY_MISS);
      },
      estimatedBytes: request.estimatedBytes,
    });
    const value = lease.value;
    lease.release();
    localSharedHits += 1;
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === LOCAL_ONLY_MISS) return null;
    throw error;
  }
}

function share<T>(input: ShareInput<T>): void {
  primeCryptaraSharedInformation({
    key: sharedKey(input.workload, input.topic, input.key),
    informationClass: informationClassFor(input.workload),
    value: input.value,
    freshForMs: boundedFreshMs(input.freshForMs),
    estimatedBytes: input.estimatedBytes,
  });
}

export function startCryptaraOverflowSuperWorker(): void {
  if (started) return;
  started = true;
  console.log('[CRYPTARA][OVERFLOW-SUPER-WORKER] dedicated overflow worker online; coherence=shared-local-broker, primary-db-calls=0');
}

/** Primary worker -> overflow worker: local memory only, no database request. */
export function shareCryptaraPrimaryInformationWithOverflowWorker<T>(input: ShareInput<T>): void {
  share(input);
  primaryToOverflowShares += 1;
}

/** Overflow worker -> primary worker: local memory only, no database request. */
export function shareCryptaraOverflowInformationWithPrimaryWorker<T>(input: ShareInput<T>): void {
  share(input);
  overflowToPrimaryShares += 1;
}

/**
 * Local shared state first, then one single-flight overflow acquisition.
 * There is intentionally no primary fallback here. Critical/authoritative callers
 * do not enter this worker; they continue to use the original primary authorities.
 */
export async function requestCryptaraOverflowSuperWorker<T>(
  request: CryptaraOverflowSuperWorkerRequest<T>,
): Promise<T | null> {
  if (!started) startCryptaraOverflowSuperWorker();
  if (!request.key.trim()) throw new Error('CRYPTARA_OVERFLOW_SUPER_WORKER_KEY_REQUIRED');
  if (!request.topic.trim()) throw new Error('CRYPTARA_OVERFLOW_SUPER_WORKER_TOPIC_REQUIRED');

  const local = await readLocalSharedOnly(request);
  if (usable(request, local)) return local;
  if (!isCryptaraParallelProxyConfigured) {
    overflowMisses += 1;
    return null;
  }

  const id = sharedKey(request.workload, request.topic, request.key);
  let pending = inFlight.get(id) as Promise<T | null> | undefined;
  if (!pending) {
    pending = Promise.resolve()
      .then(async () => {
        overflowLoads += 1;
        const value = await request.loadOverflow();
        if (usable(request, value) && value !== null) {
          shareCryptaraOverflowInformationWithPrimaryWorker({
            key: request.key,
            workload: request.workload,
            topic: request.topic,
            value,
            freshForMs: request.freshForMs,
            estimatedBytes: request.estimatedBytes,
          });
          return value;
        }
        overflowMisses += 1;
        return null;
      })
      .catch(error => {
        loadFailures += 1;
        throw error;
      })
      .finally(() => {
        if (inFlight.get(id) === pending) inFlight.delete(id);
      });
    inFlight.set(id, pending as Promise<unknown>);
  } else {
    coalescedOverflowLoads += 1;
  }
  return pending;
}

export function getCryptaraOverflowSuperWorkerSnapshot() {
  return {
    role: 'overflow_super_worker' as const,
    started,
    configured: isCryptaraParallelProxyConfigured,
    coherence: 'shared_local_broker' as const,
    authority: 'auxiliary_noncritical_only' as const,
    primaryDatabaseCalls: 0 as const,
    createsDatabasePool: false as const,
    createsDuplicateCache: false as const,
    inFlight: inFlight.size,
    localSharedHits,
    overflowLoads,
    coalescedOverflowLoads,
    overflowMisses,
    primaryToOverflowShares,
    overflowToPrimaryShares,
    loadFailures,
  };
}
