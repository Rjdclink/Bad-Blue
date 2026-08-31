// Database setup - optimized for Supabase PostgreSQL and Railway
// Optimized for 500+ concurrent users
// 
// CRITICAL DATABASE CONFIGURATION (Nov 30, 2025):
// - Runtime ALWAYS uses SUPABASE_DATABASE_URL (69 tables, production)
// - drizzle.config.ts uses DATABASE_URL (Replit internal, ~13 tables) - this is a protected file
// - execute_sql_tool is DEPRECATED - use /api/schema-verify endpoint instead
// - Table verification runs at startup to catch configuration drift early
//
// RAILWAY IPv6/IPv4 COMPATIBILITY FIX:
// - Supabase connections resolve to IPv6 addresses by default
// - Railway's shared network does NOT support IPv6 egress
// - ENETUNREACH errors occur when Railway tries to connect to Supabase
// - FAILED ATTEMPT: pg Pool's lookup option with family: 4 (runs too late)
// - WORKING FIX: Set Railway env var: NODE_OPTIONS="--dns-result-order=ipv4first"
//   This makes Node.js prefer IPv4 in DNS resolution BEFORE pg connects

// CRITICAL: Load environment variables FIRST before any other code runs
// This must happen before db.ts is imported by other modules (index.ts, storage.ts)
// because ES module imports execute at module load time, before the importing file's body runs
import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import {
  getDatabaseUrl,
  getDatabaseUrlSource,
  isRailway as isRailwayHelper,
  isProduction as isProductionHelper,
  isSupabasePostgresConnectionString,
  isSupabaseProjectUrl,
  loadConfig,
} from './config';

// Load and validate config after dotenv
loadConfig();

// Detect deployment environment using config helpers
const isRailway = isRailwayHelper();
const isProduction = isProductionHelper();

// Get database URL from config (handles SUPABASE_DATABASE_URL, SUPABASE_DB_URL, DATABASE_URL fallback)
const databaseUrl = getDatabaseUrl();
const databaseUrlSource = getDatabaseUrlSource();
export const isDatabaseConfigured = !!(databaseUrl && databaseUrl.trim().length > 0);

function boundedPoolInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedOptionalDatabaseUrl(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function postgresPort(url: string): string | null {
  try {
    return new URL(url).port || null;
  } catch {
    return null;
  }
}

// Ordinary query traffic may use Supavisor transaction mode (6543) when an
// explicit transaction-pool URL is configured. Session-scoped advisory-lock
// traffic must stay on the dedicated coordination URL/session lane.
const transactionDatabaseUrl = normalizedOptionalDatabaseUrl(process.env.SUPABASE_TRANSACTION_DATABASE_URL);
const coordinationDatabaseUrl = normalizedOptionalDatabaseUrl(process.env.CRYPTOCRAWL_COORDINATION_DATABASE_URL) || databaseUrl;
const ordinaryDatabaseUrl = transactionDatabaseUrl || databaseUrl;
const mainPoolMax = boundedPoolInt(process.env.DATABASE_POOL_MAX, 5, 1, 32);
const coordinationPoolMax = boundedPoolInt(process.env.CRYPTOCRAWL_COORDINATION_POOL_MAX, 1, 1, 4);

if (transactionDatabaseUrl) {
  if (isSupabaseProjectUrl(transactionDatabaseUrl) || !isSupabasePostgresConnectionString(transactionDatabaseUrl)) {
    throw new Error('[DATABASE] SUPABASE_TRANSACTION_DATABASE_URL must be a Supabase Postgres connection string');
  }
}

if (isDatabaseConfigured) {
  if (isSupabaseProjectUrl(coordinationDatabaseUrl) || !isSupabasePostgresConnectionString(coordinationDatabaseUrl)) {
    throw new Error('[DATABASE] CRYPTOCRAWL_COORDINATION_DATABASE_URL must be a Supabase Postgres connection string');
  }
  if (postgresPort(coordinationDatabaseUrl) === '6543') {
    throw new Error('[DATABASE] CryptoCrawler coordination requires a session-capable/direct Postgres URL, not transaction-pool port 6543');
  }
}

// Determine if using Supabase for logging purposes
const isUsingSupabase = isSupabasePostgresConnectionString(databaseUrl);

if (isDatabaseConfigured && isSupabaseProjectUrl(databaseUrl)) {
  throw new Error(`[DATABASE] ${databaseUrlSource} is using a Supabase project URL. Use the Postgres connection string from Supabase Settings -> Database.`);
}

if (isProduction && isDatabaseConfigured && !isUsingSupabase) {
  throw new Error(`[DATABASE] Refusing to start in production with non-Supabase database source: ${databaseUrlSource}`);
}

// NOTE: Production guard removed (Nov 30, 2025) - allow flexible database configuration
// Validation of connection string format happens via isSupabaseConnectionString() helper

// Log which database connection is being used with prominent warning for fallback
if (!isUsingSupabase) {
  console.warn(`[DATABASE] ⚠️ Non-Supabase database source detected: ${databaseUrlSource}`);
  console.warn('[DATABASE] ⚠️ Development-only fallback mode is active');
} else {
  console.log(`[DATABASE] ✓ Using Supabase connection from ${databaseUrlSource}`);
}
console.log(`[DATABASE] Environment: ${isProduction ? 'production' : 'development'}, Platform: ${isRailway ? 'Railway' : 'Replit/local'}`);

// Dev-lite/no-secrets boot: allow server to start without a database configured.
// Production safety is enforced by config.ts (loadConfig()).
if (!isDatabaseConfigured) {
  console.warn('[DATABASE] ⚠️ No database configured - running in dev-lite mode (DB features disabled)');
}

const sslConfig = () => process.env.PGSSLMODE !== 'disable' ? {
  rejectUnauthorized: false,
  ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {})
} : false;

