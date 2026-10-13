import { AsyncLocalStorage } from 'node:async_hooks';
import { setMaxListeners } from 'node:events';

// A deadline must stop follow-up work, not merely stop the caller waiting. This
// scope follows async continuations through the discovery/provider call tree.
const workContext = new AsyncLocalStorage<{ signal: AbortSignal; label: string }>();

export function assertDiscoveryWorkActive(): void {
  workContext.getStore()?.signal.throwIfAborted();
}

export function discoveryAbortSignal(): AbortSignal | undefined {
  return workContext.getStore()?.signal;
}

/** Explicitly owned long-lived feeds use the lifecycle signal, not a quote's deadline. */
export function withDiscoverySignal<T>(signal: AbortSignal, work: () => T): T {
  return workContext.run({ signal, label: 'discovery feed' }, work);
}

export function awaitDiscoveryWork<T>(work: () => Promise<T>): Promise<T> {
  const scope = workContext.getStore();
  if (!scope) return work();
  scope.signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(scope.signal.reason);
    scope.signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      scope.signal.throwIfAborted();
      return work();
    }).then(value => {
      scope.signal.removeEventListener('abort', aborted);
      if (scope.signal.aborted) reject(scope.signal.reason);
      else resolve(value);
    }, error => {
      scope.signal.removeEventListener('abort', aborted);
      reject(error);
    });
  });
}

export async function runDiscoveryWork<T>(
  label: string,
  timeoutMs: number,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const parents = [discoveryAbortSignal(), signal].filter((value): value is AbortSignal => !!value);
  const abort = () => controller.abort(new Error(`${label} cancelled`));
  for (const parent of parents) {
    if (parent.aborted) abort();
    else parent.addEventListener('abort', abort, { once: true });
  }
  // Route batches legitimately share one cancellation signal.
  setMaxListeners(0, controller.signal);
  const timer = setTimeout(() => controller.abort(new Error(`${label} deadline exceeded after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  try {
    return await workContext.run({ signal: controller.signal, label }, () => awaitDiscoveryWork(work));
  } finally {
    clearTimeout(timer);
    for (const parent of parents) parent.removeEventListener('abort', abort);
    controller.abort(new Error(`${label} completed`));
  }
}

// ethers v5 does not accept AbortSignal on provider calls. Already-issued HTTP
// requests use the transport timeout; guard continuations and every subsequent
// provider call, including calls made by contracts through this provider.
export function discoveryProvider<T extends object>(provider: T): T {
  return new Proxy(provider, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!/^(get|call$|estimateGas$|send$|sendTransaction$|resolveName$|waitForTransaction$)/.test(String(property))) {
        return value.bind(target);
      }
      return (...args: unknown[]) => awaitDiscoveryWork(() => value.apply(target, args));
    },
  });
}
