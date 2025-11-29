/**
 * Health Check Route
 * Provides a /api/health endpoint for deployment diagnostics
 * Returns 200 OK when healthy, 503 when degraded
 */
import { Router, type Request, type Response } from 'express';
import { pool } from '../db';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs?: number;
      error?: string;
    };
    runtime: {
      nodeVersion: string;
      uptime: number;
      memoryUsage: {
        heapUsedMB: number;
        heapTotalMB: number;
      };
    };
  };
}

/**
 * GET /api/health
 * Returns system health status with DB probe
 * 
 * Note: This endpoint is intentionally not rate-limited as it is designed
 * for infrastructure monitoring (load balancers, k8s health probes) which
 * require fast, reliable responses. The database query is lightweight (SELECT 1)
 * and the endpoint returns minimal data.
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  
  // Initialize health response
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0', // Hardcoded version for reliability across environments
    checks: {
      database: {
        status: 'up',
      },
      runtime: {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: {
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
      },
    },
  };

  // Check database connectivity
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    health.checks.database.latencyMs = Date.now() - dbStart;
  } catch (error: unknown) {
    health.status = 'degraded';
    health.checks.database.status = 'down';
    health.checks.database.error = error instanceof Error ? error.message : 'Unknown database error';
  }

  // Return appropriate status code based on health
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
