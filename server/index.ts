import * as dotenv from 'dotenv';
dotenv.config();

import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import type { Server } from "http";

const app = express();

let isReady = false;
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
        console.log('[SHUTDOWN] BadBlue Worker stopped');
      }
    } catch (e) {
      console.warn('[SHUTDOWN] Error stopping worker:', e);
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
  
  const migrations = [
    { name: 'Sub-Agent tables', module: './migrations/createSubAgentTables', fn: 'createSubAgentTables' },
    { name: 'Token Metrics tables', module: './migrations/createTokenMetrics', fn: 'createTokenMetricsTables' },
    { name: 'Device Rate Limit tables', module: './migrations/createDeviceRateLimitTables', fn: 'createDeviceRateLimitTables' },
    { name: 'Petition tables', module: './migrations/createPetitionTables', fn: 'createPetitionTables' },
    { name: 'Public Evidence tables', module: './migrations/createPublicEvidenceTables', fn: 'createPublicEvidenceTables' },
  ];

  for (const migration of migrations) {
    try {
      const mod = await import(migration.module);
      if (mod[migration.fn]) {
        await mod[migration.fn]();
        console.log(`[STARTUP] ✓ ${migration.name} migration complete`);
      }
    } catch (error: any) {
      console.warn(`[STARTUP] ⚠ ${migration.name} migration skipped:`, error?.message ?? error);
    }
  }
}

async function initializeServices(): Promise<void> {
  console.log('[STARTUP] Stage 3: Initializing services...');
  
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
    console.log('[STARTUP] ✓ BadBlue Worker initialized');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ BadBlue Worker failed:', error?.message ?? error);
  }

  // Initialize Sub-Agent Web Harvester for daily officer data collection
  try {
    const { subAgentHarvester } = await import('./subAgentWebHarvester');
    await subAgentHarvester.initialize();
    console.log('[STARTUP] ✓ Sub-Agent Web Harvester initialized (daily 2:30 UTC)');
  } catch (error: any) {
    console.warn('[STARTUP] ⚠ Sub-Agent Web Harvester failed:', error?.message ?? error);
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

app.get("/api/health", async (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }

  let dbOk = false;
  let dbLatency = null;
  
  try {
    const { db } = await import('./db');
    const start = Date.now();
    await db.execute('SELECT 1');
    dbLatency = Date.now() - start;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const status = isReady && dbOk ? 'healthy' : isReady ? 'degraded' : 'starting';
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  res.status(httpStatus).json({
    status,
    ready: isReady,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: { ok: dbOk, latencyMs: dbLatency },
    env: {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      groqConfigured: !!process.env.GROQ_API_KEY,
      mistralConfigured: !!process.env.MISTRAL_API_KEY,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    },
    aiProviders: {
      gemini: { model: 'gemini-2.5-flash', available: !!process.env.GEMINI_API_KEY },
      groq: { model: 'llama-3.3-70b-versatile', available: !!process.env.GROQ_API_KEY },
      mistral: { model: 'mistral-large-latest', available: !!process.env.MISTRAL_API_KEY },
      claude: { model: 'claude-3-5-haiku-20241022', available: !!process.env.ANTHROPIC_API_KEY },
    }
  });
});

app.get("/api/ready", (_req, res) => {
  if (isReady && !isShuttingDown) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false, shuttingDown: isShuttingDown });
  }
});

(async () => {
  console.log('[STARTUP] BadBlue Server starting...');
  console.log('[STARTUP] Node.js version:', process.version);
  console.log('[STARTUP] Environment:', process.env.NODE_ENV || 'development');

  await initializeDatabase();

  httpServer = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    console.error('[ERROR]', status, message);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  app.use(express.static("public"));
  
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.sendFile("robots.txt", { root: "public" });
  });

  app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml");
    res.sendFile("sitemap.xml", { root: "public" });
  });

  if (app.get("env") === "development") {
    await setupVite(app, httpServer);
  } else {
    serveStatic(app);
  }

  const port = Number.parseInt(process.env.PORT || '5000', 10);
  
  httpServer.on('error', (error: any) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[STARTUP] ❌ Port ${port} is already in use`);
      const fallbackPort = port + 1;
      httpServer!.listen({
        port: fallbackPort,
        host: "0.0.0.0",
      }, () => {
        log(`serving on fallback port ${fallbackPort}`);
        isReady = true;
      });
    } else {
      console.error('[SERVER ERROR]', error);
    }
  });
  
  httpServer.listen({
    port,
    host: "0.0.0.0",
  }, async () => {
    log(`serving on port ${port}`);
    
    await runMigrations();
    await initializeServices();
    
    isReady = true;
    console.log('[STARTUP] ✓ Server fully initialized and ready');
  });
})();
