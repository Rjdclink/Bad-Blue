import { requestCryptaraSharedInformation } from './cryptara-super-worker.js';

export type CryptaraReadinessProvider<T> = {
  validateLiveSignalReadiness(options?: { strictLive?: boolean }): Promise<T>;
};

type OriginalReadiness<T> = (options?: { strictLive?: boolean }) => Promise<T>;
const ORIGINAL_READINESS = Symbol.for('badblue.cryptara.super-worker.original-readiness');
const PATCHED_READINESS = Symbol.for('badblue.cryptara.super-worker.patched-readiness');

async function acquireSharedReadiness<T>(
  original: OriginalReadiness<T>,
  strictLive: boolean,
  consumer: string,
): Promise<T> {
  const lease = await requestCryptaraSharedInformation<T>({
    key: `cryptara:connector-readiness:${strictLive ? 'strict' : 'relaxed'}`,
    consumer,
    informationClass: 'connector_readiness',
    // Strict live readiness is reused only across a very short burst. This is
    // enough to collapse duplicate checks without turning readiness into stale
    // execution evidence.
    freshForMs: strictLive ? 250 : 1_500,
    loader: () => original({ strictLive }),
    estimatedBytes: 2_048,
  });

  try {
    return lease.value;
  } finally {
    lease.release();
  }
}

/**
 * Install an idempotent proxy on the Cryptara instance. Existing callers keep the
 * same method/API, but identical readiness requests now single-flight through the
 * Super Worker. The original Cryptara implementation remains the only origin.
 */
export function installCryptaraSharedConnectorReadinessProxy<T>(
  cryptara: CryptaraReadinessProvider<T>,
): void {
  const target = cryptara as CryptaraReadinessProvider<T> & Record<PropertyKey, unknown>;
  if (target[PATCHED_READINESS] === true) return;

  const original = cryptara.validateLiveSignalReadiness.bind(cryptara) as OriginalReadiness<T>;
  Object.defineProperty(target, ORIGINAL_READINESS, {
    value: original,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  target.validateLiveSignalReadiness = (options?: { strictLive?: boolean }) =>
    acquireSharedReadiness(original, options?.strictLive === true, 'cryptara-readiness-proxy');
  Object.defineProperty(target, PATCHED_READINESS, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** Explicit consumer helper; also ensures older callers are covered by the proxy. */
export async function getCryptaraSharedConnectorReadiness<T>(
  cryptara: CryptaraReadinessProvider<T>,
  options: { strictLive: boolean; consumer: string },
): Promise<T> {
  installCryptaraSharedConnectorReadinessProxy(cryptara);
  const target = cryptara as CryptaraReadinessProvider<T> & Record<PropertyKey, unknown>;
  const original = target[ORIGINAL_READINESS] as OriginalReadiness<T> | undefined;
  if (!original) return cryptara.validateLiveSignalReadiness({ strictLive: options.strictLive });
  return acquireSharedReadiness(original, options.strictLive === true, options.consumer);
}
