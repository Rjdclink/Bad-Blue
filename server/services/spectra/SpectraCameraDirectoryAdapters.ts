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
  return mapped ? isPrivateIpv4(mapped[1]) : false;
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
  if (url.username || url.password) throw new Error('Credential-bearing camera URLs are unsupported.');
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
    return parsed.flatMap((item: any) => {
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
    .split('{{lat}}').join(encodeURIComponent(String(latitude)))
    .split('{{lng}}').join(encodeURIComponent(String(longitude)))
    .split('{{radiusMiles}}').join(encodeURIComponent(String(radiusMiles)));
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
  const configs = parseConfigs();
  if (!configs.length) return [];

  const radiusMeters = Math.max(100, Math.min(100_000, radiusMiles * 1609.344));
  const outcomes = await Promise.allSettled(configs.map(async config => {
    const endpoint = await assertPublicHttps(
      interpolateTemplate(config.urlTemplate, latitude, longitude, radiusMiles),
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
    if (!response.ok) return [];

    const raw = await response.text();
    if (raw.length > 5_000_000) return [];
    const payload = JSON.parse(raw);
    const collection = readPath(payload, config.arrayPath);
    const rows = Array.isArray(collection) ? collection : [collection];

    return rows.slice(0, 500).flatMap((row: any, index: number) => {
      const lat = Number(readPath(row, config.latitudePath));
      const lon = Number(readPath(row, config.longitudePath));
      if (
        !Number.isFinite(lat)
        || !Number.isFinite(lon)
        || lat < -90 || lat > 90
        || lon < -180 || lon > 180
        || haversineMeters(latitude, longitude, lat, lon) > radiusMeters
      ) return [];

      const observedRaw = config.observedAtPath ? readPath(row, config.observedAtPath) : undefined;
      const observedAt = observedRaw && Number.isFinite(Date.parse(String(observedRaw)))
        ? new Date(String(observedRaw)).toISOString()
        : undefined;
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
        imageUrl: /^https?:\/\//i.test(imageUrlRaw) ? imageUrlRaw : undefined,
        videoUrl: /^https?:\/\//i.test(videoUrlRaw) ? videoUrlRaw : undefined,
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
