import {
  primeCryptaraSharedInformation,
  requestCryptaraSharedInformation,
  type CryptaraInformationClass,
} from './cryptara-super-worker.js';
import {
  isCryptaraParallelProxyConfigured,
  type CryptaraParallelProxyWorkload,
} from './cryptara-supabase-overflow-worker.js';
import { runThroughCryptaraOverflowPrimaryGateway } from './cryptara-overflow-primary-gateway.js';

/**
 * Dedicated control worker for the overflow Supabase lane.
 *
 * The worker is the information gateway: local shared coherence first, Overflow
 * Supabase second, and only on a genuine miss may it obtain the requested value
 * from authoritative Primary through the governed overflow-primary gateway. The
 * Primary result is immediately shared back into the local worker directory so
 * duplicate callers do not repeat the upstream request.
 *
 * It creates no database pool, timer, or authority surface. Primary remains the
 * authority; Overflow/bridge/worker owns transport ordering and deduplication only.
 * The allowed miss path still uses the application's existing Primary pool; this
 * worker does not pretend that a remote database-to-database relay already exists.
 */

const LOCAL_ONLY_MISS = 'CRYPTARA_OVERFLOW_SUPER_WORKER_LOCAL_ONLY_MISS';
const MAX_SHARED_FRESH_MS = 5_000;

export type CryptaraOverflowSuperWorkerRequest<T> = {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
  loadOverflow: () => Promise<T | null>;
  /** Called only after local + Overflow miss; execution occurs inside governed gateway context. */
  loadPrimaryUpstream?: () => Promise<T | null>;
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
let primaryUpstreamLoads = 0;
let primaryUpstreamHits = 0;
let primaryUpstreamMisses = 0;
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
      // lookup on a cache miss. This is a local-only coherence lookup.
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
  console.log('[CRYPTARA][OVERFLOW-SUPER-WORKER] dedicated overflow worker online; coherence=shared-local-broker, route=local->overflow->governed-primary-on-miss, primary-transport=existing-application-pool, ungoverned-primary-acquisitions=0');
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
 * One single-flight information path per key:
 * shared local -> Overflow Supabase -> authoritative Primary through governed gateway.
 * Primary is never contacted speculatively or as a health/recovery probe.
 */
export async function requestCryptaraOverflowSuperWorker<T>(
  request: CryptaraOverflowSuperWorkerRequest<T>,
): Promise<T | null> {
  if (!started) startCryptaraOverflowSuperWorker();
  if (!request.key.trim()) throw new Error('CRYPTARA_OVERFLOW_SUPER_WORKER_KEY_REQUIRED');
  if (!request.topic.trim()) throw new Error('CRYPTARA_OVERFLOW_SUPER_WORKER_TOPIC_REQUIRED');

  const local = await readLocalSharedOnly(request);
  if (usable(request, local)) return local;

  const id = sharedKey(request.workload, request.topic, request.key);
  let pending = inFlight.get(id) as Promise<T | null> | undefined;
  if (!pending) {
    pending = Promise.resolve()
      .then(async () => {
        if (isCryptaraParallelProxyConfigured) {
          overflowLoads += 1;
          const overflowValue = await request.loadOverflow();
          if (usable(request, overflowValue) && overflowValue !== null) {
            shareCryptaraOverflowInformationWithPrimaryWorker({
              key: request.key,
              workload: request.workload,
              topic: request.topic,
              value: overflowValue,
              freshForMs: request.freshForMs,
              estimatedBytes: request.estimatedBytes,
            });
            return overflowValue;
          }
          overflowMisses += 1;
        }

        if (request.loadPrimaryUpstream) {
          primaryUpstreamLoads += 1;
          const primaryValue = await runThroughCryptaraOverflowPrimaryGateway(
            `overflow_worker_fill:${request.workload}:${request.topic.trim()}`,
            request.loadPrimaryUpstream,
          );
          if (usable(request, primaryValue) && primaryValue !== null) {
            primaryUpstreamHits += 1;
            shareCryptaraPrimaryInformationWithOverflowWorker({
              key: request.key,
              workload: request.workload,
              topic: request.topic,
              value: primaryValue,
              freshForMs: request.freshForMs,
              estimatedBytes: request.estimatedBytes,
            });
            return primaryValue;
          }
          primaryUpstreamMisses += 1;
        }

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
    routing: 'local_then_overflow_then_governed_primary_on_miss' as const,
    authority: 'transport_only' as const,
    primaryTransport: 'existing_application_primary_pool' as const,
    remoteDatabaseRelay: false as const,
    ungovernedApplicationPrimaryAcquisitions: 0 as const,
    governedPrimaryUpstreamOperations: primaryUpstreamLoads,
    primaryDatabaseCalls: primaryUpstreamLoads,
    createsDatabasePool: false as const,
    createsDuplicateCache: false as const,
    inFlight: inFlight.size,
    localSharedHits,
    overflowLoads,
    coalescedOverflowLoads,
    overflowMisses,
    primaryUpstreamLoads,
    primaryUpstreamHits,
    primaryUpstreamMisses,
    primaryToOverflowShares,
    overflowToPrimaryShares,
    loadFailures,
  };
}
