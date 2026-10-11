import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Buffer } from 'node:buffer';
import { load } from 'cheerio';
import type { SpectraRetrievalDiagnostic, SpectraRetrievalReason } from './SpectraRetrievalDiagnostics';

export interface SpectraRetrievedObservation {
  latitude: number;
  longitude: number;
  timestamp?: string;
  accuracy?: number;
  sourceUrl: string;
  acquisitionMethod: string;
  metadata?: Record<string, unknown>;
}

export interface SpectraRetrievedEvidence {
  url: string;
  /** Original discovery URL, retained even when an HTTP redirect changes the final URL. */
  requestedUrl: string;
  title?: string;
  retrievedAt: string;
  publishedAt?: string;
  contentType?: string;
  /** Complete parsed JSON source payload when it fits the archive record budget. */
  structuredRecord?: unknown;
  /** Explicitly distinguishes a bounded archive omission from an empty source. */
  structuredRecordOmitted?: boolean;
  textExcerpt?: string;
  /** Visible address blocks, separate from prose and subject observations. */
  addressBlocks?: string[];
  observations: SpectraRetrievedObservation[];
}

const MAX_TARGETS = 8;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TEXT = 320_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 2_200;

class RetrievalFailure extends Error {
  constructor(readonly reason: SpectraRetrievalReason) { super(reason); }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (
    normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  ) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new RetrievalFailure('invalid_url'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new RetrievalFailure('blocked_url');
  if (url.username || url.password) throw new RetrievalFailure('blocked_url');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new RetrievalFailure('blocked_url');
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new RetrievalFailure('blocked_url');
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
    .catch(() => { throw new RetrievalFailure('dns_error'); });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new RetrievalFailure('blocked_url');
  }
  return url;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function timestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value as any);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return undefined;
  if (ms < Date.UTC(1900, 0, 1) || ms > Date.now() + 24 * 60 * 60_000) return undefined;
  return date.toISOString();
}

