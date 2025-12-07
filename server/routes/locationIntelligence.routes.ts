import { Router } from 'express';
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

router.post('/api/location-intel/analyze', async (req, res) => {
  try {
    const { imagePaths = [], publicRecords = [] } = req.body;

    locationAggregator.clear();

    if (imagePaths.length > 0) {
      const locations = await exifToolExtractor.extractBatch(imagePaths);
      locations.forEach(loc => locationAggregator.addExifLocation(loc));
    }

    publicRecords.forEach((record: PublicRecord) => {
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
