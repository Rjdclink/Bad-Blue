import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SpectraArcGisCameraLayer {
  url: string;
  provider: string;
  itemId?: string;
  layerName?: string;
}

interface CacheEntry {
  expiresAt: number;
  layers: SpectraArcGisCameraLayer[];
}

const cache = new Map<string, CacheEntry>();

function boundingBox(latitude: number, longitude: number, radiusMiles: number) {
  const radiusMeters = Math.max(500, Math.min(100_000, radiusMiles * 1609.344));
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (
    111_320 * Math.max(0.15, Math.cos(latitude * Math.PI / 180))
  );
  return {
    minLat: Math.max(-90, latitude - latDelta),
    maxLat: Math.min(90, latitude + latDelta),
    minLng: Math.max(-180, longitude - lngDelta),
    maxLng: Math.min(180, longitude + lngDelta),
  };
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part =>
    !Number.isInteger(part) || part < 0 || part > 255
  )) return true;
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

function safeServiceUrl(raw: unknown): string | null {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !host
      || host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || (isIP(host) && isPrivateAddress(host))
    ) return null;
    if (!/(?:FeatureServer|MapServer)(?:\/\d+)?\/?$/i.test(url.pathname)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function assertPublicServiceUrl(raw: string): Promise<string | null> {
  const safe = safeServiceUrl(raw);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return isPrivateAddress(host) ? null : safe;

    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
      return null;
    }
    return safe;
  } catch {
    return null;
  }
}

async function discoverServiceLayers(
  serviceUrl: string,
  provider: string,
  itemId?: string,
): Promise<SpectraArcGisCameraLayer[]> {
  const publicServiceUrl = await assertPublicServiceUrl(serviceUrl);
  if (!publicServiceUrl) return [];
  serviceUrl = publicServiceUrl;

  const directLayer = serviceUrl.match(/\/(?:FeatureServer|MapServer)\/(\d+)$/i);
  if (directLayer) {
    return [{ url: serviceUrl, provider, itemId }];
  }

  try {
    const endpoint = new URL(serviceUrl);
    endpoint.searchParams.set('f', 'json');
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];

    const payload: any = await response.json();
    const layers = Array.isArray(payload?.layers) ? payload.layers : [];
    const cameraLayers = layers.filter((layer: any) =>
      /(?:traffic|camera|cctv|webcam|511|roadway|video)/i.test(
        String(layer?.name || '')
      )
    );
    const selected = cameraLayers.length
      ? cameraLayers
      : layers.length === 1
        ? layers
        : [];

    return selected.slice(0, 8).flatMap((layer: any) => {
      const id = Number(layer?.id);
      if (!Number.isInteger(id) || id < 0) return [];
      return [{
        url: serviceUrl + '/' + String(id),
        provider,
        itemId,
        layerName: String(layer?.name || '').slice(0, 200) || undefined,
      }];
    });
  } catch {
    return [];
  }
}

export async function discoverPublicArcGisCameraLayers(
  latitude: number,
  longitude: number,
  radiusMiles = 20,
): Promise<SpectraArcGisCameraLayer[]> {
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) return [];

  const box = boundingBox(latitude, longitude, radiusMiles);
  const cacheKey = [
    Math.round(latitude * 2) / 2,
    Math.round(longitude * 2) / 2,
    Math.round(radiusMiles),
  ].join(':');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.layers;

  const endpoint = new URL('https://www.arcgis.com/sharing/rest/search');
  endpoint.searchParams.set('f', 'json');
  endpoint.searchParams.set(
    'q',
    '(traffic camera OR 511 camera OR roadway camera OR CCTV) AND (type:"Feature Service" OR type:"Map Service")'
  );
  endpoint.searchParams.set(
    'bbox',
    [
      box.minLng.toFixed(6),
      box.minLat.toFixed(6),
      box.maxLng.toFixed(6),
      box.maxLat.toFixed(6),
    ].join(',')
  );
  endpoint.searchParams.set('num', '25');
  endpoint.searchParams.set('sortField', 'modified');
  endpoint.searchParams.set('sortOrder', 'desc');

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return [];

    const payload: any = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const settled = await Promise.allSettled(
      results.slice(0, 16).map(async (item: any) => {
        const serviceUrl = safeServiceUrl(item?.url);
        if (!serviceUrl) return [];
        const publicServiceUrl = await assertPublicServiceUrl(serviceUrl);
        if (!publicServiceUrl) return [];
        return discoverServiceLayers(
          publicServiceUrl,
          String(item?.title || item?.owner || new URL(serviceUrl).hostname).slice(0, 200),
          String(item?.id || '').slice(0, 80) || undefined,
        );
      }),
    );

    const seen = new Set<string>();
    const layers = settled
      .flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .filter(layer => {
        const key = layer.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 24);

    cache.set(cacheKey, {
      expiresAt: Date.now() + 30 * 60_000,
      layers,
    });
    return layers;
  } catch {
    return [];
  }
}