// Ordinary application queries. Default capacity is intentionally below the old
// value of 8 so two Railway replicas do not consume a 15-session Supavisor pool
// before coordination and operational headroom are considered.
const getPoolConfig = () => {
  const connectionString = isDatabaseConfigured ? ordinaryDatabaseUrl : 'postgresql://127.0.0.1:1/devlite';
  return {
    connectionString,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: (isRailway || isProduction) ? 30000 : 10000,
    max: mainPoolMax,
    min: 1,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: sslConfig(),
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: isRailway ? 'badblue-railway' : 'badblue',
  } as any;
};

// Session-capable coordination lane for CryptoCrawler nonce/advisory-lock work.
// Keep this pool tiny because every session-level advisory lock pins a backend
// connection until explicitly unlocked or the session ends.
const getCoordinationPoolConfig = () => {
  const connectionString = isDatabaseConfigured ? coordinationDatabaseUrl : 'postgresql://127.0.0.1:1/devlite';
  return {
    connectionString,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: (isRailway || isProduction) ? 15000 : 10000,
    max: coordinationPoolMax,
    min: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: sslConfig(),
    statement_timeout: 15000,
    query_timeout: 15000,
    application_name: isRailway ? 'badblue-cryptocrawl-coordination' : 'badblue-cryptocrawl-coordination-local',
  } as any;
};

// Module-level pools and drizzle instance (use 'let' so they can be reassigned during repairs)
export let pool = new Pool(getPoolConfig());
export let coordinationPool = new Pool(getCoordinationPoolConfig());

function attachPoolErrorHandlers(): void {
  pool.on('error', (err, client) => {
    console.error('[DATABASE POOL] Unexpected error on idle client:', err.message);
    console.error('[DATABASE POOL] Error code:', (err as any).code);
    console.error('[DATABASE POOL] Error severity:', (err as any).severity);
    if (err.message?.includes('shutdown') || err.message?.includes('termination') ||
        err.message?.includes('Cannot use a pool after calling end') ||
        err.message?.includes('Connection terminated')) {
      console.log('[DATABASE POOL] Database connection issue detected - will auto-recover');
    }
  });

  coordinationPool.on('error', err => {
    console.error('[DATABASE COORDINATION] Unexpected error on idle coordination client:', err.message);
    console.error('[DATABASE COORDINATION] Error code:', (err as any).code);
  });
}

attachPoolErrorHandlers();

/**
 * Get current connection pool statistics for monitoring
 * Useful for debugging connection pool exhaustion issues
 */
export function getPoolStats(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: mainPoolMax,
  };
}

export function getCoordinationPoolStats(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    total: coordinationPool.totalCount,
    idle: coordinationPool.idleCount,
    waiting: coordinationPool.waitingCount,
    max: coordinationPoolMax,
  };
}