function numeric(value: unknown): number | undefined {
  // JSON/HTML providers sometimes encode missing data as false, null, [],
  // or an empty string. Number() converts these to zero: only explicitly
  // numeric fields may produce the real (0, 0) geographic coordinate.
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dedupeObservations(items: SpectraRetrievedObservation[]): SpectraRetrievedObservation[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = [
      item.latitude.toFixed(7),
      item.longitude.toFixed(7),
      item.timestamp || '',
      item.sourceUrl,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
}

export function htmlEvidence(raw: string, sourceUrl: string): {
  title?: string;
  textExcerpt?: string;
  publishedAt?: string;
  addressBlocks?: string[];
  observations: SpectraRetrievedObservation[];
} {
  const $ = load(raw.slice(0, MAX_TEXT));
  $('script:not([type="application/ld+json"]),style,noscript,svg,canvas').remove();
  const title = $('title').first().text().trim().slice(0, 300) || undefined;
  // A venue or article may appear after many thousands of navigation
  // characters. Prefer the actual page content, retaining body as fallback.
  // Keep the original DOM for independent publication/JSON-LD inspection.
  const semanticRoot = $('main, article, [role="main"]')
    .filter((_i, element) => $(element).text().trim().length >= 40)
    .first();
  const excerptRoot = (semanticRoot.length ? semanticRoot : $('body').first()).clone();
  excerptRoot.find(
    'nav, header, footer, aside, form, button, [role="navigation"], [aria-hidden="true"]'
  ).remove();
  const textExcerpt = excerptRoot.text().replace(/\s+/g, ' ').trim().slice(0, 8_000) || undefined;
  const observations: SpectraRetrievedObservation[] = [];

  const addressBlocks: string[] = [];
  const addAddress = (element: any) => {
    const copy = $(element).clone();
    copy.find('br').replaceWith('\n');
    copy.find('p,div,li').append('\n');
    const text = copy.text().split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (text.length >= 12 && text.length <= 600) addressBlocks.push(text);
  };
  excerptRoot.find('address, [itemprop="address"]').each((_i, element) => addAddress(element));
  excerptRoot.find('h2,h3,h4,dt,div,span,strong').each((_i, element) => {
    if (/^(?:location|address|visit us)$/i.test($(element).text().trim())) {
      const next = $(element).next();
      if (next.length) addAddress(next);
    }
  });

  const meta = new Map<string, string>();
  $('meta').each((_index, element) => {
    const key = String(
      $(element).attr('property')
      || $(element).attr('name')
      || $(element).attr('itemprop')
      || ''
    ).trim().toLowerCase();
    const value = String($(element).attr('content') || '').trim();
    if (key && value && !meta.has(key)) meta.set(key, value);
  });

  // Publication time describes the evidence's age; retrieval time only
  // describes when we fetched the page. Do not substitute og:updated_time.
  // Invalid metadata in one tag must not hide a valid alternate date.
  let publishedAt = [
    meta.get('article:published_time'),
    meta.get('datepublished'),
    meta.get('citation_publication_date'),
    meta.get('dc.date.issued'),
  ].map(value => timestamp(value)).find(Boolean);

  const metaLatitude = numeric(
    meta.get('place:location:latitude')
    || meta.get('og:latitude')
    || meta.get('geo.latitude')
    || meta.get('latitude')
  );
  const metaLongitude = numeric(
    meta.get('place:location:longitude')
    || meta.get('og:longitude')
    || meta.get('geo.longitude')
    || meta.get('longitude')
  );
  const geoPosition = meta.get('geo.position');
  let positionLat: number | undefined;
  let positionLon: number | undefined;
  if (geoPosition) {
    const parts = geoPosition.split(/[;,\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 2) {
      positionLat = numeric(parts[0]);
      positionLon = numeric(parts[1]);
    }
  }

  const latitude = metaLatitude ?? positionLat;
  const longitude = metaLongitude ?? positionLon;
  if (latitude !== undefined && longitude !== undefined && validCoordinate(latitude, longitude)) {
    observations.push({
      latitude,
      longitude,
      timestamp: timestamp(
        meta.get('article:published_time')
        || meta.get('date')
        || meta.get('datepublished')
        || meta.get('og:updated_time')
      ),
      sourceUrl,
      acquisitionMethod: 'html-geospatial-metadata',
      metadata: { metadataKind: 'html-meta' },
    });
  }

  $('script[type="application/ld+json"]').each((_index, element) => {
    if (observations.length >= 100) return false;
    const text = $(element).text().trim();
    if (!text || text.length > 500_000) return;

    try {
      const payload = JSON.parse(text);
      // Some public pages publish a date only in their top-level Article /
      // WebPage JSON-LD. Nested event and person dates are not page dates.
      if (!publishedAt) {
        const roots = Array.isArray(payload) ? payload : [payload];
        for (const root of roots) {
          if (!root || typeof root !== 'object') continue;
          const graph = Array.isArray(root['@graph']) ? root['@graph'] : [];
          for (const candidate of [root, ...graph]) {
            if (!candidate || typeof candidate !== 'object') continue;
            const types = Array.isArray(candidate['@type'])
              ? candidate['@type'] : [candidate['@type']];
            if (!types.some((type: unknown) =>
              typeof type === 'string'
              && /(?:^|[/:])(?:WebPage|ProfilePage|Article|NewsArticle|BlogPosting)$/.test(type)
            )) continue;
            const date = typeof candidate.datePublished === 'string'
              ? timestamp(candidate.datePublished) : undefined;
            if (date) {
              publishedAt = date;
              break;
            }
          }
          if (publishedAt) break;
        }
      }
      const walk = (value: any, depth = 0) => {
        if (!value || depth > 8 || observations.length >= 100) return;
        if (Array.isArray(value)) {
          for (const child of value) walk(child, depth + 1);
          return;
        }
        if (typeof value !== 'object') return;

        const geo = value.geo && typeof value.geo === 'object' ? value.geo : value;
        const lat = numeric(
          geo.latitude ?? geo.lat ?? geo.gpsLatitude
        );
        const lon = numeric(
          geo.longitude ?? geo.lng ?? geo.lon ?? geo.gpsLongitude
        );
        if (lat !== undefined && lon !== undefined && validCoordinate(lat, lon)) {
          observations.push({
            latitude: lat,
            longitude: lon,
            timestamp: timestamp(
              value.datePublished
              ?? value.dateCreated
              ?? value.uploadDate
              ?? value.startDate
              ?? value.endDate
              ?? geo.timestamp
            ),
            sourceUrl,
            acquisitionMethod: 'json-ld-geospatial-metadata',
            metadata: {
              metadataKind: 'json-ld',
              schemaType: value['@type'],
              name: typeof value.name === 'string' ? value.name.slice(0, 300) : undefined,
            },
          });
        }

        for (const child of Object.values(value)) walk(child, depth + 1);
      };
      walk(payload);
    } catch {
      // One malformed JSON-LD block does not discard other page metadata.
    }
  });

  return { title, textExcerpt, publishedAt, addressBlocks: [...new Set(addressBlocks)].slice(0, 12), observations: dedupeObservations(observations) };
}

function jsonEvidence(payload: any, sourceUrl: string): SpectraRetrievedObservation[] {
  const observations: SpectraRetrievedObservation[] = [];
  const seen = new Set<object>();

  const walk = (value: any, depth = 0) => {
    if (!value || depth > 8 || observations.length >= 100) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    const lat = numeric(value.latitude ?? value.lat ?? value.gpsLatitude ?? value.GPSLatitude);
    const lon = numeric(value.longitude ?? value.lng ?? value.lon ?? value.gpsLongitude ?? value.GPSLongitude);
    if (lat !== undefined && lon !== undefined && validCoordinate(lat, lon)) {
      const accuracy = numeric(
        value.accuracy
        ?? value.horizontalAccuracy
        ?? value.accuracyMeters
        ?? value.GPSHPositioningError
      );
      observations.push({
        latitude: lat,
        longitude: lon,
        timestamp: timestamp(
          value.timestamp
          ?? value.observedAt
          ?? value.capturedAt
          ?? value.dateTimeOriginal
          ?? value.datetime
          ?? value.date
        ),
        accuracy: accuracy !== undefined && accuracy > 0 ? accuracy : undefined,
        sourceUrl,
        acquisitionMethod: 'json-geospatial-field-extraction',
        metadata: { metadataKind: 'json' },
      });
    }

    for (const child of Object.values(value)) walk(child, depth + 1);
  };

  walk(payload);
  return dedupeObservations(observations);
}

async function retrieveOne(
  rawUrl: string,
  parentSignal?: AbortSignal,
  report?: (diagnostic: Omit<SpectraRetrievalDiagnostic, 'targetIndex'>) => void,
): Promise<SpectraRetrievedEvidence | null> {
  let reason: SpectraRetrievalReason = 'network_error';
  let httpStatus: number | undefined;
  let timedOut = false;
  try {
    if (parentSignal?.aborted) throw new RetrievalFailure('cancelled');
    let current = await assertPublicUrl(rawUrl);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      if (parentSignal?.aborted) throw new RetrievalFailure('cancelled');
      const controller = new AbortController();
      const relayAbort = () => controller.abort(parentSignal?.reason);
      if (parentSignal?.aborted) controller.abort(parentSignal.reason);
      else parentSignal?.addEventListener('abort', relayAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('SPECTRA retrieval timeout'));
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.2',
            'User-Agent': 'LegalWhat-SPECTRA/1.0',
          },
        });
        httpStatus = response.status;

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new RetrievalFailure('redirect_missing_location');
          if (redirectCount === MAX_REDIRECTS) throw new RetrievalFailure('redirect_limit');
          let redirect: URL;
          try { redirect = new URL(location, current); }
          catch { throw new RetrievalFailure('invalid_url'); }
          current = await assertPublicUrl(redirect.toString());
          continue;
        }
        if (!response.ok) throw new RetrievalFailure('http_error');

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          throw new RetrievalFailure('response_too_large');
        }
        const contentType = response.headers.get('content-type') || '';

        if (/json/i.test(contentType)) {
          const text = await response.text();
          if (text.length > MAX_RESPONSE_BYTES) throw new RetrievalFailure('response_too_large');
          let payload: unknown;
          try { payload = JSON.parse(text); }
          catch { throw new RetrievalFailure('invalid_response'); }
          const evidence = {
            url: current.toString(), requestedUrl: rawUrl,
            retrievedAt: new Date().toISOString(), contentType,
            ...(Buffer.byteLength(text, 'utf8') <= 240_000
              ? { structuredRecord: payload }
              : { structuredRecordOmitted: true }),
            observations: jsonEvidence(payload, current.toString()),
          };
          reason = 'retrieved';
          return evidence;
        }

        if (/html|xhtml/i.test(contentType)) {
          const text = await response.text();
          if (text.length > MAX_RESPONSE_BYTES) throw new RetrievalFailure('response_too_large');
          let extracted: ReturnType<typeof htmlEvidence>;
          try { extracted = htmlEvidence(text, current.toString()); }
          catch { throw new RetrievalFailure('invalid_response'); }
          const evidence = {
            url: current.toString(), requestedUrl: rawUrl,
            retrievedAt: new Date().toISOString(), contentType,
            title: extracted.title, textExcerpt: extracted.textExcerpt,
            addressBlocks: extracted.addressBlocks, publishedAt: extracted.publishedAt,
            observations: extracted.observations,
          };
          reason = 'retrieved';
          return evidence;
        }
        throw new RetrievalFailure('unsupported_content_type');
      } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', relayAbort);
      }
    }
    return null;
  } catch (error) {
    reason = parentSignal?.aborted ? 'cancelled' : timedOut ? 'timeout'
      : error instanceof RetrievalFailure ? error.reason : 'network_error';
    return null;
  } finally {
    // Reporting must not alter retrieval results or expose an exception message.
    try { report?.({ reason, httpStatus }); } catch { /* diagnostic observer only */ }
  }
}

export async function retrieveSpectraPublicEvidence(
  targets: string[],
  signal?: AbortSignal,
  onDiagnostic?: (diagnostic: SpectraRetrievalDiagnostic) => void,
): Promise<SpectraRetrievedEvidence[]> {
  const uniqueTargets = [...new Set(targets.map(value => value.trim()).filter(Boolean))]
    .slice(0, MAX_TARGETS);
  const settled = await Promise.allSettled(
    uniqueTargets.map((target, targetIndex) => retrieveOne(target, signal,
      diagnostic => onDiagnostic?.({ targetIndex, ...diagnostic })))
  );
  return settled.flatMap(result =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  );
}
