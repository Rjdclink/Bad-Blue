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
import type { Server } from "http";

// Static imports for migrations - ensures esbuild bundles them (dynamic imports don't work with bundlers)
import { runSquareMigration } from "./migrations/runSquareMigration";
import { addUsersStatusColumn } from "./migrations/add_users_status_column";
import { createCoreTables } from "./migrations/createCoreTables";
import { createSubAgentTables } from "./migrations/createSubAgentTables";
import { createTokenMetricsTables } from "./migrations/createTokenMetrics";
import { createDeviceRateLimitTables } from "./migrations/createDeviceRateLimitTables";
import { createPetitionTables } from "./migrations/createPetitionTables";
import { createPublicEvidenceTables } from "./migrations/createPublicEvidenceTables";
import { createComplaintRoutingTables } from "./migrations/createComplaintRoutingTables";
import { createFOIARoutingTables } from "./migrations/createFOIARoutingTables";
import { createSearchPrioritizationTables } from "./migrations/createSearchPrioritizationTables";
import { createDocumentCreatorTables } from "./migrations/createDocumentCreatorTables";

const app = express();

let isReady = false;
let isFullyInitialized = false; // Tracks full service initialization
let isShuttingDown = false;
let httpServer: Server | null = null;

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

async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  backoffMultiplier: number = 2
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.warn(`[RETRY] Attempt ${attempt}/${maxRetries} failed:`, error?.message ?? error);
      
      if (attempt < maxRetries) {
        const waitTime = delayMs * Math.pow(backoffMultiplier, attempt - 1);
        console.log(`[RETRY] Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

async function initializeDatabase(): Promise<void> {
  console.log('[STARTUP] Stage 1: Database connection...');
  
  try {
    await retryAsync(async () => {
      const { db } = await import('./db');
      await db.execute('SELECT 1');
    }, 3, 2000);
    console.log('[STARTUP] ✓ Database connection verified');
  } catch (error: any) {
    console.error('[STARTUP] ❌ Database connection failed after retries:', error?.message ?? error);
    console.log('[STARTUP] Attempting pool reset...');
    
    try {
      const { resetPool } = await import('./db');
      await resetPool();
      
      const { db } = await import('./db');
      await db.execute('SELECT 1');
      console.log('[STARTUP] ✓ Database pool reset successful');
    } catch (resetError: any) {
      console.error('[STARTUP] ❌ Database pool reset failed:', resetError?.message ?? resetError);
      console.warn('[STARTUP] Starting with degraded database connectivity');
    }
  }
}

async function runMigrations(): Promise<void> {
  console.log('[STARTUP] Stage 2: Running migrations...');
  
  // Using static imports (defined at top of file) - ensures esbuild includes migrations in bundle
  // Dynamic imports don't work with bundlers because they can't analyze variable-based import paths
  const migrations: Array<{ name: string; fn: () => Promise<unknown> }> = [
    { name: 'Square Payment Migration', fn: runSquareMigration },
    { name: 'Users Status Column', fn: addUsersStatusColumn },
    { name: 'Core tables', fn: createCoreTables },
    { name: 'Sub-Agent tables', fn: createSubAgentTables },
    { name: 'Token Metrics tables', fn: createTokenMetricsTables },
    { name: 'Device Rate Limit tables', fn: createDeviceRateLimitTables },
    { name: 'Petition tables', fn: createPetitionTables },
    { name: 'Public Evidence tables', fn: createPublicEvidenceTables },
    { name: 'Complaint Routing tables', fn: createComplaintRoutingTables },
    { name: 'FOIA Routing tables', fn: createFOIARoutingTables },
    { name: 'Search Prioritization tables', fn: createSearchPrioritizationTables },
    { name: 'Document Creator tables', fn: createDocumentCreatorTables },
  ];

  for (const migration of migrations) {
    try {
      await migration.fn();
      console.log(`[STARTUP] ✓ ${migration.name} migration complete`);
    } catch (error: any) {
      console.warn(`[STARTUP] ⚠ ${migration.name} migration skipped:`, error?.message ?? error);
    }
  }
}

async function initializeServices(): Promise<void> {
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

// Railway liveness endpoint. This must never depend on database, AI, governance,
// wallet, crawler, or route-tree initialization. Deep readiness remains /api/ready.
app.get("/api/health", (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }

  const httpStatus = isReady ? 200 : 503;

  return res.status(httpStatus).json({
    status: isFullyInitialized ? 'healthy' : isReady ? 'starting' : 'initializing',
    ready: isReady,
    fullyInitialized: isFullyInitialized,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get("/api/ready", (_req, res) => {
  // /api/ready returns 200 only when FULLY initialized (all migrations + services)
  // Use /api/health for deployment health checks (returns 200 when HTTP server is up)
  if (isFullyInitialized && !isShuttingDown) {
    res.status(200).json({ ready: true, fullyInitialized: true });
  } else {
    res.status(503).json({ 
      ready: isReady, 
      fullyInitialized: isFullyInitialized,
      shuttingDown: isShuttingDown 
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

async function initializeApplicationAfterListen(server: Server): Promise<void> {
  console.log('[STARTUP] Stage 0.5: Loading application routes after HTTP listener is live...');

  // Keep the massive route import graph out of the pre-listen critical path.
  const { registerRoutes } = await import('./routes');
  await registerRoutes(app);
  console.log('[STARTUP] ✓ Application routes registered');

  // registerRoutes historically creates its own unlistening Server only to attach
  // this WebSocket upgrade path. Attach the same WebSocket server to the real
  // listening Server so /api/crypto/live remains functional.
  const { wss } = await import('./services/cryptocrawl/api');
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/api/crypto/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

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
      await setupVite(app, server);
    } catch (error) {
      console.error('[STARTUP] ❌ Failed to initialize Vite development server:', error);
      console.error('[STARTUP] Falling back to static file serving');
      serveStatic(app);
    }
  } else {
    serveStatic(app);
  }
}

async function initializeBackgroundServices(): Promise<void> {
  await initializeDatabase();
  await runMigrations();

  // Run startup schema verification to confirm correct database connection
  const { runStartupSchemaVerification } = await import('./db');
  await runStartupSchemaVerification();

  await initializeServices();
}

(async () => {
  console.log('[STARTUP] LegalWhat Server starting...');
  console.log('[STARTUP] Node.js version:', process.version);
  console.log('[STARTUP] Environment:', process.env.NODE_ENV || 'development');

  const port = Number(process.env.PORT) || 3000;

  // Start the actual HTTP listener before importing the large application route tree.
  // Railway can now reach /api/health even while route/service initialization continues.
  httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`[LISTENING] ${port}`);
    isReady = true;
    console.log('[STARTUP] ✓ HTTP server listening - health checks can now pass');

    void (async () => {
      try {
        // Preserve the original initialization order, but move it off the
        // pre-listen critical path: routes first, then database/services.
        await initializeApplicationAfterListen(httpServer!);
        await initializeBackgroundServices();

        isFullyInitialized = true;
        console.log('[STARTUP] ✓ Server fully initialized and ready');
      } catch (error) {
        console.error('[STARTUP] ❌ Post-listen initialization failed:', error);
        console.warn('[STARTUP] Server remains live but not fully initialized');
      }
    })();
  });

  httpServer.on('error', (error: any) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[STARTUP] ❌ Port ${port} is already in use`);
    } else {
      console.error('[SERVER ERROR]', error);
    }
  });
})();
