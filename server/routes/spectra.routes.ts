import { withoutSpectraTimestamps } from '../../shared/spectraTimestampClues';
import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { getDiscoveryDiagnostics, withDiscoveryDiagnostics, discoveryRequestLifetime, discoverySignal, throwIfDiscoveryCancelled } from '../lexara/DiscoveryDiagnostics';
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
  discoverLegalMeshTier3 as discoverSharedMeshTier3,
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
import { buildSpectraRecursiveClueQueries } from '../services/spectra/SpectraRecursiveClues';
import {
  loadSpectraSessionIdentityBindings,
  loadSpectraSessionObservations,
  persistSpectraAcquisition,
  loadSpectraAcquisitionEvidenceRecords,
} from '../services/spectra/SpectraAcquisitionPersistence';
import { buildSpectraAcquisitionRecords } from '../services/spectra/SpectraAcquisitionRecords';
import { assessSpectraAcquiredEvidence } from '../services/spectra/SpectraEvidenceAssessment';
import { readSpectraPublicFeedRecords } from '../services/spectra/SpectraPublicFeedStore';
import {
  assessSpectraIdentityBinding,
  conservativeJointConfidence,
} from '../services/spectra/SpectraIdentityBinding';
import { acquireSpectraPlaceContext } from '../services/spectra/SpectraPlaceContext';
import { retrieveSpectraPublicEvidence as retrieveDirectPublicEvidence, assertPublicUrl, type SpectraRetrievedEvidence } from '../services/spectra/SpectraPublicRetrieval';
import { createSpectraProviderConnections } from '../services/spectra/SpectraProviderConnections';
const { discover: discoverLegalMeshTier3, retrieve: retrieveSpectraPublicEvidence } = createSpectraProviderConnections({
  discover: discoverSharedMeshTier3, retrieve: retrieveDirectPublicEvidence, validate: assertPublicUrl,
});
import { createSpectraRetrievalDiagnostics, mergeSpectraRetrievalDiagnostics } from '../services/spectra/SpectraRetrievalDiagnostics';
import {
  mergePublicRetrievedMetadata,
  stripUnboundPublicGeoContext,
} from '../services/spectra/SpectraPublicEvidenceProvenance';
import { inferCorroboratedRegionalCity, inferProvisionalRegionalCities, inferPublicContactProfileCities, retrievedRegionalSources } from '../services/spectra/SpectraRegionalInference';
import { inferPublicDirectoryCities } from '../services/spectra/SpectraPublicDirectoryCities';
import { collectSpectraPhoneOrigin } from '../services/spectra/SpectraPhoneOrigin';
import { collectSpectraPhoneInfoga } from '../services/spectra/SpectraPhoneInfoga';
import {
  assessSpectraCityDiscoveryReadiness,
  chooseSpectraPublicRetrievalUrls,
  publicPublisherDomain,
} from '../services/spectra/SpectraCityDiscoveryPolicy';
import { assessSpectraLiveLocation } from '../services/spectra/SpectraLiveConfidence';
import { solveSpectraConstraintLayer } from '../services/spectra/SpectraConstraintSolver';
import { acquireConfiguredSpectraCameras } from '../services/spectra/SpectraCameraDirectoryAdapters';
import { acquireSpectraEnrolledTelemetry, getSpectraEnrolledAcquisitionCapabilities } from '../services/spectra/SpectraEnrolledAcquisition';
import { buildSpectraPipelineDiagnostics, type SpectraRetrievalCounts } from '../services/spectra/SpectraPipelineDiagnostics';
import { acquirePublicPlace, isPublicPlaceTarget } from '../services/spectra/SpectraPublicPlace';
import { collectSpectraPublicAccountRecords, discoverSpectraPublicBlueskyProfiles } from '../services/spectra/SpectraPublicAccountRecords';
import { collectSpectraPublicNewsRecords } from '../services/spectra/SpectraPublicNewsRecords';
import { collectSpectraPublicCourtRecords } from '../services/spectra/SpectraPublicCourtRecords';
import { collectSpectraPublicMastodonRecords, discoverSpectraPublicMastodonProfiles } from '../services/spectra/SpectraPublicMastodonRecords';
import { collectSpectraPublicWikimediaRecords } from '../services/spectra/SpectraPublicWikimediaRecords';
import { publicProfileContactMatch, publicProfileNameMatch } from '../services/spectra/SpectraPublicProfileIdentity';
import { publicProfileLeads } from '../services/spectra/SpectraPublicProfileLeads';
import { collectSpectraPublicBlueskyImages, collectSpectraPublicMastodonImages, collectSpectraPublicSocialPageImages } from '../services/spectra/SpectraPublicImageRecords';
import { prioritizeSpectraPublicMediaScenes } from '../services/spectra/SpectraPublicMediaPriority';
import { collectSpectraXPostMedia } from '../services/spectra/SpectraXPostMedia';
import { summarizeSpectraSceneOverlap } from '../services/spectra/SpectraVisualSceneAnalysis';
import { collectSpectraEarthSearchScenes } from '../services/spectra/SpectraPublicSatelliteRecords';
import { shouldRunSpectraClaudeBackground } from '../services/spectra/SpectraClaudeBudget';
import { takeUnseenSpectraQueries } from '../services/spectra/SpectraDiscoveryDedup';

const router = Router();

// A five-minute page poll is not permission to buy another full investigation.
// Keep only a bounded, tenant+session+input-scoped successful response in RAM.
// A manual search bypasses the cache, and a new deploy naturally clears it.
const SPECTRA_REFRESH_REUSE_MS = 30 * 60_000;
const spectraRecentAcquisitions = new Map<string, { until: number; result: Record<string, any> }>();
function spectraRecentAcquisitionKey(userId: string, sessionId: string, target: string, details: string, origin: string): string {
  return createHash('sha256').update(JSON.stringify([userId, sessionId, target, details, origin])).digest('hex');
}
router.use(isAuthenticated);
router.use((req, res, next) => {
  if (req.method === 'POST' && ['/acquire', '/public-place'].includes(req.path)) {
    discoveryRequestLifetime(req, res, next);
  } else next();
});

// Collection is owned by the server scheduler. Reading records never initiates
// external requests or accepts arbitrary source URLs from the browser.
router.get('/public-records', async (req: Request, res: Response) => {
  const parsed = z.object({
    provider: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    after: z.string().datetime().optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid record filters.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const result = await readSpectraPublicFeedRecords(parsed.data);
    return res.status(result.persistenceAvailable ? 200 : 503).json({ success: result.persistenceAvailable, ...result });
  } catch (error) {
    return res.status(error instanceof RangeError ? 400 : 503).json({ success: false, error: 'Public records are unavailable.' });
  }
});

router.get('/sessions/:sessionId/records', async (req: Request, res: Response) => {
  const userId = getPlatformUserId(req.user as any);
  const sessionId = String(req.params.sessionId || '').trim();
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
  if (!sessionId || sessionId.length > 200) return res.status(400).json({ success: false, error: 'Invalid session.' });
  const filters = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    before: z.string().max(100).optional(),
  }).safeParse(req.query);
  if (!filters.success) return res.status(400).json({ success: false, error: 'Invalid record filters.' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const result = await loadSpectraAcquisitionEvidenceRecords(userId, sessionId, filters.data.limit, filters.data.before);
    return res.status(result.persistenceAvailable ? 200 : result.error === 'Invalid acquisition record cursor.' ? 400 : 503)
      .json({ success: result.persistenceAvailable, ...result });
  } catch {
    return res.status(503).json({ success: false, error: 'Saved acquisition records are unavailable.' });
  }
});

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
  refreshOnly: z.boolean().optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  originSessionId: z.string().trim().min(1).max(200).optional(),
  directEvidence: z.array(directEvidenceSchema).max(20).default([]),
});

const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/;
const MAC_CANDIDATE_RE = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i;
const LABELED_DEVICE_REF_RE = /\b(?:device(?:\s*(?:id|ref))?|imei|meid|bssid|mac(?:\s+address)?)\s*(?::|=|-)\s*([A-Za-z0-9._:-]{4,120})/i;

