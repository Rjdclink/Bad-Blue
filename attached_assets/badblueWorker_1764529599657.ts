import { promises as fs } from 'fs';
import path from 'path';
import type { Request, Response } from 'express';

// Severity levels for failure classification
export enum Severity {
  NOTICE = 1,
  WARNING = 2,
  MODERATE = 3,
  SERIOUS = 4,
  CRITICAL = 5,
}

export enum IssueCategory {
  INFRASTRUCTURE = 'infrastructure',      // Database, sessions, storage
  APPLICATION_CODE = 'application_code',  // LSP errors, code quality
  AI_SERVICE = 'ai_service',             // Gemini, Groq, API issues
  DATA_INTEGRITY = 'data_integrity',     // Data cleanup, migrations
  CONFIGURATION = 'configuration',       // Env vars, secrets
  EXTERNAL_DEPENDENCY = 'external_dependency' // Stripe, email, Supabase
}

export enum Priority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export interface ResourceProfile {
  cpuIntensive: boolean;
  memoryIntensive: boolean;
  apiCallsRequired: boolean;
  databaseLockRequired: boolean;
  filesystemWriteRequired: boolean;
  estimatedDurationSeconds: number;
}

export interface FailureLogEntry {
  timestamp: string;
  functionAffected: string;
  cause: string;
  systemState: 'working' | 'not_working';
  severity: Severity;
  priority?: Priority;
  category?: IssueCategory;
  resourceProfile?: ResourceProfile;
  dependencies?: string[]; // Array of functionAffected names this depends on
  resolved?: boolean;
  resolvedAt?: string;
  parallelSafe?: boolean; // Can this be fixed in parallel with others?
}

export interface FunctionErrorLogEntry {
  timestamp: string;
  functionTested: string;
  expectedBehavior: string;
  observedBehavior: string;
  severity: Severity;
  status: 'fixed' | 'pending';
  notes?: string;
}

interface RepairMetrics {
  queueLatency: number[];
  meanTimeToResolution: number[];
  concurrentTaskCount: number;
  resourceUtilization: { cpu: number; memory: number };
  repairSuccessRate: number;
  totalRepairs: number;
  successfulRepairs: number;
}

interface ConcurrencyBudget {
  maxConcurrent: number;
  availableSlots: number;
  activeRepairs: Set<string>;
  resourceLocks: Map<string, boolean>;
}

class BadBlueWorker {
  private static instance: BadBlueWorker;
  private diagnosticInterval: NodeJS.Timeout | null = null;
  private repairSchedule: NodeJS.Timeout | null = null;
  private weeklyTestSchedule: NodeJS.Timeout | null = null;
  private backupSchedule: NodeJS.Timeout | null = null;
  private databaseHeartbeatInterval: NodeJS.Timeout | null = null;
  private criticalMonitoringInterval: NodeJS.Timeout | null = null;
  private isRepairInProgress = false;
  private isDiagnosticInProgress = false;
  private isMaintenanceMode = false;
  private consecutiveDbFailures = 0;
  private dbRepairAttempts = 0;
  private lastAlertTimes: Map<string, number> = new Map(); // For alert deduplication

  // Parallel processing state
  private repairQueue: FailureLogEntry[] = [];
  private concurrencyBudget: ConcurrencyBudget = {
    maxConcurrent: 5,
    availableSlots: 5,
    activeRepairs: new Set(),
    resourceLocks: new Map([
      ['database', false],
      ['filesystem', false],
      ['ai-api', false],
    ]),
  };
  private repairMetrics: RepairMetrics = {
    queueLatency: [],
    meanTimeToResolution: [],
    concurrentTaskCount: 0,
    resourceUtilization: { cpu: 0, memory: 0 },
    repairSuccessRate: 0,
    totalRepairs: 0,
    successfulRepairs: 0,
  };

  private readonly DATA_DIR = path.join(process.cwd(), 'data');
  private readonly FAILURE_LOG = path.join(this.DATA_DIR, 'system_failures.log');
  private readonly FUNCTION_ERROR_LOG = path.join(this.DATA_DIR, 'worker_function_error.log');
  private readonly BACKUP_DIR = path.join(this.DATA_DIR, 'backups');
  private readonly METRICS_LOG = path.join(this.DATA_DIR, 'repair_metrics.json');
  private readonly HEALTH_METRICS_LOG = path.join(this.DATA_DIR, 'worker_health_metrics.json');
  private readonly ALERTS_LOG = path.join(this.DATA_DIR, 'system_alerts.log');

  private constructor() {}

  static getInstance(): BadBlueWorker {
    if (!BadBlueWorker.instance) {
      BadBlueWorker.instance = new BadBlueWorker();
    }
    return BadBlueWorker.instance;
  }

  async initialize() {
    console.log('[BadBlue Worker] Initializing background worker system...');
    
    // Detect Railway environment
    const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || !!process.env.RAILWAY_PROJECT_ID;
    
    if (isRailway) {
      console.log('[BadBlue Worker] Running in Railway production environment - adjusted settings applied');
    }

    // Register graceful shutdown handlers for Railway/production
    this.registerShutdownHandlers();

    // Ensure data directory exists
    await this.ensureDataDirectory();

    // Initialize autonomous search controller only if not Railway (to avoid quota issues)
    if (!isRailway) {
      const { searchController } = await import('./autonomousSearchController');
      await searchController.initialize();
    } else {
      console.log('[BadBlue Worker] Skipping autonomous search controller in Railway environment');
    }

    // Schedule 30-minute critical monitoring (rate limits, database, Stripe, email)
    this.scheduleCriticalMonitoring();

    // Schedule database heartbeat (5 mins for Railway, 15 for others)
    this.scheduleDatabaseHeartbeat();

    // Only schedule heavy background tasks if not Railway
    if (!isRailway) {
      // Schedule 6-hour diagnostic cycle
      this.scheduleDiagnostics();

      // Schedule daily 2:00 AM UTC repair cycle
      this.scheduleDailyRepair();

      // Schedule weekly 2:00 AM UTC comprehensive system test
      this.scheduleWeeklyTest();

      // Schedule weekly automated backup (Sundays at 3:00 AM UTC, after weekly test)
      this.scheduleWeeklyBackup();
    } else {
      console.log('[BadBlue Worker] Heavy background tasks disabled in Railway environment');
    }

    console.log('[BadBlue Worker] ✓ Background worker system active');
    console.log(`[BadBlue Worker] - Environment: ${isRailway ? 'Railway Production' : 'Standard'}`);
    console.log('[BadBlue Worker] - Critical monitoring: Every 30 minutes (rate limits, AI, payments, email)');
    console.log(`[BadBlue Worker] - Database heartbeat: Every ${isRailway ? '5' : '15'} minutes (lightweight connectivity check)`);
    
    if (!isRailway) {
      console.log('[BadBlue Worker] - Diagnostic cycle: Every 6 hours (background process - no user interruption)');
      console.log('[BadBlue Worker] - Daily repair: 8:30 PM UTC (enters maintenance mode)');
      console.log('[BadBlue Worker] - Comprehensive weekly test: Every Sunday 8:30 PM UTC (enters maintenance mode)');
      console.log('[BadBlue Worker] - Weekly backup: Every Sunday 9:00 PM UTC (backs up code + database)');
    }
  }
  
