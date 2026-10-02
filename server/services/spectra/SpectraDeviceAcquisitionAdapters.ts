import type { DataSource, GPSPoint } from '../geoconsole/types';

export interface SpectraWifiAccessPoint {
  macAddress: string;
  signalStrength?: number;
  signalToNoiseRatio?: number;
  channel?: number;
  age?: number;
}

export interface SpectraCellTower {
  cellId?: number;
  newRadioCellId?: number;
  locationAreaCode?: number;
  mobileCountryCode: number;
  mobileNetworkCode: number;
  signalStrength?: number;
  timingAdvance?: number;
}

export interface SpectraRadioPositionRequest {
  timestamp: Date;
  wifiAccessPoints?: SpectraWifiAccessPoint[];
  cellTowers?: SpectraCellTower[];
  radioType?: 'gsm' | 'cdma' | 'wcdma' | 'lte' | 'nr';
  homeMobileCountryCode?: number;
  homeMobileNetworkCode?: number;
  carrier?: string;
  provider?: string;
}

export interface SpectraRangingAnchor {
  latitude: number;
  longitude: number;
  distanceMeters: number;
  uncertaintyMeters?: number;
  id?: string;
}

export interface SpectraRangingRequest {
  source: Extract<DataSource, 'wifi_rtt' | 'uwb_range' | 'uwb_direction' | 'ble_rssi' | 'ble_aoa' | 'bluetooth_proximity'>;
  timestamp: Date;
  anchors: SpectraRangingAnchor[];
  provider?: string;
  correlationGroup?: string;
  metadata?: Record<string, unknown>;
}

export interface SpectraAbsoluteDeviceObservation {
  source: Extract<DataSource, 'device_gps' | 'gnss_fix' | 'gnss_raw' | 'browser_geolocation' | 'vehicle_telemetry'>;
  latitude: number;
  longitude: number;
  timestamp: Date;
  accuracy?: number;
  altitude?: number;
  verticalAccuracy?: number;
  speed?: number;
  heading?: number;
  confidence?: number;
  provider?: string;
  correlationGroup?: string;
  sensorTelemetry?: {
    accelerometer?: { x: number; y: number; z: number };
    gyroscope?: { x: number; y: number; z: number };
    magnetometer?: { x: number; y: number; z: number };
    barometerHpa?: number;
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function confidenceFromAccuracy(accuracyMeters: number, floor = 0.25, ceiling = 0.92): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return floor;
  const score = 1 - (Math.log10(Math.max(1, accuracyMeters)) / 5);
  return clamp(score, floor, ceiling);
}

function sanitizeWifiAccessPoints(points: SpectraWifiAccessPoint[] = []): SpectraWifiAccessPoint[] {
  const seen = new Set<string>();
  return points.flatMap(point => {
    const macAddress = String(point.macAddress || '').trim().toLowerCase();
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(macAddress)) return [];
    // Google recommends excluding locally administered MAC addresses because
    // they are not useful stable positioning anchors.
    const firstOctet = Number.parseInt(macAddress.slice(0, 2), 16);
    if ((firstOctet & 0x02) !== 0 || seen.has(macAddress)) return [];
    seen.add(macAddress);
    return [{
      macAddress,
      signalStrength: Number.isFinite(Number(point.signalStrength)) ? Number(point.signalStrength) : undefined,
      signalToNoiseRatio: Number.isFinite(Number(point.signalToNoiseRatio)) ? Number(point.signalToNoiseRatio) : undefined,
      channel: Number.isFinite(Number(point.channel)) ? Number(point.channel) : undefined,
      age: Number.isFinite(Number(point.age)) ? Number(point.age) : undefined,
    }];
  }).slice(0, 40);
}

function sanitizeCellTowers(towers: SpectraCellTower[] = []): SpectraCellTower[] {
  return towers.filter(tower =>
    Number.isFinite(Number(tower.mobileCountryCode))
    && Number.isFinite(Number(tower.mobileNetworkCode))
    && (
      Number.isFinite(Number(tower.cellId))
      || Number.isFinite(Number(tower.newRadioCellId))
    )
  ).slice(0, 16);
}

/**
 * Resolves Wi-Fi/cellular measurements through the configured radio-positioning
 * provider. The Google Geolocation API is the built-in adapter because it
 * accepts both Wi-Fi access points and serving/neighbor cell measurements.
 *
 * No IP fallback is used: if the supplied radio measurements cannot produce a
 * fix, this lane returns null instead of silently substituting a network-region
 * estimate.
 */
