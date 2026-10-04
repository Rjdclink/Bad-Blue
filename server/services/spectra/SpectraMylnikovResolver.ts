import type { GPSPoint } from '../geoconsole/types';

export interface SpectraMylnikovWifiObservation {
  macAddress: string;
  signalStrength?: number;
}

export interface SpectraMylnikovCellObservation {
  mobileCountryCode?: number;
  mobileNetworkCode?: number;
  locationAreaCode?: number;
  cellId?: number;
  signalStrength?: number;
}

export interface SpectraMylnikovInput {
  timestamp: Date;
  provider?: string;
  wifiAccessPoints?: SpectraMylnikovWifiObservation[];
  cellTowers?: SpectraMylnikovCellObservation[];
  metadata?: Record<string, unknown>;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function canonicalMac(value: string): string | null {
  const hex = String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(firstOctet)) return null;
  // Locally administered MACs are deliberately excluded from external lookup.
  if ((firstOctet & 0x02) !== 0) return null;
  return hex.match(/.{2}/g)?.join(':') || null;
}

function confidenceForAccuracy(accuracyMeters: number, ceiling: number): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0.25;
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.18, Math.min(ceiling, normalized));
}

function pointFromPayload(input: {
  payload: any;
  source: 'wifi_fingerprint' | 'cellular';
  timestamp: Date;
  provider?: string;
  metadata?: Record<string, unknown>;
  lookupMode: string;
}): GPSPoint | null {
  if (Number(input.payload?.result) !== 200) return null;
  const data = input.payload?.data && typeof input.payload.data === 'object'
    ? input.payload.data
    : {};
  const latitude = Number(data.lat ?? data.lan);
  const longitude = Number(data.lon);
  const range = Number(data.range);
  if (!validCoordinate(latitude, longitude)) return null;

  const accuracy = Number.isFinite(range) && range > 0
    ? Math.min(5_000_000, range)
    : undefined;

  return {
    latitude,
    longitude,
    accuracy,
    timestamp: input.timestamp,
    receivedAt: new Date(),
    source: input.source,
    confidence: confidenceForAccuracy(
      accuracy ?? 5_000,
      input.source === 'wifi_fingerprint' ? 0.78 : 0.70,
    ),
    observationKind: 'inferred',
    correlationGroup: `radio:${input.provider || 'mylnikov'}`,
    provenance: {
      provider: 'Mylnikov Open Geo-Location API',
      capturedAt: input.timestamp,
      transformedBy: ['spectra_mylnikov_open_geolocation'],
    },
    metadata: {
      ...(input.metadata || {}),
      acquisitionMethod: input.lookupMode,
      openData: true,
      mylnikovRangeMeters: accuracy,
      mylnikovSamples: Number.isFinite(Number(data.samples))
        ? Number(data.samples)
        : undefined,
      mylnikovRadio: typeof data.radio === 'string' ? data.radio : undefined,
    },
  };
}

