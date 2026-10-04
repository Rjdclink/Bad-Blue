import type { GPSPoint } from '../geoconsole/types';

export interface SpectraWigleWifiObservation {
  macAddress: string;
  signalStrength?: number;
}

export interface SpectraWigleInput {
  timestamp: Date;
  provider?: string;
  wifiAccessPoints?: SpectraWigleWifiObservation[];
  metadata?: Record<string, unknown>;
}

function canonicalMac(value: string): string | null {
  const hex = String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(firstOctet) || (firstOctet & 0x02) !== 0) return null;
  return hex.match(/.{2}/g)?.join(':') || null;
}

function authHeader(): string | null {
  const prebuilt = String(process.env.SPECTRA_WIGLE_BASIC_AUTH || '').trim();
  if (prebuilt) {
    return /^Basic\s+/i.test(prebuilt) ? prebuilt : `Basic ${prebuilt}`;
  }

  const name = String(process.env.SPECTRA_WIGLE_API_NAME || '').trim();
  const token = String(process.env.SPECTRA_WIGLE_API_TOKEN || '').trim();
  if (!name || !token) return null;
  return `Basic ${Buffer.from(`${name}:${token}`, 'utf8').toString('base64')}`;
}

function confidenceForAccuracy(accuracyMeters: number): number {
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.18, Math.min(0.72, normalized));
}

function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radius = 6_371_008.8;
  const phi1 = latitudeA * Math.PI / 180;
  const phi2 = latitudeB * Math.PI / 180;
  const dPhi = (latitudeB - latitudeA) * Math.PI / 180;
  const dLambda = (longitudeB - longitudeA) * Math.PI / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function lookupBssid(
  bssid: string,
  authorization: string,
): Promise<{
  latitude: number;
  longitude: number;
  lastUpdated?: string;
  ssid?: string;
} | null> {
  const endpoint = new URL('https://api.wigle.net/api/v2/network/search');
  endpoint.searchParams.set('netid', bssid);
  endpoint.searchParams.set('resultsPerPage', '1');

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;

    const payload: any = await response.json();
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    const latitude = Number(result?.trilat ?? result?.lat);
    const longitude = Number(result?.trilong ?? result?.lon ?? result?.lng);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return null;

    return {
      latitude,
      longitude,
      lastUpdated: typeof result?.lastupdt === 'string'
        ? result.lastupdt
        : undefined,
      ssid: typeof result?.ssid === 'string'
        ? result.ssid.slice(0, 128)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function spectraWigleConfigured(): boolean {
  return Boolean(authHeader());
}

export async function resolveSpectraWigleWifi(
  input: SpectraWigleInput,
): Promise<GPSPoint | null> {
  const authorization = authHeader();
  if (!authorization) return null;

  const observations = (input.wifiAccessPoints || []).flatMap(item => {
    const mac = canonicalMac(item.macAddress);
    if (!mac) return [];
    const signal = Number(item.signalStrength);
    return [{
      mac,
      signal: Number.isFinite(signal)
        ? Math.max(-127, Math.min(0, signal))
        : -85,
    }];
  }).slice(0, 6);
  if (!observations.length) return null;

  const outcomes = await Promise.allSettled(
    observations.map(item => lookupBssid(item.mac, authorization)),
  );

  const matched = outcomes.flatMap((outcome, index) =>
    outcome.status === 'fulfilled' && outcome.value
      ? [{ ...outcome.value, ...observations[index] }]
      : []
  );
  if (!matched.length) return null;

  let weightTotal = 0;
  let latitudeTotal = 0;
  let longitudeTotal = 0;
  for (const item of matched) {
    const normalizedSignal = Math.max(0.08, Math.min(1, (item.signal + 110) / 70));
    const weight = normalizedSignal ** 2;
    weightTotal += weight;
    latitudeTotal += item.latitude * weight;
    longitudeTotal += item.longitude * weight;
  }

  const latitude = latitudeTotal / Math.max(weightTotal, Number.EPSILON);
  const longitude = longitudeTotal / Math.max(weightTotal, Number.EPSILON);
  const spread = matched.length > 1
    ? Math.sqrt(
        matched.reduce((sum, item) => {
          const distance = haversineMeters(
            latitude,
            longitude,
            item.latitude,
            item.longitude,
          );
          return sum + distance * distance;
        }, 0) / matched.length,
      )
    : 90;
  const accuracy = Math.max(60, Math.min(5_000, spread + 35));

  return {
    latitude,
    longitude,
    accuracy,
    timestamp: input.timestamp,
    receivedAt: new Date(),
    source: 'wifi_fingerprint',
    confidence: confidenceForAccuracy(accuracy),
    observationKind: 'inferred',
    correlationGroup: `radio:${input.provider || 'wigle'}`,
    provenance: {
      provider: 'WiGLE',
      capturedAt: input.timestamp,
      transformedBy: ['spectra_wigle_bssid_lookup'],
    },
    metadata: {
      ...(input.metadata || {}),
      acquisitionMethod: 'wigle-bssid-centroid',
      wigleMatchedAccessPointCount: matched.length,
      wigleQueriedAccessPointCount: observations.length,
      wigleAccessPoints: matched.map(item => ({
        bssid: item.mac,
        signalStrength: item.signal,
        latitude: item.latitude,
        longitude: item.longitude,
        lastUpdated: item.lastUpdated,
      })),
    },
  };
}
