/** Keyless, bounded metadata catalogue lookup. No source is a live vehicle/person feed. */
export interface SpectraSatelliteScene {
  provider: 'Element 84 Earth Search';
  id: string;
  collection: string;
  observedAt: string;
  cloudCover?: number;
  platform?: string;
  bbox?: number[];
  links: Array<{ rel: string; href: string }>;
}

const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';
const STAC_COLLECTIONS = new Set(['sentinel-2-c1-l2a', 'landsat-c2-l2']);
const MAX_RESPONSE_BYTES = 750_000;
const MAX_ITEMS = 20;

function validTime(value: unknown, fromMs: number, toMs: number): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= fromMs - 86_400_000
    && time <= toMs + 86_400_000 ? new Date(time).toISOString() : null;
}

function validLink(value: unknown): { rel: string; href: string } | null {
  if (!value || typeof value !== 'object') return null;
  const link = value as { rel?: unknown; href?: unknown };
  if (!['self', 'preview', 'thumbnail'].includes(String(link.rel || ''))) return null;
  try {
    const url = new URL(String(link.href || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return { rel: String(link.rel), href: url.toString() };
  } catch { return null; }
}

function scene(value: unknown, fromMs: number, toMs: number): SpectraSatelliteScene | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, any>;
  const id = item.id;
  const collection = item.collection;
  if (typeof id !== 'string' || id.length < 1 || id.length > 200
    || !STAC_COLLECTIONS.has(collection)) return null;
  const observedAt = validTime(item.properties?.datetime, fromMs, toMs);
  if (!observedAt) return null;
  const cloudRaw = item.properties?.['eo:cloud_cover'];
  const cloudCover = typeof cloudRaw === 'number' && Number.isFinite(cloudRaw)
    && cloudRaw >= 0 && cloudRaw <= 100 ? cloudRaw : undefined;
  const bbox = Array.isArray(item.bbox) && item.bbox.length === 4
    && item.bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
    && Math.abs(item.bbox[0]) <= 180 && Math.abs(item.bbox[2]) <= 180
    && Math.abs(item.bbox[1]) <= 90 && Math.abs(item.bbox[3]) <= 90
    ? [...item.bbox] as number[] : undefined;
  const links = Array.isArray(item.links)
    ? item.links.slice(0, 12).flatMap((link: unknown) => validLink(link) || [])
    : [];
  return {
    provider: 'Element 84 Earth Search', id, collection, observedAt,
    cloudCover, platform: typeof item.properties?.platform === 'string'
      ? item.properties.platform.slice(0, 100) : undefined,
    bbox, links: links.slice(0, 4),
  };
}

/** Query independent Sentinel and Landsat collections in one bounded HTTP call.
 * Search results are source-dated imagery catalog entries, not predicted frames.
 */
export async function collectSpectraEarthSearchScenes(
  lat: number, lng: number, from: Date, to: Date,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraSatelliteScene[]> {
  const fromMs = from.getTime(), toMs = to.getTime();
  if (![lat, lng, fromMs, toMs].every(Number.isFinite)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180 || fromMs > toMs
    || toMs - fromMs > 90 * 86_400_000 || options.signal?.aborted) return [];
  const delta = 0.05;
  const body = {
    collections: [...STAC_COLLECTIONS],
    bbox: [Math.max(-180, lng - delta), Math.max(-90, lat - delta),
      Math.min(180, lng + delta), Math.min(90, lat + delta)],
    datetime: from.toISOString() + '/' + to.toISOString(),
    limit: MAX_ITEMS,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 6_000);
  timer.unref?.();
  try {
    if (options.signal?.aborted) return [];
    const response = await (options.fetchImpl || fetch)(STAC_SEARCH, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/geo+json,application/json',
        'Content-Type': 'application/json', 'User-Agent': 'LegalWhat-SPECTRA/1.0' },
      body: JSON.stringify(body),
    });
    if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')
      || Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES
      || !response.body) return [];
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) return [];
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object') return [];
    const features = (payload as { features?: unknown }).features;
    if (!Array.isArray(features)) return [];
    const found = new Map<string, SpectraSatelliteScene>();
    for (const item of features.slice(0, MAX_ITEMS)) {
      const normalized = scene(item, fromMs, toMs);
      if (normalized) found.set(normalized.collection + ':' + normalized.id, normalized);
    }
    return [...found.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  } catch { return []; }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
