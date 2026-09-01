import {
  appendCryptaraParallelEvents,
  getCryptaraParallelProxySnapshot,
  isCryptaraParallelProxyConfigured,
  writeCryptaraParallelSnapshot,
  type CryptaraParallelArtifact,
  type CryptaraParallelProxyResult,
  type CryptaraParallelProxyWorkload,
} from './cryptara-supabase-overflow-worker.js';
import {
  getCryptaraSupabaseCompSwitchSnapshot,
  type CryptaraSupabaseCompSwitchSnapshot,
} from './cryptara-supabase-comp-switch.js';
import { getCryptaraSuperWorkerSnapshot } from './cryptara-super-worker.js';

/**
 * HyperBridge joins the existing primary and overflow data planes without creating
 * a third database, pool, authority, or configuration surface.
 *
 * Read-side hot state remains owned by the existing Cryptara Super Worker. This
 * module adds two latency controls around the already-authorized data planes:
 *   1) a local read router that uses known-fresh overflow replicas without a new
 *      intermediary hop and races both existing lanes only while freshness is
 *      unknown under pressure/overflow-preferred auxiliary reads;
 *   2) a latency-hiding write fabric for explicitly non-authoritative derived
 *      snapshots/events. Callers enqueue locally and never wait for remote overflow
 *      I/O. The bridge coalesces snapshot bursts, batches event bursts, writes to
 *      the existing overflow project, and invokes a caller-supplied primary
 *      low-priority fallback only when the auxiliary write is unavailable.
 *
 * Critical execution/governance/treasury/settlement truth is not accepted here.
 */

export type CryptaraHyperBridgePersistedTarget = 'overflow' | 'primary_fallback';
export type CryptaraHyperBridgeReadLane = 'primary' | 'overflow' | 'none';
export type CryptaraHyperBridgeReadPreference = 'primary' | 'overflow';

type PersistedCallback = (target: CryptaraHyperBridgePersistedTarget) => void;
type FailureCallback = (error: unknown) => void;
type PrimaryFallback = () => Promise<void>;

type QueueHooks = {
  fallback?: PrimaryFallback;
  onPersisted?: PersistedCallback;
  onFailure?: FailureCallback;
  /** Process-local read-routing confidence only; does not alter persisted TTL. */
  replicaFreshForMs?: number;
};

type SnapshotQueueEntry = QueueHooks & {
  artifact: CryptaraParallelArtifact;
};

type EventQueueEntry = QueueHooks & {
  artifact: CryptaraParallelArtifact;
};

export interface CryptaraHyperBridgeReadInput<T> {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
  primary: () => Promise<T | null>;
  overflow: () => Promise<T | null>;
  isUsable?: (value: T | null) => boolean;
  /** Auxiliary datasets may prefer overflow even while the primary is healthy. */
  normalPreference?: CryptaraHyperBridgeReadPreference;
}

export interface CryptaraHyperBridgeReadResult<T> {
  value: T | null;
  lane: CryptaraHyperBridgeReadLane;
  raced: boolean;
  dataPath: CryptaraSupabaseCompSwitchSnapshot['path'];
}

type LaneResult<T> = {
  lane: Exclude<CryptaraHyperBridgeReadLane, 'none'>;
  value: T | null;
  ok: boolean;
  latencyMs: number;
};

type LaneTelemetry = {
  attempts: number;
  wins: number;
  failures: number;
  ewmaLatencyMs: number;
};

const snapshotQueue = new Map<string, SnapshotQueueEntry>();
const eventGroups = new Map<string, Map<string, EventQueueEntry>>();
const replicaFreshUntil = new Map<string, number>();
const ALLOWED_READ_WORKLOADS = new Set<CryptaraParallelProxyWorkload>([
  'cache',
  'analytics',
  'telemetry',
  'observability',
  'background_learning',
]);
const SNAPSHOT_CONCURRENCY = 2;
const EVENT_BATCH_MAX = 32;
const MAX_FRESH_KEYS = 2_048;
const MAX_LOCAL_REPLICA_FRESH_MS = 15 * 60_000;
const EWMA_ALPHA = 0.20;

const laneTelemetry: Record<'primary' | 'overflow', LaneTelemetry> = {
  primary: { attempts: 0, wins: 0, failures: 0, ewmaLatencyMs: 0 },
  overflow: { attempts: 0, wins: 0, failures: 0, ewmaLatencyMs: 0 },
};

