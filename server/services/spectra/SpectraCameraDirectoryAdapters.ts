import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SpectraExternalCamera {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provider: string;
  imageUrl?: string;
  videoUrl?: string;
  observedAt?: string;
  status?: {
    disabled?: boolean;
    qualityWarning?: boolean;
    quality?: number | null;
  };
  metadata?: Record<string, unknown>;
}

interface CameraFeedConfig {
  id: string;
  provider: string;
  urlTemplate: string;
  arrayPath?: string;
  idPath?: string;
  namePath?: string;
  latitudePath: string;
  longitudePath: string;
  imageUrlPath?: string;
  videoUrlPath?: string;
  observedAtPath?: string;
  disabledPath?: string;
  qualityPath?: string;
  headersFromEnv?: Record<string, string>;
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
  if (mapped) return isPrivateIpv4(mapped[1]);
  // IPv4-mapped IPv6 may be written with two hex groups instead of dotted IPv4.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Camera directory adapters require HTTPS.');
  if (url.username || url.password || url.port) throw new Error('Credential-bearing or nonstandard-port camera URLs are unsupported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Local camera directory targets are unsupported.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private camera directory targets are unsupported.');
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Camera directory resolved to a non-public address.');
  }
  return url;
}

function readPath(value: any, path?: string): any {
  if (!path) return value;
  return path.split('.').filter(Boolean).reduce((current, part) => {
    if (current == null) return undefined;
    const index = /^\d+$/.test(part) ? Number(part) : null;
    return index === null ? current[part] : current[index];
  }, value);
}

function parseConfigs(): CameraFeedConfig[] {
  const raw = String(process.env.SPECTRA_CAMERA_JSON_FEEDS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    // An operator-supplied directory cannot fan out to unbounded network calls.
    return parsed.slice(0, 8).flatMap((item: any) => {
      const id = String(item?.id || '').trim();
      const provider = String(item?.provider || item?.label || id).trim();
      const urlTemplate = String(item?.urlTemplate || item?.url || '').trim();
      const latitudePath = String(item?.latitudePath || '').trim();
      const longitudePath = String(item?.longitudePath || '').trim();
      if (
        !id
        || seen.has(id)
        || !provider
        || !/^https:\/\//i.test(urlTemplate)
        || !latitudePath
        || !longitudePath
      ) return [];
      seen.add(id);
      return [{
        id,
        provider,
        urlTemplate,
        arrayPath: item?.arrayPath ? String(item.arrayPath) : undefined,
        idPath: item?.idPath ? String(item.idPath) : undefined,
        namePath: item?.namePath ? String(item.namePath) : undefined,
        latitudePath,
        longitudePath,
        imageUrlPath: item?.imageUrlPath ? String(item.imageUrlPath) : undefined,
        videoUrlPath: item?.videoUrlPath ? String(item.videoUrlPath) : undefined,
        observedAtPath: item?.observedAtPath ? String(item.observedAtPath) : undefined,
        disabledPath: item?.disabledPath ? String(item.disabledPath) : undefined,
        qualityPath: item?.qualityPath ? String(item.qualityPath) : undefined,
        headersFromEnv: item?.headersFromEnv && typeof item.headersFromEnv === 'object'
          ? Object.fromEntries(
              Object.entries(item.headersFromEnv).map(([key, envName]) => [key, String(envName)]),
            )
          : undefined,
      } satisfies CameraFeedConfig];
    });
  } catch {
    return [];
  }
}

function interpolateTemplate(
  template: string,
  latitude: number,
  longitude: number,
  radiusMiles: number,
): string {
  return template
    .replaceAll('{{lat}}', encodeURIComponent(String(latitude)))
    .replaceAll('{{lng}}', encodeURIComponent(String(longitude)))
    .replaceAll('{{radiusMiles}}', encodeURIComponent(String(radiusMiles)));
}

/**
 * These are camera-directory links, not permission to fetch video frames.
 * Restrict displayed media links to well-formed public HTTPS destinations.
 */
export function spectraPublicCameraAssetUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 2_200) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !host || host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.internal')
      || (isIP(host) && isPrivateAddress(host))) return undefined;
    return url.toString();
  } catch { return undefined; }
}

