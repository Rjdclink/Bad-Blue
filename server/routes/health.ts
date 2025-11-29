// Health check endpoint for BadBlue
// Provides structured status with database pool metrics, memory usage, and Node version

import { Router, Request, Response } from 'express';
import { pool } from '../db';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  nodeVersion: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
  };
  database: {
    connected: boolean;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
    maxConnections: number;
  };
  environment: {
    isRailway: boolean;
    isProduction: boolean;
  };
}

export function healthRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();

    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      database: {
        connected: false,
        activeConnections: 0,
        idleConnections: 0,
        waitingRequests: 0,
        maxConnections: 0,
      },
      environment: {
        isRailway: !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
        isProduction: process.env.NODE_ENV === 'production',
      },
    };

    // Check database connectivity and pool metrics
    try {
      // Attempt a simple query to verify database is reachable
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();

      health.database.connected = true;
      health.database.activeConnections = pool.totalCount - pool.idleCount;
      health.database.idleConnections = pool.idleCount;
      health.database.waitingRequests = pool.waitingCount;
      health.database.maxConnections = (pool as any).options?.max || 100;
    } catch (error: any) {
      console.error('[Health] Database check failed:', error.message);
      health.database.connected = false;
      health.status = 'unhealthy';
    }

    // Determine appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 : 503;

    res.status(statusCode).json(health);
  });

  return router;
}
