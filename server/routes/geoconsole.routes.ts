/**
 * Hybrid Geoconsole API Routes
 * 
 * RESTful API endpoints for the geoconsole system
 * All data stored in RAM only - no disk writes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { hybridGeoconsole } from '../services/geoconsole';
import { GPSPoint, DataSource } from '../services/geoconsole/types';
import { assessLocationQuality } from '../services/geoconsole/location-quality';
import { selectCrawlerPlan } from '../services/crawlers/CrawlerSelectionUtility';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('GeoconsoleRoutes');

// ============ VALIDATION SCHEMAS ============

const gpsPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().optional(),
  timestamp: z.string().transform(s => new Date(s)),
  source: z.enum([
    'device_gps', 'exif_photo', 'exif_video', 'xmp_sidecar', 'json_sidecar',
    'wifi_handoff', 'bluetooth_proximity', 'accelerometer', 'browser_timestamp',
    'social_media', 'public_camera', 'traffic_cam', 'satellite_imagery',
    'public_record', 'manual_input', 'interpolated'
  ]),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
});

const processRequestSchema = z.object({
  inputs: z.array(gpsPointSchema),
  sessionId: z.string().optional(),
});

const reportRequestSchema = z.object({
  sessionId: z.string(),
  subject: z.string().min(1),
  timeRange: z.object({
    start: z.string().transform(s => new Date(s)),
    end: z.string().transform(s => new Date(s)),
  }).optional(),
});

const configUpdateSchema = z.object({
  timeline: z.object({
    historyDays: z.number().min(1).max(30).optional(),
    futurecastHours: z.number().min(1).max(48).optional(),
    playbackSpeed: z.number().min(1).max(3600).optional(),
    animationFps: z.number().min(1).max(60).optional(),
    trailFadeSeconds: z.number().min(3600).max(604800).optional(),
  }).optional(),
  orchestration: z.object({
    maxConcurrentOperations: z.number().min(1).max(16).optional(),
    computeBudget: z.number().min(100).max(10000).optional(),
    cacheStrategy: z.enum(['aggressive', 'balanced', 'minimal']).optional(),
    prefetchDepth: z.number().min(1).max(10).optional(),
    refinementPasses: z.number().min(1).max(5).optional(),
    adaptiveResolution: z.boolean().optional(),
    gpuAcceleration: z.boolean().optional(),
  }).optional(),
});

// ============ API ENDPOINTS ============

/**
 * POST /api/geoconsole/process
 * Process raw location inputs through the full pipeline
 */
router.post('/process', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const validation = processRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { inputs, sessionId } = validation.data;

    // Convert validated data to GPSPoint array
    const gpsPoints: GPSPoint[] = inputs.map(input => ({
      ...input,
      timestamp: input.timestamp,
      source: input.source as DataSource,
    }));

    const quality = assessLocationQuality(gpsPoints);
    const crawlerSelection = selectCrawlerPlan({
      purpose: 'map_evidence_render',
      targetCount: quality.acceptedCount,
    });

    log.info('Processing location data', {
      inputCount: gpsPoints.length,
      acceptedCount: quality.acceptedCount,
      sessionId,
    });

    const result = await hybridGeoconsole.processLocationData(quality.points, sessionId);

    res.json({
      success: true,
      data: {
        fusedLocations: result.fusedLocations,
        trail: {
          id: result.trail.id,
          pointCount: result.trail.points.length,
          startTime: result.trail.startTime,
          endTime: result.trail.endTime,
          totalDistance: result.trail.totalDistance,
          averageSpeed: result.trail.averageSpeed,
          segments: result.trail.segments,
          stops: result.trail.stops,
        },
        futurecast: result.futurecast,
        inputQuality: {
          acceptedCount: quality.acceptedCount,
          rejectedCount: quality.rejectedCount,
          issues: quality.issues,
        },
        crawlerSelection,
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Process endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  }
});

/**
 * POST /api/geoconsole/report
 * Generate comprehensive intelligence report
 */
router.post('/report', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const validation = reportRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { sessionId, subject, timeRange } = validation.data;

    log.info('Generating intelligence report', { sessionId, subject });

    const report = await hybridGeoconsole.generateIntelligenceReport(
      sessionId,
      subject,
      timeRange
    );

    res.json({
      success: true,
      data: report,
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Report endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Report generation failed',
    });
  }
});

