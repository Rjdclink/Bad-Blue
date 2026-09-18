import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { 
  extractGPSFromFile, 
  clusterLocations, 
  generateHeatmap,
  searchWithinRadius,
  type GPSCoordinates 
} from '../services/gpsIntelligence';
import { createLogger } from '../logger';
import { isAuthenticated } from '../auth';
import { extractMediaMetadata } from '../services/locationIntelligence/MediaMetadataExtractor';

const router = Router();
const log = createLogger('GPSRoutes');

// All geolocation/media-intelligence operations are authenticated surfaces.
router.use(isAuthenticated);

const mediaUpload = multer({
  dest: '/tmp/legalwhat-media',
  limits: {
    fileSize: 75 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const accepted = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    callback(accepted ? null : new Error('Only image and video files are supported'), accepted);
  },
});

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  timestamp: z.string().optional().transform(val => val ? new Date(val) : undefined),
  accuracy: z.number().optional(),
  device: z.string().optional()
});

const gpsArraySchema = z.array(coordinatesSchema);

/**
 * POST /api/gps/extract
 * Extract GPS from uploaded file
 */
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    const gps = await extractGPSFromFile(filePath);
    
    if (!gps) {
      return res.json({ hasGPS: false, message: 'No GPS data found in file' });
    }

    res.json({ hasGPS: true, coordinates: gps });
  } catch (error) {
    log.error('GPS extraction failed', error);
    res.status(500).json({ error: 'GPS extraction failed' });
  }
});

/**
 * POST /api/gps/extract-upload
 * Extract broad media metadata and emit a canonical location observation when
 * the uploaded media contains both coordinates and a capture timestamp.
 */
router.post('/extract-upload', mediaUpload.single('file'), async (req: Request, res: Response) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: 'Media file required' });

  try {
    const metadata = await extractMediaMetadata(uploaded.path, uploaded.originalname);
    const gps = metadata.gps;

    const source = uploaded.mimetype.startsWith('video/') ? 'exif_video' : 'exif_photo';
    const captureTimestamp = gps?.timestamp && Number.isFinite(gps.timestamp.getTime())
      ? gps.timestamp
      : undefined;

    const point = gps && captureTimestamp
      ? {
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitude: gps.altitude,
          accuracy: gps.accuracy || metadata.positioning.horizontalErrorMeters,
          timestamp: captureTimestamp.toISOString(),
          receivedAt: new Date().toISOString(),
          source,
          confidence: metadata.positioning.horizontalErrorMeters
            ? Math.max(0.45, Math.min(0.95, 1 - metadata.positioning.horizontalErrorMeters / 250))
            : 0.78,
          observationKind: 'observed',
          correlationGroup: `media:${uploaded.originalname}:${captureTimestamp.toISOString()}`,
          provenance: {
            provider: 'uploaded_media',
            capturedAt: captureTimestamp.toISOString(),
            transformedBy: [metadata.extractor],
          },
          metadata: {
            fileName: uploaded.originalname,
            device: metadata.device,
            movement: metadata.movement,
            positioning: metadata.positioning,
            capture: metadata.capture,
            image: metadata.image,
            provenance: metadata.provenance,
          },
        }
      : null;

    return res.json({
      success: true,
      hasGPS: !!gps,
      hasCaptureTimestamp: !!captureTimestamp,
      point,
      metadata,
    });
  } catch (error) {
    log.error('Media metadata extraction failed', error);
    return res.status(500).json({ error: 'Media metadata extraction failed' });
  } finally {
    await unlink(uploaded.path).catch(() => undefined);
  }
});

/**
 * POST /api/gps/cluster
 * Cluster GPS points using DBSCAN
 */
router.post('/cluster', async (req: Request, res: Response) => {
  try {
    const points = gpsArraySchema.parse(req.body.points) as GPSCoordinates[];
    const epsilon = req.body.epsilon || 100; // meters
    const minPoints = req.body.minPoints || 2;

    const clusters = clusterLocations(points, epsilon, minPoints);
    
    res.json({ clusters, totalPoints: points.length });
  } catch (error) {
    log.error('Clustering failed', error);
    res.status(500).json({ error: 'Clustering failed' });
  }
});

/**
 * POST /api/gps/heatmap
 * Generate heatmap from GPS points
 */
router.post('/heatmap', async (req: Request, res: Response) => {
  try {
    const points = gpsArraySchema.parse(req.body.points) as GPSCoordinates[];
    const heatmap = generateHeatmap(points);
    
    res.json(heatmap);
  } catch (error) {
    log.error('Heatmap generation failed', error);
    res.status(500).json({ error: 'Heatmap generation failed' });
  }
});

/**
 * POST /api/gps/search-radius
 * Search within radius (geofencing)
 */
router.post('/search-radius', async (req: Request, res: Response) => {
  try {
    const { points, centerLat, centerLng, radiusMeters } = req.body;
    
    // Validate required parameters
    if (typeof centerLat !== 'number' || centerLat < -90 || centerLat > 90) {
      return res.status(400).json({ error: 'centerLat must be a number between -90 and 90' });
    }
    if (typeof centerLng !== 'number' || centerLng < -180 || centerLng > 180) {
      return res.status(400).json({ error: 'centerLng must be a number between -180 and 180' });
    }
    if (typeof radiusMeters !== 'number' || radiusMeters <= 0) {
      return res.status(400).json({ error: 'radiusMeters must be a positive number' });
    }
    
    const validatedPoints = gpsArraySchema.parse(points) as GPSCoordinates[];
    const results = searchWithinRadius(validatedPoints, centerLat, centerLng, radiusMeters);
    
    res.json({ results, count: results.length });
  } catch (error) {
    log.error('Radius search failed', error);
    res.status(500).json({ error: 'Radius search failed' });
  }
});

export default router;
