import type { GPSPoint } from '../geoconsole/types';

export interface SpectraUnwiredRadioInput {
  timestamp: Date;
  provider?: string;
  radioType?: string;
  homeMobileCountryCode?: number;
  homeMobileNetworkCode?: number;
  wifiAccessPoints?: Array<{
    macAddress: string;
    signalStrength?: number;
  }>;
  cellTowers?: Array<{
    radioType?: string;
    mobileCountryCode?: number;
    mobileNetworkCode?: number;
    locationAreaCode?: number;
    cellId?: number;
  }>;
  metadata?: Record<string, unknown>;
}

function configuredEndpoint(): URL | null {
  const raw = String(process.env.SPECTRA_UNWIRED_GEOLOCATION_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function token(): string | null {
  const value = String(process.env.SPECTRA_UNWIRED_GEOLOCATION_TOKEN || '').trim();
  return value || null;
}

function canonicalMac(value: string): string | null {
  const hex = String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(firstOctet) || (firstOctet & 0x02) !== 0) return null;
  return hex.match(/.{2}/g)?.join(':') || null;
}

function confidenceForAccuracy(accuracyMeters: number): number {
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.2, Math.min(0.82, normalized));
}

export function spectraUnwiredConfigured(): boolean {
  return Boolean(configuredEndpoint() && token());
}

export async function resolveSpectraUnwiredRadio(
  input: SpectraUnwiredRadioInput,
): Promise<GPSPoint | null> {
  const endpoint = configuredEndpoint();
  const apiToken = token();
  if (!endpoint || !apiToken) return null;

  const wifi = (input.wifiAccessPoints || []).flatMap(accessPoint => {
    const bssid = canonicalMac(accessPoint.macAddress);
    if (!bssid) return [];
    const signal = Number(accessPoint.signalStrength);
    return [{
      bssid,
      signal: Number.isFinite(signal)
        ? Math.max(-127, Math.min(0, signal))
        : undefined,
    }];
  }).slice(0, 32);

  const cells = (input.cellTowers || []).flatMap(tower => {
    const mcc = Number(tower.mobileCountryCode ?? input.homeMobileCountryCode);
    const mnc = Number(tower.mobileNetworkCode ?? input.homeMobileNetworkCode);
    const lac = Number(tower.locationAreaCode);
    const cid = Number(tower.cellId);
    if (
      !Number.isInteger(mcc) || mcc < 0 || mcc > 999
      || !Number.isInteger(mnc) || mnc < 0 || mnc > 32767
      || !Number.isInteger(lac) || lac < 0
      || !Number.isInteger(cid) || cid < 0
    ) return [];

    return [{
      radio: String(tower.radioType || input.radioType || '').trim() || undefined,
      mcc,
      mnc,
      lac,
      cid,
    }];
  }).slice(0, 32);

  if (!wifi.length && !cells.length) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      body: JSON.stringify({
        token: apiToken,
        mcc: input.homeMobileCountryCode,
        mnc: input.homeMobileNetworkCode,
        radio: input.radioType,
        cells: cells.length ? cells : undefined,
        wifi: wifi.length ? wifi : undefined,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;

    const payload: any = await response.json();
    if (String(payload?.status || '').toLowerCase() === 'error') return null;

    const latitude = Number(payload?.lat);
    const longitude = Number(payload?.lon);
    const accuracy = Number(payload?.accuracy);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return null;

    const normalizedAccuracy =
      Number.isFinite(accuracy) && accuracy > 0
        ? Math.min(5_000_000, accuracy)
        : 2_500;

    return {
      latitude,
      longitude,
      accuracy: normalizedAccuracy,
      timestamp: input.timestamp,
      receivedAt: new Date(),
      source: wifi.length ? 'wifi_fingerprint' : 'cellular',
      confidence: confidenceForAccuracy(normalizedAccuracy),
      observationKind: 'inferred',
      correlationGroup: `radio:${input.provider || 'unwired'}`,
      provenance: {
        provider: 'Configured Unwired-compatible geolocation',
        capturedAt: input.timestamp,
        transformedBy: ['spectra_unwired_geolocation'],
      },
      metadata: {
        ...(input.metadata || {}),
        acquisitionMethod: 'unwired-compatible-radio-geolocation',
        wifiAccessPointCount: wifi.length,
        cellTowerCount: cells.length,
      },
    };
  } catch {
    return null;
  }
}
