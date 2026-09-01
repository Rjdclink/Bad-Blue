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
const SCHEMA_READY_TTL_MS = 5 * 60_000;
const SCHEMA_RETRY_MS = 30_000;

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
 * Opt-in classes that may live on the second Supabase project. None may carry
 * authoritative money, execution, governance, nonce, settlement, signer, or
 * live profitability truth.
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
  reason: 'ok' | 'not_configured' | 'configuration_error' | 'cooldown' | 'workload_not_allowed' | 'schema_unavailable' | 'payload_rejected' | 'operation_failed';
}

export interface CryptaraParallelArtifact<T = unknown> {
  key: string;
  workload: Exclude<CryptaraParallelProxyWorkload, 'cache'>;
  topic: string;
  payload: T;
  observedAt: number;
  expiresAt?: number | null;
}

export interface CryptaraParallelStoredArtifact<T = unknown> {
  payload: T;
  observedAt: number;
  expiresAt: number | null;
}

const configuredRawUrl = optionalUrl(process.env.SUPABASE_DATABASE_URL_OVERFLOW);
const configuredUrl = configuredRawUrl ? transactionPoolerUrl(configuredRawUrl) : '';
const configuredSource = process.env.SUPABASE_DATABASE_URL_OVERFLOW?.trim()
  ? 'SUPABASE_DATABASE_URL_OVERFLOW'
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
const maxEventBatch = boundedInt(process.env.CRYPTOCRAWL_PARALLEL_PROXY_EVENT_BATCH, 32, 1, 64);
const allowedWorkloads = new Set<CryptaraParallelProxyWorkload>([
  'cache',
  'analytics',
  'telemetry',
  'observability',
  'background_learning',
]);

// Separate from the authoritative pool, tiny, min=0, lazy, and never part of
// primary readiness. Constructing a pg Pool does not open a backend connection.
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
let parallelSchemaProbe: Promise<boolean> | null = null;
let parallelSchemaReadyUntil = 0;
let parallelSchemaRetryAfter = 0;
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
let snapshotReads = 0;
let snapshotWrites = 0;
let eventReads = 0;
let eventWrites = 0;
let eventRowsWritten = 0;

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

function serializedPayload(value: unknown): { serialized: string; bytes: number } | null {
  if (!jsonSafe(value)) {
    skippedUnsupported += 1;
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > maxPayloadBytes) {
      skippedUnsupported += 1;
      return null;
    }
    return { serialized, bytes };
  } catch {
    skippedUnsupported += 1;
    return null;
  }
}

function hashedKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generic opt-in auxiliary lane. There is no implicit critical fallback from
 * primary to secondary. Failure simply returns control to the caller.
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

/** Cache schema is provisioned on the secondary; runtime only verifies it. */
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
      cacheSchemaReadyUntil = Date.now() + SCHEMA_READY_TTL_MS;
      cacheSchemaRetryAfter = 0;
      return true;
    }
    cacheSchemaReadyUntil = 0;
    cacheSchemaRetryAfter = Date.now() + SCHEMA_RETRY_MS;
    return false;
  })().finally(() => {
    cacheSchemaProbe = null;
  });

  return cacheSchemaProbe;
}

/** Read-model/event/job schema is likewise migration-owned and only verified. */
async function ensureParallelSchema(): Promise<boolean> {
  if (Date.now() < parallelSchemaReadyUntil) return true;
  if (Date.now() < parallelSchemaRetryAfter) return false;
  if (parallelSchemaProbe) return parallelSchemaProbe;

  parallelSchemaProbe = (async () => {
    const result = await withCryptaraParallelProxy('analytics', query => query(`
      select
        to_regclass('private.cryptara_parallel_snapshots') is not null as snapshots,
        to_regclass('private.cryptara_parallel_events') is not null as events,
        to_regclass('private.cryptara_parallel_jobs') is not null as jobs,
        to_regprocedure('private.cryptara_claim_parallel_jobs(text,integer,integer)') is not null as claimant
    `));
    const row = result.value?.rows?.[0] || {};
    const ready = result.used && row.snapshots === true && row.events === true && row.jobs === true && row.claimant === true;
    if (ready) {
      parallelSchemaReadyUntil = Date.now() + SCHEMA_READY_TTL_MS;
      parallelSchemaRetryAfter = 0;
      return true;
    }
    parallelSchemaReadyUntil = 0;
    parallelSchemaRetryAfter = Date.now() + SCHEMA_RETRY_MS;
    return false;
  })().finally(() => {
    parallelSchemaProbe = null;
  });

  return parallelSchemaProbe;
}

