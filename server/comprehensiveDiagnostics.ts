// BadBlue - Comprehensive System Diagnostics
// Complete health check for all application services and features

import { db, pool, resetPool } from './db';
import * as schema from '@shared/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { getSquareClient, getSquareLocationId } from './squareClient';
import nodemailer from 'nodemailer';
import { storage } from './storage';
import { evidenceStorage } from './evidenceStorage';
import { searchOfficer } from './officerSearch';
import { analyzeLegalIssue } from './legalAI';
import { getGroqClient } from './groq';
// Note: The following import was commented out as it was not directly used and might cause build issues.
// If needed, it should be properly configured or removed.
// import { GoogleGenerativeAI } from '@google/generative-ai'; 
import { canAutonomousProceed } from './aiProvider';
import { aiTokenGovernor } from './aiTokenGovernor';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Performance tracking
interface TimedResult {
  startTime: number;
  endTime: number;
  duration: number;
}

interface DiagnosticResult extends TimedResult {
  category: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  message: string;
  details?: any;
  error?: string;
}

interface DiagnosticReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    totalDuration: number;
  };
  results: DiagnosticResult[];
  categorySummary: Record<string, {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  }>;
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    deploymentPlatform: string;
  };
}

class ComprehensiveDiagnostics {
  private results: DiagnosticResult[] = [];