/**
 * Log pool statistics periodically (every 5 minutes) to detect pool exhaustion patterns
 */
let poolMonitorInterval: NodeJS.Timeout | null = null;

function startPoolMonitor(): void {
  if (poolMonitorInterval) return;
  
  poolMonitorInterval = setInterval(() => {
    const stats = getPoolStats();
    const coordination = getCoordinationPoolStats();
    if (stats.waiting > 0 || stats.total >= stats.max - 1 || coordination.waiting > 0) {
      console.log(`[DATABASE POOL] ⚠️ Connection pressure: main=${stats.total}/${stats.max}, mainIdle=${stats.idle}, mainWaiting=${stats.waiting}, coordination=${coordination.total}/${coordination.max}, coordinationIdle=${coordination.idle}, coordinationWaiting=${coordination.waiting}`);
    }
  }, 300000); // 5 minutes
}

// Start pool monitor
startPoolMonitor();

console.log(`[DATABASE] Connection pools created - ordinary max=${mainPoolMax}, coordination max=${coordinationPoolMax}, ordinaryMode=${transactionDatabaseUrl ? 'transaction_pool' : 'configured_default'}, coordinationMode=session_capable`);

export let db = drizzle(pool, { schema });

// Reset lock to prevent concurrent pool resets
let resetInProgress: Promise<void> | null = null;

/**
 * Reset the database connection pool and Drizzle instance
 * Used by Worker auto-repair to recover from connection failures
 * Thread-safe: prevents concurrent resets
 */
export async function resetPool(): Promise<void> {
  if (resetInProgress) {
    console.log('[DATABASE] Reset already in progress - waiting...');
    await resetInProgress;
    return;
  }

  resetInProgress = (async () => {
    try {
      console.log('[DATABASE] Resetting connection pools...');

      try {
        await Promise.allSettled([pool.end(), coordinationPool.end()]);
        console.log('[DATABASE] Old pools closed');
      } catch (error) {
        console.warn('[DATABASE] Error closing old pools (may already be closed):', error);
      }

      // Use getDatabaseUrl from config for consistency
      const newDatabaseUrl = getDatabaseUrl();
      if (!newDatabaseUrl) {
        throw new Error('Database URL not available for pool reset');
      }

      pool = new Pool(getPoolConfig());
      coordinationPool = new Pool(getCoordinationPoolConfig());
      attachPoolErrorHandlers();
      db = drizzle(pool, { schema });

      await Promise.all([
        db.execute('SELECT 1'),
        coordinationPool.query('SELECT 1'),
      ]);

      console.log('[DATABASE] ✓ Pool reset successful - ordinary and coordination connections restored');
    } catch (error) {
      console.error('[DATABASE] ❌ Pool reset failed:', error);
      throw error;
    } finally {
      resetInProgress = null;
    }
  })();

  await resetInProgress;
}

// Minimum table count for production database (Supabase has 69 tables)
// If table count is below this, we're likely connected to wrong database
const MINIMUM_PRODUCTION_TABLES = 60;

/**
 * Verify database schema by checking table count and comparing expected tables
 * 
 * CANONICAL SOURCE OF TRUTH for database schema verification.
 * Use this function or /api/schema-verify endpoint instead of execute_sql_tool.
 * 
 * DEPRECATION NOTICE (Nov 30, 2025):
 * - execute_sql_tool connects to DATABASE_URL (Replit internal, ~13 tables)
 * - This function connects to SUPABASE_DATABASE_URL (production, 69 tables)
 * - Always use /api/schema-verify for accurate table counts
 * 
 * NOTE: expectedCriticalTables contains only the essential tables required for core functionality.
 * The full database has 69 tables but we only validate the most critical ones to reduce false positives.
 */