export async function acquireRadioPosition(
  request: SpectraRadioPositionRequest,
  signal?: AbortSignal,
): Promise<GPSPoint | null> {
  const key = (
    process.env.SPECTRA_GEOLOCATION_API_KEY
    || process.env.GOOGLE_GEOLOCATION_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || ''
  ).trim();
  if (!key) return null;

  const wifiAccessPoints = sanitizeWifiAccessPoints(request.wifiAccessPoints);
  const cellTowers = sanitizeCellTowers(request.cellTowers);
  if (!wifiAccessPoints.length && !cellTowers.length) return null;

  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('SPECTRA radio positioning timeout')), 5_000);

  try {
    const endpoint = new URL('https://www.googleapis.com/geolocation/v1/geolocate');
    endpoint.searchParams.set('key', key);
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        homeMobileCountryCode: request.homeMobileCountryCode,
        homeMobileNetworkCode: request.homeMobileNetworkCode,
        radioType: request.radioType,
        carrier: request.carrier,
        considerIp: false,
        cellTowers: cellTowers.length ? cellTowers : undefined,
        wifiAccessPoints: wifiAccessPoints.length ? wifiAccessPoints : undefined,
      }),
    });
    if (!response.ok) return null;

    const payload: any = await response.json();
    const latitude = Number(payload?.location?.lat);
    const longitude = Number(payload?.location?.lng);
    const accuracy = Number(payload?.accuracy);
    if (!validCoordinate(latitude, longitude)) return null;

    const source: DataSource = wifiAccessPoints.length
      ? 'wifi_fingerprint'
      : cellTowers.some(tower => Number.isFinite(Number(tower.cellId)) || Number.isFinite(Number(tower.newRadioCellId)))
        ? 'cellular'
        : 'network_region';

    return {
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: request.timestamp,
      receivedAt: new Date(),
      source,
      confidence: confidenceFromAccuracy(accuracy, 0.28, 0.88),
      observationKind: 'inferred',
      correlationGroup: `radio:${request.provider || 'google-geolocation'}`,
      provenance: {
        provider: request.provider || 'google-geolocation',
        capturedAt: request.timestamp,
        transformedBy: ['spectra_radio_positioning'],
      },
      metadata: {
        radioType: request.radioType,
        wifiAccessPointCount: wifiAccessPoints.length,
        cellTowerCount: cellTowers.length,
        contributingSources: [
          ...(wifiAccessPoints.length ? ['wifi'] : []),
          ...(cellTowers.length ? ['cellular'] : []),
        ],
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

function toLocalMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const radius = 6_378_137;
  const latRad = originLatitude * Math.PI / 180;
  return {
    x: (longitude - originLongitude) * Math.PI / 180 * radius * Math.cos(latRad),
    y: (latitude - originLatitude) * Math.PI / 180 * radius,
  };
}

function fromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const radius = 6_378_137;
  const latRad = originLatitude * Math.PI / 180;
  return {
    latitude: originLatitude + (y / radius) * 180 / Math.PI,
    longitude: originLongitude + (x / (radius * Math.cos(latRad))) * 180 / Math.PI,
  };
}

/**
 * Converts absolute, georeferenced ranging anchors into an inferred position.
 * Three independent anchors are required. Relative ranging without known anchor
 * coordinates is preserved upstream but is not converted into latitude/longitude.
 */
