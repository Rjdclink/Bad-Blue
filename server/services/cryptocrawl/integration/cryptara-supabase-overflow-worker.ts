import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import pg from 'pg';
import {
  isPostgresConnectionString,
  isSupabasePostgresConnectionString,
  isSupabaseProjectUrl,
} from '../../../config.js';

const { Pool } = pg;
const MIGRATION = '001_cryptara_comp_cache.sql';
const DEFAULT_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 60_000;

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

function resolveMigrationPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'migrations', 'overflow', MIGRATION),
    path.resolve(process.cwd(), 'server', 'migrations', 'overflow', MIGRATION),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error(`overflow migration asset missing: ${MIGRATION}`);
  return resolved;
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

export interface CryptaraOverflowCacheHit<T = unknown> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

const configuredRawUrl = optionalUrl(process.env.CRYPTOCRAWL_OVERFLOW_DATABASE_URL);
const configuredUrl = configuredRawUrl ? transactionPoolerUrl(configuredRawUrl) : '';
const primaryUrl = primaryDatabaseUrl();
const overflowProject = projectIdentity(configuredUrl);
const primaryProject = projectIdentity(primaryUrl);
const production = process.env.NODE_ENV === 'production';
let configurationError: string | null = null;

if (configuredUrl) {
  if (isSupabaseProjectUrl(configuredUrl) || !isPostgresConnectionString(configuredUrl)) {
    configurationError = 'overflow URL must be a Postgres connection string';
  } else if (production && !isSupabasePostgresConnectionString(configuredUrl)) {
    configurationError = 'overflow database must remain Supabase-bound in production';
  } else if (sharedPooler(configuredUrl) && parsedPostgresUrl(configuredUrl)?.port !== '6543') {
    configurationError = 'overflow shared-pooler connection must use transaction mode port 6543';
  } else if (overflowProject && primaryProject && overflowProject === primaryProject) {
    configurationError = 'overflow database must be a different Supabase project from the primary';
  }
}

export const isCryptaraOverflowConfigured = Boolean(configuredUrl && !configurationError);
const overflowPoolMax = boundedInt(process.env.CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 2);
const maxPayloadBytes = boundedInt(process.env.CRYPTOCRAWL_OVERFLOW_MAX_PAYLOAD_BYTES, 256 * 1024, 4 * 1024, 1024 * 1024);
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
      application_name: 'badblue-cryptara-overflow',
    } as any)
  : null;

let schemaReady: Promise<boolean> | null = null;
let consecutiveFailures = 0;
let cooldownUntil = 0;
let nextCleanupAt = 0;
let reads = 0;
let hits = 0;
let writes = 0;
let failures = 0;
let skippedUnsupported = 0;
let cleanupRuns = 0;

if (configurationError) {
  console.warn(`[CRYPTARA][OVERFLOW] Disabled: ${configurationError}`);
} else if (overflowPool) {
  console.log(`[CRYPTARA][OVERFLOW] Optional secondary Supabase configured (pool max=${overflowPoolMax}, authority=cache_only)`);
  overflowPool.on('error', error => {
    recordFailure(error);
    console.warn('[CRYPTARA][OVERFLOW] Idle overflow connection error:', error.message);
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

async function ensureSchema(): Promise<boolean> {
  if (!overflowPool || Date.now() < cooldownUntil) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const sql = fs.readFileSync(resolveMigrationPath(), 'utf8');
    if (!sql.trim()) throw new Error('overflow migration asset is empty');
    await overflowPool.query(sql);
    recordSuccess();
    return true;
  })().catch(error => {
    schemaReady = null;
    recordFailure(error);
    console.warn('[CRYPTARA][OVERFLOW] Cache schema unavailable; primary path remains authoritative');
    return false;
  });
  return schemaReady;
}

function hashedKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function opportunisticCleanup(): Promise<void> {
  if (!overflowPool || Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60 * 60_000;
  try {
    await overflowPool.query(
      `delete from private.cryptara_comp_cache
        where cache_key in (
          select cache_key from private.cryptara_comp_cache
           where expires_at <= now()
           order by expires_at asc
           limit 128
        )`,
    );
    cleanupRuns += 1;
  } catch (error) {
    recordFailure(error);
  }
}

export async function readCryptaraOverflowCache<T>(
  key: string,
  informationClass: CryptaraOverflowInformationClass,
): Promise<CryptaraOverflowCacheHit<T> | null> {
  if (!overflowPool || Date.now() < cooldownUntil || !await ensureSchema()) return null;
  reads += 1;
  try {
    const result = await overflowPool.query(
      `select payload,
              extract(epoch from created_at) * 1000 as created_at_ms,
              extract(epoch from expires_at) * 1000 as expires_at_ms
         from private.cryptara_comp_cache
        where cache_key=$1 and information_class=$2 and expires_at > now()
        limit 1`,
      [hashedKey(key), informationClass],
    );
    recordSuccess();
    const row = result.rows?.[0];
    if (!row) return null;
    hits += 1;
    return {
      value: row.payload as T,
      createdAt: Number(row.created_at_ms),
      expiresAt: Number(row.expires_at_ms),
    };
  } catch (error) {
    recordFailure(error);
    return null;
  }
}

export async function writeCryptaraOverflowCache(
  key: string,
  informationClass: CryptaraOverflowInformationClass,
  value: unknown,
  freshForMs: number,
): Promise<boolean> {
  if (!overflowPool || Date.now() < cooldownUntil || freshForMs <= 0) return false;
  const safePayload = jsonSafe(value);
  if (!safePayload) {
    skippedUnsupported += 1;
    return false;
  }
  if (!await ensureSchema()) return false;
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
  try {
    await overflowPool.query(
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
    );
    writes += 1;
    recordSuccess();
    void opportunisticCleanup();
    return true;
  } catch (error) {
    recordFailure(error);
    return false;
  }
}

export function getCryptaraOverflowSnapshot() {
  return {
    configured: isCryptaraOverflowConfigured,
    configurationError,
    authority: 'cache_only' as const,
    executionAuthority: false as const,
    writeAuthority: false as const,
    criticalDataAllowed: false as const,
    pool: overflowPool ? {
      total: overflowPool.totalCount,
      idle: overflowPool.idleCount,
      waiting: overflowPool.waitingCount,
      max: overflowPoolMax,
    } : null,
    cooldownMs: Math.max(0, cooldownUntil - Date.now()),
    consecutiveFailures,
    reads,
    hits,
    writes,
    failures,
    skippedUnsupported,
    cleanupRuns,
  };
}
