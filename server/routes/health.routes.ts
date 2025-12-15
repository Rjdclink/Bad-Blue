/**
 * System Health and Route Inventory Routes
 */

import express, { Request, Response } from 'express';
import { runReleaseGateChecks, getReleaseGateSummary } from '../lib/releaseGate';
import { autonomousFaucet } from '../services/cryptocrawl/faucet/autonomous-faucet';

const router = express.Router();

/**
 * GET /api/health/routes
 * Returns the complete route inventory that the server exposes
 */
router.get('/routes', (req: Request, res: Response) => {
  const routeInventory = {
    timestamp: new Date().toISOString(),
    serverVersion: process.env.npm_package_version || '1.0.0',
    routes: [
      {
        feature: 'Pantheon',
        method: 'POST',
        path: '/api/osint/full-search',
        description: 'OSINT full search for person/officer intelligence',
        requestBody: {
          name: 'string (required)',
          location: 'string (optional)',
          searchDepth: 'number 1-4 (optional, default 2)',
          department: 'string (optional)',
          badge: 'string (optional)',
          domain: 'string (optional)',
        },
        responseShape: {
          identitySummary: 'object',
          contactInformation: 'string[]',
          socialMediaPresence: 'string[]',
          employmentAndEducation: 'string[]',
          locationHistory: 'string[]',
          publicRecords: 'string[]',
          onlineMentions: 'string[]',
          riskAndReputation: 'string[]',
          summary: 'string',
          confidenceScore: 'number',
          sources: 'OSINTSource[]',
          jobId: 'string',
          jobCompleted: 'boolean',
          jobStatus: 'string',
        },
      },
      {
        feature: 'People Finder',
        method: 'POST',
        path: '/api/osint/full-search',
        description: 'Same as Pantheon - UI calls same endpoint',
        note: 'People Finder and Pantheon share the same backend',
      },
      {
        feature: 'People Finder (Alternative)',
        method: 'POST',
        path: '/api/people-search',
        description: 'People search via aggregator (UNUSED BY UI)',
        status: 'MOUNTED BUT UNUSED',
        requestBody: {
          firstName: 'string (required)',
          lastName: 'string (required)',
          city: 'string (optional)',
          state: 'string (optional)',
          age: 'number (optional)',
        },
      },
      {
        feature: 'Inmate Finder',
        method: 'POST',
        path: '/api/inmate-search',
        description: 'Nationwide inmate locator',
        requestBody: {
          firstName: 'string (optional)',
          lastName: 'string (optional)',
          middleName: 'string (optional)',
          dateOfBirth: 'string YYYY-MM-DD (optional)',
          state: 'string 2 chars (optional)',
          inmateId: 'string (optional)',
          searchScope: "enum: 'federal' | 'state' | 'county' | 'all' (default 'all')",
          note: 'At least one of: firstName, lastName, or inmateId required',
        },
        responseShape: {
          success: 'boolean',
          data: {
            inmates: 'InmateRecord[]',
            sources: 'SourceSearchStatus[]',
            totalResults: 'number',
            searchedAt: 'Date',
            cached: 'boolean',
            disclaimer: 'string',
          },
          jobId: 'string',
          jobCompleted: 'boolean',
          jobStatus: 'string',
        },
      },
      {
        feature: 'Lexara Chat',
        method: 'POST',
        path: '/api/lexara/chat',
        description: 'AI legal assistant conversation',
        status: 'MOUNTED BUT NO UI INTEGRATION',
        requestBody: {
          prompt: 'string (required)',
          context: {
            previousMessages: 'Array<{role, content}> (optional)',
            sessionId: 'string (optional)',
            behaviorMode: 'string (optional)',
          },
          systemPrompt: 'string (optional)',
          includeAudio: 'boolean (optional, default true)',
        },
        responseShape: {
          success: 'boolean',
          response: 'string',
          model: 'string',
          audio: {
            audioBase64: 'string',
            mimeType: 'string',
            durationMs: 'number',
          },
          conversationId: 'string',
          persistenceSuccess: 'boolean',
          jobCompleted: 'boolean',
          jobStatus: 'string',
        },
      },
    ],
    mounts: [
      {
        path: '/api/inmate-search',
        router: 'inmateSearch.routes.ts',
        handlers: ['POST /'],
      },
      {
        path: '/api/lexara',
        router: 'lexara.routes.ts + lexara.chat.routes.ts',
        handlers: ['POST /chat', 'GET /status', 'POST /voice', 'POST /analyze-signals'],
      },
      {
        path: 'NO PREFIX',
        router: 'peopleSearch.routes.ts',
        handlers: ['POST /api/people-search'],
        note: 'Route internally includes /api prefix',
      },
      {
        path: 'DIRECT',
        handler: 'routes.ts line 3576',
        route: 'POST /api/osint/full-search',
      },
    ],
    verification: {
      endpoints: [
        'GET /api/verify/people-search/:reportId',
        'GET /api/verify/people-search/user/:userId',
        'GET /api/verify/inmate-search/:reportId',
        'GET /api/verify/inmate-search/user/:userId',
        'GET /api/verify/lexara/:conversationId',
        'GET /api/verify/lexara/user/:userId',
        'GET /api/verify/lexara/session/:sessionId',
        'GET /api/verify/health',
      ],
    },
  };

  res.json(routeInventory);
});

/**
 * GET /api/health
 * Basic health check
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

/**
 * GET /api/health/cryptocrawl-faucet
 * Public liveness probe for the CryptoCrawl autonomous faucet.
 *
 * Designed for monitoring (no auth). Exposes only operational signals:
 * - active: whether the loop is running in this process
 * - faucetId: unique instance id (helps detect multi-instance duplication)
 * - lastLoopIterationAt: heartbeat timestamp (stall detection)
 */
router.get('/cryptocrawl-faucet', (_req: Request, res: Response) => {
  const now = Date.now();
  const active = autonomousFaucet.isActive();
  const faucetId = autonomousFaucet.getFaucetId();

  let state: ReturnType<typeof autonomousFaucet.getState> | null = null;
  try {
    state = autonomousFaucet.getState();
  } catch {
    state = null;
  }

  const mode = state?.mode ?? (active ? 'unknown' : 'closed');
  const lastLoopIterationAt = state?.lastLoopIterationAt ?? 0;
  const lastSuccessfulTrade = state?.lastSuccessfulTrade ?? 0;

  // Stall threshold: allow longer sleeps in stealth mode.
  const maxStallMs = mode === 'stealth' ? 2 * 60_000 : 30_000;
  const stallMs = active && lastLoopIterationAt ? Math.max(0, now - lastLoopIterationAt) : null;
  const stalled = active && lastLoopIterationAt > 0 && now - lastLoopIterationAt > maxStallMs;

  res.json({
    ok: !stalled,
    active,
    faucetId,
    mode,
    lastLoopIterationAt,
    lastSuccessfulTrade,
    stalled,
    stallMs,
    maxStallMs,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/release-gate
 * PASS 8: Pre-deployment checks
 */
router.get('/release-gate', async (req: Request, res: Response) => {
  try {
    const checks = await runReleaseGateChecks();
    const summary = getReleaseGateSummary(checks);
    
    res.json({
      timestamp: new Date().toISOString(),
      summary,
      checks,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to run release gate checks',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
