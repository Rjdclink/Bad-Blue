import { Router, type Request, type Response } from 'express';
import { getDiscoveryDiagnostics, withDiscoveryDiagnostics } from '../lexara/DiscoveryDiagnostics';
import { z } from 'zod';
import { isAuthenticated } from '../auth';
import {
  arcGisCameras,
  copernicusItems,
  flickrNearbyMedia,
  nwsLatestObservation,
  resolveSpectraNormalizedTelemetryBatch,
  trafficLandCameras,
  wikimediaNearbyMedia,
} from './geoconsole.routes';
import { getPlatformUserId } from '../authIdentity';
import { callClaudeWebSearch } from '../claude';
import {
  discoverLegalMeshTier3,
  discoverLegalMeshSupplemental,
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
  loadSpectraSessionIdentityBindings,
  loadSpectraSessionObservations,
  persistSpectraAcquisition,
} from '../services/spectra/SpectraAcquisitionPersistence';
import {
  assessSpectraIdentityBinding,
  conservativeJointConfidence,
} from '../services/spectra/SpectraIdentityBinding';
import { acquireSpectraPlaceContext } from '../services/spectra/SpectraPlaceContext';
import { retrieveSpectraPublicEvidence } from '../services/spectra/SpectraPublicRetrieval';
import {
  mergePublicRetrievedMetadata,
  stripUnboundPublicGeoContext,
} from '../services/spectra/SpectraPublicEvidenceProvenance';
import { inferCorroboratedRegionalCity } from '../services/spectra/SpectraRegionalInference';
import {
  assessSpectraCityDiscoveryReadiness,
  chooseSpectraPublicRetrievalUrls,
  publicPublisherDomain,
} from '../services/spectra/SpectraCityDiscoveryPolicy';
import { assessSpectraLiveLocation } from '../services/spectra/SpectraLiveConfidence';
import { solveSpectraConstraintLayer } from '../services/spectra/SpectraConstraintSolver';
import { acquireConfiguredSpectraCameras } from '../services/spectra/SpectraCameraDirectoryAdapters';
import { acquireSpectraActiveTelemetry, getSpectraActiveAcquisitionCapabilities } from '../services/spectra/SpectraActiveAcquisition';
import { buildSpectraPipelineDiagnostics, type SpectraRetrievalCounts } from '../services/spectra/SpectraPipelineDiagnostics';

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
  details: z.string().trim().min(1).max(12_000),
  sessionId: z.string().trim().min(1).max(200).optional(),
  originSessionId: z.string().trim().min(1).max(200).optional(),
  directEvidence: z.array(directEvidenceSchema).max(20).default([]),
});

const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/;
const MAC_CANDIDATE_RE = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i;
const LABELED_DEVICE_REF_RE = /\b(?:device(?:\s*(?:id|ref))?|imei|meid|bssid|mac(?:\s+address)?)\s*(?::|=|-)\s*([A-Za-z0-9._:-]{4,120})/i;

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

