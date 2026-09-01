import {
  appendCryptaraParallelEvents,
  getCryptaraParallelProxySnapshot,
  isCryptaraParallelProxyConfigured,
  writeCryptaraParallelSnapshot,
  type CryptaraParallelArtifact,
  type CryptaraParallelProxyResult,
} from './cryptara-supabase-overflow-worker.js';
import { getCryptaraSuperWorkerSnapshot } from './cryptara-super-worker.js';

/**
 * HyperBridge joins the existing primary and overflow data planes without creating
 * a third database, pool, authority, or configuration surface.
 *
 * Read-side hot state remains owned by the existing Cryptara Super Worker. This
 * module is the latency-hiding write fabric for explicitly non-authoritative
 * derived snapshots/events: callers enqueue locally and never wait for remote
 * overflow I/O. The bridge then coalesces snapshot bursts, batches event bursts,
 * writes to the existing overflow project, and invokes a caller-supplied primary
 * low-priority fallback only when the auxiliary write is unavailable.
 *
 * Critical execution/governance/treasury/settlement truth is not accepted here.
 */

export type CryptaraHyperBridgePersistedTarget = 'overflow' | 'primary_fallback';

type PersistedCallback = (target: CryptaraHyperBridgePersistedTarget) => void;
type FailureCallback = (error: unknown) => void;
type PrimaryFallback = () => Promise<void>;

type QueueHooks = {
  fallback?: PrimaryFallback;
  onPersisted?: PersistedCallback;
  onFailure?: FailureCallback;
};

type SnapshotQueueEntry = QueueHooks & {
  artifact: CryptaraParallelArtifact;
};

type EventQueueEntry = QueueHooks & {
  artifact: CryptaraParallelArtifact;
};

const snapshotQueue = new Map<string, SnapshotQueueEntry>();
const eventGroups = new Map<string, Map<string, EventQueueEntry>>();
const SNAPSHOT_CONCURRENCY = 2;
const EVENT_BATCH_MAX = 32;

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

function identity(artifact: CryptaraParallelArtifact): string {
  return `${artifact.workload}\u0000${artifact.topic}\u0000${artifact.key}`;
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
