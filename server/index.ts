// Copyright (c) 2025 “RJDC”. All rights reserved.
// Unauthorized copying, modification, distribution, or use of this file,
// via any medium, is strictly prohibited without express written permission.

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verify Stripe keys are configured
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[ENV] ⚠️ STRIPE_SECRET_KEY not set in environment variables');
}
if (!process.env.VITE_STRIPE_PUBLIC_KEY) {
  console.error('[ENV] ⚠️ VITE_STRIPE_PUBLIC_KEY not set in environment variables');
}

import { createClient } from "@supabase/supabase-js";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import path from "path";
import { fileURLToPath } from "url";
// Extend Express Request type for rawBody
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app = express();
app.use(express.json({
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.call(this, bodyJson, ...args);
  };

  const originalResSend = res.send;
  res.send = function (body, ...args) {
    // If it's already JSON, we capture it
    try {
      if (typeof body === "object") {
        capturedJsonResponse = body;
      } else if (typeof body === "string") {
        capturedJsonResponse = JSON.parse(body);
      }
    } catch {
      // Non-JSON response, ignore
    }

    return originalResSend.call(this, body, ...args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    if (!path.startsWith("/health")) {
      let logLine = `[${req.method}] ${path} - ${res.statusCode} in ${duration}ms`;

      if (capturedJsonResponse && typeof capturedJsonResponse === "object") {
        const sanitized = { ...capturedJsonResponse };

        if (sanitized.apiKey) {
          sanitized.apiKey = "***";
        }

        const jsonStr = JSON.stringify(sanitized);
        const snippet = jsonStr.length > 180
          ? jsonStr.slice(0, 177) + "..."
          : jsonStr;

        logLine += ` | response: ${snippet}`;
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
  // CRITICAL: Verify database connection FIRST before anything else
  console.log('[STARTUP] Verifying database connection...');
  try {
    const { db } = await import('./db');
    await db.execute('SELECT 1');
    console.log('[STARTUP] ✓ Database connection verified');
    
    // Ensure database schema is properly synced (handles Railway deployments)
    const { ensureSchemaSync } = await import('./ensureSchema');
    await ensureSchemaSync();
  } catch (error: any) {
    console.error('[STARTUP] ❌ Database connection failed:', error.message);
    console.log('[STARTUP] Attempting to reset database pool...');
    try {
      const { resetPool } = await import('./db');
      await resetPool();
      console.log('[STARTUP] ✓ Database pool reset successful');
      
      // Try schema sync after pool reset
      const { ensureSchemaSync } = await import('./ensureSchema');
      await ensureSchemaSync();
    } catch (resetError) {
      console.error('[STARTUP] ❌ Database pool reset failed:', resetError);
      console.error('[STARTUP] Server starting anyway - Worker will attempt repair');
    }
  }

  // Attach Supabase client to app locals
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[STARTUP] ⚠️ Supabase environment variables missing. Some features may not work.');
    } else {
      console.log('[STARTUP] ✅ Supabase environment variables loaded');
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: false,
        },
      }
    );

    app.locals.supabase = supabase;
  } catch (error) {
    console.error('[STARTUP] ❌ Failed to initialize Supabase client:', error);
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Serve static SEO and public files before Vite middleware
  app.use(express.static("public", { index: false }));
  
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.sendFile("robots.txt", { root: "public" });
  });

  app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml");
    res.sendFile("sitemap.xml", { root: "public" });
  });

  // importantly only setup vite in development and after
// setting up all the other routes so the catch-all route
// doesn't interfere with the other routes
if (app.get("env") === "development") {
  await setupVite(app, server);
} else {
  // Production: serve client SPA directly from built dist/public folder
  const staticDir = path.join(__dirname, "..", "dist", "public");

  // Serve static assets from compiled build
  app.use(express.static(staticDir));

  // For any non-API, non-SEO route, send back index.html
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;

    // Let API and SEO endpoints through
    if (
      p.startsWith("/api") ||
      p === "/robots.txt" ||
      p === "/sitemap.xml" ||
      p.startsWith("/health")
    ) {
      return next();
    }

    res.sendFile(path.join(staticDir, "index.html"));
  });
}

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Railway and other platforms will provide PORT, default to 5000 for local development
  const port = parseInt(process.env.PORT || '5000', 10);
  
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  }).on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[STARTUP] ❌ CRITICAL: Port ${port} is already in use.`);
      console.error(`[STARTUP] ❌ Deployment will fail. Please ensure no other process is using port ${port}.`);
      process.exit(1);
    } else {
      console.error(`[STARTUP] ❌ Server error:`, error);
      throw error;
    }
  });

  // Initialize persistence manager on startup
  const { persistenceManager } = await import('./persistenceManager');
  await persistenceManager.start();

  // Run Sub-Agent table migrations
  try {
    const { createSubAgentTables } = await import('./migrations/createSubAgentTables');
    await createSubAgentTables();
  } catch (error) {
    console.error('Failed to create Sub-Agent tables:', error);
  }

  // Run Token Metrics table migrations
  try {
    const { createTokenMetricsTables } = await import('./migrations/createTokenMetrics');
    await createTokenMetricsTables();
  } catch (error) {
    console.error('Failed to create Token Metrics tables:', error);
  }

  // Run Device Rate Limit table migrations
  try {
    const { createDeviceRateLimitTables } = await import('./migrations/createDeviceRateLimitTables');
    await createDeviceRateLimitTables();
  } catch (error) {
    console.error('Failed to create Device Rate Limit tables:', error);
  }

  // Start BadBlue Worker
  const { badblueWorker } = await import('./badblueWorker');
  badblueWorker.initialize().catch((error) => {
    console.error('Failed to start BadBlue Worker:', error);
  });

  // Initialize AI Sub-Agent autonomous improvements
  const { initializeAutonomousImprovements } = await import('./aiSubAgent');
  await initializeAutonomousImprovements();
})();