export async function verifyDatabaseSchema(): Promise<{
  success: boolean;
  tableCount: number;
  missingTables: string[];
  connectionSource: string;
  details: string;
  allTables?: string[];
  isProductionDatabase: boolean;
}> {
  // Use config to determine database connection
  const connectionSource = 'config (getDatabaseUrl)';
  const isProductionDatabase = isSupabasePostgresConnectionString(databaseUrl);
  
  // Critical tables that must exist for core BadBlue functionality
  // These match the actual table names from shared/schema.ts and migrations
  const expectedCriticalTables = [
    'users',                       // User authentication
    'complaints',                  // Police complaints
    'lawsuit_filings',             // Civil rights lawsuits
    'foia_requests',               // FOIA requests
    'officer_profiles',            // Officer data (from sub-agent tables)
    'section_1983_filings',        // Federal civil rights filings
    'authority_contacts_cache',    // Authority contact lookup cache
    'complaint_routing_history',   // Complaint routing tracking
    'foia_routing_history',        // FOIA routing tracking
    'trial_consultations',         // IP-based consultations
    'ai_subagent_logs',            // AI sub-agent activity logs
  ];

  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const existingTables = result.rows.map((row: any) => row.table_name);
    const tableCount = existingTables.length;
    const missingTables = expectedCriticalTables.filter(t => !existingTables.includes(t));
    
    // Success if we have enough tables (60+) and no critical tables missing
    const hasEnoughTables = tableCount >= MINIMUM_PRODUCTION_TABLES;
    const noCriticalMissing = missingTables.length === 0;
    const success = hasEnoughTables && noCriticalMissing;
    
    let details: string;
    if (success) {
      details = `All ${expectedCriticalTables.length} critical tables found (${tableCount} total tables in database)`;
    } else if (!hasEnoughTables) {
      details = `Only ${tableCount} tables found (expected ${MINIMUM_PRODUCTION_TABLES}+). Connected to wrong database?`;
      console.error(`[DATABASE] ❌ WRONG DATABASE DETECTED: Only ${tableCount} tables found`);
      console.error(`[DATABASE] ❌ Expected ${MINIMUM_PRODUCTION_TABLES}+ tables (production has 69)`);
      console.error(`[DATABASE] ❌ You may be connected to a stale non-Supabase database instead of Supabase`);
    } else {
      details = `Missing ${missingTables.length} critical tables: ${missingTables.join(', ')}`;
    }

    console.log(`[DATABASE] Schema verification: ${success ? '✓' : '❌'} ${details}`);
    console.log(`[DATABASE] Connection source: ${connectionSource}`);
    console.log(`[DATABASE] Table count: ${tableCount}`);
    
    return { 
      success, 
      tableCount, 
      missingTables, 
      connectionSource,
      details,
      allTables: existingTables,
      isProductionDatabase
    };
  } catch (error: any) {
    console.error('[DATABASE] Schema verification failed:', error.message);
    return {
      success: false,
      tableCount: 0,
      missingTables: expectedCriticalTables,
      connectionSource,
      details: `Error querying tables: ${error.message}`,
      isProductionDatabase
    };
  }
}

/**
 * Run schema verification at startup and log prominently
 * Called during server initialization to catch configuration drift early
 */
export async function runStartupSchemaVerification(): Promise<boolean> {
  console.log('[DATABASE] Running startup schema verification...');
  
  const result = await verifyDatabaseSchema();
  
  if (!result.success) {
    console.warn('╔════════════════════════════════════════════════════════════════╗');
    console.warn('║           DATABASE CONFIGURATION WARNING                       ║');
    console.warn('╠════════════════════════════════════════════════════════════════╣');
    console.warn(`║ Tables found: ${result.tableCount.toString().padEnd(48)}║`);
    console.warn(`║ Expected minimum: ${MINIMUM_PRODUCTION_TABLES.toString().padEnd(44)}║`);
    console.warn(`║ Connection source: ${result.connectionSource.padEnd(43)}║`);
    console.warn('╠════════════════════════════════════════════════════════════════╣');
    console.warn('║ Server will continue with degraded database connectivity       ║');
    console.warn('║ Use /api/schema-verify endpoint for accurate table counts      ║');
    console.warn('╚════════════════════════════════════════════════════════════════╝');
    
    // NOTE: Production guard removed (Nov 30, 2025) - allow server to start with degraded DB
    // Database connectivity issues should not prevent server startup
  } else {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║              DATABASE VERIFICATION SUCCESSFUL                  ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║ Tables found: ${result.tableCount.toString().padEnd(48)}║`);
    console.log(`║ Connection source: ${result.connectionSource.padEnd(43)}║`);
    console.log(`║ Production database: ${result.isProductionDatabase ? 'YES' : 'NO'.padEnd(40)}║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
  }
  
  return result.success;
}
