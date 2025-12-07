import { Router } from 'express';
import { z } from 'zod';
import { exifToolExtractor } from '../services/locationIntelligence/ExifToolExtractor';
import { locationAggregator } from '../services/locationIntelligence/LocationAggregator';

const router = Router();

interface PublicRecord {
  latitude: number;
  longitude: number;
  source: 'social_media' | 'court_record' | 'property' | 'voter' | 'business';
  timestamp?: string | Date;
  confidence?: number;
}

const analyzeRequestSchema = z.object({
  imagePaths: z.array(z.string()).optional().default([]),
  publicRecords: z.array(z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    source: z.enum(['social_media', 'court_record', 'property', 'voter', 'business']),
    timestamp: z.union([z.string(), z.date()]).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).optional().default([]),
});

router.post('/api/location-intel/analyze', async (req, res) => {
  try {
    const validation = analyzeRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { imagePaths, publicRecords } = validation.data;

    locationAggregator.clear();

    if (imagePaths.length > 0) {
      const locations = await exifToolExtractor.extractBatch(imagePaths);
      locations.forEach(loc => locationAggregator.addExifLocation(loc));
    }

    publicRecords.forEach(record => {
      locationAggregator.addPublicRecord(record);
    });

    const clustered = locationAggregator.cluster(100);
    const heatmapData = locationAggregator.getHeatmapData();
    const timeline = locationAggregator.getTimeline();
    const stats = locationAggregator.getStats();

    res.json({
      success: true,
      data: { clustered, heatmapData, timeline, stats },
    });
  } catch (error) {
    console.error('[LocationIntel] Error:', error);
    res.status(500).json({ success: false, error: 'Analysis failed' });
  }
});

router.get('/api/location-intel/status', async (req, res) => {
  const installed = await exifToolExtractor.checkInstalled();
  res.json({
    exifToolInstalled: installed,
    status: installed ? 'ready' : 'exiftool_missing',
  });
});

export default router;
