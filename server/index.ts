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
import {
  CURRENT_AI_MODELS,
  HARMONY_17_PARTICIPANTS,
  getConfiguredHarmonyParticipants,
} from './aiHarmonyModelRegistry';
import { getHarmonyWarmStatus, prewarmHarmonyProviders } from './aiHarmonyWarmup';
import { getLexaraCrawlerReadiness } from './lexara/LexaraCrawlerCapabilityRegistry';

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

import { releaseRollingDeploymentPoolHeadroom } from "./migrations/reconcileAppSchema";

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

type DatabaseRuntimeMode = 'initializing' | 'primary' | 'overflow_proxy' | 'neon_failover';

let isReady = false;
let isFullyInitialized = false; // Tracks full HTTP/application surface initialization
let isShuttingDown = false;
let startupError: string | null = null;
let backgroundInitializationError: string | null = null;
let databaseInitialized = false;
let overflowDatabaseReady = false;
let authStoreReady = false;
let databaseRuntimeMode: DatabaseRuntimeMode = 'initializing';
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
      const { stopCryptoCrawlerRuntime, systemState } = await import('./services/cryptocrawl/api/admin-api.js');
      if (systemState.lifecycle !== 'STOPPED') {
        const runtimeStop = await stopCryptoCrawlerRuntime();
        if (!runtimeStop.stopped) {
          console.warn('[SHUTDOWN] CryptoCrawler stop left unresolved components:', runtimeStop.failures);
        } else {
          console.log('[SHUTDOWN] CryptoCrawler stopped');
        }
      }
    } catch (e) {
      console.warn('[SHUTDOWN] Error stopping CryptoCrawler:', e);
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
      const { pool, coordinationPool } = await import('./db');
      await Promise.allSettled([
        pool?.end ? pool.end() : Promise.resolve(),
        coordinationPool?.end ? coordinationPool.end() : Promise.resolve(),
      ]);
      console.log('[SHUTDOWN] Application database pools closed');
    } catch (e) {
      console.warn('[SHUTDOWN] Error closing application database pools:', e);
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

const STARTUP_DATABASE_MAX_PROBES = 5;
const STARTUP_DATABASE_ADMISSION_CAP_MS = 120_000;

function databaseRetryDelayMs(attempt: number, baseMs: number = 4_000, maxMs: number = 25_000): number {
  const exponent = Math.min(6, Math.max(0, attempt - 1));
  const capMs = Math.min(maxMs, baseMs * Math.pow(2, exponent));
  const floorMs = Math.min(2_000, Math.max(500, Math.floor(capMs / 3)));
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

function isSupavisorTransactionRouteUnavailable(error: unknown): boolean {
  const message = databaseErrorText(error);
  return (
    message.includes('eauthquery') ||
    (
      message.includes('xx000') &&
      message.includes('authentication query failed') &&
      message.includes('connection to database not available')
    )
  );
}

function isDatabaseAdmissionPressureError(error: unknown): boolean {
  const message = databaseErrorText(error);
  const timeoutContext = message.includes('timeout') || message.includes('timed out') || message.includes('connection terminated');
  return (
    isSupavisorTransactionRouteUnavailable(error) ||
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
  const requestedBudgetMs = Number.isFinite(configuredBudgetMs) ? configuredBudgetMs : defaultBudgetMs;
  // Startup admission must be patient enough for a transient Supavisor queue,
  // but it must never spend the full Railway health window repeatedly opening
  // new client connections against an already pressured database.
  return Math.max(30_000, Math.min(safeUpperBoundMs, STARTUP_DATABASE_ADMISSION_CAP_MS, requestedBudgetMs));
}

async function retryDatabaseProbeWithinBudget(): Promise<void> {
  const budgetMs = startupDatabaseAdmissionBudgetMs();
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: unknown = null;
  let sessionFallbackAttempted = false;

  while (Date.now() - startedAt < budgetMs && attempt < STARTUP_DATABASE_MAX_PROBES) {
    attempt += 1;
    try {
      // Use the canonical node-postgres pool directly for the readiness probe.
      // This preserves the real PostgreSQL/Supavisor error code and cause instead
      // of hiding it behind a Drizzle "Failed query" wrapper.
      const { pool } = await import('./db');
      await pool.query({ text: 'SELECT 1', query_timeout: 5_000 });
      if (attempt > 1) {
        console.log(`[RETRY] Database admission recovered on attempt ${attempt} after ${Date.now() - startedAt}ms`);
      }
      return;
    } catch (error: any) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const admissionPressure = isDatabaseAdmissionPressureError(error);
      const errorText = databaseErrorText(error).slice(0, 700);
      console.warn(`[RETRY] Database probe ${attempt}/${STARTUP_DATABASE_MAX_PROBES} failed after ${elapsedMs}ms: ${errorText}`);

      if (isPermanentDatabaseStartupError(error) || isLocalPoolFailure(error)) {
        throw error;
      }

      if (!sessionFallbackAttempted && isSupavisorTransactionRouteUnavailable(error)) {
        sessionFallbackAttempted = true;
        try {
          const { activateApplicationSessionFallback } = await import('./db');
          const admitted = await activateApplicationSessionFallback('transaction_pool_auth_backend_unavailable');
          if (admitted) {
            console.warn('[RETRY] LegalWhat admitted through bounded Supavisor session fallback');
            return;
          }
        } catch (fallbackError: any) {
          lastError = fallbackError;
          console.warn(`[RETRY] Supavisor session fallback unavailable: ${databaseErrorText(fallbackError).slice(0, 700)}`);
        }
      }

      const remainingMs = Math.max(0, budgetMs - elapsedMs);
      if (remainingMs <= 0 || attempt >= STARTUP_DATABASE_MAX_PROBES) break;

      // One serialized probe at a time. Exponential jitter gives Supavisor/Postgres
      // room to recover instead of creating a reconnect storm during a rollout.
      const waitTime = Math.min(databaseRetryDelayMs(attempt), remainingMs);
      console.log(`[RETRY] Database admission ${admissionPressure ? 'pressure' : 'transient failure'}; backing off ${waitTime}ms (${remainingMs}ms budget remaining)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`database admission budget exhausted after ${budgetMs}ms`);
}

async function initializeDatabase(): Promise<boolean> {
  startupTrace('database_initialization_started');
  console.log('[STARTUP] Stage 1: Database connection (Neon-first while explicitly configured; Supabase authority preserved)...');

  let lastError: unknown = null;

  // NEON_DATABASE_URL is an explicit operator signal that LegalWhat should use
  // the already-provisioned standby immediately. This avoids burning the Railway
  // health window retrying a known-unavailable Supabase control plane. The Neon
  // activation routine schema-gates the standby before it can become authoritative.
  try {
    const { activateLegalWhatNeonFallback, isLegalWhatNeonFailoverConfigured } = await import('./db');
    if (isLegalWhatNeonFailoverConfigured) {
      const activated = await activateLegalWhatNeonFallback('explicit_neon_runtime_configured');
      if (activated) {
        await retryDatabaseProbeWithinBudget();
        databaseRuntimeMode = 'neon_failover';
        console.warn('[STARTUP] ✓ LegalWhat admitted immediately through schema-gated Neon runtime');
        startupTrace('database_initialization_completed', { connected: true, recovered: true, lane: 'neon_failover' });
        return true;
      }
    }
  } catch (neonError: any) {
    lastError = neonError;
    console.warn('[STARTUP] Immediate Neon admission unavailable; falling back to preserved Supabase path:', neonError?.message ?? neonError);
  }

  // Supabase remains the preserved authority/fallback. If Neon is absent or
  // cannot pass its real schema/query proof, retain the existing bounded primary
  // admission behavior rather than making the application unavailable.
  try {
    await retryDatabaseProbeWithinBudget();
    databaseRuntimeMode = 'primary';
    console.log('[STARTUP] ✓ Supabase database connection verified');
    startupTrace('database_initialization_completed', { connected: true, recovered: false, lane: 'primary' });
    return true;
  } catch (error: any) {
    lastError = error;
    console.error('[STARTUP] ❌ Database admission window ended:', error?.message ?? error);
  }

  // Recreate pools only when the local node-postgres pool itself is positively
  // known to be closed/corrupt. Upstream overload, auth/config failures and
  // unknown transient network errors must never create a two-lane reconnect burst.
  if (isLocalPoolFailure(lastError)) {
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
  } else if (isPermanentDatabaseStartupError(lastError)) {
    console.error('[STARTUP] Permanent database configuration/authentication failure; pool reset suppressed');
  } else {
    console.warn('[STARTUP] Unknown transient database/network failure; pool reset suppressed to avoid reconnect amplification');
  }

  console.warn('[STARTUP] Database unavailable and overflow is unavailable; deployment remains unready');
  startupTrace('database_initialization_completed', {
    connected: false,
    admissionPressure: isDatabaseAdmissionPressureError(lastError),
    permanentFailure: isPermanentDatabaseStartupError(lastError),
    localPoolFailure: isLocalPoolFailure(lastError),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}

async function waitForOverflowBootstrapReadiness(): Promise<boolean> {
  // CryptoCrawler is operator-controlled. Server readiness must never wake its
  // Overflow bridge, workers, schema verifier, or database pools while Master
  // Power is OFF.
  startupTrace('cryptocrawler_overflow_bootstrap_deferred', {
    reason: 'manual_master_power_off',
    databaseIo: false,
    workerStartup: false,
  });
  return false;
}

// Schema mutation is deliberately excluded from application startup.
// Production migrations are an administrative deployment concern; runtime only
// verifies the already-prepared schema before Railway readiness can become 2xx.
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

  // Warm provider model catalogs and transport capability state in the
  // background. It never gates Railway readiness or the conversation path.
  void prewarmHarmonyProviders()
    .then(statuses => {
      const ready = statuses.filter(status => status.state === 'ready').length;
      const catalog = statuses.filter(status => status.state === 'catalog').length;
      const degraded = statuses.filter(status => status.state === 'degraded').length;
      console.log(`[HARMONY] Provider prewarm complete: ${ready} inference-ready, ${catalog} catalog-eligible, ${degraded} degraded`);
    })
    .catch(error => {
      console.warn('[HARMONY] Provider prewarm failed route-locally:', error instanceof Error ? error.message : String(error));
    });

  try {
    const { persistenceManager } = await import('./persistenceManager');
    await persistenceManager.start();
    console.log('[STARTUP] ✓ Persistence manager started');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Persistence manager failed:', error?.message ?? error);
  }

  console.log('[STARTUP] ✓ CryptoCrawler services deferred; Master Power remains OFF until explicit dashboard start');

  // CryptoCrawler is an operator-controlled runtime. Process/bootstrap readiness
  // initializes shared dependencies only; discovery/execution must remain stopped
  // until an authenticated master explicitly presses Start on the dashboard.
  console.log('[STARTUP] ✓ CryptoCrawler runtime remains STOPPED pending explicit master start');

  try {
    const { badblueWorker } = await import('./badblueWorker');
    await badblueWorker.initialize();
    console.log('[STARTUP] ✓ LegalWhat Worker initialized');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ LegalWhat Worker failed:', error?.message ?? error);
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

// Officer harvesting is an optional 36-hour background workload. It must not hold
// Railway deployment admission behind its legacy session/priority DB warm-up reads.
// The harvester still owns exactly one timer and keeps its existing idempotent guard.
async function initializeOptionalServicesAfterReadiness(): Promise<void> {
  startupTrace('optional_services_started');

  if (process.env.SUBAGENT_ENABLE_OFFICER_SEARCH === 'true') {
    try {
      const { initializeHarvester } = await import('./subAgentHarvester');
      await initializeHarvester();
      console.log('[STARTUP] ✓ Canonical Sub-Agent Harvester initialized (36h adaptive interval)');
    } catch (error: any) {
      console.warn('[STARTUP] ⚠ Canonical Sub-Agent Harvester failed:', error?.message ?? error);
    }
  } else {
    console.log('[STARTUP] ✓ Canonical Sub-Agent Harvester disabled by SUBAGENT_ENABLE_OFFICER_SEARCH');
  }

  startupTrace('optional_services_completed');
}

app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Handle signed Resend incoming-email notifications before deferred route initialization.
import { registerResendForwardingWebhook } from "./routes/resendForwardingWebhook";
registerResendForwardingWebhook(app);
app.use(cookieParser());

// robots.txt must be available from the instant the HTTP listener opens.
// Keep this isolated from database/application initialization so crawlers never
// observe a transient startup 404 for the crawler-control file.
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").sendFile("robots.txt", { root: "public" });
});

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
    database: {
      initialized: databaseInitialized,
      overflowReady: overflowDatabaseReady,
      mode: databaseRuntimeMode,
    },
    env: {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      groqConfigured: !!process.env.GROQ_API_KEY,
      mistralConfigured: !!process.env.MISTRAL_API_KEY,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    },
    aiProviders: {
      gemini: { model: CURRENT_AI_MODELS.gemini, available: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) },
      groq: { model: CURRENT_AI_MODELS.groqDeep, available: !!process.env.GROQ_API_KEY },
      mistral: { model: CURRENT_AI_MODELS.mistralFast, available: !!process.env.MISTRAL_API_KEY },
      claude: { model: CURRENT_AI_MODELS.claudeBalanced, available: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) },
    },
    lexaraCrawlerPool: {
      total: getLexaraCrawlerReadiness().length,
      configured: getLexaraCrawlerReadiness().filter(crawler => crawler.configured).length,
      crawlers: getLexaraCrawlerReadiness(),
    },
    harmony: {
      participantCount: HARMONY_17_PARTICIPANTS.length,
      configuredCount: getConfiguredHarmonyParticipants().length,
      participants: HARMONY_17_PARTICIPANTS.map(participant => ({
        provider: participant.provider,
        model: participant.model,
        configured: participant.configured(),
        capabilities: participant.capabilities,
      })),
      warmStatus: getHarmonyWarmStatus(),
    },
    recommendedModelsByUseCase: {
      user: getAIModel('user'),
      autonomous: getAIModel('autonomous'),
      legal: getAIModel('legal'),
      analysis: getAIModel('analysis'),
    },
    bestModelPerProvider: Object.fromEntries(
      HARMONY_17_PARTICIPANTS.map(participant => [participant.provider, participant.model]),
    ),
  });
});

startupTrace('health_route_registered');

app.get("/api/ready", (_req, res) => {
  const usableDataPlane = databaseInitialized || overflowDatabaseReady;
  // Local credential-store degradation is route-local. Stateless master recovery
  // remains available without the ordinary auth store, so Railway readiness must
  // reflect whether the application/data plane is usable rather than globally
  // failing because one login backend is degraded.
  if (isFullyInitialized && usableDataPlane && !isShuttingDown && !startupError) {
    res.status(200).json({
      ready: true,
      fullyInitialized: true,
      databaseInitialized,
      overflowDatabaseReady,
      authStoreReady,
      databaseMode: databaseRuntimeMode,
    });
  } else {
    res.status(503).json({ 
      ready: isReady,
      fullyInitialized: isFullyInitialized,
      databaseInitialized,
      overflowDatabaseReady,
      authStoreReady,
      databaseMode: databaseRuntimeMode,
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

  // Realtime LEXARA voice attaches to the actual listening server. The route
  // is additive and failure-local: legacy HTTP STT/TTS remains available.
  try {
    const { attachLexaraRealtimeVoiceGateway } = await import('./lexara/LexaraRealtimeVoiceGateway');
    attachLexaraRealtimeVoiceGateway(httpServer);
    startupTrace('lexara_realtime_voice_gateway_attached');
  } catch (error) {
    console.warn('[LEXARA Realtime] Gateway attachment skipped; legacy voice remains active', error);
    startupTrace('lexara_realtime_voice_gateway_degraded', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

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

  // LegalWhat proves only its ordinary application database here. CryptoCrawler's
  // Overflow data plane is deliberately absent from process bootstrap and can be
  // opened only by the authenticated /admin/crypto/start lifecycle.
  try {
    const applicationDatabaseReady = await initializeDatabase();
    if (!applicationDatabaseReady) {
      throw new Error('LegalWhat application database did not establish a usable startup data plane');
    }

    databaseInitialized = true;
    overflowDatabaseReady = false;
    const { getApplicationDatabaseRuntimeMode } = await import('./db');
    databaseRuntimeMode = getApplicationDatabaseRuntimeMode() === 'neon_failover' ? 'neon_failover' : 'primary';

    startupTrace('schema_mutation_skipped', { policy: 'runtime_verification_only' });
    console.log('[STARTUP] Stage 2: Runtime schema mutation disabled; verifying prepared schema only');
    releaseRollingDeploymentPoolHeadroom('application_database_ready');

    const { runStartupSchemaVerification } = await import('./db');
    const schemaReady = await runStartupSchemaVerification();
    if (!schemaReady) {
      backgroundInitializationError = 'Startup schema verification reported degraded database schema';
      startupTrace('database_schema_degraded');
      console.warn('[STARTUP] ⚠ Production schema verification reported degraded state; scoped runtime authorities remain fail-closed');
    }

    startupTrace('cryptocrawler_master_power_off_at_boot', {
      lifecycle: 'STOPPED',
      overflowProbeIssued: false,
      cryptoDatabaseIo: false,
    });
    console.log('[STARTUP] ✓ CryptoCrawler Master Power OFF: no CryptoCrawler Overflow probe, worker, schema I/O, or market activity started');
  } catch (error) {
    // The ordinary Supabase data plane is an external dependency. A temporary
    // outage must not prevent the HTTP/static/stateless surface from starting.
    // Database-backed routes remain fail-closed at their own dependency boundary,
    // while readiness/health telemetry continues to report the degraded state.
    backgroundInitializationError = error instanceof Error ? error.message : String(error);
    databaseInitialized = false;
    overflowDatabaseReady = false;
    databaseRuntimeMode = 'initializing';
    startupTrace('core_database_degraded_route_local', { error: backgroundInitializationError });
    console.warn('[STARTUP] ⚠ Application database unavailable; continuing in bounded degraded mode:', error);
  }

startupTrace('routes_import_started');
const { registerRoutes } = await import("./routes");
startupTrace('routes_import_completed');
startupTrace('routes_registration_started');
await registerRoutes(app);
startupTrace('routes_registration_completed');

  // Local-account authentication is intentionally route-local. Master recovery is
  // stateless and must remain available even when the ordinary credential store is
  // degraded. Probe local auth in the background for observability/recovery without
  // turning a scoped dependency outage into a whole-application deployment failure.
  startupTrace('auth_store_readiness_started');
  void (async () => {
    const { probeLocalAuthStoreHttp, isLocalTrialSchemaReady } = await import('./statelessLocalAuth');
    let lastAuthStoreError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await probeLocalAuthStoreHttp();
        authStoreReady = true;
        const trialSchemaReady = await isLocalTrialSchemaReady();
        startupTrace('auth_store_ready', { attempt, trialSchemaReady });
        console.log('[STARTUP] ✓ LegalWhat local authentication store ready', { trialSchemaReady });
        return;
      } catch (error) {
        lastAuthStoreError = error;
        startupTrace('auth_store_readiness_retry', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    const detail = lastAuthStoreError instanceof Error
      ? lastAuthStoreError.message
      : String(lastAuthStoreError || 'unknown authentication store error');
    startupTrace('auth_store_degraded_route_local', { error: detail });
    console.warn('[STARTUP] ⚠ Local authentication store unavailable; stateless master recovery remains available and local login stays fail-closed', {
      error: detail,
    });
  })().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    startupTrace('auth_store_probe_background_failed', { error: detail });
    console.warn('[STARTUP] ⚠ Background local-auth probe failed; master recovery remains available', {
      error: detail,
    });
  });

  // With overflow proxy mode active, route and worker code may request primary
  // information normally; the bootstrap gateway prevents direct primary acquisition.
  

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
      
      const canonicalPaths = Object.values(SEO_CONFIG)
        .filter((config) => config.includeInSitemap && !config.noIndex)
        .map((config) => `${BASE_URL}${config.canonicalPath}`);
      // The static sitemap owns the expanded crawl inventory (40 practice areas,
      // Lexara discovery pages, guides, and document pages). Merge it into the
      // live endpoint so production does not accidentally expose only SPA routes.
      const { readFile } = await import("node:fs/promises");
      const staticSitemap = await readFile("public/sitemap.xml", "utf8");
      const staticUrls = [...staticSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      const urls = Array.from(new Set([...canonicalPaths, ...staticUrls])).map((url) => `
  <url>
    <loc>${url}</loc>
  </url>`).join('');

      // Do not emit synthetic freshness, priority, or change-frequency signals.
      // Search engines can infer crawl priority from links/content; lastmod must
      // only be used when it reflects the page's actual modification time.
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Canonical public URLs from SEO_CONFIG -->${urls}
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
    if (databaseInitialized) {
      await initializeServices();
    }
    
    isFullyInitialized = true;
    startupTrace('application_ready', {
      cryptocrawlerMasterPower: 'OFF',
      cryptocrawlerDatabaseIo: false,
    });
    console.log('[STARTUP] ✓ Server fully initialized; CryptoCrawler remains fully OFF pending manual dashboard start');

    // This optional workload starts only after strict readiness is true. Failures
    // remain isolated and cannot keep a healthy replacement deployment in 503.
    void initializeOptionalServicesAfterReadiness();
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
