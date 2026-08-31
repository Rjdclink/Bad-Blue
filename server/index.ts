// SERVER ENTRY POINT LOADED - Sanity check for deployment verification
console.log("SERVER ENTRY LOADED");
console.log(
  '[BOOT_ID]',
  JSON.stringify(
    {
      ts: new Date().toISOString(),
      serviceName: process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_NAME || 'unknown',
      commit:
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT ||
        process.env.SOURCE_VERSION ||
        'unknown',
      nodeEnv: process.env.NODE_ENV || 'unknown',
    },
    null,
    0
  )
);

import * as dotenv from 'dotenv';
dotenv.config();

import { loadConfig } from './config';
import { getAIModel } from './systemConfig';
import { OPENROUTER_MODELS as BEST_MODELS_PER_PROVIDER } from './constants';

// CRITICAL: Validate configuration before anything else
// Note: Using console.log here intentionally as logger is not yet initialized during bootstrap
try {
  console.log('[STARTUP] Stage 0: Validating environment configuration...');
  loadConfig();
  console.log('[STARTUP] ✓ Configuration validated successfully\n');
} catch (error) {
  console.error('[STARTUP] ✗ Configuration validation failed');
  console.error(error);
  console.error('\n[STARTUP] Application cannot start with invalid configuration');
  process.exit(1);
}

import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { serveStatic, log } from "./vite";
import { createServer, type Server } from "http";

import { runAllSchemaMigrations } from "./migrations/reconcileAppSchema";

const app = express();

const startupStartedAt = Date.now();

function startupTrace(event: string, details: Record<string, unknown> = {}): void {
  console.log(
    '[STARTUP_TRACE]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startupStartedAt,
      event,
      pid: process.pid,
      ...details,
    })
  );
}

let isReady = false;
let isFullyInitialized = false; // Tracks full service initialization
let isShuttingDown = false;
let startupError: string | null = null;
let backgroundInitializationError: string | null = null;
let databaseInitialized = false;
let httpServer: Server | null = null;