let flushScheduled = false;
let flushInFlight: Promise<void> | null = null;
let enqueuedSnapshots = 0;
let enqueuedEvents = 0;
let coalescedSnapshots = 0;
let coalescedEvents = 0;
let flushPasses = 0;
let overflowSnapshotWrites = 0;
let overflowEventRows = 0;
let primaryFallbackWrites = 0;
let failedWrites = 0;
let peakQueued = 0;
let lastFlushAt = 0;
let lastFailure: string | null = null;
let routedReads = 0;
let racedReads = 0;
let knownFreshOverflowReads = 0;
let overflowFallbackReads = 0;
let readMisses = 0;

function dataIdentity(workload: CryptaraParallelProxyWorkload, topic: string, key: string): string {
  return `${workload}\u0000${topic}\u0000${key}`;
}

function identity(artifact: CryptaraParallelArtifact): string {
  return dataIdentity(artifact.workload, artifact.topic, artifact.key);
}

function groupIdentity(artifact: CryptaraParallelArtifact): string {
  return `${artifact.workload}\u0000${artifact.topic}`;
}

function queuedCount(): number {
  let events = 0;
  for (const group of eventGroups.values()) events += group.size;
  return snapshotQueue.size + events;
}

function observeQueueDepth(): void {
  peakQueued = Math.max(peakQueued, queuedCount());
}

function updateEwma(current: number, sample: number): number {
  if (!Number.isFinite(sample) || sample < 0) return current;
  if (current <= 0) return sample;
  return current * (1 - EWMA_ALPHA) + sample * EWMA_ALPHA;
}

function cleanFreshDirectory(now = Date.now()): void {
  for (const [key, expiresAt] of replicaFreshUntil.entries()) {
    if (expiresAt <= now) replicaFreshUntil.delete(key);
  }
}

function enforceFreshDirectoryBound(): void {
  cleanFreshDirectory();
  while (replicaFreshUntil.size > MAX_FRESH_KEYS) {
    const oldestKey = replicaFreshUntil.keys().next().value as string | undefined;
    if (!oldestKey) break;
    replicaFreshUntil.delete(oldestKey);
  }
}

function readIdentity<T>(input: CryptaraHyperBridgeReadInput<T>): string {
  return dataIdentity(input.workload, input.topic.trim(), input.key.trim());
}

function readUsable<T>(input: CryptaraHyperBridgeReadInput<T>, value: T | null): boolean {
  return input.isUsable ? input.isUsable(value) : value !== null;
}

async function runReadLane<T>(
  lane: 'primary' | 'overflow',
  operation: () => Promise<T | null>,
): Promise<LaneResult<T>> {
  const telemetry = laneTelemetry[lane];
  telemetry.attempts += 1;
  const startedAt = Date.now();
  try {
    const value = await operation();
    const latencyMs = Math.max(0, Date.now() - startedAt);
    telemetry.ewmaLatencyMs = updateEwma(telemetry.ewmaLatencyMs, latencyMs);
    return { lane, value, ok: true, latencyMs };
  } catch {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    telemetry.failures += 1;
    telemetry.ewmaLatencyMs = updateEwma(telemetry.ewmaLatencyMs, latencyMs);
    return { lane, value: null, ok: false, latencyMs };
  }
}

function readWin<T>(
  input: CryptaraHyperBridgeReadInput<T>,
  result: LaneResult<T>,
  raced: boolean,
  dataPath: CryptaraSupabaseCompSwitchSnapshot['path'],
): CryptaraHyperBridgeReadResult<T> | null {
  if (!result.ok || !readUsable(input, result.value)) return null;
  laneTelemetry[result.lane].wins += 1;
  return { value: result.value, lane: result.lane, raced, dataPath };
}

/**
 * Record that the exact overflow key was successfully persisted/read and remains
 * semantically reusable until expiresAt. This directory is local only and bounded;
 * it never becomes durable truth or an execution authority.
 */
export function noteCryptaraHyperBridgeReplicaFresh(input: {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
  expiresAt: number;
}): void {
  const key = input.key.trim();
  const topic = input.topic.trim();
  const expiresAt = Number(input.expiresAt);
  if (!key || !topic || !ALLOWED_READ_WORKLOADS.has(input.workload)) return;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  const id = dataIdentity(input.workload, topic, key);
  replicaFreshUntil.delete(id);
  replicaFreshUntil.set(id, expiresAt);
  enforceFreshDirectoryBound();
}

