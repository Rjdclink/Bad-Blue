import { resolveConfiguredSpectraAnchor } from './SpectraAnchorRegistry';

export type SpectraOpenSourceBridgeKind =
  | 'owntracks-location'
  | 'chirpstack-location'
  | 'find3-location'
  | 'espresense-observation';

export interface SpectraOpenSourceBridgeBatch {
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
  if (
    value === null || value === undefined || value === ''
    || typeof value === 'boolean'
  ) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function text(value: unknown, maxLength = 300): string | undefined {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function isoTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value)
        : value;
  const normalized =
    typeof parsed === 'number' && parsed > 0 && parsed < 100_000_000_000
      ? parsed * 1000
      : parsed;
  const date = new Date(normalized as any);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.UTC(2000, 0, 1) || ms > Date.now() + 24 * 60 * 60_000) return null;
  return date.toISOString();
}

function confidenceForAccuracy(accuracyMeters: number, ceiling = 0.96): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0.55;
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.25, Math.min(ceiling, normalized));
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

function normalizeOwnTracks(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const rows = (() => {
    const outer = wrapped.outer;
    const locations = list(outer.locations);
    if (locations.length) return locations;
    const data = list(outer.data);
    if (data.length) return data;
    return [outer];
  })();

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    if (row._type && row._type !== 'location') return [];
    const latitude = bounded(row.lat ?? row.latitude, -90, 90);
    const longitude = bounded(row.lon ?? row.lng ?? row.longitude, -180, 180);
    const timestamp = isoTimestamp(row.tst ?? row.timestamp ?? row.fixTime);
    if (latitude === null || longitude === null || !timestamp) return [];

    const accuracy = finite(row.acc ?? row.accuracy);
    const altitude = finite(row.alt ?? row.altitude);
    const verticalAccuracy = finite(row.vac ?? row.verticalAccuracy);
    const speedKmh = finite(row.vel ?? row.velocity);
    const course = bounded(row.cog ?? row.course ?? row.heading, 0, 360);
    const trackerId = text(row.tid ?? row.device ?? row.deviceId, 120);
    const recordId = text(row._id ?? row.id ?? row.isotst ?? row.tst, 300);

    return [{
      kind: 'position',
      source: 'device_gps',
      timestamp,
      latitude,
      longitude,
      altitude: altitude ?? undefined,
      accuracy: accuracy !== null && accuracy > 0 ? accuracy : undefined,
      verticalAccuracy:
        verticalAccuracy !== null && verticalAccuracy >= 0
          ? verticalAccuracy
          : undefined,
      speed:
        speedKmh !== null && speedKmh >= 0
          ? speedKmh / 3.6
          : undefined,
      heading: course ?? undefined,
      confidence: confidenceForAccuracy(
        accuracy !== null && accuracy > 0 ? accuracy : 25,
        0.97,
      ),
      provider: wrapped.providerId,
      recordId,
      correlationGroup:
        `owntracks:${wrapped.providerId}:${trackerId || 'device'}`,
      metadata: {
        acquisitionMethod: 'owntracks-location',
        ownTracksTrackerId: trackerId,
        ownTracksBattery: finite(row.batt) ?? undefined,
        ownTracksTrigger: text(row.t, 40),
        ownTracksAddress: text(row.addr, 500),
      },
    }];
  });

  if (!measurements.length) {
    throw new Error('OwnTracks payload contains no usable timestamped location observations.');
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'owntracks-location',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeChirpStack(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const rows = (() => {
    const outer = wrapped.outer;
    const events = list(outer.events);
    if (events.length) return events;
    const data = list(outer.data);
    if (data.length) return data;
    return [outer];
  })();

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    const location = record(row.location);
    const deviceInfo = record(row.deviceInfo ?? row.device_info);
    const latitude = bounded(
      location.latitude ?? row.latitude ?? row.lat,
      -90,
      90,
    );
    const longitude = bounded(
      location.longitude ?? row.longitude ?? row.lon ?? row.lng,
      -180,
      180,
    );
    const timestamp = isoTimestamp(
      row.time
      ?? row.timestamp
      ?? row.receivedAt
      ?? row.received_at,
    );
    if (latitude === null || longitude === null || !timestamp) return [];

    const altitude = finite(location.altitude ?? row.altitude);
    const accuracy = finite(location.accuracy ?? row.accuracy);
    const deviceId = text(
      deviceInfo.devEui
      ?? deviceInfo.dev_eui
      ?? deviceInfo.deviceName
      ?? deviceInfo.device_name
      ?? row.devEui
      ?? row.dev_eui,
      200,
    );
    const deduplicationId = text(
      row.deduplicationId ?? row.deduplication_id ?? row.id,
      300,
    );
    const locationSource = text(
      location.source ?? row.locationSource ?? row.location_source,
      80,
    );

    return [{
      kind: 'position',
      source: 'device_gps',
      timestamp,
      latitude,
      longitude,
      altitude: altitude ?? undefined,
      accuracy: accuracy !== null && accuracy > 0 ? accuracy : undefined,
      confidence: confidenceForAccuracy(
        accuracy !== null && accuracy > 0 ? accuracy : 50,
        0.92,
      ),
      provider: wrapped.providerId,
      recordId: deduplicationId,
      correlationGroup:
        `chirpstack:${wrapped.providerId}:${deviceId || 'device'}`,
      metadata: {
        acquisitionMethod: 'chirpstack-location-event',
        chirpStackDeviceId: deviceId,
        chirpStackLocationSource: locationSource,
        chirpStackTenantId: text(
          deviceInfo.tenantId ?? deviceInfo.tenant_id,
          200,
        ),
        chirpStackApplicationId: text(
          deviceInfo.applicationId ?? deviceInfo.application_id,
          200,
        ),
      },
    }];
  });

  if (!measurements.length) {
    throw new Error('ChirpStack payload contains no usable LocationEvent observations.');
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'chirpstack-location',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeFind3(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const outer = wrapped.outer;
  const data = record(outer.data);
  const sensors = record(outer.sensors);
  const gps = record(data.gps ?? sensors.gps ?? outer.gps);
  const analysis = record(outer.analysis);
  const guesses = list(analysis.guesses);
  const bestGuess = record(guesses[0]);

  const latitude = bounded(
    gps.lat ?? gps.latitude ?? data.lat ?? outer.lat,
    -90,
    90,
  );
  const longitude = bounded(
    gps.lon ?? gps.lng ?? gps.longitude ?? data.lon ?? data.lng ?? outer.lon,
    -180,
    180,
  );
  if (latitude === null || longitude === null) {
    throw new Error('FIND3 payload contains no GPS-calibrated location.');
  }

  const sensorTimestamp = finite(sensors.t ?? outer.t);
  const seenSeconds = finite(data.seen ?? outer.seen);
  const timestamp =
    sensorTimestamp !== null
      ? isoTimestamp(sensorTimestamp)
      : seenSeconds !== null && seenSeconds >= 0
        ? new Date(Date.now() - seenSeconds * 1000).toISOString()
        : isoTimestamp(outer.timestamp ?? outer.time);
  if (!timestamp) {
    throw new Error('FIND3 payload contains no usable observation time.');
  }

  const probabilityRaw = finite(
    data.prob
    ?? data.probability
    ?? bestGuess.probability
    ?? outer.probability,
  );
  const probability = probabilityRaw !== null
    ? Math.max(0.05, Math.min(1, probabilityRaw))
    : 0.55;
  const device = text(
    sensors.d
    ?? sensors.device
    ?? data.device
    ?? outer.device,
    200,
  );
  const family = text(
    sensors.f
    ?? sensors.family
    ?? data.family
    ?? outer.family,
    200,
  );
  const locationLabel = text(
    data.loc
    ?? data.location
    ?? bestGuess.location
    ?? sensors.l,
    300,
  );

  const measurement = {
    kind: 'position',
    source: 'wifi_fingerprint',
    timestamp,
    latitude,
    longitude,
    confidence: probability,
    provider: wrapped.providerId,
    recordId: text(
      outer.id
      ?? `${family || 'family'}:${device || 'device'}:${sensorTimestamp || timestamp}`,
      300,
    ),
    correlationGroup:
      `find3:${wrapped.providerId}:${family || 'family'}:${device || 'device'}`,
    metadata: {
      acquisitionMethod: 'find3-fingerprint-classification',
      find3Family: family,
      find3Device: device,
      find3LocationLabel: locationLabel,
      find3Probability: probability,
      find3SeenSeconds: seenSeconds ?? undefined,
      calibratedIndoorLocation: true,
    },
  };

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements: [measurement],
    metadata: {
      normalization: 'find3-location',
      observationCount: 1,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeEspresense(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const outer = wrapped.outer;
  const rows = list(outer.events).length
    ? list(outer.events)
    : list(outer.data).length
      ? list(outer.data)
      : [outer];

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    const room = text(
      row.room
      ?? row.roomId
      ?? row.room_id
      ?? row.node
      ?? row.nodeId
      ?? row.node_id,
      200,
    );
    const anchor = resolveConfiguredSpectraAnchor({
      id: room,
      anchorId: room,
      deviceId: room,
      locatorId: room,
      macAddress: row.scannerMac ?? row.scanner_mac,
    });
    if (!anchor) return [];

    const timestamp = isoTimestamp(
      row.timestamp
      ?? row.time
      ?? row.tst
      ?? row.lastSeen
      ?? row.last_seen
      ?? Date.now(),
    );
    if (!timestamp) return [];

    const distance = finite(
      row.distance
      ?? row.distanceMeters
      ?? row.distance_m
      ?? row.dist,
    );
    const rssi = bounded(row.rssi ?? row.rssiDbm ?? row.rssi_dbm, -127, 0);
    const txPower = bounded(
      row.txPower
      ?? row.tx_power
      ?? row.measuredPower
      ?? row.measured_power,
      -127,
      0,
    );
    if (
      (distance === null || distance < 0)
      && (rssi === null || txPower === null)
    ) return [];

    const deviceId = text(
      row.id
      ?? row.device
      ?? row.deviceId
      ?? row.device_id
      ?? row.mac
      ?? row.macAddress,
      200,
    );

    return [{
      kind: 'ranging',
      source: 'ble_rssi',
      timestamp,
      provider: wrapped.providerId,
      correlationGroup:
        `espresense:${wrapped.providerId}:${deviceId || 'device'}`,
      anchors: [{
        id: anchor.id,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        distanceMeters:
          distance !== null && distance >= 0
            ? Math.min(1_000_000, distance)
            : undefined,
        rssiDbm: rssi ?? undefined,
        txPowerAtOneMeterDbm: txPower ?? undefined,
        uncertaintyMeters: anchor.accuracyMeters
          ? Math.max(0.25, anchor.accuracyMeters)
          : undefined,
      }],
      metadata: {
        acquisitionMethod: 'espresense-ble-ranging',
        espresenseRoom: room,
        espresenseDeviceId: deviceId,
        espresenseVariance: finite(row.var ?? row.variance) ?? undefined,
        espresenseVisible:
          typeof row.vis === 'boolean'
            ? row.vis
            : typeof row.visible === 'boolean'
              ? row.visible
              : undefined,
      },
    }];
  });

  if (!measurements.length) {
    throw new Error(
      'ESPresense payload contains no usable observation with a configured scanner anchor.',
    );
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'espresense-observation',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

export function normalizeSpectraOpenSourceBridgePayload(
  kind: SpectraOpenSourceBridgeKind,
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  if (!providerId.trim()) throw new Error('Open-source bridge provider ID is required.');

  switch (kind) {
    case 'owntracks-location':
      return normalizeOwnTracks(providerId, payload);
    case 'chirpstack-location':
      return normalizeChirpStack(providerId, payload);
    case 'find3-location':
      return normalizeFind3(providerId, payload);
    case 'espresense-observation':
      return normalizeEspresense(providerId, payload);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported open-source bridge normalizer: ${String(exhaustive)}`);
    }
  }
}

export const SPECTRA_OPEN_SOURCE_BRIDGE_KINDS:
  readonly SpectraOpenSourceBridgeKind[] = [
    'owntracks-location',
    'chirpstack-location',
    'find3-location',
    'espresense-observation',
  ] as const;
