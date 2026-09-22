import { throwIfPantheonAborted } from './PantheonDeadline';
import type { PantheonTransport } from './PantheonCrawlerCapabilityMatrix';

// Categories execute in bounded parallel waves. Durable category persistence is
// still serialized by PantheonCategoryWorkflow, while the shared URL and
// transport governors below prevent parallel categories from multiplying load.
export const PANTHEON_CATEGORY_CONCURRENCY_LIMIT = 4;
export const PANTHEON_URL_CONCURRENCY_PER_CATEGORY = 8;
export const PANTHEON_GLOBAL_URL_CONCURRENCY_LIMIT = 8;

interface PantheonUrlWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let activePantheonUrlWork = 0;
const pantheonUrlWaiters: PantheonUrlWaiter[] = [];

const PANTHEON_TRANSPORT_CONCURRENCY_LIMITS: Readonly<Record<PantheonTransport, number>> = {
  'direct-http': 8,
  browser: 2,
  'search-provider': 3,
  'specialized-adapter': 3,
  archive: 2,
};

const activePantheonTransportWork = new Map<PantheonTransport, number>();
const pantheonTransportWaiters = new Map<PantheonTransport, PantheonUrlWaiter[]>();

function drainPantheonUrlWaiters(): void {
  while (activePantheonUrlWork < PANTHEON_GLOBAL_URL_CONCURRENCY_LIMIT && pantheonUrlWaiters.length > 0) {
    const waiter = pantheonUrlWaiters.shift()!;
    if (waiter.signal?.aborted) continue;
    if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
    activePantheonUrlWork += 1;
    waiter.resolve();
  }
}

async function acquirePantheonUrlSlot(signal?: AbortSignal): Promise<void> {
  throwIfPantheonAborted(signal);
  if (activePantheonUrlWork < PANTHEON_GLOBAL_URL_CONCURRENCY_LIMIT) {
    activePantheonUrlWork += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: PantheonUrlWaiter = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = pantheonUrlWaiters.indexOf(waiter);
      if (index >= 0) pantheonUrlWaiters.splice(index, 1);
      reject(new Error('Pantheon operation aborted'));
    };
    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    pantheonUrlWaiters.push(waiter);
  });
}

function releasePantheonUrlSlot(): void {
  activePantheonUrlWork = Math.max(0, activePantheonUrlWork - 1);
  drainPantheonUrlWaiters();
}

function drainPantheonTransportWaiters(transport: PantheonTransport): void {
  const waiters = pantheonTransportWaiters.get(transport) || [];
  const limit = PANTHEON_TRANSPORT_CONCURRENCY_LIMITS[transport];
  while ((activePantheonTransportWork.get(transport) || 0) < limit && waiters.length > 0) {
    const waiter = waiters.shift()!;
    if (waiter.signal?.aborted) continue;
    if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
    activePantheonTransportWork.set(transport, (activePantheonTransportWork.get(transport) || 0) + 1);
    waiter.resolve();
  }
}

async function acquirePantheonTransportSlot(transport: PantheonTransport, signal?: AbortSignal): Promise<void> {
  throwIfPantheonAborted(signal);
  const active = activePantheonTransportWork.get(transport) || 0;
  if (active < PANTHEON_TRANSPORT_CONCURRENCY_LIMITS[transport]) {
    activePantheonTransportWork.set(transport, active + 1);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiters = pantheonTransportWaiters.get(transport) || [];
    const waiter: PantheonUrlWaiter = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('Pantheon operation aborted'));
    };
    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    waiters.push(waiter);
    pantheonTransportWaiters.set(transport, waiters);
  });
}

function releasePantheonTransportSlot(transport: PantheonTransport): void {
  activePantheonTransportWork.set(transport, Math.max(0, (activePantheonTransportWork.get(transport) || 0) - 1));
  drainPantheonTransportWaiters(transport);
}

export async function runPantheonBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  completeAllItemsOnAbort = false,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Pantheon scheduler concurrency must be a positive integer');
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runner = async () => {
    while (true) {
      if (!completeAllItemsOnAbort) throwIfPantheonAborted(signal);
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => runner(),
  ));
  return results;
}

/**
 * Runs URL-scoped work with both a per-category bound and one process-wide
 * ceiling. Each worker still receives exactly one URL/work authorization.
 */
export async function runPantheonUrlBounded<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  return runPantheonBounded(
    items,
    PANTHEON_URL_CONCURRENCY_PER_CATEGORY,
    async (item, index) => {
      await acquirePantheonUrlSlot(signal);
      try {
        return await worker(item, index);
      } finally {
        releasePantheonUrlSlot();
      }
    },
    signal,
  );
}

/**
 * Adds a small worker pool per transport family. The global/per-category URL
 * ceilings remain authoritative; this prevents browser and specialized routes
 * from consuming more resources than their execution model safely supports.
 */
export async function runPantheonTransportBounded<R>(
  transport: PantheonTransport,
  worker: () => Promise<R>,
  signal?: AbortSignal,
): Promise<R> {
  await acquirePantheonTransportSlot(transport, signal);
  try {
    return await worker();
  } finally {
    releasePantheonTransportSlot(transport);
  }
}

export function getPantheonSchedulerActivity(): {
  activeUrlWork: number;
  queuedUrlWork: number;
  activeTransportWork: Partial<Record<PantheonTransport, number>>;
  queuedTransportWork: Partial<Record<PantheonTransport, number>>;
} {
  return {
    activeUrlWork: activePantheonUrlWork,
    queuedUrlWork: pantheonUrlWaiters.length,
    activeTransportWork: Object.fromEntries(activePantheonTransportWork) as Partial<Record<PantheonTransport, number>>,
    queuedTransportWork: Object.fromEntries(
      [...pantheonTransportWaiters].map(([transport, waiters]) => [transport, waiters.length]),
    ) as Partial<Record<PantheonTransport, number>>,
  };
}
