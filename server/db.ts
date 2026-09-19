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
  isPostgresConnectionString,
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

function parsedPostgresUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null;
  } catch {
    return null;
  }
}

function postgresPort(url: string): string | null {
  return parsedPostgresUrl(url)?.port || null;
}

function isSupabaseSharedPoolerUrl(url: string): boolean {
  const parsed = parsedPostgresUrl(url);
  return Boolean(parsed && /(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname));
}

function deriveSupabasePoolerModeUrl(url: string, port: '5432' | '6543'): string {
  const parsed = parsedPostgresUrl(url);
  if (!parsed || !isSupabaseSharedPoolerUrl(url)) return '';
  if (parsed.port !== '5432' && parsed.port !== '6543') return '';
  parsed.port = port;
  return parsed.toString();
}

// Supabase's shared pooler uses the same host/tenant credentials for both modes:
// 5432 = session, 6543 = transaction. Derive the complementary URL when Railway
// already has one pooler URL so the dual-lane fix is effective without requiring
// additional secrets. Direct db.<project>.supabase.co connections are never
// rewritten because their port semantics are different.
const explicitTransactionDatabaseUrl = normalizedOptionalDatabaseUrl(process.env.SUPABASE_TRANSACTION_DATABASE_URL);
const explicitCoordinationDatabaseUrl = normalizedOptionalDatabaseUrl(
  process.env.DATABASE_COORDINATION_URL || process.env.CRYPTOCRAWL_COORDINATION_DATABASE_URL,
);
const derivedTransactionDatabaseUrl = explicitTransactionDatabaseUrl ? '' : deriveSupabasePoolerModeUrl(databaseUrl, '6543');
const derivedCoordinationDatabaseUrl = explicitCoordinationDatabaseUrl ? '' : deriveSupabasePoolerModeUrl(databaseUrl, '5432');
const transactionDatabaseUrl = explicitTransactionDatabaseUrl || derivedTransactionDatabaseUrl;
const coordinationDatabaseUrl = explicitCoordinationDatabaseUrl || derivedCoordinationDatabaseUrl || databaseUrl;
const ordinaryDatabaseUrl = transactionDatabaseUrl || databaseUrl;
const ordinaryUsesTransactionPool = postgresPort(ordinaryDatabaseUrl) === '6543' && isSupabaseSharedPoolerUrl(ordinaryDatabaseUrl);
let ordinarySessionFallbackActive = false;
// Transaction-mode clients are multiplexed by Supavisor. If no transaction lane
// is available, use a deliberately smaller session fallback so multiple Railway
// replicas cannot consume the entire 15-session pool before coordination/admin.
// A legacy DATABASE_POOL_MAX value cannot bypass the hard session fallback ceiling.
const requestedMainPoolMax = boundedPoolInt(process.env.DATABASE_POOL_MAX, 5, 1, 32);
const sessionFallbackPoolMax = boundedPoolInt(process.env.CRYPTOCRAWL_SESSION_FALLBACK_POOL_MAX, 3, 1, 4);
const mainPoolMax = ordinaryUsesTransactionPool
  ? requestedMainPoolMax
  : Math.min(requestedMainPoolMax, sessionFallbackPoolMax);
const coordinationPoolMax = boundedPoolInt(
  process.env.DATABASE_COORDINATION_POOL_MAX ?? process.env.CRYPTOCRAWL_COORDINATION_POOL_MAX,
  1,
  1,
  2,
);

if (transactionDatabaseUrl) {
  if (isSupabaseProjectUrl(transactionDatabaseUrl) || !isPostgresConnectionString(transactionDatabaseUrl)) {
    throw new Error('[DATABASE] SUPABASE transaction lane must be a Postgres connection string');
  }
  if (isProduction && !isSupabasePostgresConnectionString(transactionDatabaseUrl)) {
    throw new Error('[DATABASE] Supabase transaction lane must remain Supabase-bound in production');
  }
  if (postgresPort(transactionDatabaseUrl) !== '6543') {
    throw new Error('[DATABASE] Supabase transaction lane must use transaction-pool port 6543');
  }
}