async function fetchJson(endpoint: URL): Promise<any | null> {
  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

async function resolveWifi(input: SpectraMylnikovInput): Promise<GPSPoint | null> {
  const observations = (input.wifiAccessPoints || []).flatMap(item => {
    const mac = canonicalMac(item.macAddress);
    if (!mac) return [];
    const signal = Number(item.signalStrength);
    return [{
      mac,
      signal: Number.isFinite(signal)
        ? Math.max(-127, Math.min(0, signal))
        : -80,
    }];
  }).slice(0, 12);
  if (!observations.length) return null;

  if (observations.length > 1) {
    const search = observations
      .map(item => `${item.mac},${item.signal}`)
      .join(';');
    const endpoint = new URL('https://api.mylnikov.org/geolocation/wifi');
    endpoint.searchParams.set('v', '1.1');
    endpoint.searchParams.set('data', 'open');
    endpoint.searchParams.set('search', Buffer.from(search, 'utf8').toString('base64'));
    const payload = await fetchJson(endpoint);
    const point = payload
      ? pointFromPayload({
          payload,
          source: 'wifi_fingerprint',
          timestamp: input.timestamp,
          provider: input.provider,
          metadata: {
            ...(input.metadata || {}),
            wifiAccessPointCount: observations.length,
          },
          lookupMode: 'mylnikov-multi-wifi',
        })
      : null;
    if (point) return point;
  }

  for (const observation of observations) {
    const endpoint = new URL('https://api.mylnikov.org/geolocation/wifi');
    endpoint.searchParams.set('v', '1.1');
    endpoint.searchParams.set('data', 'open');
    endpoint.searchParams.set('bssid', observation.mac);
    const payload = await fetchJson(endpoint);
    const point = payload
      ? pointFromPayload({
          payload,
          source: 'wifi_fingerprint',
          timestamp: input.timestamp,
          provider: input.provider,
          metadata: {
            ...(input.metadata || {}),
            wifiAccessPointCount: observations.length,
            mylnikovBssid: observation.mac,
          },
          lookupMode: 'mylnikov-single-wifi',
        })
      : null;
    if (point) return point;
  }

  return null;
}

async function resolveCell(input: SpectraMylnikovInput): Promise<GPSPoint | null> {
  const towers = (input.cellTowers || []).flatMap(tower => {
    const mcc = Number(tower.mobileCountryCode);
    const mnc = Number(tower.mobileNetworkCode);
    const lac = Number(tower.locationAreaCode);
    const cellId = Number(tower.cellId);
    const signal = Number(tower.signalStrength);
    if (
      !Number.isInteger(mcc) || mcc < 1 || mcc > 999
      || !Number.isInteger(mnc) || mnc < 0 || mnc > 999
      || !Number.isInteger(lac) || lac < 0
      || !Number.isInteger(cellId) || cellId < 0
    ) return [];

    return [{
      mcc,
      mnc,
      lac,
      cellId,
      signal: Number.isFinite(signal)
        ? Math.max(-127, Math.min(0, signal))
        : -95,
    }];
  }).slice(0, 12);
  if (!towers.length) return null;

  if (towers.length > 1) {
    const search = towers
      .map(tower =>
        `${tower.mcc},${String(tower.mnc).padStart(2, '0')},${tower.lac},${tower.cellId},${tower.signal}`
      )
      .join(';');
    const endpoint = new URL('https://api.mylnikov.org/geolocation/cell');
    endpoint.searchParams.set('v', '1.1');
    endpoint.searchParams.set('data', 'open');
    endpoint.searchParams.set('search', Buffer.from(search, 'utf8').toString('base64'));
    const payload = await fetchJson(endpoint);
    const point = payload
      ? pointFromPayload({
          payload,
          source: 'cellular',
          timestamp: input.timestamp,
          provider: input.provider,
          metadata: {
            ...(input.metadata || {}),
            cellTowerCount: towers.length,
          },
          lookupMode: 'mylnikov-multi-cell',
        })
      : null;
    if (point) return point;
  }

  for (const tower of towers) {
    const endpoint = new URL('https://api.mylnikov.org/geolocation/cell');
    endpoint.searchParams.set('v', '1.1');
    endpoint.searchParams.set('data', 'open');
    endpoint.searchParams.set('mcc', String(tower.mcc));
    endpoint.searchParams.set('mnc', String(tower.mnc));
    endpoint.searchParams.set('lac', String(tower.lac));
    endpoint.searchParams.set('cellid', String(tower.cellId));
    const payload = await fetchJson(endpoint);
    const point = payload
      ? pointFromPayload({
          payload,
          source: 'cellular',
          timestamp: input.timestamp,
          provider: input.provider,
          metadata: {
            ...(input.metadata || {}),
            cellTowerCount: towers.length,
            mylnikovCellIdentity:
              `${tower.mcc}:${tower.mnc}:${tower.lac}:${tower.cellId}`,
          },
          lookupMode: 'mylnikov-single-cell',
        })
      : null;
    if (point) return point;
  }

  return null;
}

export async function resolveSpectraMylnikovRadio(
  input: SpectraMylnikovInput,
): Promise<GPSPoint[]> {
  const [wifi, cell] = await Promise.allSettled([
    resolveWifi(input),
    resolveCell(input),
  ]);

  return [
    wifi.status === 'fulfilled' ? wifi.value : null,
    cell.status === 'fulfilled' ? cell.value : null,
  ].filter((point): point is GPSPoint => Boolean(point));
}