function extractDeviceRef(value: string): string | undefined {
  const mac = value.match(MAC_CANDIDATE_RE)?.[0]?.trim();
  if (mac) return mac.toLowerCase();
  const labeled = value.match(LABELED_DEVICE_REF_RE)?.[1]?.trim();
  return labeled ? labeled.slice(0, 120) : undefined;
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
  const firstSegment = withoutPhone.split(/[,;|\n]|\s+(?:(?:my|his|her|their)\s+)?(?:email|phone|mobile|cell)\b/i)[0]
    .replace(/\b(?:phone|number|cell|mobile)\b.*$/i, '')
    .replace(/\b(?:last\s+known|located|lives?|from|near|around)\b.*$/i, '')
    .replace(/^[^A-Za-z]+|[^A-Za-z'’.-]+$/g, '')
    .trim().replace(/[.!?]+$/, '');

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
  const email = [normalizedTarget, details].join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget);
  const identityAnchor = quotedName || quotedPhone || (!genericTarget ? normalizedTarget : '');

  const firstPass = [
    [quotedName, quotedPhone].filter(Boolean).join(' '),
    email ? `"${email}"` : '',
    email && quotedName ? `${quotedName} "${email}"` : '',
    phoneDigits.length >= 7 ? `"${phoneDigits}"` : '',
    [identityAnchor, compactDetails].filter(Boolean).join(' '),
    [normalizedTarget, compactDetails].filter(Boolean).join(' '),
    compactDetails,
    phoneDigits.length >= 7 ? `"${phoneDigits}"` : '',
  ].filter(Boolean);

  const secondPass = [
    [identityAnchor, compactDetails, 'address location'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'employment property profile'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'historical record archive'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'media geotag timestamp'].filter(Boolean).join(' '),
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
  context: { subject?: string; location?: string; useClaude?: boolean } = {},
): Promise<{
  results: SpectraDiscoveryResult[];
  attempted: number;
  failed: number;
  claudeNotes: string[];
  retrieval: SpectraRetrievalCounts;
}> {
  const retrieval: SpectraRetrievalCounts = { selected: 0, retrieved: 0, deadlineExpiredPasses: 0 };
  const uniqueQueries = [...new Set(queries.map(query => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, 6);
  if (!uniqueQueries.length) {
    return { results: [], attempted: 0, failed: 0, claudeNotes: [], retrieval };
  }

  const controller = new AbortController();
  // Reserve part of the existing 15-second pass budget for reading pages.
  // A finished search deadline must not pre-cancel the evidence retrieval stage.
  const timer = setTimeout(() => controller.abort(new Error('SPECTRA discovery pass timeout')), 10_000);
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
        allowClaudePlanning: context.useClaude !== false,
      })
    ));

    const claudePrompt = [
      'Use web search and fetch strong underlying pages when useful.',
      'This is an internal SPECTRA location-research pass.',
      'Resolve the supplied subject and clues, and preserve dates, source distinctions, and uncertainty.',
      context.subject ? `Subject: ${context.subject}` : '',
      context.location ? `Location clue: ${context.location}` : '',
      'Search objectives:',
      ...uniqueQueries.map((query, index) => `${index + 1}. ${query}`),
    ].filter(Boolean).join('\n');

    // Recursive passes broaden native retrieval without purchasing the same
    // model-assisted investigation on every pass.
    const claudePromise = context.useClaude === false
      ? Promise.resolve({ content: '', sources: [] })
      : callClaudeWebSearch(claudePrompt, {
      maxTokens: 1_200,
      maxUses: 6,
      allowFetch: true,
      signal: controller.signal,
      systemPrompt: [
        'You are SPECTRA\'s internal location-research planner.',
        'Use search rather than model memory for external facts.',
        'Prefer direct source pages, preserve dates and uncertainty, and keep source families distinct.',
      ].join(' '),
    });

    const [nativeSettled, claudeSettled] = await Promise.allSettled([nativePromise, claudePromise]);
    const results: SpectraDiscoveryResult[] = [];
    let failed = 0;

    if (nativeSettled.status === 'fulfilled') {
      for (const queryResult of nativeSettled.value) {
        if (queryResult.status === 'fulfilled') results.push(...queryResult.value.map(discoveryResultFromCandidate));
        else failed += 1;
      }
    } else {
      failed += uniqueQueries.length;
    }

    const existingUrls = [...new Set(results.map(result => result.url).filter(Boolean))];
    if (existingUrls.length > 0 && uniqueQueries[0]) {
      const supplemental = await discoverLegalMeshSupplemental(
        uniqueQueries[0],
        existingUrls,
        controller.signal,
        {
          categories: ['news-history', 'contacts-addresses', 'social-online', 'public-images', 'property'],
          jurisdiction: context.location,
          subject: context.subject,
          requestedFact: 'contact-address',
          allowClaudePlanning: context.useClaude !== false,
        },
      ).catch(() => []);
      results.push(...supplemental.map(discoveryResultFromCandidate));
    }

    const claudeNotes: string[] = [];
    if (claudeSettled.status === 'fulfilled') {
      if (claudeSettled.value.content) claudeNotes.push(claudeSettled.value.content);
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

    let enrichedResults = dedupeDiscoveryResults(results);
    // More independent public publishers are better evidence than repeated
    // results from one popular website. Fetch those underlying pages first.
    const retrievalTargets = chooseSpectraPublicRetrievalUrls(enrichedResults, 8);
    retrieval.selected = retrievalTargets.length;

    if (retrievalTargets.length) {
      const retrievalController = new AbortController();
      const retrievalTimer = setTimeout(() => {
        retrieval.deadlineExpiredPasses = 1;
        retrievalController.abort(new Error('SPECTRA page retrieval timeout'));
      }, 4_500);
      let retrieved: Awaited<ReturnType<typeof retrieveSpectraPublicEvidence>> = [];
      try {
        const outcome = await settleWithin(
          retrieveSpectraPublicEvidence(retrievalTargets, retrievalController.signal),
          5_000,
          'SPECTRA page retrieval',
        );
        if (outcome.status === 'fulfilled') retrieved = outcome.value;
      } finally {
        clearTimeout(retrievalTimer);
        // Also stop remaining work if an uncancellable upstream operation lost
        // the bounded wait. Late completions cannot mutate the returned result.
        retrievalController.abort();
      }

      retrieval.retrieved = retrieved.length;

      if (retrieved.length) {
        const byUrl = new Map(enrichedResults.map(result => [result.url, result]));
        for (const evidence of retrieved) {
          // Redirects must retain the discovery result's identity and publication
          // provenance. Coordinates embedded in a public venue webpage describe
          // that venue, not the person being searched.
          const existing = byUrl.get(evidence.requestedUrl) || byUrl.get(evidence.url);

          if (existing) {
            existing.metadata = mergePublicRetrievedMetadata(existing.metadata, evidence);
          } else if (evidence.title || evidence.textExcerpt || evidence.observations.length) {
            enrichedResults.push({
              title: evidence.title || 'SPECTRA retrieved source',
              url: evidence.url,
              snippet: evidence.textExcerpt,
              provider: 'spectra-public-retrieval',
              reliability: reliabilityForUrl(evidence.url),
              relevanceScore: 76,
              metadata: mergePublicRetrievedMetadata(undefined, evidence),
            });
          }
        }
        enrichedResults = dedupeDiscoveryResults(enrichedResults);
      }
    }

    return {
      results: enrichedResults,
      attempted: uniqueQueries.length + (context.useClaude === false ? 0 : 1),
      failed,
      claudeNotes,
      retrieval,
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
    const subjectMatchRaw = Number(object.subjectMatchConfidence);
    const subjectMatchConfidence =
      Number.isFinite(subjectMatchRaw) && subjectMatchRaw >= 0 && subjectMatchRaw <= 1
        ? subjectMatchRaw
        : undefined;
    const timestampConfidenceRaw = Number(object.timestampConfidence);
    const timestampConfidence =
      Number.isFinite(timestampConfidenceRaw)
      && timestampConfidenceRaw >= 0
      && timestampConfidenceRaw <= 1
        ? timestampConfidenceRaw
        : undefined;
    const observationConfidence = subjectMatchConfidence === undefined
      ? confidence
      : Math.min(confidence, subjectMatchConfidence);

    out.push({
      latitude,
      longitude,
      altitude: Number.isFinite(altitude) ? altitude : undefined,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: timestamp.toISOString(),
      receivedAt: new Date().toISOString(),
      source,
      confidence: observationConfidence,
      observationKind,
      correlationGroup: `spectra:${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      provenance: {
        provider: sourceName,
        capturedAt: timestamp.toISOString(),
        transformedBy: ['spectra_acquisition'],
      },
      metadata: {
        sourceName,
        subjectMatchConfidence,
        timestampConfidence,
        acquisitionMethod: typeof object.acquisitionMethod === 'string'
          ? object.acquisitionMethod
          : undefined,
        sourceUrl: typeof object.sourceUrl === 'string'
          ? object.sourceUrl
          : undefined,
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


interface SpectraContextEvidence {
  anchor?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    observedAt?: string;
    basis: 'timestamped_observation' | 'regional_candidate';
  };
  places: Awaited<ReturnType<typeof acquireSpectraPlaceContext>>;
  cameras: any[];
  geotaggedMedia: any[];
  weather?: Record<string, unknown>;
  earthObservation: Array<Record<string, unknown>>;
  sourceFamilies: string[];
}

async function collectSpectraContextEvidence(input: {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  observedAt?: Date;
  basis: 'timestamped_observation' | 'regional_candidate';
}): Promise<SpectraContextEvidence> {
  const referenceTime = input.observedAt && Number.isFinite(input.observedAt.getTime())
    ? input.observedAt
    : new Date();
  const earthFrom = new Date(referenceTime.getTime() - 12 * 60 * 60_000);
  const earthTo = new Date(referenceTime.getTime() + 12 * 60 * 60_000);
  const weatherRelevant = Math.abs(Date.now() - referenceTime.getTime()) <= 24 * 60 * 60_000;

  const outcomes = await Promise.allSettled([
    acquireSpectraPlaceContext(input.latitude, input.longitude, 2_000),
    trafficLandCameras(input.latitude, input.longitude, 10),
    arcGisCameras(input.latitude, input.longitude, 10),
    acquireConfiguredSpectraCameras(input.latitude, input.longitude, 10),
    wikimediaNearbyMedia(input.latitude, input.longitude, 5_000),
    flickrNearbyMedia(input.latitude, input.longitude, 5),
    weatherRelevant
      ? nwsLatestObservation(input.latitude, input.longitude)
      : Promise.resolve(null),
    copernicusItems(input.latitude, input.longitude, earthFrom, earthTo),
  ]);

  const places = outcomes[0].status === 'fulfilled' ? outcomes[0].value : [];
  const trafficLand = outcomes[1].status === 'fulfilled' ? outcomes[1].value : [];
  const arcGis = outcomes[2].status === 'fulfilled' ? outcomes[2].value : [];
  const externalCameras = outcomes[3].status === 'fulfilled' ? outcomes[3].value : [];
  const wikimedia = outcomes[4].status === 'fulfilled' ? outcomes[4].value : [];
  const flickr = outcomes[5].status === 'fulfilled' ? outcomes[5].value : [];
  const weather = outcomes[6].status === 'fulfilled' && outcomes[6].value
    ? outcomes[6].value
    : undefined;
  const earthObservation = outcomes[7].status === 'fulfilled' ? outcomes[7].value : [];

  const sourceFamilies: string[] = [];
  if (places.length) sourceFamilies.push('place-context');
  if (trafficLand.length || arcGis.length || externalCameras.length) {
    sourceFamilies.push('public-camera');
  }
  if (wikimedia.length || flickr.length) sourceFamilies.push('geotagged-media');
  if (weather) sourceFamilies.push('weather');
  if (earthObservation.length) sourceFamilies.push('earth-observation');

  return {
    anchor: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt?.toISOString(),
      basis: input.basis,
    },
    places: places.slice(0, 80),
    cameras: [...trafficLand, ...arcGis, ...externalCameras].slice(0, 160),
    geotaggedMedia: [...wikimedia, ...flickr].slice(0, 120),
    weather,
    earthObservation: earthObservation.slice(0, 20),
    sourceFamilies,
  };
}

router.post('/acquire', async (req: Request, res: Response) => withDiscoveryDiagnostics(async () => {
  res.setHeader('X-Spectra-Request-Id', getDiscoveryDiagnostics()!.requestId);
  const parsed = acquireSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Target and target information are required.',
    });
  }

  const {
    target,
    details,
    directEvidence,
    sessionId: requestedSessionId,
    originSessionId,
  } = parsed.data;
  const userId = getPlatformUserId(req.user as any);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  const normalizedTarget = normalizeTargetIntent(target);
  const combinedTargetText = [normalizedTarget, details].filter(Boolean).join(' ');
  const phone = extractPhoneNumber(combinedTargetText);
  const deviceRef = extractDeviceRef(combinedTargetText);
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
    : extractLikelyName(normalizedTarget) || subject;
  const resolvedTargetLabel = resolvedName || phone || normalizedTarget;

  try {
    const persistedObservationsPromise = requestedSessionId
      ? loadSpectraSessionObservations(userId, requestedSessionId).catch(() => [])
      : Promise.resolve([] as GPSPoint[]);
    const identityBindingsPromise = requestedSessionId
      ? loadSpectraSessionIdentityBindings(userId, requestedSessionId).catch(() => [])
      : Promise.resolve([]);

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

    const backgroundBudgetMs = Math.min(SPECTRA_OSINT_TIMEOUT_MS, 20_000);
    const backgroundPromise = settleWithin(
      investigateLexaraBackgroundQuestion(
        `Where is ${resolvedTargetLabel}? ${details}`,
        {
          previousMessages: [{ role: 'user', content: details }],
          delegatedByLexara: true,
          resolvedSubject: semanticSubject || undefined,
          // Start with the usable fallback budget instead of buying a short
          // truncated request followed by the same search again.
          claudeResearchMaxTokens: 2_048,
          claudeRetryTruncatedOutput: false,
          signal: AbortSignal.timeout(backgroundBudgetMs),
        },
      ),
      backgroundBudgetMs,
      'SPECTRA background research',
    );

    const firstPassPromise = runDiscoveryPass(initialQueries, {
      subject: resolvedSubjectName,
      location: semanticSubject?.location || details,
      // The native-first background lane owns the paid fallback. Avoid
      // duplicate Claude searches for this same subject in parallel.
      useClaude: false,
    });
    const activeAcquisitionPromise = acquireSpectraActiveTelemetry({
      deviceRef,
      sessionId: requestedSessionId,
      subjectLabel: resolvedTargetLabel,
    });

    const [
      backgroundOutcome,
      firstPass,
      persistedObservations,
      identityBindingEvidence,
      activeAcquisition,
    ] = await Promise.all([
      backgroundPromise,
      firstPassPromise,
      persistedObservationsPromise,
      identityBindingsPromise,
      activeAcquisitionPromise,
    ]);

    const activeBatchOutcomes = await Promise.allSettled(
      activeAcquisition.batches.map(batch =>
        resolveSpectraNormalizedTelemetryBatch(batch, true)
      ),
    );
    const activeLocationPoints = activeBatchOutcomes.flatMap(outcome =>
      outcome.status === 'fulfilled' ? outcome.value.quality.points : []
    );

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
    const retrievalCounts = { ...firstPass.retrieval };
    let discoveryQueriesAttempted = firstPass.attempted;
    let discoveryQueriesFailed = firstPass.failed;
    let discoveryPasses = firstPass.attempted > 0 ? 1 : 0;
    let stagnationPasses = 0;

    for (let pass = 1; pass < SPECTRA_DISCOVERY_POLICY.maxPasses; pass += 1) {
      const readiness = assessSpectraCityDiscoveryReadiness({
        subject: resolvedName || resolvedSubjectName,
        sources: discoveryResults,
        backgroundConfidence,
      });
      const independentSources = new Set(
        discoveryResults.map(result => publicPublisherDomain(result.url)).filter(
          (domain): domain is string => Boolean(domain)
        )
      );
      const highReliability = readiness.highReliabilityPublisherCount;

      // A large pile of unrelated search results is not evidence of a city.
      // Continue through independent public searches until the public city
      // statement is corroborated or the normal search budget is exhausted.
      if (readiness.sufficientToStop) break;
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
          highReliability < 2 ? 'direct source record' : '',
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
        useClaude: false,
      });
      discoveryQueriesAttempted += nextPass.attempted;
      discoveryQueriesFailed += nextPass.failed;
      retrievalCounts.selected += nextPass.retrieval.selected;
      retrievalCounts.retrieved += nextPass.retrieval.retrieved;
      retrievalCounts.deadlineExpiredPasses += nextPass.retrieval.deadlineExpiredPasses;
      discoveryPasses += nextPass.attempted > 0 ? 1 : 0;
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

    const observations: any[] = [
      ...activeLocationPoints.map(point => ({
        ...point,
        timestamp: point.timestamp.toISOString(),
        receivedAt: point.receivedAt?.toISOString(),
        provenance: point.provenance
          ? {
              ...point.provenance,
              capturedAt: point.provenance.capturedAt instanceof Date
                ? point.provenance.capturedAt.toISOString()
                : point.provenance.capturedAt,
            }
          : undefined,
        metadata: {
          ...(point.metadata || {}),
          acquisitionMethod: 'active-provider-pull',
        },
      })),
      ...persistedObservations.map(point => ({
        ...point,
        timestamp: point.timestamp.toISOString(),
        receivedAt: point.receivedAt?.toISOString(),
        provenance: point.provenance
          ? {
              ...point.provenance,
              capturedAt: point.provenance.capturedAt instanceof Date
                ? point.provenance.capturedAt.toISOString()
                : point.provenance.capturedAt,
            }
          : undefined,
      })),
      ...directEvidence.map(point => {
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
    }),
    ];

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
        stripUnboundPublicGeoContext(result?.metadata),
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
    const constraintSolution = solveSpectraConstraintLayer(qualityLocationObservations);
    const solvedLocationObservations = constraintSolution.points;

    const fusedLocationEvidence = solvedLocationObservations.length > 0
      ? await inputFusionEngine.fuseInputs(solvedLocationObservations)
      : [];

    const locationObservations = solvedLocationObservations
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

      // Keep explicit geographic context as the first authority. If none
      // exists, independently corroborated public references can support a
      // broad city estimate, never a live position or individual street fix.
      const corroboratedCity = inferCorroboratedRegionalCity(
        resolvedName || resolvedSubjectName,
        discoveryResults,
      );
      let region = null;
      let cityCorroborationUsed = false;
      // An independently reported city must not be silently overridden by
      // a search clue supplied by the user (often a historical location).
      if (!region && corroboratedCity) {
        try {
          region = await geocodeCityState(
            `${corroboratedCity.city}, ${corroboratedCity.state}`,
          );
          cityCorroborationUsed = Boolean(region);
        } catch {
          // Failed regional geocoding never substitutes arbitrary coordinates.
        }
      }
      // Preserve a supplied location solely as labeled search context. A
      // geocoder resolving an input clue is not an independent city discovery.
      if (!region) {
        for (const locationInput of locationInputs) {
          try {
            region = await geocodeBestLocation(locationInput);
            if (region) break;
          } catch {
            // One provider or parsing failure must not cancel other clues.
          }
        }
      }
      if (region) {
        candidateLocations.push({
          latitude: region.latitude,
          longitude: region.longitude,
          label: cityCorroborationUsed && corroboratedCity
            ? `${corroboratedCity.city}, ${corroboratedCity.state} (corroborated public residence; not a live location)`
            : `${region.displayName} (supplied search clue; current city not verified)`,
          confidence: cityCorroborationUsed ? 0.35 : 0.05,
          basis: 'regional_context',
          accuracyMeters: Math.max(
            cityCorroborationUsed ? 1_000 : 0,
            region.accuracyMeters,
          ),
        });
      }
    }

    const confidenceRaw = Number(report.confidenceScore);
    const identityConfidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
      : 0;
    const identityBindingAssessment = assessSpectraIdentityBinding({
      baselineIdentityConfidence: identityConfidence,
      targetIsPhone,
      evidence: identityBindingEvidence,
    });
    const boundIdentityConfidence = identityBindingAssessment.confidence;
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

    const baselineLocationConfidence = canonicalLatest?.qualityScore
      ?? candidateLocations[0]?.confidence
      ?? 0;
    const liveLocationAssessment = assessSpectraLiveLocation(solvedLocationObservations);
    const locationConfidence = liveLocationAssessment.isLive
      ? liveLocationAssessment.confidenceScore
      : baselineLocationConfidence;
    // For a person-location claim, both propositions must hold:
    // (1) the subject/device identity is correct, and
    // (2) the live spatial estimate is correct. Treat them as separate
    // evidence dimensions and report the conservative joint confidence.
    const subjectLiveLocationConfidence = conservativeJointConfidence(
      boundIdentityConfidence,
      locationConfidence,
    );

    const sourceKeys = new Set<string>();
    for (const point of activeLocationPoints) {
      sourceKeys.add(
        String(
          point.correlationGroup
          || point.provenance?.provider
          || `active:${point.source}`
        ).trim().toLowerCase()
      );
    }
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

    let contextEvidence: SpectraContextEvidence = {
      places: [],
      cameras: [],
      geotaggedMedia: [],
      earthObservation: [],
      sourceFamilies: [],
    };
    const contextAnchor = canonicalLatest?.point
      ? {
          latitude: canonicalLatest.point.latitude,
          longitude: canonicalLatest.point.longitude,
          accuracyMeters: canonicalLatest.point.accuracy,
          observedAt: canonicalLatest.point.timestamp,
          basis: 'timestamped_observation' as const,
        }
      : candidateLocations[0]
        ? {
            latitude: candidateLocations[0].latitude,
            longitude: candidateLocations[0].longitude,
            accuracyMeters: candidateLocations[0].accuracyMeters,
            basis: 'regional_candidate' as const,
          }
        : null;

    if (contextAnchor) {
      const contextOutcome = await settleWithin(
        collectSpectraContextEvidence(contextAnchor),
        8_500,
        'SPECTRA geographic context',
      );
      if (contextOutcome.status === 'fulfilled') {
        contextEvidence = contextOutcome.value;
      }
    }

    const contextEvidenceItemCount =
      contextEvidence.places.length
      + contextEvidence.cameras.length
      + contextEvidence.geotaggedMedia.length
      + contextEvidence.earthObservation.length
      + (contextEvidence.weather ? 1 : 0);

    const pipelineDiagnostics = buildSpectraPipelineDiagnostics({
      discoveryResults: discoveryResults.length,
      retrieval: retrievalCounts,
      configuredCollectors: getSpectraActiveAcquisitionCapabilities().length,
      activeAttempts: activeAcquisition.attempts,
      activeBatchOutcomes,
      activeObservations: activeLocationPoints.length,
      suppliedObservations: directEvidence.length,
      savedObservations: persistedObservations.length,
      normalizedObservations: normalizedLocationObservations.length,
      acceptedObservations: locationQuality.acceptedCount,
      rejectedObservations: locationQuality.rejectedCount,
      qualityIssues: locationQuality.issues,
      solvedObservations: solvedLocationObservations.length,
      fusedCandidates: fusedLocationEvidence.length,
      regionalCandidates: candidateLocations.length,
    });
    console.info('[SPECTRA Pipeline Summary]', JSON.stringify({
      requestId: getDiscoveryDiagnostics()?.requestId,
      ...pipelineDiagnostics,
    }));

    const persistence = await persistSpectraAcquisition({
      userId,
      sessionId: requestedSessionId,
      subjectLabel: resolvedTargetLabel,
      clues: [target, details],
      observations: solvedLocationObservations,
      state: {
        pipelineDiagnostics,
        constraintSolverDiagnostics: constraintSolution.diagnostics,
        identityConfidence,
        boundIdentityConfidence,
        identityBindingEvidenceCount: identityBindingAssessment.evidenceCount,
        identityBindingProviders: identityBindingAssessment.providers,
        locationConfidence,
        liveLocationStatus: liveLocationAssessment.status,
        liveLocationConfidence: liveLocationAssessment.confidenceScore,
        liveLocationSourceFamilies: liveLocationAssessment.independentFamilyCount,
        liveLocationIndependentDomains: liveLocationAssessment.independentDomainCount,
        liveLocationEffectiveSources: liveLocationAssessment.effectiveSourceCount,
        liveLocationPosteriorSigmaMeters: liveLocationAssessment.posteriorSigmaMeters,
        liveLocationRadius95Meters: liveLocationAssessment.confidenceRadiusMeters95,
        liveLocationRadius99Meters: liveLocationAssessment.confidenceRadiusMeters99,
        liveLocationConsistency: liveLocationAssessment.consistencyScore,
        liveLocationFreshness: liveLocationAssessment.freshnessScore,
        subjectLiveLocationConfidence,
        sourceCount: sourceKeys.size,
        discoveryPasses,
        discoveryQueriesAttempted,
        discoveryQueriesFailed,
        contextSourceFamilies: contextEvidence.sourceFamilies,
        contextEvidenceItemCount,
        activeAcquisitionAttempts: activeAcquisition.attempts.length,
        activeAcquisitionSucceeded: activeAcquisition.attempts.filter(
          attempt => attempt.status === 'fulfilled'
        ).length,
        activeAcquisitionPositionCount: activeLocationPoints.length,
        originSessionId: originSessionId || null,
        lastAcquiredAt: new Date().toISOString(),
      },
    }).catch(error => {
      console.warn('[SPECTRA] Persistence unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        available: false,
        sessionId: requestedSessionId || '',
      };
    });

    return res.json({
      success: true,
      target,
      details,
      resolvedTargetLabel,
      sessionId: persistence.sessionId || requestedSessionId,
      persistenceAvailable: persistence.available,
      acquisition: {
        identityConfidence,
        boundIdentityConfidence,
        identityBindingEvidenceCount: identityBindingAssessment.evidenceCount,
        locationConfidence,
        liveLocationStatus: liveLocationAssessment.status,
        liveLocationConfidence: liveLocationAssessment.confidenceScore,
        liveLocationSourceFamilies: liveLocationAssessment.independentFamilyCount,
        liveLocationIndependentDomains: liveLocationAssessment.independentDomainCount,
        liveLocationEffectiveSources: liveLocationAssessment.effectiveSourceCount,
        liveLocationPosteriorSigmaMeters: liveLocationAssessment.posteriorSigmaMeters,
        liveLocationRadius95Meters: liveLocationAssessment.confidenceRadiusMeters95,
        liveLocationRadius99Meters: liveLocationAssessment.confidenceRadiusMeters99,
        liveLocationConsistency: liveLocationAssessment.consistencyScore,
        liveLocationFreshness: liveLocationAssessment.freshnessScore,
        liveLocationFreshestAgeMs: liveLocationAssessment.freshestAgeMs,
        subjectLiveLocationConfidence,
        sourceCount: sourceKeys.size,
        feedDiagnostics: getDiscoveryDiagnostics(),
        pipelineDiagnostics,
        evidenceItemCount:
          activeLocationPoints.length +
          directEvidence.length +
          backgroundSources.length +
          discoveryResults.length,
        observationCount: locationObservations.length,
        rejectedObservationCount: locationQuality.rejectedCount,
        qualityIssueCount: locationQuality.issues.length,
        discoveryPasses,
        discoveryQueriesAttempted,
        discoveryQueriesFailed,
        contextSourceFamilies: contextEvidence.sourceFamilies,
        contextEvidenceItemCount,
        activeAcquisitionAttempts: activeAcquisition.attempts,
        activeAcquisitionPositionCount: activeLocationPoints.length,
        summary: report.summary || '',
        verificationStatus: report.identitySummary?.verificationStatus || 'Unknown',
      },
      locationObservations,
      candidateLocations,
      contextEvidence,
      liveLocationAssessment,
      identityBindingAssessment,
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
      feedDiagnostics: getDiscoveryDiagnostics(),
    });
  }
}));

export default router;