class SpectraRestoreError extends Error {}

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
  const candidate = withoutSpectraTimestamps(value).match(PHONE_CANDIDATE_RE)?.[0]?.trim();
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
    .replace(/^(?:(?:hey\s+)?spectra[,!:]?\s+|please\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:help\s+me|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to|i(?:'m|\s+am)\s+trying\s+to)\s+)+/i, '')
    .replace(/^(?:show\s+me(?:\s+(?:where|the\s+location\s+of))?|where\s+(?:is|are)|where's|(?:find|figure)\s+out\s+where|(?:tell\s+me|do\s+you\s+know|know)\s+where(?:\s+(?:is|are))?|where\s+can\s+i\s+find|(?:find|locate|track|look\s+for|search\s+for)|(?:what\s+is|what's)\s+the\s+(?:location|whereabouts)\s+of)\s+/i, '')
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
  const firstSegment = withoutPhone.split(/[,;|\n]|\s+(?:using|with)\s+(?:the\s+)?(?:name|phone|email)\b|\s+(?:(?:my|his|her|their)\s+)?(?:email|phone|mobile|cell)\b/i)[0]
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
  const nationalPhone = phoneDigits.length === 11 && phoneDigits.startsWith('1')
    ? phoneDigits.slice(1) : phoneDigits;
  const compactDetails = details.replace(/\s+/g, ' ').trim();
  const email = [normalizedTarget, details].join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget);
  const identityAnchor = quotedName || quotedPhone || (!genericTarget ? normalizedTarget : '');

  const firstPass = [
    [quotedName, quotedPhone].filter(Boolean).join(' '),
    // Broaden to a name/address search once without replacing the contact-
    // bearing queries or repeatedly buying the same generic expansion.
    quotedName ? `${quotedName} address` : '',
    email ? `"${email}"` : '',
    email && quotedName ? `${quotedName} "${email}"` : '',
    phoneDigits.length >= 7 ? `"${phoneDigits}"` : '',
    nationalPhone.length === 10 ? `"${phone}" reverse phone lookup city` : '',
    nationalPhone.length === 10 ? `"${nationalPhone}" (address OR city OR residence)` : '',
    [identityAnchor, compactDetails].filter(Boolean).join(' '),
    quotedName ? `${quotedName} (Facebook OR Instagram OR X OR Bluesky OR Mastodon) profile` : '',
    [normalizedTarget, compactDetails].filter(Boolean).join(' '),
    compactDetails,
    phoneDigits.length >= 7 ? `"${phoneDigits}"` : '',
  ].filter(Boolean);

  const secondPass = [
    quotedName ? `${quotedName} (site:whitepages.com OR site:yellowbook.com) address` : '',
    quotedName ? `${quotedName} (site:peoplelooker.com OR site:spokeo.com OR site:idcrawl.com) "lived in"` : '',
    nationalPhone.length === 10 ? `"${nationalPhone}" (site:whitepages.com OR site:yellowpages.com OR site:spokeo.com)` : '',
    nationalPhone.length === 10 ? `${nationalPhone.slice(0, 3)} area code NANPA geographic assignment` : '',
    nationalPhone.length === 10 ? `${nationalPhone.slice(0, 3)} ${nationalPhone.slice(3, 6)} NPA NXX original carrier rate center` : '',
    quotedName ? `${quotedName} (site:facebook.com OR site:instagram.com OR site:x.com)` : '',
    [identityAnchor, compactDetails, 'public court docket record'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'employment property profile'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'media geotag timestamp'].filter(Boolean).join(' '),
    [identityAnchor, compactDetails, 'historical record archive'].filter(Boolean).join(' '),
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
  context: { subject?: string; location?: string; useClaude?: boolean; allowPaidSearch?: boolean } = {},
  attemptedQueries: Set<string> = new Set<string>(),
  attemptedRetrievalUrls: Set<string> = new Set<string>(),
): Promise<{
  results: SpectraDiscoveryResult[];
  retrievedEvidence: SpectraRetrievedEvidence[];
  attempted: number;
  failed: number;
  claudeNotes: string[];
  retrieval: SpectraRetrievalCounts;
}> {
  const retrieval: SpectraRetrievalCounts = { selected: 0, retrieved: 0, deadlineExpiredPasses: 0 };
  const retrievedEvidence: SpectraRetrievedEvidence[] = [];
  // Each planned query fans out across several HTTP providers. Preserve a
  // representative source mix without turning one user search into 48 calls.
  const uniqueQueries = takeUnseenSpectraQueries(queries, attemptedQueries, 3);
  if (!uniqueQueries.length) {
    return { results: [], retrievedEvidence, attempted: 0, failed: 0, claudeNotes: [], retrieval };
  }

  const passDeadline = Date.now() + 15_000;
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
        queryAlreadyPlanned: true,
        allowClaudePlanning: context.useClaude !== false,
        allowPaidSearch: context.allowPaidSearch === true,
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
          allowPaidSearch: context.allowPaidSearch === true,
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
    // One request must never refetch the same publication on subsequent
    // discovery waves, including prior 403/timeout selections. Fill slots from
    // alternative publishers instead of simply revisiting old URLs.
    const retrievalTargets = chooseSpectraPublicRetrievalUrls(enrichedResults, 16)
      .filter(url => !attemptedRetrievalUrls.has(url)).slice(0, 8);
    for (const url of retrievalTargets) attemptedRetrievalUrls.add(url);
    retrieval.selected = retrievalTargets.length;

    if (retrievalTargets.length) {
      const retrievalDiagnostics = createSpectraRetrievalDiagnostics(retrievalTargets.length);
      const retrievalController = new AbortController();
      // Fast search leaves time for cold reader responses. Slow search retains
      // the original overall 15-second bound instead of extending the pass.
      const retrievalBudgetMs = Math.max(1, Math.min(8_000, passDeadline - Date.now() - 250));
      const retrievalTimer = setTimeout(() => {
        retrieval.deadlineExpiredPasses = 1;
        retrievalController.abort(new Error('SPECTRA page retrieval timeout'));
      }, Math.max(1, retrievalBudgetMs - 250));
      let retrieved: Awaited<ReturnType<typeof retrieveSpectraPublicEvidence>> = [];
      try {
        const outcome = await settleWithin(
          retrieveSpectraPublicEvidence(retrievalTargets, retrievalController.signal, retrievalDiagnostics.record),
          retrievalBudgetMs,
          'SPECTRA page retrieval',
        );
        if (outcome.status === 'fulfilled') retrieved = outcome.value;
      } finally {
        clearTimeout(retrievalTimer);
        // Also stop remaining work if an uncancellable upstream operation lost
        // the bounded wait. Late completions cannot mutate the returned result.
        retrievalController.abort();
        retrieval.diagnostics = retrievalDiagnostics.finish();
      }

      retrieval.retrieved = retrieved.length;
      retrievedEvidence.push(...retrieved);

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
      retrievedEvidence,
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

const SPECTRA_CONTEXT_CACHE_MS = 5 * 60_000;
const spectraContextCache = new Map<string, { until: number; result: SpectraContextEvidence }>();

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
  // Public geographic context is shared by locations, not by subject identity.
  // Reuse recent results on recurring sessions instead of re-requesting every API.
  const key = [
    input.latitude.toFixed(3), input.longitude.toFixed(3), input.basis,
    Math.floor(referenceTime.getTime() / 3_600_000),
  ].join(':');
  const cached = spectraContextCache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  // Sentinel-2 does not revisit every coordinate every 24 hours. Search for
  // the latest actual acquisition; its timestamp remains an observation date,
  // never a current person location or live camera frame.
  const earthFrom = new Date(referenceTime.getTime() - 21 * 86_400_000);
  const earthTo = new Date(referenceTime.getTime());
  // Local weather observations only add evidence around an actual dated
  // measurement. A city/name/phone-based regional hint is not a weather sample.
  const weatherRelevant = input.basis === 'timestamped_observation'
    && Math.abs(Date.now() - referenceTime.getTime()) <= 24 * 60 * 60_000;

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
    collectSpectraEarthSearchScenes(input.latitude, input.longitude, earthFrom, earthTo),
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
  const copernicus = outcomes[7].status === 'fulfilled' ? outcomes[7].value : [];
  const earthSearch = outcomes[8].status === 'fulfilled' ? outcomes[8].value : [];
  // Two independent catalogues can index the exact same Sentinel overpass.
  // Treat equal platform/minute as one acquisition, not two confirmations.
  const acquired = new Map<string, Record<string, unknown>>();
  for (const item of [...copernicus, ...earthSearch.map(scene => ({ ...scene }))]) {
    const observedMs = Date.parse(String(item.observedAt || ''));
    if (!Number.isFinite(observedMs)) continue;
    const family = /landsat/i.test(String(item.collection || '')) ? 'landsat'
      : /sentinel/i.test(String(item.collection || '')) ? 'sentinel' : String(item.collection || 'other');
    const platform = String(item.platform || family).toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = platform + ':' + Math.floor(observedMs / 60_000);
    if (!acquired.has(key)) acquired.set(key, item);
  }
  const earthObservation = [...acquired.values()]
    .sort((a, b) => Date.parse(String(b.observedAt)) - Date.parse(String(a.observedAt)))
    .slice(0, 20);

  const sourceFamilies: string[] = [];
  if (places.length) sourceFamilies.push('place-context');
  if (trafficLand.length || arcGis.length || externalCameras.length) {
    sourceFamilies.push('public-camera');
  }
  if (wikimedia.length || flickr.length) sourceFamilies.push('geotagged-media');
  if (weather) sourceFamilies.push('weather');
  if (earthObservation.length) sourceFamilies.push('earth-observation');

  const result: SpectraContextEvidence = {
    anchor: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      observedAt: input.observedAt?.toISOString(),
      basis: input.basis,
    },
    places: places.slice(0, 80),
    cameras: (() => {
      const seen = new Set<string>();
      return [...trafficLand, ...arcGis, ...externalCameras].filter(camera => {
        if (!camera || camera.status?.disabled === true
          || !Number.isFinite(camera.latitude) || !Number.isFinite(camera.longitude)
          || Math.abs(camera.latitude) > 90 || Math.abs(camera.longitude) > 180) return false;
        const key = String(camera.provider || '') + ':' + String(camera.id || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 160);
    })(),
    geotaggedMedia: [...wikimedia, ...flickr].slice(0, 120),
    weather,
    earthObservation: earthObservation.slice(0, 20),
    sourceFamilies,
  };
  if (spectraContextCache.size >= 32) spectraContextCache.delete(spectraContextCache.keys().next().value!);
  spectraContextCache.set(key, {
    until: Date.now() + (result.sourceFamilies.length ? SPECTRA_CONTEXT_CACHE_MS : 60_000),
    result,
  });
  return result;
}

router.post('/public-place', async (req: Request, res: Response) => withDiscoveryDiagnostics(async () => {
  const parsed = z.object({ target: z.string().trim().min(1).max(200), details: z.string().max(12_000), sessionId: z.string().trim().min(1).max(200).optional() }).safeParse(req.body);
  if (!parsed.success || !isPublicPlaceTarget(parsed.data.target)) {
    return res.status(400).json({ success: false, error: 'Enter the name of a supported public venue, such as a museum or library.' });
  }
  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
  try {
    const { target, details } = parsed.data;
    const result = await acquirePublicPlace(target, details, {
      discover: (query, signal) => discoverLegalMeshTier3(query, signal, { subject: target, firstUseful: true }),
      retrieve: retrieveSpectraPublicEvidence,
      geocode: geocodeCityState,
    });
    throwIfDiscoveryCancelled();
    const persistence = await persistSpectraAcquisition({
      userId,
      sessionId: parsed.data.sessionId,
      subjectLabel: target,
      clues: [target, details],
      observations: [],
      evidenceRecords: result.records.map(record => ({
        recordType: 'retrieved_document' as const,
        provider: 'spectra-public-retrieval',
        sourceUrl: record.sourceUrl,
        retrievedAt: record.retrievedAt,
        payload: { ...record },
      })),
      state: { publicPlaceDiagnostics: result.diagnostics, lastAcquiredAt: new Date().toISOString() },
    }).catch(() => ({ available: false, sessionId: parsed.data.sessionId || '', evidenceRecordCount: 0, evidenceRecordsOmitted: result.records.length }));
    console.info('[SPECTRA Public Place Summary]', JSON.stringify(result.diagnostics));
    return res.json({
      success: true, target, resolvedTargetLabel: target,
      sessionId: persistence.sessionId || undefined,
      persistenceAvailable: persistence.available,
      evidenceArchive: { stored: persistence.evidenceRecordCount || 0, omitted: persistence.evidenceRecordsOmitted || 0 },
      locationObservations: [], candidateLocations: result.candidates,
      publicPlace: result,
      acquisition: {
        identityConfidence: 0, locationConfidence: 0,
        sourceCount: new Set(result.sources.map(source => new URL(source.url).hostname)).size,
        observationCount: 0, feedDiagnostics: getDiscoveryDiagnostics(),
        summary: result.diagnostics.outcome, verificationStatus: 'Source-reported venue context',
      },
    });
  } catch {
    return res.status(502).json({ success: false, error: 'Public-place acquisition could not complete.' });
  }
}));

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
    refreshOnly,
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
  const email = combinedTargetText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
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
    // Restore first: an unavailable store must not launch a replacement search
    // or let a refresh overwrite an investigation as if its history were empty.
    const [persistedObservations, identityBindingEvidence] = requestedSessionId
      ? await Promise.all([
          loadSpectraSessionObservations(userId, requestedSessionId),
          loadSpectraSessionIdentityBindings(userId, requestedSessionId),
        ]).catch(() => { throw new SpectraRestoreError(); })
      : [[], []];

    const refreshKey = requestedSessionId && directEvidence.length === 0
      ? spectraRecentAcquisitionKey(userId, requestedSessionId, target, details, originSessionId || '')
      : null;
    if (refreshOnly && refreshKey) {
      const prior = spectraRecentAcquisitions.get(refreshKey);
      if (prior && prior.until > Date.now()) {
        console.info('[SPECTRA Refresh] reused recent session evidence without provider requests');
        return res.json({ ...prior.result, acquisition: {
          ...prior.result.acquisition, reusedRecentEvidence: true,
        } });
      }
    }
    // The selected target owns identity. Conversation details may contain the
    // assistant's "Open SPECTRA" launch text or unrelated earlier subjects.
    // They must not replace that target in either discovery or background work.
    const semanticSubject = resolveLexaraBackgroundSubject(
      resolvedTargetLabel,
      [],
    ) || { name: resolvedTargetLabel, kind: 'person' as const, identifiable: Boolean(phone || email) };
    const resolvedSubjectName = resolvedName || semanticSubject.name || resolvedTargetLabel;
    // The discovery mesh treats jurisdiction as a place. Contact details are
    // search clues, not a jurisdiction; passing them there polluted every
    // generated query in the live name/phone/email test.
    const discoveryJurisdiction = semanticSubject?.location
      || extractCityStateHint([target, details].filter(Boolean).join(' '))?.query
      || undefined;
    const discoveryQueries = buildDiscoveryQueries({
      resolvedName: resolvedSubjectName,
      normalizedTarget,
      details,
      phone,
    });
    const sourceWaves = buildSpectraDiscoveryWaves(resolvedTargetLabel, details);
    const waveQueries = sourceWaves.flatMap(wave => wave.targets.map(source => source.query));
    // Within the narrower budget, reserve the third initial query for a
    // public social/photo source family rather than spending every slot on
    // similar address/phone expansions.
    const mediaWaveQueries = sourceWaves.flatMap(wave => wave.targets)
      .filter(item => item.clueKinds.includes('social') || item.clueKinds.includes('media'))
      .map(item => item.query);
    const initialQueries = [...new Set([
      ...discoveryQueries.firstPass.slice(0, 2),
      ...mediaWaveQueries.slice(0, 1),
      ...discoveryQueries.firstPass.slice(2),
      ...waveQueries.slice(0, 4),
    ])];

    const backgroundBudgetMs = Math.min(SPECTRA_OSINT_TIMEOUT_MS, 20_000);
    // The visible-page five-minute refresh keeps collecting public records,
    // but must not repurchase the same Claude research for unchanged clues.
    // A manual acquisition still receives the full initial investigation.
    const backgroundPromise = !shouldRunSpectraClaudeBackground({ refreshOnly, sessionId: requestedSessionId })
      ? Promise.resolve({ status: 'fulfilled' as const, value: null })
      : settleWithin(
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
          // SerpApi/ScrapingBee are opt-in for this evidence-heavy endpoint.
          // Native, keyless and source-direct retrieval remain active.
          allowPaidSearch: process.env.SPECTRA_PAID_SEARCH_ENABLED === 'true',
          signal: discoverySignal(AbortSignal.timeout(backgroundBudgetMs)),
        },
      ),
      backgroundBudgetMs,
      'SPECTRA background research',
    );

    const attemptedDiscoveryQueries = new Set<string>();
    const attemptedRetrievalUrls = new Set<string>();
    const firstPassPromise = runDiscoveryPass(initialQueries, {
      subject: resolvedSubjectName,
      location: discoveryJurisdiction,
      // The native-first background lane owns the paid fallback. Avoid
      // duplicate Claude searches for this same subject in parallel.
      useClaude: false,
      allowPaidSearch: process.env.SPECTRA_PAID_SEARCH_ENABLED === 'true',
    }, attemptedDiscoveryQueries, attemptedRetrievalUrls);
    const activeAcquisitionPromise = acquireSpectraEnrolledTelemetry({
      userId,
      phoneNumber: phone,
      deviceRef,
      sessionId: requestedSessionId,
      subjectLabel: resolvedTargetLabel,
    });
    const publicAccountPromise = collectSpectraPublicAccountRecords(combinedTargetText);
    const publicProfileCandidatesPromise = discoverSpectraPublicBlueskyProfiles(resolvedName);
    const publicMastodonPromise = collectSpectraPublicMastodonRecords(combinedTargetText);
    const publicMastodonCandidatesPromise = discoverSpectraPublicMastodonProfiles(resolvedName);
    const publicWikimediaPromise = collectSpectraPublicWikimediaRecords(combinedTargetText);
    const publicNewsPromise = collectSpectraPublicNewsRecords(resolvedName || resolvedSubjectName);
    const publicCourtPromise = collectSpectraPublicCourtRecords(resolvedName || resolvedSubjectName);
    const phoneOriginPromise = collectSpectraPhoneOrigin(phone);
    const phoneInfogaPromise = collectSpectraPhoneInfoga(phone);

    const [
      backgroundOutcome,
      firstPass,
      activeAcquisition,
      publicAccount,
      publicProfileCandidates,
      publicMastodon,
      publicMastodonCandidates,
      publicWikimedia,
      publicNews,
      publicCourt,
      phoneOrigin,
      phoneInfoga,
    ] = await Promise.all([
      backgroundPromise,
      firstPassPromise,
      activeAcquisitionPromise,
      publicAccountPromise,
      publicProfileCandidatesPromise,
      publicMastodonPromise,
      publicMastodonCandidatesPromise,
      publicWikimediaPromise,
      publicNewsPromise,
      publicCourtPromise,
      phoneOriginPromise,
      phoneInfogaPromise,
    ]);

    // Exact public contact matches rank candidates ahead of name-only matches.
    // They corroborate a clue, but do not authenticate who controls an account.
    const contactMatch = (record: SpectraRetrievedEvidence) =>
      publicProfileContactMatch(record, { email, phone });
    publicProfileCandidates.records.sort((a, b) => Number(Boolean(contactMatch(b))) - Number(Boolean(contactMatch(a))));
    publicMastodonCandidates.records.sort((a, b) => Number(Boolean(contactMatch(b))) - Number(Boolean(contactMatch(a))));

    // Search providers also find public profile links outside either account
    // directory's first page. Resolve at most two such leads per platform to
    // source JSON, and retain only profiles whose own display name matches.
    const blueskyApiUrls = publicProfileCandidates.records.slice(0, 2).map(record => record.url);
    const mastodonApiUrls = publicMastodonCandidates.records.slice(0, 2).map(record => record.url);
    const foundProfileUrls = firstPass.results.map(result => result.url);
    const blueskyUrls = [...new Set([...blueskyApiUrls,
      ...publicProfileLeads(foundProfileUrls, 'bluesky', [...blueskyApiUrls, publicAccount.profileUrl || ''])])]
      .filter(url => url !== publicAccount.profileUrl).slice(0, 4);
    const mastodonUrls = [...new Set([...mastodonApiUrls,
      ...publicProfileLeads(foundProfileUrls, 'mastodon', [...mastodonApiUrls, publicMastodon.profileUrl || ''])])]
      .filter(url => url !== publicMastodon.profileUrl).slice(0, 4);
    const [blueskyFetched, mastodonFetched] = await Promise.all([
      Promise.all(blueskyUrls.map(url => collectSpectraPublicAccountRecords(url))),
      Promise.all(mastodonUrls.map(url => collectSpectraPublicMastodonRecords(url))),
    ]);
    const blueskyCandidateCollections = blueskyFetched.filter(collection =>
      collection.records.some(record => record.title === 'Public Bluesky profile'
        && publicProfileNameMatch(record, resolvedName))
    );
    const mastodonCandidateCollections = mastodonFetched.filter(collection =>
      collection.records.some(record => record.title === 'Public Mastodon profile'
        && publicProfileNameMatch(record, resolvedName))
    );
    for (const collection of blueskyCandidateCollections) {
      if (publicProfileCandidates.records.some(record => record.url === collection.profileUrl)) continue;
      const profile = collection.records.find(record => record.title === 'Public Bluesky profile');
      if (profile) publicProfileCandidates.records.push({ ...profile, title: 'Possible public Bluesky profile' });
    }
    for (const collection of mastodonCandidateCollections) {
      if (publicMastodonCandidates.records.some(record => record.url === collection.profileUrl)) continue;
      const profile = collection.records.find(record => record.title === 'Public Mastodon profile');
      if (profile) publicMastodonCandidates.records.push({ ...profile, title: 'Possible public Mastodon profile' });
    }
    // A public display-name match never becomes subject identity or a
    // location observation. Posts retain their source timestamps and media.
    const blueskyCandidatePosts = blueskyCandidateCollections.flatMap(collection =>
      collection.records.filter(record => record.title === 'Public Bluesky post')
    );
    const mastodonCandidatePosts = mastodonCandidateCollections.flatMap(collection =>
      collection.records.filter(record => record.title === 'Public Mastodon status')
    );
    // Inspect public media as source-file evidence; a profile ownership match
    // is not a prerequisite and no EXIF becomes a target position observation.
    const [publicBlueskyImages, publicMastodonImages] = await Promise.all([
      collectSpectraPublicBlueskyImages([
        ...blueskyCandidatePosts,
        ...publicAccount.records.filter(record => record.title === 'Public Bluesky post'),
      ]),
      collectSpectraPublicMastodonImages([
        ...mastodonCandidatePosts,
        ...publicMastodon.records.filter(record => record.title === 'Public Mastodon status'),
      ]),
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
        // A model's research completion score cannot verify that two public
        // records concern the same person. Preserve that distinction in the
        // report until independent identity binding is actually available.
        verificationStatus: backgroundConfidence > 0 ? 'Partial' : 'Unknown',
      },
      contactInformation: [] as any[],
      locationHistory: [] as string[],
      employmentAndEducation: [] as any[],
      publicRecords: [...publicProfileCandidates.records.map(record => ({
        title: record.title, url: record.url, snippet: record.textExcerpt,
        provider: 'Bluesky public API',
        identityStatus: contactMatch(record)
          ? 'Name and public contact match; account ownership unverified'
          : 'Name match only; account ownership unverified',
      })), ...blueskyCandidatePosts.map(record => ({
        title: record.title, url: record.url, publishedAt: record.publishedAt,
        snippet: record.textExcerpt, provider: 'Bluesky public API',
        identityStatus: 'Possible profile; post ownership of target unverified',
      })), ...publicBlueskyImages.records.map(record => ({
        title: record.title, url: record.url, publishedAt: record.publishedAt,
        snippet: record.textExcerpt, provider: 'Bluesky public image CDN',
        identityStatus: 'Public image inspected; scene and subject presence unverified',
      })), ...publicAccount.records.map(record => ({
        title: record.title,
        url: record.url,
        publishedAt: record.publishedAt,
        snippet: record.textExcerpt,
        provider: 'Bluesky public API',
        identityStatus: 'Profile link supplied; ownership not independently verified',
      })), ...publicMastodonCandidates.records.map(record => ({
        title: record.title, url: record.url, snippet: record.textExcerpt,
        provider: 'Mastodon public API',
        identityStatus: contactMatch(record)
          ? 'Name and public contact match; account ownership unverified'
          : 'Name match only; account ownership unverified',
      })), ...mastodonCandidatePosts.map(record => ({
        title: record.title, url: record.url, publishedAt: record.publishedAt,
        snippet: record.textExcerpt, provider: 'Mastodon public API',
        identityStatus: 'Possible profile; post ownership of target unverified',
      })), ...publicMastodonImages.records.map(record => ({
        title: record.title, url: record.url, publishedAt: record.publishedAt,
        snippet: record.textExcerpt, provider: 'Mastodon public image',
        identityStatus: 'Public image file metadata inspected',
      })), ...publicMastodon.records.map(record => ({
        title: record.title,
        url: record.url,
        publishedAt: record.publishedAt,
        snippet: record.textExcerpt,
        provider: 'Mastodon public API',
        identityStatus: 'Profile link supplied; ownership not independently verified',
      })), ...publicWikimedia.records.map(record => ({
        title: record.title, url: record.url, provider: 'Wikimedia Commons API',
        identityStatus: 'Image subject and capture location unverified',
      })), ...publicNews.records.map(record => ({
        title: record.title || 'Retrieved public news article',
        url: record.url,
        publishedAt: record.publishedAt,
        snippet: record.textExcerpt,
        provider: 'GDELT article lead; publisher page retrieved',
        identityStatus: 'Article association with subject not independently verified',
      })), ...publicCourt.records.map(record => ({
        title: record.title, url: record.url, publishedAt: record.publishedAt,
        snippet: record.textExcerpt, provider: 'CourtListener public RECAP search',
        identityStatus: 'Case-name match only; party identity, residence, and current location unverified',
      }))],
      onlineMentions: backgroundSources.map(url => ({
        title: 'SPECTRA background source',
        url,
        snippet: background?.evidenceSummary?.slice(0, 1_200),
      })),
      socialMediaPresence: [
        ...publicProfileCandidates.records.map(record => ({
          platform: 'Bluesky', url: record.url,
          recordCount: Math.max(1, blueskyCandidateCollections.find(item => item.profileUrl === record.url)?.records.length || 0),
          identityStatus: contactMatch(record) ? 'Public contact match; unverified' : 'Name match only; unverified',
        })),
        ...publicMastodonCandidates.records.map(record => ({
          platform: 'Mastodon', url: record.url,
          recordCount: Math.max(1, mastodonCandidateCollections.find(item => item.profileUrl === record.url)?.records.length || 0),
          identityStatus: contactMatch(record) ? 'Public contact match; unverified' : 'Name match only; unverified',
        })),
        ...(publicAccount.profileUrl
          ? [{ platform: 'Bluesky', url: publicAccount.profileUrl,
            recordCount: publicAccount.records.length, identityStatus: 'Unverified' }] : []),
        ...(publicMastodon.profileUrl
          ? [{ platform: 'Mastodon', url: publicMastodon.profileUrl,
            recordCount: publicMastodon.records.length, identityStatus: 'Unverified' }] : []),
      ],
      sources: [] as any[],
      confidenceScore: backgroundConfidence,
      summary: background?.evidenceSummary || '',
    };

    let discoveryResults = dedupeDiscoveryResults([
      ...firstPass.results,
      ...publicProfileCandidates.records.map(record => ({
        title: record.title || 'Possible public Bluesky profile',
        url: record.url,
        snippet: record.textExcerpt,
        provider: 'bluesky-public-api',
        reliability: 'medium' as const,
        relevanceScore: 35,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'bluesky-public-api',
          subjectAssociation: 'name_match_unverified',
        },
      })),
      ...publicMastodonCandidates.records.map(record => ({
        title: record.title || 'Possible public Mastodon profile',
        url: record.url,
        snippet: record.textExcerpt,
        provider: 'mastodon-public-api',
        reliability: 'medium' as const,
        relevanceScore: 35,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'mastodon-public-api',
          subjectAssociation: 'name_match_unverified',
        },
      })),
      ...[...blueskyCandidatePosts, ...mastodonCandidatePosts].map(record => ({
        title: record.title || 'Public candidate post',
        url: record.url, snippet: record.textExcerpt,
        provider: record.title === 'Public Mastodon status' ? 'mastodon-public-api' : 'bluesky-public-api',
        reliability: 'medium' as const,
        relevanceScore: 25,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: record.title === 'Public Mastodon status' ? 'mastodon-public-api' : 'bluesky-public-api',
          subjectAssociation: 'name_match_unverified',
        },
      })),
      ...publicAccount.records.map(record => ({
        title: record.title || 'Public Bluesky post',
        url: record.url,
        snippet: record.textExcerpt,
        provider: 'bluesky-public-api',
        reliability: 'medium' as const,
        relevanceScore: 65,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'bluesky-public-api',
          subjectAssociation: 'supplied_profile_url_unverified',
        },
      })),
      ...publicMastodon.records.map(record => ({
        title: record.title || 'Public Mastodon status',
        url: record.url,
        snippet: record.textExcerpt,
        provider: 'mastodon-public-api',
        reliability: 'medium' as const,
        relevanceScore: 65,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'mastodon-public-api',
          subjectAssociation: 'supplied_profile_url_unverified',
        },
      })),
      ...publicNews.records.map(record => ({
        title: record.title || 'Retrieved public news article',
        url: record.url,
        snippet: record.textExcerpt || '',
        provider: 'gdelt-article-retrieval',
        reliability: 'medium' as const,
        relevanceScore: 55,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'gdelt-article-retrieval',
          subjectAssociation: 'unverified_article_mention',
        },
      })),
      ...publicCourt.records.map(record => ({
        title: record.title || 'Public court docket metadata',
        url: record.url, snippet: record.textExcerpt,
        provider: 'courtlistener-public-recap',
        reliability: 'high' as const,
        relevanceScore: 35,
        metadata: {
          ...mergePublicRetrievedMetadata(undefined, record),
          retrievalProvider: 'courtlistener-public-recap',
          subjectAssociation: 'case_name_match_unverified',
        },
      })),
    ]);
    // Preserve fetched records independently of search-result ranking/deduping.
    // A later successful fetch of an existing search hit must reach the archive.
    const searchRetrievedEvidence = [...firstPass.retrievedEvidence];
    const retrievedEvidence = [
      ...firstPass.retrievedEvidence, ...publicProfileCandidates.records,
      ...blueskyCandidatePosts, ...publicBlueskyImages.records, ...publicAccount.records,
      ...publicMastodonCandidates.records, ...mastodonCandidatePosts,
      ...publicMastodonImages.records, ...publicMastodon.records, ...publicWikimedia.records, ...publicNews.records,
      ...publicCourt.records,
      ...phoneOrigin.records,
    ];
    // Person-city guesses must rest on the retrieved publisher text. A search
    // title or snippet can describe someone else even when the URL resolves.
    const fetchedCitySources = () => [...discoveryResults.filter(result =>
      result.metadata?.subjectAssociation !== 'supplied_profile_url_unverified'
      && result.metadata?.subjectAssociation !== 'name_match_unverified'
      && result.metadata?.subjectAssociation !== 'case_name_match_unverified'
      && typeof result.metadata?.fetchedExcerpt === 'string'
    ).map(result => ({
      ...result, title: '', snippet: '',
      metadata: { ...result.metadata, fetchedOrCitedText: undefined },
    })), ...retrievedRegionalSources(searchRetrievedEvidence)];
    const retrievalCounts = { ...firstPass.retrieval };
    let discoveryQueriesAttempted = firstPass.attempted;
    let discoveryQueriesFailed = firstPass.failed;
    let discoveryPasses = firstPass.attempted > 0 ? 1 : 0;
    let stagnationPasses = 0;
    const recursiveCluesSeen = new Set<string>();

    for (let pass = 1; pass < SPECTRA_DISCOVERY_POLICY.maxPasses; pass += 1) {
      const readiness = assessSpectraCityDiscoveryReadiness({
        subject: resolvedName || resolvedSubjectName,
        sources: fetchedCitySources(),
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
      const recursiveClueQueries = buildSpectraRecursiveClueQueries(
        resolvedTargetLabel,
        searchRetrievedEvidence,
        recursiveCluesSeen,
        4,
      );
      const nextQueries = [...new Set([
        ...recursiveClueQueries,
        recursiveQuery,
        ...discoveryQueries.secondPass.slice(Math.max(0, pass - 1), pass + 1),
        ...waveQueries.slice(waveOffset, waveOffset + 4),
      ])].filter(Boolean);

      if (!nextQueries.length) break;

      const beforeCount = discoveryResults.length;
      const nextPass = await runDiscoveryPass(nextQueries, {
        subject: resolvedSubjectName,
        location: discoveryJurisdiction,
        useClaude: false,
        allowPaidSearch: process.env.SPECTRA_PAID_SEARCH_ENABLED === 'true',
      }, attemptedDiscoveryQueries, attemptedRetrievalUrls);
      discoveryQueriesAttempted += nextPass.attempted;
      retrievedEvidence.push(...nextPass.retrievedEvidence);
      searchRetrievedEvidence.push(...nextPass.retrievedEvidence);
      discoveryQueriesFailed += nextPass.failed;
      retrievalCounts.selected += nextPass.retrieval.selected;
      retrievalCounts.retrieved += nextPass.retrieval.retrieved;
      retrievalCounts.deadlineExpiredPasses += nextPass.retrieval.deadlineExpiredPasses;
      retrievalCounts.diagnostics = mergeSpectraRetrievalDiagnostics([
        retrievalCounts.diagnostics, nextPass.retrieval.diagnostics,
      ]);
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

    // Only image URLs from retrieved public Facebook, Instagram or X post
    // HTML qualify. Failed/blocked webpages never generate image evidence.
    // Expand only already-retrieved public X posts using the official API
    // when an authorized bearer token is configured. Never run an unbounded
    // account scan or treat posts as subject position observations.
    const xPostMedia = await collectSpectraXPostMedia(retrievedEvidence);
    const publicSocialImages = await collectSpectraPublicSocialPageImages([
      ...xPostMedia.posts, ...retrievedEvidence,
    ]);
    retrievedEvidence.push(...publicSocialImages.records);
    report.publicRecords.push(...publicSocialImages.records.map(record => ({
      title: record.title, url: record.url, publishedAt: record.publishedAt,
      snippet: record.textExcerpt, provider: 'Public social image metadata',
      identityStatus: 'Public image file metadata inspected',
    })));

    const inspectedImageRecords = [
      ...publicBlueskyImages.records,
      ...publicMastodonImages.records,
      ...publicSocialImages.records,
      ...retrievedEvidence.filter(record => record.title === 'Public Web image bytes inspected'),
    ];
    const mediaCaptureScenes = prioritizeSpectraPublicMediaScenes(inspectedImageRecords);
    // The existing evidence ledger already deduplicates image hashes. This
    // independent model-label summary adds only generic comparisons and is
    // saved privately without modifying the map or client response.
    const sceneOverlapSummary = summarizeSpectraSceneOverlap(inspectedImageRecords);

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
      sourceUrls?: string[];
      publishedAt?: string | null;
      supportingClaims?: Array<{ sourceUrl: string; statement: string; publishedAt: string | null; identityStatus: 'name_mention_unverified' | 'public_contact_match_unverified' }>;
    }> = [];
    const regionalDiagnostics = {
      sourcesEvaluated: 0, corroboratedClues: 0, provisionalClues: 0,
      directoryClues: 0, profileClues: 0,
      phoneSupplied: Boolean(phone), phoneOriginAvailable: Boolean(phoneOrigin.origin),
      phoneOriginRecords: phoneOrigin.records.length,
      suppliedClues: 0, geocodeAttempts: 0, geocodeMatches: 0, geocodeFailures: 0,
      mappedBy: 'none' as 'none' | 'corroborated' | 'public-document' | 'public-profile' | 'phone-assignment' | 'supplied-clue',
    };
    const resolveRegionalClue = async (clue: string, freeform = false) => {
      regionalDiagnostics.geocodeAttempts++;
      try {
        const result = await (freeform ? geocodeBestLocation(clue) : geocodeCityState(clue));
        if (result) regionalDiagnostics.geocodeMatches++;
        else regionalDiagnostics.geocodeFailures++;
        return result;
      } catch (error) {
        regionalDiagnostics.geocodeFailures++;
        throw error;
      }
    };

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
      const regionalSources = fetchedCitySources();
      regionalDiagnostics.sourcesEvaluated = regionalSources.length;
      regionalDiagnostics.suppliedClues = locationInputs.length;
      const corroboratedCity = inferCorroboratedRegionalCity(
        resolvedName || resolvedSubjectName,
        regionalSources,
      );
      const provisionalCities = inferProvisionalRegionalCities(
        resolvedName || resolvedSubjectName,
        regionalSources,
      );
      const directoryCities = inferPublicDirectoryCities(
        resolvedName || resolvedSubjectName,
        regionalSources,
        { phone, email },
      );
      regionalDiagnostics.corroboratedClues = corroboratedCity ? 1 : 0;
      regionalDiagnostics.provisionalClues = provisionalCities.length;
      regionalDiagnostics.directoryClues = directoryCities.length;
      const profileCities = inferPublicContactProfileCities(
        resolvedName,
        [...publicProfileCandidates.records, ...publicMastodonCandidates.records,
          ...publicAccount.records.filter(record => record.title === 'Public Bluesky profile'),
          ...publicMastodon.records.filter(record => record.title === 'Public Mastodon profile')],
        { email, phone },
      );
      regionalDiagnostics.profileClues = profileCities.length;
      let region = null;
      let cityCorroborationUsed = false;
      // An independently reported city must not be silently overridden by
      // a search clue supplied by the user (often a historical location).
      if (!region && corroboratedCity) {
        try {
          region = await resolveRegionalClue(
            `${corroboratedCity.city}, ${corroboratedCity.state}`,
          );
          cityCorroborationUsed = Boolean(region);
          if (region) regionalDiagnostics.mappedBy = 'corroborated';
          if (region) candidateLocations.push({
            latitude: region.latitude,
            longitude: region.longitude,
            label: `${corroboratedCity.city}, ${corroboratedCity.state} (corroborated public residence; not a live location)`,
            confidence: 0.35,
            basis: 'regional_context',
            accuracyMeters: Math.max(25_000, region.accuracyMeters),
            sourceUrls: corroboratedCity.sourceUrls,
          });
        } catch {
          // Failed regional geocoding never substitutes arbitrary coordinates.
        }
      }
      // Keep competing source-backed cities visible even if one has already
      // reached the independent-publisher rule. A conflicting claim should
      // never disappear merely because another was ranked first.
      for (const provisional of [...directoryCities, ...provisionalCities]) {
        if (candidateLocations.length >= 3) break;
        if (corroboratedCity && provisional.city.toLowerCase() === corroboratedCity.city.toLowerCase()
          && provisional.state === corroboratedCity.state) continue;
        try {
          const candidate = await resolveRegionalClue(`${provisional.city}, ${provisional.state}`);
          if (!candidate) continue;
          if (!region) { region = candidate; regionalDiagnostics.mappedBy = 'public-document'; }
          candidateLocations.push({
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            label: `${provisional.city}, ${provisional.state} (provisional public residence clue; current city unverified)`,
            confidence: Math.min(0.22, 0.10 + 0.04 * provisional.independentSourceCount),
            basis: 'regional_context',
            accuracyMeters: Math.max(25_000, candidate.accuracyMeters),
            sourceUrls: provisional.sourceUrls,
            publishedAt: provisional.publishedAt,
            supportingClaims: provisional.supportingClaims,
          });
        } catch {
          // An unavailable geocoder leaves the document and its limitations in the archive.
        }
      }
      for (const profileCity of profileCities) {
        if (candidateLocations.length >= 3) break;
        if ((corroboratedCity && profileCity.city.toLowerCase() === corroboratedCity.city.toLowerCase()
          && profileCity.state === corroboratedCity.state)
          || provisionalCities.some(city => city.city.toLowerCase() === profileCity.city.toLowerCase()
            && city.state === profileCity.state)) continue;
        try {
          const candidate = await resolveRegionalClue(`${profileCity.city}, ${profileCity.state}`);
          if (!candidate) continue;
          if (!region) { region = candidate; regionalDiagnostics.mappedBy = 'public-profile'; }
          candidateLocations.push({
            latitude: candidate.latitude, longitude: candidate.longitude,
            label: `${profileCity.city}, ${profileCity.state} (public profile city; account ownership and current city unverified)`,
            confidence: 0.12, basis: 'regional_context',
            accuracyMeters: Math.max(25_000, candidate.accuracyMeters),
            sourceUrls: profileCity.sourceUrls, publishedAt: null,
            supportingClaims: profileCity.supportingClaims,
          });
        } catch {
          // The profile remains archived even if the city cannot be mapped.
        }
      }
      // The assignment block is useful context when no person-specific city
      // has been retrieved. It must never outrank a residence claim.
      if (!region && phoneOrigin.origin) {
        try {
          const origin = phoneOrigin.origin;
          const assignment = await resolveRegionalClue(`${origin.city}, ${origin.state}`);
          if (assignment) {
            region = assignment;
            regionalDiagnostics.mappedBy = 'phone-assignment';
            candidateLocations.push({
              latitude: assignment.latitude, longitude: assignment.longitude,
              label: `${origin.city}, ${origin.state} (phone number assignment area; residence unknown)`,
              confidence: 0.03, basis: 'regional_context',
              accuracyMeters: Math.max(50_000, assignment.accuracyMeters),
              sourceUrls: [origin.sourceUrl],
            });
          }
        } catch {
          // A failed rate-center geocode never cancels other sources.
        }
      }
      // Preserve a supplied location solely as labeled search context. A
      // geocoder resolving an input clue is not an independent city discovery.
      if (!region) {
        for (const locationInput of locationInputs) {
          try {
            region = await resolveRegionalClue(locationInput, true);
            if (region) { regionalDiagnostics.mappedBy = 'supplied-clue'; break; }
          } catch {
            // One provider or parsing failure must not cancel other clues.
          }
        }
      }
      if (region && candidateLocations.length === 0) {
        candidateLocations.push({
          latitude: region.latitude,
          longitude: region.longitude,
          label: cityCorroborationUsed && corroboratedCity
            ? `${corroboratedCity.city}, ${corroboratedCity.state} (corroborated public residence; not a live location)`
            : `${region.displayName} (supplied search clue; current city not verified)`,
          confidence: cityCorroborationUsed ? 0.35 : 0.05,
          basis: 'regional_context',
          sourceUrls: cityCorroborationUsed ? corroboratedCity?.sourceUrls : undefined,
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
      : candidateLocations[0] && candidateLocations[0].confidence >= 0.1
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
      configuredCollectors: getSpectraEnrolledAcquisitionCapabilities().filter(item => item.configured !== false).length,
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
      regional: regionalDiagnostics,
    });
    console.info('[SPECTRA Pipeline Summary]', JSON.stringify({
      requestId: getDiscoveryDiagnostics()?.requestId,
      ...pipelineDiagnostics,
    }));

    const publicAccountUrls = new Set(publicAccount.records.map(record => record.url));
    const publicCandidateUrls = new Set([
      ...publicProfileCandidates.records, ...blueskyCandidatePosts,
    ].map(record => record.url));
    const publicImageProviders = new Map<string, string>([
      ...publicBlueskyImages.records.map(record => [record.url, 'bluesky-image-binary'] as const),
      ...publicMastodonImages.records.map(record => [record.url, 'mastodon-image-binary'] as const),
      ...publicSocialImages.records.map(record => [record.url,
        String((record.structuredRecord as any)?.sourcePlatform || 'social').toLowerCase() + '-image-binary'] as const),
    ]);
    const publicImageUrls = new Set(publicImageProviders.keys());
    const publicMastodonUrls = new Set(publicMastodon.records.map(record => record.url));
    const publicMastodonCandidateUrls = new Set([
      ...publicMastodonCandidates.records, ...mastodonCandidatePosts,
    ].map(record => record.url));
    const publicWikimediaUrls = new Set(publicWikimedia.records.map(record => record.url));
    const publicNewsUrls = new Set(publicNews.records.map(record => record.url));
    const publicCourtUrls = new Set(publicCourt.records.map(record => record.url));
    const phoneOriginUrls = new Set(phoneOrigin.records.map(record => record.url));
    const evidenceRecords = buildSpectraAcquisitionRecords(retrievedEvidence.map(evidence => ({
      url: evidence.url,
      provider: publicImageProviders.get(evidence.url)
        || (phoneOriginUrls.has(evidence.url) ? 'public-phone-prefix-assignment'
        : publicAccountUrls.has(evidence.url) || publicCandidateUrls.has(evidence.url) ? 'bluesky-public-api'
        : publicMastodonUrls.has(evidence.url) || publicMastodonCandidateUrls.has(evidence.url) ? 'mastodon-public-api'
        : publicWikimediaUrls.has(evidence.url) ? 'wikimedia-commons-api'
        : publicNewsUrls.has(evidence.url) ? 'gdelt-article-retrieval'
        : publicCourtUrls.has(evidence.url) ? 'courtlistener-public-recap' : 'spectra-public-retrieval'),
      metadata: {
        ...mergePublicRetrievedMetadata(undefined, evidence),
        ...(phoneOriginUrls.has(evidence.url)
          ? { retrievalProvider: 'public-phone-prefix-assignment', subjectAssociation: 'number_origin_not_person_location' }
          : {}),
        ...(publicImageUrls.has(evidence.url)
          ? { retrievalProvider: publicImageProviders.get(evidence.url), subjectAssociation: 'public_media_scene_unverified' }
          : {}),
        ...(publicAccountUrls.has(evidence.url)
          ? { retrievalProvider: 'bluesky-public-api', subjectAssociation: 'supplied_profile_url_unverified' }
          : {}),
        ...(publicCandidateUrls.has(evidence.url) && !publicAccountUrls.has(evidence.url)
          ? { retrievalProvider: 'bluesky-public-api', subjectAssociation: 'name_match_unverified' }
          : {}),
        ...(publicMastodonUrls.has(evidence.url)
          ? { retrievalProvider: 'mastodon-public-api', subjectAssociation: 'supplied_profile_url_unverified' }
          : {}),
        ...(publicMastodonCandidateUrls.has(evidence.url) && !publicMastodonUrls.has(evidence.url)
          ? { retrievalProvider: 'mastodon-public-api', subjectAssociation: 'name_match_unverified' }
          : {}),
        ...(publicWikimediaUrls.has(evidence.url)
          ? { retrievalProvider: 'wikimedia-commons-api', subjectAssociation: 'supplied_file_scene_unverified' }
          : {}),
        ...(publicNewsUrls.has(evidence.url)
          ? { retrievalProvider: 'gdelt-article-retrieval', subjectAssociation: 'unverified_article_mention' }
          : {}),
        ...(publicCourtUrls.has(evidence.url)
          ? { retrievalProvider: 'courtlistener-public-recap', subjectAssociation: 'case_name_match_unverified' }
          : {}),
      },
    })), contextEvidence);
    // Every successfully acquired source snapshot enters one auditable, typed
    // assessment; context remains separate from authenticated position fixes.
    const evidenceAssessment = assessSpectraAcquiredEvidence(
      evidenceRecords, solvedLocationObservations.length,
    );
    throwIfDiscoveryCancelled();
    const persistence = await persistSpectraAcquisition({
      userId,
      sessionId: requestedSessionId,
      subjectLabel: resolvedTargetLabel,
      clues: [target, details],
      observations: solvedLocationObservations,
      evidenceRecords,
      state: {
        pipelineDiagnostics,
        sceneOverlapSummary,
        publicXMediaProviderStatus: xPostMedia.status,
        publicXMediaProviderAttempts: xPostMedia.attempted,
        publicXMediaProviderRecords: xPostMedia.retrieved,
        publicXMediaProviderFailures: xPostMedia.failed,
        evidenceAssessmentCounts: {
          sourceRecordCount: evidenceAssessment.sourceRecordCount,
          uniqueContributionCount: evidenceAssessment.uniqueContributionCount,
          duplicateCopies: evidenceAssessment.duplicateCopies,
          countsByKind: evidenceAssessment.countsByKind,
          datedSourceEvents: evidenceAssessment.datedSourceEvents,
        },
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
        publicAccountStatus: publicAccount.status,
        publicAccountRecordCount: publicAccount.records.length,
        publicProfileCandidateStatus: publicProfileCandidates.status,
        publicProfileCandidateCount: publicProfileCandidates.records.length,
        publicProfileContactMatches: publicProfileCandidates.records.filter(record => contactMatch(record)).length,
        publicProfileCandidatePostCount: blueskyCandidatePosts.length,
        publicBlueskyImageAttemptCount: publicBlueskyImages.attempted,
        publicBlueskyImageRecordCount: publicBlueskyImages.records.length,
        publicBlueskyImageFailureCount: publicBlueskyImages.failed,
        publicMastodonImageAttemptCount: publicMastodonImages.attempted,
        publicMastodonImageRecordCount: publicMastodonImages.records.length,
        publicMastodonImageFailureCount: publicMastodonImages.failed,
        publicSocialImageAttemptCount: publicSocialImages.attempted,
        publicSocialImageRecordCount: publicSocialImages.records.length,
        publicSocialImageFailureCount: publicSocialImages.failed,
        publicMastodonStatus: publicMastodon.status,
        publicMastodonReason: publicMastodon.reason,
        publicMastodonRecordCount: publicMastodon.records.length,
        publicMastodonCandidateStatus: publicMastodonCandidates.status,
        publicMastodonCandidateCount: publicMastodonCandidates.records.length,
        publicMastodonContactMatches: publicMastodonCandidates.records.filter(record => contactMatch(record)).length,
        publicMastodonCandidatePostCount: mastodonCandidatePosts.length,
        publicWikimediaStatus: publicWikimedia.status,
        publicWikimediaRecordCount: publicWikimedia.records.length,
        publicNewsStatus: publicNews.status,
        publicNewsArticleLeads: publicNews.articleLeads,
        publicNewsRecordCount: publicNews.records.length,
        publicCourtStatus: publicCourt.status,
        publicCourtRecordCount: publicCourt.records.length,
        phoneInfogaStatus: phoneInfoga.status,
        phoneInfogaScannerCount: phoneInfoga.scanners.length,
        phoneInfogaScannerSuccessCount: phoneInfoga.scanners.filter(item => item.status === 'ok').length,
        originSessionId: originSessionId || null,
        lastAcquiredAt: new Date().toISOString(),
      },
    }).catch(error => {
      console.warn('[SPECTRA] Persistence unavailable', {
        code: typeof error?.code === 'string' ? error.code : 'PERSISTENCE_UNAVAILABLE',
      });
      return {
        available: false,
        sessionId: requestedSessionId || '',
        evidenceRecordCount: 0,
        evidenceRecordsOmitted: evidenceRecords.length,
      };
    });

    const responseBody = {
      success: true,
      target,
      details,
      resolvedTargetLabel,
      sessionId: persistence.sessionId || requestedSessionId,
      persistenceAvailable: persistence.available,
      evidenceArchive: { stored: persistence.evidenceRecordCount || 0, omitted: persistence.evidenceRecordsOmitted || 0 },
      evidenceAssessment,
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
        publicAccountStatus: publicAccount.status,
        publicAccountRecordCount: publicAccount.records.length,
        publicProfileCandidateStatus: publicProfileCandidates.status,
        publicProfileCandidateCount: publicProfileCandidates.records.length,
        publicProfileContactMatches: publicProfileCandidates.records.filter(record => contactMatch(record)).length,
        publicProfileCandidatePostCount: blueskyCandidatePosts.length,
        publicBlueskyImageAttemptCount: publicBlueskyImages.attempted,
        publicBlueskyImageRecordCount: publicBlueskyImages.records.length,
        publicBlueskyImageFailureCount: publicBlueskyImages.failed,
        publicMastodonImageAttemptCount: publicMastodonImages.attempted,
        publicMastodonImageRecordCount: publicMastodonImages.records.length,
        publicMastodonImageFailureCount: publicMastodonImages.failed,
        publicSocialImageAttemptCount: publicSocialImages.attempted,
        publicSocialImageRecordCount: publicSocialImages.records.length,
        publicSocialImageFailureCount: publicSocialImages.failed,
        publicMastodonStatus: publicMastodon.status,
        publicMastodonReason: publicMastodon.reason,
        publicMastodonRecordCount: publicMastodon.records.length,
        publicMastodonCandidateStatus: publicMastodonCandidates.status,
        publicMastodonCandidateCount: publicMastodonCandidates.records.length,
        publicMastodonContactMatches: publicMastodonCandidates.records.filter(record => contactMatch(record)).length,
        publicMastodonCandidatePostCount: mastodonCandidatePosts.length,
        publicWikimediaStatus: publicWikimedia.status,
        publicWikimediaRecordCount: publicWikimedia.records.length,
        publicNewsStatus: publicNews.status,
        publicNewsArticleLeads: publicNews.articleLeads,
        publicNewsRecordCount: publicNews.records.length,
        phoneInfogaStatus: phoneInfoga.status,
        phoneInfogaNormalized: phoneInfoga.normalized,
        phoneInfogaScanners: phoneInfoga.scanners.map(item => ({ scanner: item.scanner, status: item.status })),
        summary: report.summary || '',
        verificationStatus: report.identitySummary?.verificationStatus || 'Unknown',
      },
      locationObservations,
      candidateLocations,
      mediaCaptureScenes,
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
    };
    if (persistence.available && responseBody.sessionId && directEvidence.length === 0) {
      const key = spectraRecentAcquisitionKey(userId, responseBody.sessionId, target, details, originSessionId || '');
      if (spectraRecentAcquisitions.size >= 32) {
        spectraRecentAcquisitions.delete(spectraRecentAcquisitions.keys().next().value!);
      }
      spectraRecentAcquisitions.set(key, { until: Date.now() + SPECTRA_REFRESH_REUSE_MS, result: responseBody });
    }
    return res.json(responseBody);
  } catch (error) {
    const restoreFailed = error instanceof SpectraRestoreError;
    console.error('[SPECTRA] Acquisition failed', { code: restoreFailed ? 'SESSION_RESTORE_UNAVAILABLE' : 'ACQUISITION_FAILED' });
    return res.status(restoreFailed ? 503 : 500).json({
      success: false,
      error: restoreFailed ? 'Saved investigation evidence is temporarily unavailable. Please retry.' : 'SPECTRA could not complete target acquisition.',
      feedDiagnostics: getDiscoveryDiagnostics(),
    });
  }
}));

export default router;

