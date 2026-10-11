/** Public natural-event records. These records are never person/device observations. */
export interface SpectraPublicFeedRecord {
  provider: string;
  recordId: string;
  sourceUrl: string;
  title: string;
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  geometry: object | null;
  rawRecord: Record<string, unknown>;
  limitations: string[];
  classification: 'public_geographic_context';
}

export interface SpectraPublicFeedResult {
  provider: string;
  endpoint: string;
  status: 'ok' | 'partial' | 'failed' | 'not_modified';
  records: SpectraPublicFeedRecord[];
  etag?: string;
  lastModified?: string;
  errorCode?: string;
  nextUrl?: string;
}

export interface SpectraPublicFeedOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  etag?: string;
  lastModified?: string;
}

const CONTEXT_LIMITATION = 'Describes a public geographic event; does not establish any person or device location.';

export const SPECTRA_PUBLIC_FEED_SOURCES = [
  {
    id: 'usgs-earthquakes',
    label: 'USGS earthquakes, past day',
    endpoint: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    documentationUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
    refreshIntervalMs: 5 * 60_000,
    limitations: [CONTEXT_LIMITATION, 'Rolling past-day catalog; event positions, magnitudes, and times may be revised.', 'The third USGS coordinate is earthquake depth in kilometers, not altitude.'],
  },
  {
    id: 'nasa-eonet',
    label: 'NASA EONET open natural events',
    endpoint: 'https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=open&limit=100',
    documentationUrl: 'https://eonet.gsfc.nasa.gov/docs/v3',
    refreshIntervalMs: 30 * 60_000,
    limitations: [CONTEXT_LIMITATION, 'Open events reported in the past 30 days, capped at 100; EONET describes approximate spatial and temporal extents for general information.', 'Each event geometry has its own source date; observedAt is the latest reported geometry date. Midnight can mean the source supplied a date without an exact time.'],
  },
  {
    id: 'nws-alerts',
    label: 'National Weather Service active alerts',
    endpoint: 'https://api.weather.gov/alerts/active',
    documentationUrl: 'https://www.weather.gov/documentation/services-web-api',
    refreshIntervalMs: 5 * 60_000,
    limitations: [CONTEXT_LIMITATION, 'Alert coverage polygons or zones describe affected areas, not measured positions; geometry may be null.', 'sourceUpdatedAt is the alert issuance time (sent); observedAt is null because an alert is not a measured observation.'],
  },
] as const;

const MAX_PAGES = 3;
const MAX_RECORDS = 1_500;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

