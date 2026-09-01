import { quantiDataFabric } from '../../quantiComp/dataFabric.js';

export type CryptaraInformationClass =
  | 'execution_truth'
  | 'connector_readiness'
  | 'schema_authority'
  | 'market_snapshot'
  | 'resource_snapshot'
  | 'background';

export type CryptaraInformationSource = 'origin' | 'single_flight' | 'cache';
export type CryptaraDatabasePriority = 'critical' | 'high' | 'normal' | 'low';

export interface CryptaraInformationLease<T> {
  readonly value: T;
  readonly key: string;
  readonly consumer: string;
  readonly source: CryptaraInformationSource;
  readonly createdAt: number;
  readonly expiresAt: number;
  release(): void;
}

export interface CryptaraSharedInformationRequest<T, R = T> {
  key: string;
  consumer: string;
  informationClass: CryptaraInformationClass;
  loader: () => Promise<T> | T;
  /** Maximum amount of time the canonical result is semantically safe to reuse. */
  freshForMs?: number;
  /** Optional explicit projection so consumers receive only what they need. */
  project?: (value: T) => R;
  /** Optional bounded fan-out view for array/typed-array payloads. */
  maxItems?: number;
  /** Optional per-request consumer allow-list. */
  allowedConsumers?: readonly string[];
  /** Only set this when the loader can touch the ordinary DB lane. */
  databasePriority?: CryptaraDatabasePriority;
  /** Cheap caller-supplied memory estimate. Avoids serializing large payloads just to measure them. */
  estimatedBytes?: number;
}

export interface CryptaraSharedInformationPrime<T> {
  key: string;
  informationClass: CryptaraInformationClass;
  value: T;
  freshForMs?: number;
  estimatedBytes?: number;
}

export interface CryptaraSuperWorkerSnapshot {
  governor: 'cryptara';
  authority: 'resource_proxy_only';
  writeAuthority: false;
  executionAuthority: false;
  admissionInstalled: boolean;
  intelligenceActive: boolean;
  information: {
    retainedEntries: number;
    retainedBytes: number;
    inFlightOrigins: number;
    activeLeases: number;
    peakRetainedEntries: number;
    originLoads: number;
    cacheHits: number;
    coalescedRequests: number;
    upstreamCallsAvoided: number;
    loadFailures: number;
    evictions: number;
    activeConsumers: Record<string, number>;
  };
  dataFabric: ReturnType<typeof quantiDataFabric.getStatus>;
}

type CacheEntry<T = unknown> = {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  lastAccessAt: number;
  readers: number;
  bytes: number;
};

const CLASS_DEFAULT_FRESH_MS: Record<CryptaraInformationClass, number> = {
  execution_truth: 0,
  connector_readiness: 1_000,
  schema_authority: 300_000,
  market_snapshot: 250,
  resource_snapshot: 1_000,
  background: 5_000,
};

const CLASS_MAX_FRESH_MS: Record<CryptaraInformationClass, number> = {
  execution_truth: 0,
  connector_readiness: 5_000,
  schema_authority: 900_000,
  market_snapshot: 1_000,
  resource_snapshot: 5_000,
  background: 60_000,
};

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
}

const MAX_RETAINED_ENTRIES = boundedInt(process.env.CRYPTARA_SUPER_WORKER_MAX_SHARED_ENTRIES, 256, 16, 2_048);
const MAX_RETAINED_BYTES = boundedInt(process.env.CRYPTARA_SUPER_WORKER_MAX_SHARED_BYTES, 8 * 1024 * 1024, 256 * 1024, 64 * 1024 * 1024);

class CryptaraSharedInformationBroker {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();
  private readonly activeConsumers = new Map<string, number>();
  private retainedBytes = 0;
  private activeLeases = 0;
  private peakRetainedEntries = 0;
  private originLoads = 0;
  private cacheHits = 0;
  private coalescedRequests = 0;
  private loadFailures = 0;
  private evictions = 0;

  private effectiveFreshMs(informationClass: CryptaraInformationClass, requested: unknown): number {
    const fallback = CLASS_DEFAULT_FRESH_MS[informationClass];
    const maximum = CLASS_MAX_FRESH_MS[informationClass];
    return boundedInt(requested, fallback, 0, maximum);
  }

  private estimateBytes(value: unknown, explicit?: number): number {
    if (Number.isFinite(explicit) && Number(explicit) >= 0) return Math.floor(Number(explicit));
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (Array.isArray(value)) return Math.min(MAX_RETAINED_BYTES, Math.max(64, value.length * 64));
    return 1_024;
  }

  private removeEntry(entry: CacheEntry): void {
    if (this.cache.get(entry.key) !== entry) return;
    this.cache.delete(entry.key);
    this.retainedBytes = Math.max(0, this.retainedBytes - entry.bytes);
    this.evictions += 1;
  }