export function acquireRangingPosition(request: SpectraRangingRequest): GPSPoint | null {
  const anchors = request.anchors.filter(anchor =>
    validCoordinate(anchor.latitude, anchor.longitude)
    && Number.isFinite(anchor.distanceMeters)
    && anchor.distanceMeters >= 0
  );
  if (anchors.length < 3) return null;

  const originLatitude = anchors.reduce((sum, anchor) => sum + anchor.latitude, 0) / anchors.length;
  const originLongitude = anchors.reduce((sum, anchor) => sum + anchor.longitude, 0) / anchors.length;
  const local = anchors.map(anchor => ({
    ...toLocalMeters(anchor.latitude, anchor.longitude, originLatitude, originLongitude),
    distance: anchor.distanceMeters,
    uncertainty: Number.isFinite(Number(anchor.uncertaintyMeters))
      ? Math.max(0.1, Number(anchor.uncertaintyMeters))
      : 2,
  }));

  const reference = local[0];
  let ata00 = 0;
  let ata01 = 0;
  let ata11 = 0;
  let atb0 = 0;
  let atb1 = 0;

  for (let index = 1; index < local.length; index += 1) {
    const anchor = local[index];
    const a0 = 2 * (anchor.x - reference.x);
    const a1 = 2 * (anchor.y - reference.y);
    const b =
      (reference.distance ** 2 - anchor.distance ** 2)
      - (reference.x ** 2 + reference.y ** 2)
      + (anchor.x ** 2 + anchor.y ** 2);
    const weight = 1 / Math.max(0.25, anchor.uncertainty ** 2);
    ata00 += weight * a0 * a0;
    ata01 += weight * a0 * a1;
    ata11 += weight * a1 * a1;
    atb0 += weight * a0 * b;
    atb1 += weight * a1 * b;
  }

  const determinant = ata00 * ata11 - ata01 * ata01;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) return null;

  const x = (atb0 * ata11 - atb1 * ata01) / determinant;
  const y = (ata00 * atb1 - ata01 * atb0) / determinant;
  const position = fromLocalMeters(x, y, originLatitude, originLongitude);
  if (!validCoordinate(position.latitude, position.longitude)) return null;

  const residuals = local.map(anchor =>
    Math.abs(Math.hypot(x - anchor.x, y - anchor.y) - anchor.distance)
  );
  const residualRms = Math.sqrt(
    residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length,
  );
  const reportedUncertainty = Math.sqrt(
    local.reduce((sum, anchor) => sum + anchor.uncertainty ** 2, 0) / local.length,
  );
  const accuracy = Math.max(0.5, residualRms, reportedUncertainty);
  const anchorBonus = clamp((anchors.length - 2) * 0.06, 0, 0.18);

  return {
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy,
    timestamp: request.timestamp,
    receivedAt: new Date(),
    source: request.source,
    confidence: clamp(confidenceFromAccuracy(accuracy, 0.35, 0.92) + anchorBonus, 0.35, 0.95),
    observationKind: 'inferred',
    correlationGroup: request.correlationGroup || `ranging:${request.provider || request.source}`,
    provenance: {
      provider: request.provider || 'spectra-ranging',
      capturedAt: request.timestamp,
      transformedBy: ['spectra_weighted_multilateration'],
    },
    metadata: {
      ...(request.metadata || {}),
      anchorCount: anchors.length,
      residualRmsMeters: residualRms,
      rangingSource: request.source,
    },
  };
}

export function normalizeAbsoluteDeviceObservation(
  observation: SpectraAbsoluteDeviceObservation,
): GPSPoint | null {
  if (!validCoordinate(observation.latitude, observation.longitude)) return null;
  if (!Number.isFinite(observation.timestamp.getTime())) return null;

  const accuracy = Number(observation.accuracy);
  const confidence = Number.isFinite(Number(observation.confidence))
    ? clamp(Number(observation.confidence), 0, 1)
    : confidenceFromAccuracy(accuracy, 0.35, 0.98);

  return {
    latitude: observation.latitude,
    longitude: observation.longitude,
    altitude: Number.isFinite(Number(observation.altitude)) ? Number(observation.altitude) : undefined,
    accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
    verticalAccuracy: Number.isFinite(Number(observation.verticalAccuracy))
      ? Math.max(0, Number(observation.verticalAccuracy))
      : undefined,
    timestamp: observation.timestamp,
    receivedAt: new Date(),
    source: observation.source,
    confidence,
    observationKind: 'observed',
    correlationGroup: observation.correlationGroup || `device:${observation.provider || observation.source}`,
    provenance: {
      provider: observation.provider || observation.source,
      capturedAt: observation.timestamp,
      transformedBy: ['spectra_device_adapter'],
    },
    metadata: {
      velocity: (
        Number.isFinite(Number(observation.speed))
        || Number.isFinite(Number(observation.heading))
      ) ? {
        speed: Number.isFinite(Number(observation.speed)) ? Number(observation.speed) : undefined,
        heading: Number.isFinite(Number(observation.heading)) ? Number(observation.heading) : undefined,
      } : undefined,
      sensorTelemetry: observation.sensorTelemetry,
    },
  };
}