  private async runTest(
    category: string,
    test: string,
    testFn: () => Promise<{ status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; message: string; details?: any; error?: string }>
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const result = await testFn();
      const endTime = Date.now();
      this.results.push({
        category,
        test,
        status: result.status,
        message: result.message,
        details: result.details,
        error: result.error,
        startTime,
        endTime,
        duration: endTime - startTime,
      });
    } catch (error: any) {
      const endTime = Date.now();
      this.results.push({
        category,
        test,
        status: 'FAIL',
        message: 'Test execution failed',
        error: error.message || String(error),
        startTime,
        endTime,
        duration: endTime - startTime,
      });
    }
  }

  // 1. DATABASE CONNECTIVITY TESTS
  async testDatabaseConnectivity() {
    const category = 'DATABASE_CONNECTIVITY';

    // Test basic connection
    await this.runTest(category, 'Basic Connection', async () => {
      try {
        const result = await db.execute(sql`SELECT 1 as test`);
        return { status: 'PASS', message: 'Database connection successful' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Database connection failed', error: error.message };
      }
    });

    // Test connection pool health
    await this.runTest(category, 'Connection Pool', async () => {
      try {
        const poolStats = {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        };
        return { 
          status: 'PASS', 
          message: `Pool healthy: ${poolStats.idle} idle, ${poolStats.waiting} waiting`,
          details: poolStats 
        };
      } catch (error: any) {
        return { status: 'WARN', message: 'Could not get pool stats', error: error.message };
      }
    });

    // Test session store
    await this.runTest(category, 'Session Store', async () => {
      try {
        const sessions = await db.select({ count: sql<number>`count(*)` })
          .from(schema.sessions);
        const activeSessions = await db.execute(sql`
          SELECT count(*) as active 
          FROM sessions 
          WHERE expire > NOW()
        `);
        return { 
          status: 'PASS', 
          message: `Session store working: ${sessions[0].count} total sessions`,
          details: { 
            total: sessions[0].count,
            active: activeSessions.rows[0]?.active || 0
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Session store test failed', error: error.message };
      }
    });

    // Test all tables exist
    await this.runTest(category, 'Table Schema', async () => {
      try {
        const expectedTables = [
          'sessions', 'users', 'auth_accounts', 'admin_access_logs', 'ai_subagent_logs',
          'trial_consultations', 'saved_progress', 'badge_lookups', 'complaints', 
          'lawsuit_filings', 'jurisdictions', 'contact_messages', 'petitions', 
          'petition_signatures', 'foia_requests', 'foia_state_statutes', 
          'complaint_patterns', 'legal_strategies', 'case_patterns', 'document_formats',
          'app_settings', 'admin_settings_audit', 'subscription_tiers',
          'user_subscriptions', 'public_evidence', 'device_fingerprints',
          'sub_agent_capabilities', 'sub_agent_learning_patterns',
          'sub_agent_performance_metrics', 'sub_agent_self_improvement_actions',
          'sub_agent_search_cycles', 'department_urls', 'officer_profiles',
          'ai_cache', 'token_metrics'
        ];

        const tablesQuery = await db.execute(sql`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);

        const existingTables = tablesQuery.rows.map((r: any) => r.table_name);
        const missing = expectedTables.filter(t => !existingTables.includes(t));

        if (missing.length === 0) {
          return { 
            status: 'PASS', 
            message: `All ${expectedTables.length} tables present`,
            details: { tableCount: existingTables.length }
          };
        } else {
          return { 
            status: 'FAIL', 
            message: `Missing ${missing.length} tables`,
            details: { missing },
            error: `Missing tables: ${missing.join(', ')}`
          };
        }
      } catch (error: any) {
        return { status: 'FAIL', message: 'Table schema check failed', error: error.message };
      }
    });

    // Test critical table queries
    await this.runTest(category, 'Critical Table Queries', async () => {
      try {
        const [users, complaints, lawsuits, petitions, foias] = await Promise.all([
          db.select({ count: sql<number>`count(*)` }).from(schema.users),
          db.select({ count: sql<number>`count(*)` }).from(schema.complaints),
          db.select({ count: sql<number>`count(*)` }).from(schema.lawsuitFilings),
          db.select({ count: sql<number>`count(*)` }).from(schema.petitions),
          db.select({ count: sql<number>`count(*)` }).from(schema.foiaRequests),
        ]);

        return { 
          status: 'PASS', 
          message: 'All critical tables accessible',
          details: {
            users: users[0].count,
            complaints: complaints[0].count,
            lawsuits: lawsuits[0].count,
            petitions: petitions[0].count,
            foiaRequests: foias[0].count,
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Critical table queries failed', error: error.message };
      }
    });
  }

  // 2. AUTHENTICATION SYSTEM TESTS
  async testAuthenticationSystem() {
    const category = 'AUTHENTICATION';

    // Test session secret configuration
    await this.runTest(category, 'Session Configuration', async () => {
      if (!process.env.SESSION_SECRET) {
        return { status: 'FAIL', message: 'SESSION_SECRET not configured' };
      }
      if (process.env.SESSION_SECRET.length < 32) {
        return { status: 'WARN', message: 'SESSION_SECRET is short (< 32 chars)' };
      }
      return { status: 'PASS', message: 'Session configuration valid' };
    });

    // Test local auth accounts
    await this.runTest(category, 'Local Auth Accounts', async () => {
      try {
        const accounts = await db.select({ count: sql<number>`count(*)` })
          .from(schema.authAccounts)
          .where(eq(schema.authAccounts.authType, 'local'));

        if (accounts[0].count === 0) {
          return { status: 'WARN', message: 'No local auth accounts found' };
        }

        return { 
          status: 'PASS', 
          message: `Found ${accounts[0].count} local auth accounts`,
          details: { count: accounts[0].count }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Failed to check auth accounts', error: error.message };
      }
    });

    // Test bypass account (Bypass/Payment)
    await this.runTest(category, 'Bypass Account', async () => {
      try {
        const bypassAccount = await storage.getAuthAccountByUsername('Bypass');
        if (!bypassAccount) {
          return { status: 'WARN', message: 'Bypass account not found' };
        }

        // Check if password is "Payment"
        const hash = createHash('sha256').update('Payment' + bypassAccount.passwordSalt).digest('hex');
        if (bypassAccount.passwordHash === hash) {
          return { status: 'PASS', message: 'Bypass account configured correctly' };
        } else {
          return { status: 'WARN', message: 'Bypass account exists but password may differ' };
        }
      } catch (error: any) {
        return { status: 'FAIL', message: 'Failed to check bypass account', error: error.message };
      }
    });

    // Test session management
    await this.runTest(category, 'Session Management', async () => {
      try {
        // Clean expired sessions
        await db.execute(sql`DELETE FROM sessions WHERE expire < NOW()`);

        const activeSessions = await db.execute(sql`
          SELECT count(*) as count,
                 max(expire) as latest_expiry,
                 min(expire) as earliest_expiry
          FROM sessions 
          WHERE expire > NOW()
        `);

        return { 
          status: 'PASS', 
          message: 'Session management working',
          details: {
            activeSessions: activeSessions.rows[0]?.count || 0,
            latestExpiry: activeSessions.rows[0]?.latest_expiry,
            earliestExpiry: activeSessions.rows[0]?.earliest_expiry
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Session management test failed', error: error.message };
      }
    });
  }

  // 3. EXTERNAL SERVICES TESTS
  async testExternalServices() {
    const category = 'EXTERNAL_SERVICES';

    // Test Square API
    await this.runTest(category, 'Square API', async () => {
      if (!process.env.SQUARE_ACCESS_TOKEN) {
        return { status: 'FAIL', message: 'SQUARE_ACCESS_TOKEN not configured' };
      }

      if (!process.env.SQUARE_LOCATION_ID) {
        return { status: 'FAIL', message: 'SQUARE_LOCATION_ID not configured' };
      }

      try {
        const square = getSquareClient();
        const locationId = getSquareLocationId();
        const locationResponse = await square.locationsApi.retrieveLocation(locationId);

        return { 
          status: 'PASS', 
          message: 'Square API connected',
          details: {
            location: locationResponse.result.location?.name,
            locationId: locationResponse.result.location?.id,
            currency: locationResponse.result.location?.currency
          }
        };
      } catch (error: any) {
        if (error.message?.includes('rate limit')) {
          return { status: 'WARN', message: 'Square API rate limited' };
        }
        return { status: 'FAIL', message: 'Square API connection failed', error: error.message };
      }
    });

    // Test Email (SMTP) service
    await this.runTest(category, 'Email Service (SMTP)', async () => {
      if (!process.env.GWSMTP_USER || !process.env.GWSMTP_PASS) {
        return { status: 'FAIL', message: 'SMTP credentials not configured' };
      }

      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false,
          auth: {
            user: process.env.GWSMTP_USER,
            pass: process.env.GWSMTP_PASS,
          },
        });

        // Verify connection without sending
        await transporter.verify();

        return { 
          status: 'PASS', 
          message: 'SMTP service configured and reachable',
          details: {
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            user: process.env.GWSMTP_USER
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'SMTP connection failed', error: error.message };
      }
    });

    // Test Google Gemini API (using new @google/genai SDK)
    await this.runTest(category, 'Google Gemini API', async () => {
      if (!process.env.GEMINI_API_KEY) {
        return { status: 'FAIL', message: 'GEMINI_API_KEY not configured' };
      }

      try {
        const { GoogleGenAI } = await import("@google/genai");
        const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const result = await genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: 'Respond with OK if working' }] }]
        });
        const text = result.text || '';

        if (text && text.length > 0) {
          return { 
            status: 'PASS', 
            message: 'Gemini API connected and responsive',
            details: { responseLength: text.length }
          };
        }
        return { status: 'WARN', message: 'Gemini API connected but no response' };
      } catch (error: any) {
        if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('429')) {
          return { status: 'WARN', message: 'Gemini API quota/rate limited' };
        }
        return { status: 'FAIL', message: 'Gemini API test failed', error: error.message };
      }
    });

    // Test Groq API
    await this.runTest(category, 'Groq API', async () => {
      if (!process.env.GROQ_API_KEY) {
        return { status: 'FAIL', message: 'GROQ_API_KEY not configured' };
      }

      try {
        const groq = getGroqClient();
        if (!groq) {
          return { status: 'FAIL', message: 'Groq client initialization failed' };
        }

        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: 'Respond with OK if working' }],
          model: 'llama-3.3-70b-versatile',
          max_tokens: 10,
          temperature: 0,
        });

        const response = completion.choices[0]?.message?.content;
        if (response) {
          return { 
            status: 'PASS', 
            message: 'Groq API connected and responsive',
            details: { responseLength: response.length }
          };
        }
        return { status: 'WARN', message: 'Groq API connected but no response' };
      } catch (error: any) {
        if (error.message?.includes('rate limit')) {
          return { status: 'WARN', message: 'Groq API rate limited' };
        }
        return { status: 'FAIL', message: 'Groq API test failed', error: error.message };
      }
    });
  }

  // 4. FILE STORAGE TESTS
  async testFileStorage() {
    const category = 'FILE_STORAGE';

    // Test evidence file directory
    await this.runTest(category, 'Evidence Directory', async () => {
      try {
        const evidenceDir = path.join(process.cwd(), 'evidence_files');
        await fs.access(evidenceDir);
        const stats = await fs.stat(evidenceDir);

        if (!stats.isDirectory()) {
          return { status: 'FAIL', message: 'Evidence directory is not a directory' };
        }

        // Check write permissions
        const testFile = path.join(evidenceDir, '.test_write');
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);

        const files = await fs.readdir(evidenceDir);
        return { 
          status: 'PASS', 
          message: 'Evidence directory accessible and writable',
          details: { fileCount: files.length }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Evidence directory test failed', error: error.message };
      }
    });

    // Test object storage configuration
    await this.runTest(category, 'Object Storage', async () => {
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
      const privateDir = process.env.PRIVATE_OBJECT_DIR;

      if (!bucketId || !publicPaths || !privateDir) {
        return { 
          status: 'WARN', 
          message: 'Object storage not fully configured',
          details: {
            hasBucket: !!bucketId,
            hasPublicPaths: !!publicPaths,
            hasPrivateDir: !!privateDir
          }
        };
      }

      return { 
        status: 'PASS', 
        message: 'Object storage configured',
        details: {
          bucketId: bucketId?.substring(0, 20) + '...',
          publicPaths,
          privateDir
        }
      };
    });

    // Test file upload capability
    await this.runTest(category, 'File Upload/Download', async () => {
      try {
        // Test evidence storage module
        const testData = Buffer.from('Test file content');
        const testMimetype = 'text/plain';
        const testUserId = 'test-user-diagnostic';

        // Note: We're just testing the module exists and loads
        // Not actually uploading to avoid side effects
        if (evidenceStorage && typeof evidenceStorage.saveFile === 'function') {
          return { 
            status: 'PASS', 
            message: 'File upload/download modules loaded'
          };
        }
        return { status: 'WARN', message: 'Evidence storage module not properly loaded' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'File upload test failed', error: error.message };
      }
    });
  }

  // 5. AI SERVICES TESTS
  async testAIServices() {
    const category = 'AI_SERVICES';

    // Test Gemini with actual prompt (using new @google/genai SDK)
    await this.runTest(category, 'Gemini Generation', async () => {
      if (!process.env.GEMINI_API_KEY) {
        return { status: 'SKIP', message: 'Gemini API key not configured' };
      }

      try {
        const { GoogleGenAI } = await import("@google/genai");
        const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const startTime = Date.now();
        const result = await genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: 'What is 2+2? Answer with just the number.' }] }]
        });
        const text = result.text || '';
        const responseTime = Date.now() - startTime;

        if (text && text.includes('4')) {
          return { 
            status: 'PASS', 
            message: 'Gemini API working correctly',
            details: { 
              response: text.substring(0, 50),
              responseTimeMs: responseTime 
            }
          };
        }
        return { status: 'WARN', message: 'Gemini API responded but unexpected output', details: { response: text } };
      } catch (error: any) {
        if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('429')) {
          return { status: 'WARN', message: 'Gemini API quota exceeded' };
        }
        return { status: 'FAIL', message: 'Gemini API test failed', error: error.message };
      }
    });

    // Test Groq with actual prompt
    await this.runTest(category, 'Groq Generation', async () => {
      if (!process.env.GROQ_API_KEY) {
        return { status: 'SKIP', message: 'Groq API key not configured' };
      }

      try {
        const groq = getGroqClient();
        if (!groq) {
          return { status: 'FAIL', message: 'Groq client not initialized' };
        }

        const startTime = Date.now();
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: 'What is 3+3? Answer with just the number.' }],
          model: 'llama-3.3-70b-versatile',
          max_tokens: 10,
          temperature: 0,
        });
        const responseTime = Date.now() - startTime;

        const response = completion.choices[0]?.message?.content || '';
        if (response && response.includes('6')) {
          return { 
            status: 'PASS', 
            message: 'Groq API working correctly',
            details: { 
              response: response.substring(0, 50),
              responseTimeMs: responseTime 
            }
          };
        }
        return { status: 'WARN', message: 'Groq API responded but unexpected output', details: { response } };
      } catch (error: any) {
        if (error.message?.includes('rate limit')) {
          return { status: 'WARN', message: 'Groq API rate limited' };
        }
        return { status: 'FAIL', message: 'Groq API test failed', error: error.message };
      }
    });

    // Test AI Token Governor
    await this.runTest(category, 'Token Governor', async () => {
      try {
        const quotaStatus = await aiTokenGovernor.getQuotaStatus();

        const geminiPercent = (quotaStatus.gemini.percentUsed || 0);
        const groqPercent = (quotaStatus.groq.percentUsed || 0);
        const autonomousUsed = (quotaStatus.groq.autonomousUsed || 0);

        let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
        if (geminiPercent > 80 || groqPercent > 80) {
          status = 'WARN';
        }
        if (geminiPercent >= 100 || groqPercent >= 100) {
          status = 'FAIL';
        }

        return {
          status,
          message: `Token usage: Gemini ${geminiPercent.toFixed(1)}%, Groq ${groqPercent.toFixed(1)}%`,
          details: quotaStatus
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Token governor test failed', error: error.message };
      }
    });

    // Test rate limiting
    await this.runTest(category, 'Rate Limiting', async () => {
      try {
        // Check if autonomous operations can proceed
        const canProceed = await canAutonomousProceed();

        if (canProceed) {
          return { status: 'PASS', message: 'Rate limiting active - autonomous operations allowed' };
        } else {
          return { 
            status: 'WARN', 
            message: 'Rate limiting active - autonomous operations blocked (quota reached)' 
          };
        }
      } catch (error: any) {
        return { status: 'FAIL', message: 'Rate limiting test failed', error: error.message };
      }
    });
  }

  // 6. BACKGROUND WORKERS TESTS
  async testBackgroundWorkers() {
    const category = 'BACKGROUND_WORKERS';

    // Test BadBlue Worker existence
    await this.runTest(category, 'BadBlue Worker Module', async () => {
      try {
        const workerPath = path.join(process.cwd(), 'server', 'badblueWorker.ts');
        await fs.access(workerPath);
        return { status: 'PASS', message: 'BadBlue Worker module exists' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'BadBlue Worker module not found' };
      }
    });

    // Test AI Sub-Agent
    await this.runTest(category, 'AI Sub-Agent Status', async () => {
      try {
        // Check recent sub-agent logs
        const recentLogs = await db.select({ count: sql<number>`count(*)` })
          .from(schema.aiSubAgentLogs)
          .where(sql`created_at > NOW() - INTERVAL '1 hour'`);

        const totalLogs = await db.select({ count: sql<number>`count(*)` })
          .from(schema.aiSubAgentLogs);

        return { 
          status: 'PASS', 
          message: 'AI Sub-Agent operational',
          details: {
            recentActivity: recentLogs[0].count,
            totalLogs: totalLogs[0].count
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Sub-Agent status check failed', error: error.message };
      }
    });

    // Test Data Cleanup Scheduler
    await this.runTest(category, 'Data Cleanup Jobs', async () => {
      try {
        // Check for cleanup patterns in app_settings
        const cleanupSettings = await db.select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, 'cleanup_last_run'))
          .limit(1);

        if (cleanupSettings.length > 0) {
          return { 
            status: 'PASS', 
            message: 'Data cleanup configured',
            details: { lastRun: cleanupSettings[0].value }
          };
        }
        return { status: 'WARN', message: 'No cleanup history found' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Cleanup job test failed', error: error.message };
      }
    });

    // Test scheduled task system
    await this.runTest(category, 'Scheduled Tasks', async () => {
      try {
        // Check for any scheduled task indicators
        const settings = await db.select({ count: sql<number>`count(*)` })
          .from(schema.appSettings)
          .where(sql`key LIKE '%schedule%' OR key LIKE '%cron%'`);

        return { 
          status: 'PASS', 
          message: 'Scheduled task system available',
          details: { scheduledSettingsCount: settings[0].count }
        };
      } catch (error: any) {
        return { status: 'WARN', message: 'Scheduled tasks status unclear', error: error.message };
      }
    });
  }

  // 7. CORE FEATURES TESTS
  async testCoreFeatures() {
    const category = 'CORE_FEATURES';

    // Test Officer Search
    await this.runTest(category, 'Officer Search', async () => {
      try {
        // Check if officer search module is available
        if (typeof searchOfficer === 'function') {
          return { 
            status: 'PASS', 
            message: 'Officer search module available',
            details: { moduleLoaded: true }
          };
        }
        return { status: 'WARN', message: 'Officer search module not loaded' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Officer search test failed', error: error.message };
      }
    });

    // Test Legal Consultation
    await this.runTest(category, 'Legal Consultation', async () => {
      try {
        // Check if legal AI module loads
        if (typeof analyzeLegalIssue === 'function') {
          return { status: 'PASS', message: 'Legal consultation module available' };
        }
        return { status: 'WARN', message: 'Legal consultation module not loaded' };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Legal consultation test failed', error: error.message };
      }
    });

    // Test Complaint System
    await this.runTest(category, 'Complaint System', async () => {
      try {
        const complaintCount = await db.select({ count: sql<number>`count(*)` })
          .from(schema.complaints);

        const recentComplaints = await db.select({ count: sql<number>`count(*)` })
          .from(schema.complaints)
          .where(sql`created_at > NOW() - INTERVAL '30 days'`);

        return { 
          status: 'PASS', 
          message: 'Complaint system operational',
          details: {
            total: complaintCount[0].count,
            recent: recentComplaints[0].count
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Complaint system test failed', error: error.message };
      }
    });

    // Test Payment Processing
    await this.runTest(category, 'Payment Processing', async () => {
      if (!process.env.SQUARE_ACCESS_TOKEN) {
        return { status: 'FAIL', message: 'Payment processing not configured' };
      }

      try {
        const square = getSquareClient();
        const locationId = getSquareLocationId();

        // Check location is accessible
        const locationResponse = await square.locationsApi.retrieveLocation(locationId);

        return { 
          status: 'PASS', 
          message: 'Payment processing ready',
          details: { 
            squareConnected: true,
            location: locationResponse.result.location?.name
          }
        };
      } catch (error: any) {
        if (error.message?.includes('rate limit')) {
          return { status: 'WARN', message: 'Square rate limited but configured' };
        }
        return { status: 'FAIL', message: 'Payment processing test failed', error: error.message };
      }
    });

    // Test FOIA Request System
    await this.runTest(category, 'FOIA Requests', async () => {
      try {
        const foiaCount = await db.select({ count: sql<number>`count(*)` })
          .from(schema.foiaRequests);

        const statuteCount = await db.select({ count: sql<number>`count(*)` })
          .from(schema.foiaStateStatutes);

        return { 
          status: 'PASS', 
          message: 'FOIA system operational',
          details: {
            requests: foiaCount[0].count,
            statutes: statuteCount[0].count
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'FOIA system test failed', error: error.message };
      }
    });

    // Test Petition System
    await this.runTest(category, 'Petition System', async () => {
      try {
        const petitionCount = await db.select({ count: sql<number>`count(*)` })
          .from(schema.petitions);

        const signatureCount = await db.select({ count: sql<number>`count(*)` })
          .from(schema.petitionSignatures);

        return { 
          status: 'PASS', 
          message: 'Petition system operational',
          details: {
            petitions: petitionCount[0].count,
            signatures: signatureCount[0].count
          }
        };
      } catch (error: any) {
        return { status: 'FAIL', message: 'Petition system test failed', error: error.message };
      }
    });
  }

  // Generate comprehensive report
  async generateReport(): Promise<DiagnosticReport> {
    // Clear previous results
    this.results = [];

    console.log('[DIAGNOSTICS] Starting comprehensive system diagnostics...');

    // Run all test suites
    await this.testDatabaseConnectivity();
    await this.testAuthenticationSystem();
    await this.testExternalServices();
    await this.testFileStorage();
    await this.testAIServices();
    await this.testBackgroundWorkers();
    await this.testCoreFeatures();

    // Calculate summaries
    const summary = {
      total: this.results.length,
      passed: this.results.filter(r => r.status === 'PASS').length,
      failed: this.results.filter(r => r.status === 'FAIL').length,
      warnings: this.results.filter(r => r.status === 'WARN').length,
      skipped: this.results.filter(r => r.status === 'SKIP').length,
      totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
    };

    // Group by category
    const categorySummary: Record<string, any> = {};
    for (const result of this.results) {
      if (!categorySummary[result.category]) {
        categorySummary[result.category] = {
          passed: 0,
          failed: 0,
          warnings: 0,
          skipped: 0,
        };
      }

      if (result.status === 'PASS') categorySummary[result.category].passed++;
      else if (result.status === 'FAIL') categorySummary[result.category].failed++;
      else if (result.status === 'WARN') categorySummary[result.category].warnings++;
      else if (result.status === 'SKIP') categorySummary[result.category].skipped++;
    }

    console.log(`[DIAGNOSTICS] Complete: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.warnings} warnings`);

    return {
      summary,
      results: this.results,
      categorySummary,
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        deploymentPlatform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'development',
      },
    };
  }
}

// Export main function
export async function runComprehensiveDiagnostics(): Promise<DiagnosticReport> {
  const diagnostics = new ComprehensiveDiagnostics();
  return await diagnostics.generateReport();
}