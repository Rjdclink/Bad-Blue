import { coordinationPool, isDatabaseConfigured } from '../../../db.js';

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
 * One EVM account on one chain is one nonce-ordering domain. Hold a PostgreSQL
 * session advisory lock across nonce observation, signing and network submission
 * so separate Railway replicas cannot become independent nonce owners.
 *
 * Session-level coordination is isolated from ordinary application queries by
 * the dedicated coordination pool. No durable nonce is pre-reserved here: a
 * process crash before broadcast must not create an artificial nonce gap. The
 * authoritative pending nonce remains the chain/provider observation made while
 * this distributed lane is held.
 */
export async function withEvmSignerLane<T>(input: {
  chainId: number;
  walletAddress: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const key = laneKey(input.chainId, input.walletAddress);
  return withLocalLane(key, async () => {
    if (!isDatabaseConfigured) return input.operation();

    const client = await coordinationPool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      locked = true;
      return await input.operation();
    } catch (error) {
      throw new Error(`Distributed EVM signer lane failed closed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
        } catch {
          // Releasing the PostgreSQL session also releases the advisory lock.
        }
      }
      client.release();
    }
  });
}
