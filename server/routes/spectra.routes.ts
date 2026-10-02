import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isAuthenticated } from '../auth';
import { callClaudeWebSearch } from '../claude';
import {
  discoverLegalMeshTier3,
  type LegalMeshCandidate,
} from '../lexara/LegalProviderMesh';
import { resolveLexaraBackgroundSubject } from '../lexara/LexaraBackgroundSubject';
import { investigateLexaraBackgroundQuestion } from '../lexara/LexaraBackgroundInvestigation';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  geocodeCityState,
  geocodeFreeformLocation,
  geocodeBestLocation,
} from '../services/geoconsole/city-state-geocoder';
import {
  normalizeClientEvidence,
  signServerEvidence,
} from '../services/geoconsole/evidence-proof';
import type { GPSPoint } from '../services/geoconsole/types';
import { inputFusionEngine } from '../services/geoconsole/inputFusionEngine';
import { assessLocationQuality } from '../services/geoconsole/location-quality';
import {
  buildSpectraAdaptiveQuery,
  buildSpectraDiscoveryWaves,
  SPECTRA_DISCOVERY_POLICY,
} from '../services/spectra/SpectraSourceRegistry';
import {
  acquireRadioPosition,
  acquireRangingPosition,
  normalizeAbsoluteDeviceObservation,
} from '../services/spectra/SpectraDeviceAcquisitionAdapters';
import { acquireNearbyTrafficCameras } from '../services/spectra/SpectraCameraAcquisitionAdapter';

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

const absoluteDeviceObservationSchema = z.object({
  kind: z.literal('absolute'),
  source: z.enum(['device_gps', 'gnss_fix', 'gnss_raw', 'browser_geolocation', 'vehicle_telemetry']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.string().datetime(),
  accuracy: z.number().positive().max(5_000_000).optional(),
  altitude: z.number().optional(),
  verticalAccuracy: z.number().nonnegative().optional(),
  speed: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  confidence: z.number().min(0).max(1).optional(),
  provider: z.string().max(200).optional(),
  correlationGroup: z.string().max(300).optional(),
  sensorTelemetry: z.object({
    accelerometer: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    gyroscope: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    magnetometer: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    barometerHpa: z.number().positive().optional(),
  }).optional(),
});

const radioDeviceObservationSchema = z.object({
  kind: z.literal('radio'),
  timestamp: z.string().datetime(),
  radioType: z.enum(['gsm', 'cdma', 'wcdma', 'lte', 'nr']).optional(),
  homeMobileCountryCode: z.number().int().nonnegative().optional(),
  homeMobileNetworkCode: z.number().int().nonnegative().optional(),
  carrier: z.string().max(120).optional(),
  provider: z.string().max(200).optional(),
  wifiAccessPoints: z.array(z.object({
    macAddress: z.string().max(32),
    signalStrength: z.number().optional(),
    signalToNoiseRatio: z.number().optional(),
    channel: z.number().optional(),
    age: z.number().nonnegative().optional(),
  })).max(40).optional(),
  cellTowers: z.array(z.object({
    cellId: z.number().int().nonnegative().optional(),
    newRadioCellId: z.number().int().nonnegative().optional(),
    locationAreaCode: z.number().int().nonnegative().optional(),
    mobileCountryCode: z.number().int().nonnegative(),
    mobileNetworkCode: z.number().int().nonnegative(),
    signalStrength: z.number().optional(),
    timingAdvance: z.number().nonnegative().optional(),
  })).max(16).optional(),
});

const rangingDeviceObservationSchema = z.object({
  kind: z.literal('ranging'),
  source: z.enum(['wifi_rtt', 'uwb_range', 'uwb_direction', 'ble_rssi', 'ble_aoa', 'bluetooth_proximity']),
  timestamp: z.string().datetime(),
  provider: z.string().max(200).optional(),
  correlationGroup: z.string().max(300).optional(),
  metadata: z.record(z.unknown()).optional(),
  anchors: z.array(z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    distanceMeters: z.number().nonnegative().max(1_000_000),
    uncertaintyMeters: z.number().positive().max(1_000_000).optional(),
    id: z.string().max(200).optional(),
  })).max(32),
});

const deviceObservationSchema = z.discriminatedUnion('kind', [
  absoluteDeviceObservationSchema,
  radioDeviceObservationSchema,
  rangingDeviceObservationSchema,
]);

