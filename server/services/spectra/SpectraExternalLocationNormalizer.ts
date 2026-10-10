export const SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS = [
  'camara-location-verification',
  'camara-reachability',
  'camara-number-verification',
  'camara-device-identifier',
  'camara-kyc-match',
  'android-managed-lost-mode',
  'apple-managed-lost-mode',
  'meraki-scanning',
  'cisco-spaces-location',
  'aws-iot-device-location',
  'arcore-geospatial-pose',
  'connected-vehicle-location',
] as const;

export type SpectraExternalLocationNormalizerKind =
  typeof SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS[number];

export interface SpectraExternalNormalizedBatch {
  sessionId?: string;
  subjectLabel?: string;
  sourceId: string;
  measurements: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export class SpectraExternalLocationNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpectraExternalLocationNormalizationError';
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

function bounded(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function text(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const normalized =
    typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : value;
  const epochAware =
    typeof normalized === 'number'
    && Math.abs(normalized) < 100_000_000_000
      ? normalized * 1000
      : normalized;
  const date = new Date(epochAware as any);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.UTC(1900, 0, 1) || ms > Date.now() + 24 * 60 * 60_000) return null;
  return date.toISOString();
}

function envelope(payload: unknown, providerId: string) {
  const outer = record(payload);
  return {
    outer,
    body:
      (outer.data && typeof outer.data === 'object' ? record(outer.data) : null)
      || (outer.payload && typeof outer.payload === 'object' ? record(outer.payload) : null)
      || outer,
    sessionId: text(outer.sessionId, 200),
    subjectLabel: text(outer.subjectLabel, 500),
    providerId: providerId.trim().slice(0, 200),
  };
}

function confidenceForAccuracy(accuracyMeters: number, ceiling: number): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return Math.min(0.5, ceiling);
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 6;
  return Math.max(0.2, Math.min(ceiling, normalized));
}

function pointMeasurement(args: {
  source: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number | null;
  verticalAccuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  provider: string;
  recordId?: string;
  correlationGroup: string;
  confidenceCeiling: number;
  metadata: Record<string, unknown>;
}) {
  const accuracy =
    args.accuracy !== null
    && args.accuracy !== undefined
    && args.accuracy > 0
      ? Math.min(5_000_000, args.accuracy)
      : undefined;

  return {
    kind: 'position',
    source: args.source,
    timestamp: args.timestamp,
    latitude: args.latitude,
    longitude: args.longitude,
    altitude:
      args.altitude !== null && args.altitude !== undefined
        ? args.altitude
        : undefined,
    accuracy,
    verticalAccuracy:
      args.verticalAccuracy !== null
      && args.verticalAccuracy !== undefined
      && args.verticalAccuracy >= 0
        ? args.verticalAccuracy
        : undefined,
    speed:
      args.speed !== null && args.speed !== undefined && args.speed >= 0
        ? args.speed
        : undefined,
    heading:
      args.heading !== null
      && args.heading !== undefined
      && args.heading >= 0
      && args.heading <= 360
        ? args.heading
        : undefined,
    confidence: confidenceForAccuracy(accuracy ?? 250, args.confidenceCeiling),
    provider: args.provider,
    recordId: args.recordId,
    correlationGroup: args.correlationGroup,
    metadata: args.metadata,
  };
}

function contextMeasurement(
  source: string,
  observedAt: string,
  provider: string,
  values: Record<string, number | null | undefined>,
  metadata: Record<string, unknown>,
) {
  return {
    kind: 'sensor',
    source,
    timestamp: observedAt,
    provider,
    values: Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, number] =>
        Number.isFinite(entry[1])
      ),
    ),
    metadata,
  };
}

