import { throwIfPantheonAborted } from './PantheonDeadline';

export const PANTHEON_CATEGORY_CONCURRENCY_LIMIT = 4;
export const PANTHEON_URL_CONCURRENCY_PER_CATEGORY = 2;
export const PANTHEON_GLOBAL_URL_CONCURRENCY_LIMIT = 8;

interface PantheonUrlWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let activePantheonUrlWork = 0;
const pantheonUrlWaiters: PantheonUrlWaiter[] = [];

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

export function getPantheonSchedulerActivity(): { activeUrlWork: number; queuedUrlWork: number } {
  return {
    activeUrlWork: activePantheonUrlWork,
    queuedUrlWork: pantheonUrlWaiters.length,
  };
}
