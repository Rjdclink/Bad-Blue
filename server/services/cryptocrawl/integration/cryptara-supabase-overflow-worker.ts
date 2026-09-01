import { createHash } from 'node:crypto';
import pg from 'pg';
import {
  isPostgresConnectionString,
  isSupabasePostgresConnectionString,
  isSupabaseProjectUrl,
} from '../../../config.js';

const { Pool } = pg;
const DEFAULT_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 60_000;
const CACHE_SCHEMA_READY_TTL_MS = 5 * 60_000;
const CACHE_SCHEMA_RETRY_MS = 30_000;

function boundedInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function optionalUrl(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function primaryDatabaseUrl(): string {
  return optionalUrl(
    process.env.SUPABASE_DATABASE_URL
      || process.env.SUPABASE_DB_URL
      || process.env.DATABASE_URL,
  );
}

function parsedPostgresUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null;
  } catch {
    return null;
  }
}

function sharedPooler(url: string): boolean {
  const parsed = parsedPostgresUrl(url);
  return Boolean(parsed && /(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname));
}

function transactionPoolerUrl(url: string): string {
  const parsed = parsedPostgresUrl(url);
  if (!parsed || !sharedPooler(url)) return url;
  if (parsed.port !== '5432' && parsed.port !== '6543') return url;
  parsed.port = '6543';
  return parsed.toString();
}

function projectIdentity(url: string): string | null {
  const parsed = parsedPostgresUrl(url);
  if (!parsed) return null;
  const direct = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (direct) return direct.toLowerCase();
  const username = decodeURIComponent(parsed.username || '');
  const pooled = username.match(/^postgres\.([a-z0-9]+)$/i)?.[1];
  return pooled ? pooled.toLowerCase() : null;
}

function jsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null) return true;
  if (['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const object = value as object;
  if (seen.has(object)) return false;
  seen.add(object);
  try {
    if (Array.isArray(value)) return value.every(item => jsonSafe(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every(item => jsonSafe(item, seen));
  } finally {
    seen.delete(object);
  }
}

export type CryptaraOverflowInformationClass =
  | 'connector_readiness'
  | 'schema_authority'
  | 'market_snapshot'
  | 'resource_snapshot'
  | 'background';

/**
 * Opt-in classes that may later be placed on the second Supabase project. None
 * of these classes may carry authoritative money, execution, governance, nonce,
 * settlement, signer, or terminal durability state.
 */
export type CryptaraParallelProxyWorkload =
  | 'cache'
  | 'analytics'
  | 'telemetry'
  | 'observability'
  | 'background_learning';

export interface CryptaraOverflowCacheHit<T = unknown> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export interface CryptaraParallelProxyResult<T> {
  used: boolean;
  value?: T;
  reason: 'ok' | 'not_configured' | 'configuration_error' | 'cooldown' | 'workload_not_allowed' | 'operation_failed';
}

const configuredRawUrl = optionalUrl(
  process.env.CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL
    || process.env.CRYPTOCRAWL_OVERFLOW_DATABASE_URL,
);
const configuredUrl = configuredRawUrl ? transactionPoolerUrl(configuredRawUrl) : '';
const configuredSource = process.env.CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL?.trim()
  ? 'CRYPTOCRAWL_PARALLEL_PROXY_DATABASE_URL'
  : process.env.CRYPTOCRAWL_OVERFLOW_DATABASE_URL?.trim()
    ? 'CRYPTOCRAWL_OVERFLOW_DATABASE_URL'
    : null;
const primaryUrl = primaryDatabaseUrl();
const overflowProject = projectIdentity(configuredUrl);
const primaryProject = projectIdentity(primaryUrl);
const production = process.env.NODE_ENV === 'production';
let configurationError: string | null = null;

if (configuredUrl) {
  if (isSupabaseProjectUrl(configuredUrl) || !isPostgresConnectionString(configuredUrl)) {
    configurationError = 'parallel proxy URL must be a Postgres connection string';
  } else if (production && !isSupabasePostgresConnectionString(configuredUrl)) {
    configurationError = 'parallel proxy database must remain Supabase-bound in production';
  } else if (production && !sharedPooler(configuredUrl)) {
    configurationError = 'parallel proxy database must use the Supabase shared transaction pooler in production';
  } else if (sharedPooler(configuredUrl) && parsedPostgresUrl(configuredUrl)?.port !== '6543') {
    configurationError = 'parallel proxy shared-pooler connection must use transaction mode port 6543';
  } else if (overflowProject && primaryProject && overflowProject === primaryProject) {
    configurationError = 'parallel proxy database must be a different Supabase project from the primary';
  }
}

export const isCryptaraOverflowConfigured = Boolean(configuredUrl && !configurationError);
export const isCryptaraParallelProxyConfigured = isCryptaraOverflowConfigured;
const overflowPoolMax = boundedInt(process.env.CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 2);
const maxPayloadBytes = boundedInt(process.env.CRYPTOCRAWL_OVERFLOW_MAX_PAYLOAD_BYTES, 256 * 1024, 4 * 1024, 1024 * 1024);
const allowedWorkloads = new Set<CryptaraParallelProxyWorkload>([
  'cache',
  'analytics',
  'telemetry',
  'observability',
  'background_learning',
]);

// This is deliberately separate from the authoritative primary pool, tiny, min=0,
// and optional. Pool construction does not open a connection; the first approved
// proxy operation does. It never participates in primary readiness or startup.
const overflowPool = isCryptaraOverflowConfigured
  ? new Pool({
      connectionString: configuredUrl,
      max: overflowPoolMax,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      query_timeout: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      application_name: 'badblue-cryptara-parallel-proxy',
    } as any)
  : null;

let cacheSchemaProbe: Promise<boolean> | null = null;
let cacheSchemaReadyUntil = 0;
let cacheSchemaRetryAfter = 0;
let consecutiveFailures = 0;
let cooldownUntil = 0;
let nextCleanupAt = 0;
let reads = 0;
let hits = 0;
let writes = 0;
let failures = 0;
let skippedUnsupported = 0;
let cleanupRuns = 0;
let proxyOperations = 0;
let proxySkips = 0;

if (configurationError) {
  console.warn(`[CRYPTARA][PARALLEL-PROXY] Disabled: ${configurationError}`);
} else if (overflowPool) {
  console.log(`[CRYPTARA][PARALLEL-PROXY] Optional secondary Supabase configured (pool max=${overflowPoolMax}, authority=auxiliary_noncritical_only)`);
  overflowPool.on('error', error => {
    recordFailure(error);
    console.warn('[CRYPTARA][PARALLEL-PROXY] Idle secondary connection error:', error.message);
  });
}

function recordFailure(_error: unknown): void {
  failures += 1;
  consecutiveFailures += 1;
  const cooldownMs = Math.min(MAX_COOLDOWN_MS, DEFAULT_COOLDOWN_MS * (2 ** Math.max(0, consecutiveFailures - 1)));
  cooldownUntil = Date.now() + cooldownMs;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

/**
 * Generic opt-in auxiliary lane for systems we explicitly place on the second
 * project later. There is no implicit fallback from critical primary work to this
 * lane. Failure simply returns control to the caller; primary authority is intact.
 */
export async function withCryptaraParallelProxy<T>(
  workload: CryptaraParallelProxyWorkload,
  operation: (query: (text: string, values?: unknown[]) => Promise<any>) => Promise<T>,
): Promise<CryptaraParallelProxyResult<T>> {
  if (!allowedWorkloads.has(workload)) {
    proxySkips += 1;
    return { used: false, reason: 'workload_not_allowed' };
  }
  if (configurationError) {
    proxySkips += 1;
    return { used: false, reason: 'configuration_error' };
  }
  if (!overflowPool) {
    proxySkips += 1;
    return { used: false, reason: 'not_configured' };
  }
  if (Date.now() < cooldownUntil) {
    proxySkips += 1;
    return { used: false, reason: 'cooldown' };
  }

  try {
    const value = await operation((text, values) => overflowPool.query(text, values as any[] | undefined));
    proxyOperations += 1;
    recordSuccess();
    return { used: true, value, reason: 'ok' };
  } catch (error) {
    recordFailure(error);
    return { used: false, reason: 'operation_failed' };
  }
}

/** Cache schema is provisioned later on the secondary project; runtime only verifies it. */
async function ensureCacheSchema(): Promise<boolean> {
  if (Date.now() < cacheSchemaReadyUntil) return true;
  if (Date.now() < cacheSchemaRetryAfter) return false;
  if (cacheSchemaProbe) return cacheSchemaProbe;

  cacheSchemaProbe = (async () => {
    const result = await withCryptaraParallelProxy('cache', query =>
      query(`select to_regclass('private.cryptara_comp_cache') is not null as ready`),
    );
    const ready = result.used && result.value?.rows?.[0]?.ready === true;
    if (ready) {
      cacheSchemaReadyUntil = Date.now() + CACHE_SCHEMA_READY_TTL_MS;
      cacheSchemaRetryAfter = 0;
      return true;
    }
    cacheSchemaReadyUntil = 0;
    cacheSchemaRetryAfter = Date.now() + CACHE_SCHEMA_RETRY_MS;
    return false;
  })().finally(() => {
    cacheSchemaProbe = null;
  });

  return cacheSchemaProbe;
}

function hashedKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function opportunisticCleanup(): Promise<void> {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60 * 60_000;
  const result = await withCryptaraParallelProxy('cache', query => query(
    `delete from private.cryptara_comp_cache
      where cache_key in (
        select cache_key from private.cryptara_comp_cache
         where expires_at <= now()
         order by expires_at asc
         limit 128
      )`,
  ));
  if (result.used) cleanupRuns += 1;
}

export async function readCryptaraOverflowCache<T>(
  key: string,
  informationClass: CryptaraOverflowInformationClass,
): Promise<CryptaraOverflowCacheHit<T> | null> {
  if (!await ensureCacheSchema()) return null;
  reads += 1;
  const result = await withCryptaraParallelProxy('cache', query => query(
    `select payload,
            extract(epoch from created_at) * 1000 as created_at_ms,
            extract(epoch from expires_at) * 1000 as expires_at_ms
       from private.cryptara_comp_cache
      where cache_key=$1 and information_class=$2 and expires_at > now()
      limit 1`,
    [hashedKey(key), informationClass],
  ));
  if (!result.used) return null;
  const row = result.value?.rows?.[0];
  if (!row) return null;
  hits += 1;
  return {
    value: row.payload as T,
    createdAt: Number(row.created_at_ms),
    expiresAt: Number(row.expires_at_ms),
  };
}

export async function writeCryptaraOverflowCache(
  key: string,
  informationClass: CryptaraOverflowInformationClass,
  value: unknown,
  freshForMs: number,
): Promise<boolean> {
  if (freshForMs <= 0 || !await ensureCacheSchema()) return false;
  const safePayload = jsonSafe(value);
  if (!safePayload) {
    skippedUnsupported += 1;
    return false;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    skippedUnsupported += 1;
    return false;
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxPayloadBytes) {
    skippedUnsupported += 1;
    return false;
  }
  const now = Date.now();
  const result = await withCryptaraParallelProxy('cache', query => query(
    `insert into private.cryptara_comp_cache
       (cache_key, information_class, payload, payload_bytes, created_at, expires_at, updated_at)
     values ($1,$2,$3::jsonb,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),now())
     on conflict (cache_key) do update set
       information_class=excluded.information_class,
       payload=excluded.payload,
       payload_bytes=excluded.payload_bytes,
       created_at=excluded.created_at,
       expires_at=excluded.expires_at,
       updated_at=now()`,
    [hashedKey(key), informationClass, serialized, bytes, now, now + freshForMs],
  ));
  if (!result.used) return false;
  writes += 1;
  void opportunisticCleanup();
  return true;
}

export function getCryptaraParallelProxySnapshot() {
  return {
    configured: isCryptaraParallelProxyConfigured,
    configuredSource,
    configurationError,
    role: 'parallel_auxiliary_proxy' as const,
    routing: 'explicit_opt_in_plus_comp_overflow' as const,
    authority: 'auxiliary_noncritical_only' as const,
    executionAuthority: false as const,
    writeAuthority: false as const,
    criticalDataAllowed: false as const,
    financialAuthorityAllowed: false as const,
    governanceAuthorityAllowed: false as const,
    runtimeDdlAllowed: false as const,
    eligibleWorkloads: [...allowedWorkloads],
    pool: overflowPool ? {
      total: overflowPool.totalCount,
      idle: overflowPool.idleCount,
      waiting: overflowPool.waitingCount,
      max: overflowPoolMax,
    } : null,
    cooldownMs: Math.max(0, cooldownUntil - Date.now()),
    consecutiveFailures,
    cacheSchemaReady: cacheSchemaReadyUntil > Date.now(),
    reads,
    hits,
    writes,
    failures,
    skippedUnsupported,
    cleanupRuns,
    proxyOperations,
    proxySkips,
  };
}

/** Backward-compatible name while callers migrate from "overflow" terminology. */
export function getCryptaraOverflowSnapshot() {
  return getCryptaraParallelProxySnapshot();
}