export function invalidateCryptaraHyperBridgeReplica(input: {
  key: string;
  workload: CryptaraParallelProxyWorkload;
  topic: string;
}): void {
  replicaFreshUntil.delete(dataIdentity(input.workload, input.topic.trim(), input.key.trim()));
}

function notePersistedSnapshotFresh(entry: SnapshotQueueEntry): void {
  const persistedExpiry = Number(entry.artifact.expiresAt);
  if (Number.isFinite(persistedExpiry) && persistedExpiry > Date.now()) {
    noteCryptaraHyperBridgeReplicaFresh({
      key: entry.artifact.key,
      workload: entry.artifact.workload,
      topic: entry.artifact.topic,
      expiresAt: persistedExpiry,
    });
    return;
  }
  const requestedFreshMs = Number(entry.replicaFreshForMs);
  if (!Number.isFinite(requestedFreshMs) || requestedFreshMs <= 0) return;
  const boundedFreshMs = Math.min(MAX_LOCAL_REPLICA_FRESH_MS, Math.max(1, Math.floor(requestedFreshMs)));
  noteCryptaraHyperBridgeReplicaFresh({
    key: entry.artifact.key,
    workload: entry.artifact.workload,
    topic: entry.artifact.topic,
    expiresAt: Date.now() + boundedFreshMs,
  });
}

/**
 * Read-side routing has no intermediary service and creates no connection pool.
 *
 * - normal + primary preference: primary exactly as before, overflow only fallback;
 * - comp or overflow-preferred + known-fresh replica: overflow directly;
 * - comp or overflow-preferred + unknown freshness: both existing lanes start in
 *   parallel and the first usable result wins, preventing a serial overflow miss
 *   from being placed in front of primary latency.
 */
export async function readCryptaraHyperBridge<T>(
  input: CryptaraHyperBridgeReadInput<T>,
): Promise<CryptaraHyperBridgeReadResult<T>> {
  const key = input.key.trim();
  const topic = input.topic.trim();
  if (!key) throw new Error('CRYPTARA_HYPER_BRIDGE_KEY_REQUIRED');
  if (!topic) throw new Error('CRYPTARA_HYPER_BRIDGE_TOPIC_REQUIRED');
  if (!ALLOWED_READ_WORKLOADS.has(input.workload)) throw new Error('CRYPTARA_HYPER_BRIDGE_WORKLOAD_NOT_ALLOWED');

  routedReads += 1;
  cleanFreshDirectory();
  const dataPath = getCryptaraSupabaseCompSwitchSnapshot().path;
  const overflowPreferred = dataPath === 'comp' || input.normalPreference === 'overflow';
  const overflowAvailable = isCryptaraParallelProxyConfigured;
  const id = readIdentity(input);
  const knownFresh = overflowAvailable && (replicaFreshUntil.get(id) || 0) > Date.now();

  if (overflowPreferred && knownFresh) {
    knownFreshOverflowReads += 1;
    const overflow = await runReadLane('overflow', input.overflow);
    const overflowWin = readWin(input, overflow, false, dataPath);
    if (overflowWin) return overflowWin;

    replicaFreshUntil.delete(id);
    overflowFallbackReads += 1;
    const primary = await runReadLane('primary', input.primary);
    const primaryWin = readWin(input, primary, false, dataPath);
    if (primaryWin) return primaryWin;
    readMisses += 1;
    return { value: null, lane: 'none', raced: false, dataPath };
  }

  if (overflowPreferred && overflowAvailable) {
    racedReads += 1;
    const primaryPromise = runReadLane('primary', input.primary);
    const overflowPromise = runReadLane('overflow', input.overflow);
    const first = await Promise.race([primaryPromise, overflowPromise]);
    const firstWin = readWin(input, first, true, dataPath);
    if (firstWin) return firstWin;

    const second = await (first.lane === 'primary' ? overflowPromise : primaryPromise);
    const secondWin = readWin(input, second, true, dataPath);
    if (secondWin) return secondWin;
    readMisses += 1;
    return { value: null, lane: 'none', raced: true, dataPath };
  }

  const primary = await runReadLane('primary', input.primary);
  const primaryWin = readWin(input, primary, false, dataPath);
  if (primaryWin) return primaryWin;

  if (overflowAvailable) {
    overflowFallbackReads += 1;
    const overflow = await runReadLane('overflow', input.overflow);
    const overflowWin = readWin(input, overflow, false, dataPath);
    if (overflowWin) return overflowWin;
  }

  readMisses += 1;
  return { value: null, lane: 'none', raced: false, dataPath };
}