startupTrace('express_created');

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  console.error('[FATAL] Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  if (!isShuttingDown) {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log('[SHUTDOWN] Already shutting down, ignoring signal:', signal);
    return;
  }
  
  isShuttingDown = true;
  isReady = false;
  console.log(`[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    console.error('[SHUTDOWN] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('[SHUTDOWN] HTTP server closed');
    }

    try {
      const { persistenceManager } = await import('./persistenceManager');
      await persistenceManager.stop();
      console.log('[SHUTDOWN] Persistence manager stopped');
    } catch (e) {
      console.warn('[SHUTDOWN] Error stopping persistence manager:', e);
    }

    try {
      const { badblueWorker } = await import('./badblueWorker');
      if (badblueWorker.shutdown) {
        await badblueWorker.shutdown();
        console.log('[SHUTDOWN] LegalWhat Worker stopped');
      }
    } catch (e) {
      console.warn('[SHUTDOWN] Error stopping worker:', e);
    }

    try {
      const { maintenanceWorker } = await import('./maintenanceWorker');
      if (maintenanceWorker.shutdown) {
        await maintenanceWorker.shutdown();
        console.log('[SHUTDOWN] Maintenance Worker stopped');
      }
    } catch (e) {
      console.warn('[SHUTDOWN] Error stopping maintenance worker:', e);
    }

    try {
      const { pool } = await import('./db');
      if (pool?.end) {
        await pool.end();
        console.log('[SHUTDOWN] Database pool closed');
      }
    } catch (e) {
      console.warn('[SHUTDOWN] Error closing database pool:', e);
    }

    clearTimeout(shutdownTimeout);
    console.log('[SHUTDOWN] Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[SHUTDOWN] Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function databaseRetryDelayMs(attempt: number, baseMs: number = 2_000, maxMs: number = 12_000): number {
  const exponent = Math.min(8, Math.max(0, attempt - 1));
  const capMs = Math.min(maxMs, baseMs * Math.pow(2, exponent));
  const floorMs = Math.min(500, Math.max(100, Math.floor(capMs / 4)));
  return floorMs + Math.floor(Math.random() * Math.max(1, capMs - floorMs + 1));
}

function databaseErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; depth < 6 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error && current.message) parts.push(current.message);
    else if (typeof current === 'string') parts.push(current);
    if (current && typeof current === 'object' && current.code) parts.push(String(current.code));
    current = current && typeof current === 'object' ? current.cause : null;
  }
  if (parts.length === 0) parts.push(String(error ?? ''));
  return parts.join(' | ').toLowerCase();
}

function isDatabaseAdmissionPressureError(error: unknown): boolean {
  const message = databaseErrorText(error);
  const timeoutContext = message.includes('timeout') || message.includes('timed out') || message.includes('connection terminated');
  return (
    message.includes('53300') || // PostgreSQL too_many_connections
    message.includes('57p03') || // cannot_connect_now / transient admission failure
    message.includes('etimedout') ||
    message.includes('connection timeout') ||
    message.includes('connection terminated due to connection timeout') ||
    message.includes('failed to connect to database: {:error, :timeout}') ||
    message.includes('too many connections') ||
    message.includes('too many clients') ||
    message.includes('remaining connection slots') ||
    message.includes('max_client_conn') ||
    message.includes('database is overloaded') ||
    message.includes('timeout expired') ||
    (message.includes('08006') && timeoutContext)
  );
}

function isPermanentDatabaseStartupError(error: unknown): boolean {
  const message = databaseErrorText(error);
  return (
    message.includes('28p01') || // invalid_password
    message.includes('28000') || // invalid_authorization_specification
    message.includes('3d000') || // invalid_catalog_name
    message.includes('password authentication failed') ||
    message.includes('database does not exist') ||
    message.includes('invalid connection string')
  );
}

function isLocalPoolFailure(error: unknown): boolean {
  const message = databaseErrorText(error);
  return (
    message.includes('cannot use a pool after calling end') ||
    message.includes('pool is closed') ||
    message.includes('client was closed and is not queryable')
  );
}

function startupDatabaseAdmissionBudgetMs(): number {
  const railwayHealthcheckSeconds = Number(process.env.RAILWAY_HEALTHCHECK_TIMEOUT_SEC || 300);
  const healthcheckMs = Number.isFinite(railwayHealthcheckSeconds) && railwayHealthcheckSeconds > 0
    ? railwayHealthcheckSeconds * 1_000
    : 300_000;
  const reserveMs = Math.min(60_000, Math.max(30_000, Math.floor(healthcheckMs * 0.20)));
  const defaultBudgetMs = Math.max(30_000, healthcheckMs - reserveMs);
  const configuredBudgetMs = Number(process.env.BADBLUE_DATABASE_ADMISSION_BUDGET_MS || defaultBudgetMs);
  const safeUpperBoundMs = Math.max(30_000, healthcheckMs - 15_000);
  return Math.max(30_000, Math.min(safeUpperBoundMs, Number.isFinite(configuredBudgetMs) ? configuredBudgetMs : defaultBudgetMs));
}

async function retryDatabaseProbeWithinBudget(): Promise<void> {
  const budgetMs = startupDatabaseAdmissionBudgetMs();
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: unknown = null;

  while (Date.now() - startedAt < budgetMs) {
    attempt += 1;
    try {
      const { db } = await import('./db');
      await db.execute('SELECT 1');
      if (attempt > 1) {
        console.log(`[RETRY] Database admission recovered on attempt ${attempt} after ${Date.now() - startedAt}ms`);
      }
      return;
    } catch (error: any) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const admissionPressure = isDatabaseAdmissionPressureError(error);
      console.warn(`[RETRY] Database probe ${attempt} failed after ${elapsedMs}ms:`, error?.message ?? error);

      if (isPermanentDatabaseStartupError(error) || isLocalPoolFailure(error)) {
        throw error;
      }

      const remainingMs = Math.max(0, budgetMs - elapsedMs);
      if (remainingMs <= 0) break;

      // One admission attempt at a time with full jitter. Under measured upstream
      // pressure this intentionally avoids parallel probes, pool recreation and a
      // synchronized retry cadence across Railway replicas.
      const waitTime = Math.min(databaseRetryDelayMs(attempt), remainingMs);
      console.log(`[RETRY] Database admission ${admissionPressure ? 'pressure' : 'transient failure'}; jittering ${waitTime}ms (${remainingMs}ms budget remaining)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`database admission budget exhausted after ${budgetMs}ms`);
}

