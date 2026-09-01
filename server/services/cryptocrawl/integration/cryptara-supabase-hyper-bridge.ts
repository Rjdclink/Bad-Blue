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
import {
  getCryptaraOverflowSuperWorkerSnapshot,
  requestCryptaraOverflowSuperWorker,
  shareCryptaraOverflowInformationWithPrimaryWorker,
} from './cryptara-overflow-super-worker.js';
import { runThroughCryptaraOverflowPrimaryGateway } from './cryptara-overflow-primary-gateway.js';

/**
 * HyperBridge is the application-facing information fabric for overflow mode.
 *
 * Every bridge read follows one path:
 * application -> shared worker coherence -> overflow Supabase -> (only on a real
 * miss) authoritative primary through the overflow-primary gateway.
 *
 * There is no application -> primary branch, no speculative primary hedge, and no
 * primary health/recovery polling. The overflow Super Worker single-flights each
 * key, so simultaneous consumers share one upstream acquisition. Primary remains
 * authoritative; bridge/overflow/workers own transport, reuse and deduplication.
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
  /** Authoritative upstream loader. HyperBridge never invokes this directly. */
  primary: () => Promise<T | null>;
  overflow: () => Promise<T | null>;
  isUsable?: (value: T | null) => boolean;
  /** Kept for compatibility; overflow remains the application-facing lane. */
  normalPreference?: CryptaraHyperBridgeReadPreference;
  /** Maximum local worker-to-worker reuse window for this derived value. */
  sharedFreshForMs?: number;
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
const DEFAULT_SHARED_FRESH_MS = 250;
const MAX_SHARED_FRESH_MS = 5_000;
const EWMA_ALPHA = 0.20;

const laneTelemetry: Record<'primary' | 'overflow', LaneTelemetry> = {
  // Direct bridge-to-primary is structurally disabled; retained for snapshot API compatibility.
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
let primarySuppressedReads = 0;
let workerSharedReads = 0;

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

function sharedFreshMs<T>(input: CryptaraHyperBridgeReadInput<T>, id: string): number {
  const configured = Number(input.sharedFreshForMs);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(MAX_SHARED_FRESH_MS, Math.trunc(configured)));
  }
  const knownUntil = replicaFreshUntil.get(id) || 0;
  const remaining = knownUntil - Date.now();
  if (remaining > 0) return Math.max(1, Math.min(MAX_SHARED_FRESH_MS, Math.trunc(remaining)));
  return DEFAULT_SHARED_FRESH_MS;
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

async function runOverflowWorkerLane<T>(
  input: CryptaraHyperBridgeReadInput<T>,
  freshForMs: number,
): Promise<LaneResult<T>> {
  const before = getCryptaraOverflowSuperWorkerSnapshot();
  const result = await runReadLane('overflow', () => requestCryptaraOverflowSuperWorker({
    key: input.key,
    workload: input.workload,
    topic: input.topic,
    loadOverflow: input.overflow,
    loadPrimaryUpstream: input.primary,
    isUsable: input.isUsable,
    freshForMs,
  }));
  const after = getCryptaraOverflowSuperWorkerSnapshot();
  if (after.localSharedHits > before.localSharedHits) workerSharedReads += 1;
  if (after.primaryUpstreamLoads > before.primaryUpstreamLoads) {
    overflowFallbackReads += after.primaryUpstreamLoads - before.primaryUpstreamLoads;
  }
  return result;
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
  let freshForMs = Number(entry.replicaFreshForMs);
  if (Number.isFinite(persistedExpiry) && persistedExpiry > Date.now()) {
    noteCryptaraHyperBridgeReplicaFresh({
      key: entry.artifact.key,
      workload: entry.artifact.workload,
      topic: entry.artifact.topic,
      expiresAt: persistedExpiry,
    });
    freshForMs = Math.min(MAX_SHARED_FRESH_MS, Math.max(1, persistedExpiry - Date.now()));
  } else if (Number.isFinite(freshForMs) && freshForMs > 0) {
    const boundedFreshMs = Math.min(MAX_LOCAL_REPLICA_FRESH_MS, Math.max(1, Math.floor(freshForMs)));
    noteCryptaraHyperBridgeReplicaFresh({
      key: entry.artifact.key,
      workload: entry.artifact.workload,
      topic: entry.artifact.topic,
      expiresAt: Date.now() + boundedFreshMs,
    });
  } else {
    freshForMs = DEFAULT_SHARED_FRESH_MS;
  }

  shareCryptaraOverflowInformationWithPrimaryWorker({
    key: entry.artifact.key,
    workload: entry.artifact.workload,
    topic: entry.artifact.topic,
    value: entry.artifact.payload,
    freshForMs,
  });
}

