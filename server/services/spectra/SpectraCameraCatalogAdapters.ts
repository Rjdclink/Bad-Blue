import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SpectraCameraCatalogItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provider: string;
  imageUrl?: string;
  videoUrl?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

interface SpectraCameraCatalogConfig {
  id: string;
  provider: string;
  url: string;
  arrayPath?: string;
  idPath?: string;
  namePath?: string;
  latitudePath: string;
  longitudePath: string;
  imageUrlPath?: string;
  videoUrlPath?: string;
  observedAtPath?: string;
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

async function assertPublicHttps(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('SPECTRA camera catalog adapters require HTTPS.');
  if (url.username || url.password) throw new Error('Credential-bearing camera catalog URLs are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Local camera catalog targets are not supported.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private camera catalog targets are not supported.');
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Camera catalog target resolved to a non-public address.');
  }
  return url;
}

function readPath(value: any, path?: string): any {
  if (!path) return value;
  return path.split('.').filter(Boolean).reduce((current, part) => {
    if (current == null) return undefined;
    const arrayIndex = /^\d+$/.test(part) ? Number(part) : null;
    return arrayIndex === null ? current[part] : current[arrayIndex];
  }, value);
}

function parseConfigs(): SpectraCameraCatalogConfig[] {
  const raw = String(process.env.SPECTRA_CAMERA_JSON_FEEDS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((item: any) => {
      const id = String(item?.id || '').trim();
      const provider = String(item?.provider || id || '').trim();
      const url = String(item?.url || '').trim();
      const latitudePath = String(item?.latitudePath || '').trim();
      const longitudePath = String(item?.longitudePath || '').trim();
      if (!id || seen.has(id) || !provider || !/^https:\/\//i.test(url) || !latitudePath || !longitudePath) {
        return [];
      }
      seen.add(id);
      return [{
        id,
        provider,
        url,
        arrayPath: item?.arrayPath ? String(item.arrayPath) : undefined,
        idPath: item?.idPath ? String(item.idPath) : undefined,
        namePath: item?.namePath ? String(item.namePath) : undefined,
        latitudePath,
        longitudePath,
        imageUrlPath: item?.imageUrlPath ? String(item.imageUrlPath) : undefined,
        videoUrlPath: item?.videoUrlPath ? String(item.videoUrlPath) : undefined,
        observedAtPath: item?.observedAtPath ? String(item.observedAtPath) : undefined,
        headersFromEnv: item?.headersFromEnv && typeof item.headersFromEnv === 'object'
          ? Object.fromEntries(Object.entries(item.headersFromEnv).map(([header, envName]) => [header, String(envName)]))
          : undefined,
      } satisfies SpectraCameraCatalogConfig];
    });
  } catch {
    return [];
  }
}

export function getConfiguredSpectraCameraCatalogs(): Array<{ id: string; provider: string }> {
  return parseConfigs().map(config => ({ id: config.id, provider: config.provider }));
}

export async function acquireConfiguredSpectraCameraCatalogs(
  latitude: number,
  longitude: number,
  radiusMiles: number,
): Promise<SpectraCameraCatalogItem[]> {
  const configs = parseConfigs();
  if (!configs.length) return [];

  const radiusMeters = Math.max(250, Math.min(100_000, radiusMiles * 1609.344));
  const settled = await Promise.allSettled(configs.map(async config => {
    const endpoint = await assertPublicHttps(config.url);
    endpoint.searchParams.set('lat', String(latitude));
    endpoint.searchParams.set('lng', String(longitude));
    endpoint.searchParams.set('radiusMeters', String(Math.round(radiusMeters)));

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

    const payload: any = await response.json();
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
      ) return [];

      const latDelta = (lat - latitude) * 111_320;
      const lonDelta = (lon - longitude)
        * 111_320
        * Math.max(0.15, Math.cos(latitude * Math.PI / 180));
      if (Math.hypot(latDelta, lonDelta) > radiusMeters * 1.1) return [];

      const id = String(
        readPath(row, config.idPath)
        ?? `${config.id}:${index + 1}:${lat.toFixed(6)},${lon.toFixed(6)}`
      );
      const name = String(readPath(row, config.namePath) || `${config.provider} camera`);
      const imageUrlRaw = String(readPath(row, config.imageUrlPath) || '').trim();
      const videoUrlRaw = String(readPath(row, config.videoUrlPath) || '').trim();
      const observedAtRaw = readPath(row, config.observedAtPath);
      const observedAtDate = observedAtRaw ? new Date(observedAtRaw) : null;

      return [{
        id,
        name,
        latitude: lat,
        longitude: lon,
        provider: config.provider,
        imageUrl: /^https?:\/\//i.test(imageUrlRaw) ? imageUrlRaw : undefined,
        videoUrl: /^https?:\/\//i.test(videoUrlRaw) ? videoUrlRaw : undefined,
        observedAt: observedAtDate && Number.isFinite(observedAtDate.getTime())
          ? observedAtDate.toISOString()
          : undefined,
        metadata: {
          catalogId: config.id,
          acquisitionMethod: 'configured-camera-json-feed',
        },
      } satisfies SpectraCameraCatalogItem];
    });
  }));

  const seen = new Set<string>();
  return settled
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(item => {
      const key = `${item.provider}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 500);
}