function batch(
  kind: SpectraExternalLocationNormalizerKind,
  providerId: string,
  wrapped: ReturnType<typeof envelope>,
  measurements: Array<Record<string, unknown>>,
): SpectraExternalNormalizedBatch {
  if (!measurements.length) {
    throw new SpectraExternalLocationNormalizationError(
      `${kind} payload contains no usable observations.`,
    );
  }
  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: providerId,
    measurements,
    metadata: {
      normalization: kind,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeCamaraLocationVerification(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const observedAt = timestamp(
    body.lastLocationTime
    || body.lastStatusTime
    || body.timestamp
    || body.observedAt
  ) || new Date().toISOString();
  const resultRaw = body.verificationResult ?? body.verified ?? body.result;
  const normalizedResult =
    typeof resultRaw === 'boolean'
      ? resultRaw
      : /^(?:true|verified|match|yes)$/i.test(String(resultRaw || ''));

  return batch(
    'camara-location-verification',
    wrapped.providerId,
    wrapped,
    [contextMeasurement(
      'location_verification',
      observedAt,
      wrapped.providerId,
      {
        verified: normalizedResult ? 1 : 0,
      },
      {
        providerKind: 'camara-location-verification',
        verificationResult: resultRaw,
        matchRate: finite(body.matchRate),
        deviceIdentifierReturned: Boolean(body.device && typeof body.device === 'object'),
      },
    )],
  );
}

function normalizeCamaraReachability(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const observedAt = timestamp(
    body.lastStatusTime || body.timestamp || body.observedAt
  ) || new Date().toISOString();
  const status = String(
    body.reachabilityStatus || body.status || body.deviceStatus || ''
  ).trim().toUpperCase();

  return batch(
    'camara-reachability',
    wrapped.providerId,
    wrapped,
    [contextMeasurement(
      'network_reachability',
      observedAt,
      wrapped.providerId,
      {
        connected:
          status === 'CONNECTED_DATA' || status === 'CONNECTED_SMS'
            ? 1
            : status === 'NOT_CONNECTED'
              ? 0
              : undefined,
      },
      {
        providerKind: 'camara-reachability',
        reachabilityStatus: status || undefined,
        deviceIdentifierReturned: Boolean(body.device && typeof body.device === 'object'),
      },
    )],
  );
}

function normalizeCamaraNumberVerification(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const observedAt = timestamp(
    body.timestamp || body.observedAt || body.verifiedAt
  ) || new Date().toISOString();
  const resultRaw =
    body.devicePhoneNumberVerified
    ?? body.numberVerified
    ?? body.verified
    ?? body.match;
  const verified =
    typeof resultRaw === 'boolean'
      ? resultRaw
      : /^(?:true|verified|match|yes)$/i.test(String(resultRaw || ''));

  return batch(
    'camara-number-verification',
    wrapped.providerId,
    wrapped,
    [contextMeasurement(
      'identity_binding',
      observedAt,
      wrapped.providerId,
      {
        verified: verified ? 1 : 0,
      },
      {
        providerKind: 'camara-number-verification',
        verificationResult: resultRaw,
        phoneNumber:
          text(body.phoneNumber || body.devicePhoneNumber, 40),
        bindingType: 'network-number-possession',
      },
    )],
  );
}

function normalizeCamaraDeviceIdentifier(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const observedAt = timestamp(
    body.timestamp || body.observedAt || body.retrievedAt
  ) || new Date().toISOString();
  const identifier = record(body.deviceIdentifier || body.identifier || body);
  const imei = text(
    identifier.imei || body.imei,
    32,
  );
  const imeiSv = text(
    identifier.imeiSv || identifier.imeisv || body.imeiSv,
    32,
  );
  const tac = text(
    identifier.tac || body.tac || imei?.slice(0, 8),
    16,
  );

  return batch(
    'camara-device-identifier',
    wrapped.providerId,
    wrapped,
    [contextMeasurement(
      'identity_binding',
      observedAt,
      wrapped.providerId,
      {
        identifierPresent: imei || imeiSv || tac ? 1 : 0,
      },
      {
        providerKind: 'camara-device-identifier',
        imei,
        imeiSv,
        tac,
        manufacturer: text(
          identifier.manufacturer || body.manufacturer,
          120,
        ),
        model: text(identifier.model || body.model, 160),
        bindingType: 'network-subscriber-device',
      },
    )],
  );
}

function normalizeCamaraKycMatch(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const observedAt = timestamp(
    body.timestamp || body.observedAt || body.matchedAt
  ) || new Date().toISOString();

  const matchValues = Object.entries(body)
    .filter(([key, value]) =>
      /match|score|verified/i.test(key)
      && (typeof value === 'boolean' || Number.isFinite(Number(value)))
    );
  let aggregateScore: number | null = null;
  const numericScores = matchValues.flatMap(([, value]) => {
    if (typeof value === 'boolean') return [value ? 1 : 0];
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return [];
    return [numeric > 1 ? numeric / 100 : numeric];
  }).map(value => Math.max(0, Math.min(1, value)));
  if (numericScores.length) {
    aggregateScore =
      numericScores.reduce((sum, value) => sum + value, 0)
      / numericScores.length;
  }

  return batch(
    'camara-kyc-match',
    wrapped.providerId,
    wrapped,
    [contextMeasurement(
      'identity_binding',
      observedAt,
      wrapped.providerId,
      {
        matchScore: aggregateScore,
      },
      {
        providerKind: 'camara-kyc-match',
        bindingType: 'operator-kyc-match',
        matchFields: Object.fromEntries(matchValues),
      },
    )],
  );
}

function normalizeAndroidManagedLostMode(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const events = list(
    wrapped.body.usageLogEvents
    || wrapped.body.events
    || wrapped.body.locationEvents
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawEvent of events.slice(0, 2000)) {
    const event = record(rawEvent);
    const lostMode = record(
      event.lostModeLocationEvent
      || event.locationEvent
      || event.location
    );
    const location = record(lostMode.location || lostMode);
    const latitude = bounded(location.latitude ?? location.lat, -90, 90);
    const longitude = bounded(
      location.longitude ?? location.lng ?? location.lon,
      -180,
      180,
    );
    const observedAt = timestamp(
      event.eventTime
      || event.timestamp
      || event.createTime
      || wrapped.body.retrievalTime
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    measurements.push(pointMeasurement({
      source: 'device_gps',
      timestamp: observedAt,
      latitude,
      longitude,
      accuracy: finite(location.accuracy ?? location.horizontalAccuracy),
      provider: wrapped.providerId,
      recordId: text(event.eventId || event.id, 300),
      correlationGroup: `android-managed-lost-mode:${wrapped.providerId}`,
      confidenceCeiling: 0.9,
      metadata: {
        providerKind: 'android-managed-lost-mode',
        device: text(wrapped.body.device || wrapped.outer.device, 300),
        batteryLevel: finite(
          lostMode.batteryLevel ?? event.batteryLevel
        ),
      },
    }));
  }

  return batch(
    'android-managed-lost-mode',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeAppleManagedLostMode(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const items = list(
    wrapped.body.responses || wrapped.body.locations || wrapped.body.events
  );
  const responses = items.length ? items : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawResponse of responses.slice(0, 1000)) {
    const response = record(rawResponse);
    const latitude = bounded(
      response.Latitude ?? response.latitude,
      -90,
      90,
    );
    const longitude = bounded(
      response.Longitude ?? response.longitude,
      -180,
      180,
    );
    const observedAt = timestamp(
      response.Timestamp ?? response.timestamp ?? response.observedAt
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    measurements.push(pointMeasurement({
      source: 'device_gps',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: finite(response.Altitude ?? response.altitude),
      accuracy: finite(
        response.HorizontalAccuracy
        ?? response.horizontalAccuracy
        ?? response.accuracy
      ),
      verticalAccuracy: finite(
        response.VerticalAccuracy ?? response.verticalAccuracy
      ),
      speed: finite(response.Speed ?? response.speed),
      heading: finite(response.Course ?? response.course ?? response.heading),
      provider: wrapped.providerId,
      recordId: text(
        response.CommandUUID
        || response.commandUUID
        || response.UDID
        || response.udid,
        300,
      ),
      correlationGroup: `apple-managed-lost-mode:${wrapped.providerId}`,
      confidenceCeiling: 0.94,
      metadata: {
        providerKind: 'apple-managed-lost-mode',
        status: text(response.Status ?? response.status, 80),
        deviceRef: text(response.UDID ?? response.udid, 300),
      },
    }));
  }

  return batch(
    'apple-managed-lost-mode',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeMerakiScanning(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const root = wrapped.outer;
  const data = record(root.data || wrapped.body);
  const type = String(root.type || data.type || '').trim().toUpperCase();
  const source =
    type === 'BLE'
      ? 'bluetooth_proximity'
      : 'wifi_fingerprint';
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawObservation of list(data.observations).slice(0, 4000)) {
    const observation = record(rawObservation);
    const observationId = text(
      observation.clientMac
      || observation.deviceId
      || observation.clientId
      || observation.id,
      300,
    );

    for (const rawLocation of list(observation.locations).slice(0, 100)) {
      const location = record(rawLocation);
      const latitude = bounded(location.lat ?? location.latitude, -90, 90);
      const longitude = bounded(
        location.lng ?? location.lon ?? location.longitude,
        -180,
        180,
      );
      const observedAt = timestamp(
        location.time
        || location.timestamp
        || location.observedAt
        || observation.seenTime
      );
      if (latitude === null || longitude === null || !observedAt) continue;

      const variance = finite(location.variance);
      const accuracy = finite(
        location.accuracy
        ?? location.uncertainty
        ?? (variance !== null && variance >= 0 ? Math.sqrt(variance) : undefined)
      );

      measurements.push(pointMeasurement({
        source,
        timestamp: observedAt,
        latitude,
        longitude,
        accuracy,
        provider: wrapped.providerId,
        recordId: observationId,
        correlationGroup:
          `meraki-scanning:${wrapped.providerId}:${observationId || 'client'}`,
        confidenceCeiling: type === 'BLE' ? 0.88 : 0.9,
        metadata: {
          providerKind: 'meraki-scanning',
          observationType: type || undefined,
          networkId: text(data.networkId, 200),
          floorPlanId: text(location.floorPlanId, 200),
          floorPlanName: text(location.floorPlanName, 200),
          x: finite(location.x),
          y: finite(location.y),
          variance,
          rssiRecords: list(location.rssiRecords).slice(0, 64),
        },
      }));
    }
  }

  return batch(
    'meraki-scanning',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeCiscoSpaces(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const events = list(
    wrapped.body.events
    || wrapped.body.data
    || wrapped.body.messages
    || wrapped.body.results
  );
  const inputs = events.length ? events : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawEvent of inputs.slice(0, 4000)) {
    const event = record(rawEvent);
    const eventType = String(
      event.eventType || event.type || event.eventName || ''
    ).trim().toUpperCase();
    if (eventType && eventType !== 'DEVICE_LOCATION_UPDATE') continue;

    const location = record(
      event.location || event.position || event.data || event
    );
    const coordinates = Array.isArray(location.coordinates)
      ? location.coordinates
      : Array.isArray(event.coordinates)
        ? event.coordinates
        : Array.isArray(event.rawCoordinates)
          ? event.rawCoordinates
          : [];
    // Cisco Spaces API `coordinates` and `rawCoordinates` are
    // Cartesian floor-plan X/Y, *not* WGS84 latitude/longitude. A valid
    // campus/floor anchor must be georeferenced upstream before it can be
    // admitted into the geographic subject-position pipeline.
    const latitude = bounded(location.latitude ?? location.lat, -90, 90);
    const longitude = bounded(
      location.longitude ?? location.lng ?? location.lon,
      -180,
      180,
    );
    const observedAt = timestamp(
      event.timestamp
      || event.observedAt
      || event.eventTime
      || event.lastLocationAt
      || event.changedOn
      || location.timestamp
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    const deviceRef = text(
      event.deviceId
      || event.deviceIdentifier
      || event.clientId
      || event.macAddress,
      300,
    );

    measurements.push(pointMeasurement({
      source: 'wifi_fingerprint',
      timestamp: observedAt,
      latitude,
      longitude,
      // Cisco confidenceFactor is not a radius in metres. Use only an
      // explicitly specified geographic uncertainty; otherwise retain a
      // conservative one-kilometre estimate.
      accuracy: finite(
        location.accuracyMeters
        ?? location.horizontalAccuracyMeters
        ?? location.accuracy
        ?? event.accuracyMeters
        ?? event.accuracy
      ) ?? 1_000,
      provider: wrapped.providerId,
      recordId: text(event.eventId || event.id, 300),
      correlationGroup:
        `cisco-spaces:${wrapped.providerId}:${deviceRef || 'device'}`,
      confidenceCeiling: 0.92,
      metadata: {
        providerKind: 'cisco-spaces-location',
        eventType: eventType || 'ACTIVE_CLIENT_LOCATION',
        deviceRef,
        mapId: text(location.mapId || event.mapId || event.floorId, 200),
        locationId: text(
          location.locationId || event.locationId || event.buildingId,
          200,
        ),
        campusId: text(event.campusId, 200),
        buildingId: text(event.buildingId, 200),
        floorId: text(event.floorId, 200),
        computeType: text(event.computeType, 80),
        detectingAccessPointCount: finite(event.numDetectingAps),
        maxDetectedRssi: finite(record(event.maxDetectedRssi).rssi),
        coordinateSystem: 'wgs84-explicit',
        confidenceFactor: finite(event.confidenceFactor),
        // Informational floor-relative numbers never become geodesic fixes.
        xPos: finite(location.xPos ?? location.x ?? coordinates[0]),
        yPos: finite(location.yPos ?? location.y ?? coordinates[1]),
      },
    }));
  }

  return batch(
    'cisco-spaces-location',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeAwsIotDeviceLocation(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const items = list(
    wrapped.body.positions || wrapped.body.locations || wrapped.body.results
  );
  const inputs = items.length ? items : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawItem of inputs.slice(0, 2000)) {
    const item = record(rawItem);
    const coordinates = Array.isArray(item.coordinates)
      ? item.coordinates
      : Array.isArray(item.geometry?.coordinates)
        ? item.geometry.coordinates
        : [];
    const longitude = bounded(coordinates[0], -180, 180);
    const latitude = bounded(coordinates[1], -90, 90);
    const altitude = finite(coordinates[2]);
    const properties = record(item.properties || item.geometry?.properties);
    const observedAt = timestamp(
      properties.timestamp || item.timestamp || item.observedAt
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    const measurementType = String(
      properties.measurementType || item.measurementType || ''
    ).trim().toUpperCase();
    const source =
      measurementType === 'GNSS'
        ? 'gnss_fix'
        : measurementType === 'WI-FI' || measurementType === 'WIFI'
          ? 'wifi_fingerprint'
          : measurementType === 'BLE'
            ? 'bluetooth_proximity'
            : measurementType === 'CELLULAR'
              ? 'cellular'
              : 'network_region';

    measurements.push(pointMeasurement({
      source,
      timestamp: observedAt,
      latitude,
      longitude,
      altitude,
      accuracy: finite(
        properties.horizontalAccuracy
        ?? properties.accuracy
        ?? item.accuracy
      ),
      verticalAccuracy: finite(properties.verticalAccuracy),
      provider: wrapped.providerId,
      recordId: text(
        item.WirelessDeviceId
        || item.wirelessDeviceId
        || item.deviceId,
        300,
      ),
      correlationGroup:
        `aws-iot-location:${wrapped.providerId}:${text(item.WirelessDeviceId || item.deviceId, 120) || 'device'}`,
      confidenceCeiling: measurementType === 'GNSS' ? 0.96 : 0.9,
      metadata: {
        providerKind: 'aws-iot-device-location',
        measurementType: measurementType || undefined,
        geoJsonType: text(item.type, 40),
      },
    }));
  }

  return batch(
    'aws-iot-device-location',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeArcoreGeospatialPose(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const items = list(
    wrapped.body.poses
    || wrapped.body.results
    || wrapped.body.measurements
    || wrapped.body.updates
  );
  const inputs = items.length ? items : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawItem of inputs.slice(0, 2000)) {
    const item = record(rawItem);
    const pose = record(
      item.geospatialPose
      || item.pose
      || item.position
      || item
    );
    const latitude = bounded(
      pose.latitude ?? pose.lat,
      -90,
      90,
    );
    const longitude = bounded(
      pose.longitude ?? pose.lng ?? pose.lon,
      -180,
      180,
    );
    const observedAt = timestamp(
      item.timestamp
      || item.observedAt
      || item.elapsedRealtimeTimestamp
      || pose.timestamp
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    const deviceRef = text(
      item.deviceRef
      || item.deviceId
      || wrapped.body.deviceRef
      || wrapped.body.deviceId,
      300,
    );
    const horizontalAccuracy = finite(
      pose.horizontalAccuracy
      ?? pose.horizontalAccuracyMeters
      ?? pose.accuracy
    );
    const verticalAccuracy = finite(
      pose.verticalAccuracy
      ?? pose.verticalAccuracyMeters
    );
    const trackingState = text(
      item.trackingState
      || pose.trackingState
      || wrapped.body.trackingState,
      80,
    );
    const vpsAvailability = text(
      item.vpsAvailability
      || pose.vpsAvailability
      || wrapped.body.vpsAvailability,
      80,
    );
    const vpsUsed =
      item.vpsUsed === true
      || pose.vpsUsed === true
      || /available|localized|tracking/i.test(String(vpsAvailability || ''));

    measurements.push(pointMeasurement({
      source: 'visual_positioning',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: finite(
        pose.altitude
        ?? pose.altitudeMeters
      ),
      accuracy: horizontalAccuracy,
      verticalAccuracy,
      heading: finite(
        pose.heading
        ?? pose.headingDegrees
        ?? pose.orientationYawDegrees
      ),
      provider: wrapped.providerId,
      recordId: text(
        item.recordId
        || item.poseId
        || item.frameId,
        300,
      ),
      correlationGroup:
        `visual-positioning:${wrapped.providerId}:${deviceRef || 'device'}`,
      confidenceCeiling: vpsUsed ? 0.98 : 0.92,
      metadata: {
        providerKind: 'arcore-geospatial-pose',
        engine: 'arcore-geospatial-vps',
        deviceRef,
        correlationDomain: deviceRef,
        vpsAvailability,
        vpsUsed,
        trackingState,
        orientationYawAccuracyDegrees: finite(
          pose.orientationYawAccuracy
          ?? pose.orientationYawAccuracyDegrees
          ?? pose.headingAccuracy
        ),
        accuracyConfidenceLevel: 0.68,
        horizontalAccuracySemantics: 'radial-68-percent',
      },
    }));
  }

  return batch(
    'arcore-geospatial-pose',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

function normalizeConnectedVehicleLocation(
  payload: unknown,
  providerId: string,
): SpectraExternalNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const items = list(
    wrapped.body.locations
    || wrapped.body.events
    || wrapped.body.telemetry
    || wrapped.body.measurements
  );
  const inputs = items.length ? items : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const rawItem of inputs.slice(0, 4000)) {
    const item = record(rawItem);
    const location = record(
      item.location
      || item.Location
      || item.drive_state
      || item.position
      || item
    );
    const latitude = bounded(
      location.latitude ?? location.lat,
      -90,
      90,
    );
    const longitude = bounded(
      location.longitude ?? location.lng ?? location.lon,
      -180,
      180,
    );
    const observedAt = timestamp(
      item.timestamp
      || item.observedAt
      || item.time
      || location.timestamp
      || location.gps_as_of
    );
    if (latitude === null || longitude === null || !observedAt) continue;

    const vehicleRef = text(
      item.vehicleId
      || item.vin
      || wrapped.body.vehicleId
      || wrapped.body.vin,
      300,
    );

    measurements.push(pointMeasurement({
      source: 'vehicle_telemetry',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: finite(location.altitude),
      accuracy: finite(
        location.accuracy
        ?? location.horizontalAccuracy
        ?? item.accuracy
      ),
      speed: finite(
        location.speed
        ?? item.speed
        ?? item.vehicleSpeed
      ),
      heading: finite(
        location.heading
        ?? location.gps_heading
        ?? item.heading
      ),
      provider: wrapped.providerId,
      recordId: text(item.recordId || item.eventId, 300),
      correlationGroup:
        `vehicle-location:${wrapped.providerId}:${vehicleRef || 'vehicle'}`,
      confidenceCeiling: 0.96,
      metadata: {
        providerKind: 'connected-vehicle-location',
        vehicleRef,
        gpsState: item.gpsState || item.GpsState,
      },
    }));
  }

  return batch(
    'connected-vehicle-location',
    wrapped.providerId,
    wrapped,
    measurements,
  );
}

export function normalizeSpectraExternalLocationPayload(
  kind: SpectraExternalLocationNormalizerKind,
  providerId: string,
  payload: unknown,
): SpectraExternalNormalizedBatch {
  const normalizedProviderId = providerId.trim().slice(0, 200);
  if (!normalizedProviderId) {
    throw new SpectraExternalLocationNormalizationError('Provider ID is required.');
  }

  switch (kind) {
    case 'camara-location-verification':
      return normalizeCamaraLocationVerification(payload, normalizedProviderId);
    case 'camara-reachability':
      return normalizeCamaraReachability(payload, normalizedProviderId);
    case 'camara-number-verification':
      return normalizeCamaraNumberVerification(payload, normalizedProviderId);
    case 'camara-device-identifier':
      return normalizeCamaraDeviceIdentifier(payload, normalizedProviderId);
    case 'camara-kyc-match':
      return normalizeCamaraKycMatch(payload, normalizedProviderId);
    case 'android-managed-lost-mode':
      return normalizeAndroidManagedLostMode(payload, normalizedProviderId);
    case 'apple-managed-lost-mode':
      return normalizeAppleManagedLostMode(payload, normalizedProviderId);
    case 'meraki-scanning':
      return normalizeMerakiScanning(payload, normalizedProviderId);
    case 'cisco-spaces-location':
      return normalizeCiscoSpaces(payload, normalizedProviderId);
    case 'aws-iot-device-location':
      return normalizeAwsIotDeviceLocation(payload, normalizedProviderId);
    case 'arcore-geospatial-pose':
      return normalizeArcoreGeospatialPose(payload, normalizedProviderId);
    case 'connected-vehicle-location':
      return normalizeConnectedVehicleLocation(payload, normalizedProviderId);
    default:
      throw new SpectraExternalLocationNormalizationError(
        'Unsupported external SPECTRA location normalizer.',
      );
  }
}
