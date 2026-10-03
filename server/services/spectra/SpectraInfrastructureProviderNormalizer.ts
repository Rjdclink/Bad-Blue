import { resolveSpectraFloorplanCoordinate } from './SpectraFloorplanTransformer';
import { resolveSpectraInfrastructureBinding, spectraInfrastructureIdentityMetadata } from './SpectraInfrastructureIdentity';

export type SpectraInfrastructureProviderKind =
  | 'mist-location'
  | 'extreme-location'
  | 'unifi-client-location'
  | 'aruba-location-json'
  | 'generic-infrastructure-location';

export interface SpectraInfrastructureNormalizedBatch {
  sessionId?: string;
  subjectLabel?: string;
  sourceId: string;
  measurements: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
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
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function text(value: unknown, maxLength = 300): string | undefined {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function timestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  let date: Date;
  if (typeof value === 'number' && value > 0 && value < 10_000_000_000) {
    date = new Date(value * 1000);
  } else {
    date = new Date(value as any);
  }
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  if (time < Date.UTC(2000, 0, 1) || time > Date.now() + 24 * 60 * 60_000) return null;
  return date.toISOString();
}

function confidenceForAccuracy(accuracyMeters: number, ceiling = 0.9): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0.35;
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.2, Math.min(ceiling, normalized));
}

function envelope(payload: unknown, providerId: string) {
  const outer = record(payload);
  return {
    outer,
    providerId: providerId.trim().slice(0, 200),
    sessionId: text(outer.sessionId, 200),
    subjectLabel: text(outer.subjectLabel, 500),
  };
}

function candidateRows(kind: SpectraInfrastructureProviderKind, payload: unknown): any[] {
  const body = record(payload);
  if (kind === 'mist-location') {
    return list(body.events || body.data || body.locations || body.observations);
  }
  if (kind === 'extreme-location') {
    return list(
      body.clients
      || body.observations
      || body.locations
      || body.data
      || body.records
      || body.items
    );
  }
  if (kind === 'unifi-client-location') {
    return list(body.clients || body.data || body.items || body.results || body.devices);
  }
  if (kind === 'aruba-location-json') {
    const rows = list(body.events || body.data || body.locations || body.items);
    return rows.length ? rows : [body];
  }
  const rows = list(body.observations || body.locations || body.data || body.items || body.clients);
  return rows.length ? rows : [body];
}

function identifiersForRow(kind: SpectraInfrastructureProviderKind, row: Record<string, any>, providerId: string) {
  const macAddress = text(
    row.sta_eth_mac
    ?? row.client_mac
    ?? row.clientMac
    ?? row.mac
    ?? row.macAddress
    ?? row.device_mac
    ?? row.deviceMac,
    64,
  );
  const clientId = text(row.client_id ?? row.clientId ?? row.id ?? row.client, 200);
  const deviceId = text(row.device_id ?? row.deviceId ?? row.device ?? row.asset_id ?? row.assetId, 200);
  const username = text(row.username ?? row.userName ?? row.user ?? row.identity, 200);
  const ipAddress = text(row.ip ?? row.ipAddress ?? row.ip_address, 120);
  const apId = text(
    row.sensorMac
    ?? row.sensor_mac
    ?? row.ap_serial
    ?? row.apSerial
    ?? row.ap_id
    ?? row.apId
    ?? row.assoc_bssid
    ?? row.associatedAp,
    200,
  );
  const siteId = text(row.site_id ?? row.siteId ?? row.site ?? row.siteName, 200);
  const mapId = text(row.map_id ?? row.mapId ?? row.map, 200);
  const floorId = text(row.floor_id ?? row.floorId ?? row.floor ?? row.floorName, 200);

  return {
    providerId,
    macAddress,
    clientId,
    deviceId,
    username,
    ipAddress,
    apId,
    siteId,
    mapId,
    floorId,
    providerKind: kind,
  };
}

