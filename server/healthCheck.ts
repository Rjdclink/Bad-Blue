// Health Check Endpoint for Railway
import { Request, Response } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: boolean;
    auth: boolean;
    storage: boolean;
  };
  environment: {
    isRailway: boolean;
    isProduction: boolean;
    usingSupabase: boolean;
  };
}

export async function healthCheck(req: Request, res: Response) {
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: false,
      auth: false,
      storage: false
    },
    environment: {
      isRailway: !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
      isProduction: process.env.NODE_ENV === 'production',
      usingSupabase: !!process.env.SUPABASE_DATABASE_URL
    }
  };
  
  // Check database connection (works with Supabase or regular PostgreSQL)
  try {
    await db.execute(sql`SELECT 1`);
    health.services.database = true;
  } catch (error) {
    console.error('[Health] Database check failed:', error);
    health.status = 'unhealthy';
  }
  
  // Check auth configuration
  health.services.auth = !!process.env.SESSION_SECRET;
  
  // Check storage configuration
  health.services.storage = !!(
    process.env.EVIDENCE_STORAGE_DIR || 
    process.env.PRIVATE_OBJECT_DIR
  );
  
  // Determine overall health
  if (!health.services.database || !health.services.auth) {
    health.status = 'unhealthy';
  }
  
  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  res.status(statusCode).json(health);
}
