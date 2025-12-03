// BadBlue - Comprehensive System Diagnostics
// Tests database, AI services, APIs, payment, worker system, and all features

import { db } from './db';
import { users, complaints, lawsuitFilings, petitions, foiaRequests, badgeLookups, jurisdictions, sessions,
  trialConsultations, savedProgress, authAccounts, petitionSignatures, contactMessages, adminAccessLogs,
  aiSubAgentLogs, foiaStateStatutes, complaintPatterns, legalStrategies, casePatterns, documentFormats,
  appSettings, adminSettingsAudit, subscriptionTiers, userSubscriptions, publicEvidence } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { getSquareClient, getSquareLocationId } from './squareClient';

interface DiagnosticResult {
  category: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  details?: any;
  error?: string;
}

const results: DiagnosticResult[] = [];

function addResult(category: string, test: string, status: 'PASS' | 'FAIL' | 'SKIP', message: string, details?: any, error?: string) {
  results.push({ category, test, status, message, details, error });
}

// Database diagnostics
async function testDatabase() {
  const category = 'DATABASE';

  // Test 1: Verify all 24 tables exist
  try {
    const tables = [
      'sessions', 'users', 'auth_accounts', 'admin_access_logs', 'ai_subagent_logs',
      'trial_consultations', 'saved_progress', 'badge_lookups', 'complaints', 'lawsuit_filings',
      'jurisdictions', 'contact_messages', 'petitions', 'petition_signatures', 'foia_requests',
      'foia_state_statutes', 'complaint_patterns', 'legal_strategies', 'case_patterns',
      'document_formats', 'app_settings', 'admin_settings_audit', 'subscription_tiers',
      'user_subscriptions', 'public_evidence'
    ];
    
    const existingTables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    const tableNames = existingTables.rows.map((r: any) => r.table_name);
    const missing = tables.filter(t => !tableNames.includes(t));
    const extra = tableNames.filter((t: string) => !tables.includes(t));
    
    if (missing.length === 0) {
      addResult(category, 'Table Existence', 'PASS', `All 24 tables exist`, { tables: tableNames });
    } else {
      addResult(category, 'Table Existence', 'FAIL', `Missing tables: ${missing.join(', ')}`, { missing, extra });
    }
  } catch (error: any) {
    addResult(category, 'Table Existence', 'FAIL', 'Failed to query tables', undefined, error.message);
  }

  // Test 2: Test basic queries on critical tables
  try {
    const userCount = await db.select({ count: sql<number>`count(*)` }).from(users);
    const complaintCount = await db.select({ count: sql<number>`count(*)` }).from(complaints);
    const lawsuitCount = await db.select({ count: sql<number>`count(*)` }).from(lawsuitFilings);
    const petitionCount = await db.select({ count: sql<number>`count(*)` }).from(petitions);
    const foiaCount = await db.select({ count: sql<number>`count(*)` }).from(foiaRequests);
    
    addResult(category, 'Table Queries', 'PASS', 'All critical tables can be queried', {
      users: userCount[0].count,
      complaints: complaintCount[0].count,
      lawsuits: lawsuitCount[0].count,
      petitions: petitionCount[0].count,
      foia: foiaCount[0].count
    });
  } catch (error: any) {
    addResult(category, 'Table Queries', 'FAIL', 'Failed to query tables', undefined, error.message);
  }

  // Test 3: Test indexes
  try {
    const indexes = await db.execute(sql`
      SELECT tablename, indexname FROM pg_indexes 
      WHERE schemaname = 'public' 
      ORDER BY tablename, indexname
    `);
    addResult(category, 'Indexes', 'PASS', `Found ${indexes.rows.length} indexes`, { count: indexes.rows.length });
  } catch (error: any) {
    addResult(category, 'Indexes', 'FAIL', 'Failed to query indexes', undefined, error.message);
  }

  // Test 4: Test foreign key relationships
  try {
    const fkeys = await db.execute(sql`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    addResult(category, 'Foreign Keys', 'PASS', `Found ${fkeys.rows.length} foreign key constraints`, { count: fkeys.rows.length });
  } catch (error: any) {
    addResult(category, 'Foreign Keys', 'FAIL', 'Failed to query foreign keys', undefined, error.message);
  }
}

// AI Services diagnostics
async function testAIServices() {
  const category = 'AI_SERVICES';
  
  // Test Gemini API (if not rate limited)
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      addResult(category, 'Gemini API Key', 'FAIL', 'GEMINI_API_KEY not found in environment');
    } else {
      addResult(category, 'Gemini API Key', 'PASS', 'GEMINI_API_KEY is configured');
    }
  } catch (error: any) {
    addResult(category, 'Gemini API Key', 'FAIL', 'Error checking Gemini key', undefined, error.message);
  }

  // Test Groq API (Fallback)
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      addResult(category, 'Groq API Key (Fallback)', 'FAIL', 'GROQ_API_KEY not found in environment');
    } else {
      addResult(category, 'Groq API Key (Fallback)', 'PASS', 'GROQ_API_KEY is configured');
    }
  } catch (error: any) {
    addResult(category, 'Groq API Key (Fallback)', 'FAIL', 'Error checking Groq key', undefined, error.message);
  }
}

// Payment/Square diagnostics
async function testSquare() {
  const category = 'SQUARE_PAYMENT';
  
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    
    if (!accessToken) {
      addResult(category, 'Square API Key', 'FAIL', 'SQUARE_ACCESS_TOKEN not found in environment');
      return;
    }
    
    if (!locationId) {
      addResult(category, 'Square Location ID', 'FAIL', 'SQUARE_LOCATION_ID not found in environment');
      return;
    }
    
    const square = getSquareClient();
    
    // Test Square connection
    try {
      const locationResponse = await square.locations.retrieveLocation(locationId);
      addResult(category, 'Square Connection', 'PASS', 'Successfully connected to Square', { 
        location: locationResponse.result.location?.name,
        locationId: locationResponse.result.location?.id
      });
    } catch (error: any) {
      addResult(category, 'Square Connection', 'FAIL', 'Failed to connect to Square', undefined, error.message);
    }
    
    // Test Square catalog (products)
    try {
      const catalogResponse = await square.catalog.listCatalog(undefined, 'ITEM');
      addResult(category, 'Square Catalog', 'PASS', `Found ${catalogResponse.result.objects?.length || 0} catalog items`, {
        items: catalogResponse.result.objects?.length || 0
      });
    } catch (error: any) {
      addResult(category, 'Square Catalog', 'FAIL', 'Failed to query Square catalog', undefined, error.message);
    }
  } catch (error: any) {
    addResult(category, 'Square Setup', 'FAIL', 'Failed to initialize Square', undefined, error.message);
  }
}

// Email service diagnostics
async function testEmail() {
  const category = 'EMAIL_SERVICE';
  
  try {
    const smtpUser = process.env.GWSMTP_USER;
    const smtpPass = process.env.GWSMTP_PASS;
    
    if (!smtpUser || !smtpPass) {
      addResult(category, 'SMTP Credentials', 'FAIL', 'SMTP credentials not configured');
    } else {
      addResult(category, 'SMTP Credentials', 'PASS', 'SMTP credentials are configured');
    }
  } catch (error: any) {
    addResult(category, 'SMTP Credentials', 'FAIL', 'Error checking SMTP credentials', undefined, error.message);
  }
}

// Object Storage diagnostics
async function testObjectStorage() {
  const category = 'OBJECT_STORAGE';
  
  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    
    if (!bucketId) {
      addResult(category, 'Object Storage', 'FAIL', 'DEFAULT_OBJECT_STORAGE_BUCKET_ID not configured');
    } else if (!publicPaths || !privateDir) {
      addResult(category, 'Object Storage', 'FAIL', 'Object storage paths not configured');
    } else {
      addResult(category, 'Object Storage', 'PASS', 'Object storage is configured', {
        bucketId: bucketId.substring(0, 20) + '...',
        publicPaths,
        privateDir
      });
    }
  } catch (error: any) {
    addResult(category, 'Object Storage', 'FAIL', 'Error checking object storage', undefined, error.message);
  }
}

// Session/Auth diagnostics
async function testAuthentication() {
  const category = 'AUTHENTICATION';
  
  try {
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      addResult(category, 'Session Secret', 'FAIL', 'SESSION_SECRET not configured');
    } else {
      addResult(category, 'Session Secret', 'PASS', 'SESSION_SECRET is configured');
    }
    
    // Check for admin accounts
    const adminCount = await db.select({ count: sql<number>`count(*)` }).from(authAccounts).where(eq(authAccounts.authType, 'local'));
    addResult(category, 'Admin Accounts', 'PASS', `Found ${adminCount[0].count} local auth accounts`, { count: adminCount[0].count });
    
    // Check session table
    const sessionCount = await db.select({ count: sql<number>`count(*)` }).from(sessions);
    addResult(category, 'Sessions', 'PASS', `Found ${sessionCount[0].count} active sessions`, { count: sessionCount[0].count });
  } catch (error: any) {
    addResult(category, 'Authentication', 'FAIL', 'Error testing authentication', undefined, error.message);
  }
}

// Environment variables check
async function testEnvironment() {
  const category = 'ENVIRONMENT';
  
  const requiredVars = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'STRIPE_SECRET_KEY',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'GWSMTP_USER',
    'GWSMTP_PASS',
    'DEFAULT_OBJECT_STORAGE_BUCKET_ID',
    'PUBLIC_OBJECT_SEARCH_PATHS',
    'PRIVATE_OBJECT_DIR'
  ];
  
  const missing: string[] = [];
  const present: string[] = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    } else {
      present.push(varName);
    }
  }
  
  if (missing.length === 0) {
    addResult(category, 'Environment Variables', 'PASS', `All ${requiredVars.length} required variables are set`, { present });
  } else {
    addResult(category, 'Environment Variables', 'FAIL', `Missing ${missing.length} required variables`, { missing, present });
  }
}

// Main diagnostic function
export async function runFullDiagnostics(): Promise<{
  summary: { total: number; passed: number; failed: number; skipped: number };
  results: DiagnosticResult[];
  timestamp: string;
}> {
  results.length = 0; // Clear previous results
  
  console.log('[DIAGNOSTICS] Starting comprehensive system diagnostics...');
  
  await testEnvironment();
  await testDatabase();
  await testAIServices();
  await testSquare();
  await testEmail();
  await testObjectStorage();
  await testAuthentication();
  
  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    skipped: results.filter(r => r.status === 'SKIP').length
  };
  
  console.log('[DIAGNOSTICS] Diagnostics complete:', summary);
  
  return {
    summary,
    results,
    timestamp: new Date().toISOString()
  };
}
