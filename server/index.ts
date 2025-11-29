import * as dotenv from 'dotenv';
dotenv.config();

import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// API request/response logger (unchanged)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  res.json = function (bodyJson: any, ...args: any[]) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...args);
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

// Health endpoint (prevents 404 failures and supports Railway healthcheck)
app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  let dbLatency = null;
  try {
    const { db } = await import('./db');
    const start = Date.now();
    if ((db as any).execute) await (db as any).execute('SELECT 1');
    else if ((db as any).query) await (db as any).query('SELECT 1');
    dbLatency = Date.now() - start;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    database: { ok: dbOk, latencyMs: dbLatency },
    env: {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      groqConfigured: !!process.env.GROQ_API_KEY
    }
  });
});

(async () => {
  console.log('[STARTUP] Verifying database connection...');
  try {
    const { db } = await import('./db');
    await db.execute('SELECT 1');
    console.log('[STARTUP] ✓ Database connection verified');
  } catch (error: any) {
    console.error('[STARTUP] ❌ Database connection failed:', error?.message ?? error);
    console.log('[STARTUP] Attempting to reset database pool...');
    try {
      const { resetPool } = await import('./db');
      await resetPool();
      console.log('[STARTUP] ✓ Database pool reset successful');
    } catch (resetError) {
      console.error('[STARTUP] ❌ Database pool reset failed:', resetError);
      console.error('[STARTUP] Server starting anyway');
    }
  }

  const server = await registerRoutes(app);

  // Centralized error handler (no rethrow to prevent crash)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    console.error('[ERROR]', status, message);
    res.status(status).json({ error: message });
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
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number.parseInt(process.env.PORT || '5000', 10);
  
  server.on('error', (error: any) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[STARTUP] ❌ Port ${port} is already in use`);
      const fallbackPort = port + 1;
      server.listen({
        port: fallbackPort,
        host: "0.0.0.0",
      }, () => {
        log(`serving on fallback port ${fallbackPort}`);
      });
    } else {
      console.error('[SERVER ERROR]', error);
    }
  });
  
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });

  const { persistenceManager } = await import('./persistenceManager');
  await persistenceManager.start();

  try {
    const { createSubAgentTables } = await import('./migrations/createSubAgentTables');
    await createSubAgentTables();
  } catch (error) {
    console.error('Failed to create Sub-Agent tables:', error);
  }

  try {
    const { createTokenMetricsTables } = await import('./migrations/createTokenMetrics');
    await createTokenMetricsTables();
  } catch (error) {
    console.error('Failed to create Token Metrics tables:', error);
  }

  try {
    const { createDeviceRateLimitTables } = await import('./migrations/createDeviceRateLimitTables');
    await createDeviceRateLimitTables();
  } catch (error) {
    console.error('Failed to create Device Rate Limit tables:', error);
  }

  // FIXED: Proper worker import and initialization
  try {
    const { badblueWorker } = await import('./badblueWorker');
    await badblueWorker.initialize();
  } catch (error: any) {
    console.error('Failed to start BadBlue Worker:', error?.message || error);
  }
})();
