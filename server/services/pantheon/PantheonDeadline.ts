export interface PantheonDeadline {
  signal: AbortSignal;
  dispose(): void;
}

function deadlineError(label: string): Error {
  const error = new Error(label);
  error.name = 'AbortError';
  return error;
}

export function throwIfPantheonAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw deadlineError(String(signal.reason || 'Pantheon operation aborted'));
}

export function createPantheonDeadline(deadlineAt: number, parent?: AbortSignal): PantheonDeadline {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason || deadlineError('Pantheon parent operation aborted'));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });

  const delayMs = Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(
    () => controller.abort(deadlineError('Pantheon request deadline exceeded')),
    delayMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

export async function racePantheonAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfPantheonAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : deadlineError('Pantheon operation aborted'),
    );
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function pantheonAbortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfPantheonAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : deadlineError('Pantheon delay aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
