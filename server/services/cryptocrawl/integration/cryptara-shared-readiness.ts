import { requestCryptaraSharedInformation } from './cryptara-super-worker.js';

export type CryptaraReadinessProvider<T> = {
  validateLiveSignalReadiness(options?: { strictLive?: boolean }): Promise<T>;
};

/**
 * Shared live-readiness acquisition by proxy. Cryptara remains the intelligence
 * owner; the Super Worker only coalesces identical concurrent checks and retains
 * the result for a very short correctness-safe window.
 */
export async function getCryptaraSharedConnectorReadiness<T>(
  cryptara: CryptaraReadinessProvider<T>,
  options: { strictLive: boolean; consumer: string },
): Promise<T> {
  const strictLive = options.strictLive === true;
  const lease = await requestCryptaraSharedInformation<T>({
    key: `cryptara:connector-readiness:${strictLive ? 'strict' : 'relaxed'}`,
    consumer: options.consumer,
    informationClass: 'connector_readiness',
    // Strict live readiness is reused only across a very short burst. This is
    // enough to collapse duplicate checks without turning readiness into stale
    // execution evidence.
    freshForMs: strictLive ? 250 : 1_500,
    loader: () => cryptara.validateLiveSignalReadiness({ strictLive }),
    estimatedBytes: 2_048,
  });

  try {
    return lease.value;
  } finally {
    lease.release();
  }
}