function publicCoordinate(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'string' && !value.trim())) return Number.NaN;
  return Number(value);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
    * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function configuredSpectraCameraJsonFeeds(): Array<{ id: string; provider: string }> {
  return parseConfigs().map(config => ({ id: config.id, provider: config.provider }));
}

export async function acquireConfiguredSpectraCameras(
  latitude: number,
  longitude: number,
  radiusMiles: number,
): Promise<SpectraExternalCamera[]> {
  if (![latitude, longitude, radiusMiles].every(Number.isFinite)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    || radiusMiles <= 0) return [];
  const configs = parseConfigs();
  if (!configs.length) return [];

  const boundedRadiusMiles = Math.max(0.1, Math.min(100_000 / 1609.344, radiusMiles));
  const radiusMeters = boundedRadiusMiles * 1609.344;
  const outcomes = await Promise.allSettled(configs.map(async config => {
    const endpoint = await assertPublicHttps(
      interpolateTemplate(config.urlTemplate, latitude, longitude, boundedRadiusMiles),
    );
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA/1.0',
    };
    for (const [header, envName] of Object.entries(config.headersFromEnv || {})) {
      const value = String(process.env[envName] || '').trim();
      if (value) headers[header] = value;
    }

    const response = await fetch(endpoint, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok || !response.body
      || Number(response.headers.get('content-length') || 0) > 5_000_000) return [];
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 5_000_000) return [];
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new TextDecoder().decode(data));
    const collection = readPath(payload, config.arrayPath);
    const rows = Array.isArray(collection) ? collection : [collection];

    return rows.slice(0, 500).flatMap((row: any, index: number) => {
      const lat = publicCoordinate(readPath(row, config.latitudePath));
      const lon = publicCoordinate(readPath(row, config.longitudePath));
      if (
        !Number.isFinite(lat)
        || !Number.isFinite(lon)
        || lat < -90 || lat > 90
        || lon < -180 || lon > 180
        || haversineMeters(latitude, longitude, lat, lon) > radiusMeters
      ) return [];

      const observedRaw = config.observedAtPath ? readPath(row, config.observedAtPath) : undefined;
      const observedMs = typeof observedRaw === 'string' && observedRaw.trim()
        ? Date.parse(observedRaw) : Number.NaN;
      const observedAt = Number.isFinite(observedMs)
        && observedMs >= Date.UTC(1900, 0, 1)
        && observedMs <= Date.now() + 86_400_000
          ? new Date(observedMs).toISOString() : undefined;
      const imageUrlRaw = config.imageUrlPath ? String(readPath(row, config.imageUrlPath) || '').trim() : '';
      const videoUrlRaw = config.videoUrlPath ? String(readPath(row, config.videoUrlPath) || '').trim() : '';
      const qualityRaw = config.qualityPath ? Number(readPath(row, config.qualityPath)) : NaN;
      const disabledRaw = config.disabledPath ? readPath(row, config.disabledPath) : undefined;

      return [{
        id: String(
          (config.idPath ? readPath(row, config.idPath) : undefined)
          || `${config.id}:${index + 1}:${lat.toFixed(6)}:${lon.toFixed(6)}`,
        ),
        name: String(
          (config.namePath ? readPath(row, config.namePath) : undefined)
          || `${config.provider} camera`,
        ),
        latitude: lat,
        longitude: lon,
        provider: config.provider,
        imageUrl: spectraPublicCameraAssetUrl(imageUrlRaw),
        videoUrl: spectraPublicCameraAssetUrl(videoUrlRaw),
        observedAt,
        status: {
          disabled: disabledRaw === true || String(disabledRaw).toLowerCase() === 'true',
          qualityWarning: Number.isFinite(qualityRaw) ? qualityRaw < 0.5 : undefined,
          quality: Number.isFinite(qualityRaw) ? Math.max(0, Math.min(1, qualityRaw)) : null,
        },
        metadata: {
          cameraDirectoryId: config.id,
          feedEndpoint: endpoint.origin,
        },
      } satisfies SpectraExternalCamera];
    });
  }));

  const seen = new Set<string>();
  return outcomes
    .flatMap(outcome => outcome.status === 'fulfilled' ? outcome.value : [])
    .filter(camera => {
      const key = `${camera.provider}:${camera.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return camera.status?.disabled !== true;
    })
    .slice(0, 500);
}
