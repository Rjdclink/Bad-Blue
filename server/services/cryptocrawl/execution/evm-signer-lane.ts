import { isDatabaseConfigured } from '../../../db.js';
import { withDatabaseSessionAdvisoryLock } from '../runtime/database-coordination.js';

const localTails = new Map<string, Promise<void>>();

function normalizeWalletAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error('EVM signer lane requires a valid wallet address');
  return normalized;
}

function laneKey(chainId: number, walletAddress: string): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('EVM signer lane requires a positive chain id');
  return `cryptocrawl:evm-signer:${chainId}:${normalizeWalletAddress(walletAddress)}`;
}

async function withLocalLane<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = localTails.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  localTails.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (localTails.get(key) === current) localTails.delete(key);
  }
}

/**
 * One EVM account on one chain is one nonce-ordering domain. The canonical
 * coordination lane owns the bounded session advisory lock across nonce
 * observation, signing and physical submission. No durable nonce is reserved
 * before broadcast, so crash recovery cannot manufacture an artificial gap.
 */
export async function withEvmSignerLane<T>(input: {
  chainId: number;
  walletAddress: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const key = laneKey(input.chainId, input.walletAddress);
  return withLocalLane(key, async () => {
    if (!isDatabaseConfigured) return input.operation();
    try {
      return await withDatabaseSessionAdvisoryLock(
        key,
        async () => input.operation(),
        {
          acquireTimeoutMs: Math.max(250, Math.min(30_000, Number(process.env.CRYPTO_EVM_SIGNER_LOCK_TIMEOUT_MS || 6_000))),
        },
      );
    } catch (error) {
      throw new Error(`Distributed EVM signer lane failed closed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
