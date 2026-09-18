import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isAuthenticated } from '../auth';
import { conductFullOSINT } from '../peopleSearch';

const router = Router();
router.use(isAuthenticated);

const acquireSchema = z.object({
  target: z.string().trim().min(1).max(500),
  details: z.string().trim().min(1).max(4000),
});

const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
const GENERIC_TARGET_RE = /^(?:(?:a|an|the)\s+)?(?:person|individual|business|company|organization|vehicle|car|place|address|thing|property|phone|phone number|target)$/i;

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function sourceForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('exif') || lower.includes('media')) return 'exif_photo';
  if (lower.includes('social')) return 'social_geotag';
  if (lower.includes('camera')) return 'public_camera';
  if (lower.includes('satellite')) return 'satellite_imagery';
  return 'public_record';
}

function explicitTimestamp(value: any): Date | null {
  const raw =
    value?.timestamp ??
    value?.observedAt ??
    value?.capturedAt ??
    value?.dateTimeOriginal ??
    value?.datetime ??
    value?.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function collectCoordinateObservations(
  value: unknown,
  sourceName: string,
  confidence: number,
  out: any[],
  depth = 0,
  seen = new Set<object>(),
) {
  if (depth > 7 || value == null || out.length >= 250) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCoordinateObservations(item, sourceName, confidence, out, depth + 1, seen);
      if (out.length >= 250) break;
    }
    return;
  }

  if (typeof value !== 'object') return;
  const object = value as Record<string, any>;
  if (seen.has(object)) return;
  seen.add(object);

  const latitude = Number(
    object.latitude ??
    object.lat ??
    object.gpsLatitude ??
    object.GPSLatitude
  );
  const longitude = Number(
    object.longitude ??
    object.lng ??
    object.lon ??
    object.gpsLongitude ??
    object.GPSLongitude
  );
  const timestamp = explicitTimestamp(object);

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    timestamp
  ) {
    const accuracy = Number(
      object.accuracy ??
      object.horizontalAccuracy ??
      object.GPSHPositioningError
    );
    const altitude = Number(object.altitude ?? object.gpsAltitude ?? object.GPSAltitude);

    out.push({
      latitude,
      longitude,
      altitude: Number.isFinite(altitude) ? altitude : undefined,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: timestamp.toISOString(),
      receivedAt: new Date().toISOString(),
      source: sourceForName(sourceName),
      confidence,
      observationKind: 'observed',
      correlationGroup: `spectra:${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      provenance: {
        provider: sourceName,
        capturedAt: timestamp.toISOString(),
        transformedBy: ['spectra_acquisition'],
      },
      metadata: {
        sourceName,
      },
    });
  }

  for (const child of Object.values(object)) {
    collectCoordinateObservations(child, sourceName, confidence, out, depth + 1, seen);
    if (out.length >= 250) break;
  }
}

function dedupeObservations(points: any[]): any[] {
  const seen = new Set<string>();
  return points.filter(point => {
    const key = [
      Number(point.latitude).toFixed(6),
      Number(point.longitude).toFixed(6),
      new Date(point.timestamp).toISOString(),
      point.source,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.post('/acquire', async (req: Request, res: Response) => {
  const parsed = acquireSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Target and target information are required.',
    });
  }

  const { target, details } = parsed.data;
  const phone = details.match(PHONE_RE)?.[0];
  const searchQuery = GENERIC_TARGET_RE.test(target)
    ? details
    : target;

  try {
    const report = await conductFullOSINT(searchQuery, {
      location: details,
      phone,
      searchDepth: 4,
    });

    const observations: any[] = [];
    for (const source of report.sources || []) {
      collectCoordinateObservations(
        source?.data,
        String(source?.name || 'public_record'),
        normalizeConfidence(source?.confidence),
        observations,
      );
    }

    const locationObservations = dedupeObservations(observations)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const confidenceRaw = Number(report.confidenceScore);
    const confidence = Number.isFinite(confidenceRaw)
      ? (confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw)
      : 0;

    return res.json({
      success: true,
      target,
      details,
      acquisition: {
        confidence: Math.max(0, Math.min(1, confidence)),
        sourceCount: Array.isArray(report.sources) ? report.sources.length : 0,
        observationCount: locationObservations.length,
        summary: report.summary || '',
        verificationStatus: report.identitySummary?.verificationStatus || 'Unknown',
      },
      locationObservations,
      evidence: {
        contactInformation: report.contactInformation || [],
        locationHistory: report.locationHistory || [],
        publicRecords: report.publicRecords || [],
        onlineMentions: report.onlineMentions || [],
        socialMediaPresence: report.socialMediaPresence || [],
        employmentAndEducation: report.employmentAndEducation || [],
      },
    });
  } catch (error) {
    console.error('[SPECTRA] Acquisition failed', error);
    return res.status(500).json({
      success: false,
      error: 'SPECTRA could not complete target acquisition.',
    });
  }
});

export default router;