class FeedError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function timestamp(value: unknown, epochMilliseconds = false): string | null {
  if (epochMilliseconds) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  } else if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  if (!epochMilliseconds && typeof value === 'string') {
    const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/\D+/).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  }
  const date = new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function trustedUrl(value: unknown, hostname: string, path: RegExp): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== hostname || url.port || url.username || url.password || url.hash || !path.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function validPosition(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.length <= 4
    && value.every(item => typeof item === 'number' && Number.isFinite(item))
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function coordinatesAtDepth(value: unknown, depth: number): boolean {
  return depth === 0 ? validPosition(value)
    : Array.isArray(value) && value.length > 0 && value.every(item => coordinatesAtDepth(item, depth - 1));
}

function geometry(value: unknown, depth = 0): Record<string, unknown> | null {
  const item = object(value);
  if (!item || depth > 5) return null;
  const depths: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  if (typeof item.type === 'string' && Object.prototype.hasOwnProperty.call(depths, item.type)
    && coordinatesAtDepth(item.coordinates, depths[item.type])) return item;
  if (item.type === 'GeometryCollection' && Array.isArray(item.geometries)
    && item.geometries.length > 0 && item.geometries.every(child => geometry(child, depth + 1))) return item;
  return null;
}

function normalizeRecord(provider: string, value: unknown, retrievedAt: string): SpectraPublicFeedRecord | null {
  const raw = object(value);
  const source = SPECTRA_PUBLIC_FEED_SOURCES.find(item => item.id === provider);
  if (!raw || !source) return null;
  const limitations: string[] = [...source.limitations];
  let recordId: string | null = null;
  let sourceUrl: string | null = null;
  let title: string | null = null;
  let observedAt: string | null = null;
  let sourceUpdatedAt: string | null = null;
  let recordGeometry: object | null = null;

  if (provider === 'usgs-earthquakes') {
    const properties = object(raw.properties);
    recordId = string(raw.id);
    if (raw.type !== 'Feature' || !properties || !recordId || !/^[a-zA-Z0-9_-]{1,200}$/.test(recordId)) return null;
    sourceUrl = trustedUrl(properties.url, 'earthquake.usgs.gov', /^\/earthquakes\/eventpage\/[^/]+\/?$/);
    if (!sourceUrl) sourceUrl = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(recordId)}`;
    title = string(properties.title) ?? string(properties.place);
    observedAt = timestamp(properties.time, true);
    sourceUpdatedAt = timestamp(properties.updated, true);
    recordGeometry = geometry(raw.geometry);
  } else if (provider === 'nasa-eonet') {
    recordId = string(raw.id);
    if (!recordId || !/^[a-zA-Z0-9_-]{1,200}$/.test(recordId)) return null;
    sourceUrl = trustedUrl(raw.link, 'eonet.gsfc.nasa.gov', /^\/api\/v3\/events\/[^/]+\/?$/)
      ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(recordId)}`;
    title = string(raw.title);
    const sourceGeometries = Array.isArray(raw.geometry) ? raw.geometry : [];
    const geometries = sourceGeometries.map(item => geometry(item)).filter((item): item is Record<string, unknown> => item !== null);
    const dates = sourceGeometries.map(item => timestamp(object(item)?.date)).filter((item): item is string => item !== null).sort();
    observedAt = dates[dates.length - 1] ?? null;
    recordGeometry = geometries.length === 1 ? geometries[0]
      : geometries.length > 1 ? { type: 'GeometryCollection', geometries } : null;
    if (geometries.length < sourceGeometries.length) limitations.push('Some source geometries were unusable; the unchanged source array remains in rawRecord.');
  } else if (provider === 'nws-alerts') {
    const properties = object(raw.properties);
    if (raw.type !== 'Feature' || !properties) return null;
    sourceUrl = trustedUrl(raw.id, 'api.weather.gov', /^\/alerts\/[^/]+$/)
      ?? trustedUrl(properties['@id'], 'api.weather.gov', /^\/alerts\/[^/]+$/);
    const urn = string(properties.id);
    if (!sourceUrl && urn && /^urn:[a-zA-Z0-9:._-]{1,900}$/.test(urn)) sourceUrl = `https://api.weather.gov/alerts/${urn}`;
    if (!sourceUrl) return null;
    recordId = new URL(sourceUrl).pathname.slice('/alerts/'.length);
    title = string(properties.headline) ?? string(properties.event);
    sourceUpdatedAt = timestamp(properties.sent);
    recordGeometry = geometry(raw.geometry);
  }
  if (!recordId || !sourceUrl) return null;
  if (!recordGeometry) limitations.push('Source geometry is absent or unusable; no coordinate was inferred.');
  if (!observedAt && provider !== 'nws-alerts') limitations.push('No usable source observation time was supplied; retrieval time is not an observation time.');
  return {
    provider, recordId, sourceUrl, title: title ?? recordId, observedAt, sourceUpdatedAt,
    retrievedAt, geometry: recordGeometry, rawRecord: raw, limitations,
    classification: 'public_geographic_context',
  };
}

function nextPage(value: unknown): string | null {
  const url = trustedUrl(value, 'api.weather.gov', /^\/alerts(?:\/active)?$/);
  if (!url) return null;
  const parsed = new URL(url);
  // NWS controls the opaque cursor; no supplied URL may change host or route.
  const allowed = new Set(['cursor', 'limit', 'active', 'status']);
  if ([...parsed.searchParams.keys()].some(key => !allowed.has(key))) return null;
  if (parsed.pathname === '/alerts' && parsed.searchParams.get('active') !== 'true') return null;
  if (!parsed.searchParams.get('cursor')) return null;
  return url;
}

function withSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new FeedError('aborted'));
    if (signal.aborted) reject(new FeedError('aborted'));
    else signal.addEventListener('abort', aborted, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function readJson(response: Response, budget: { remaining: number }, signal: AbortSignal): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && (declaredLength > MAX_BODY_BYTES || declaredLength > budget.remaining)) {
    void response.body?.cancel().catch(() => undefined);
    throw new FeedError('body_too_large');
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType && !/^application\/(?:[a-z0-9.-]+\+)?json$/.test(contentType)) {
    void response.body?.cancel().catch(() => undefined);
    throw new FeedError('unsupported_content_type');
  }
  if (!response.body) throw new FeedError('empty_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new FeedError('aborted');
      const { done, value } = await withSignal(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      budget.remaining -= value.byteLength;
      if (size > MAX_BODY_BYTES || budget.remaining < 0) throw new FeedError('body_too_large');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { throw new FeedError('invalid_json'); }
  const payload = object(parsed);
  if (!payload) throw new FeedError('invalid_payload');
  if (payload.error || payload.errors || typeof payload.status === 'number' && payload.status >= 400) throw new FeedError('provider_error');
  return payload;
}

/** Fetches a bounded snapshot from fixed official sources, without credentials. */
export async function collectSpectraPublicFeed(provider: string, options: SpectraPublicFeedOptions = {}): Promise<SpectraPublicFeedResult> {
  const source = SPECTRA_PUBLIC_FEED_SOURCES.find(item => item.id === provider);
  const result: SpectraPublicFeedResult = { provider, endpoint: source?.endpoint ?? '', status: 'failed', records: [] };
  if (!source) return { ...result, errorCode: 'unsupported_provider' };
  if (options.signal?.aborted) return { ...result, errorCode: 'aborted' };
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  timeout.unref?.();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const budget = { remaining: MAX_TOTAL_BYTES };
  const visited = new Set<string>();
  const ids = new Set<string>();
  let url: string = source.endpoint;
  let acceptedPages = 0;
  let partialCode: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (controller.signal.aborted) throw new FeedError('aborted');
      if (visited.has(url)) throw new FeedError('pagination_loop');
      visited.add(url);
      const headers: Record<string, string> = {
        Accept: provider === 'nws-alerts' ? 'application/geo+json' : 'application/json',
        'User-Agent': 'Bad-Blue-Spectra-Public-Feed/1.0',
      };
      if (page === 0 && options.etag) headers['If-None-Match'] = options.etag;
      if (page === 0 && options.lastModified) headers['If-Modified-Since'] = options.lastModified;
      const response = await withSignal((options.fetchImpl ?? fetch)(url, {
        method: 'GET', headers, signal: controller.signal, redirect: 'error', credentials: 'omit',
      }), controller.signal);
      if (response.redirected || response.url && response.url !== url) {
        void response.body?.cancel().catch(() => undefined);
        throw new FeedError('unexpected_redirect');
      }
      if (response.status === 304) {
        if (page !== 0 || !options.etag && !options.lastModified) throw new FeedError('unexpected_not_modified');
        return { ...result, status: 'not_modified', etag: response.headers.get('etag') ?? options.etag, lastModified: response.headers.get('last-modified') ?? options.lastModified };
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new FeedError(`http_${response.status}`);
      }
      if (page === 0) {
        result.etag = response.headers.get('etag') ?? undefined;
        result.lastModified = response.headers.get('last-modified') ?? undefined;
      }
      const payload = await readJson(response, budget, controller.signal);
      const values = provider === 'nasa-eonet' ? payload.events : payload.features;
      if (!Array.isArray(values) || provider !== 'nasa-eonet' && payload.type !== 'FeatureCollection') throw new FeedError('invalid_payload');
      acceptedPages++;
      const retrievedAt = new Date().toISOString();
      for (const value of values) {
        if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RECORD_BYTES) {
          partialCode ??= 'record_too_large';
          continue;
        }
        const record = normalizeRecord(provider, value, retrievedAt);
        if (!record) { partialCode ??= 'invalid_records'; continue; }
        if (ids.has(record.recordId)) continue;
        if (result.records.length >= MAX_RECORDS) { partialCode = 'record_limit'; break; }
        ids.add(record.recordId);
        result.records.push(record);
      }
      if (provider === 'nasa-eonet' && values.length >= 100) partialCode ??= 'source_limit';
      const advertisedNext = provider === 'nws-alerts' ? object(payload.pagination)?.next : undefined;
      if (!advertisedNext) break;
      const next = nextPage(advertisedNext);
      if (!next) throw new FeedError('untrusted_next_url');
      if (page + 1 >= MAX_PAGES || result.records.length >= MAX_RECORDS) {
        partialCode = 'pagination_limit';
        result.nextUrl = next;
        break;
      }
      url = next;
    }
    result.status = partialCode ? 'partial' : 'ok';
    result.errorCode = partialCode;
    // A validator for the first page cannot attest to a multi-page snapshot.
    if (acceptedPages > 1 || result.status === 'partial') {
      delete result.etag;
      delete result.lastModified;
    }
    return result;
  } catch (error) {
    result.status = acceptedPages > 0 ? 'partial' : 'failed';
    result.errorCode = timedOut ? 'timeout' : options.signal?.aborted ? 'aborted'
      : error instanceof FeedError ? error.code : 'network_error';
    delete result.etag;
    delete result.lastModified;
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