async function opportunisticCleanup(): Promise<void> {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60 * 60_000;
  const result = await withCryptaraParallelProxy('cache', query => query(
    `with cache_deleted as (
       delete from private.cryptara_comp_cache
        where cache_key in (
          select cache_key from private.cryptara_comp_cache
           where expires_at <= now()
           order by expires_at asc
           limit 128
        )
       returning 1
     ), snapshot_deleted as (
       delete from private.cryptara_parallel_snapshots
        where snapshot_key in (
          select snapshot_key from private.cryptara_parallel_snapshots
           where expires_at is not null and expires_at <= now()
           order by expires_at asc
           limit 128
        )
       returning 1
     ), event_deleted as (
       delete from private.cryptara_parallel_events
        where event_key in (
          select event_key from private.cryptara_parallel_events
           where expires_at is not null and expires_at <= now()
           order by observed_at asc
           limit 128
        )
       returning 1
     )
     select
       (select count(*) from cache_deleted)::int as cache_deleted,
       (select count(*) from snapshot_deleted)::int as snapshot_deleted,
       (select count(*) from event_deleted)::int as event_deleted`,
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
  const payload = serializedPayload(value);
  if (!payload) return false;
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
    [hashedKey(key), informationClass, payload.serialized, payload.bytes, now, now + freshForMs],
  ));
  if (!result.used) return false;
  writes += 1;
  void opportunisticCleanup();
  return true;
}

/** Precomputed read model: one key replaces repeated primary joins/aggregates. */
export async function writeCryptaraParallelSnapshot<T>(
  artifact: CryptaraParallelArtifact<T>,
): Promise<CryptaraParallelProxyResult<boolean>> {
  if (!allowedWorkloads.has(artifact.workload) || artifact.workload === 'cache') {
    return { used: false, reason: 'workload_not_allowed' };
  }
  if (!await ensureParallelSchema()) return { used: false, reason: 'schema_unavailable' };
  const payload = serializedPayload(artifact.payload);
  if (!payload) return { used: false, reason: 'payload_rejected' };
  const observedAt = Number.isFinite(artifact.observedAt) ? artifact.observedAt : Date.now();
  const expiresAt = Number.isFinite(artifact.expiresAt) ? Number(artifact.expiresAt) : null;
  const result = await withCryptaraParallelProxy(artifact.workload, query => query(
    `insert into private.cryptara_parallel_snapshots
       (snapshot_key, workload, topic, payload, payload_bytes, observed_at, expires_at, updated_at)
     values ($1,$2,$3,$4::jsonb,$5,to_timestamp($6/1000.0),
       case when $7::double precision is null then null else to_timestamp($7/1000.0) end, now())
     on conflict (snapshot_key) do update set
       workload=excluded.workload,
       topic=excluded.topic,
       payload=excluded.payload,
       payload_bytes=excluded.payload_bytes,
       observed_at=excluded.observed_at,
       expires_at=excluded.expires_at,
       updated_at=now()`,
    [hashedKey(artifact.key), artifact.workload, artifact.topic, payload.serialized, payload.bytes, observedAt, expiresAt],
  ));
  if (!result.used) return { used: false, reason: result.reason };
  snapshotWrites += 1;
  void opportunisticCleanup();
  return { used: true, value: true, reason: 'ok' };
}

export async function readCryptaraParallelSnapshot<T>(
  workload: Exclude<CryptaraParallelProxyWorkload, 'cache'>,
  key: string,
  topic: string,
): Promise<CryptaraParallelProxyResult<CryptaraParallelStoredArtifact<T> | null>> {
  if (!await ensureParallelSchema()) return { used: false, reason: 'schema_unavailable' };
  const result = await withCryptaraParallelProxy(workload, query => query(
    `select payload,
            extract(epoch from observed_at) * 1000 as observed_at_ms,
            extract(epoch from expires_at) * 1000 as expires_at_ms
       from private.cryptara_parallel_snapshots
      where snapshot_key=$1 and workload=$2 and topic=$3
        and (expires_at is null or expires_at > now())
      limit 1`,
    [hashedKey(key), workload, topic],
  ));
  if (!result.used) return { used: false, reason: result.reason };
  snapshotReads += 1;
  const row = result.value?.rows?.[0];
  if (!row) return { used: true, value: null, reason: 'ok' };
  return {
    used: true,
    value: {
      payload: row.payload as T,
      observedAt: Number(row.observed_at_ms),
      expiresAt: row.expires_at_ms === null || row.expires_at_ms === undefined ? null : Number(row.expires_at_ms),
    },
    reason: 'ok',
  };
}

