import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { 
  extractGPSFromFile, 
  clusterLocations, 
  generateHeatmap,
  searchWithinRadius,
  type GPSCoordinates 
} from '../services/gpsIntelligence';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('GPSRoutes');

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
    
    const validatedPoints = gpsArraySchema.parse(points) as GPSCoordinates[];
    const results = searchWithinRadius(validatedPoints, centerLat, centerLng, radiusMeters);
    
    res.json({ results, count: results.length });
  } catch (error) {
    log.error('Radius search failed', error);
    res.status(500).json({ error: 'Radius search failed' });
  }
});

export default router;
