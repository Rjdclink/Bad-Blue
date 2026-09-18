import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isAuthenticated } from '../auth';
import { conductFullOSINT } from '../peopleSearch';
import { unifiedSearch } from '../webSearchService';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  geocodeCityState,
  geocodeFreeformLocation,
} from '../services/geoconsole/city-state-geocoder';
import {
  normalizeClientEvidence,
  signServerEvidence,
} from '../services/geoconsole/evidence-proof';
import type { GPSPoint } from '../services/geoconsole/types';

const router = Router();
router.use(isAuthenticated);

const directEvidenceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().positive().max(1_000_000).optional(),
  verticalAccuracy: z.number().nonnegative().max(1_000_000).optional(),
  timestamp: z.string().datetime(),
  receivedAt: z.string().datetime().optional(),
  source: z.enum(['exif_photo', 'exif_video', 'xmp_sidecar', 'json_sidecar']),
  confidence: z.number().min(0).max(1),
  observationKind: z.enum(['observed', 'historical']).optional(),
  correlationGroup: z.string().max(300).optional(),
  provenance: z.object({
    provider: z.string().max(200).optional(),
    recordId: z.string().max(300).optional(),
    capturedAt: z.string().datetime().optional(),
    transformedBy: z.array(z.string().max(120)).max(20).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const acquireSchema = z.object({
  target: z.string().trim().min(1).max(500),
  details: z.string().trim().min(1).max(4000),
  directEvidence: z.array(directEvidenceSchema).max(20).default([]),
});

const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/;

function extractPhoneNumber(value: string): string | undefined {
  const candidate = value.match(PHONE_CANDIDATE_RE)?.[0]?.trim();
  if (!candidate) return undefined;
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return candidate.replace(/[\s.,;:-]+$/g, '');
}

function normalizeTargetIntent(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^(?:please\s+)?(?:i\s+(?:need|want)\s+(?:you\s+)?to\s+)?(?:find|locate|track|look\s+for)\s+/i, '')
    .replace(/^(?:i(?:'m|\s+am)\s+looking\s+for)\s+/i, '')
    .replace(/^(?:where\s+is|where's)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  return cleaned || value.trim();
}

const GENERIC_TARGET_RE = /^(?:(?:a|an|the|my|their|his|her)\s+)?(?:person|individual|business|company|organization|vehicle|car|truck|device|object|place|address|thing|property|phone|phone number|target)$/i;

function targetSubject(value: string): string {
  const phone = extractPhoneNumber(value);
  const withoutPhone = (phone ? value.replace(phone, ' ') : value)
    .replace(/\s+/g, ' ')
    .trim();
  const contextual = withoutPhone.match(/^(.+?)\s+(?:in|near|around|located\s+in)\s+.+$/i);
  const subject = contextual?.[1]?.trim() || withoutPhone;
  return subject.length >= 2 ? subject : value.trim();
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function sourceForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('exif') || lower.includes('media')) return 'exif_photo';
  if (lower.includes('social')) return 'social_media';
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
    value?.datetime;
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
  contextPath = '',
) {
  if (depth > 7 || value == null || out.length >= 250) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCoordinateObservations(item, sourceName, confidence, out, depth + 1, seen, contextPath);
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
  const locationContext = [
    sourceName,
    contextPath,
    String(object.type || ''),
    String(object.kind || ''),
    String(object.category || ''),
  ].join(' ').toLowerCase();
  const hasLocationContext =
    /\b(?:gps|geo|geotag|location|position|coordinate|check[- ]?in|trajectory|track|place|address)\b/i
      .test(locationContext) ||
    object.gpsLatitude !== undefined ||
    object.GPSLatitude !== undefined ||
    object.gpsLongitude !== undefined ||
    object.GPSLongitude !== undefined;

  if (
    hasLocationContext &&
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

    const source = sourceForName(sourceName);
    const observationKind =
      source === 'public_record' || source === 'historical_location'
        ? 'historical'
        : 'observed';

    out.push({
      latitude,
      longitude,
      altitude: Number.isFinite(altitude) ? altitude : undefined,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: timestamp.toISOString(),
      receivedAt: new Date().toISOString(),
      source,
      confidence,
      observationKind,
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

  for (const [key, child] of Object.entries(object)) {
    const nextPath = contextPath ? `${contextPath}.${key}` : key;
    collectCoordinateObservations(
      child,
      sourceName,
      confidence,
      out,
      depth + 1,
      seen,
      nextPath,
    );
    if (out.length >= 250) break;
  }
}

function dedupeObservations(points: any[]): any[] {
  const seen = new Set<string>();
  return points.filter(point => {
    const evidenceGroup =
      point.correlationGroup ||
      point.provenance?.recordId ||
      `${point.source || 'unknown'}:${point.provenance?.provider || 'unknown'}`;
    const key = [
      Number(point.latitude).toFixed(6),
      Number(point.longitude).toFixed(6),
      new Date(point.timestamp).toISOString(),
      point.source,
      evidenceGroup,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationEvidenceConfidence(points: any[]): number {
  if (!points.length) return 0;

  const representatives = new Map<string, number>();
  for (const point of points) {
    const confidence = Math.max(0, Math.min(1, Number(point.confidence) || 0));
    const kindFactor =
      point.observationKind === 'historical' ? 0.55 :
      point.observationKind === 'inferred' ? 0.65 :
      point.observationKind === 'interpolated' ? 0.45 :
      point.observationKind === 'predicted' ? 0.25 :
      1;
    const adjusted = confidence * kindFactor;
    const key =
      String(point.correlationGroup || '') ||
      `${point.source || 'unknown'}:${point.provenance?.provider || 'unknown'}`;
    representatives.set(key, Math.max(representatives.get(key) || 0, adjusted));
  }

  const values = [...representatives.values()];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const corroborationBonus = Math.min(0.08, Math.max(0, values.length - 1) * 0.02);
  return Math.max(0, Math.min(0.95, mean + corroborationBonus));
}

function discoverySourceKey(result: any): string {
  try {
    if (result?.url) return new URL(String(result.url)).hostname.toLowerCase();
  } catch {
    // Fall back to the result title when URL metadata is malformed.
  }
  return String(result?.title || 'web-discovery').trim().toLowerCase();
}

router.post('/acquire', async (req: Request, res: Response) => {
  const parsed = acquireSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Target and target information are required.',
    });
  }

  const { target, details, directEvidence } = parsed.data;
  const normalizedTarget = normalizeTargetIntent(target);
  const combinedTargetText = [normalizedTarget, details].filter(Boolean).join(' ');
  const phone = extractPhoneNumber(combinedTargetText);
  const targetPhone = extractPhoneNumber(normalizedTarget);
  const remainingTarget = targetPhone
    ? normalizedTarget.replace(targetPhone, '').replace(/[\s,;:()\-.]+/g, '')
    : normalizedTarget;
  const targetIsPhone = Boolean(targetPhone) && remainingTarget.length === 0;
  const subject = targetSubject(normalizedTarget);
  const searchQuery = GENERIC_TARGET_RE.test(normalizedTarget) || targetIsPhone
    ? details
    : subject;
  const broadQuery = [normalizedTarget, details].filter(Boolean).join(' ');

  try {
    // SPECTRA treats discovery systems as parallel evidence sources. A failure
    // in one adapter is local and never prevents other acquisition paths.
    const [osintResult, webResult] = await Promise.allSettled([
      conductFullOSINT(searchQuery, {
        location: details,
        phone,
        searchDepth: 4,
      }),
      unifiedSearch(broadQuery, {
        limit: 25,
        category: 'general',
        freshness: 'all',
        timeout: 20_000,
      }),
    ]);

    if (osintResult.status === 'rejected' && webResult.status === 'rejected') {
      throw osintResult.reason || webResult.reason;
    }

    const report = osintResult.status === 'fulfilled'
      ? osintResult.value
      : {
          identitySummary: { verificationStatus: 'Unknown' },
          contactInformation: [],
          locationHistory: [],
          employmentAndEducation: [],
          publicRecords: [],
          onlineMentions: [],
          socialMediaPresence: [],
          sources: [],
          confidenceScore: 0,
          summary: '',
        } as any;

    const discoveryResults = webResult.status === 'fulfilled' ? webResult.value : [];

    const observations: any[] = directEvidence.map(point => {
      const normalized = normalizeClientEvidence({
        ...point,
        timestamp: new Date(point.timestamp),
        receivedAt: point.receivedAt ? new Date(point.receivedAt) : undefined,
        provenance: point.provenance
          ? {
              ...point.provenance,
              capturedAt: point.provenance.capturedAt
                ? new Date(point.provenance.capturedAt)
                : undefined,
            }
          : undefined,
      } as GPSPoint);

      return {
        ...normalized,
        timestamp: normalized.timestamp.toISOString(),
        receivedAt: normalized.receivedAt?.toISOString(),
        provenance: normalized.provenance
          ? {
              ...normalized.provenance,
              capturedAt: normalized.provenance.capturedAt instanceof Date
                ? normalized.provenance.capturedAt.toISOString()
                : normalized.provenance.capturedAt,
            }
          : undefined,
      };
    });

    for (const source of report.sources || []) {
      collectCoordinateObservations(
        source?.data,
        String(source?.name || 'public_record'),
        normalizeConfidence(source?.confidence),
        observations,
      );
    }

    for (const result of discoveryResults) {
      collectCoordinateObservations(
        result?.metadata,
        String(result?.title || 'web_discovery'),
        normalizeConfidence((result?.relevanceScore ?? 0) / 100),
        observations,
      );
    }

    const locationObservations = dedupeObservations(observations)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(point => signServerEvidence(point));

    const candidateLocations: Array<{
      latitude: number;
      longitude: number;
      label: string;
      confidence: number;
      basis: 'regional_context';
      accuracyMeters: number;
    }> = [];

    // Regional hints are useful when precise timestamped coordinates are not
    // available, but they never enter the motion timeline or masquerade as a
    // current observation.
    if (locationObservations.length === 0) {
      const locationInputs = [
        normalizedTarget,
        details,
        ...(Array.isArray(report.locationHistory) ? report.locationHistory : []),
      ].filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      );

      try {
        const structuredHint = locationInputs
          .map(value => extractCityStateHint(value))
          .find((value): value is NonNullable<ReturnType<typeof extractCityStateHint>> => Boolean(value));

        let region = structuredHint
          ? await geocodeCityState(structuredHint.query)
          : null;

        if (!region) {
          const freeformInput = locationInputs.find(value =>
            Boolean(extractFreeformLocationHint(value))
          );
          if (freeformInput) {
            region = await geocodeFreeformLocation(freeformInput);
          }
        }

        if (region) {
          candidateLocations.push({
            latitude: region.latitude,
            longitude: region.longitude,
            label: region.displayName,
            confidence: 0.35,
            basis: 'regional_context',
            accuracyMeters: region.accuracyMeters,
          });
        }
      } catch {
        // Geocoder failure is route-local. SPECTRA still returns all other evidence.
      }
    }

    const confidenceRaw = Number(report.confidenceScore);
    const identityConfidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
      : 0;
    const locationConfidence = locationObservations.length > 0
      ? locationEvidenceConfidence(locationObservations)
      : candidateLocations[0]?.confidence ?? 0;

    const sourceKeys = new Set<string>();
    for (const point of directEvidence) {
      sourceKeys.add(
        String(point.correlationGroup || `media:${point.source}`).trim().toLowerCase()
      );
    }
    for (const source of report.sources || []) {
      sourceKeys.add(String(source?.name || 'osint-source').trim().toLowerCase());
    }
    for (const result of discoveryResults) {
      sourceKeys.add(discoverySourceKey(result));
    }

    return res.json({
      success: true,
      target,
      details,
      acquisition: {
        identityConfidence,
        locationConfidence,
        sourceCount: sourceKeys.size,
        evidenceItemCount:
          directEvidence.length +
          (Array.isArray(report.sources) ? report.sources.length : 0) +
          discoveryResults.length,
        observationCount: locationObservations.length,
        summary: report.summary || '',
        verificationStatus: report.identitySummary?.verificationStatus || 'Unknown',
      },
      locationObservations,
      candidateLocations,
      evidence: {
        contactInformation: report.contactInformation || [],
        locationHistory: report.locationHistory || [],
        publicRecords: report.publicRecords || [],
        onlineMentions: [
          ...(report.onlineMentions || []),
          ...discoveryResults.map(result => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            reliability: result.reliability,
            relevanceScore: result.relevanceScore,
          })),
        ],
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
