import {
  normalizeSpectraAdvancedRadioPayload,
  SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS,
  type SpectraAdvancedRadioNormalizerKind,
} from './SpectraAdvancedRadioNormalizer';

import {
  normalizeSpectraExternalLocationPayload,
  SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS,
  type SpectraExternalLocationNormalizerKind,
} from './SpectraExternalLocationNormalizer';

import {
  normalizeSpectraInfrastructureProviderPayload,
  SPECTRA_INFRASTRUCTURE_PROVIDER_KINDS,
  type SpectraInfrastructureProviderKind,
} from './SpectraInfrastructureProviderNormalizer';

import {
  normalizeSpectraOpenSourceBridgePayload,
  SPECTRA_OPEN_SOURCE_BRIDGE_KINDS,
  type SpectraOpenSourceBridgeKind,
} from './SpectraOpenSourceBridgeNormalizer';

export type SpectraProviderNormalizerKind =
  | 'camara-location-retrieval'
  | 'bluetooth-scanner'
  | 'accessory-network'
  | SpectraInfrastructureProviderKind
  | SpectraOpenSourceBridgeKind
  | SpectraAdvancedRadioNormalizerKind
  | SpectraExternalLocationNormalizerKind;

export const SPECTRA_PROVIDER_NORMALIZER_KINDS: readonly SpectraProviderNormalizerKind[] = [
  'camara-location-retrieval',
  'bluetooth-scanner',
  'accessory-network',
  ...SPECTRA_INFRASTRUCTURE_PROVIDER_KINDS,
  ...SPECTRA_OPEN_SOURCE_BRIDGE_KINDS,
  ...SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS,
  ...SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS,
] as const;