const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/;

const configuredOsintTimeout = Number(process.env.SPECTRA_OSINT_TIMEOUT_MS);
const SPECTRA_OSINT_TIMEOUT_MS = Number.isFinite(configuredOsintTimeout)
  ? Math.max(15_000, configuredOsintTimeout)
  : 90_000;

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }
> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(
        value => ({ status: 'fulfilled' as const, value }),
        reason => ({ status: 'rejected' as const, reason }),
      ),
      new Promise<{ status: 'rejected'; reason: Error }>(resolve => {
        timer = setTimeout(() => {
          resolve({
            status: 'rejected',
            reason: new Error(`${label} timed out after ${timeoutMs}ms`),
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

function extractLikelyName(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const labeled = text.match(
    /\b(?:name|person|target|individual)\s*(?::|=|\-|is)\s*([A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+){1,3})/i,
  );
  if (labeled?.[1]) return labeled[1].trim();

  const withoutPhone = (() => {
    const phone = extractPhoneNumber(text);
    return phone ? text.replace(phone, ' ') : text;
  })();
  const firstSegment = withoutPhone.split(/[,;|\n]/)[0]
    .replace(/\b(?:phone|number|cell|mobile)\b.*$/i, '')
    .replace(/\b(?:last\s+known|located|lives?|from|near|around)\b.*$/i, '')
    .replace(/^[^A-Za-z]+|[^A-Za-z'’.-]+$/g, '')
    .trim();

  const looksLikeLocation =
    Boolean(extractCityStateHint(firstSegment)) ||
    /\b(?:address|street|st|road|rd|avenue|ave|boulevard|blvd|city|state|county|country|zip|postal)\b/i
      .test(firstSegment);

  if (
    !looksLikeLocation &&
    /^[A-Za-z][A-Za-z'’.-]+(?:\s+[A-Za-z][A-Za-z'’.-]+){1,3}$/.test(firstSegment)
  ) {
    return firstSegment;
  }

  return null;
}

function discoverySourceKey(result: any): string {
  try {
    if (result?.url) return new URL(String(result.url)).hostname.toLowerCase();
  } catch {
    // Malformed URL falls back to title-based identity.
  }
  return String(result?.title || result?.source || 'web-discovery').trim().toLowerCase();
}

function dedupeDiscoveryResults(results: any[]): any[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = result?.url
      ? String(result.url).trim().toLowerCase()
      : `${String(result?.title || '').trim().toLowerCase()}|${String(result?.snippet || '').slice(0, 180).trim().toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDiscoveryQueries(args: {
  resolvedName: string;
  normalizedTarget: string;
  details: string;
  phone?: string;
}): { firstPass: string[]; secondPass: string[] } {
  const { resolvedName, normalizedTarget, details, phone } = args;
  const quotedName = resolvedName ? `"${resolvedName}"` : '';
  const quotedPhone = phone ? `"${phone}"` : '';
  const phoneDigits = phone?.replace(/\D/g, '') || '';
  const compactDetails = details.replace(/\s+/g, ' ').trim();
  const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget);
  const identityAnchor = quotedName || quotedPhone || (!genericTarget ? normalizedTarget : '');

  const firstPass = [
    [quotedName, quotedPhone].filter(Boolean).join(' '),
    [identityAnchor, compactDetails].filter(Boolean).join(' '),
    [normalizedTarget, compactDetails].filter(Boolean).join(' '),
    compactDetails,
    phoneDigits.length >= 7 ? `"${phoneDigits}"` : '',
  ].filter(Boolean);

  // Every supplied clue may seed discovery. Names/phones remain high-value
  // anchors, but location, employer, address, username, vehicle, associate and
  // other clues are never discarded merely because a name/phone is absent.
  const secondPass = [
    [identityAnchor, compactDetails, 'address location'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'employment property profile'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'historical record archive'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'independent corroboration'].filter(Boolean).join(' '),
  ].filter(Boolean);

  return {
    firstPass: [...new Set(firstPass)],
    secondPass: [...new Set(secondPass)],
  };
}

interface SpectraDiscoveryResult {
  title: string;
  url: string;
  snippet?: string;
  provider: string;
  reliability: 'high' | 'medium' | 'low';
  relevanceScore: number;
  metadata?: Record<string, unknown>;
}

function reliabilityForUrl(rawUrl: string): SpectraDiscoveryResult['reliability'] {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.endsWith('.gov') || host.endsWith('.mil') || host.endsWith('.uscourts.gov')) return 'high';
    if (host.includes('courtlistener.com') || host.includes('nursys.com') || host.includes('finra.org')) return 'high';
    if (host.endsWith('.edu') || host.endsWith('.org')) return 'medium';
  } catch {
    return 'low';
  }
  return 'medium';
}

function discoveryResultFromCandidate(candidate: LegalMeshCandidate): SpectraDiscoveryResult {
  const reliability = reliabilityForUrl(candidate.url);
  return {
    title: candidate.title || 'SPECTRA discovery result',
    url: candidate.url,
    snippet: candidate.excerpt,
    provider: candidate.provider || 'native-search',
    reliability,
    relevanceScore: reliability === 'high' ? 92 : reliability === 'medium' ? 78 : 62,
    metadata: {
      discoveryProvider: candidate.provider || 'native-search',
      sourceCategory: candidate.sourceCategory,
    },
  };
}

async function runDiscoveryPass(
  queries: string[],
  context: {
    subject?: string;
    location?: string;
  } = {},
): Promise<{
  results: SpectraDiscoveryResult[];
  attempted: number;
  failed: number;
  claudeNotes: string[];
}> {
  const uniqueQueries = [...new Set(queries.map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, 6);
  if (!uniqueQueries.length) {
    return { results: [], attempted: 0, failed: 0, claudeNotes: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('SPECTRA discovery pass timeout')), 15_000);
  try {
    const nativePromise = Promise.allSettled(uniqueQueries.map(query =>
      discoverLegalMeshTier3(query, controller.signal, {
        categories: [
          'identity',
          'contacts-addresses',
          'relationships',
          'social-online',
          'public-images',
          'employment',
          'property',
          'transportation',
          'business',
          'news-history',
          'relationship-timeline',
          'general-public-records',
        ],
        jurisdiction: context.location,
        subject: context.subject,
        requestedFact: 'contact-address',
      })
    ));

    const claudePrompt = [
      'Use web search and fetch the strongest underlying pages when useful.',
      'This is an internal SPECTRA location-research pass.',
      'Resolve the named subject from every supplied clue and look specifically for current, recent, historical, or location-bearing records.',
      'Keep source distinctions intact. Do not turn an old address, broad regional clue, or prediction into a current observation.',
      context.subject ? `Subject: ${context.subject}` : '',
      context.location ? `Location clue: ${context.location}` : '',
      'Search objectives:',
      ...uniqueQueries.map((query, index) => `${index + 1}. ${query}`),
    ].filter(Boolean).join('\n');

    const claudePromise = callClaudeWebSearch(claudePrompt, {
      maxTokens: 1_200,
      maxUses: 6,
      allowFetch: true,
      signal: controller.signal,
      systemPrompt: [
        'You are SPECTRA\'s internal location-research planner and researcher.',
        'Use search rather than model memory for external facts.',
        'Prefer direct records and source pages, fetch promising pages when useful, preserve dates and uncertainty, and stay focused on the supplied subject and location clues.',
      ].join(' '),
    });

    const [nativeSettled, claudeSettled] = await Promise.allSettled([
      nativePromise,
      claudePromise,
    ]);

    const results: SpectraDiscoveryResult[] = [];
    let failed = 0;

    if (nativeSettled.status === 'fulfilled') {
      for (const queryResult of nativeSettled.value) {
        if (queryResult.status === 'fulfilled') {
          results.push(...queryResult.value.map(discoveryResultFromCandidate));
        } else {
          failed += 1;
        }
      }
    } else {
      failed += uniqueQueries.length;
    }

    const claudeNotes: string[] = [];
    if (claudeSettled.status === 'fulfilled') {
      claudeNotes.push(claudeSettled.value.content);
      for (const source of claudeSettled.value.sources) {
        const reliability = reliabilityForUrl(source.url);
        results.push({
          title: source.title || 'Claude research source',
          url: source.url,
          snippet: source.citedText,
          provider: 'claude-web-research',
          reliability,
          relevanceScore: reliability === 'high' ? 94 : reliability === 'medium' ? 80 : 64,
          metadata: {
            discoveryProvider: 'claude-web-research',
            fetchedOrCitedText: source.citedText,
          },
        });
      }
    } else {
      failed += 1;
    }

    return {
      results: dedupeDiscoveryResults(results),
      attempted: uniqueQueries.length + 1,
      failed,
      claudeNotes,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function sourceForObservation(
  name: string,
  object: Record<string, any>,
  contextPath: string,
): string {
  const lower = [
    name,
    contextPath,
    String(object.platform || ''),
    String(object.source || ''),
    String(object.type || ''),
    String(object.kind || ''),
  ].join(' ').toLowerCase();

  const isSocial =
    /\b(?:instagram|facebook|twitter|tiktok|strava|social)\b/i.test(lower);
  const explicitSocialLocation =
    isSocial &&
    /\b(?:gps|geo|geotag|location|place|check[- ]?in|coordinate)\b/i.test(lower);
  if (explicitSocialLocation) return 'social_geotag';
  if (isSocial) return 'social_media';

  // "social media" must never be mistaken for uploaded media/EXIF. Restrict
  // media classification to explicit artifact/metadata language.
  if (
    /\b(?:exif|xmp|iptc|photo|image|video|quicktime)\b/i.test(lower) ||
    /\b(?:uploaded|attached)\s+media\b/i.test(lower) ||
    /\bmedia\s+metadata\b/i.test(lower)
  ) {
    return /\bvideo|quicktime\b/i.test(lower) ? 'exif_video' : 'exif_photo';
  }

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
  if (raw === undefined || raw === null || raw === '') return null;

  let date: Date;
  if (raw instanceof Date) {
    date = raw;
  } else if (
    typeof raw === 'number' ||
    (typeof raw === 'string' && /^\d{9,16}$/.test(raw.trim()))
  ) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds = numeric < 100_000_000_000
      ? numeric * 1000
      : numeric;
    date = new Date(milliseconds);
  } else {
    date = new Date(raw);
  }

  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const earliest = Date.UTC(1900, 0, 1);
  const latest = Date.now() + 24 * 60 * 60 * 1000;
  if (time < earliest || time > latest) return null;
  return date;
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

    const source = sourceForObservation(sourceName, object, contextPath);
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

router.post('/device-observation', async (req: Request, res: Response) => {
  const parsed = deviceObservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid SPECTRA device observation.' });
  }

  const input = parsed.data;
  let point: GPSPoint | null = null;

  if (input.kind === 'absolute') {
    point = normalizeAbsoluteDeviceObservation({
      ...input,
      timestamp: new Date(input.timestamp),
    });
  } else if (input.kind === 'radio') {
    point = await acquireRadioPosition({
      ...input,
      timestamp: new Date(input.timestamp),
    }, req.signal);
  } else {
    point = acquireRangingPosition({
      ...input,
      timestamp: new Date(input.timestamp),
    });
  }

  if (!point) {
    return res.json({
      success: true,
      acquired: false,
      reason: 'The supplied measurements did not produce an absolute position.',
    });
  }

  const normalized = signServerEvidence(normalizeClientEvidence(point));
  return res.json({
    success: true,
    acquired: true,
    point: {
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
    },
  });
});

router.get('/cameras', async (req: Request, res: Response) => {
  const parsed = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().min(250).max(100_000).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid camera search coordinates.' });
  }

  const cameras = await acquireNearbyTrafficCameras({
    latitude: parsed.data.lat,
    longitude: parsed.data.lng,
    radiusMeters: parsed.data.radiusMeters,
    signal: req.signal,
  });

  return res.json({
    success: true,
    cameras,
    count: cameras.length,
  });
});

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
  const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget);
  const suppliedName = extractLikelyName(details);
  const subject = targetSubject(normalizedTarget);
  const resolvedName = genericTarget || targetIsPhone
    ? suppliedName || ''
    : subject;
  const searchQuery = resolvedName || details;
  const resolvedTargetLabel = resolvedName || phone || normalizedTarget;

  try {
    const semanticSubject = resolveLexaraBackgroundSubject(
      [target, details].filter(Boolean).join('. '),
      [],
    );
    const resolvedSubjectName = semanticSubject?.name || resolvedName || resolvedTargetLabel;
    const discoveryQueries = buildDiscoveryQueries({
      resolvedName: resolvedSubjectName,
      normalizedTarget,
      details,
      phone,
    });
    const sourceWaves = buildSpectraDiscoveryWaves(resolvedTargetLabel, details);
    const waveQueries = sourceWaves.flatMap(wave => wave.targets.map(source => source.query));
    const initialQueries = [...new Set([
      ...discoveryQueries.firstPass,
      ...waveQueries.slice(0, 4),
    ])];

    const backgroundPromise = settleWithin(
      investigateLexaraBackgroundQuestion(
        `Where is ${resolvedTargetLabel}? ${details}`,
        {
          previousMessages: [{ role: 'user', content: details }],
          delegatedByLexara: true,
          resolvedSubject: semanticSubject || undefined,
        },
      ),
      Math.min(SPECTRA_OSINT_TIMEOUT_MS, 20_000),
      'SPECTRA background research',
    );

    const firstPassPromise = runDiscoveryPass(initialQueries, {
      subject: resolvedSubjectName,
      location: semanticSubject?.location || details,
    });

    const [backgroundOutcome, firstPass] = await Promise.all([
      backgroundPromise,
      firstPassPromise,
    ]);

    const background = backgroundOutcome.status === 'fulfilled'
      ? backgroundOutcome.value
      : null;
    const backgroundSources = background?.sources || [];
    const backgroundConfidence = background?.endpoint === 'evidence-sufficient'
      ? 0.82
      : background?.endpoint === 'best-available-evidence'
        ? 0.68
        : background?.endpoint === 'partial-evidence'
          ? 0.52
          : backgroundSources.length > 0
            ? 0.42
            : 0;

    const report = {
      identitySummary: {
        verificationStatus: backgroundConfidence >= 0.8
          ? 'Verified'
          : backgroundConfidence > 0
            ? 'Partial'
            : 'Unknown',
      },
      contactInformation: [] as any[],
      locationHistory: [] as string[],
      employmentAndEducation: [] as any[],
      publicRecords: [] as any[],
      onlineMentions: backgroundSources.map(url => ({
        title: 'SPECTRA background source',
        url,
        snippet: background?.evidenceSummary?.slice(0, 1_200),
      })),
      socialMediaPresence: [] as any[],
      sources: [] as any[],
      confidenceScore: backgroundConfidence,
      summary: background?.evidenceSummary || '',
    };

    let discoveryResults = firstPass.results;
    let discoveryQueriesAttempted = firstPass.attempted;
    let discoveryQueriesFailed = firstPass.failed;
    let discoveryPasses = firstPass.attempted > 0 ? 1 : 0;
    let stagnationPasses = 0;
    const claudeNotes = [...firstPass.claudeNotes];

    // Soft-ceiling recursive broadening. Continue while the investigation is
    // still gaining independent evidence. Stop on sufficiency, diminishing
    // returns, source exhaustion, cancellation, or the explicit resource cap.
    for (let pass = 1; pass < SPECTRA_DISCOVERY_POLICY.maxPasses; pass += 1) {
      const independentSources = new Set(discoveryResults.map(discoverySourceKey).filter(Boolean));
      const highReliability = discoveryResults.filter(result => result.reliability === 'high').length;
      const evidenceConfidence = Math.min(
        0.95,
        backgroundConfidence
          + Math.min(0.42, independentSources.size * 0.055)
          + Math.min(0.18, highReliability * 0.03),
      );

      if (
        independentSources.size >= SPECTRA_DISCOVERY_POLICY.minIndependentSources
        && evidenceConfidence >= SPECTRA_DISCOVERY_POLICY.sufficientConfidence
      ) {
        break;
      }
      if (
        discoveryQueriesAttempted >= SPECTRA_DISCOVERY_POLICY.maxQueries
        || discoveryResults.length >= SPECTRA_DISCOVERY_POLICY.maxCandidates
      ) {
        break;
      }

      const waveOffset = pass * 4;
      const recursiveQuery = buildSpectraAdaptiveQuery(
        resolvedTargetLabel,
        details,
        pass,
        [
          independentSources.size < SPECTRA_DISCOVERY_POLICY.minIndependentSources
            ? 'independent source'
            : '',
          highReliability < 2 ? 'direct record source' : '',
        ].filter(Boolean),
      );
      const nextQueries = [...new Set([
        recursiveQuery,
        ...discoveryQueries.secondPass.slice(Math.max(0, pass - 1), pass + 1),
        ...waveQueries.slice(waveOffset, waveOffset + 4),
      ])].filter(Boolean);

      if (!nextQueries.length) break;

      const beforeCount = discoveryResults.length;
      const nextPass = await runDiscoveryPass(nextQueries, {
        subject: resolvedSubjectName,
        location: semanticSubject?.location || details,
      });
      discoveryQueriesAttempted += nextPass.attempted;
      discoveryQueriesFailed += nextPass.failed;
      discoveryPasses += nextPass.attempted > 0 ? 1 : 0;
      claudeNotes.push(...nextPass.claudeNotes);
      discoveryResults = dedupeDiscoveryResults([
        ...discoveryResults,
        ...nextPass.results,
      ]).slice(0, SPECTRA_DISCOVERY_POLICY.maxCandidates);

      const gained = Math.max(0, discoveryResults.length - beforeCount);
      const gainRatio = gained / Math.max(1, beforeCount);
      stagnationPasses = gainRatio < SPECTRA_DISCOVERY_POLICY.diminishingReturnFloor
        ? stagnationPasses + 1
        : 0;
      if (stagnationPasses >= 2) break;
    }

    if (
      discoveryResults.length === 0
      && backgroundSources.length === 0
      && discoveryQueriesAttempted > 0
      && discoveryQueriesFailed >= discoveryQueriesAttempted
    ) {
      throw new Error('All SPECTRA discovery paths failed');
    }

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

    const normalizedLocationObservations: GPSPoint[] = dedupeObservations(observations)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(point => ({
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
      }));

    const locationQuality = assessLocationQuality(normalizedLocationObservations);
    const qualityLocationObservations = locationQuality.points;

    const fusedLocationEvidence = qualityLocationObservations.length > 0
      ? await inputFusionEngine.fuseInputs(qualityLocationObservations)
      : [];

    const locationObservations = qualityLocationObservations
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
        let region = null;
        for (const locationInput of locationInputs) {
          region = await geocodeBestLocation(locationInput);
          if (region) break;
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
    const latestFusedTimestamp = fusedLocationEvidence.reduce(
      (latest, location) => Math.max(latest, location.point.timestamp.getTime()),
      Number.NEGATIVE_INFINITY,
    );
    const latestFusedCandidates = Number.isFinite(latestFusedTimestamp)
      ? fusedLocationEvidence.filter(location =>
          Math.abs(location.point.timestamp.getTime() - latestFusedTimestamp) <= 5_000
        )
      : [];
    const canonicalLatest = [...latestFusedCandidates]
      .sort((a, b) =>
        b.qualityScore - a.qualityScore ||
        b.point.confidence - a.point.confidence ||
        (a.point.accuracy ?? Number.MAX_SAFE_INTEGER) -
          (b.point.accuracy ?? Number.MAX_SAFE_INTEGER)
      )[0];

    const locationConfidence = canonicalLatest?.qualityScore
      ?? candidateLocations[0]?.confidence
      ?? 0;

    const sourceKeys = new Set<string>();
    for (const point of directEvidence) {
      sourceKeys.add(
        String(point.correlationGroup || `media:${point.source}`).trim().toLowerCase()
      );
    }
    for (const source of report.sources || []) {
      if (normalizeConfidence(source?.confidence) <= 0) continue;
      sourceKeys.add(String(source?.name || 'osint-source').trim().toLowerCase());
    }
    for (const result of discoveryResults) {
      sourceKeys.add(discoverySourceKey(result));
    }
    for (const url of backgroundSources) {
      sourceKeys.add(discoverySourceKey({ url }));
    }

    return res.json({
      success: true,
      target,
      details,
      resolvedTargetLabel,
      acquisition: {
        identityConfidence,
        locationConfidence,
        sourceCount: sourceKeys.size,
        evidenceItemCount:
          directEvidence.length +
          backgroundSources.length +
          discoveryResults.length,
        observationCount: locationObservations.length,
        rejectedObservationCount: locationQuality.rejectedCount,
        qualityIssueCount: locationQuality.issues.length,
        discoveryPasses,
        discoveryQueriesAttempted,
        discoveryQueriesFailed,
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
