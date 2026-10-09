import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';

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
  title?: string;
  retrievedAt: string;
  publishedAt?: string;
  contentType?: string;
  textExcerpt?: string;
  observations: SpectraRetrievedObservation[];
}

const MAX_TARGETS = 6;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TEXT = 60_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 2_200;

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
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SPECTRA retrieval requires HTTP(S).');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not supported.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Local hosts are not supported.');
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private network targets are not supported.');
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Target resolved to a non-public address.');
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
  observations: SpectraRetrievedObservation[];
} {
  const $ = load(raw.slice(0, MAX_TEXT));
  $('script:not([type="application/ld+json"]),style,noscript,svg,canvas').remove();
  const title = $('title').first().text().trim().slice(0, 300) || undefined;
  const textExcerpt = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4_000) || undefined;
  const observations: SpectraRetrievedObservation[] = [];

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
      // A webpage's publication or modification time is not a timestamped
      // measurement of a subject's location. Preserve its publishedAt
      // separately for regional source freshness instead.
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
            // Article creation, publication and event dates describe
            // documents/events, not a device or person's observed position.
            // Only explicit geospatial measurement timestamps qualify.
            timestamp: timestamp(geo.timestamp),
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

  return { title, textExcerpt, publishedAt, observations: dedupeObservations(observations) };
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

async function retrieveOne(rawUrl: string, parentSignal?: AbortSignal): Promise<SpectraRetrievedEvidence | null> {
  let current = await assertPublicUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const relayAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('SPECTRA retrieval timeout')), REQUEST_TIMEOUT_MS);

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

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) return null;
        current = await assertPublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) return null;

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) return null;
      const contentType = response.headers.get('content-type') || '';

      if (/json/i.test(contentType)) {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) return null;
        const payload = JSON.parse(text);
        return {
          url: current.toString(),
          retrievedAt: new Date().toISOString(),
          contentType,
          observations: jsonEvidence(payload, current.toString()),
        };
      }

      if (/html|xhtml/i.test(contentType)) {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) return null;
        const extracted = htmlEvidence(text, current.toString());
        return {
          url: current.toString(),
          retrievedAt: new Date().toISOString(),
          contentType,
          title: extracted.title,
          textExcerpt: extracted.textExcerpt,
          publishedAt: extracted.publishedAt,
          observations: extracted.observations,
        };
      }

      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', relayAbort);
    }
  }

  return null;
}

export async function retrieveSpectraPublicEvidence(
  targets: string[],
  signal?: AbortSignal,
): Promise<SpectraRetrievedEvidence[]> {
  const uniqueTargets = [...new Set(targets.map(value => value.trim()).filter(Boolean))]
    .slice(0, MAX_TARGETS);
  const settled = await Promise.allSettled(
    uniqueTargets.map(target => retrieveOne(target, signal))
  );
  return settled.flatMap(result =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  );
}
