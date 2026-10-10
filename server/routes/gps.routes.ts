import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
import { signServerEvidence } from '../services/geoconsole/evidence-proof';
import { assessSpectraMediaCapture } from '../services/spectra/SpectraMediaEvidence';

const router = Router();
const log = createLogger('GPSRoutes');

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

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
    if (accepted) callback(null, true);
    else callback(new Error('Only image and video files are supported'));
  },
});

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  timestamp: z.string()
    .refine(value => Number.isFinite(Date.parse(value)), { message: 'Invalid timestamp' })
    .transform(value => new Date(value))
    .optional(),
  accuracy: z.number().positive().max(5_000_000).optional(),
  device: z.string().optional()
});

const gpsArraySchema = z.array(coordinatesSchema).max(10_000);

/**
 * POST /api/gps/extract-upload
 * Extract broad media metadata and emit a canonical location observation when
 * the uploaded media contains both coordinates and a capture timestamp.
 */
router.post('/extract-upload', mediaUpload.single('file'), async (req: Request, res: Response) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: 'Media file required' });

  try {
    const [metadata, fileHash] = await Promise.all([
      extractMediaMetadata(uploaded.path, uploaded.originalname),
      sha256File(uploaded.path),
    ]);
    const gps = metadata.gps;
    const mediaAssessment = assessSpectraMediaCapture(metadata);
    const source = uploaded.mimetype.startsWith('video/') ? 'exif_video' : 'exif_photo';
    const captureTimestamp = mediaAssessment.capturedAt
      ? new Date(mediaAssessment.capturedAt) : undefined;
    const reportedAccuracy = gps?.accuracy ?? metadata.positioning.horizontalErrorMeters;
    const accuracy = typeof reportedAccuracy === 'number'
      && Number.isFinite(reportedAccuracy) && reportedAccuracy > 0
        ? Math.min(5_000_000, reportedAccuracy) : undefined;

    // Publicly posted or uploaded scene GPS identifies a media capture site.
    // A conflict, missing capture time or invalid fix stays descriptive metadata
    // and does not become an authenticated live person observation.
    const point = gps && captureTimestamp && mediaAssessment.status === 'accepted'
      ? signServerEvidence({
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitude: gps.altitude,
          accuracy,
          timestamp: captureTimestamp.toISOString(),
          receivedAt: new Date().toISOString(),
          source,
          // Spatial metadata certainty is not a probability that the named
          // subject was present. Do not inflate it to a live position score.
          confidence: accuracy !== undefined
            ? Math.max(0.20, Math.min(0.55, 1 - accuracy / 500))
            : 0.40,
          observationKind: 'historical',
          correlationGroup: `media:sha256:${fileHash}`,
          provenance: {
            provider: 'uploaded_media',
            recordId: `sha256:${fileHash}`,
            capturedAt: captureTimestamp.toISOString(),
            transformedBy: [metadata.extractor],
          },
          metadata: {
            evidenceRole: 'media_capture_scene',
            subjectPresenceVerified: false,
            currentPositionVerified: false,
            captureAgeBand: mediaAssessment.ageBand,
            fileName: uploaded.originalname,
            contentSha256: fileHash,
            device: metadata.device,
            movement: metadata.movement,
            positioning: metadata.positioning,
            capture: metadata.capture,
            image: metadata.image,
            provenance: metadata.provenance,
          },
        })
      : null;

    return res.json({
      success: true,
      hasGPS: !!gps,
      hasCaptureTimestamp: !!captureTimestamp,
      mediaAssessment,
      point,
      metadata: {
        ...metadata,
        contentSha256: fileHash,
      },
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