export interface SpectraNormalizedProviderBatch {
  sessionId?: string;
  subjectLabel?: string;
  sourceId: string;
  measurements: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export class SpectraProviderNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpectraProviderNormalizationError';
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown): number | null {
  if (
    value === null
    || value === undefined
    || value === ''
    || typeof value === 'boolean'
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const date = new Date(value as any);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  if (time < Date.UTC(1900, 0, 1) || time > Date.now() + 24 * 60 * 60_000) return null;
  return date.toISOString();
}

function stringValue(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function providerEnvelope(
  payload: unknown,
  providerId: string,
): {
  body: Record<string, any>;
  sessionId?: string;
  subjectLabel?: string;
  providerId: string;
} {
  const outer = record(payload);
  const candidate =
    (outer.data && typeof outer.data === 'object' ? record(outer.data) : null)
    || (outer.location && typeof outer.location === 'object' ? record(outer.location) : null)
    || (outer.response && typeof outer.response === 'object' ? record(outer.response) : null)
    || outer;

  return {
    body: candidate,
    sessionId: stringValue(outer.sessionId, 200),
    subjectLabel: stringValue(outer.subjectLabel, 500),
    providerId: providerId.trim().slice(0, 200),
  };
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
  const deltaPhi = (latitudeB - latitudeA) * Math.PI / 180;
  const deltaLambda = (longitudeB - longitudeA) * Math.PI / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function confidenceForAccuracy(accuracyMeters: number, ceiling = 0.9): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0.35;
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.2, Math.min(ceiling, normalized));
}

function camaraPolygonCenter(
  boundary: unknown,
): { latitude: number; longitude: number; accuracy: number } | null {
  const points = list(boundary).flatMap(item => {
    const point = record(item);
    const latitude = bounded(point.latitude, -90, 90);
    const longitude = bounded(point.longitude, -180, 180);
    return latitude === null || longitude === null ? [] : [{ latitude, longitude }];
  });
  if (points.length < 3) return null;

  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const accuracy = Math.max(
    1,
    ...points.map(point => haversineMeters(latitude, longitude, point.latitude, point.longitude)),
  );
  return { latitude, longitude, accuracy };
}

function normalizeCamaraLocationRetrieval(
  payload: unknown,
  providerId: string,
): SpectraNormalizedProviderBatch {
  const envelope = providerEnvelope(payload, providerId);
  const body = envelope.body;
  const area = record(body.area);
  const areaType = String(area.areaType || '').toUpperCase();
  const timestamp = isoTimestamp(body.lastLocationTime);

  if (!timestamp) {
    throw new SpectraProviderNormalizationError('CAMARA location retrieval payload requires lastLocationTime.');
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  let accuracy: number | null = null;

  if (areaType === 'CIRCLE') {
    const center = record(area.center);
    latitude = bounded(center.latitude, -90, 90);
    longitude = bounded(center.longitude, -180, 180);
    accuracy = finite(area.radius);
  } else if (areaType === 'POLYGON') {
    const polygon = camaraPolygonCenter(area.boundary);
    if (polygon) {
      latitude = polygon.latitude;
      longitude = polygon.longitude;
      accuracy = polygon.accuracy;
    }
  }

  if (
    latitude === null
    || longitude === null
    || accuracy === null
    || !Number.isFinite(accuracy)
    || accuracy <= 0
  ) {
    throw new SpectraProviderNormalizationError('CAMARA location retrieval payload contains no usable location area.');
  }

  return {
    sessionId: envelope.sessionId,
    subjectLabel: envelope.subjectLabel,
    sourceId: envelope.providerId,
    measurements: [{
      kind: 'position',
      source: 'network_region',
      timestamp,
      latitude,
      longitude,
      accuracy: Math.min(5_000_000, Math.max(1, accuracy)),
      confidence: confidenceForAccuracy(accuracy, 0.88),
      provider: envelope.providerId,
      recordId: stringValue(body.recordId || body.requestId || body.correlationId),
      correlationGroup: `camara-location:${envelope.providerId}`,
      metadata: {
        providerKind: 'camara-location-retrieval',
        areaType,
        networkDerived: true,
        deviceIdentifierReturned: Boolean(body.device && typeof body.device === 'object'),
      },
    }],
    metadata: {
      normalization: 'camara-location-retrieval',
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeBluetoothScanner(
  payload: unknown,
  providerId: string,
): SpectraNormalizedProviderBatch {
  const envelope = providerEnvelope(payload, providerId);
  const body = envelope.body;
  const observations = list(body.observations || body.scans || body.measurements);
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawObservation of observations.slice(0, 2000)) {
    const observation = record(rawObservation);
    const timestamp = isoTimestamp(observation.timestamp || observation.observedAt || observation.capturedAt);
    if (!timestamp) continue;

    const sourceRaw = String(observation.source || 'ble_rssi').toLowerCase();
    const source =
      sourceRaw === 'ble_aoa'
        ? 'ble_aoa'
        : sourceRaw === 'bluetooth_proximity'
          ? 'bluetooth_proximity'
          : 'ble_rssi';

    const anchors = list(observation.anchors || observation.scanners).flatMap(rawAnchor => {
      const anchor = record(rawAnchor);
      const latitude = bounded(
        anchor.latitude ?? anchor.scannerLatitude ?? anchor.lat,
        -90,
        90,
      );
      const longitude = bounded(
        anchor.longitude ?? anchor.scannerLongitude ?? anchor.lng ?? anchor.lon,
        -180,
        180,
      );
      if (latitude === null || longitude === null) return [];

      const distanceMeters = finite(anchor.distanceMeters);
      const rssiDbm = finite(anchor.rssiDbm ?? anchor.rssi);
      const txPowerAtOneMeterDbm = finite(
        anchor.txPowerAtOneMeterDbm ?? anchor.txPower ?? anchor.measuredPower,
      );
      if (
        distanceMeters === null
        && (rssiDbm === null || txPowerAtOneMeterDbm === null)
      ) return [];

      const normalized: Record<string, unknown> = {
        id: stringValue(anchor.id || anchor.scannerId || anchor.anchorId, 200),
        latitude,
        longitude,
      };
      if (distanceMeters !== null) normalized.distanceMeters = Math.max(0.1, Math.min(1_000_000, distanceMeters));
      if (rssiDbm !== null) normalized.rssiDbm = Math.max(-127, Math.min(0, rssiDbm));
      if (txPowerAtOneMeterDbm !== null) {
        normalized.txPowerAtOneMeterDbm = Math.max(-127, Math.min(0, txPowerAtOneMeterDbm));
      }

      const pathLossExponent = bounded(anchor.pathLossExponent, 1, 6);
      const uncertaintyMeters = finite(anchor.uncertaintyMeters);
      const bearingDegrees = bounded(anchor.bearingDegrees, 0, 360);
      const bearingUncertaintyDegrees = bounded(anchor.bearingUncertaintyDegrees, 0.01, 180);
      const bearingReference = String(anchor.bearingReference || '').toLowerCase();
      if (pathLossExponent !== null) normalized.pathLossExponent = pathLossExponent;
      if (uncertaintyMeters !== null && uncertaintyMeters > 0) {
        normalized.uncertaintyMeters = Math.min(1_000_000, uncertaintyMeters);
      }
      if (bearingDegrees !== null) normalized.bearingDegrees = bearingDegrees;
      if (bearingUncertaintyDegrees !== null) {
        normalized.bearingUncertaintyDegrees = bearingUncertaintyDegrees;
      }
      if (['true_north', 'magnetic_north', 'device'].includes(bearingReference)) {
        normalized.bearingReference = bearingReference;
      }
      return [normalized];
    });

    if (!anchors.length) continue;
    measurements.push({
      kind: 'ranging',
      source,
      timestamp,
      provider: envelope.providerId,
      correlationGroup:
        stringValue(observation.correlationGroup, 300)
        || `bluetooth:${envelope.providerId}:${stringValue(observation.targetId || observation.beaconId, 120) || 'target'}`,
      anchors,
      metadata: {
        providerKind: 'bluetooth-scanner',
        targetRef: stringValue(observation.targetId || observation.beaconId, 200),
      },
    });
  }

  if (!measurements.length) {
    throw new SpectraProviderNormalizationError('Bluetooth scanner payload contains no usable ranging observations.');
  }

  return {
    sessionId: envelope.sessionId,
    subjectLabel: envelope.subjectLabel,
    sourceId: envelope.providerId,
    measurements,
    metadata: {
      normalization: 'bluetooth-scanner',
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeAccessoryNetwork(
  payload: unknown,
  providerId: string,
): SpectraNormalizedProviderBatch {
  const envelope = providerEnvelope(payload, providerId);
  const body = envelope.body;
  const observations = list(body.observations || body.locations || body.measurements);
  const measurements = observations.slice(0, 2000).flatMap(rawObservation => {
    const observation = record(rawObservation);
    const timestamp = isoTimestamp(observation.timestamp || observation.observedAt || observation.locationTime);
    const latitude = bounded(observation.latitude ?? observation.lat, -90, 90);
    const longitude = bounded(
      observation.longitude ?? observation.lng ?? observation.lon,
      -180,
      180,
    );
    if (!timestamp || latitude === null || longitude === null) return [];

    const accuracy = finite(observation.accuracy ?? observation.radiusMeters);
    const network = stringValue(observation.network || body.network, 80) || 'accessory-network';
    const normalizedAccuracy =
      accuracy !== null && accuracy > 0
        ? Math.min(5_000_000, accuracy)
        : 250;

    return [{
      kind: 'position',
      source: 'network_region',
      timestamp,
      latitude,
      longitude,
      accuracy: normalizedAccuracy,
      confidence: confidenceForAccuracy(normalizedAccuracy, 0.82),
      provider: `${envelope.providerId}:${network}`,
      recordId: stringValue(observation.recordId || observation.observationId, 300),
      correlationGroup:
        stringValue(observation.correlationGroup, 300)
        || `accessory-network:${envelope.providerId}:${stringValue(observation.deviceRef || observation.accessoryRef, 120) || 'device'}`,
      metadata: {
        providerKind: 'accessory-network',
        network,
        deviceRef: stringValue(observation.deviceRef || observation.accessoryRef, 200),
      },
    }];
  });

  if (!measurements.length) {
    throw new SpectraProviderNormalizationError('Accessory-network payload contains no usable location observations.');
  }

  return {
    sessionId: envelope.sessionId,
    subjectLabel: envelope.subjectLabel,
    sourceId: envelope.providerId,
    measurements,
    metadata: {
      normalization: 'accessory-network',
      normalizedAt: new Date().toISOString(),
    },
  };
}

export function normalizeSpectraProviderPayload(
  kind: SpectraProviderNormalizerKind,
  providerId: string,
  payload: unknown,
): SpectraNormalizedProviderBatch {
  const normalizedProviderId = providerId.trim().slice(0, 200);
  if (!normalizedProviderId) {
    throw new SpectraProviderNormalizationError('Provider ID is required.');
  }

  switch (kind) {
    case 'camara-location-retrieval':
      return normalizeCamaraLocationRetrieval(payload, normalizedProviderId);
    case 'bluetooth-scanner':
      return normalizeBluetoothScanner(payload, normalizedProviderId);
    case 'accessory-network':
      return normalizeAccessoryNetwork(payload, normalizedProviderId);
    default:
      if ((SPECTRA_INFRASTRUCTURE_PROVIDER_KINDS as readonly string[]).includes(kind)) {
        return normalizeSpectraInfrastructureProviderPayload(
          kind as SpectraInfrastructureProviderKind,
          normalizedProviderId,
          payload,
        );
      }
      if ((SPECTRA_OPEN_SOURCE_BRIDGE_KINDS as readonly string[]).includes(kind)) {
        return normalizeSpectraOpenSourceBridgePayload(
          kind as SpectraOpenSourceBridgeKind,
          normalizedProviderId,
          payload,
        );
      }
      if ((SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS as readonly string[]).includes(kind)) {
        return normalizeSpectraAdvancedRadioPayload(
          kind as SpectraAdvancedRadioNormalizerKind,
          normalizedProviderId,
          payload,
        );
      }
      if ((SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS as readonly string[]).includes(kind)) {
        return normalizeSpectraExternalLocationPayload(
          kind as SpectraExternalLocationNormalizerKind,
          normalizedProviderId,
          payload,
        );
      }
      throw new SpectraProviderNormalizationError('Unsupported SPECTRA provider normalizer.');
  }
}