function resolveCoordinates(
  kind: SpectraInfrastructureProviderKind,
  row: Record<string, any>,
  providerId: string,
): {
  latitude: number;
  longitude: number;
  accuracy: number;
  coordinateSource: 'geographic' | 'floorplan';
} | null {
  const latitude = bounded(
    row.latitude ?? row.lat ?? row.location?.latitude ?? row.location?.lat,
    -90,
    90,
  );
  const longitude = bounded(
    row.longitude
    ?? row.lng
    ?? row.lon
    ?? row.location?.longitude
    ?? row.location?.lng
    ?? row.location?.lon,
    -180,
    180,
  );
  const directAccuracy = finite(
    row.error_level
    ?? row.accuracy
    ?? row.accuracyMeters
    ?? row.radius
    ?? row.radiusMeters
    ?? row.uncertainty,
  );

  if (latitude !== null && longitude !== null) {
    return {
      latitude,
      longitude,
      accuracy: directAccuracy !== null && directAccuracy > 0
        ? Math.min(5_000_000, directAccuracy)
        : kind === 'unifi-client-location'
          ? 100
          : 25,
      coordinateSource: 'geographic',
    };
  }

  const x = finite(row.x ?? row.location?.x ?? row.coordinates?.x);
  const y = finite(row.y ?? row.location?.y ?? row.coordinates?.y);
  if (x === null || y === null) return null;

  const ids = identifiersForRow(kind, row, providerId);
  const transformed = resolveSpectraFloorplanCoordinate({
    provider: providerId,
    mapId: ids.mapId,
    floorId: ids.floorId,
    siteId: ids.siteId,
    x,
    y,
  });
  if (!transformed) return null;

  return {
    latitude: transformed.latitude,
    longitude: transformed.longitude,
    accuracy: directAccuracy !== null && directAccuracy > 0
      ? Math.min(5_000_000, directAccuracy)
      : transformed.accuracyMeters,
    coordinateSource: 'floorplan',
  };
}

function observedAtForRow(kind: SpectraInfrastructureProviderKind, row: Record<string, any>): string | null {
  return timestamp(
    row.timestamp
    ?? row.observedAt
    ?? row.observed_at
    ?? row.lastSeen
    ?? row.last_seen
    ?? row.locationTime
    ?? row.location_time
    ?? row.ts
    ?? row.lastSeen
    ?? row.lastseen
    ?? row.firstSeen
    ?? row.firstseen
    ?? (kind === 'mist-location' ? row.timestamp : undefined),
  );
}

export function normalizeSpectraInfrastructureProviderPayload(
  kind: SpectraInfrastructureProviderKind,
  providerId: string,
  payload: unknown,
): SpectraInfrastructureNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  if (!wrapped.providerId) throw new Error('Infrastructure provider ID is required.');

  const measurements = candidateRows(kind, payload)
    .slice(0, 2000)
    .flatMap(raw => {
      const row = record(raw);
      const observedAt = observedAtForRow(kind, row);
      const coordinates = resolveCoordinates(kind, row, wrapped.providerId);
      if (!observedAt || !coordinates) return [];

      const ids = identifiersForRow(kind, row, wrapped.providerId);
      const binding = resolveSpectraInfrastructureBinding(ids);
      const source = kind === 'unifi-client-location'
        ? 'wifi_fingerprint'
        : 'wifi_fingerprint';

      return [{
        kind: 'position',
        source,
        timestamp: observedAt,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy: coordinates.accuracy,
        confidence: confidenceForAccuracy(
          coordinates.accuracy,
          coordinates.coordinateSource === 'floorplan' ? 0.88 : 0.92,
        ),
        provider: wrapped.providerId,
        recordId: text(
          row.recordId
          ?? row.event_id
          ?? row.eventId
          ?? row.id
          ?? row.client_id
          ?? row.device_id,
          300,
        ),
        correlationGroup: binding.correlationGroup,
        metadata: {
          ...spectraInfrastructureIdentityMetadata(ids),
          providerKind: kind,
          coordinateSource: coordinates.coordinateSource,
          associated: typeof row.associated === 'boolean' ? row.associated : undefined,
          connected: typeof row.connected === 'boolean' ? row.connected : undefined,
          floorplanX: finite(row.x ?? row.location?.x),
          floorplanY: finite(row.y ?? row.location?.y),
          reportingAccessPoints: list(
            row.reporting_ap_serial
            || row.reportingAps
            || row.accessPoints
            || row.aps
          ).slice(0, 64),
        },
      }];
    });

  if (!measurements.length) {
    throw new Error('Infrastructure payload contains no usable location observations.');
  }

  const firstBinding = (() => {
    const first = record(candidateRows(kind, payload)[0]);
    return resolveSpectraInfrastructureBinding(
      identifiersForRow(kind, first, wrapped.providerId),
    );
  })();

  return {
    sessionId: firstBinding.sessionId || wrapped.sessionId,
    subjectLabel: firstBinding.subjectLabel || wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: kind,
      normalizedAt: new Date().toISOString(),
      observationCount: measurements.length,
    },
  };
}

export const SPECTRA_INFRASTRUCTURE_PROVIDER_KINDS: readonly SpectraInfrastructureProviderKind[] = [
  'mist-location',
  'extreme-location',
  'unifi-client-location',
  'aruba-location-json',
  'generic-infrastructure-location',
] as const;