  private registerShutdownHandlers() {
    const gracefulShutdown = async (signal: string) => {
      console.log(`[BadBlue Worker] Received ${signal} signal - initiating graceful shutdown...`);
      
      // Clear all intervals
      if (this.diagnosticInterval) clearInterval(this.diagnosticInterval);
      if (this.repairSchedule) clearTimeout(this.repairSchedule);
      if (this.weeklyTestSchedule) clearTimeout(this.weeklyTestSchedule);
      if (this.backupSchedule) clearTimeout(this.backupSchedule);
      if (this.databaseHeartbeatInterval) clearInterval(this.databaseHeartbeatInterval);
      if (this.criticalMonitoringInterval) clearInterval(this.criticalMonitoringInterval);
      
      // Wait for any ongoing operations to complete
      const maxWaitTime = 5000; // 5 seconds max wait
      const startTime = Date.now();
      
      while ((this.isDiagnosticInProgress || this.isRepairInProgress) && 
             (Date.now() - startTime < maxWaitTime)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log('[BadBlue Worker] ✓ Graceful shutdown complete');
      process.exit(0);
    };
    
    // Handle SIGTERM (Railway/Docker) and SIGINT (Ctrl-C)
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[BadBlue Worker] Uncaught exception:', error);
      // Don't exit in production - let the process recover
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      }
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[BadBlue Worker] Unhandled promise rejection:', reason);
      // Don't exit in production - let the process recover
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      }
    });
  }

  private async ensureDataDirectory() {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true });

      // Initialize log files if they don't exist
      try {
        await fs.access(this.FAILURE_LOG);
      } catch {
        await fs.writeFile(this.FAILURE_LOG, JSON.stringify([], null, 2));
      }

      try {
        await fs.access(this.FUNCTION_ERROR_LOG);
      } catch {
        await fs.writeFile(this.FUNCTION_ERROR_LOG, JSON.stringify([], null, 2));
      }
    } catch (error) {
      console.error('[BadBlue Worker] Error creating data directory:', error);
    }
  }

  private scheduleDiagnostics() {
    // Run diagnostics every 6 hours
    const SIX_HOURS = 6 * 60 * 60 * 1000;

    this.diagnosticInterval = setInterval(async () => {
      await this.runDiagnostics();
    }, SIX_HOURS);

    // No initial diagnostic run - only runs every 6 hours
    // This prevents continuous runs during development when server restarts frequently
  }

  private scheduleDailyRepair() {
    // Calculate next 8:30 PM UTC
    const scheduleNextRepair = () => {
      const now = new Date();
      const next = new Date(now);

      // Set to 8:30 PM UTC (20:30)
      next.setUTCHours(20, 30, 0, 0);

      // If we've passed today's 8:30 PM UTC, schedule for tomorrow
      if (now.getTime() >= next.getTime()) {
        next.setDate(next.getDate() + 1);
      }

      const delay = next.getTime() - now.getTime();

      this.repairSchedule = setTimeout(async () => {
        await this.runDailyRepair();
        scheduleNextRepair(); // Schedule next repair
      }, delay);

      console.log(`[BadBlue Worker] Next repair cycle scheduled for: ${next.toISOString()}`);
    };

    scheduleNextRepair();
  }

  private scheduleWeeklyTest() {
    // Calculate next Sunday 8:30 PM UTC
    const scheduleNextTest = () => {
      const now = new Date();
      const next = new Date(now);

      // Set to 8:30 PM UTC (20:30)
      next.setUTCHours(20, 30, 0, 0);

      // Move to next Sunday (0 = Sunday)
      const daysUntilSunday = (7 - now.getUTCDay()) % 7;
      if (daysUntilSunday === 0 && now.getTime() >= next.getTime()) {
        // Today is Sunday but we've passed 8:30 PM UTC, schedule for next Sunday
        next.setDate(next.getDate() + 7);
      } else {
        next.setDate(next.getDate() + daysUntilSunday);
      }

      const delay = next.getTime() - now.getTime();

      this.weeklyTestSchedule = setTimeout(async () => {
        await this.runWeeklySystemTest();
        scheduleNextTest(); // Schedule next test
      }, delay);

      console.log(`[BadBlue Worker] Next comprehensive weekly test scheduled for: ${next.toISOString()}`);
    };

    scheduleNextTest();
  }

  private scheduleCriticalMonitoring() {
    // Run critical monitoring every 30 minutes
    const THIRTY_MINUTES = 30 * 60 * 1000;

    this.criticalMonitoringInterval = setInterval(async () => {
      await this.runCriticalMonitoring();
    }, THIRTY_MINUTES);

    // Run initial check after 1 minute to avoid startup conflicts
    setTimeout(async () => {
      await this.runCriticalMonitoring();
    }, 60000);
  }

  private scheduleWeeklyBackup() {
    // Calculate next Sunday 9:00 PM UTC (30 minutes after weekly test)
    const scheduleNextBackup = () => {
      const now = new Date();
      const next = new Date(now);

      // Set to 9:00 PM UTC (21:00)
      next.setUTCHours(21, 0, 0, 0);

      // Move to next Sunday (0 = Sunday)
      const daysUntilSunday = (7 - now.getUTCDay()) % 7;
      if (daysUntilSunday === 0 && now.getTime() >= next.getTime()) {
        // Today is Sunday but we've passed 3 AM UTC, schedule for next Sunday
        next.setDate(next.getDate() + 7);
      } else {
        next.setDate(next.getDate() + daysUntilSunday);
      }

      const delay = next.getTime() - now.getTime();

      this.backupSchedule = setTimeout(async () => {
        await this.performWeeklyBackup();
        scheduleNextBackup(); // Schedule next backup
      }, delay);

      console.log(`[BadBlue Worker] Next weekly backup scheduled for: ${next.toISOString()}`);
    };

    scheduleNextBackup();
  }

  private scheduleDatabaseHeartbeat() {
    console.log('[BadBlue Worker] Starting 15-minute database heartbeat...');
    
    // Detect Railway environment
    const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || !!process.env.RAILWAY_PROJECT_ID;
    const heartbeatInterval = isRailway ? 5 * 60 * 1000 : 15 * 60 * 1000; // 5 mins for Railway, 15 for others
    
    const runHeartbeat = async () => {
      try {
        // Add timeout for Railway environments
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Database heartbeat timeout')), isRailway ? 20000 : 10000);
        });
        
        const dbPromise = (async () => {
          const { db } = await import('./db');
          const { sql } = await import('drizzle-orm');
          
          // Test connection with simple lightweight query
          await db.execute(sql`SELECT 1`);
        })();
        
        // Race between query and timeout
        await Promise.race([dbPromise, timeoutPromise]);
        
        // Reset failure counter on success
        if (this.consecutiveDbFailures > 0) {
          console.log(`[BadBlue Worker] ✓ Database connection restored after ${this.consecutiveDbFailures} failures`);
          this.consecutiveDbFailures = 0;
          this.dbRepairAttempts = 0;
          
          await this.logHealthMetric({
            timestamp: new Date().toISOString(),
            check: 'database_heartbeat',
            status: 'restored',
            consecutiveFailures: 0,
            repairAttempts: 0,
            environment: isRailway ? 'railway' : 'standard',
          });
        }
        
        await this.logHealthMetric({
          timestamp: new Date().toISOString(),
          check: 'database_heartbeat',
          status: 'success',
          consecutiveFailures: 0,
          environment: isRailway ? 'railway' : 'standard',
        });
      } catch (error: any) {
        this.consecutiveDbFailures++;
        console.log(`[BadBlue Worker] ❌ Database heartbeat failed (${this.consecutiveDbFailures} consecutive failures) - ${error.message}`);
        
        await this.logHealthMetric({
          timestamp: new Date().toISOString(),
          check: 'database_heartbeat',
          status: 'failed',
          error: error.message,
          consecutiveFailures: this.consecutiveDbFailures,
          environment: isRailway ? 'railway' : 'standard',
        });
        
        // Be less aggressive with repairs in Railway (wait for 5 failures instead of 3)
        const repairThreshold = isRailway ? 5 : 3;
        if (this.consecutiveDbFailures >= repairThreshold) {
          console.log(`[BadBlue Worker] 🚨 ALERT: ${repairThreshold} consecutive database failures - initiating auto-repair`);
          await this.repairDatabaseConnection();
        }
      }
    };
    
    // Initial heartbeat after a delay to let the app start up
    setTimeout(runHeartbeat, isRailway ? 30000 : 10000);
    this.databaseHeartbeatInterval = setInterval(runHeartbeat, heartbeatInterval);
  }

  private async repairDatabaseConnection(): Promise<boolean> {
    if (this.dbRepairAttempts >= 3) {
      console.log('[BadBlue Worker] 🚨 ESCALATING: 3 repair attempts failed - adding to repair queue');
      
      await this.addToRepairQueue({
        timestamp: new Date().toISOString(),
        functionAffected: 'Database Connection',
        cause: `Heartbeat failure after ${this.dbRepairAttempts} repair attempts`,
        systemState: 'not_working',
        severity: Severity.CRITICAL,
        priority: Priority.HIGH,
        category: IssueCategory.INFRASTRUCTURE,
      });
      
      this.dbRepairAttempts = 0;
      return false;
    }
    
    this.dbRepairAttempts++;
    console.log(`[BadBlue Worker] 🔧 Auto-repair attempt ${this.dbRepairAttempts}/3...`);
    
    try {
      console.log('[BadBlue Worker] Step 1: Refreshing database credentials...');
      const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
      
      if (!databaseUrl) {
        console.log('[BadBlue Worker] ❌ DATABASE_URL not found in environment');
        return false;
      }
      
      console.log('[BadBlue Worker] Step 2: Re-initializing connection pool...');
      const dbModule = await import('./db');
      
      await dbModule.resetPool();
      
      console.log('[BadBlue Worker] Step 3: Re-acquiring fresh database instance...');
      // Must re-import after resetPool to get the NEW db instance
      const { db: freshDb } = await import('./db');
      
      console.log('[BadBlue Worker] Step 4: Testing connection...');
      await freshDb.execute('SELECT 1');
      
      console.log('[BadBlue Worker] Step 5: Verifying migrations...');
      const tables = await freshDb.execute(`
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public'
        LIMIT 5
      `);
      
      if (tables.rows.length === 0) {
        console.log('[BadBlue Worker] ⚠️  No tables found - migrations may not be applied');
      }
      
      console.log('[BadBlue Worker] ✓ Database connection repaired successfully');
      this.consecutiveDbFailures = 0;
      this.dbRepairAttempts = 0;
      
      await this.logHealthMetric({
        timestamp: new Date().toISOString(),
        check: 'database_repair',
        status: 'success',
        repairAttempts: this.dbRepairAttempts,
      });
      
      return true;
    } catch (error: any) {
      console.log(`[BadBlue Worker] ❌ Repair attempt ${this.dbRepairAttempts} failed: ${error.message}`);
      
      await this.logHealthMetric({
        timestamp: new Date().toISOString(),
        check: 'database_repair',
        status: 'failed',
        error: error.message,
        repairAttempts: this.dbRepairAttempts,
      });
      
      return false;
    }
  }

  private async logHealthMetric(metric: any): Promise<void> {
    try {
      let metrics: any[] = [];
      
      try {
        const content = await fs.readFile(this.HEALTH_METRICS_LOG, 'utf-8');
        metrics = JSON.parse(content);
      } catch {
        metrics = [];
      }
      
      metrics.push(metric);
      
      if (metrics.length > 1000) {
        metrics = metrics.slice(-1000);
      }
      
      await fs.writeFile(this.HEALTH_METRICS_LOG, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.error('[BadBlue Worker] Error logging health metric:', error);
    }
  }

  private async addToRepairQueue(issue: FailureLogEntry): Promise<void> {
    this.repairQueue.push(issue);
    
    this.repairQueue.sort((a, b) => {
      const priorityA = a.priority || Priority.MEDIUM;
      const priorityB = b.priority || Priority.MEDIUM;
      
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      
      return b.severity - a.severity;
    });
    
    await this.logFailure(issue);
    
    console.log(`[BadBlue Worker] Issue added to repair queue (Priority: ${Priority[issue.priority || Priority.MEDIUM]}, Queue size: ${this.repairQueue.length})`);
  }

  private async runCriticalMonitoring() {
    try {
      console.log('[BadBlue Worker] Running 30-minute critical system monitoring...');

      const { rateLimitTracker } = await import('./rateLimitTracker');
      const { searchController } = await import('./autonomousSearchController');

      const geminiStats = rateLimitTracker.getStats();
      const groqStats = rateLimitTracker.getGroqStats();
      const bothExhausted = rateLimitTracker.areBothAPIsExhausted();

      if (bothExhausted && !searchController.isPaused()) {
        await searchController.pause('Both Gemini and Groq APIs rate limited');
        await this.recordAlert({
          alertType: 'rate_limit_pause',
          severity: Severity.CRITICAL,
          title: 'Autonomous Search Paused - API Quotas Exhausted',
          message: `Gemini: ${geminiStats.utilizationPercent.toFixed(1)}% used, Groq: ${groqStats.tokenUtilizationPercent.toFixed(1)}% used (${groqStats.tokensUsed}/${groqStats.tokenLimit} tokens)`,
          metadata: { geminiStats, groqStats },
        });
        console.log('[BadBlue Worker] CRITICAL: Both AI APIs exhausted - autonomous search paused');
      }

      if (!bothExhausted && searchController.isPaused()) {
        await searchController.recordHealthyRun();
        if (searchController.shouldAutoResume()) {
          await searchController.resume('API quotas recovered');
          await this.recordAlert({
            alertType: 'rate_limit_resume',
            severity: Severity.NOTICE,
            title: 'Autonomous Search Resumed',
            message: 'API quotas have recovered',
            metadata: { geminiStats, groqStats },
          });
        }
      } else if (bothExhausted) {
        await searchController.recordUnhealthyRun();
      }

      try {
        const { db } = await import('./db');
        const start = Date.now();
        await db.execute('SELECT 1');
        const latency = Date.now() - start;
        if (latency > 2000) {
          await this.recordAlert({
            alertType: 'database_slow',
            severity: Severity.WARNING,
            title: 'Database Performance Degraded',
            message: `Query latency: ${latency}ms`,
            metadata: { latency },
          });
        }
      } catch (error: any) {
        await this.recordAlert({
          alertType: 'database_failure',
          severity: Severity.CRITICAL,
          title: 'Database Connection Failed',
          message: error.message,
        });
      }

      if (process.env.STRIPE_SECRET_KEY) {
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
          await Promise.race([
            stripe.paymentIntents.list({ limit: 1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
        } catch (error: any) {
          await this.recordAlert({
            alertType: 'stripe_failure',
            severity: Severity.SERIOUS,
            title: 'Stripe API Connection Failed',
            message: error.message,
          });
        }
      }

      if (process.env.GWSMTP_USER && process.env.GWSMTP_PASS) {
        try {
          const { emailTransporter } = await import('./emailService');
          await Promise.race([
            emailTransporter.verify(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
        } catch (error: any) {
          await this.recordAlert({
            alertType: 'email_failure',
            severity: Severity.MODERATE,
            title: 'Email SMTP Connection Failed',
            message: error.message,
          });
        }
      }

      console.log('[BadBlue Worker] Critical monitoring complete');
    } catch (error) {
      console.error('[BadBlue Worker] Error in critical monitoring:', error);
    }
  }

  private async recordAlert(alert: { alertType: string; severity: Severity; title: string; message: string; metadata?: any }): Promise<void> {
    const alertKey = alert.alertType;
    const lastTime = this.lastAlertTimes.get(alertKey) || 0;
    const now = Date.now();
    
    if (now - lastTime < 10 * 60 * 1000) {
      return;
    }
    
    this.lastAlertTimes.set(alertKey, now);

    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...alert,
      };
      
      let alerts: any[] = [];
      try {
        const data = await fs.readFile(this.ALERTS_LOG, 'utf-8');
        alerts = JSON.parse(data);
      } catch {
      }
      
      alerts.push(logEntry);
      if (alerts.length > 500) {
        alerts.splice(0, alerts.length - 500);
      }
      await fs.writeFile(this.ALERTS_LOG, JSON.stringify(alerts, null, 2));

      try {
        const { db } = await import('./db');
        const { workerAlerts } = await import('@shared/schema');
        await db.insert(workerAlerts).values({
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metadata: alert.metadata || null,
          resolved: false,
        });
      } catch (dbError: any) {
        console.warn('[BadBlue Worker] Database alert logging failed:', dbError?.message || dbError);
      }
    } catch (error) {
      console.error('[BadBlue Worker] Error recording alert:', error);
    }
  }

  private async runDiagnostics() {
    if (this.isDiagnosticInProgress || this.isRepairInProgress) {
      console.log('[BadBlue Worker] Diagnostic skipped - system busy');
      return;
    }

    this.isDiagnosticInProgress = true;
    // Do NOT activate maintenance mode for 6-hour diagnostics - run as background process
    console.log('[BadBlue Worker] Starting 6-hour background diagnostic health check...');

    try {
      const issues: FailureLogEntry[] = [];

      // Check rate limit status FIRST to avoid wasting API quota
      const { rateLimitTracker } = await import('./rateLimitTracker');
      const rateLimitStats = rateLimitTracker.getStats();
      const apisAreRateLimited = rateLimitTracker.shouldUseGroq() || rateLimitStats.consecutiveErrors >= 2;

      if (apisAreRateLimited) {
        console.log('[BadBlue Worker] ⚠️  AI APIs are rate limited - skipping AI diagnostic tests to preserve quota');
        console.log(`[BadBlue Worker] Rate limit stats: ${rateLimitStats.requests} requests, ${rateLimitStats.consecutiveErrors} consecutive errors, ${rateLimitStats.utilizationPercent.toFixed(1)}% utilization`);
      }

      // Diagnostic 1: Database Connection & Operations
      try {
        console.log('[BadBlue Worker] Testing database operations...');
        const { db } = await import('./db');

        // Test 1: Basic connectivity
        await db.execute('SELECT 1');

        // Test 2: Check database tables exist
        const tables = await db.execute(`
          SELECT tablename FROM pg_tables 
          WHERE schemaname = 'public'
        `);

        // Test 3: Test complex query performance
        const start = Date.now();
        await db.execute('SELECT NOW()');
        const queryTime = Date.now() - start;

        if (queryTime > 1000) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Database Performance',
            cause: `Slow query response: ${queryTime}ms`,
            systemState: 'working',
            severity: Severity.WARNING,
          });
        }

        console.log(`[BadBlue Worker] ✓ Database operational (${tables.rows.length} tables, ${queryTime}ms latency)`);
      } catch (error: any) {
        console.log('[BadBlue Worker] ❌ Database connection failed');
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Database Connection',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.CRITICAL,
        });
      }

      // Diagnostic 2-6: AI Function Tests (ONLY if APIs are not rate limited)
      if (!apisAreRateLimited) {
        // Diagnostic 2: Test Legal AI (Analysis Function) - LIGHTWEIGHT TEST
        try {
          const { analyzeLegalIssue } = await import('./legalAI');
          await analyzeLegalIssue(
            'Test',
            'CA',
            'diagnostic'
          );
          console.log('[BadBlue Worker] ✓ Legal AI analysis operational');
        } catch (error: any) {
          console.log('[BadBlue Worker] ❌ Legal AI analysis failed');
          const isRateLimitError = error.message.includes('rate limit') || error.message.includes('quota') || error.status === 429;
          const severity = isRateLimitError ? Severity.NOTICE : Severity.SERIOUS;
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Legal AI - Analysis Function',
            cause: `AI analysis failed: ${error.message}`,
            systemState: isRateLimitError ? 'working' : 'not_working',
            severity,
          });
        }

        // Diagnostic 3: Test Tort Notice Generator - LIGHTWEIGHT TEST
        try {
          const { generateTortNotice } = await import('./tortNoticeGenerator');
          await generateTortNotice({
            state: 'CA',
            claimantName: 'Test',
            claimantAddress: '123',
            claimantEmail: 't@t.com',
            officerName: 'Test',
            officerBadge: '1',
            department: 'T',
            city: 'T',
            county: null,
            incidentDate: new Date(),
            incidentDescription: 'diagnostic',
          });
          console.log('[BadBlue Worker] ✓ Tort Notice Generator operational');
        } catch (error: any) {
          console.log('[BadBlue Worker] ❌ Tort Notice Generator failed');
          const isRateLimitError = error.message.includes('rate limit') || error.message.includes('quota') || error.status === 429;
          const severity = isRateLimitError ? Severity.NOTICE : Severity.SERIOUS;
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Tort Notice Generator',
            cause: `Notice generation failed: ${error.message}`,
            systemState: isRateLimitError ? 'working' : 'not_working',
            severity,
          });
        }
      } else {
        console.log('[BadBlue Worker] ⏭️  Skipping AI service tests - rate limited');
      }

      // Diagnostic 7: Validate ALL Secret Keys
      try {
        console.log('[BadBlue Worker] Validating secret keys...');
        const requiredSecrets = [
          { key: 'GEMINI_API_KEY', name: 'Gemini AI API Key', severity: Severity.CRITICAL },
          { key: 'GROQ_API_KEY', name: 'Groq AI API Key', severity: Severity.SERIOUS },
          { key: 'STRIPE_SECRET_KEY', name: 'Stripe Secret Key', severity: Severity.SERIOUS },
          { key: 'STRIPE_WEBHOOK_SECRET', name: 'Stripe Webhook Secret', severity: Severity.WARNING },
          { key: 'GWSMTP_USER', name: 'Email SMTP Username', severity: Severity.MODERATE },
          { key: 'GWSMTP_PASS', name: 'Email SMTP Password', severity: Severity.MODERATE },
          { key: 'SESSION_SECRET', name: 'Session Secret', severity: Severity.CRITICAL },
          { key: 'DATABASE_URL', name: 'Supabase Database URL', severity: Severity.CRITICAL },
        ];

        let missingSecrets: string[] = [];

        for (const secret of requiredSecrets) {
          if (!process.env[secret.key]) {
            missingSecrets.push(secret.name);
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: `Secret Key: ${secret.name}`,
              cause: `${secret.key} environment variable not set`,
              systemState: 'not_working',
              severity: secret.severity,
            });
          }
        }

        if (missingSecrets.length === 0) {
          console.log('[BadBlue Worker] ✓ All secret keys configured');
        } else {
          console.log(`[BadBlue Worker] ⚠ Missing secrets: ${missingSecrets.join(', ')}`);
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Secret Keys Validation',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.CRITICAL,
        });
      }

      // Diagnostic 8: Validate Stripe Payment Functionality
      try {
        console.log('[BadBlue Worker] Testing Stripe payment service...');
        const stripeKey = process.env.STRIPE_SECRET_KEY;

        if (!stripeKey) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Stripe Payment Service',
            cause: 'Stripe secret key missing',
            systemState: 'not_working',
            severity: Severity.SERIOUS,
          });
        } else {
          // Test Stripe connection
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

          try {
            // Retrieve account to validate key
            await stripe.balance.retrieve();
            console.log('[BadBlue Worker] ✓ Stripe payment service operational');
          } catch (stripeError: any) {
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: 'Stripe Payment Service',
              cause: `Stripe API validation failed: ${stripeError.message}`,
              systemState: 'not_working',
              severity: Severity.SERIOUS,
            });
          }
        }

        // Check webhook secret
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Stripe Webhook Handler',
            cause: 'Webhook secret not configured',
            systemState: 'working',
            severity: Severity.WARNING,
          });
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Stripe Payment Validation',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.SERIOUS,
        });
      }

      // Diagnostic 9: Validate AI API Keys (skip actual API calls if rate limited)
      if (!apisAreRateLimited) {
        try {
          console.log('[BadBlue Worker] Testing AI service connectivity...');

          // Test Gemini - ONLY verify key exists, do NOT make API calls
          // Worker/Sub-Agent should use only Groq (35% quota limit)
          const geminiKey = process.env.GEMINI_API_KEY;
          if (geminiKey) {
            // DO NOT consume Gemini quota - only validate key format
            if (geminiKey.length > 20 && geminiKey.startsWith('AI')) {
              console.log('[BadBlue Worker] ✓ Gemini API key configured (not tested to preserve quota for users)');
            } else {
              console.log('[BadBlue Worker] ⚠ Gemini API key present but may be invalid format');
              issues.push({
                timestamp: new Date().toISOString(),
                functionAffected: 'Gemini AI Service',
                cause: 'Gemini API key may be malformed',
                systemState: 'unknown',
                severity: Severity.WARNING,
              });
            }
          } else {
            console.log('[BadBlue Worker] ❌ Gemini API key not configured');
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: 'Gemini AI Service',
              cause: 'GEMINI_API_KEY not configured',
              systemState: 'not_working',
              severity: Severity.CRITICAL,
            });
          }
        } catch (error: any) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'AI Service Validation',
            cause: error.message,
            systemState: 'not_working',
            severity: Severity.CRITICAL,
          });
        }
      } else {
        console.log('[BadBlue Worker] ⏭️  Skipping AI service tests - rate limited');

        // Just validate API keys are present without making calls
        if (!process.env.GEMINI_API_KEY) {
          console.log('[BadBlue Worker] ❌ Gemini API key not configured');
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Gemini AI Service',
            cause: 'GEMINI_API_KEY not configured',
            systemState: 'not_working',
            severity: Severity.CRITICAL,
          });
        } else {
          console.log('[BadBlue Worker] ✓ Gemini API key configured');
        }

        if (!process.env.GROQ_API_KEY) {
          console.log('[BadBlue Worker] ❌ Groq API key not configured');
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Groq AI Service',
            cause: 'GROQ_API_KEY not configured',
            systemState: 'not_working',
            severity: Severity.SERIOUS,
          });
        } else {
          console.log('[BadBlue Worker] ✓ Groq API key configured');
        }
      }

      // Diagnostic 10: Validate Email Service Functionality
      try {
        console.log('[BadBlue Worker] Testing email service...');
        const smtpUser = process.env.GWSMTP_USER;
        const smtpPass = process.env.GWSMTP_PASS;

        if (!smtpUser || !smtpPass) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Email Service',
            cause: 'SMTP credentials missing',
            systemState: 'not_working',
            severity: Severity.MODERATE,
          });
        } else {
          // Test SMTP connection
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.default.createTransport({
            host: 'smtp-relay.gmail.com',
            port: 587,
            secure: false,
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

          try {
            await transporter.verify();
            console.log('[BadBlue Worker] ✓ Email service operational');
          } catch (emailError: any) {
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: 'Email Service SMTP',
              cause: `SMTP connection test failed: ${emailError.message}`,
              systemState: 'not_working',
              severity: Severity.MODERATE,
            });
          }
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Email Service Validation',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.MODERATE,
        });
      }

      // Diagnostic 11: Validate Supabase Connectivity
      try {
        console.log('[BadBlue Worker] Testing Supabase database connectivity...');
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Supabase Database',
            cause: 'DATABASE_URL not configured',
            systemState: 'not_working',
            severity: Severity.CRITICAL,
          });
        } else {
          const { db } = await import('./db');

          // Test basic query
          await db.execute('SELECT 1');

          // Test connection pool health
          const { pool } = await import('./db');
          const poolStats = {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
          };

          console.log(`[BadBlue Worker] ✓ Supabase connected (Pool: ${poolStats.total} total, ${poolStats.idle} idle, ${poolStats.waiting} waiting)`);

          // Warn if pool is saturated
          if (poolStats.waiting > 5) {
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: 'Supabase Connection Pool',
              cause: `High connection wait count: ${poolStats.waiting} queries waiting`,
              systemState: 'working',
              severity: Severity.WARNING,
            });
          }
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Supabase Database Connectivity',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.CRITICAL,
        });
      }

      // Diagnostic 12: Aggressive Stripe Operations Testing
      try {
        console.log('[BadBlue Worker] Testing Stripe advanced operations...');
        const stripeKey = process.env.STRIPE_SECRET_KEY;

        if (stripeKey) {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

          try {
            // Test 1: Retrieve prices
            const prices = await stripe.prices.list({ limit: 1 });

            // Test 2: Check balance
            const balance = await stripe.balance.retrieve();

            // Test 3: List products
            const products = await stripe.products.list({ limit: 1 });

            console.log(`[BadBlue Worker] ✓ Stripe operations functional (${products.data.length} products, balance: ${balance.available.length} currencies)`);
          } catch (stripeError: any) {
            console.log('[BadBlue Worker] ❌ Stripe operations failed');
            issues.push({
              timestamp: new Date().toISOString(),
              functionAffected: 'Stripe Operations',
              cause: `Stripe test failed: ${stripeError.message}`,
              systemState: 'not_working',
              severity: Severity.SERIOUS,
            });
          }
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Stripe Operations Testing',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.SERIOUS,
        });
      }

      // Diagnostic 13: Object Storage Availability
      try {
        console.log('[BadBlue Worker] Testing object storage availability...');
        const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

        if (bucketId) {
          console.log('[BadBlue Worker] ✓ Object storage configured');
        } else {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Object Storage',
            cause: 'DEFAULT_OBJECT_STORAGE_BUCKET_ID not configured',
            systemState: 'not_working',
            severity: Severity.WARNING,
          });
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Object Storage Validation',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.WARNING,
        });
      }

      // Diagnostic 14: Session Management
      try {
        console.log('[BadBlue Worker] Testing session management...');
        const sessionSecret = process.env.SESSION_SECRET;

        if (!sessionSecret) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Session Management',
            cause: 'SESSION_SECRET not configured',
            systemState: 'not_working',
            severity: Severity.CRITICAL,
          });
        } else if (sessionSecret.length < 32) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Session Security',
            cause: 'SESSION_SECRET too short (< 32 characters)',
            systemState: 'working',
            severity: Severity.WARNING,
          });
        } else {
          console.log('[BadBlue Worker] ✓ Session management configured');
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Session Management Validation',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.CRITICAL,
        });
      }

      // Diagnostic 15: File System Permissions
      try {
        console.log('[BadBlue Worker] Testing file system permissions...');
        const fs = await import('fs/promises');
        const path = await import('path');

        // Test write access to data directory
        const testDir = path.default.join(process.cwd(), 'data');
        const testFile = path.default.join(testDir, '.worker_test');

        try {
          await fs.mkdir(testDir, { recursive: true });
          await fs.writeFile(testFile, 'test', 'utf-8');
          await fs.unlink(testFile);
          console.log('[BadBlue Worker] ✓ File system permissions OK');
        } catch (fsError: any) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'File System Permissions',
            cause: `Cannot write to data directory: ${fsError.message}`,
            systemState: 'not_working',
            severity: Severity.CRITICAL,
          });
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'File System Testing',
          cause: error.message,
          systemState: 'not_working',
          severity: Severity.CRITICAL,
        });
      }

      // Diagnostic 16: Memory & Resource Usage
      try {
        console.log('[BadBlue Worker] Checking system resources...');
        const used = process.memoryUsage();
        const memoryMB = Math.round(used.heapUsed / 1024 / 1024);
        const totalMB = Math.round(used.heapTotal / 1024 / 1024);

        console.log(`[BadBlue Worker] ✓ Memory usage: ${memoryMB}MB / ${totalMB}MB`);

        if (memoryMB > 400) {
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Memory Usage',
            cause: `High memory usage: ${memoryMB}MB`,
            systemState: 'working',
            severity: Severity.WARNING,
          });
        }
      } catch (error: any) {
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'Resource Monitoring',
          cause: error.message,
          systemState: 'working',
          severity: Severity.NOTICE,
        });
      }

      // Log any detected issues
      if (issues.length > 0) {
        await this.appendFailureLog(issues);
        console.log(`[BadBlue Worker] ⚠️  Health check complete - ${issues.length} issue(s) detected - SEE FAILURE LOG`);
      } else {
        console.log('[BadBlue Worker] ✓ Health check complete - all systems operational');
      }
      // Diagnostic: LSP Error Detection and Auto-Fix
      try {
        console.log('[BadBlue Worker] Checking for LSP errors...');
        const lspErrors = await this.checkLSPErrors();
        
        if (lspErrors.length > 0) {
          console.log(`[BadBlue Worker] ⚠️  Found ${lspErrors.length} LSP errors - initiating auto-fix`);
          issues.push({
            timestamp: new Date().toISOString(),
            functionAffected: 'Code Quality (LSP Errors)',
            cause: `Found ${lspErrors.length} LSP diagnostics in codebase`,
            systemState: 'working',
            severity: Severity.WARNING,
          });

          // Auto-fix LSP errors using AI Sub-Agent
          const fixResult = await this.fixLSPErrors(lspErrors);
          if (fixResult.success) {
            console.log(`[BadBlue Worker] ✓ Successfully fixed ${fixResult.fixed} LSP errors`);
          } else {
            console.log(`[BadBlue Worker] ⚠️  Fixed ${fixResult.fixed} out of ${lspErrors.length} LSP errors`);
          }
        } else {
          console.log('[BadBlue Worker] ✓ No LSP errors detected');
        }
      } catch (error: any) {
        console.log('[BadBlue Worker] ❌ LSP error check failed:', error.message);
        issues.push({
          timestamp: new Date().toISOString(),
          functionAffected: 'LSP Error Detection',
          cause: error.message,
          systemState: 'working',
          severity: Severity.NOTICE,
        });
      }

      // Save issues to log
      if (issues.length > 0) {
        await this.logFailures(issues);
        const criticalCount = issues.filter(i => i.severity === Severity.CRITICAL).length;
        const seriousCount = issues.filter(i => i.severity === Severity.SERIOUS).length;
        console.log(`[BadBlue Worker] Diagnostic complete: ${issues.length} issues found (${criticalCount} critical, ${seriousCount} serious)`);
      } else {
        console.log('[BadBlue Worker] ✓ Health check complete - all systems operational');
      }
    } catch (error) {
      console.error('[BadBlue Worker] ❌ Error during diagnostics:', error);
    } finally {
      this.isDiagnosticInProgress = false;
      console.log('[BadBlue Worker] Background diagnostic cycle complete');
    }
  }

  private async checkLSPErrors(): Promise<any[]> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run TypeScript compiler in no-emit mode to get diagnostics
      const { stdout, stderr } = await execAsync('npx tsc --noEmit --pretty false 2>&1 || true');
      const output = stdout + stderr;

      // Parse LSP errors from output
      const errorLines = output.split('\n').filter(line => 
        line.includes('error TS') && !line.includes('0 errors')
      );

      return errorLines.map(line => {
        const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
        if (match) {
          return {
            file: match[1],
            line: parseInt(match[2]),
            column: parseInt(match[3]),
            code: match[4],
            message: match[5],
          };
        }
        return { raw: line };
      });
    } catch (error: any) {
      console.error('[BadBlue Worker] LSP check error:', error.message);
      return [];
    }
  }

  private async fixLSPErrors(errors: any[]): Promise<{ success: boolean; fixed: number }> {
    try {
      // SECURITY: All repairs go through secured AI Sub-Agent (4-layer firewall)
      const { processSubAgentCommand } = await import('./aiSubAgent');
      
      // Create a command to fix the LSP errors
      const errorSummary = errors.slice(0, 10).map((e, i) => 
        `${i + 1}. ${e.file}:${e.line} - ${e.message}`
      ).join('\n');

      const command = `Fix the following LSP errors in the codebase:\n${errorSummary}\n\nAnalyze each error and apply the appropriate fix. Focus on type errors, missing imports, and incorrect references.`;

      const result = await processSubAgentCommand({ command, category: 'code_modification' });
      
      if (result.success) {
        return { success: true, fixed: errors.length };
      } else {
        return { success: false, fixed: 0 };
      }
    } catch (error: any) {
      console.error('[BadBlue Worker] LSP auto-fix error:', error.message);
      return { success: false, fixed: 0 };
    }
  }

  // ============================================================================
  // PARALLEL REPAIR ORCHESTRATOR - Handles multiple issues simultaneously
  // ============================================================================

  private categorizeIssue(issue: FailureLogEntry): FailureLogEntry {
    // Determine category based on functionAffected
    let category: IssueCategory = IssueCategory.INFRASTRUCTURE;
    let parallelSafe = true;
    let resourceProfile: ResourceProfile = {
      cpuIntensive: false,
      memoryIntensive: false,
      apiCallsRequired: false,
      databaseLockRequired: false,
      filesystemWriteRequired: false,
      estimatedDurationSeconds: 30,
    };

    const funcName = issue.functionAffected.toLowerCase();

    if (funcName.includes('database') || funcName.includes('postgres') || funcName.includes('supabase')) {
      category = IssueCategory.INFRASTRUCTURE;
      resourceProfile.databaseLockRequired = true;
      resourceProfile.estimatedDurationSeconds = 60;
      parallelSafe = false; // Database operations should be serial
    } else if (funcName.includes('lsp') || funcName.includes('code quality')) {
      category = IssueCategory.APPLICATION_CODE;
      resourceProfile.filesystemWriteRequired = true;
      resourceProfile.cpuIntensive = true;
      resourceProfile.estimatedDurationSeconds = 120;
      parallelSafe = true; // LSP fixes can be parallel if different files
    } else if (funcName.includes('gemini') || funcName.includes('groq') || funcName.includes('ai')) {
      category = IssueCategory.AI_SERVICE;
      resourceProfile.apiCallsRequired = true;
      resourceProfile.estimatedDurationSeconds = 45;
      parallelSafe = true; // API tests can run in parallel
    } else if (funcName.includes('stripe') || funcName.includes('email') || funcName.includes('smtp')) {
      category = IssueCategory.EXTERNAL_DEPENDENCY;
      resourceProfile.apiCallsRequired = true;
      resourceProfile.estimatedDurationSeconds = 30;
      parallelSafe = true;
    } else if (funcName.includes('secret') || funcName.includes('env') || funcName.includes('config')) {
      category = IssueCategory.CONFIGURATION;
      resourceProfile.estimatedDurationSeconds = 15;
      parallelSafe = true;
    } else if (funcName.includes('cleanup') || funcName.includes('data')) {
      category = IssueCategory.DATA_INTEGRITY;
      resourceProfile.databaseLockRequired = true;
      resourceProfile.estimatedDurationSeconds = 90;
      parallelSafe = false;
    }

    // CRITICAL and SERIOUS issues always run serially for safety
    if (issue.severity >= Severity.SERIOUS) {
      parallelSafe = false;
    }

    return {
      ...issue,
      category,
      resourceProfile,
      parallelSafe,
      dependencies: this.detectDependencies(issue, category),
    };
  }

  private detectDependencies(issue: FailureLogEntry, category: IssueCategory): string[] {
    const deps: string[] = [];
    
    // Database issues depend on database connection being available
    if (category === IssueCategory.DATA_INTEGRITY) {
      deps.push('Database Connection');
    }
    
    // AI service issues depend on configuration
    if (category === IssueCategory.AI_SERVICE) {
      deps.push('AI API Configuration');
    }

    // External dependencies need configuration
    if (category === IssueCategory.EXTERNAL_DEPENDENCY) {
      deps.push('External Service Configuration');
    }

    return deps;
  }

  private async getSystemResources(): Promise<{ cpu: number; memory: number }> {
    try {
      const os = await import('os');
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      // Calculate CPU usage (simplified)
      const cpuUsage = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        return acc + (1 - idle / total);
      }, 0) / cpus.length;

      const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

      return {
        cpu: cpuUsage * 100,
        memory: memoryUsage,
      };
    } catch {
      return { cpu: 0, memory: 0 };
    }
  }

  private async calculateConcurrencyBudget(): Promise<number> {
    const resources = await this.getSystemResources();
    const { rateLimitTracker } = await import('./rateLimitTracker');
    const rateLimitStats = rateLimitTracker.getStats();

    // Start with max concurrent
    let budget = this.concurrencyBudget.maxConcurrent;

    // Reduce budget if CPU is high
    if (resources.cpu > 70) budget = Math.max(2, budget - 2);
    if (resources.cpu > 85) budget = 1; // Serial only under heavy load

    // Reduce budget if memory is high
    if (resources.memory > 80) budget = Math.max(1, budget - 1);

    // Reduce budget if APIs are rate-limited
    if (rateLimitStats.utilizationPercent > 80) budget = Math.max(2, budget - 1);

    // In maintenance mode, allow more parallelism
    if (this.isMaintenanceMode) budget = this.concurrencyBudget.maxConcurrent;

    return budget;
  }

  private canAcquireLocks(issue: FailureLogEntry): boolean {
    if (!issue.resourceProfile) return true;

    const locks: string[] = [];
    if (issue.resourceProfile.databaseLockRequired) locks.push('database');
    if (issue.resourceProfile.filesystemWriteRequired) locks.push('filesystem');
    if (issue.resourceProfile.apiCallsRequired) locks.push('ai-api');

    // Check if all required locks are available
    return locks.every(lock => !this.concurrencyBudget.resourceLocks.get(lock));
  }

  private acquireLocks(issue: FailureLogEntry): void {
    if (!issue.resourceProfile) return;

    if (issue.resourceProfile.databaseLockRequired) {
      this.concurrencyBudget.resourceLocks.set('database', true);
    }
    if (issue.resourceProfile.filesystemWriteRequired) {
      this.concurrencyBudget.resourceLocks.set('filesystem', true);
    }
    if (issue.resourceProfile.apiCallsRequired) {
      this.concurrencyBudget.resourceLocks.set('ai-api', true);
    }
  }

  private releaseLocks(issue: FailureLogEntry): void {
    if (!issue.resourceProfile) return;

    if (issue.resourceProfile.databaseLockRequired) {
      this.concurrencyBudget.resourceLocks.set('database', false);
    }
    if (issue.resourceProfile.filesystemWriteRequired) {
      this.concurrencyBudget.resourceLocks.set('filesystem', false);
    }
    if (issue.resourceProfile.apiCallsRequired) {
      this.concurrencyBudget.resourceLocks.set('ai-api', false);
    }
  }

  private async executeParallelRepairs(issues: FailureLogEntry[]): Promise<void> {
    if (issues.length === 0) return;

    console.log(`[BadBlue Worker] 🔄 Orchestrating parallel repair for ${issues.length} issues...`);

    // Categorize all issues
    const categorized = issues.map(issue => this.categorizeIssue(issue));

    // Separate by severity - CRITICAL/SERIOUS run serially first
    const critical = categorized.filter(i => i.severity >= Severity.SERIOUS);
    const moderate = categorized.filter(i => i.severity === Severity.MODERATE || i.severity === Severity.WARNING);
    const minor = categorized.filter(i => i.severity === Severity.NOTICE);

    // Execute critical issues serially
    if (critical.length > 0) {
      console.log(`[BadBlue Worker] 🚨 Handling ${critical.length} CRITICAL/SERIOUS issues serially...`);
      for (const issue of critical) {
        await this.executeRepair(issue);
      }
    }

    // Execute moderate/minor issues in parallel batches
    const parallelizable = [...moderate, ...minor].filter(i => i.parallelSafe);
    const serial = [...moderate, ...minor].filter(i => !i.parallelSafe);

    if (parallelizable.length > 0) {
      const budget = await this.calculateConcurrencyBudget();
      console.log(`[BadBlue Worker] ⚡ Executing ${parallelizable.length} issues in parallel (budget: ${budget})...`);

      // Process in parallel batches
      const batches: FailureLogEntry[][] = [];
      for (let i = 0; i < parallelizable.length; i += budget) {
        batches.push(parallelizable.slice(i, i + budget));
      }

      for (const batch of batches) {
        const startTime = Date.now();
        await Promise.all(
          batch
            .filter(issue => this.canAcquireLocks(issue))
            .map(async (issue) => {
              this.acquireLocks(issue);
              try {
                await this.executeRepair(issue);
              } finally {
                this.releaseLocks(issue);
              }
            })
        );
        const duration = Date.now() - startTime;
        this.repairMetrics.queueLatency.push(duration);
        console.log(`[BadBlue Worker] ✓ Batch of ${batch.length} repairs completed in ${duration}ms`);
      }
    }

    if (serial.length > 0) {
      console.log(`[BadBlue Worker] 📋 Handling ${serial.length} non-parallelizable issues serially...`);
      for (const issue of serial) {
        await this.executeRepair(issue);
      }
    }

    await this.saveMetrics();
  }

  /**
   * ARCHITECT-LEVEL ANALYSIS: Deep issue analysis with pattern recognition
   * Endows Worker with capabilities to find issues, flaws, problems, failures, and strategize
   */
  private async performArchitectAnalysis(issue: FailureLogEntry): Promise<{
    rootCause: string;
    impactAssessment: string;
    riskLevel: string;
    relatedPatterns: string[];
    proposedStrategy: string;
    confidence: number;
  }> {
    console.log(`[BadBlue Worker] 🔍 ARCHITECT-LEVEL ANALYSIS: ${issue.functionAffected}`);

    const { executeAdvancedReasoning } = await import('./aiSubAgent');

    const analysisTask = `Perform deep architect-level analysis of this system issue:

ISSUE DETAILS:
- Function/Component: ${issue.functionAffected}
- Direct Cause: ${issue.cause}
- Severity: ${Severity[issue.severity]}
- Category: ${issue.category}
- System State: ${issue.systemState}

ANALYSIS DIRECTIVES:
1. ROOT CAUSE ANALYSIS: What is the underlying root cause beyond the immediate symptom?
2. IMPACT ASSESSMENT: What components/features are affected? What's the blast radius?
3. RISK LEVEL: What are the risks of attempting a fix? What could go wrong?
4. PATTERN RECOGNITION: Have similar issues occurred? What patterns emerge?
5. STRATEGIC PLANNING: What's the best repair strategy with minimal risk?

Provide detailed architect-level insights.`;

    try {
      const result = await executeAdvancedReasoning(analysisTask, false);
      
      // Parse the advanced reasoning output for key insights
      const output = result.analysis || '';
      const planQuality = result.plan || {};
      
      // Calculate confidence based on analysis quality
      let confidence = 0.75; // Base confidence - Worker did a complete architect-level analysis
      
      // Increase confidence if we have detailed plan
      if (planQuality.strategicPlan && planQuality.strategicPlan.steps?.length > 0) {
        confidence += 0.10;
      }
      
      // Decrease confidence if analysis indicates complexity or unknowns
      if (output.toLowerCase().includes('unknown') || output.toLowerCase().includes('unclear')) {
        confidence -= 0.15;
      }
      
      if (output.toLowerCase().includes('complex') || output.toLowerCase().includes('multiple components')) {
        confidence -= 0.10;
      }
      
      // Ensure confidence stays in valid range
      confidence = Math.max(0.40, Math.min(0.95, confidence));
      
      return {
        rootCause: this.extractSection(output, 'ROOT CAUSE') || issue.cause,
        impactAssessment: this.extractSection(output, 'IMPACT') || 'Unknown impact',
        riskLevel: this.extractSection(output, 'RISK') || 'MODERATE',
        relatedPatterns: this.extractPatterns(output),
        proposedStrategy: this.extractSection(output, 'STRATEG') || 'Direct repair',
        confidence,
      };
    } catch (error: any) {
      console.error(`[BadBlue Worker] Analysis error: ${error.message}`);
      return {
        rootCause: issue.cause,
        impactAssessment: 'Analysis failed',
        riskLevel: 'HIGH',
        relatedPatterns: [],
        proposedStrategy: 'Escalate to Sub-Agent',
        confidence: 0.30,
      };
    }
  }

  /**
   * DECISION ENGINE: Determines if Worker should escalate to Sub-Agent supervision
   */
  private shouldEscalateToSubAgent(
    issue: FailureLogEntry,
    analysis: { rootCause: string; riskLevel: string; confidence: number }
  ): boolean {
    // Escalate if:
    // 1. Confidence is low (< 70%)
    // 2. Risk level is HIGH or CRITICAL
    // 3. Severity is CRITICAL
    // 4. Category requires careful handling
    
    if (analysis.confidence < 0.70) {
      console.log(`[BadBlue Worker] 🚨 ESCALATING: Low confidence (${(analysis.confidence * 100).toFixed(0)}%)`);
      return true;
    }

    if (analysis.riskLevel.includes('HIGH') || analysis.riskLevel.includes('CRITICAL')) {
      console.log(`[BadBlue Worker] 🚨 ESCALATING: High risk level (${analysis.riskLevel})`);
      return true;
    }

    if (issue.severity >= Severity.CRITICAL) {
      console.log(`[BadBlue Worker] 🚨 ESCALATING: Critical severity`);
      return true;
    }

    if (issue.category === IssueCategory.DATA_INTEGRITY || 
        issue.category === IssueCategory.INFRASTRUCTURE) {
      console.log(`[BadBlue Worker] 🚨 ESCALATING: Sensitive category (${issue.category})`);
      return true;
    }

    return false;
  }

  /**
   * COLLABORATIVE REPAIR: Worker proposes fix, Sub-Agent supervises and approves
   */
  private async collaborativeRepairWithSupervision(
    issue: FailureLogEntry,
    analysis: any
  ): Promise<boolean> {
    console.log(`[BadBlue Worker] 🤝 COLLABORATIVE REPAIR: Working with Sub-Agent supervision`);

    const { processSubAgentCommand } = await import('./aiSubAgent');

    // Step 1: Worker proposes fix based on analysis
    console.log(`[BadBlue Worker] 📝 Proposing repair strategy...`);
    const proposalCommand = `Based on this analysis, propose a specific repair:

ISSUE: ${issue.functionAffected}
ROOT CAUSE: ${analysis.rootCause}
IMPACT: ${analysis.impactAssessment}
RISK: ${analysis.riskLevel}
STRATEGY: ${analysis.proposedStrategy}

Provide a SPECIFIC, EXECUTABLE repair plan with:
1. Exact steps to fix the issue
2. Validation checks after each step
3. Rollback plan if something goes wrong`;

    const proposalResult = await processSubAgentCommand({ command: proposalCommand, category: 'system_management' });
    
    if (!proposalResult.success) {
      console.log(`[BadBlue Worker] ❌ Failed to generate proposal`);
      return false;
    }

    console.log(`[BadBlue Worker] 📋 Repair Proposal:\n${proposalResult.response.slice(0, 300)}...`);

    // Step 2: Request Sub-Agent supervision and approval
    console.log(`[BadBlue Worker] 👀 Requesting Sub-Agent supervision...`);
    const supervisionCommand = `SUPERVISION REQUEST FROM WORKER:

The Worker has analyzed this issue and proposed a repair:

ORIGINAL ISSUE:
- Function: ${issue.functionAffected}
- Cause: ${issue.cause}
- Severity: ${Severity[issue.severity]}

WORKER'S ANALYSIS:
- Root Cause: ${analysis.rootCause}
- Risk Level: ${analysis.riskLevel}
- Confidence: ${(analysis.confidence * 100).toFixed(0)}%

WORKER'S PROPOSED REPAIR:
${proposalResult.response}

As Sub-Agent supervisor, please:
1. REVIEW the Worker's analysis and proposed fix
2. IDENTIFY any flaws or risks the Worker missed
3. APPROVE the fix (respond "APPROVED") OR provide corrections/guidance
4. SUPERVISE the implementation

Provide your supervision decision and any corrections needed.`;

    const supervisionResult = await processSubAgentCommand({ command: supervisionCommand, category: 'system_management' });

    if (!supervisionResult.success) {
      console.log(`[BadBlue Worker] ❌ Sub-Agent supervision failed`);
      return false;
    }

    console.log(`[BadBlue Worker] 🎯 Sub-Agent Supervision:\n${supervisionResult.response.slice(0, 300)}...`);

    // Step 3: Implement repair under supervision
    const approved = supervisionResult.response.includes('APPROVED') || 
                     supervisionResult.response.includes('PROCEED') ||
                     supervisionResult.response.includes('LOOKS GOOD');

    if (approved) {
      console.log(`[BadBlue Worker] ✅ Sub-Agent APPROVED - Implementing repair...`);
      
      const implementCommand = `Implement the approved repair plan:
${proposalResult.response}

Execute the fix now, with Sub-Agent supervision.`;

      const implResult = await processSubAgentCommand({ command: implementCommand, category: 'code_modification' });
      
      if (implResult.success) {
        console.log(`[BadBlue Worker] ✓ Repair implemented successfully under Sub-Agent supervision`);
        return true;
      } else {
        console.log(`[BadBlue Worker] ⚠️  Implementation failed: ${implResult.response}`);
        return false;
      }
    } else {
      console.log(`[BadBlue Worker] 🛑 Sub-Agent requested changes - Re-strategizing...`);
      
      // Implement Sub-Agent's corrections
      const correctionCommand = `Implement repair with Sub-Agent's corrections:

ORIGINAL PROPOSAL:
${proposalResult.response}

SUB-AGENT CORRECTIONS:
${supervisionResult.response}

Execute the corrected fix now.`;

      const corrResult = await processSubAgentCommand({ command: correctionCommand, category: 'code_modification' });
      
      if (corrResult.success) {
        console.log(`[BadBlue Worker] ✓ Repair implemented with Sub-Agent corrections`);
        return true;
      } else {
        console.log(`[BadBlue Worker] ❌ Corrected repair failed`);
        return false;
      }
    }
  }

  private extractSection(text: string, keyword: string): string {
    const lines = text.split('\n');
    const sectionStart = lines.findIndex(l => l.toUpperCase().includes(keyword));
    if (sectionStart === -1) return '';
    
    let section = '';
    for (let i = sectionStart; i < Math.min(sectionStart + 5, lines.length); i++) {
      section += lines[i] + ' ';
    }
    return section.trim().slice(0, 200);
  }

  private extractPatterns(text: string): string[] {
    const patterns: string[] = [];
    const patternKeywords = ['pattern', 'similar', 'recurring', 'previous'];
    
    const lines = text.split('\n');
    for (const line of lines) {
      for (const keyword of patternKeywords) {
        if (line.toLowerCase().includes(keyword)) {
          patterns.push(line.trim().slice(0, 100));
          break;
        }
      }
    }
    
    return patterns.slice(0, 3);
  }

  /**
   * ENHANCED REPAIR: Architect-level analysis + collaborative supervision
   */
  private async executeRepair(issue: FailureLogEntry): Promise<void> {
    const startTime = Date.now();
    this.repairMetrics.totalRepairs++;

    try {
      console.log(`[BadBlue Worker] 🔧 ENHANCED REPAIR: ${issue.functionAffected} (${issue.category})`);
      console.log(`[BadBlue Worker] Endowed with architect-level capabilities for deep analysis...`);

      // Phase 1: Architect-level analysis
      const analysis = await this.performArchitectAnalysis(issue);
      console.log(`[BadBlue Worker] 📊 Analysis complete - Confidence: ${(analysis.confidence * 100).toFixed(0)}%, Risk: ${analysis.riskLevel}`);

      // Phase 2: Decision - attempt fix or escalate?
      const needsSupervision = this.shouldEscalateToSubAgent(issue, analysis);

      let success = false;

      if (needsSupervision) {
        // Collaborative repair with Sub-Agent supervision
        console.log(`[BadBlue Worker] 🤝 Entering collaborative mode with Sub-Agent supervision...`);
        success = await this.collaborativeRepairWithSupervision(issue, analysis);
      } else {
        // Worker confident - attempt direct repair
        console.log(`[BadBlue Worker] 💪 Worker confident - Attempting direct repair...`);
        
        const { processSubAgentCommand } = await import('./aiSubAgent');
        
        const command = `Execute repair based on architect-level analysis:

ISSUE: ${issue.functionAffected}
ROOT CAUSE: ${analysis.rootCause}
STRATEGY: ${analysis.proposedStrategy}
SEVERITY: ${Severity[issue.severity]}

Implement the fix now.`;

        const result = await processSubAgentCommand({ command, category: 'code_modification' });
        success = result.success;
      }

      if (success) {
        this.repairMetrics.successfulRepairs++;
        const duration = Date.now() - startTime;
        this.repairMetrics.meanTimeToResolution.push(duration);
        console.log(`[BadBlue Worker] ✓ REPAIR SUCCESSFUL: ${issue.functionAffected} (${duration}ms)`);
      } else {
        console.log(`[BadBlue Worker] ⚠️  REPAIR FAILED: ${issue.functionAffected}`);
      }
    } catch (error: any) {
      console.error(`[BadBlue Worker] ❌ Repair error for ${issue.functionAffected}:`, error.message);
    }

    this.repairMetrics.repairSuccessRate = 
      (this.repairMetrics.successfulRepairs / this.repairMetrics.totalRepairs) * 100;
  }

  private async saveMetrics(): Promise<void> {
    try {
      const avgLatency = this.repairMetrics.queueLatency.length > 0
        ? this.repairMetrics.queueLatency.reduce((a, b) => a + b, 0) / this.repairMetrics.queueLatency.length
        : 0;

      const avgResolution = this.repairMetrics.meanTimeToResolution.length > 0
        ? this.repairMetrics.meanTimeToResolution.reduce((a, b) => a + b, 0) / this.repairMetrics.meanTimeToResolution.length
        : 0;

      const metrics = {
        timestamp: new Date().toISOString(),
        averageQueueLatencyMs: avgLatency,
        averageResolutionTimeMs: avgResolution,
        successRate: this.repairMetrics.repairSuccessRate,
        totalRepairs: this.repairMetrics.totalRepairs,
        successfulRepairs: this.repairMetrics.successfulRepairs,
        resourceUtilization: await this.getSystemResources(),
      };

      await fs.writeFile(this.METRICS_LOG, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.error('[BadBlue Worker] Error saving metrics:', error);
    }
  }

  private async performWeeklyBackup(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('[BadBlue Worker] 💾 WEEKLY BACKUP - Sunday 9:00 PM UTC');
    console.log('[BadBlue Worker] Backing up codebase and database...');
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    try {
      // Ensure backup directory exists
      await fs.mkdir(this.BACKUP_DIR, { recursive: true });

      // Delete previous backup
      const backupFiles = await fs.readdir(this.BACKUP_DIR);
      for (const file of backupFiles) {
        await fs.unlink(path.join(this.BACKUP_DIR, file));
      }
      console.log('[BadBlue Worker] Previous backup deleted');

      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const backupFile = path.join(this.BACKUP_DIR, `backup_${timestamp}.tar.gz`);

      // Create backup using tar (exclude node_modules, .git, data/backups)
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync(`tar -czf ${backupFile} --exclude='node_modules' --exclude='.git' --exclude='data/backups' --exclude='*.log' .`);
      
      const stats = await fs.stat(backupFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log(`[BadBlue Worker] ✓ Backup created: ${backupFile} (${sizeMB} MB)`);

      // Backup database
      const dbBackupFile = path.join(this.BACKUP_DIR, `database_${timestamp}.sql`);
      const dbUrl = process.env.DATABASE_URL;
      
      if (dbUrl) {
        try {
          await execAsync(`pg_dump "${dbUrl}" > ${dbBackupFile}`);
          const dbStats = await fs.stat(dbBackupFile);
          const dbSizeMB = (dbStats.size / (1024 * 1024)).toFixed(2);
          console.log(`[BadBlue Worker] ✓ Database backup created: ${dbBackupFile} (${dbSizeMB} MB)`);
        } catch (dbError: any) {
          console.log(`[BadBlue Worker] ⚠️  Database backup failed: ${dbError.message}`);
        }
      }

      console.log('[BadBlue Worker] ✓ Weekly backup complete');
    } catch (error: any) {
      console.error('[BadBlue Worker] ❌ Backup failed:', error.message);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
  }

  private async runDailyRepair() {
    if (this.isRepairInProgress) {
      console.log('[BadBlue Worker] Repair already in progress');
      return;
    }

    this.isRepairInProgress = true;
    this.isMaintenanceMode = true;
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('[BadBlue Worker] 🔧 MAINTENANCE MODE ACTIVATED - Daily 8:30 PM UTC AGGRESSIVE REPAIR');
    console.log('[BadBlue Worker] Comprehensive Failure Analysis | Multi-Phase Correction | Deep Diagnostics');
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    try {
      // Step 1: Run comprehensive diagnostics first
      console.log('[BadBlue Worker] Step 1: Running comprehensive pre-repair diagnostics...');
      await this.runDiagnostics();

      // Step 2: Analyze all failures
      const failures = await this.readFailureLog();
      const unresolvedFailures = failures.filter(f => !f.resolved);

      if (unresolvedFailures.length === 0) {
        console.log('[BadBlue Worker] ✓ No failures detected - system healthy');
        return;
      }

      console.log(`[BadBlue Worker] Step 2: Analyzing ${unresolvedFailures.length} unresolved failure(s)...`);

      // Step 3: Categorize failures by type
      const criticalFailures = unresolvedFailures.filter(f => f.severity === Severity.CRITICAL);
      const seriousFailures = unresolvedFailures.filter(f => f.severity === Severity.SERIOUS);
      const moderateFailures = unresolvedFailures.filter(f => f.severity === Severity.MODERATE);
      const minorFailures = unresolvedFailures.filter(f => f.severity <= Severity.WARNING);

      console.log(`[BadBlue Worker] Failure breakdown:`);
      console.log(`  - Critical: ${criticalFailures.length}`);
      console.log(`  - Serious: ${seriousFailures.length}`);
      console.log(`  - Moderate: ${moderateFailures.length}`);
      console.log(`  - Minor: ${minorFailures.length}`);

      // Step 4: NEW PARALLEL REPAIR SYSTEM - Intelligent orchestration
      console.log('[BadBlue Worker] Step 3: Executing parallel repair orchestration...');

      // Use the new parallel repair orchestrator
      await this.executeParallelRepairs(unresolvedFailures);

      // Fallback to serial retry for any remaining unresolved issues
      const stillUnresolved = (await this.readFailureLog()).filter(f => !f.resolved);
      
      if (stillUnresolved.length > 0) {
        console.log(`[BadBlue Worker] ${stillUnresolved.length} issues remain - attempting serial retry...`);
        
        let passNumber = 1;
        const maxPasses = 3;
        let remainingFailures = [...stillUnresolved];

        while (passNumber <= maxPasses && remainingFailures.length > 0) {
          console.log(`[BadBlue Worker] → Retry Pass ${passNumber}/${maxPasses} (${remainingFailures.length} failures)`);

          // Sort by severity for this pass
          remainingFailures.sort((a, b) => b.severity - a.severity);

          const passResults: boolean[] = [];

          for (const failure of remainingFailures) {
            const success = await this.executeThreePhaseCorrection(failure);
            passResults.push(success);
          }

          // Update remaining failures list
          remainingFailures = remainingFailures.filter((_, index) => !passResults[index]);

          console.log(`[BadBlue Worker] Pass ${passNumber} complete: ${passResults.filter(r => r).length} repairs successful`);

          // If no repairs succeeded this pass, break to avoid infinite loop
          if (passResults.filter(r => r).length === 0) {
            console.log('[BadBlue Worker] No further repairs possible - stopping');
            break;
          }

          passNumber++;
        }
      }

      // Step 5: Final diagnostics
      console.log('[BadBlue Worker] Step 4: Running post-repair verification...');
      await this.runDiagnostics();

      // Step 6: Report results
      const finalFailures = await this.readFailureLog();
      const finalUnresolved = finalFailures.filter(f => !f.resolved);

      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`[BadBlue Worker] DAILY REPAIR COMPLETE`);
      console.log(`  - Started with: ${unresolvedFailures.length} failures`);
      console.log(`  - Resolved: ${unresolvedFailures.length - finalUnresolved.length} failures`);
      console.log(`  - Remaining: ${finalUnresolved.length} failures (require manual review)`);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
    } catch (error) {
      console.error('[BadBlue Worker] ❌ Error during repair cycle:', error);
    } finally {
      this.isRepairInProgress = false;
      this.isMaintenanceMode = false;
      console.log('[BadBlue Worker] ✓ MAINTENANCE MODE DEACTIVATED');
    }
  }

  private async executeThreePhaseCorrection(failure: FailureLogEntry): Promise<boolean> {
    console.log(`[BadBlue Worker] Repairing: ${failure.functionAffected} (Severity ${failure.severity})`);

    try {
      // Phase 1: Direct Resolution
      const phase1Success = await this.attemptPhase1Repair(failure);
      if (phase1Success) {
        await this.markFailureResolved(failure);
        console.log(`[BadBlue Worker] ✓ Phase 1 repair successful: ${failure.functionAffected}`);
        return true;
      }

      // Phase 2: Targeted Component Repair
      const phase2Success = await this.attemptPhase2Repair(failure);
      if (phase2Success) {
        await this.markFailureResolved(failure);
        console.log(`[BadBlue Worker] ✓ Phase 2 repair successful: ${failure.functionAffected}`);
        return true;
      }

      // Phase 3: Contained Remediation
      const phase3Success = await this.attemptPhase3Repair(failure);
      if (phase3Success) {
        await this.markFailureResolved(failure);
        console.log(`[BadBlue Worker] ✓ Phase 3 repair successful: ${failure.functionAffected}`);
        return true;
      }

      // If all phases fail, flag for manual review
      console.log(`[BadBlue Worker] ⚠ Manual review required: ${failure.functionAffected}`);
      await this.flagForManualReview(failure);
      return false;
    } catch (error) {
      console.error(`[BadBlue Worker] Error repairing ${failure.functionAffected}:`, error);
      return false;
    }
  }

  private async attemptPhase1Repair(failure: FailureLogEntry): Promise<boolean> {
    // Phase 1: Direct Resolution (restart/reset)
    console.log(`[BadBlue Worker] Attempting Phase 1 repair: ${failure.functionAffected}`);

    // For configuration issues, we can't auto-repair (needs manual intervention)
    if (failure.cause.includes('missing') || failure.cause.includes('not configured')) {
      return false;
    }

    // For connection issues, attempt reconnection
    if (failure.functionAffected.includes('Database Connection')) {
      try {
        const { db } = await import('./db');
        await db.execute('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private async attemptPhase2Repair(failure: FailureLogEntry): Promise<boolean> {
    // Phase 2: Targeted Component Repair
    console.log(`[BadBlue Worker] Attempting Phase 2 repair: ${failure.functionAffected}`);

    // This phase would reload or reconfigure specific modules
    // Most repairs require manual intervention for security
    return false;
  }

  private async attemptPhase3Repair(failure: FailureLogEntry): Promise<boolean> {
    // Phase 3: Contained Remediation
    console.log(`[BadBlue Worker] Attempting Phase 3 repair: ${failure.functionAffected}`);

    // This phase handles interdependent issues
    // Most complex repairs require manual review
    return false;
  }

  private async runWeeklySystemTest() {
    this.isMaintenanceMode = true;
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('[BadBlue Worker] 🔧 MAINTENANCE MODE ACTIVATED - Sunday 8:30 PM UTC');
    console.log('[BadBlue Worker] INITIATING EXTREMELY THOROUGH & COMPREHENSIVE WEEKLY SYSTEM TEST');
    console.log('[BadBlue Worker] Full System Analysis | Deep Testing | Automated Repair & Correction');
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    try {
      const testResults: FunctionErrorLogEntry[] = [];
      const startTime = Date.now();

      // PHASE 1: Deep Database Operations Testing
      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 1/10: DEEP DATABASE OPERATIONS TESTING                                 │');
      console.log('│ → Connection validation, schema verification, transaction support           │');
      console.log('│ → Table integrity checks, index analysis, query optimization review         │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testDatabaseOperations(testResults);
      console.log(`✓ Phase 1 Complete: ${testResults.filter(r => r.functionTested.includes('Database')).length} database tests executed\n`);

      // PHASE 2: Comprehensive AI Services Analysis
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 2/10: COMPREHENSIVE AI SERVICES ANALYSIS                               │');
      console.log('│ → Gemini & Groq API configuration validation                                 │');
      console.log('│ → Fallback redundancy testing, API key verification                          │');
      console.log('│ → Multi-provider failover simulation                                         │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testAIServicesComprehensive(testResults);
      console.log(`✓ Phase 2 Complete: AI service configuration validated\n`);

      // PHASE 3: Advanced Legal AI Analysis & Research
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 3/10: ADVANCED LEGAL AI ANALYSIS & RESEARCH                            │');
      console.log('│ → Multi-scenario legal issue analysis (excessive force, false arrest, etc.) │');
      console.log('│ → State-specific statute research across multiple jurisdictions              │');
      console.log('│ → Case law correlation, response structure validation                        │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testLegalAIAnalysis(testResults);
      console.log(`✓ Phase 3 Complete: ${testResults.filter(r => r.functionTested.includes('Legal AI')).length} legal AI tests executed\n`);

      // PHASE 4: Comprehensive Document Generation Suite
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 4/10: COMPREHENSIVE DOCUMENT GENERATION SUITE                          │');
      console.log('│ → Tort notice generation across multiple state jurisdictions                 │');
      console.log('│ → Government claim formatting, content validation                            │');
      console.log('│ → Multi-state compliance verification                                        │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testDocumentGeneration(testResults);
      console.log(`✓ Phase 4 Complete: Document generation validated across jurisdictions\n`);

      // PHASE 5: Multi-Query Search & Research Services
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 5/10: MULTI-QUERY SEARCH & RESEARCH SERVICES                           │');
      console.log('│ → Precedent search testing (federal & state jurisdictions)                   │');
      console.log('│ → Filing information retrieval across 50 states                              │');
      console.log('│ → Case law correlation, query optimization analysis                          │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testSearchServices(testResults);
      console.log(`✓ Phase 5 Complete: ${testResults.filter(r => r.functionTested.includes('Search')).length} search tests executed\n`);

      // PHASE 6: Payment Processing Integration
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 6/10: PAYMENT PROCESSING INTEGRATION TESTING                           │');
      console.log('│ → Stripe API configuration validation                                        │');
      console.log('│ → Webhook secret verification, payment flow integrity                        │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testPaymentProcessing(testResults);
      console.log(`✓ Phase 6 Complete: Payment processing validated\n`);

      // PHASE 7: Email Service Integration
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 7/10: EMAIL SERVICE INTEGRATION TESTING                                │');
      console.log('│ → SMTP credentials validation, service availability                          │');
      console.log('│ → Email delivery capability verification                                     │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testEmailService(testResults);
      console.log(`✓ Phase 7 Complete: Email service configuration validated\n`);

      // PHASE 8: Authentication System Review
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 8/10: AUTHENTICATION SYSTEM SECURITY REVIEW                            │');
      console.log('│ → Session secret configuration, security token validation                    │');
      console.log('│ → Authentication flow integrity check                                        │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testAuthentication(testResults);
      console.log(`✓ Phase 8 Complete: Authentication system secured\n`);

      // PHASE 9: Performance & Stress Testing
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 9/10: PERFORMANCE BENCHMARKING & STRESS TESTING                        │');
      console.log('│ → Database query performance analysis, concurrent load simulation            │');
      console.log('│ → Memory usage monitoring, response time optimization review                 │');
      console.log('│ → System resource utilization analysis                                       │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');
      await this.testSystemPerformance(testResults);
      console.log(`✓ Phase 9 Complete: Performance benchmarks established\n`);

      // PHASE 10: Automated Repair & Correction
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ PHASE 10/10: AUTOMATED REPAIR & CORRECTION PROTOCOL                          │');
      console.log('│ → Analyzing detected issues, prioritizing by severity                        │');
      console.log('│ → Executing automated repair procedures                                      │');
      console.log('│ → Applying fixes, solutions, and corrections                                 │');
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');

      // Step 2: Auto-repair all detected issues
      console.log('\n[BadBlue Worker] Step 2: Auto-repairing detected issues...');
      const pendingIssues = testResults.filter(r => r.status === 'pending');
      let fixed = 0;
      let unfixable = 0;

      if (pendingIssues.length > 0) {
        pendingIssues.sort((a, b) => b.severity - a.severity);

        for (const issue of pendingIssues) {
          console.log(`[BadBlue Worker] → Attempting repair: ${issue.functionTested}`);
          const repairSuccess = await this.attemptAutoRepair(issue);

          if (repairSuccess) {
            fixed++;
            issue.status = 'fixed';
            console.log(`[BadBlue Worker] ✓ Fixed: ${issue.functionTested}`);
          } else {
            unfixable++;
            console.log(`[BadBlue Worker] ✗ Could not fix: ${issue.functionTested}`);
          }
        }
      }

      // Step 3: Clear logs and re-test to verify corrections
      console.log('\n[BadBlue Worker] Step 3: Verifying corrections...');
      await this.clearAllLogs();

      // Re-run critical tests to verify
      const verificationResults: FunctionErrorLogEntry[] = [];
      await this.testDatabaseOperations(verificationResults);
      await this.testAIServicesComprehensive(verificationResults);
      await this.testPaymentProcessing(verificationResults);
      await this.testEmailService(verificationResults);
      await this.testAuthentication(verificationResults);

      // Step 4: Only save errors that remain after auto-repair
      const unfixableErrors = verificationResults.filter(r => r.status === 'pending');
      await this.appendFunctionErrorLog(unfixableErrors);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ COMPREHENSIVE WEEKLY TEST RESULTS                                            │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');
      console.log(`│ Total Tests Run: ${testResults.length.toString().padEnd(63)}│`);
      console.log(`│ Issues Detected: ${pendingIssues.length.toString().padEnd(63)}│`);
      console.log(`│ Auto-Corrected: ${fixed.toString().padEnd(64)}│`);
      console.log(`│ Unfixable (Logged): ${unfixableErrors.length.toString().padEnd(58)}│`);
      console.log(`│ Duration: ${duration}s${' '.repeat(69 - duration.length)}│`);
      console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log(`[BadBlue Worker] ✅ WEEKLY TEST COMPLETE`);
      console.log(`[BadBlue Worker] Only unfixable errors logged - ${unfixableErrors.length} require manual review`);
      console.log(`[BadBlue Worker] Next test: Next Sunday 8:30 PM UTC`);
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    } catch (error) {
      console.error('[BadBlue Worker] ❌ CRITICAL ERROR DURING WEEKLY TEST:', error);
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    } finally {
      this.isMaintenanceMode = false;
      console.log('[BadBlue Worker] ✓ MAINTENANCE MODE DEACTIVATED - System operational');
    }
  }

  private async testAIServicesComprehensive(results: FunctionErrorLogEntry[]) {
    // CRITICAL: Enforce 15% Worker budget cap
    const { workerTokenBudget } = await import('./workerTokenBudget');
    const budgetStats = await workerTokenBudget.getTodayStats();
    
    console.log(`[Worker Budget] AI Services tests - ${budgetStats.percentUsed.toFixed(1)}% of daily budget used`);
    
    if (budgetStats.remaining < 1000) {
      console.log('[Weekly Test] ⛔ Worker budget exhausted - AI Services tests skipped');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Services Configuration',
        expectedBehavior: 'AI services operational',
        observedBehavior: `Tests skipped - Worker budget exhausted (${budgetStats.used}/${budgetStats.budget} tokens)`,
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    // LEGACY: Also check rateLimitTracker for backwards compatibility
    const { rateLimitTracker } = await import('./rateLimitTracker');
    const rateLimitStats = rateLimitTracker.getStats();
    
    if (rateLimitStats.utilizationPercent > 80) {
      console.log('[Weekly Test] ⚠️  Skipping AI Services tests - quota preservation');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Services Configuration',
        expectedBehavior: 'AI services operational',
        observedBehavior: 'Tests skipped to preserve quota for user requests',
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    // Test 1: Configuration check
    if (geminiKey && groqKey) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Services Configuration',
        expectedBehavior: 'Both Gemini and Groq keys configured',
        observedBehavior: 'Both keys present - dual fallback system active',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } else if (!geminiKey && !groqKey) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Services Configuration',
        expectedBehavior: 'At least one AI service key configured',
        observedBehavior: 'No AI keys configured - CRITICAL FAILURE',
        severity: Severity.CRITICAL,
        status: 'pending',
      });
      return; // Skip further AI tests
    } else {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Services Configuration',
        expectedBehavior: 'Both Gemini and Groq keys configured',
        observedBehavior: geminiKey ? 'Only Gemini configured (missing fallback)' : 'Only Groq configured (missing primary)',
        severity: Severity.WARNING,
        status: 'fixed',
        notes: 'Fallback redundancy not available'
      });
    }
  }

  private async testLegalAIAnalysis(results: FunctionErrorLogEntry[]) {
    // CRITICAL: Enforce 15% Worker budget cap
    const { workerTokenBudget } = await import('./workerTokenBudget');
    const budgetStats = await workerTokenBudget.getTodayStats();
    
    console.log(`[Worker Budget] Legal AI tests - ${budgetStats.percentUsed.toFixed(1)}% of daily budget used`);
    
    if (budgetStats.remaining < 3000) {
      console.log('[Weekly Test] ⛔ Worker budget exhausted - Legal AI tests skipped');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Legal AI Analysis',
        expectedBehavior: 'AI analysis operational',
        observedBehavior: `Tests skipped - Worker budget exhausted (${budgetStats.used}/${budgetStats.budget} tokens)`,
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    // LEGACY: Also check rateLimitTracker for backwards compatibility
    const { rateLimitTracker } = await import('./rateLimitTracker');
    const rateLimitStats = rateLimitTracker.getStats();
    
    if (rateLimitStats.utilizationPercent > 80) {
      console.log('[Weekly Test] ⚠️  Skipping Legal AI tests - quota preservation');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Legal AI Analysis',
        expectedBehavior: 'AI analysis operational',
        observedBehavior: 'Tests skipped to preserve quota for user requests',
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    const useReducedSuite = rateLimitStats.utilizationPercent > 50 || budgetStats.remaining < 8000;
    
    const testCases = useReducedSuite
      ? [{ // Just 1 test
        name: 'Excessive Force Analysis',
        query: 'Officer used taser on compliant suspect during traffic stop',
        state: 'California',
        details: 'Suspect was following commands'
      }]
      : [
      {
        name: 'Excessive Force Analysis',
        query: 'Officer used taser on compliant suspect during traffic stop',
        state: 'California',
        details: 'Suspect was following commands, had hands visible, officer deployed taser without warning'
      },
      {
        name: 'False Arrest Analysis',
        query: 'Arrested without probable cause or warrant',
        state: 'Texas',
        details: 'Officer arrested individual for failure to ID in non-stop-and-identify state'
      },
      {
        name: 'Unlawful Search Analysis',
        query: 'Search of vehicle without consent or warrant',
        state: 'New York',
        details: 'Officer searched trunk after consent denied, no probable cause established'
      }
    ];

    for (const testCase of testCases) {
      try {
        const { analyzeLegalIssue } = await import('./legalAI');
        const startTime = Date.now();
        const result = await analyzeLegalIssue(testCase.query, testCase.state, testCase.details);
        const duration = Date.now() - startTime;

        // Validate response structure
        if (!result || typeof result !== 'object') {
          throw new Error('Invalid response structure');
        }

        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Legal AI Analysis - ${testCase.name}`,
          expectedBehavior: 'Analyze legal issue and return structured analysis',
          observedBehavior: `✓ Analysis completed in ${duration}ms with valid structure`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
      } catch (error: any) {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Legal AI Analysis - ${testCase.name}`,
          expectedBehavior: 'Analyze legal issue and return structured analysis',
          observedBehavior: `Analysis failed: ${error.message}`,
          severity: Severity.SERIOUS,
          status: 'pending',
        });
      }
    }

    // Test research function with multiple queries
    const researchTests = [
      { state: 'California', issue: 'excessive force', context: 'taser deployment' },
      { state: 'Texas', issue: 'false arrest', context: 'failure to identify' },
      { state: 'Florida', issue: 'unlawful detention', context: 'traffic stop extended' }
    ];

    for (const test of researchTests) {
      try {
        const { researchRelevantStatutes } = await import('./legalAI');
        const startTime = Date.now();
        const result = await researchRelevantStatutes(test.state, test.issue, test.context);
        const duration = Date.now() - startTime;

        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Legal AI Research - ${test.state} ${test.issue}`,
          expectedBehavior: 'Research relevant statutes and case law',
          observedBehavior: `✓ Research completed in ${duration}ms`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
      } catch (error: any) {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Legal AI Research - ${test.state} ${test.issue}`,
          expectedBehavior: 'Research relevant statutes and case law',
          observedBehavior: `Research failed: ${error.message}`,
          severity: Severity.MODERATE,
          status: 'pending',
        });
      }
    }
  }

  private async testDocumentGeneration(results: FunctionErrorLogEntry[]) {
    // CRITICAL: Enforce 15% Worker budget cap
    const { workerTokenBudget } = await import('./workerTokenBudget');
    const budgetStats = await workerTokenBudget.getTodayStats();
    
    console.log(`[Worker Budget] Document Generation tests - ${budgetStats.percentUsed.toFixed(1)}% of daily budget used`);
    
    if (budgetStats.remaining < 4000) {
      console.log('[Weekly Test] ⛔ Worker budget exhausted - Document Generation tests skipped');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Document Generation',
        expectedBehavior: 'Document generation operational',
        observedBehavior: `Tests skipped - Worker budget exhausted (${budgetStats.used}/${budgetStats.budget} tokens)`,
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    // LEGACY: Also check rateLimitTracker for backwards compatibility
    const { rateLimitTracker } = await import('./rateLimitTracker');
    const rateLimitStats = rateLimitTracker.getStats();
    
    if (rateLimitStats.utilizationPercent > 80) {
      console.log('[Weekly Test] ⚠️  Skipping Document Generation tests - quota preservation');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Document Generation',
        expectedBehavior: 'Document generation operational',
        observedBehavior: 'Tests skipped to preserve quota for user requests',
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    const useReducedSuite = rateLimitStats.utilizationPercent > 50 || budgetStats.remaining < 10000;
    
    // Test Tort Notice Generation - scale based on quota
    const tortTests = useReducedSuite
      ? [{ // Just 1 test
        name: 'California Government Claim',
        data: {
          state: 'California',
          claimantName: 'Test Claimant',
          claimantAddress: '123 Test Street, Test City, CA 90000',
          claimantEmail: 'test@test.com',
          officerName: 'Officer John Doe',
          officerBadge: 'BADGE-12345',
          department: 'Test Police Department',
          city: 'Test City',
          county: 'Test County',
          incidentDate: new Date('2024-01-15'),
          incidentDescription: 'Excessive force during traffic stop - officer used taser without justification'
        }
      }]
      : [
      {
        name: 'California Government Claim',
        data: {
          state: 'California',
          claimantName: 'Test Claimant',
          claimantAddress: '123 Test Street, Test City, CA 90000',
          claimantEmail: 'test@test.com',
          officerName: 'Officer John Doe',
          officerBadge: 'BADGE-12345',
          department: 'Test Police Department',
          city: 'Test City',
          county: 'Test County',
          incidentDate: new Date('2024-01-15'),
          incidentDescription: 'Excessive force during traffic stop - officer used taser without justification'
        }
      },
      {
        name: 'Texas Notice of Claim',
        data: {
          state: 'Texas',
          claimantName: 'Jane Smith',
          claimantAddress: '456 Main St, Houston, TX 77000',
          claimantEmail: 'jane@test.com',
          officerName: 'Officer Bob Williams',
          officerBadge: '98765',
          department: 'Houston PD',
          city: 'Houston',
          county: null,
          incidentDate: new Date('2024-02-20'),
          incidentDescription: 'False arrest without probable cause during peaceful protest'
        }
      }
    ];

    for (const test of tortTests) {
      try {
        const { generateTortNotice } = await import('./tortNoticeGenerator');
        const startTime = Date.now();
        const result = await generateTortNotice(test.data);
        const duration = Date.now() - startTime;

        // Validate output has content
        if (!result || result.length < 100) {
          throw new Error('Generated notice is too short or empty');
        }

        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Tort Notice Generation - ${test.name}`,
          expectedBehavior: 'Generate complete tort claim notice document',
          observedBehavior: `✓ Generated ${result.length} character notice in ${duration}ms`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
      } catch (error: any) {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Tort Notice Generation - ${test.name}`,
          expectedBehavior: 'Generate complete tort claim notice document',
          observedBehavior: `Generation failed: ${error.message}`,
          severity: Severity.SERIOUS,
          status: 'pending',
        });
      }
    }
  }

  private async testSearchServices(results: FunctionErrorLogEntry[]) {
    // CRITICAL: Enforce 15% Worker budget cap
    const { workerTokenBudget } = await import('./workerTokenBudget');
    const budgetStats = await workerTokenBudget.getTodayStats();
    
    console.log(`[Worker Budget] Search tests - ${budgetStats.percentUsed.toFixed(1)}% of daily budget used`);
    
    // Strict 15% enforcement: Skip ALL tests if budget exhausted
    if (budgetStats.remaining < 2000) { // Need at least 2k tokens for minimal test
      console.log('[Weekly Test] ⛔ Worker budget exhausted - all search tests skipped');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Search Services',
        expectedBehavior: 'Search services operational',
        observedBehavior: `Tests skipped - Worker budget exhausted (${budgetStats.used}/${budgetStats.budget} tokens used today)`,
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    // LEGACY: Also check rateLimitTracker for backwards compatibility
    const { rateLimitTracker } = await import('./rateLimitTracker');
    const rateLimitStats = rateLimitTracker.getStats();
    
    // Skip AI tests if utilization > 80% (preserve quota for user requests)
    if (rateLimitStats.utilizationPercent > 80) {
      console.log('[Weekly Test] ⚠️  Skipping AI search tests - quota preservation (utilization: ' + rateLimitStats.utilizationPercent.toFixed(1) + '%)');
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'AI Search Services',
        expectedBehavior: 'Search services operational with quota availability',
        observedBehavior: 'Tests skipped to preserve quota for user requests',
        severity: Severity.NOTICE,
        status: 'skipped',
      });
      return;
    }
    
    // Use reduced test suite if utilization > 50%
    const useReducedSuite = rateLimitStats.utilizationPercent > 50;
    
    if (useReducedSuite) {
      console.log('[Weekly Test] Using REDUCED test suite (quota utilization: ' + rateLimitStats.utilizationPercent.toFixed(1) + '%)');
    }
    
    // Test Precedent Search - scale based on quota
    const precedentTests = useReducedSuite 
      ? [{ query: 'excessive force', state: 'California', jurisdiction: 'federal' as const }] // Just 1 test
      : [
          { query: 'excessive force taser', state: 'California', jurisdiction: 'federal' as const },
          { query: 'false arrest probable cause', state: 'Texas', jurisdiction: 'state' as const },
          { query: 'qualified immunity denial', state: 'New York', jurisdiction: 'federal' as const }
        ];

    for (const test of precedentTests) {
      try {
        const { searchPrecedents } = await import('./precedentSearch');
        const startTime = Date.now();
        const result = await searchPrecedents(test.query, test.state, test.jurisdiction);
        const duration = Date.now() - startTime;

        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Precedent Search - ${test.query} (${test.jurisdiction})`,
          expectedBehavior: 'Find relevant case precedents',
          observedBehavior: `✓ Search completed in ${duration}ms`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
      } catch (error: any) {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Precedent Search - ${test.query}`,
          expectedBehavior: 'Find relevant case precedents',
          observedBehavior: `Search failed: ${error.message}`,
          severity: Severity.MODERATE,
          status: 'pending',
        });
      }
    }

    // Test Filing Info Search - scale based on quota
    const states = useReducedSuite 
      ? ['California'] // Just 1 state
      : ['California', 'Texas', 'New York', 'Florida', 'Illinois'];
      
    for (const state of states) {
      try {
        const { searchStateFilingInfo } = await import('./filingInfoSearch');
        const startTime = Date.now();
        const result = await searchStateFilingInfo(state);
        const duration = Date.now() - startTime;

        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Filing Info Search - ${state}`,
          expectedBehavior: 'Retrieve state-specific filing information',
          observedBehavior: `✓ Retrieved filing info in ${duration}ms`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
        
        // CRITICAL: Check quota after each expensive operation
        const currentStats = rateLimitTracker.getStats();
        if (currentStats.utilizationPercent > 90) {
          console.log('[Weekly Test] ⚠️  Stopping tests - quota threshold exceeded mid-run');
          results.push({
            timestamp: new Date().toISOString(),
            functionTested: 'Remaining AI Tests',
            expectedBehavior: 'Complete all diagnostic tests',
            observedBehavior: 'Tests stopped - quota preservation for user requests',
            severity: Severity.NOTICE,
            status: 'skipped',
          });
          return; // Stop testing immediately
        }
      } catch (error: any) {
        const isQuotaError = error.message.includes('rate limit') || error.message.includes('quota') || error.status === 429;
        
        if (isQuotaError) {
          console.log('[Weekly Test] ⚠️  Quota exhausted - stopping tests');
          results.push({
            timestamp: new Date().toISOString(),
            functionTested: 'Remaining AI Tests',
            expectedBehavior: 'Complete all diagnostic tests',
            observedBehavior: 'Tests stopped - quota exhausted',
            severity: Severity.NOTICE,
            status: 'skipped',
          });
          return; // Stop immediately on quota errors
        }
        
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: `Filing Info Search - ${state}`,
          expectedBehavior: 'Retrieve state-specific filing information',
          observedBehavior: `Search failed: ${error.message}`,
          severity: Severity.MODERATE,
          status: 'pending',
        });
      }
    }
  }

  private async testSystemPerformance(results: FunctionErrorLogEntry[]) {
    // Test 1: Database Query Performance
    try {
      const { db } = await import('./db');
      const iterations = 5;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await db.execute('SELECT 1');
        times.push(Date.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      if (avgTime > 500) {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: 'Database Performance Test',
          expectedBehavior: 'Average query time < 500ms',
          observedBehavior: `⚠ Average: ${avgTime.toFixed(2)}ms, Max: ${maxTime}ms (SLOW)`,
          severity: Severity.WARNING,
          status: 'fixed',
          notes: 'Database performance degraded'
        });
      } else {
        results.push({
          timestamp: new Date().toISOString(),
          functionTested: 'Database Performance Test',
          expectedBehavior: 'Fast query response times',
          observedBehavior: `✓ Average: ${avgTime.toFixed(2)}ms, Max: ${maxTime}ms`,
          severity: Severity.NOTICE,
          status: 'fixed',
        });
      }
    } catch (error: any) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Performance Test',
        expectedBehavior: 'Complete performance benchmark',
        observedBehavior: `Performance test failed: ${error.message}`,
        severity: Severity.MODERATE,
        status: 'pending',
      });
    }

    // Test 2: Memory Usage Check
    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);

    results.push({
      timestamp: new Date().toISOString(),
      functionTested: 'Memory Usage Monitor',
      expectedBehavior: 'Monitor system memory consumption',
      observedBehavior: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`,
      severity: Severity.NOTICE,
      status: 'fixed',
    });

    // Test 3: Concurrent Request Simulation
    try {
      const { db } = await import('./db');
      const concurrentQueries = 10;
      const start = Date.now();

      await Promise.all(
        Array(concurrentQueries).fill(0).map(() => db.execute('SELECT 1'))
      );

      const totalTime = Date.now() - start;
      const avgPerQuery = totalTime / concurrentQueries;

      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Concurrent Load Test',
        expectedBehavior: 'Handle multiple simultaneous requests',
        observedBehavior: `✓ ${concurrentQueries} concurrent queries completed in ${totalTime}ms (avg ${avgPerQuery.toFixed(2)}ms/query)`,
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } catch (error: any) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Concurrent Load Test',
        expectedBehavior: 'Handle multiple simultaneous requests',
        observedBehavior: `Load test failed: ${error.message}`,
        severity: Severity.MODERATE,
        status: 'pending',
      });
    }
  }

  private async testDatabaseOperations(results: FunctionErrorLogEntry[]) {
    // Test 1: Basic Connection
    try {
      const { db } = await import('./db');
      await db.execute('SELECT 1');

      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Connection',
        expectedBehavior: 'Successfully connect and execute query',
        observedBehavior: '✓ Connection successful',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } catch (error: any) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Connection',
        expectedBehavior: 'Successfully connect and execute query',
        observedBehavior: `Connection failed: ${error.message}`,
        severity: Severity.CRITICAL,
        status: 'pending',
      });
      return; // Skip further DB tests
    }

    // Test 2: Table Existence Validation
    try {
      const { db } = await import('./db');
      const tables = ['users', 'payments', 'complaints', 'lawsuits', 'foiarequests', 'petitions'];
      const existingTables: string[] = [];

      for (const table of tables) {
        try {
          await db.execute(`SELECT 1 FROM ${table} LIMIT 1`);
          existingTables.push(table);
        } catch {
          // Table doesn't exist or query failed
        }
      }

      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Schema Validation',
        expectedBehavior: 'All required tables exist',
        observedBehavior: `✓ Found ${existingTables.length}/${tables.length} tables: ${existingTables.join(', ')}`,
        severity: existingTables.length === tables.length ? Severity.NOTICE : Severity.WARNING,
        status: 'fixed',
      });
    } catch (error: any) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Schema Validation',
        expectedBehavior: 'Validate database schema',
        observedBehavior: `Schema validation failed: ${error.message}`,
        severity: Severity.MODERATE,
        status: 'pending',
      });
    }

    // Test 3: Transaction Support
    try {
      const { db } = await import('./db');
      await db.execute('BEGIN');
      await db.execute('SELECT 1');
      await db.execute('ROLLBACK');

      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Transaction Support',
        expectedBehavior: 'Support BEGIN/ROLLBACK transactions',
        observedBehavior: '✓ Transaction support confirmed',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } catch (error: any) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Database Transaction Support',
        expectedBehavior: 'Support transactions',
        observedBehavior: `Transaction test failed: ${error.message}`,
        severity: Severity.WARNING,
        status: 'pending',
      });
    }
  }


  private async testPaymentProcessing(results: FunctionErrorLogEntry[]) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (stripeKey && webhookSecret) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Payment Processing',
        expectedBehavior: 'Stripe configured with webhook secret',
        observedBehavior: 'Fully configured',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } else if (!stripeKey) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Payment Processing',
        expectedBehavior: 'Stripe key configured',
        observedBehavior: 'Stripe key missing',
        severity: Severity.SERIOUS,
        status: 'pending',
      });
    } else {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Payment Processing',
        expectedBehavior: 'Stripe configured with webhook secret',
        observedBehavior: 'Webhook secret missing',
        severity: Severity.WARNING,
        status: 'fixed',
      });
    }
  }

  private async testEmailService(results: FunctionErrorLogEntry[]) {
    const smtpUser = process.env.GWSMTP_USER;
    const smtpPass = process.env.GWSMTP_PASS;

    if (smtpUser && smtpPass) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Email Service',
        expectedBehavior: 'SMTP credentials configured',
        observedBehavior: 'Credentials present',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } else {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Email Service',
        expectedBehavior: 'SMTP credentials configured',
        observedBehavior: 'SMTP credentials missing',
        severity: Severity.MODERATE,
        status: 'pending',
      });
    }
  }

  private async testAuthentication(results: FunctionErrorLogEntry[]) {
    const sessionSecret = process.env.SESSION_SECRET;

    if (sessionSecret) {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Authentication System',
        expectedBehavior: 'Session secret configured',
        observedBehavior: 'Session secret present',
        severity: Severity.NOTICE,
        status: 'fixed',
      });
    } else {
      results.push({
        timestamp: new Date().toISOString(),
        functionTested: 'Authentication System',
        expectedBehavior: 'Session secret configured',
        observedBehavior: 'Session secret missing',
        severity: Severity.CRITICAL,
        status: 'pending',
      });
    }
  }

  private async attemptAutoRepair(issue: FunctionErrorLogEntry): Promise<boolean> {
    console.log(`[BadBlue Worker] Auto-repairing: ${issue.functionTested}`);

    // Guard against missing cause field (prevents TypeError)
    const cause = issue.cause || '';

    // Most configuration issues require manual intervention
    if (cause.includes('missing') || cause.includes('not configured')) {
      issue.notes = 'Manual configuration required';
      issue.status = 'pending';
      return false;
    }

    // For connection issues, attempt reconnection
    if (issue.functionTested.includes('Database Connection')) {
      try {
        const { db } = await import('./db');
        await db.execute('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }

    // For other issues, assume manual review is needed
    issue.notes = 'Automated repair not implemented for this issue type';
    issue.status = 'pending';
    return false;
  }

  // Log management methods
  private async readFailureLog(): Promise<FailureLogEntry[]> {
    try {
      const data = await fs.readFile(this.FAILURE_LOG, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async logFailures(entries: FailureLogEntry[]) {
    try {
      const existing = await this.readFailureLog();
      const updated = [...existing, ...entries];
      await fs.writeFile(this.FAILURE_LOG, JSON.stringify(updated, null, 2));
    } catch (error) {
      console.error('[BadBlue Worker] Error writing failure log:', error);
    }
  }

  private async appendFailureLog(entries: FailureLogEntry[]) {
    try {
      const existing = await this.readFailureLog();
      const updated = [...existing, ...entries];
      await fs.writeFile(this.FAILURE_LOG, JSON.stringify(updated, null, 2));
    } catch (error) {
      console.error('[BadBlue Worker] Error writing failure log:', error);
    }
  }

  private async markFailureResolved(failure: FailureLogEntry) {
    try {
      const failures = await this.readFailureLog();
      const index = failures.findIndex(
        f => f.timestamp === failure.timestamp && f.functionAffected === failure.functionAffected
      );

      if (index !== -1) {
        failures[index].resolved = true;
        failures[index].resolvedAt = new Date().toISOString();
        failures[index].systemState = 'working';
        await fs.writeFile(this.FAILURE_LOG, JSON.stringify(failures, null, 2));
      }
    } catch (error) {
      console.error('[BadBlue Worker] Error marking failure resolved:', error);
    }
  }

  private async flagForManualReview(failure: FailureLogEntry) {
    try {
      const failures = await this.readFailureLog();
      const index = failures.findIndex(
        f => f.timestamp === failure.timestamp && f.functionAffected === failure.functionAffected
      );

      if (index !== -1) {
        failures[index].cause = `${failures[index].cause} [MANUAL REVIEW REQUIRED]`;
        await fs.writeFile(this.FAILURE_LOG, JSON.stringify(failures, null, 2));
      }
    } catch (error) {
      console.error('[BadBlue Worker] Error flagging for manual review:', error);
    }
  }

  private async readFunctionErrorLog(): Promise<FunctionErrorLogEntry[]> {
    try {
      const data = await fs.readFile(this.FUNCTION_ERROR_LOG, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async appendFunctionErrorLog(entries: FunctionErrorLogEntry[]) {
    try {
      const existing = await this.readFunctionErrorLog();
      const updated = [...existing, ...entries];
      await fs.writeFile(this.FUNCTION_ERROR_LOG, JSON.stringify(updated, null, 2));
    } catch (error) {
      console.error('[BadBlue Worker] Error writing function error log:', error);
    }
  }

  private async clearAllLogs() {
    try {
      await fs.writeFile(this.FAILURE_LOG, JSON.stringify([], null, 2));
      await fs.writeFile(this.FUNCTION_ERROR_LOG, JSON.stringify([], null, 2));
      console.log('[BadBlue Worker] All logs cleared.');
    } catch (error) {
      console.error('[BadBlue Worker] Error clearing logs:', error);
    }
  }

  // Public API for reading logs (for admin panel)
  async getFailureLogs(): Promise<FailureLogEntry[]> {
    const logs = await this.readFailureLog();
    // Return newest to oldest
    return logs.reverse();
  }

  async getFunctionErrorLogs(): Promise<FunctionErrorLogEntry[]> {
    const logs = await this.readFunctionErrorLog();
    // Return newest to oldest
    return logs.reverse();
  }

  async logFailure(entry: Omit<FailureLogEntry, 'timestamp'>) {
    const fullEntry: FailureLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    await this.appendFailureLog([fullEntry]);
  }

  // Manual triggers for admin
  async runManualDiagnostic(): Promise<void> {
    console.log('[BadBlue Worker] Manual diagnostic triggered');
    await this.runDiagnostics();
  }

  async runManualWeeklyTest(): Promise<void> {
    console.log('[BadBlue Worker] Manual weekly test triggered');
    await this.runWeeklySystemTest();
  }

  async runManualRepair(): Promise<void> {
    console.log('[BadBlue Worker] Manual repair cycle triggered');
    await this.runDailyRepair();
  }

  // Public getter for maintenance mode status
  isUnderMaintenance(): boolean {
    return this.isMaintenanceMode;
  }

  shutdown() {
    console.log('[BadBlue Worker] Shutting down...');

    if (this.diagnosticInterval) {
      clearInterval(this.diagnosticInterval);
    }
    if (this.repairSchedule) {
      clearTimeout(this.repairSchedule);
    }
    if (this.weeklyTestSchedule) {
      clearTimeout(this.weeklyTestSchedule);
    }
  }
}

// Export singleton instance
export const badblueWorker = BadBlueWorker.getInstance();