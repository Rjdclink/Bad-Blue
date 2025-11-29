// Copyright (c) 2025 Robert “RJDC” Clinkenbeard. All rights reserved.
// Unauthorized copying, modification, distribution, or use of this file,
// via any medium, is strictly prohibited without express written permission.

import * as dotenv from 'dotenv';
dotenv.config();

// Verify Stripe keys are configured
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[ENV] ⚠️ STRIPE_SECRET_KEY not set in environment variables');
}
if (!process.env.VITE_STRIPE_PUBLIC_KEY) {
  console.error('[ENV] ⚠️ VITE_STRIPE_PUBLIC_KEY not set in environment variables');
}

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

// API request/response logger
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

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    res.status(status).json({ message });
    throw err;
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
      throw error;
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

  try {
    const { badblueWorker } = await import('./badblueWorker');
    if (!badblueWorker?.initialize) {
      throw new Error("The badblueWorker module does not export an initialize function.");
    }
    await badblueWorker.initialize();
  } catch (error) {
    console.error('Failed to start BadBlue Worker:', error);
  }
})();