function scheduleFlush(): void {
  if (flushScheduled || flushInFlight) return;
  flushScheduled = true;
  // Microtask scheduling hides all remote I/O from the publishing call while also
  // allowing same-turn duplicate snapshots/events to collapse before PostgreSQL.
  queueMicrotask(() => {
    flushScheduled = false;
    void flushCryptaraHyperBridge();
  });
}

async function persistFallback(entry: QueueHooks): Promise<boolean> {
  if (!entry.fallback) return false;
  await entry.fallback();
  primaryFallbackWrites += 1;
  entry.onPersisted?.('primary_fallback');
  return true;
}

function recordFailure(error: unknown, entry: QueueHooks): void {
  failedWrites += 1;
  lastFailure = error instanceof Error ? error.message : String(error);
  entry.onFailure?.(error);
}

async function persistSnapshot(entry: SnapshotQueueEntry): Promise<void> {
  try {
    let result: CryptaraParallelProxyResult<boolean> = { used: false, reason: 'not_configured' };
    if (isCryptaraParallelProxyConfigured) {
      result = await writeCryptaraParallelSnapshot(entry.artifact);
    }
    if (result.used) {
      overflowSnapshotWrites += 1;
      notePersistedSnapshotFresh(entry);
      entry.onPersisted?.('overflow');
      return;
    }
    if (await persistFallback(entry)) return;
    recordFailure(new Error(`HYPER_BRIDGE_SNAPSHOT_UNPERSISTED:${result.reason}`), entry);
  } catch (error) {
    try {
      if (await persistFallback(entry)) return;
    } catch (fallbackError) {
      recordFailure(fallbackError, entry);
      return;
    }
    recordFailure(error, entry);
  }
}

async function persistEventBatch(entries: EventQueueEntry[]): Promise<void> {
  if (entries.length === 0) return;
  let result: CryptaraParallelProxyResult<number> = { used: false, reason: 'not_configured' };
  try {
    if (isCryptaraParallelProxyConfigured) {
      result = await appendCryptaraParallelEvents(entries.map(entry => entry.artifact));
    }
    if (result.used) {
      // Event keys are idempotent. ON CONFLICT DO NOTHING means an already-present
      // event is also durable success even when rowCount is below the batch width.
      overflowEventRows += Math.max(0, Number(result.value || 0));
      for (const entry of entries) entry.onPersisted?.('overflow');
      return;
    }
  } catch (error) {
    result = { used: false, reason: 'operation_failed' };
    lastFailure = error instanceof Error ? error.message : String(error);
  }

  // Fallback is deliberately sequential. If the auxiliary project is unavailable,
  // derived writes must not create a burst against the already-scarce primary DB.
  for (const entry of entries) {
    try {
      if (await persistFallback(entry)) continue;
      recordFailure(new Error(`HYPER_BRIDGE_EVENT_UNPERSISTED:${result.reason}`), entry);
    } catch (error) {
      recordFailure(error, entry);
    }
  }
}

function takeSnapshotBatch(): SnapshotQueueEntry[] {
  const batch: SnapshotQueueEntry[] = [];
  for (const [key, entry] of snapshotQueue) {
    snapshotQueue.delete(key);
    batch.push(entry);
    if (batch.length >= SNAPSHOT_CONCURRENCY) break;
  }
  return batch;
}

function takeEventBatch(): EventQueueEntry[] {
  const first = eventGroups.entries().next();
  if (first.done) return [];
  const [groupKey, group] = first.value;
  const batch: EventQueueEntry[] = [];
  for (const [key, entry] of group) {
    group.delete(key);
    batch.push(entry);
    if (batch.length >= EVENT_BATCH_MAX) break;
  }
  if (group.size === 0) eventGroups.delete(groupKey);
  return batch;
}

/**
 * Enqueue a latest-value read-model snapshot. Duplicate keys collapse to the most
 * recent observation before any network work begins.
 */
