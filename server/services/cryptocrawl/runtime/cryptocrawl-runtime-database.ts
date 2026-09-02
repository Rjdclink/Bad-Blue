import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import logger from '../../../logger.js';

const { Pool } = pg;

function boundedInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedUrl(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parsedPostgresUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null;
  } catch {
    return null;
  }
}

function isSharedPooler(url: string): boolean {
  const parsed = parsedPostgresUrl(url);
  return Boolean(parsed && /(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname));
}

function derivePoolerMode(url: string, port: '5432' | '6543'): string {
  const parsed = parsedPostgresUrl(url);
  if (!parsed || !isSharedPooler(url)) return '';
  if (parsed.port !== '5432' && parsed.port !== '6543') return '';
  parsed.port = port;
  return parsed.toString();
}

const configuredOverflowUrl = normalizedUrl(process.env.SUPABASE_DATABASE_URL_OVERFLOW);
const overflowParsed = parsedPostgresUrl(configuredOverflowUrl);

export const isDatabaseConfigured = Boolean(configuredOverflowUrl && overflowParsed);
export const isCryptocrawlRuntimeDatabaseConfigured = isDatabaseConfigured;

const transactionUrl = isDatabaseConfigured
  ? (derivePoolerMode(configuredOverflowUrl, '6543') || configuredOverflowUrl)
  : 'postgresql://127.0.0.1:1/cryptocrawl-overflow-disabled';
const coordinationUrl = isDatabaseConfigured
  ? (derivePoolerMode(configuredOverflowUrl, '5432') || configuredOverflowUrl)
  : 'postgresql://127.0.0.1:1/cryptocrawl-overflow-coordination-disabled';

const ordinaryUsesTransactionPool = isSharedPooler(transactionUrl)
  && parsedPostgresUrl(transactionUrl)?.port === '6543';
const coordinationUsesTransactionPool = isSharedPooler(coordinationUrl)
  && parsedPostgresUrl(coordinationUrl)?.port === '6543';

if (isDatabaseConfigured && coordinationUsesTransactionPool) {
  throw new Error('[CryptoCrawlerRuntimeDB] Overflow coordination lane must be session-capable; transaction pool port 6543 is not allowed');
}

const ordinaryPoolMax = boundedInt(process.env.CRYPTOCRAWL_OVERFLOW_POOL_MAX, 2, 1, 4);
const coordinationPoolMax = boundedInt(
  process.env.CRYPTOCRAWL_OVERFLOW_COORDINATION_POOL_MAX
    ?? process.env.CRYPTOCRAWL_COORDINATION_POOL_MAX,
  1,
  1,
  2,
);

const ssl = process.env.PGSSLMODE !== 'disable'
  ? {
      rejectUnauthorized: false,
      ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}),
    }
  : false;

export const pool = new Pool({
  connectionString: transactionUrl,
  max: ordinaryPoolMax,
  min: 0,
  idleTimeoutMillis: ordinaryUsesTransactionPool ? 10_000 : 15_000,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl,
  application_name: 'cryptocrawl-overflow-runtime',
});

export const coordinationPool = new Pool({
  connectionString: coordinationUrl,
  max: coordinationPoolMax,
  min: 0,
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl,
  application_name: 'cryptocrawl-overflow-coordination',
});

pool.on('error', error => {
  logger.warn('[CryptoCrawlerRuntimeDB] Overflow ordinary pool idle client failed', {
    component: 'CryptoCrawlerRuntimeDatabase',
    error: error instanceof Error ? error.message : String(error),
    primaryFallbackUsed: false,
  });
});

coordinationPool.on('error', error => {
  logger.warn('[CryptoCrawlerRuntimeDB] Overflow coordination pool idle client failed', {
    component: 'CryptoCrawlerRuntimeDatabase',
    error: error instanceof Error ? error.message : String(error),
    primaryFallbackUsed: false,
  });
});

export const db = drizzle(pool, { schema });

export function assertCryptocrawlRuntimeDatabaseAvailable(): void {
  if (!isDatabaseConfigured) {
    throw new Error('CryptoCrawler Overflow runtime database is not configured; SUPABASE_DATABASE_URL_OVERFLOW is required');
  }
}

export function getPoolStats(): { total: number; idle: number; waiting: number; max: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: ordinaryPoolMax,
  };
}

export function getCoordinationPoolStats(): { total: number; idle: number; waiting: number; max: number } {
  return {
    total: coordinationPool.totalCount,
    idle: coordinationPool.idleCount,
    waiting: coordinationPool.waitingCount,
    max: coordinationPoolMax,
  };
}

export function getCryptocrawlRuntimeDatabaseSnapshot() {
  return {
    configured: isDatabaseConfigured,
    authority: 'overflow_runtime_database' as const,
    primaryFallbackUsed: false as const,
    ordinaryMode: ordinaryUsesTransactionPool ? 'transaction_pool' as const : 'session_or_direct' as const,
    coordinationMode: 'session_capable' as const,
    ordinary: getPoolStats(),
    coordination: getCoordinationPoolStats(),
  };
}