  private cleanupExpired(now = Date.now()): void {
    for (const entry of this.cache.values()) {
      if (entry.expiresAt <= now && entry.readers === 0) this.removeEntry(entry);
    }
  }

  private enforceBounds(): void {
    this.cleanupExpired();
    if (this.cache.size <= MAX_RETAINED_ENTRIES && this.retainedBytes <= MAX_RETAINED_BYTES) return;

    const candidates = [...this.cache.values()]
      .filter(entry => entry.readers === 0)
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
    for (const entry of candidates) {
      if (this.cache.size <= MAX_RETAINED_ENTRIES && this.retainedBytes <= MAX_RETAINED_BYTES) break;
      this.removeEntry(entry);
    }
  }

  private projectValue<T, R>(entry: CacheEntry<T>, request: CryptaraSharedInformationRequest<T, R>): R {
    if (request.project) return request.project(entry.value);
    const maxItems = boundedInt(request.maxItems, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
    const value: any = entry.value as any;
    if (Number.isFinite(Number(request.maxItems)) && Array.isArray(value)) return value.slice(0, maxItems) as R;
    if (Number.isFinite(Number(request.maxItems)) && ArrayBuffer.isView(value) && typeof value.slice === 'function') {
      return value.slice(0, maxItems) as R;
    }
    return entry.value as unknown as R;
  }

  private lease<T, R>(
    entry: CacheEntry<T>,
    request: CryptaraSharedInformationRequest<T, R>,
    source: CryptaraInformationSource,
  ): CryptaraInformationLease<R> {
    entry.readers += 1;
    entry.lastAccessAt = Date.now();
    this.activeLeases += 1;
    this.activeConsumers.set(request.consumer, (this.activeConsumers.get(request.consumer) || 0) + 1);
    let released = false;
    const value = this.projectValue(entry, request);

    return {
      value,
      key: entry.key,
      consumer: request.consumer,
      source,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      release: () => {
        if (released) return;
        released = true;
        entry.readers = Math.max(0, entry.readers - 1);
        this.activeLeases = Math.max(0, this.activeLeases - 1);
        const nextConsumerCount = Math.max(0, (this.activeConsumers.get(request.consumer) || 0) - 1);
        if (nextConsumerCount === 0) this.activeConsumers.delete(request.consumer);
        else this.activeConsumers.set(request.consumer, nextConsumerCount);
        if (entry.expiresAt <= Date.now() && entry.readers === 0) this.removeEntry(entry);
      },
    };
  }

  private async runLoader<T>(request: CryptaraSharedInformationRequest<T, unknown>): Promise<T> {
    if (!request.databasePriority) return request.loader();
    const { withCryptaraSupabasePriority } = await import('./cryptara-supabase-admission-worker.js');
    return withCryptaraSupabasePriority(request.databasePriority, request.loader);
  }

  async request<T, R = T>(request: CryptaraSharedInformationRequest<T, R>): Promise<CryptaraInformationLease<R>> {
    if (!request.key.trim()) throw new Error('CRYPTARA_SUPER_WORKER_INFORMATION_KEY_REQUIRED');
    if (!request.consumer.trim()) throw new Error('CRYPTARA_SUPER_WORKER_CONSUMER_REQUIRED');
    if (request.allowedConsumers && !request.allowedConsumers.includes(request.consumer)) {
      throw new Error(`CRYPTARA_SUPER_WORKER_CONSUMER_NOT_ALLOWED:${request.consumer}`);
    }

    const now = Date.now();
    this.cleanupExpired(now);
    const cached = this.cache.get(request.key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      this.cacheHits += 1;
      return this.lease(cached, request, 'cache');
    }

    let pending = this.inFlight.get(request.key) as Promise<CacheEntry<T>> | undefined;
    let source: CryptaraInformationSource = 'single_flight';
    if (!pending) {
      source = 'origin';
      this.originLoads += 1;
      const freshForMs = this.effectiveFreshMs(request.informationClass, request.freshForMs);
      pending = Promise.resolve()
        .then(() => this.runLoader(request))
        .then(value => {
          const loadedAt = Date.now();
          const entry: CacheEntry<T> = {
            key: request.key,
            value,
            createdAt: loadedAt,
            expiresAt: loadedAt + freshForMs,
            lastAccessAt: loadedAt,
            readers: 0,
            bytes: this.estimateBytes(value, request.estimatedBytes),
          };
          if (freshForMs > 0) {
            const previous = this.cache.get(request.key);
            // Never overwrite the accounting of an older generation while a
            // consumer still has it pinned. Deliver the new generation now but
            // keep it ephemeral until the old lease drains; the next request can
            // then retain a fresh canonical generation without hidden memory.
            if (!previous || previous.readers === 0) {
              if (previous) this.removeEntry(previous);
              this.cache.set(request.key, entry);
              this.retainedBytes += entry.bytes;
              this.peakRetainedEntries = Math.max(this.peakRetainedEntries, this.cache.size);
              this.enforceBounds();
            }
          }
          return entry;
        })
        .catch(error => {
          this.loadFailures += 1;
          throw error;
        })
        .finally(() => {
          if (this.inFlight.get(request.key) === pending) this.inFlight.delete(request.key);
        });
      this.inFlight.set(request.key, pending as Promise<CacheEntry>);
    } else {
      this.coalescedRequests += 1;
    }

    const entry = await pending;
    return this.lease(entry, request, source);
  }

  prime<T>(input: CryptaraSharedInformationPrime<T>): void {
    const freshForMs = this.effectiveFreshMs(input.informationClass, input.freshForMs);
    if (freshForMs <= 0) return;
    const now = Date.now();
    this.cleanupExpired(now);
    const previous = this.cache.get(input.key);
    if (previous?.readers) return;
    if (previous) this.removeEntry(previous);
    const entry: CacheEntry<T> = {
      key: input.key,
      value: input.value,
      createdAt: now,
      expiresAt: now + freshForMs,
      lastAccessAt: now,
      readers: 0,
      bytes: this.estimateBytes(input.value, input.estimatedBytes),
    };
    this.cache.set(input.key, entry);
    this.retainedBytes += entry.bytes;
    this.peakRetainedEntries = Math.max(this.peakRetainedEntries, this.cache.size);
    this.enforceBounds();
  }

  invalidate(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    entry.expiresAt = 0;
    if (entry.readers === 0) this.removeEntry(entry);
  }

  snapshot() {
    this.cleanupExpired();
    return {
      retainedEntries: this.cache.size,
      retainedBytes: this.retainedBytes,
      inFlightOrigins: this.inFlight.size,
      activeLeases: this.activeLeases,
      peakRetainedEntries: this.peakRetainedEntries,
      originLoads: this.originLoads,
      cacheHits: this.cacheHits,
      coalescedRequests: this.coalescedRequests,
      upstreamCallsAvoided: this.cacheHits + this.coalescedRequests,
      loadFailures: this.loadFailures,
      evictions: this.evictions,
      activeConsumers: Object.fromEntries(this.activeConsumers.entries()),
    };
  }
}

const informationBroker = new CryptaraSharedInformationBroker();
let admissionInstalled = false;
let intelligenceActive = false;

/**
 * First arm: install the existing ordinary-lane admission governor. No new pool,
 * DB connection, interval, execution authority, or persistence authority is created.
 */
export async function installCryptaraSuperWorkerAdmission(): Promise<void> {
  const { installCryptaraSupabaseAdmissionWorker } = await import('./cryptara-supabase-admission-worker.js');
  installCryptaraSupabaseAdmissionWorker();
  admissionInstalled = true;
}

/**
 * Advisory arms: Antenna + QuantiComp + DB telemetry can accelerate only already-
 * healthy additive recovery. Cryptara remains the policy owner; proxy workers move data.
 */
export async function activateCryptaraSuperWorkerIntelligence(): Promise<void> {
  const { installCryptaraResourceIntelligenceAdvisor } = await import('./cryptara-resource-intelligence.js');
  installCryptaraResourceIntelligenceAdvisor();
  intelligenceActive = true;
}

export function requestCryptaraSharedInformation<T, R = T>(
  request: CryptaraSharedInformationRequest<T, R>,
): Promise<CryptaraInformationLease<R>> {
  return informationBroker.request(request);
}

export function primeCryptaraSharedInformation<T>(input: CryptaraSharedInformationPrime<T>): void {
  informationBroker.prime(input);
}

export function invalidateCryptaraSharedInformation(key: string): void {
  informationBroker.invalidate(key);
}

/** Numeric hot-state path: QuantiComp owns reusable SharedArrayBuffer generations. */
export function publishCryptaraSharedFloat64State(key: string, values: ArrayLike<number>) {
  return quantiDataFabric.publishFloat64State(`cryptara-super-worker:${key}`, values);
}

export function pinCryptaraSharedFloat64State(key: string) {
  return quantiDataFabric.pinFloat64State(`cryptara-super-worker:${key}`);
}

export function getCryptaraSuperWorkerSnapshot(): CryptaraSuperWorkerSnapshot {
  return {
    governor: 'cryptara',
    authority: 'resource_proxy_only',
    writeAuthority: false,
    executionAuthority: false,
    admissionInstalled,
    intelligenceActive,
    information: informationBroker.snapshot(),
    dataFabric: quantiDataFabric.getStatus(),
  };
}