if (isDatabaseConfigured) {
  if (isSupabaseProjectUrl(coordinationDatabaseUrl) || !isPostgresConnectionString(coordinationDatabaseUrl)) {
    throw new Error('[DATABASE] Application coordination URL must be a Postgres connection string');
  }
  if (isProduction && !isSupabasePostgresConnectionString(coordinationDatabaseUrl)) {
    throw new Error('[DATABASE] Application coordination URL must be a Supabase Postgres connection string in production');
  }
  if (postgresPort(coordinationDatabaseUrl) === '6543') {
    throw new Error('[DATABASE] Application coordination requires a session-capable/direct Postgres URL, not transaction-pool port 6543');
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

// Ordinary application queries. Prefer Supavisor transaction mode so short-lived
// application/lease queries do not pin database sessions across replicas.
const getPoolConfig = () => {
  const activeUsesTransactionPool = ordinaryUsesTransactionPool && !ordinarySessionFallbackActive;
  const activeDatabaseUrl = ordinarySessionFallbackActive ? coordinationDatabaseUrl : ordinaryDatabaseUrl;
  const activePoolMax = ordinarySessionFallbackActive
    ? Math.min(mainPoolMax, sessionFallbackPoolMax)
    : mainPoolMax;
  const connectionString = isDatabaseConfigured ? activeDatabaseUrl : 'postgresql://127.0.0.1:1/devlite';
  return {
    connectionString,
    idleTimeoutMillis: activeUsesTransactionPool ? 10000 : 15000,
    connectionTimeoutMillis: (isRailway || isProduction) ? (activeUsesTransactionPool ? 30000 : 15000) : 10000,
    max: activePoolMax,
    // Never pin an idle backend; session/direct fallback acquires on demand.
    min: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: sslConfig(),
    // Supavisor transaction mode cannot retain session-level statement_timeout.
    // Keep the node-postgres client-side timeout everywhere; only session/direct
    // fallback connections receive the server-side session timeout parameter.
    ...(activeUsesTransactionPool ? {} : { statement_timeout: 30000 }),
    query_timeout: 30000,
    application_name: isRailway ? 'badblue-railway' : 'badblue',
  } as any;
};

// Session-capable coordination lane for application schema/admin work.
// CryptoCrawler hot runtime uses its dedicated Overflow runtime pools and does not
// own this application pool. Keep it tiny because every session-level advisory lock pins a backend
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
    application_name: isRailway ? 'legalwhat-app-coordination' : 'legalwhat-app-coordination-local',
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

function effectivePoolMax(targetPool: any, fallback: number): number {
  const configured = Number(targetPool?.options?.max);
  return Number.isFinite(configured) ? Math.max(1, Math.trunc(configured)) : fallback;
}

export function getApplicationDatabaseSteadyPoolCeiling(): number {
  return ordinarySessionFallbackActive
    ? Math.min(mainPoolMax, sessionFallbackPoolMax)
    : mainPoolMax;
}

export function getApplicationDatabaseRuntimeMode(): 'transaction_pool' | 'session_pool_fallback' | 'session_or_direct' {
  if (ordinarySessionFallbackActive) return 'session_pool_fallback';
  return ordinaryUsesTransactionPool ? 'transaction_pool' : 'session_or_direct';
}

/**
 * Emergency route-local recovery for a Supavisor transaction-pool control-plane
 * failure. This does not introduce new credentials or a new pool: it retargets
 * the existing, currently-empty ordinary Pool to the already-derived shared
 * session lane and keeps the smaller session ceiling. The rolling-deploy max=1
 * guard remains attached to the same Pool options object.
 */
export async function activateApplicationSessionFallback(reason: string): Promise<boolean> {
  if (!isDatabaseConfigured || !ordinaryUsesTransactionPool) return false;
  if (ordinarySessionFallbackActive) return true;
  if (!isSupabaseSharedPoolerUrl(coordinationDatabaseUrl) || postgresPort(coordinationDatabaseUrl) !== '5432') {
    return false;
  }
  if (pool.totalCount > 0 || pool.waitingCount > 0) {
    console.warn('[DATABASE] Session fallback skipped because ordinary pool is already active');
    return false;
  }

  const options = (pool as any).options || {};
  const previous = {
    connectionString: options.connectionString,
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    statement_timeout: options.statement_timeout,
  };

  ordinarySessionFallbackActive = true;
  options.connectionString = coordinationDatabaseUrl;
  options.max = Math.min(effectivePoolMax(pool, mainPoolMax), sessionFallbackPoolMax);
  options.idleTimeoutMillis = 15000;
  options.connectionTimeoutMillis = 15000;
  options.statement_timeout = 30000;

  try {
    await pool.query({ text: 'SELECT 1', query_timeout: 5_000 });
    console.warn(`[DATABASE] Supavisor transaction lane unavailable; session-pool fallback admitted (reason=${reason}, max=${options.max})`);
    return true;
  } catch (error) {
    ordinarySessionFallbackActive = false;
    options.connectionString = previous.connectionString;
    options.max = previous.max;
    options.idleTimeoutMillis = previous.idleTimeoutMillis;
    options.connectionTimeoutMillis = previous.connectionTimeoutMillis;
    if (previous.statement_timeout === undefined) delete options.statement_timeout;
    else options.statement_timeout = previous.statement_timeout;
    console.warn('[DATABASE] Session-pool fallback was also unavailable; transaction route restored');
    throw error;
  }
}

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
    max: effectivePoolMax(pool, mainPoolMax),
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
    max: effectivePoolMax(coordinationPool, coordinationPoolMax),
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

const ordinaryMode = ordinaryUsesTransactionPool
  ? explicitTransactionDatabaseUrl ? 'transaction_pool_explicit' : 'transaction_pool_derived'
  : 'session_or_direct_fallback';
const coordinationMode = explicitCoordinationDatabaseUrl
  ? 'session_capable_explicit'
  : derivedCoordinationDatabaseUrl ? 'session_pool_derived' : 'configured_session_or_direct';
console.log(`[DATABASE] Connection pools created - ordinary max=${mainPoolMax}, coordination max=${coordinationPoolMax}, ordinaryMode=${ordinaryMode}, coordinationMode=${coordinationMode}`);

export let db = drizzle(pool, { schema });

// Reset lock to prevent concurrent pool resets. A reset always preserves the live
// effective ordinary ceiling; only the governed rollout handoff may expand it.
let resetInProgress: Promise<void> | null = null;

/**
 * Reset the database connection pool and Drizzle instance
 * Used by Worker auto-repair to recover from positively identified local pool failures.
 * Thread-safe: prevents concurrent resets.
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
      // Preserve the current effective max exactly. There is intentionally no
      // wall-clock restore here: an unready/reset replica must never self-expand.
      const previousEffectiveMainMax = effectivePoolMax(pool, mainPoolMax);

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

      const nextMainConfig = getPoolConfig();
      nextMainConfig.max = Math.min(mainPoolMax, previousEffectiveMainMax);
      pool = new Pool(nextMainConfig);
      coordinationPool = new Pool(getCoordinationPoolConfig());
      attachPoolErrorHandlers();
      db = drizzle(pool, { schema });

      // Restore the ordinary lane first. Only after it is admitted do we verify
      // the session-capable coordination lane. Parallel probes double connection
      // demand at exactly the point where reset is trying to recover capacity.
      await db.execute('SELECT 1');
      await coordinationPool.query('SELECT 1');

      console.log('[DATABASE] ✓ Pool reset successful - ordinary and coordination connections restored at preserved capacity');
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
    'lexara_conversations',        // LEXARA durable consultation history
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