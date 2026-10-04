import { resolveConfiguredSpectraAnchor } from './SpectraAnchorRegistry';
import { resolveSpectraInfrastructureBinding } from './SpectraInfrastructureIdentity';

export type SpectraOpenSourceBridgeKind =
  | 'owntracks-location'
  | 'chirpstack-location'
  | 'find3-location'
  | 'espresense-observation'
  | 'kismet-device-location'
  | 'openwisp-wifi-session'
  | 'traccar-position';

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
    const features = list(outer.features);
    if (
      String(outer.type || '').toLowerCase() === 'featurecollection'
      && features.length
    ) return features;
    return [outer];
  })();

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const sourceRow = record(raw);
    const geometry = record(sourceRow.geometry);
    const properties = record(sourceRow.properties);
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
    const row = String(sourceRow.type || '').toLowerCase() === 'feature'
      ? {
          ...properties,
          _spectraGeoJsonFeature: true,
          latitude: coordinates[1],
          longitude: coordinates[0],
          altitude: coordinates[2],
        }
      : sourceRow;

    if (row._type && row._type !== 'location') return [];
    const latitude = bounded(row.lat ?? row.latitude, -90, 90);
    const longitude = bounded(row.lon ?? row.lng ?? row.longitude, -180, 180);
    const timestamp = isoTimestamp(
      row.tst
      ?? row.timestamp
      ?? row.fixTime
      ?? row.time
      ?? row.created_at
      ?? row.createdAt,
    );
    if (latitude === null || longitude === null || !timestamp) return [];

    const accuracy = finite(row.acc ?? row.accuracy);
    const altitude = finite(row.alt ?? row.altitude);
    const verticalAccuracy = finite(row.vac ?? row.verticalAccuracy);
    const speedKmh = finite(row.vel ?? row.velocity);
    const course = bounded(row.cog ?? row.course ?? row.heading, 0, 360);
    const mqttTopic = text(
      row._spectraMqttTopic
      ?? wrapped.outer._spectraMqttTopic,
      500,
    );
    const topicParts = mqttTopic
      ? mqttTopic.split('/').map(part => part.trim()).filter(Boolean)
      : [];
    const topicDeviceId = topicParts.length >= 3
      && topicParts[0].toLowerCase() === 'owntracks'
      ? text(topicParts[topicParts.length - 1], 120)
      : undefined;
    const trackerId = text(
      row.device
      ?? row.deviceId
      ?? topicDeviceId
      ?? row.tid,
      120,
    );
    const displayTrackerId = text(row.tid, 40);
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
        ownTracksDisplayTrackerId: displayTrackerId,
        ownTracksMqttTopic: mqttTopic,
        ownTracksBattery: finite(row.batt) ?? undefined,
        ownTracksTrigger: text(row.t, 40),
        ownTracksAddress: text(row.addr, 500),
        ownTracksGeoJsonFeature: row._spectraGeoJsonFeature === true
          ? true
          : undefined,
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

  const directLatitude = bounded(
    gps.lat ?? gps.latitude ?? data.lat ?? outer.lat,
    -90,
    90,
  );
  const directLongitude = bounded(
    gps.lon ?? gps.lng ?? gps.longitude ?? data.lon ?? data.lng ?? outer.lon,
    -180,
    180,
  );

  const find3LocationLabel = text(
    data.loc
    ?? data.location
    ?? bestGuess.location
    ?? sensors.l,
    300,
  );
  const calibratedAnchor = (
    directLatitude === null || directLongitude === null
  ) && find3LocationLabel
    ? resolveConfiguredSpectraAnchor({
        id: find3LocationLabel,
        anchorId: find3LocationLabel,
        locatorId: find3LocationLabel,
      })
    : null;

  const latitude = directLatitude ?? calibratedAnchor?.latitude ?? null;
  const longitude = directLongitude ?? calibratedAnchor?.longitude ?? null;
  if (latitude === null || longitude === null) {
    throw new Error(
      'FIND3 payload contains neither coordinates nor a configured location-label anchor.',
    );
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
  const locationLabel = find3LocationLabel;

  const measurement = {
    kind: 'position',
    source: 'wifi_fingerprint',
    timestamp,
    latitude,
    longitude,
    accuracy:
      calibratedAnchor?.accuracyMeters !== undefined
        ? Math.max(0.25, calibratedAnchor.accuracyMeters)
        : undefined,
    confidence: calibratedAnchor
      ? Math.min(0.9, probability)
      : probability,
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
      find3CoordinateSource: calibratedAnchor
        ? 'configured-location-label-anchor'
        : 'provider-coordinate',
      find3AnchorId: calibratedAnchor?.id,
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

function kismetLocationCandidate(value: unknown): {
  latitude: number;
  longitude: number;
  altitude?: number;
} | null {
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = bounded(value[0], -180, 180);
    const latitude = bounded(value[1], -90, 90);
    const altitude = finite(value[2]);
    return latitude !== null && longitude !== null
      ? {
          latitude,
          longitude,
          altitude: altitude ?? undefined,
        }
      : null;
  }

  const source = record(value);
  const geopoint =
    source['kismet.common.location.geopoint']
    ?? source.geopoint;
  if (Array.isArray(geopoint)) {
    const resolved = kismetLocationCandidate(geopoint);
    if (resolved) {
      const altitude = finite(
        source['kismet.common.location.alt']
        ?? source.alt,
      );
      return {
        ...resolved,
        altitude: altitude ?? resolved.altitude,
      };
    }
  }

  for (const key of [
    'kismet.common.location.last_loc',
    'kismet.common.location.avg_loc',
    'kismet.common.location.last',
    'kismet.common.location.min_loc',
    'kismet.common.location.max_loc',
    'last_loc',
    'avg_loc',
    'last',
  ]) {
    if (source[key] !== undefined) {
      const resolved = kismetLocationCandidate(source[key]);
      if (resolved) return resolved;
    }
  }

  const latitude = bounded(source.lat ?? source.latitude, -90, 90);
  const longitude = bounded(source.lon ?? source.lng ?? source.longitude, -180, 180);
  const altitude = finite(source.alt ?? source.altitude);
  return latitude !== null && longitude !== null
    ? { latitude, longitude, altitude: altitude ?? undefined }
    : null;
}

function normalizeKismet(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const outer = wrapped.outer;
  const rows = list(outer.devices).length
    ? list(outer.devices)
    : list(outer.data).length
      ? list(outer.data)
      : Array.isArray(payload)
        ? payload as any[]
        : [outer];

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    const base = record(row['kismet.device.base'] ?? row.base);
    const locationCandidates = [
      row['kismet.common.location'],
      row['kismet.device.base.location'],
      base['kismet.device.base.location'],
      base['kismet.common.location'],
      row.location,
      row,
    ];
    let location: ReturnType<typeof kismetLocationCandidate> = null;
    for (const candidate of locationCandidates) {
      location = kismetLocationCandidate(candidate);
      if (location) break;
    }
    if (!location) return [];

    const lastSeen = finite(
      row.last_time
      ?? row['kismet.device.base.last_time']
      ?? base.last_time
      ?? base['kismet.device.base.last_time'],
    );
    const timestamp =
      lastSeen !== null && lastSeen > 0
        ? isoTimestamp(lastSeen)
        : isoTimestamp(
            row.timestamp
            ?? row.time
            ?? row.lastSeen
            ?? Date.now(),
          );
    if (!timestamp) return [];

    const mac = text(
      row.mac
      ?? row.macaddr
      ?? row['kismet.device.base.macaddr']
      ?? base.macaddr
      ?? base['kismet.device.base.macaddr'],
      64,
    );
    const phy = text(
      row.phy
      ?? row.phyname
      ?? row['kismet.device.base.phyname']
      ?? base.phyname
      ?? base['kismet.device.base.phyname'],
      80,
    );
    const signal = finite(
      row.signal
      ?? row.last_signal
      ?? row['kismet.device.base.signal.last_signal']
      ?? base.last_signal,
    );
    const source =
      String(phy || '').toUpperCase().includes('BLUETOOTH')
        ? 'bluetooth_proximity'
        : 'wifi_fingerprint';

    return [{
      kind: 'position',
      source,
      timestamp,
      latitude: location.latitude,
      longitude: location.longitude,
      altitude: location.altitude,
      accuracy: finite(row.accuracy ?? row.ce) ?? 35,
      confidence: confidenceForAccuracy(
        finite(row.accuracy ?? row.ce) ?? 35,
        0.86,
      ),
      provider: wrapped.providerId,
      recordId: text(
        row.uid
        ?? row.key
        ?? row['kismet.device.base.key']
        ?? base.key
        ?? base['kismet.device.base.key']
        ?? mac,
        300,
      ),
      correlationGroup:
        `kismet:${wrapped.providerId}:${mac || text(row.uid, 120) || 'device'}`,
      metadata: {
        acquisitionMethod: 'kismet-device-location',
        kismetMac: mac,
        kismetPhy: phy,
        kismetSignalDbm: signal ?? undefined,
        kismetChannel: text(
          row.channel
          ?? row['kismet.device.base.channel']
          ?? base.channel,
          80,
        ),
        kismetFrequency: finite(
          row.freq
          ?? row.frequency
          ?? row['kismet.device.base.frequency']
          ?? base.frequency,
        ) ?? undefined,
        kismetName: text(
          row.name
          ?? row['kismet.device.base.name']
          ?? base.name,
          300,
        ),
      },
    }];
  });

  if (!measurements.length) {
    throw new Error('Kismet payload contains no usable geolocated device observations.');
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'kismet-device-location',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeOpenWisp(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const outer = wrapped.outer;
  const rows = list(outer.results).length
    ? list(outer.results)
    : list(outer.sessions).length
      ? list(outer.sessions)
      : list(outer.data).length
        ? list(outer.data)
        : Array.isArray(payload)
          ? payload as any[]
          : [outer];

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    const client = record(row.client ?? row.wifi_client);
    const device = text(
      row.device
      ?? row.device_name
      ?? row.deviceName,
      200,
    );
    const interfaceName = text(
      row.interface_name
      ?? row.interfaceName
      ?? row.interface,
      200,
    );
    const anchor = resolveConfiguredSpectraAnchor({
      id: device,
      anchorId: device,
      deviceId: device,
      locatorId: interfaceName,
      aliases: [device, interfaceName].filter(Boolean),
    });
    if (!anchor) return [];

    const timestamp = isoTimestamp(
      row.modified
      ?? row.stop_time
      ?? row.stopTime
      ?? row.start_time
      ?? row.startTime,
    );
    if (!timestamp) return [];

    const clientMac = text(
      client.mac_address
      ?? client.macAddress
      ?? row.mac_address
      ?? row.macAddress,
      64,
    );
    const coverageMeters = Math.max(
      20,
      Math.min(
        500,
        finite(
          row.coverage_meters
          ?? row.coverageMeters
          ?? anchor.metadata?.coverageMeters,
        ) ?? anchor.accuracyMeters ?? 60,
      ),
    );

    return [{
      kind: 'position',
      source: 'wifi_fingerprint',
      timestamp,
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      altitude: anchor.altitude,
      accuracy: coverageMeters,
      confidence: Math.max(
        0.35,
        Math.min(0.72, confidenceForAccuracy(coverageMeters, 0.72)),
      ),
      provider: wrapped.providerId,
      recordId: text(row.id, 300),
      correlationGroup:
        `openwisp:${wrapped.providerId}:${clientMac || 'client'}`,
      metadata: {
        acquisitionMethod: 'openwisp-wifi-session',
        infrastructureAssociation: true,
        openWispDevice: device,
        openWispInterface: interfaceName,
        openWispSsid: text(row.ssid, 200),
        openWispClientMac: clientMac,
        openWispClientVendor: text(client.vendor, 200),
        openWispOrganization: text(row.organization, 200),
        sessionStart: text(row.start_time ?? row.startTime, 80),
        sessionStop: text(row.stop_time ?? row.stopTime, 80),
      },
    }];
  });

  if (!measurements.length) {
    throw new Error(
      'OpenWISP payload contains no Wi-Fi session tied to a configured infrastructure anchor.',
    );
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'openwisp-wifi-session',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeTraccar(
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  const wrapped = envelope(payload, providerId);
  const outer = wrapped.outer;
  const rows = list(outer.positions).length
    ? list(outer.positions)
    : list(outer.data).length
      ? list(outer.data)
      : Array.isArray(payload)
        ? payload as any[]
        : [outer];

  const measurements = rows.slice(0, 2_000).flatMap(raw => {
    const row = record(raw);
    const latitude = bounded(row.latitude ?? row.lat, -90, 90);
    const longitude = bounded(
      row.longitude ?? row.lon ?? row.lng,
      -180,
      180,
    );
    const timestamp = isoTimestamp(
      row.fixTime
      ?? row.fix_time
      ?? row.deviceTime
      ?? row.device_time
      ?? row.serverTime
      ?? row.server_time
      ?? row.timestamp,
    );
    if (latitude === null || longitude === null || !timestamp) return [];

    const accuracy = finite(
      row.accuracy
      ?? row.attributes?.accuracy
      ?? row.attributes?.hdop,
    );
    const altitude = finite(row.altitude ?? row.alt);
    const course = bounded(row.course ?? row.heading, 0, 360);
    const deviceId = text(
      row.deviceId
      ?? row.device_id
      ?? row.uniqueId
      ?? row.unique_id,
      200,
    );
    const positionId = text(row.id ?? row.positionId ?? row.position_id, 300);
    const valid = typeof row.valid === 'boolean' ? row.valid : true;

    return [{
      kind: 'position',
      source: 'device_gps',
      timestamp,
      latitude,
      longitude,
      altitude: altitude ?? undefined,
      accuracy:
        accuracy !== null && accuracy > 0
          ? Math.min(5_000_000, accuracy)
          : undefined,
      heading: course ?? undefined,
      confidence: valid
        ? confidenceForAccuracy(
            accuracy !== null && accuracy > 0 ? accuracy : 20,
            0.96,
          )
        : 0.35,
      provider: wrapped.providerId,
      recordId: positionId,
      correlationGroup:
        `traccar:${wrapped.providerId}:${deviceId || 'device'}`,
      metadata: {
        acquisitionMethod: 'traccar-position',
        traccarDeviceId: deviceId,
        traccarProtocol: text(row.protocol, 100),
        traccarValid: valid,
        traccarOutdated:
          typeof row.outdated === 'boolean'
            ? row.outdated
            : undefined,
        traccarNetwork: row.network && typeof row.network === 'object'
          ? row.network
          : undefined,
        traccarAttributes: row.attributes && typeof row.attributes === 'object'
          ? row.attributes
          : undefined,
      },
    }];
  });

  if (!measurements.length) {
    throw new Error('Traccar payload contains no usable position observations.');
  }

  return {
    sessionId: wrapped.sessionId,
    subjectLabel: wrapped.subjectLabel,
    sourceId: wrapped.providerId,
    measurements,
    metadata: {
      normalization: 'traccar-position',
      observationCount: measurements.length,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function applyConfiguredBridgeIdentity(
  providerId: string,
  batch: SpectraOpenSourceBridgeBatch,
): SpectraOpenSourceBridgeBatch {
  const first = record(batch.measurements[0]);
  const metadata = record(first.metadata);

  const binding = resolveSpectraInfrastructureBinding({
    providerId,
    macAddress: text(
      metadata.kismetMac
      ?? metadata.openWispClientMac,
      64,
    ),
    clientId: text(
      metadata.ownTracksTrackerId
      ?? metadata.find3Device,
      200,
    ),
    deviceId: text(
      metadata.chirpStackDeviceId
      ?? metadata.espresenseDeviceId
      ?? metadata.traccarDeviceId
      ?? metadata.find3Device,
      200,
    ),
    username: text(
      metadata.ownTracksTrackerId,
      200,
    ),
  });

  return {
    ...batch,
    sessionId: binding.sessionId || batch.sessionId,
    subjectLabel: binding.subjectLabel || batch.subjectLabel,
    metadata: {
      ...batch.metadata,
      configuredIdentityMatch: Boolean(binding.sessionId || binding.subjectLabel),
      configuredIdentityIdentifiers: binding.identifiers,
    },
  };
}

export function normalizeSpectraOpenSourceBridgePayload(
  kind: SpectraOpenSourceBridgeKind,
  providerId: string,
  payload: unknown,
): SpectraOpenSourceBridgeBatch {
  if (!providerId.trim()) throw new Error('Open-source bridge provider ID is required.');

  let batch: SpectraOpenSourceBridgeBatch;
  switch (kind) {
    case 'owntracks-location':
      batch = normalizeOwnTracks(providerId, payload);
      break;
    case 'chirpstack-location':
      batch = normalizeChirpStack(providerId, payload);
      break;
    case 'find3-location':
      batch = normalizeFind3(providerId, payload);
      break;
    case 'espresense-observation':
      batch = normalizeEspresense(providerId, payload);
      break;
    case 'kismet-device-location':
      batch = normalizeKismet(providerId, payload);
      break;
    case 'openwisp-wifi-session':
      batch = normalizeOpenWisp(providerId, payload);
      break;
    case 'traccar-position':
      batch = normalizeTraccar(providerId, payload);
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported open-source bridge normalizer: ${String(exhaustive)}`);
    }
  }

  return applyConfiguredBridgeIdentity(providerId, batch);
}

export const SPECTRA_OPEN_SOURCE_BRIDGE_KINDS:
  readonly SpectraOpenSourceBridgeKind[] = [
    'owntracks-location',
    'chirpstack-location',
    'find3-location',
    'espresense-observation',
    'kismet-device-location',
    'openwisp-wifi-session',
    'traccar-position',
  ] as const;
