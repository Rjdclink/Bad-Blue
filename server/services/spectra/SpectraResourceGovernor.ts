import { pool } from '../../db';

export interface SpectraResourcePermit {
  backend: 'postgres-advisory-lock' | 'local-fallback';
  release: () => Promise<void>;
}

export class SpectraResourceBusyError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'SpectraResourceBusyError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface GovernorSnapshot {
  globalLimit: number;
  perTenantLimit: number;
  acquireTimeoutMs: number;
  localFallbackEnabled: boolean;
  localActive: number;
  localQueued: number;
  localTenantActive: Record<string, number>;
  postgresPermitsGranted: number;
  localPermitsGranted: number;
  rejected: number;
}

const GLOBAL_NAMESPACE = 0x53504543;
const TENANT_NAMESPACE = 0x5350544e;

const localTenantActive = new Map<string, number>();
let localActive = 0;
let localQueued = 0;
let postgresPermitsGranted = 0;
let localPermitsGranted = 0;
let rejected = 0;

function boundedInt(
  raw: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

function limits() {
  return {
    globalLimit: boundedInt(process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS, 4, 1, 64),
    perTenantLimit: boundedInt(process.env.SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT, 2, 1, 16),
    acquireTimeoutMs: boundedInt(process.env.SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS, 1_500, 100, 15_000),
    localFallbackEnabled:
      String(process.env.SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK || '').trim().toLowerCase() === 'true',
  };
}

function signedHash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error
      ? signal.reason
      : new Error('SPECTRA resource wait aborted'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason instanceof Error
        ? signal.reason
        : new Error('SPECTRA resource wait aborted'));
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function tryPostgresPermit(
  tenantId: string,
): Promise<SpectraResourcePermit | null> {
  const { globalLimit, perTenantLimit } = limits();
  const client = await pool.connect();

  let globalSlot: number | null = null;
  let tenantSlot: number | null = null;

  try {
    for (let slot = 0; slot < globalLimit; slot += 1) {
      const result = await client.query(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [GLOBAL_NAMESPACE, slot],
      );
      if (result.rows[0]?.acquired === true) {
        globalSlot = slot;
        break;
      }
    }
    if (globalSlot === null) {
      client.release();
      return null;
    }

    for (let slot = 0; slot < perTenantLimit; slot += 1) {
      const tenantSlotKey = signedHash32(`${tenantId}:${slot}`);
      const result = await client.query(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [TENANT_NAMESPACE, tenantSlotKey],
      );
      if (result.rows[0]?.acquired === true) {
        tenantSlot = tenantSlotKey;
        break;
      }
    }

    if (tenantSlot === null) {
      await client.query(
        'SELECT pg_advisory_unlock($1::integer, $2::integer)',
        [GLOBAL_NAMESPACE, globalSlot],
      ).catch(() => undefined);
      client.release();
      return null;
    }

    postgresPermitsGranted += 1;
    let released = false;
    return {
      backend: 'postgres-advisory-lock',
      release: async () => {
        if (released) return;
        released = true;
        let releaseError: Error | undefined;
        try {
          await client.query(
            'SELECT pg_advisory_unlock($1::integer, $2::integer)',
            [TENANT_NAMESPACE, tenantSlot],
          );
          await client.query(
            'SELECT pg_advisory_unlock($1::integer, $2::integer)',
            [GLOBAL_NAMESPACE, globalSlot],
          );
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error(String(error));
          throw releaseError;
        } finally {
          client.release(releaseError);
        }
      },
    };
  } catch (error) {
    if (tenantSlot !== null) {
      await client.query(
        'SELECT pg_advisory_unlock($1::integer, $2::integer)',
        [TENANT_NAMESPACE, tenantSlot],
      ).catch(() => undefined);
    }
    if (globalSlot !== null) {
      await client.query(
        'SELECT pg_advisory_unlock($1::integer, $2::integer)',
        [GLOBAL_NAMESPACE, globalSlot],
      ).catch(() => undefined);
    }
    client.release();
    throw error;
  }
}

function tryLocalPermit(tenantId: string): SpectraResourcePermit | null {
  const { globalLimit, perTenantLimit } = limits();
  const tenantActive = localTenantActive.get(tenantId) || 0;
  if (localActive >= globalLimit || tenantActive >= perTenantLimit) return null;

  localActive += 1;
  localTenantActive.set(tenantId, tenantActive + 1);
  localPermitsGranted += 1;

  let released = false;
  return {
    backend: 'local-fallback',
    release: async () => {
      if (released) return;
      released = true;
      localActive = Math.max(0, localActive - 1);
      const current = Math.max(0, (localTenantActive.get(tenantId) || 1) - 1);
      if (current === 0) localTenantActive.delete(tenantId);
      else localTenantActive.set(tenantId, current);
    },
  };
}

export async function acquireSpectraResourcePermit(
  tenantId: string,
  signal?: AbortSignal,
): Promise<SpectraResourcePermit> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) throw new Error('SPECTRA tenant ID is required.');

  const { acquireTimeoutMs } = limits();
  const startedAt = Date.now();
  localQueued += 1;

  try {
    while (Date.now() - startedAt < acquireTimeoutMs) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error('SPECTRA resource acquisition aborted');
      }

      try {
        const permit = await tryPostgresPermit(normalizedTenantId);
        if (permit) return permit;
      } catch (error) {
        if (limits().localFallbackEnabled) {
          const fallback = tryLocalPermit(normalizedTenantId);
          if (fallback) return fallback;
        } else {
          throw error;
        }
      }

      await sleep(100, signal);
    }

    rejected += 1;
    throw new SpectraResourceBusyError(
      'SPECTRA acquisition capacity is temporarily saturated.',
      Math.max(1_000, Math.min(10_000, acquireTimeoutMs)),
    );
  } finally {
    localQueued = Math.max(0, localQueued - 1);
  }
}

export function getSpectraResourceGovernorSnapshot(): GovernorSnapshot {
  const configured = limits();
  return {
    ...configured,
    localActive,
    localQueued,
    localTenantActive: Object.fromEntries(localTenantActive),
    postgresPermitsGranted,
    localPermitsGranted,
    rejected,
  };
}
