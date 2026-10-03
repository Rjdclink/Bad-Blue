import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { GPSPoint } from '../geoconsole/types';

export interface SpectraGenericPullAdapterConfig {
  id: string;
  label?: string;
  url: string;
  source:
    | 'device_gps'
    | 'gnss_fix'
    | 'vehicle_telemetry'
    | 'social_geotag'
    | 'public_camera'
    | 'traffic_cam'
    | 'historical_location'
    | 'public_record';
  arrayPath?: string;
  latitudePath: string;
  longitudePath: string;
  timestampPath: string;
  accuracyPath?: string;
  altitudePath?: string;
  recordIdPath?: string;
  trackIdPath?: string;
  cameraIdPath?: string;
  objectClassPath?: string;
  speedPath?: string;
  headingPath?: string;
  headersFromEnv?: Record<string, string>;
  confidenceCeiling?: number;
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
  if (url.protocol !== 'https:') throw new Error('Generic SPECTRA pull adapters require HTTPS.');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Local telemetry pull targets are not supported.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private telemetry pull targets are not supported.');
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Telemetry pull target resolved to a non-public address.');
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

function parseConfig(): SpectraGenericPullAdapterConfig[] {
  const raw = String(process.env.SPECTRA_GENERIC_JSON_ADAPTERS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.slice(0, 64).flatMap((item: any) => {
      const id = String(item?.id || '').trim();
      const url = String(item?.url || '').trim();
      const source = String(item?.source || '').trim();
      const latitudePath = String(item?.latitudePath || '').trim();
      const longitudePath = String(item?.longitudePath || '').trim();
      const timestampPath = String(item?.timestampPath || '').trim();
      if (
        !id
        || seen.has(id)
        || !/^https:\/\//i.test(url)
        || !latitudePath
        || !longitudePath
        || !timestampPath
        || ![
          'device_gps','gnss_fix','vehicle_telemetry','social_geotag',
          'public_camera','traffic_cam','historical_location','public_record',
        ].includes(source)
      ) return [];
      seen.add(id);
      return [{
        id,
        label: String(item?.label || id),
        url,
        source: source as SpectraGenericPullAdapterConfig['source'],
        arrayPath: item?.arrayPath ? String(item.arrayPath) : undefined,
        latitudePath,
        longitudePath,
        timestampPath,
        accuracyPath: item?.accuracyPath ? String(item.accuracyPath) : undefined,
        altitudePath: item?.altitudePath ? String(item.altitudePath) : undefined,
        recordIdPath: item?.recordIdPath ? String(item.recordIdPath) : undefined,
        trackIdPath: item?.trackIdPath ? String(item.trackIdPath) : undefined,
        cameraIdPath: item?.cameraIdPath ? String(item.cameraIdPath) : undefined,
        objectClassPath: item?.objectClassPath ? String(item.objectClassPath) : undefined,
        speedPath: item?.speedPath ? String(item.speedPath) : undefined,
        headingPath: item?.headingPath ? String(item.headingPath) : undefined,
        headersFromEnv: item?.headersFromEnv && typeof item.headersFromEnv === 'object'
          ? Object.fromEntries(Object.entries(item.headersFromEnv).map(([key, envName]) => [key, String(envName)]))
          : undefined,
        confidenceCeiling: Number.isFinite(Number(item?.confidenceCeiling))
          ? Math.max(0.1, Math.min(0.95, Number(item.confidenceCeiling)))
          : 0.8,
      } satisfies SpectraGenericPullAdapterConfig];
    });
  } catch {
    return [];
  }
}

export function getSpectraGenericPullAdapters(): Array<{
  id: string;
  label: string;
  source: string;
}> {
  return parseConfig().map(adapter => ({
    id: adapter.id,
    label: adapter.label || adapter.id,
    source: adapter.source,
  }));
}

export async function pullSpectraGenericAdapter(adapterId: string): Promise<GPSPoint[]> {
  const adapter = parseConfig().find(item => item.id === adapterId);
  if (!adapter) throw new Error('Unknown SPECTRA pull adapter.');

  const url = await assertPublicHttps(adapter.url);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'LegalWhat-SPECTRA/1.0',
  };
  for (const [header, envName] of Object.entries(adapter.headersFromEnv || {})) {
    const value = String(process.env[envName] || '').trim();
    if (value) headers[header] = value;
  }

  const response = await fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`SPECTRA pull adapter returned HTTP ${response.status}.`);

  const payload: any = await response.json();
  const collection = readPath(payload, adapter.arrayPath);
  const rows = Array.isArray(collection) ? collection : [collection];
  const now = new Date();

  return rows.slice(0, 500).flatMap((row: any) => {
    const latitude = Number(readPath(row, adapter.latitudePath));
    const longitude = Number(readPath(row, adapter.longitudePath));
    const timestamp = new Date(readPath(row, adapter.timestampPath));
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
      || !Number.isFinite(timestamp.getTime())
      || timestamp.getTime() > now.getTime() + 24 * 60 * 60_000
    ) return [];

    const accuracyRaw = adapter.accuracyPath ? Number(readPath(row, adapter.accuracyPath)) : NaN;
    const altitudeRaw = adapter.altitudePath ? Number(readPath(row, adapter.altitudePath)) : NaN;
    const recordId = adapter.recordIdPath ? String(readPath(row, adapter.recordIdPath) || '').trim() : '';
    const trackId = adapter.trackIdPath ? String(readPath(row, adapter.trackIdPath) || '').trim() : '';
    const cameraId = adapter.cameraIdPath ? String(readPath(row, adapter.cameraIdPath) || '').trim() : '';
    const objectClass = adapter.objectClassPath ? String(readPath(row, adapter.objectClassPath) || '').trim() : '';
    const speedRaw = adapter.speedPath ? Number(readPath(row, adapter.speedPath)) : NaN;
    const headingRaw = adapter.headingPath ? Number(readPath(row, adapter.headingPath)) : NaN;
    const heading = Number.isFinite(headingRaw)
      ? ((headingRaw % 360) + 360) % 360
      : undefined;

    return [{
      latitude,
      longitude,
      altitude: Number.isFinite(altitudeRaw) ? altitudeRaw : undefined,
      accuracy: Number.isFinite(accuracyRaw) && accuracyRaw > 0 ? accuracyRaw : undefined,
      timestamp,
      receivedAt: now,
      source: adapter.source,
      confidence: adapter.confidenceCeiling ?? 0.8,
      observationKind:
        adapter.source === 'historical_location' || adapter.source === 'public_record'
          ? 'historical'
          : 'observed',
      correlationGroup: trackId
        ? `pull-track:${adapter.id}:${trackId}`
        : `pull:${adapter.id}`,
      provenance: {
        provider: adapter.label || adapter.id,
        recordId: recordId || undefined,
        capturedAt: timestamp,
        transformedBy: ['spectra_generic_json_pull'],
      },
      metadata: {
        adapterId: adapter.id,
        trackId: trackId || undefined,
        cameraId: cameraId || undefined,
        objectClass: objectClass || undefined,
        velocity: (
          Number.isFinite(speedRaw) || heading !== undefined
        ) ? {
          speed: Number.isFinite(speedRaw) ? Math.max(0, speedRaw) : undefined,
          heading,
        } : undefined,
      },
    } satisfies GPSPoint];
  });
}