/**
 * GET /api/geoconsole/status
 * Get system status and orchestration state
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const state = hybridGeoconsole.getOrchestrationState();

    res.json({
      success: true,
      data: {
        status: 'operational',
        orchestration: state,
        capabilities: {
          multimodalFusion: true,
          monteCarloInterpolation: true,
          futurecastPrediction: true,
          weatherRadarTimeline: true,
          satelliteImagery: true,
          publicCameraIntegration: true,
        },
      },
    });
  } catch (error) {
    log.error('Status endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
    });
  }
});

/**
 * POST /api/geoconsole/config
 * Update system configuration
 */
router.post('/config', async (req: Request, res: Response) => {
  try {
    const validation = configUpdateSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration',
        details: validation.error.errors,
      });
    }

    hybridGeoconsole.updateConfig(validation.data);

    res.json({
      success: true,
      message: 'Configuration updated',
    });
  } catch (error) {
    log.error('Config endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
    });
  }
});

/**
 * POST /api/geoconsole/clear-cache
 * Clear all in-memory caches
 */
router.post('/clear-cache', async (req: Request, res: Response) => {
  try {
    hybridGeoconsole.clearCaches();

    res.json({
      success: true,
      message: 'All caches cleared',
    });
  } catch (error) {
    log.error('Clear cache endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear caches',
    });
  }
});

/**
 * POST /api/geoconsole/interpolate
 * Interpolate path between two points
 */
router.post('/interpolate', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const schema = z.object({
      startPoint: gpsPointSchema,
      endPoint: gpsPointSchema,
      config: z.object({
        iterations: z.number().min(100).max(10000).optional(),
        maxSpeed: z.number().min(1).max(100).optional(),
      }).optional(),
    });

    const validation = schema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { startPoint, endPoint, config } = validation.data;

    // Use the Monte Carlo engine directly
    const { monteCarloPathEngine } = await import('../services/geoconsole/monteCarloPathEngine');
    
    const path = await monteCarloPathEngine.interpolatePath(
      { ...startPoint, source: startPoint.source as DataSource },
      { ...endPoint, source: endPoint.source as DataSource },
      config
    );

    res.json({
      success: true,
      data: {
        id: path.id,
        pointCount: path.interpolatedPoints.length,
        confidence: path.confidence,
        method: path.method,
        metadata: path.metadata,
        // Include simplified heatmap data
        probabilityHeatmap: {
          bounds: path.probabilityDistribution.bounds,
          peakProbability: path.probabilityDistribution.peakProbability,
        },
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Interpolate endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Interpolation failed',
    });
  }
});

/**
 * POST /api/geoconsole/futurecast
 * Generate future position predictions
 */
router.post('/futurecast', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const schema = z.object({
      recentPoints: z.array(gpsPointSchema).min(3),
      hours: z.number().min(1).max(48).optional(),
    });

    const validation = schema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { recentPoints, hours = 6 } = validation.data;

    const { monteCarloPathEngine } = await import('../services/geoconsole/monteCarloPathEngine');
    
    const gpsPoints: GPSPoint[] = recentPoints.map(p => ({
      ...p,
      source: p.source as DataSource,
    }));

    const futurecast = await monteCarloPathEngine.generateFuturecast(gpsPoints, hours);

    res.json({
      success: true,
      data: {
        predictions: futurecast,
        hours,
        confidence: futurecast.length > 0 
          ? futurecast.reduce((sum, p) => sum + p.confidence, 0) / futurecast.length 
          : 0,
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Futurecast endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Futurecast failed',
    });
  }
});

export default router;