async function initializeDatabase(): Promise<boolean> {
  startupTrace('database_initialization_started');
  console.log('[STARTUP] Stage 1: Database connection...');
  
  let lastError: unknown = null;
  try {
    await retryDatabaseProbeWithinBudget();
    console.log('[STARTUP] ✓ Database connection verified');
    startupTrace('database_initialization_completed', { connected: true, recovered: false });
    return true;
  } catch (error: any) {
    lastError = error;
    console.error('[STARTUP] ❌ Database admission window ended:', error?.message ?? error);
  }

  // Pool recreation is useful for a locally closed/corrupt pool, but it is an
  // anti-pattern when the upstream database/pooler is overloaded. In that case
  // recreating both pools immediately adds fresh connection demand and can turn
  // a recoverable admission event into a retry storm.
  if (!isDatabaseAdmissionPressureError(lastError) && !isPermanentDatabaseStartupError(lastError)) {
    console.log('[STARTUP] Local pool failure detected; attempting one bounded pool reset...');
    try {
      const { resetPool } = await import('./db');
      await resetPool();
      console.log('[STARTUP] ✓ Database pool reset successful');
      startupTrace('database_initialization_completed', { connected: true, recovered: true });
      return true;
    } catch (resetError: any) {
      lastError = resetError;
      console.error('[STARTUP] ❌ Database pool reset failed:', resetError?.message ?? resetError);
    }
  } else if (isDatabaseAdmissionPressureError(lastError)) {
    console.warn('[STARTUP] Database admission pressure detected; skipping pool reset to avoid connection churn');
  } else {
    console.error('[STARTUP] Permanent database configuration/authentication failure; pool reset suppressed');
  }

  console.warn('[STARTUP] Database unavailable; deployment remains unready while the previous Railway deployment can continue serving');
  startupTrace('database_initialization_completed', {
    connected: false,
    admissionPressure: isDatabaseAdmissionPressureError(lastError),
    permanentFailure: isPermanentDatabaseStartupError(lastError),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}

async function runMigrations(): Promise<void> {
  startupTrace('migrations_started');
  console.log('[STARTUP] Stage 2: Running migrations...');

  const results = await runAllSchemaMigrations({ continueOnError: true });

  for (const result of results) {
    if (result.success) {
      console.log(`[STARTUP] ✓ ${result.name} migration complete`);
      continue;
    }

    console.warn(`[STARTUP] ⚠ ${result.name} migration skipped:`, result.error);
  }

  startupTrace('migrations_completed', {
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
  });
}

async function initializeServices(): Promise<void> {
  startupTrace('background_services_started');
  console.log('[STARTUP] Stage 3: Initializing services...');
  
  // NOTE: Playwright browser validation has been REMOVED from server startup
  // Browser validation now happens in the People Search Worker service
  // This ensures APPLICATION BOOT ALWAYS SUCCEEDS regardless of Playwright/browser state
  // 
  // To validate browser at runtime, use:
  // - GET /api/people-search/health - Check worker status
  // - POST /api/people-search/validate - Run browser test crawl
  console.log('[STARTUP] ℹ Playwright validation delegated to People Search Worker');
  console.log('[STARTUP] ℹ Use /api/people-search/health to check worker status at runtime');

  try {
    const { persistenceManager } = await import('./persistenceManager');
    await persistenceManager.start();
    console.log('[STARTUP] ✓ Persistence manager started');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Persistence manager failed:', error?.message ?? error);
  }

  try {
    const { cryptaraGovernance } = await import('./services/cryptocrawl/governance/cryptara-integration.js');
    await cryptaraGovernance.initialize();
    console.log('[STARTUP] ✓ CryptoCrawler Cryptara governance bridge initialized');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ CryptoCrawler Cryptara governance bridge unavailable:', error?.message ?? error);
  }

  try {
    const { stageManager } = await import('./services/cryptocrawl/governance/stage-management.js');
    if (stageManager.isAutomaticallyActivated() && stageManager.getCurrentStage() >= 2) {
      const { startCryptoCrawlerRuntime } = await import('./services/cryptocrawl/api/admin-api.js');
      const result = await startCryptoCrawlerRuntime();
      if (!result.success && result.status !== 409) {
        console.warn('[STARTUP] ⚠ CryptoCrawler automatic runtime resume unavailable:', result.payload.error);
      }
    }
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ CryptoCrawler automatic runtime resume failed:', error?.message ?? error);
  }

  try {
    const { badblueWorker } = await import('./badblueWorker');
    await badblueWorker.initialize();
    console.log('[STARTUP] ✓ LegalWhat Worker initialized');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ LegalWhat Worker failed:', error?.message ?? error);
  }

  // Initialize Sub-Agent Web Harvester for daily officer data collection
  try {
    const { subAgentHarvester } = await import('./subAgentWebHarvester');
    await subAgentHarvester.initialize();
    console.log('[STARTUP] ✓ Sub-Agent Web Harvester initialized (daily 2:30 UTC)');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Sub-Agent Web Harvester failed:', error?.message ?? error);
  }

  // Initialize Sub-Agent Harvester with failover logging and population priority
  try {
    const { initializeHarvester } = await import('./subAgentHarvester');
    await initializeHarvester({
      dailyHarvestHourUTC: 3,
      dailyHarvestMinuteUTC: 0,
      maxSearchesPerCycle: 15,
      highPopulationThreshold: 100000,
      mediumPopulationThreshold: 25000
    });
    console.log('[STARTUP] ✓ Sub-Agent Harvester initialized (daily 3:00 UTC)');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Sub-Agent Harvester failed:', error?.message ?? error);
  }

  // Initialize Unified Maintenance Worker for weekly system maintenance
  try {
    const { maintenanceWorker } = await import('./maintenanceWorker');
    await maintenanceWorker.initialize();
    console.log('[STARTUP] ✓ Maintenance Worker initialized (weekly Sunday 3:00 UTC)');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Maintenance Worker failed:', error?.message ?? error);
  }

  startupTrace('background_services_completed');
}

app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  res.json = function (bodyJson: any) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        try {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        } catch {
          logLine += ' :: [unserializable JSON]';
        }
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

app.get("/api/health", (req, res) => {
  const requestStartedAt = Date.now();
  startupTrace('health_request_received', {
    host: req.get('host') ?? null,
    userAgent: req.get('user-agent') ?? null,
    ready: isReady,
    fullyInitialized: isFullyInitialized,
    hasStartupError: Boolean(startupError),
  });

  res.once('finish', () => {
    startupTrace('health_response_sent', {
      statusCode: res.statusCode,
      durationMs: Date.now() - requestStartedAt,
      ready: isReady,
      fullyInitialized: isFullyInitialized,
      hasStartupError: Boolean(startupError),
      hasBackgroundInitializationError: Boolean(backgroundInitializationError),
    });
  });

  if (isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }

  const status = startupError
    ? 'failed'
    : isFullyInitialized && databaseInitialized
      ? 'healthy'
      : backgroundInitializationError || (isFullyInitialized && !databaseInitialized)
        ? 'degraded'
        : isReady
          ? 'starting'
          : 'initializing';

  // Cheap runtime liveness intentionally does not wait on a database probe.
  // Railway deployment admission is the strict /api/ready endpoint below.
  const httpStatus = isReady && !startupError ? 200 : 503;

  res.status(httpStatus).json({
    status,
    ready: isReady,
    fullyInitialized: isFullyInitialized,
    startupError,
    backgroundInitializationError,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: { initialized: databaseInitialized },
    env: {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      groqConfigured: !!process.env.GROQ_API_KEY,
      mistralConfigured: !!process.env.MISTRAL_API_KEY,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    },
    aiProviders: {
      gemini: { model: 'gemini-2.5-pro', available: !!process.env.GEMINI_API_KEY },
      groq: { model: 'llama-3.3-70b-versatile', available: !!process.env.GROQ_API_KEY },
      mistral: { model: 'mistral-small-latest', available: !!process.env.MISTRAL_API_KEY },
      claude: { model: 'claude-haiku-4-5-20251001', available: !!process.env.ANTHROPIC_API_KEY },
    },
    recommendedModelsByUseCase: {
      user: getAIModel('user'),
      autonomous: getAIModel('autonomous'),
      legal: getAIModel('legal'),
      analysis: getAIModel('analysis'),
    },
    bestModelPerProvider: BEST_MODELS_PER_PROVIDER,
  });
});

startupTrace('health_route_registered');

app.get("/api/ready", (_req, res) => {
  // Railway promotes a deployment only after this endpoint returns 200.
  // Database admission is explicit even though full initialization also depends on it.
  if (isFullyInitialized && databaseInitialized && !isShuttingDown && !startupError) {
    res.status(200).json({ ready: true, fullyInitialized: true, databaseInitialized: true });
  } else {
    res.status(503).json({ 
      ready: isReady,
      fullyInitialized: isFullyInitialized,
      databaseInitialized,
      shuttingDown: isShuttingDown,
      startupError,
    });
  }
});

app.get("/api/schema-verify", async (_req, res) => {
  try {
    const { verifyDatabaseSchema } = await import('./db');
    const result = await verifyDatabaseSchema();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      connectionSource: process.env.SUPABASE_DATABASE_URL ? 'SUPABASE_DATABASE_URL' : 'DATABASE_URL'
    });
  }
});