export function enqueueCryptaraHyperBridgeSnapshot<T>(input: {
  artifact: CryptaraParallelArtifact<T>;
  fallback?: PrimaryFallback;
  onPersisted?: PersistedCallback;
  onFailure?: FailureCallback;
  replicaFreshForMs?: number;
}): void {
  const key = identity(input.artifact);
  if (snapshotQueue.has(key)) coalescedSnapshots += 1;
  snapshotQueue.set(key, input as SnapshotQueueEntry);
  enqueuedSnapshots += 1;
  observeQueueDepth();
  scheduleFlush();
}

/**
 * Enqueue immutable derived history. Duplicate event keys collapse safely because
 * both overflow and primary fallback stores are idempotent by event identity.
 */
export function enqueueCryptaraHyperBridgeEvent<T>(input: {
  artifact: CryptaraParallelArtifact<T>;
  fallback?: PrimaryFallback;
  onPersisted?: PersistedCallback;
  onFailure?: FailureCallback;
  replicaFreshForMs?: number;
}): void {
  const groupKey = groupIdentity(input.artifact);
  let group = eventGroups.get(groupKey);
  if (!group) {
    group = new Map<string, EventQueueEntry>();
    eventGroups.set(groupKey, group);
  }
  const key = identity(input.artifact);
  if (group.has(key)) coalescedEvents += 1;
  group.set(key, input as EventQueueEntry);
  enqueuedEvents += 1;
  observeQueueDepth();
  scheduleFlush();
}

/**
 * One bounded pass. It never polls. If more work remains, another microtask is
 * scheduled, preserving event-loop fairness and same-turn coalescing.
 */
export function flushCryptaraHyperBridge(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    flushPasses += 1;
    const snapshots = takeSnapshotBatch();
    const events = takeEventBatch();
    await Promise.all(snapshots.map(entry => persistSnapshot(entry)));
    await persistEventBatch(events);
    lastFlushAt = Date.now();
  })().finally(() => {
    flushInFlight = null;
    if (queuedCount() > 0) scheduleFlush();
  });
  return flushInFlight;
}

export function getCryptaraHyperBridgeSnapshot() {
  const superWorker = getCryptaraSuperWorkerSnapshot();
  const overflow = getCryptaraParallelProxySnapshot();
  let queuedEvents = 0;
  for (const group of eventGroups.values()) queuedEvents += group.size;
  cleanFreshDirectory();
  return {
    role: 'supabase_hyper_bridge' as const,
    baseOfOperations: 'cryptara_local_shared_information_fabric' as const,
    routing: 'local_first_async_auxiliary_with_primary_fallback' as const,
    authority: 'auxiliary_transport_only' as const,
    writeAuthority: false as const,
    executionAuthority: false as const,
    financialAuthorityAllowed: false as const,
    governanceAuthorityAllowed: false as const,
    criticalDataAllowed: false as const,
    callerWaitsForRemoteIo: false as const,
    createsDatabasePool: false as const,
    createsConfigurationAliases: false as const,
    overflowConfigured: isCryptaraParallelProxyConfigured,
    overflowCooldownMs: overflow.cooldownMs,
    localReadPlane: {
      retainedEntries: superWorker.information.retainedEntries,
      inFlightOrigins: superWorker.information.inFlightOrigins,
      activeLeases: superWorker.information.activeLeases,
      upstreamCallsAvoided: superWorker.information.upstreamCallsAvoided,
    },
    routedReadPlane: {
      dataPath: getCryptaraSupabaseCompSwitchSnapshot().path,
      knownFreshReplicaKeys: replicaFreshUntil.size,
      routedReads,
      racedReads,
      knownFreshOverflowReads,
      overflowFallbackReads,
      readMisses,
      primary: {
        ...laneTelemetry.primary,
        ewmaLatencyMs: Number(laneTelemetry.primary.ewmaLatencyMs.toFixed(2)),
      },
      overflow: {
        ...laneTelemetry.overflow,
        ewmaLatencyMs: Number(laneTelemetry.overflow.ewmaLatencyMs.toFixed(2)),
      },
    },
    queue: {
      snapshots: snapshotQueue.size,
      events: queuedEvents,
      flushInFlight: flushInFlight !== null,
      peakQueued,
    },
    telemetry: {
      enqueuedSnapshots,
      enqueuedEvents,
      coalescedSnapshots,
      coalescedEvents,
      flushPasses,
      overflowSnapshotWrites,
      overflowEventRows,
      primaryFallbackWrites,
      failedWrites,
      lastFlushAt,
      lastFailure,
    },
  };
}