/**
 * Every read enters the overflow worker. That worker checks shared coherence and
 * overflow first, then performs at most one single-flight primary upstream load on
 * a real miss. No direct bridge-to-primary lane exists in either normal or comp.
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
  primarySuppressedReads += 1;
  cleanFreshDirectory();
  const dataPath = getCryptaraSupabaseCompSwitchSnapshot().path;
  const id = readIdentity(input);
  const knownFresh = (replicaFreshUntil.get(id) || 0) > Date.now();
  const freshForMs = sharedFreshMs(input, id);
  if (knownFresh) knownFreshOverflowReads += 1;

  const overflow = await runOverflowWorkerLane(input, freshForMs);
  const overflowWin = readWin(input, overflow, false, dataPath);
  if (overflowWin) return overflowWin;

  readMisses += 1;
  return { value: null, lane: 'none', raced: false, dataPath };
}

function scheduleFlush(): void {
  if (flushScheduled || flushInFlight) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushCryptaraHyperBridge();
  });
}

async function persistFallback(entry: QueueHooks): Promise<boolean> {
  if (!entry.fallback) return false;
  await runThroughCryptaraOverflowPrimaryGateway(
    'hyper_bridge_primary_write_fallback',
    entry.fallback,
  );
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
      overflowEventRows += Math.max(0, Number(result.value || 0));
      for (const entry of entries) entry.onPersisted?.('overflow');
      return;
    }
  } catch (error) {
    result = { used: false, reason: 'operation_failed' };
    lastFailure = error instanceof Error ? error.message : String(error);
  }

  // Fallback is deliberately sequential and still enters primary only through the
  // overflow-primary gateway, so an auxiliary failure cannot create direct DB work.
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

/** One bounded pass, no polling. */
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
  const overflowSuperWorker = getCryptaraOverflowSuperWorkerSnapshot();
  let queuedEvents = 0;
  for (const group of eventGroups.values()) queuedEvents += group.size;
  cleanFreshDirectory();
  return {
    role: 'supabase_hyper_bridge' as const,
    baseOfOperations: 'cryptara_local_shared_information_fabric' as const,
    routing: 'application_to_shared_worker_to_overflow_then_primary_gateway_on_miss' as const,
    authority: 'auxiliary_transport_only' as const,
    writeAuthority: false as const,
    executionAuthority: false as const,
    financialAuthorityAllowed: false as const,
    governanceAuthorityAllowed: false as const,
    criticalDataAllowed: false as const,
    callerWaitsForRemoteIo: false as const,
    createsDatabasePool: false as const,
    createsConfigurationAliases: false as const,
    directPrimaryReadLane: false as const,
    overflowConfigured: isCryptaraParallelProxyConfigured,
    overflowCooldownMs: overflow.cooldownMs,
    localReadPlane: {
      retainedEntries: superWorker.information.retainedEntries,
      inFlightOrigins: superWorker.information.inFlightOrigins,
      activeLeases: superWorker.information.activeLeases,
      upstreamCallsAvoided: superWorker.information.upstreamCallsAvoided,
    },
    workerCoherence: overflowSuperWorker,
    routedReadPlane: {
      dataPath: getCryptaraSupabaseCompSwitchSnapshot().path,
      knownFreshReplicaKeys: replicaFreshUntil.size,
      routedReads,
      racedReads,
      primarySuppressedReads,
      workerSharedReads,
      knownFreshOverflowReads,
      overflowFallbackReads,
      readMisses,
      primary: {
        ...laneTelemetry.primary,
        direct: false as const,
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
