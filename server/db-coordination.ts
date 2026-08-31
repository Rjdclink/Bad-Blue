import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;
import {
  getDatabaseUrl,
  isRailway as isRailwayHelper,
  isProduction as isProductionHelper,
  loadConfig,
} from './config';

loadConfig();

const isRailway = isRailwayHelper();
const isProduction = isProductionHelper();
const databaseUrl = getDatabaseUrl();
export const isCoordinationDatabaseConfigured = Boolean(databaseUrl && databaseUrl.trim());

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function coordinationPoolConfig(): any {
  const connectionString = isCoordinationDatabaseConfigured ? databaseUrl : 'postgresql://127.0.0.1:1/devlite';
  return {
    connectionString,
    idleTimeoutMillis: boundedInt(process.env.BADBLUE_COORDINATION_IDLE_TIMEOUT_MS, 30_000, 5_000, 120_000),
    connectionTimeoutMillis: boundedInt(process.env.BADBLUE_COORDINATION_CONNECT_TIMEOUT_MS, 12_000, 2_000, 30_000),
    max: boundedInt(process.env.BADBLUE_COORDINATION_POOL_MAX, 1, 1, 2),
    min: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: process.env.PGSSLMODE !== 'disable' ? {
      rejectUnauthorized: false,
      ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {}),
    } : false,
    statement_timeout: boundedInt(process.env.BADBLUE_COORDINATION_STATEMENT_TIMEOUT_MS, 15_000, 2_000, 60_000),
    query_timeout: boundedInt(process.env.BADBLUE_COORDINATION_QUERY_TIMEOUT_MS, 15_000, 2_000, 60_000),
    application_name: isRailway ? 'badblue-railway-coordination' : 'badblue-coordination',
  };
}

/**
 * Dedicated session-capable lane for distributed advisory-lock authorities.
 *
 * This pool must stay tiny. It exists so Kraken/EVM/startup coordination cannot
 * consume the ordinary query pool while a session-level lock is held across a
 * network operation. Ordinary application queries must continue using `pool`
 * from db.ts. No execution, governance, settlement or economic authority lives
 * here; this module only owns PostgreSQL session capacity for coordination.
 */
export let coordinationPool = new Pool(coordinationPoolConfig());

coordinationPool.on('error', error => {
  console.error('[DATABASE COORDINATION POOL] Unexpected idle-client error:', error.message);
});

export function getCoordinationPoolStats(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
  configured: boolean;
} {
  return {
    total: coordinationPool.totalCount,
    idle: coordinationPool.idleCount,
    waiting: coordinationPool.waitingCount,
    max: coordinationPoolConfig().max,
    configured: isCoordinationDatabaseConfigured,
  };
}

export async function resetCoordinationPool(): Promise<void> {
  try {
    await coordinationPool.end();
  } catch {
    // Recreate even if the old pool was already closed by a connection failure.
  }
  coordinationPool = new Pool(coordinationPoolConfig());
  coordinationPool.on('error', error => {
    console.error('[DATABASE COORDINATION POOL] Unexpected idle-client error:', error.message);
  });
}

console.log(`[DATABASE] Coordination pool created (${isProduction ? 'production' : 'development'}, max=${coordinationPoolConfig().max})`);
