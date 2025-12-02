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

// Detect deployment environment
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || !!process.env.RAILWAY_PROJECT_ID;
const isProduction = process.env.NODE_ENV === 'production';

// Check for Supabase connection from multiple possible environment variable names
// Railway uses SUPABASE_URL, other platforms may use different variable names
const supabaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL;

// Helper to detect if a connection string is a valid PostgreSQL Supabase connection
const isSupabaseConnectionString = (url: string | undefined): boolean => {
  if (!url) return false;
  
  // CRITICAL: Must be a PostgreSQL connection string (not HTTP API URL)
  // Supabase REST API URLs (https://xxx.supabase.co) are NOT valid for pg client
  const isPostgresProtocol = url.startsWith('postgres://') || url.startsWith('postgresql://');
  if (!isPostgresProtocol) return false;
  
  // Check for Supabase domains in the connection string:
  // - supabase.co (main dashboard and direct connections)
  // - supabase.com (alternative domain)
  // - supabase.net (pooled/pgBouncer connections via pooler.supabase.net)
  // - pooler.supabase.* (connection pooling endpoints)
  return url.includes('supabase.co') || 
         url.includes('supabase.com') || 
         url.includes('supabase.net') ||
         url.includes('.supabase.');  // Catches any subdomain pattern
};

// Helper to check if URL is an HTTP Supabase URL (wrong format for database)
const isHttpSupabaseUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  return (url.startsWith('http://') || url.startsWith('https://')) && 
         (url.includes('supabase.co') || url.includes('supabase.com') || url.includes('.supabase.'));
};

// Determine the database URL to use, with smart detection
const databaseUrl = supabaseUrl || process.env.DATABASE_URL;
const isExplicitSupabaseEnv = !!supabaseUrl;
const isDatabaseUrlSupabase = isSupabaseConnectionString(process.env.DATABASE_URL);
const isUsingSupabase = isExplicitSupabaseEnv || isDatabaseUrlSupabase;

// NOTE: Production guard removed (Nov 30, 2025) - allow flexible database configuration
// Validation of connection string format happens via isSupabaseConnectionString() helper

// Log which database connection is being used with prominent warning for fallback
if (!isUsingSupabase) {
  console.warn('[DATABASE] ⚠️ WARNING: Using DATABASE_URL fallback (development only)');
  console.warn('[DATABASE] ⚠️ This connects to Replit internal DB (~13 tables), NOT production Supabase (69 tables)');
  console.warn('[DATABASE] ⚠️ Use /api/schema-verify endpoint for accurate table counts');
  console.warn('[DATABASE] ⚠️ execute_sql_tool is DEPRECATED - it connects to wrong database');
} else {
  // Determine exact source for logging
  let source = 'DATABASE_URL (Supabase detected)';
  if (process.env.SUPABASE_DATABASE_URL) {
    source = 'SUPABASE_DATABASE_URL';
  } else if (process.env.SUPABASE_DB_URL) {
    source = 'SUPABASE_DB_URL';
  } else if (process.env.SUPABASE_URL) {
    source = 'SUPABASE_URL';
  }
  console.log(`[DATABASE] ✓ Using ${source} (production database)`);
}
console.log(`[DATABASE] Environment: ${isProduction ? 'production' : 'development'}, Platform: ${isRailway ? 'Railway' : 'Replit/local'}`);

if (!databaseUrl) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_DATABASE_URL, or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Connection configuration - simplified without IPv4 forcing (removed as it doesn't work on Railway)
// ISSUE: Railway cannot reach Supabase's IPv6 addresses, and the pg Pool's lookup option doesn't help
const getPoolConfig = () => {
  const baseConfig: any = {
    connectionString: databaseUrl,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: (isRailway || isProduction) ? 30000 : 10000,
    max: 8,
    min: 1,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: process.env.PGSSLMODE !== 'disable' ? { 
      rejectUnauthorized: false,
      ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {})
    } : false,
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: isRailway ? 'badblue-railway' : 'badblue',
  };

  return baseConfig;
};

// Module-level pool and drizzle instance (use 'let' so they can be reassigned during repairs)
export let pool = new Pool(getPoolConfig());

// Global error handler to prevent unhandled error crashes
pool.on('error', (err, client) => {
  console.error('[DATABASE POOL] Unexpected error on idle client:', err.message);
  console.error('[DATABASE POOL] Error code:', (err as any).code);
  console.error('[DATABASE POOL] Error severity:', (err as any).severity);
  
  if (err.message?.includes('shutdown') || err.message?.includes('termination') || 
      err.message?.includes('Cannot use a pool after calling end') ||
      err.message?.includes('Connection terminated')) {
    console.log('[DATABASE POOL] Database connection issue detected - will auto-recover');
    // Don't call resetPool here as it might cause recursion
  }
});

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
    max: getPoolConfig().max,
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
    // Only log if there's connection pressure (waiting > 0 or total approaching max)
    if (stats.waiting > 0 || stats.total >= stats.max - 2) {
      console.log(`[DATABASE POOL] ⚠️ Connection pressure: total=${stats.total}/${stats.max}, idle=${stats.idle}, waiting=${stats.waiting}`);
    }
  }, 300000); // 5 minutes
}

// Start pool monitor
startPoolMonitor();

console.log(`[DATABASE] Connection pool created - ready for queries (${isRailway ? 'Railway' : 'Replit/local'} mode, max=${getPoolConfig().max})`);

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
      console.log('[DATABASE] Resetting connection pool...');

      try {
        await pool.end();
        console.log('[DATABASE] Old pool closed');
      } catch (error) {
        console.warn('[DATABASE] Error closing old pool (may already be closed):', error);
      }

      const newDatabaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL || process.env.DATABASE_URL;
      if (!newDatabaseUrl) {
        throw new Error('SUPABASE_URL or DATABASE_URL not available for pool reset');
      }

      // Use the same configuration function for consistency (includes IPv4 forcing for Railway)
      pool = new Pool(getPoolConfig());

      // Re-attach error handler to new pool
      pool.on('error', (err, client) => {
        console.error('[DATABASE POOL] Unexpected error on idle client:', err.message);
        if (err.message?.includes('shutdown') || err.message?.includes('termination')) {
          console.log('[DATABASE POOL] Database connection terminated - pool will reconnect automatically');
        }
      });

      db = drizzle(pool, { schema });

      await db.execute('SELECT 1');

      console.log('[DATABASE] ✓ Pool reset successful - connection restored');
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
  // Use the same detection logic as startup (include all possible env var names)
  const explicitSupabaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL;
  const dbUrl = process.env.DATABASE_URL;
  const isDbUrlSupabase = isSupabaseConnectionString(dbUrl);
  
  // Determine which environment variable is being used for logging
  let connectionSource = 'DATABASE_URL';
  if (process.env.SUPABASE_DATABASE_URL) {
    connectionSource = 'SUPABASE_DATABASE_URL';
  } else if (process.env.SUPABASE_DB_URL) {
    connectionSource = 'SUPABASE_DB_URL';
  } else if (process.env.SUPABASE_URL) {
    connectionSource = 'SUPABASE_URL';
  } else if (isDbUrlSupabase) {
    connectionSource = 'DATABASE_URL (Supabase detected)';
  }
  const isProductionDatabase = !!explicitSupabaseUrl || !!isDbUrlSupabase;
  
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
      console.error(`[DATABASE] ❌ You may be connected to Replit internal database instead of Supabase`);
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
