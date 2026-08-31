import type { PoolClient } from 'pg';
import { coordinationPool, isDatabaseConfigured } from '../../../db.js';

const localTails = new Map<string, Promise<void>>();

function boundedNumber(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

const DISTRIBUTED_LOCK_MAX_WAIT_MS = boundedNumber(process.env.CRYPTOCRAWL_EVM_SIGNER_LOCK_MAX_WAIT_MS, 1_500, 100, 10_000);
const DISTRIBUTED_LOCK_POLL_MS = boundedNumber(process.env.CRYPTOCRAWL_EVM_SIGNER_LOCK_POLL_MS, 75, 20, 500);
let distributedLockContentionCount = 0;
let distributedLockTimeoutCount = 0;
let distributedLastLockWaitMs = 0;

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

async function acquireDistributedSignerLock(client: PoolClient, key: string): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + DISTRIBUTED_LOCK_MAX_WAIT_MS;
  while (true) {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
    if (result.rows?.[0]?.locked === true) {
      distributedLastLockWaitMs = Math.max(0, Date.now() - startedAt);
      return;
    }

    distributedLockContentionCount += 1;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      distributedLockTimeoutCount += 1;
      distributedLastLockWaitMs = Math.max(0, Date.now() - startedAt);
      throw new Error(`distributed signer lane busy after ${distributedLastLockWaitMs}ms; fail-closed without blocking PostgreSQL advisory-lock waiters`);
    }

    const pollMs = Math.min(DISTRIBUTED_LOCK_POLL_MS, remainingMs);
    const lowMs = Math.max(10, Math.floor(pollMs / 2));
    const jitterMs = Math.floor(Math.random() * Math.max(1, pollMs - lowMs + 1));
    await new Promise(resolve => setTimeout(resolve, Math.min(remainingMs, lowMs + jitterMs)));
  }
}

/**
 * One EVM account on one chain is one nonce-ordering domain. Hold a PostgreSQL
 * session advisory lock across nonce observation, signing and network submission
 * so separate Railway replicas cannot become independent nonce owners.
 *
 * Acquisition uses pg_try_advisory_lock with a bounded jittered wait. Busy lanes
 * fail closed instead of entering PostgreSQL's blocking advisory-lock wait queue.
 * Session-level coordination stays isolated from ordinary application queries by
 * the dedicated coordination pool. No durable nonce is pre-reserved here: a
 * process crash before broadcast must not create an artificial nonce gap.
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
      await acquireDistributedSignerLock(client, key);
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

export function getEvmSignerLaneSnapshot(): {
  localLaneCount: number;
  distributedLockContentionCount: number;
  distributedLockTimeoutCount: number;
  distributedLastLockWaitMs: number;
  blockingAdvisoryLockUsed: false;
} {
  return {
    localLaneCount: localTails.size,
    distributedLockContentionCount,
    distributedLockTimeoutCount,
    distributedLastLockWaitMs,
    blockingAdvisoryLockUsed: false,
  };
}