(async () => {
  try {
  startupTrace('bootstrap_started');
  console.log('[STARTUP] LegalWhat Server starting...');
  console.log('[STARTUP] Node.js version:', process.version);
  console.log('[STARTUP] Environment:', process.env.NODE_ENV || 'development');
const rawPort = process.env.PORT ?? null;
const port = Number(rawPort) || 3000;
const listenHost = '0.0.0.0';
startupTrace('listen_prepared', { rawPort, resolvedPort: port, host: listenHost });
httpServer = createServer(app); 
  startupTrace('http_server_created');

  httpServer.on('error', (error: any) => {
    startupError = error?.message ?? 'HTTP server failed to start';
    startupTrace('http_server_error', { error: startupError });
    console.error('[SERVER ERROR]', error);
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    startupTrace('listen_invoked', { rawPort, resolvedPort: port, host: listenHost });
    httpServer!.listen(port, listenHost, () => {
      isReady = true;
      console.log(`[LISTENING] ${port} - server ready`);
      const address = httpServer?.address();
      startupTrace('listening_callback', {
        rawPort,
        resolvedPort: port,
        host: listenHost,
        address: typeof address === 'string' ? address : address?.address ?? null,
        boundPort: typeof address === 'string' ? null : address?.port ?? null,
      });
      resolve();
    });
  });

  // Bootstrap admission is intentionally serialized before the heavyweight route
  // graph is imported. Several route modules schedule autonomous/background work
  // at module load; importing them before Stage 1 was proven caused optional DB
  // consumers and CryptoCrawler admission probes to compete with the one query
  // whose job was to establish database readiness.
  try {
    const databaseReady = await initializeDatabase();
    if (!databaseReady) {
      throw new Error('Database initialization did not establish a usable connection');
    }
    databaseInitialized = true;

    await runMigrations();

    const { initializeGovernance } = await import('./services/cryptocrawl/governance/index.js');
    await initializeGovernance();

    // Schema verification is global application telemetry. A degraded/missing
    // CryptoCrawler authority object must not take down unrelated LegalWhat
    // availability; CryptoCrawler lifecycle entry independently verifies and
    // fails closed on its migration-owned authority schema before execution.
    const { runStartupSchemaVerification } = await import('./db');
    const schemaReady = await runStartupSchemaVerification();
    if (!schemaReady) {
      backgroundInitializationError = 'Startup schema verification reported degraded database schema';
      startupTrace('database_schema_degraded');
      console.warn('[STARTUP] ⚠ Production schema verification reported degraded state; scoped runtime authorities remain fail-closed');
    }
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    startupTrace('core_initialization_failed', { error: startupError });
    console.error('[STARTUP] ❌ Core initialization failed:', error);
    return;
  }

startupTrace('routes_import_started');
const { registerRoutes } = await import("./routes");
startupTrace('routes_import_completed');
startupTrace('routes_registration_started');
await registerRoutes(app);
startupTrace('routes_registration_completed');
  // Heavy route-owned subsystems can now initialize against a proven database.
  

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    console.error('[ERROR]', status, message);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  // Dynamic SEO endpoints MUST be registered BEFORE static file serving
  // Uses centralized SEO_CONFIG for consistency
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const { SEO_CONFIG, BASE_URL } = await import("../shared/seoConfig");
      
      res.type("application/xml");
      const today = new Date().toISOString().split('T')[0];
      
      const sitemapEntries = Object.entries(SEO_CONFIG)
        .filter(([_, config]) => config.includeInSitemap && !config.noIndex)
        .sort((a, b) => b[1].priority - a[1].priority);

      const urls = sitemapEntries.map(([path, config]) => `
  <url>
    <loc>${BASE_URL}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${config.changefreq}</changefreq>
    <priority>${config.priority.toFixed(1)}</priority>
  </url>`).join('');

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <!-- Dynamic Sitemap Generated from SEO_CONFIG ${today} -->${urls}
</urlset>`;

      res.send(sitemap);
    } catch (error) {
      console.error('[Sitemap] Error generating sitemap:', error);
      res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  // Static file serving AFTER dynamic routes
  app.use(express.static("public"));
  
  // Serve CryptoCrawl dashboard UI
  app.use(express.static("server/services/cryptocrawl/ui"));

  if (process.env.NODE_ENV !== 'production') {
    // Dynamically import Vite only in development to avoid bundling it in production
    try {
      const { setupVite } = await import("./vite");
      await setupVite(app, httpServer);
    } catch (error) {
      console.error('[STARTUP] ❌ Failed to initialize Vite development server:', error);
      console.error('[STARTUP] Falling back to static file serving');
      serveStatic(app);
    }
  } else {
    startupTrace('static_serving_started');
    serveStatic(app);
    startupTrace('static_serving_completed');
  }

  try {
    await initializeServices();
    
    isFullyInitialized = true;
    startupTrace('application_ready');
    console.log('[STARTUP] ✓ Server fully initialized and ready');
  } catch (error) {
    backgroundInitializationError = error instanceof Error ? error.message : String(error);
    startupTrace('background_initialization_failed', { error: backgroundInitializationError });
    console.error('[STARTUP] ⚠ Background initialization failed:', error);
  }
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    startupTrace('bootstrap_failed_before_listening', { error: startupError });
    console.error('[STARTUP] ❌ Bootstrap failed before listening:', error);
    process.exit(1);
  }
})();