/**
 * Batch append derived history in one PostgreSQL statement. This deliberately
 * uses jsonb_to_recordset rather than one INSERT/commit per event.
 */
export async function appendCryptaraParallelEvents<T>(
  artifacts: readonly CryptaraParallelArtifact<T>[],
): Promise<CryptaraParallelProxyResult<number>> {
  if (!artifacts.length) return { used: true, value: 0, reason: 'ok' };
  if (!await ensureParallelSchema()) return { used: false, reason: 'schema_unavailable' };
  const bounded = artifacts.slice(0, maxEventBatch);
  const rows: Array<Record<string, unknown>> = [];
  for (const artifact of bounded) {
    if (artifact.workload === 'cache' || !allowedWorkloads.has(artifact.workload)) {
      return { used: false, reason: 'workload_not_allowed' };
    }
    const payload = serializedPayload(artifact.payload);
    if (!payload) return { used: false, reason: 'payload_rejected' };
    rows.push({
      event_key: hashedKey(artifact.key),
      workload: artifact.workload,
      topic: artifact.topic,
      payload: artifact.payload,
      payload_bytes: payload.bytes,
      observed_at: new Date(Number.isFinite(artifact.observedAt) ? artifact.observedAt : Date.now()).toISOString(),
      expires_at: Number.isFinite(artifact.expiresAt) ? new Date(Number(artifact.expiresAt)).toISOString() : null,
    });
  }
  const workload = bounded[0].workload;
  const result = await withCryptaraParallelProxy(workload, query => query(
    `insert into private.cryptara_parallel_events
       (event_key, workload, topic, payload, payload_bytes, observed_at, expires_at)
     select event_key, workload, topic, payload, payload_bytes, observed_at, expires_at
       from jsonb_to_recordset($1::jsonb) as x(
         event_key text,
         workload text,
         topic text,
         payload jsonb,
         payload_bytes integer,
         observed_at timestamptz,
         expires_at timestamptz
       )
     on conflict (event_key) do nothing`,
    [JSON.stringify(rows)],
  ));
  if (!result.used) return { used: false, reason: result.reason };
  eventWrites += 1;
  const rowCount = Number(result.value?.rowCount || 0);
  eventRowsWritten += rowCount;
  void opportunisticCleanup();
  return { used: true, value: rowCount, reason: 'ok' };
}

export async function readCryptaraParallelEvents<T>(
  workload: Exclude<CryptaraParallelProxyWorkload, 'cache'>,
  topic: string,
  limit = 512,
): Promise<CryptaraParallelProxyResult<Array<CryptaraParallelStoredArtifact<T>>>> {
  if (!await ensureParallelSchema()) return { used: false, reason: 'schema_unavailable' };
  const boundedLimit = boundedInt(limit, 512, 1, 5_000);
  const result = await withCryptaraParallelProxy(workload, query => query(
    `select payload,
            extract(epoch from observed_at) * 1000 as observed_at_ms,
            extract(epoch from expires_at) * 1000 as expires_at_ms
       from private.cryptara_parallel_events
      where workload=$1 and topic=$2
        and (expires_at is null or expires_at > now())
      order by observed_at desc
      limit $3`,
    [workload, topic, boundedLimit],
  ));
  if (!result.used) return { used: false, reason: result.reason };
  eventReads += 1;
  return {
    used: true,
    value: (result.value?.rows || []).map((row: any) => ({
      payload: row.payload as T,
      observedAt: Number(row.observed_at_ms),
      expiresAt: row.expires_at_ms === null || row.expires_at_ms === undefined ? null : Number(row.expires_at_ms),
    })),
    reason: 'ok',
  };
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
    parallelSchemaReady: parallelSchemaReadyUntil > Date.now(),
    reads,
    hits,
    writes,
    failures,
    skippedUnsupported,
    cleanupRuns,
    proxyOperations,
    proxySkips,
    snapshotReads,
    snapshotWrites,
    eventReads,
    eventWrites,
    eventRowsWritten,
    maxEventBatch,
  };
}

/** Backward-compatible name while callers migrate from "overflow" terminology. */
export function getCryptaraOverflowSnapshot() {
  return getCryptaraParallelProxySnapshot();
}
