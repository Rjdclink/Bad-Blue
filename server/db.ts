// Database setup - optimized for Supabase PostgreSQL and Railway
// Optimized for 500+ concurrent users
import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Detect deployment environment
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || !!process.env.RAILWAY_PROJECT_ID;
const isProduction = process.env.NODE_ENV === 'production';

// CRITICAL: Prioritize SUPABASE_DATABASE_URL to avoid dual-database configuration drift
// drizzle.config.ts uses DATABASE_URL, so ensure runtime always uses SUPABASE_DATABASE_URL
const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

// Log which database connection is being used (helps diagnose configuration issues)
const isSupabaseUrl = !!process.env.SUPABASE_DATABASE_URL;
console.log(`[DATABASE] Using ${isSupabaseUrl ? 'SUPABASE_DATABASE_URL' : 'DATABASE_URL (fallback)'}`);
console.log(`[DATABASE] Environment: ${isProduction ? 'production' : 'development'}, Platform: ${isRailway ? 'Railway' : 'Replit/local'}`);

if (!databaseUrl) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Railway-specific connection configuration
const getPoolConfig = () => {
  const baseConfig = {
    connectionString: databaseUrl,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: isRailway ? 30000 : 10000, // Longer timeout for Railway
  };

  // Railway production needs more conservative pool settings
  if (isRailway) {
    return {
      ...baseConfig,
      max: 20,  // Reduced from 100 for Railway's proxy
      min: 2,   // Reduced from 10
      ssl: process.env.PGSSLMODE !== 'disable' ? { 
        rejectUnauthorized: false,
        // Railway might need additional SSL config
        ...(process.env.DATABASE_SSL_CERT ? { ca: process.env.DATABASE_SSL_CERT } : {})
      } : false,
      // Railway-specific: handle connection through their proxy
      statement_timeout: 30000,
      query_timeout: 30000,
      application_name: 'badblue-railway',
    };
  }

  // Default configuration for local/development
  return {
    ...baseConfig,
    max: 100,
    min: 10,
    ssl: { rejectUnauthorized: false },
  };
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

console.log(`[DATABASE] Connection pool created - ready for queries (${isRailway ? 'Railway' : 'Replit/local'} mode)`);

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

      const newDatabaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
      if (!newDatabaseUrl) {
        throw new Error('DATABASE_URL not available for pool reset');
      }

      // Use the same configuration function for consistency
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

/**
 * Verify database schema by checking table count and comparing expected tables
 * Helps detect configuration drift between drizzle.config.ts and runtime
 * 
 * NOTE: expectedCriticalTables contains only the essential tables required for core functionality.
 * The full database has 67+ tables but we only validate the most critical ones to reduce false positives.
 */
export async function verifyDatabaseSchema(): Promise<{
  success: boolean;
  tableCount: number;
  missingTables: string[];
  connectionSource: string;
  details: string;
  allTables?: string[];
}> {
  const connectionSource = process.env.SUPABASE_DATABASE_URL ? 'SUPABASE_DATABASE_URL' : 'DATABASE_URL';
  
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
    
    // Success if we have enough tables (67+) and no critical tables missing
    const hasEnoughTables = tableCount >= 60;
    const noCriticalMissing = missingTables.length === 0;
    const success = hasEnoughTables && noCriticalMissing;
    
    let details: string;
    if (success) {
      details = `All ${expectedCriticalTables.length} critical tables found (${tableCount} total tables in database)`;
    } else if (!hasEnoughTables) {
      details = `Only ${tableCount} tables found (expected 60+). May be connected to wrong database.`;
    } else {
      details = `Missing ${missingTables.length} critical tables: ${missingTables.join(', ')}`;
    }

    console.log(`[DATABASE] Schema verification: ${success ? '✓' : '❌'} ${details}`);
    console.log(`[DATABASE] Connection source: ${connectionSource}`);
    
    return { 
      success, 
      tableCount, 
      missingTables, 
      connectionSource, 
      details,
      allTables: existingTables
    };
  } catch (error: any) {
    console.error('[DATABASE] Schema verification failed:', error.message);
    return {
      success: false,
      tableCount: 0,
      missingTables: expectedCriticalTables,
      connectionSource,
      details: `Error querying tables: ${error.message}`
    };
  }
}
