import { parse as parseCsv } from 'csv-parse/sync';
import { assessSpectraGnssIntegrity } from './SpectraGnssIntegrity';

export const SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS = [
  'bluetooth-channel-sounding',
  'ble-direction-finding',
  'android-wifi-ranging',
  'android-ranging-manager',
  'android-uwb-sensor-fusion',
  'nr-positioning',
  'android-cellular',
  'android-raw-gnss',
  'gnss-precision-solution',
  'apple-nearby-interaction',
  'android-radio-collector',
  'ble-gateway',
  'lorawan-observation',
  'universal-radio-log',
] as const;

export type SpectraAdvancedRadioNormalizerKind =
  typeof SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS[number];

export interface SpectraAdvancedNormalizedBatch {
  sessionId?: string;
  subjectLabel?: string;
  sourceId: string;
  measurements: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export class SpectraAdvancedRadioNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpectraAdvancedRadioNormalizationError';
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function stringValue(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function timestampValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const normalizedValue =
    typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : value;
  const epochAware =
    typeof normalizedValue === 'number'
    && Math.abs(normalizedValue) < 100_000_000_000
      ? normalizedValue * 1000
      : normalizedValue;
  const date = new Date(epochAware as any);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  if (time < Date.UTC(1900, 0, 1) || time > Date.now() + 24 * 60 * 60_000) return null;
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
    sessionId: stringValue(outer.sessionId, 200),
    subjectLabel: stringValue(outer.subjectLabel, 500),
    providerId: providerId.trim().slice(0, 200),
  };
}

function contextMeasurement(
  source: string,
  timestamp: string,
  providerId: string,
  values: Record<string, number | null | undefined>,
  metadata: Record<string, unknown>,
) {
  return {
    kind: 'sensor',
    source,
    timestamp,
    provider: providerId,
    values: Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, number] =>
        Number.isFinite(entry[1])
      ),
    ),
    metadata,
  };
}

function weightedDistance(
  candidates: Array<{ distance: number | null; uncertainty: number | null; method: string }>,
): { distance: number; uncertainty: number; methods: string[] } | null {
  const usable = candidates.filter(candidate =>
    candidate.distance !== null
    && Number.isFinite(candidate.distance)
    && Number(candidate.distance) >= 0
  ) as Array<{ distance: number; uncertainty: number | null; method: string }>;
  if (!usable.length) return null;

  let weighted = 0;
  let total = 0;
  for (const candidate of usable) {
    const uncertainty =
      candidate.uncertainty !== null
      && Number.isFinite(candidate.uncertainty)
      && candidate.uncertainty > 0
        ? candidate.uncertainty
        : Math.max(0.25, candidate.distance * 0.08);
    const weight = 1 / Math.max(0.0625, uncertainty ** 2);
    weighted += candidate.distance * weight;
    total += weight;
  }

  if (total <= 0) return null;
  return {
    distance: weighted / total,
    uncertainty: Math.sqrt(1 / total),
    methods: usable.map(candidate => candidate.method),
  };
}

function anchorCoordinates(value: unknown) {
  const source = record(value);
  const latitude = bounded(
    source.latitude ?? source.lat ?? source.anchorLatitude ?? source.scannerLatitude,
    -90,
    90,
  );
  const longitude = bounded(
    source.longitude ?? source.lon ?? source.lng ?? source.anchorLongitude ?? source.scannerLongitude,
    -180,
    180,
  );
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function normalizerBatch(
  providerId: string,
  normalization: SpectraAdvancedRadioNormalizerKind,
  sessionId: string | undefined,
  subjectLabel: string | undefined,
  measurements: Array<Record<string, unknown>>,
): SpectraAdvancedNormalizedBatch {
  if (!measurements.length) {
    throw new SpectraAdvancedRadioNormalizationError(
      `${normalization} payload contains no usable telemetry measurements.`,
    );
  }
  return {
    sessionId,
    subjectLabel,
    sourceId: providerId,
    measurements,
    metadata: {
      normalization,
      normalizedAt: new Date().toISOString(),
    },
  };
}

function normalizeBluetoothChannelSounding(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const observations = list(
    wrapped.body.observations
    || wrapped.body.measurements
    || wrapped.body.results
    || wrapped.body.samples,
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of observations.slice(0, 2000)) {
    const observation = record(raw);
    const timestamp = timestampValue(
      observation.timestamp || observation.observedAt || observation.capturedAt,
    );
    if (!timestamp) continue;

    const pbr = record(observation.pbr);
    const rtt = record(observation.rtt);
    const fused = weightedDistance([
      {
        distance: finite(
          observation.pbrDistanceMeters
          ?? pbr.distanceMeters
          ?? pbr.distance
        ),
        uncertainty: finite(
          observation.pbrUncertaintyMeters
          ?? pbr.uncertaintyMeters
          ?? pbr.standardDeviationMeters
        ),
        method: 'pbr',
      },
      {
        distance: finite(
          observation.rttDistanceMeters
          ?? rtt.distanceMeters
          ?? rtt.distance
        ),
        uncertainty: finite(
          observation.rttUncertaintyMeters
          ?? rtt.uncertaintyMeters
          ?? rtt.standardDeviationMeters
        ),
        method: 'rtt',
      },
      {
        distance: finite(observation.distanceMeters),
        uncertainty: finite(observation.uncertaintyMeters),
        method: 'provider-fused',
      },
    ]);
    if (!fused) continue;

    const anchor = anchorCoordinates(observation.anchor || observation.scanner || observation);
    const metadata = {
      providerKind: 'bluetooth-channel-sounding',
      technology: 'bluetooth-6-channel-sounding',
      methods: fused.methods,
      pbrDistanceMeters: finite(observation.pbrDistanceMeters ?? pbr.distanceMeters ?? pbr.distance),
      rttDistanceMeters: finite(observation.rttDistanceMeters ?? rtt.distanceMeters ?? rtt.distance),
      pbrUncertaintyMeters: finite(
        observation.pbrUncertaintyMeters ?? pbr.uncertaintyMeters ?? pbr.standardDeviationMeters
      ),
      rttUncertaintyMeters: finite(
        observation.rttUncertaintyMeters ?? rtt.uncertaintyMeters ?? rtt.standardDeviationMeters
      ),
      channelCount: finite(observation.channelCount ?? pbr.channelCount),
      normalizedAttackDetectorMetric: finite(
        observation.normalizedAttackDetectorMetric ?? observation.nadm
      ),
      peerRef: stringValue(
        observation.peerRef || observation.peerId || observation.deviceRef,
        200,
      ),
    };

    if (anchor) {
      measurements.push({
        kind: 'ranging',
        source: 'bluetooth_channel_sounding',
        timestamp,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(observation.correlationGroup, 300)
          || `bluetooth-cs:${wrapped.providerId}:${metadata.peerRef || 'peer'}`,
        anchors: [{
          id: stringValue(
            record(observation.anchor).id
            || observation.anchorId
            || observation.scannerId,
            200,
          ),
          latitude: anchor.latitude,
          longitude: anchor.longitude,
          distanceMeters: Math.max(0.01, Math.min(1_000_000, fused.distance)),
          uncertaintyMeters: Math.max(0.01, Math.min(1_000_000, fused.uncertainty)),
        }],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        'bluetooth_channel_sounding',
        timestamp,
        wrapped.providerId,
        {
          fusedDistanceMeters: fused.distance,
          fusedUncertaintyMeters: fused.uncertainty,
          pbrDistanceMeters: finite(metadata.pbrDistanceMeters),
          rttDistanceMeters: finite(metadata.rttDistanceMeters),
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'bluetooth-channel-sounding',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeBleDirectionFinding(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const observations = list(
    wrapped.body.observations || wrapped.body.measurements || wrapped.body.results,
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of observations.slice(0, 2000)) {
    const observation = record(raw);
    const timestamp = timestampValue(
      observation.timestamp || observation.observedAt || observation.capturedAt,
    );
    if (!timestamp) continue;

    const methodRaw = String(observation.method || observation.directionMethod || 'aoa')
      .trim()
      .toLowerCase();
    const method = methodRaw === 'aod' ? 'aod' : 'aoa';
    const bearingDegrees = bounded(
      observation.bearingDegrees ?? observation.azimuthDegrees ?? observation.azimuth,
      0,
      360,
    );
    const elevationDegrees = bounded(
      observation.elevationDegrees ?? observation.elevation,
      -90,
      90,
    );
    const bearingUncertaintyDegrees = bounded(
      observation.bearingUncertaintyDegrees ?? observation.azimuthUncertaintyDegrees,
      0.01,
      180,
    );
    const bearingReferenceRaw = String(
      observation.bearingReference || observation.reference || 'device'
    ).toLowerCase();
    const bearingReference = ['true_north', 'magnetic_north', 'device'].includes(bearingReferenceRaw)
      ? bearingReferenceRaw
      : 'device';

    const anchor = anchorCoordinates(observation.anchor || observation.locator || observation);
    const distance = finite(observation.distanceMeters);
    const rssi = finite(observation.rssiDbm ?? observation.rssi);
    const txPower = finite(
      observation.txPowerAtOneMeterDbm ?? observation.txPower ?? observation.measuredPower
    );
    const metadata = {
      providerKind: 'ble-direction-finding',
      directionMethod: method,
      bearingDegrees,
      elevationDegrees,
      bearingReference,
      antennaArrayId: stringValue(observation.antennaArrayId || observation.arrayId, 200),
      antennaCount: finite(observation.antennaCount),
      iqSampleCount: Array.isArray(observation.iqSamples)
        ? observation.iqSamples.length
        : finite(observation.iqSampleCount),
      targetRef: stringValue(observation.targetRef || observation.beaconId, 200),
    };

    if (
      anchor
      && (
        distance !== null
        || (rssi !== null && txPower !== null)
      )
    ) {
      const rangedAnchor: Record<string, unknown> = {
        id: stringValue(
          record(observation.anchor).id
          || observation.locatorId
          || observation.anchorId,
          200,
        ),
        latitude: anchor.latitude,
        longitude: anchor.longitude,
      };
      if (distance !== null) rangedAnchor.distanceMeters = Math.max(0.01, distance);
      if (rssi !== null) rangedAnchor.rssiDbm = Math.max(-127, Math.min(0, rssi));
      if (txPower !== null) {
        rangedAnchor.txPowerAtOneMeterDbm = Math.max(-127, Math.min(0, txPower));
      }
      if (bearingDegrees !== null) rangedAnchor.bearingDegrees = bearingDegrees;
      if (bearingUncertaintyDegrees !== null) {
        rangedAnchor.bearingUncertaintyDegrees = bearingUncertaintyDegrees;
      }
      rangedAnchor.bearingReference = bearingReference;

      measurements.push({
        kind: 'ranging',
        source: method === 'aod' ? 'ble_aod' : 'ble_aoa',
        timestamp,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(observation.correlationGroup, 300)
          || `ble-direction:${wrapped.providerId}:${metadata.targetRef || 'target'}`,
        anchors: [rangedAnchor],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        'ble_direction_finding',
        timestamp,
        wrapped.providerId,
        {
          bearingDegrees,
          elevationDegrees,
          bearingUncertaintyDegrees,
          distanceMeters: distance,
          rssiDbm: rssi,
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'ble-direction-finding',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeAndroidWifiRanging(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const results = list(
    wrapped.body.results || wrapped.body.observations || wrapped.body.rangingResults
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of results.slice(0, 1000)) {
    const result = record(raw);
    const timestamp = timestampValue(
      result.timestamp || result.observedAt || wrapped.body.timestamp
    );
    if (!timestamp) continue;
    const responder = record(
      result.responderLocation || result.location || result.anchor || result.peerLocation
    );
    const anchor = anchorCoordinates(responder);
    const distanceMeters = finite(
      result.distanceMeters
      ?? (result.distanceMm !== undefined ? Number(result.distanceMm) / 1000 : undefined)
    );
    const distanceStdDevMeters = finite(
      result.distanceStdDevMeters
      ?? (result.distanceStdDevMm !== undefined ? Number(result.distanceStdDevMm) / 1000 : undefined)
    );
    const protocol =
      result.is80211azNtb === true
      || /802\.11az|11az|ntb/i.test(String(result.protocol || result.standard || ''))
        ? '802.11az-ntb'
        : '802.11mc-ftm';
    const metadata = {
      providerKind: 'android-wifi-ranging',
      protocol,
      wifiAwarePeer: Boolean(
        result.peerHandle || result.wifiAwarePeer || result.isWifiAwarePeer
      ),
      responderMac: stringValue(result.macAddress || result.bssid, 80),
      responderLocationSource: anchor ? 'responder-location' : undefined,
      minRangingIntervalMillis: finite(result.minRangingIntervalMillis),
      maxRangingIntervalMillis: finite(result.maxRangingIntervalMillis),
      rssiDbm: finite(result.rssiDbm ?? result.rssi),
      successfulMeasurements: finite(result.successfulMeasurements),
      attemptedMeasurements: finite(result.attemptedMeasurements),
      rangingTimestampMillis: finite(
        result.rangingTimestampMillis
        ?? result.elapsedRealtimeMillis
      ),
      rangingFrameProtected:
        typeof result.rangingFrameProtected === 'boolean'
          ? result.rangingFrameProtected
          : undefined,
      timestampUncertaintyMillis: finite(result.timestampUncertaintyMillis),
    };

    if (anchor && distanceMeters !== null && distanceMeters >= 0) {
      measurements.push({
        kind: 'ranging',
        source: 'wifi_rtt',
        timestamp,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(result.correlationGroup, 300)
          || `wifi-ranging:${wrapped.providerId}:${metadata.responderMac || 'responder'}`,
        anchors: [{
          id: metadata.responderMac,
          latitude: anchor.latitude,
          longitude: anchor.longitude,
          distanceMeters: Math.max(0.01, Math.min(1_000_000, distanceMeters)),
          uncertaintyMeters:
            distanceStdDevMeters !== null && distanceStdDevMeters > 0
              ? Math.min(1_000_000, distanceStdDevMeters)
              : Math.max(0.5, distanceMeters * 0.05),
        }],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        'wifi_rtt_context',
        timestamp,
        wrapped.providerId,
        {
          distanceMeters,
          distanceStdDevMeters,
          rssiDbm: finite(metadata.rssiDbm),
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'android-wifi-ranging',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeAndroidRangingManager(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const results = list(
    wrapped.body.results
    || wrapped.body.measurements
    || wrapped.body.rangingResults
    || wrapped.body.updates
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of results.slice(0, 2000)) {
    const result = record(raw);
    const observedAt = timestampValue(
      result.timestamp || result.observedAt || wrapped.body.timestamp
    );
    if (!observedAt) continue;

    const technologyRaw = String(
      result.technology || result.rangingTechnology || result.type || ''
    ).trim().toLowerCase();
    const technology =
      /uwb|ultra.?wide/.test(technologyRaw) ? 'uwb'
      : /channel.?sounding|bt.?cs|bluetooth.?cs/.test(technologyRaw) ? 'bluetooth-channel-sounding'
      : /wifi|nan|rtt/.test(technologyRaw) ? 'wifi-nan-rtt'
      : /ble|bluetooth.*rssi/.test(technologyRaw) ? 'ble-rssi'
      : null;
    if (!technology) continue;

    const peer = record(
      result.anchor
      || result.peerLocation
      || result.responderLocation
      || result.referenceLocation
    );
    const anchor = anchorCoordinates(peer);
    const distance = finite(
      result.distanceMeters
      ?? result.distance
      ?? (result.distanceMm !== undefined ? Number(result.distanceMm) / 1000 : undefined)
    );
    const uncertainty = finite(
      result.distanceUncertaintyMeters
      ?? result.distanceStdDevMeters
      ?? result.uncertaintyMeters
    );
    const bearingDegrees = bounded(
      result.bearingDegrees
      ?? result.azimuthDegrees
      ?? result.azimuth,
      0,
      360,
    );
    const bearingUncertaintyDegrees = bounded(
      result.bearingUncertaintyDegrees
      ?? result.azimuthUncertaintyDegrees,
      0.01,
      180,
    );
    const rssiDbm = finite(result.rssiDbm ?? result.rssi);
    const txPower = finite(
      result.txPowerAtOneMeterDbm ?? result.txPower ?? result.measuredPower
    );
    const peerRef = stringValue(
      result.peerRef || result.peerId || result.deviceRef || result.macAddress,
      200,
    );

    const source =
      technology === 'uwb'
        ? bearingDegrees !== null ? 'uwb_direction' : 'uwb_range'
        : technology === 'bluetooth-channel-sounding'
          ? 'bluetooth_channel_sounding'
          : technology === 'wifi-nan-rtt'
            ? 'wifi_rtt'
            : 'ble_rssi';

    const metadata = {
      providerKind: 'android-ranging-manager',
      technology,
      peerRef,
      distanceMeters: distance,
      bearingDegrees,
      elevationDegrees: finite(result.elevationDegrees ?? result.elevation),
      rssiDbm,
      measurementConfidence: finite(result.confidence ?? result.measurementConfidence),
    };

    if (
      anchor
      && (
        distance !== null
        || (rssiDbm !== null && txPower !== null)
      )
    ) {
      const rangedAnchor: Record<string, unknown> = {
        id: peerRef,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
      };
      if (distance !== null && distance >= 0) {
        rangedAnchor.distanceMeters = Math.max(0.01, Math.min(1_000_000, distance));
      }
      if (uncertainty !== null && uncertainty > 0) {
        rangedAnchor.uncertaintyMeters = Math.min(1_000_000, uncertainty);
      }
      if (rssiDbm !== null) rangedAnchor.rssiDbm = Math.max(-127, Math.min(0, rssiDbm));
      if (txPower !== null) {
        rangedAnchor.txPowerAtOneMeterDbm = Math.max(-127, Math.min(0, txPower));
      }
      if (bearingDegrees !== null) {
        rangedAnchor.bearingDegrees = bearingDegrees;
        const referenceRaw = String(result.bearingReference || 'device').toLowerCase();
        rangedAnchor.bearingReference = ['true_north', 'magnetic_north', 'device'].includes(referenceRaw)
          ? referenceRaw
          : 'device';
      }
      if (bearingUncertaintyDegrees !== null) {
        rangedAnchor.bearingUncertaintyDegrees = bearingUncertaintyDegrees;
      }

      measurements.push({
        kind: 'ranging',
        source,
        timestamp: observedAt,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(result.correlationGroup, 300)
          || `android-ranging:${wrapped.providerId}:${peerRef || 'peer'}`,
        anchors: [rangedAnchor],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        technology === 'uwb' ? 'uwb_context'
          : technology === 'wifi-nan-rtt' ? 'wifi_rtt_context'
          : technology === 'bluetooth-channel-sounding' ? 'bluetooth_channel_sounding'
          : 'ble_gateway',
        observedAt,
        wrapped.providerId,
        {
          distanceMeters: distance,
          uncertaintyMeters: uncertainty,
          bearingDegrees,
          rssiDbm,
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'android-ranging-manager',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeAndroidUwbSensorFusion(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const updates = list(
    wrapped.body.results
    || wrapped.body.estimates
    || wrapped.body.updates
    || wrapped.body.measurements
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of updates.slice(0, 2000)) {
    const update = record(raw);
    const observedAt = timestampValue(
      update.timestamp
      || update.observedAt
      || update.elapsedRealtimeTimestamp
      || update.wallClockTime
      || wrapped.body.timestamp
    );
    if (!observedAt) continue;

    const estimateTypeRaw = String(
      update.estimateType
      || update.resultType
      || update.type
      || ''
    ).trim().toLowerCase();
    const estimateType =
      /precise/.test(estimateTypeRaw) ? 'precise'
      : /imprecise/.test(estimateTypeRaw) ? 'imprecise'
      : /drifting/.test(estimateTypeRaw) ? 'drifting'
      : /fallback/.test(estimateTypeRaw) ? 'fallback'
      : 'range-only';

    const distanceMeters = finite(
      update.distanceMeters
      ?? record(update.distance).value
      ?? record(update.distance).valueMeters
    );
    const distanceUncertaintyMeters = finite(
      update.distanceUncertaintyMeters
      ?? record(update.distance).uncertainty
      ?? record(update.distance).uncertaintyMeters
    );
    const azimuthDegrees = bounded(
      update.azimuthDegrees
      ?? record(update.azimuth).value
      ?? record(update.azimuth).valueDegrees,
      -180,
      180,
    );
    const elevationDegrees = bounded(
      update.elevationDegrees
      ?? record(update.elevation).value
      ?? record(update.elevation).valueDegrees,
      -90,
      90,
    );

    const peer = record(
      update.anchor
      || update.peerLocation
      || update.referenceLocation
      || update.peerPosition
    );
    const anchor = anchorCoordinates(peer);
    const peerRef = stringValue(
      update.peerRef
      || update.peerId
      || update.deviceAddress
      || update.uwbDeviceId,
      200,
    );
    const stalenessThresholdMillis = finite(
      update.dataStalenessThresholdMillis
      ?? wrapped.body.dataStalenessThresholdMillis
    );
    const estimateAgeMillis = finite(
      update.estimateAgeMillis
      ?? update.ageMillis
      ?? 0
    );
    const estimateStale =
      stalenessThresholdMillis !== null
      && estimateAgeMillis !== null
      && estimateAgeMillis > stalenessThresholdMillis;

    const odometry = record(update.odometry || update.pose || update.localPose);
    const metadata = {
      providerKind: 'android-uwb-sensor-fusion',
      estimateType,
      peerRef,
      distanceMeters,
      distanceUncertaintyMeters,
      azimuthDegrees,
      elevationDegrees,
      dataStalenessThresholdMillis: stalenessThresholdMillis,
      estimateAgeMillis,
      estimateStale,
      odometryAvailable:
        estimateType === 'precise'
        || estimateType === 'drifting'
        || Object.keys(odometry).length > 0,
      rawRangeAvailable:
        estimateType === 'precise'
        || estimateType === 'imprecise'
        || estimateType === 'range-only',
      localOdometry: Object.keys(odometry).length ? odometry : undefined,
      elapsedRealtimeNanos: finite(update.elapsedRealtimeNanos),
      elapsedRealtimeUncertaintyNanos: finite(
        update.elapsedRealtimeUncertaintyNanos
      ),
      timestampUncertaintyMillis: finite(update.timestampUncertaintyMillis),
    };

    const solved = record(
      update.solution
      || update.position
      || update.absolutePosition
    );
    const latitude = bounded(
      solved.latitude ?? solved.lat,
      -90,
      90,
    );
    const longitude = bounded(
      solved.longitude ?? solved.lng ?? solved.lon,
      -180,
      180,
    );

    if (
      latitude !== null
      && longitude !== null
      && estimateType !== 'drifting'
      && !estimateStale
    ) {
      const accuracy = finite(
        solved.horizontalAccuracyMeters
        ?? solved.accuracyMeters
        ?? solved.accuracy
        ?? distanceUncertaintyMeters
      );
      measurements.push({
        kind: 'position',
        source: 'uwb_direction',
        timestamp: observedAt,
        latitude,
        longitude,
        altitude: finite(
          solved.altitudeMeters ?? solved.altitude
        ) ?? undefined,
        accuracy:
          accuracy !== null && accuracy > 0
            ? Math.min(5_000_000, accuracy)
            : undefined,
        confidence:
          estimateType === 'precise' ? 0.99
          : estimateType === 'imprecise' ? 0.88
          : 0.82,
        provider: wrapped.providerId,
        recordId: stringValue(
          update.recordId || update.measurementId,
          300,
        ),
        correlationGroup:
          stringValue(update.correlationGroup, 300)
          || `uwb-sensor-fusion:${wrapped.providerId}:${peerRef || 'peer'}`,
        metadata: {
          ...metadata,
          accuracyConfidenceLevel: bounded(
            solved.accuracyConfidenceLevel,
            0.2,
            0.9999,
          ) ?? 0.68,
          covariance: solved.covariance,
        },
      });
      continue;
    }

    if (
      anchor
      && distanceMeters !== null
      && distanceMeters >= 0
      && estimateType !== 'drifting'
      && !estimateStale
    ) {
      const rangedAnchor: Record<string, unknown> = {
        id: peerRef,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        distanceMeters: Math.max(
          0.01,
          Math.min(1_000_000, distanceMeters),
        ),
        uncertaintyMeters:
          distanceUncertaintyMeters !== null
          && distanceUncertaintyMeters > 0
            ? Math.min(1_000_000, distanceUncertaintyMeters)
            : estimateType === 'precise'
              ? Math.max(0.05, distanceMeters * 0.01)
              : Math.max(0.15, distanceMeters * 0.04),
      };

      if (azimuthDegrees !== null) {
        const normalizedBearing = (azimuthDegrees + 360) % 360;
        rangedAnchor.bearingDegrees = normalizedBearing;
        rangedAnchor.bearingReference = String(
          update.bearingReference || 'device'
        ).toLowerCase() === 'true_north'
          ? 'true_north'
          : 'device';
        const uncertaintyDegrees = bounded(
          update.azimuthUncertaintyDegrees
          ?? record(update.azimuth).uncertainty,
          0.01,
          180,
        );
        if (uncertaintyDegrees !== null) {
          rangedAnchor.bearingUncertaintyDegrees = uncertaintyDegrees;
        }
      }

      measurements.push({
        kind: 'ranging',
        source: azimuthDegrees !== null ? 'uwb_direction' : 'uwb_range',
        timestamp: observedAt,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(update.correlationGroup, 300)
          || `uwb-sensor-fusion:${wrapped.providerId}:${peerRef || 'peer'}`,
        anchors: [rangedAnchor],
        metadata,
      });
    } else {
      // Drifting/expired odometry-only estimates remain context and cannot
      // manufacture a live absolute position.
      measurements.push(contextMeasurement(
        'uwb_context',
        observedAt,
        wrapped.providerId,
        {
          distanceMeters,
          distanceUncertaintyMeters,
          azimuthDegrees,
          elevationDegrees,
          estimateAgeMillis,
          stalenessThresholdMillis,
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'android-uwb-sensor-fusion',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeNrPositioning(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const results = list(
    wrapped.body.results
    || wrapped.body.observations
    || wrapped.body.measurements
    || wrapped.body.positions
  );
  const inputs = results.length ? results : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of inputs.slice(0, 2000)) {
    const result = record(raw);
    const observedAt = timestampValue(
      result.timestamp
      || result.observedAt
      || result.measurementTime
      || result.positionTime
      || wrapped.body.timestamp
    );
    if (!observedAt) continue;

    const methodRaw = String(
      result.method
      || result.positioningMethod
      || result.type
      || ''
    ).trim().toLowerCase();
    const method =
      /dl.?tdoa|otdoa/.test(methodRaw) ? 'dl-tdoa'
      : /ul.?tdoa/.test(methodRaw) ? 'ul-tdoa'
      : /multi.?rtt|round.?trip|rtt/.test(methodRaw) ? 'multi-rtt'
      : /aoa|angle.?of.?arrival/.test(methodRaw) ? 'aoa'
      : /aod|angle.?of.?departure/.test(methodRaw) ? 'aod'
      : /prs|positioning.?reference/.test(methodRaw) ? 'prs'
      : /carrier.?phase/.test(methodRaw) ? 'carrier-phase'
      : 'nr-positioning';

    const solution = record(
      result.solution
      || result.position
      || result.location
      || result
    );
    const latitude = bounded(
      solution.latitude ?? solution.lat,
      -90,
      90,
    );
    const longitude = bounded(
      solution.longitude ?? solution.lng ?? solution.lon,
      -180,
      180,
    );
    const accuracy = finite(
      solution.horizontalAccuracyMeters
      ?? solution.accuracyMeters
      ?? solution.accuracy
    );
    const accuracyLevel = bounded(
      solution.accuracyConfidenceLevel
      ?? solution.confidenceLevel
      ?? (solution.confidencePercent !== undefined
        ? Number(solution.confidencePercent) / 100
        : undefined),
      0.2,
      0.9999,
    );

    const commonMetadata = {
      providerKind: 'nr-positioning',
      method,
      prsRsrpDbm: finite(result.prsRsrpDbm ?? result.prsRsrp),
      prsSinrDb: finite(result.prsSinrDb ?? result.prsSinr),
      referenceSignalTimeDifferenceNanos: finite(
        result.referenceSignalTimeDifferenceNanos
        ?? result.rstdNanos
        ?? result.rstd
      ),
      roundTripTimeNanos: finite(
        result.roundTripTimeNanos
        ?? result.rttNanos
      ),
      aoaAzimuthDegrees: bounded(
        result.aoaAzimuthDegrees ?? result.azimuthDegrees,
        0,
        360,
      ),
      aoaElevationDegrees: bounded(
        result.aoaElevationDegrees ?? result.elevationDegrees,
        -90,
        90,
      ),
      aodAzimuthDegrees: bounded(
        result.aodAzimuthDegrees,
        0,
        360,
      ),
      nlosProbability: bounded(
        result.nlosProbability
        ?? result.nonLineOfSightProbability,
        0,
        1,
      ),
      bandwidthHz: finite(
        result.bandwidthHz ?? result.prsBandwidthHz
      ),
      positioningFrequencyLayers: finite(
        result.positioningFrequencyLayers ?? result.pflCount
      ),
    };

    if (latitude !== null && longitude !== null) {
      measurements.push({
        kind: 'position',
        source: 'nr_positioning',
        timestamp: observedAt,
        latitude,
        longitude,
        altitude: finite(
          solution.altitudeMeters ?? solution.altitude
        ) ?? undefined,
        accuracy:
          accuracy !== null && accuracy > 0
            ? Math.min(5_000_000, accuracy)
            : undefined,
        confidence:
          bounded(solution.confidence, 0, 1)
          ?? (
            accuracy !== null && accuracy > 0
              ? Math.max(0.45, Math.min(0.98, 1 - Math.log10(Math.max(1, accuracy)) / 6))
              : 0.78
          ),
        provider: wrapped.providerId,
        recordId: stringValue(
          result.recordId || result.measurementId || result.solutionId,
          300,
        ),
        correlationGroup:
          stringValue(result.correlationGroup, 300)
          || `nr-positioning:${wrapped.providerId}`,
        metadata: {
          ...commonMetadata,
          accuracyConfidenceLevel: accuracyLevel ?? 0.68,
          horizontalProtectionLevelMeters: finite(
            solution.horizontalProtectionLevelMeters
            ?? solution.hpl
          ),
          covariance: result.covariance || solution.covariance,
        },
      });
      continue;
    }

    const anchors = list(
      result.anchors
      || result.trps
      || result.transmissionReceptionPoints
      || result.baseStations
    ).flatMap(rawAnchor => {
      const anchor = record(rawAnchor);
      const coordinates = anchorCoordinates(
        anchor.location || anchor.position || anchor
      );
      if (!coordinates) return [];

      const distanceMeters = finite(
        anchor.distanceMeters
        ?? anchor.rangeMeters
        ?? (
          anchor.roundTripTimeNanos !== undefined
            ? Number(anchor.roundTripTimeNanos) * 0.299792458 / 2
            : undefined
        )
      );
      const rssiDistance = finite(anchor.rssiDistanceMeters);
      const bearingDegrees = bounded(
        anchor.bearingDegrees
        ?? anchor.aoaAzimuthDegrees
        ?? anchor.aodAzimuthDegrees,
        0,
        360,
      );

      if (distanceMeters === null && rssiDistance === null) return [];

      const normalized: Record<string, unknown> = {
        id: stringValue(
          anchor.id || anchor.trpId || anchor.cellId,
          200,
        ),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        distanceMeters:
          distanceMeters !== null
            ? Math.max(0.01, Math.min(1_000_000, distanceMeters))
            : Math.max(0.01, Math.min(1_000_000, rssiDistance!)),
        uncertaintyMeters:
          finite(anchor.uncertaintyMeters ?? anchor.rangeStdDevMeters)
          ?? Math.max(0.5, Number(distanceMeters ?? rssiDistance) * 0.05),
      };

      if (bearingDegrees !== null) {
        normalized.bearingDegrees = bearingDegrees;
        normalized.bearingReference = String(
          anchor.bearingReference || 'true_north'
        ).toLowerCase() === 'true_north'
          ? 'true_north'
          : 'device';
        const bearingUncertainty = bounded(
          anchor.bearingUncertaintyDegrees
          ?? anchor.angleStdDevDegrees,
          0.01,
          180,
        );
        if (bearingUncertainty !== null) {
          normalized.bearingUncertaintyDegrees = bearingUncertainty;
        }
      }

      return [normalized];
    });

    if (anchors.length) {
      measurements.push({
        kind: 'ranging',
        source: 'nr_positioning',
        timestamp: observedAt,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(result.correlationGroup, 300)
          || `nr-positioning:${wrapped.providerId}`,
        anchors,
        metadata: {
          ...commonMetadata,
          anchorCount: anchors.length,
        },
      });
    } else {
      measurements.push(contextMeasurement(
        'cellular_signal',
        observedAt,
        wrapped.providerId,
        {
          prsRsrpDbm: finite(commonMetadata.prsRsrpDbm),
          prsSinrDb: finite(commonMetadata.prsSinrDb),
          rstdNanos: finite(commonMetadata.referenceSignalTimeDifferenceNanos),
          rttNanos: finite(commonMetadata.roundTripTimeNanos),
          nlosProbability: finite(commonMetadata.nlosProbability),
          bandwidthHz: finite(commonMetadata.bandwidthHz),
        },
        commonMetadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'nr-positioning',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function radioType(value: unknown): 'gsm' | 'cdma' | 'wcdma' | 'lte' | 'nr' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === '5g' || normalized === '5g-nr' || normalized === 'newradio') return 'nr';
  if (normalized === 'umts' || normalized === '3g') return 'wcdma';
  if (normalized === '4g') return 'lte';
  if (['gsm', 'cdma', 'wcdma', 'lte', 'nr'].includes(normalized)) {
    return normalized as 'gsm' | 'cdma' | 'wcdma' | 'lte' | 'nr';
  }
  return null;
}

function cellularSignal(recordValue: Record<string, any>) {
  const signal = record(recordValue.signal || recordValue.signalStrength || {});
  return {
    rssiDbm: finite(signal.rssiDbm ?? signal.rssi ?? recordValue.rssiDbm ?? recordValue.rssi),
    bitErrorRate: finite(signal.bitErrorRate ?? recordValue.bitErrorRate ?? recordValue.ber),
    timingAdvance: finite(
      signal.timingAdvance
      ?? signal.timingAdvanceRaw
      ?? recordValue.timingAdvance
      ?? recordValue.timingAdvanceRaw
      ?? recordValue.timingAdvanceMicros
    ),
    rsrpDbm: finite(signal.rsrpDbm ?? signal.rsrp ?? recordValue.rsrp),
    rsrqDb: finite(signal.rsrqDb ?? signal.rsrq ?? recordValue.rsrq),
    rssnrDb: finite(signal.rssnrDb ?? signal.rssnr ?? recordValue.rssnr),
    rscpDbm: finite(signal.rscpDbm ?? signal.rscp ?? recordValue.rscp),
    ecNoDb: finite(signal.ecNoDb ?? signal.ecNo ?? recordValue.ecNo),
    ssRsrpDbm: finite(signal.ssRsrpDbm ?? signal.ssRsrp ?? recordValue.ssRsrp),
    ssRsrqDb: finite(signal.ssRsrqDb ?? signal.ssRsrq ?? recordValue.ssRsrq),
    ssSinrDb: finite(signal.ssSinrDb ?? signal.ssSinr ?? recordValue.ssSinr),
    csiRsrpDbm: finite(signal.csiRsrpDbm ?? signal.csiRsrp ?? recordValue.csiRsrp),
    csiRsrqDb: finite(signal.csiRsrqDb ?? signal.csiRsrq ?? recordValue.csiRsrq),
    csiSinrDb: finite(signal.csiSinrDb ?? signal.csiSinr ?? recordValue.csiSinr),
    cqiTableIndex: finite(
      signal.cqiTableIndex ?? signal.csiCqiTableIndex ?? recordValue.csiCqiTableIndex
    ),
    cqi: finite(signal.cqi ?? recordValue.cqi),
    cdmaDbm: finite(signal.cdmaDbm ?? recordValue.cdmaDbm),
    cdmaEcio: finite(signal.cdmaEcio ?? recordValue.cdmaEcio),
    evdoDbm: finite(signal.evdoDbm ?? recordValue.evdoDbm),
    evdoEcio: finite(signal.evdoEcio ?? recordValue.evdoEcio),
    evdoSnr: finite(signal.evdoSnr ?? recordValue.evdoSnr),
  };
}

function normalizeAndroidCellular(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const cells = list(
    wrapped.body.cells || wrapped.body.cellInfo || wrapped.body.observations || wrapped.body.measurements
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of cells.slice(0, 512)) {
    const cell = record(raw);
    const type = radioType(cell.radioType || cell.type || cell.generation || cell.rat);
    const timestamp = timestampValue(
      cell.timestamp || cell.observedAt || wrapped.body.timestamp
    );
    if (!type || !timestamp) continue;

    const mcc = bounded(cell.mcc ?? cell.mobileCountryCode, 0, 999);
    const systemId = finite(cell.systemId ?? cell.sid);
    const networkId = finite(cell.networkId ?? cell.nid);
    const baseStationId = finite(cell.baseStationId ?? cell.bid);
    const mnc = bounded(
      cell.mnc
      ?? cell.mobileNetworkCode
      ?? (type === 'cdma' ? systemId : undefined),
      0,
      32767,
    );
    const lacTac = finite(
      cell.lac
      ?? cell.tac
      ?? cell.locationAreaCode
      ?? cell.trackingAreaCode
      ?? (type === 'cdma' ? networkId : undefined)
    );
    const cellId = finite(
      cell.cellId
      ?? cell.cid
      ?? cell.ci
      ?? cell.eci
      ?? (type === 'cdma' ? baseStationId : cell.baseStationId)
    );
    const nci = finite(cell.nci ?? cell.newRadioCellId);
    const pci = finite(cell.pci ?? cell.physicalCellId ?? cell.psc);
    const arfcn = finite(
      cell.arfcn ?? cell.nrarfcn ?? cell.earfcn ?? cell.uarfcn
    );
    const signal = cellularSignal(cell);

    if (mnc === null || (cellId === null && nci === null)) {
      measurements.push(contextMeasurement(
        'cellular_signal',
        timestamp,
        wrapped.providerId,
        {
          ...signal,
          mcc,
          mnc,
          lacTac,
          cellId,
          nci,
          pci,
          arfcn,
        },
        {
          providerKind: 'android-cellular',
          radioType: type,
          registered: Boolean(cell.registered ?? cell.isRegistered),
          carrier: stringValue(cell.carrier || wrapped.body.carrier, 120),
        },
      ));
      continue;
    }

    const tower: Record<string, unknown> = {
      mobileNetworkCode: mnc,
      mobileCountryCode: mcc ?? undefined,
      locationAreaCode:
        lacTac !== null && lacTac >= 0
          ? Math.floor(lacTac)
          : undefined,
      cellId:
        cellId !== null && cellId >= 0
          ? Math.floor(cellId)
          : undefined,
      newRadioCellId:
        nci !== null && nci >= 0
          ? Math.floor(nci)
          : undefined,
      physicalCellId:
        pci !== null && pci >= 0
          ? Math.floor(pci)
          : undefined,
      arfcn:
        arfcn !== null && arfcn >= 0
          ? Math.floor(arfcn)
          : undefined,
      radioType: type,
      signalStrength:
        signal.rssiDbm
        ?? signal.ssRsrpDbm
        ?? signal.rsrpDbm
        ?? signal.rscpDbm
        ?? signal.cdmaDbm
        ?? undefined,
      timingAdvance:
        signal.timingAdvance !== null && signal.timingAdvance >= 0
          ? signal.timingAdvance
          : undefined,
      registered: Boolean(cell.registered ?? cell.isRegistered),
      signal: Object.fromEntries(
        Object.entries(signal).filter((entry): entry is [string, number] =>
          Number.isFinite(entry[1])
        ),
      ),
    };

    measurements.push({
      kind: 'radio',
      timestamp,
      radioType: type,
      homeMobileCountryCode: mcc ?? undefined,
      homeMobileNetworkCode: mnc,
      carrier: stringValue(cell.carrier || wrapped.body.carrier, 120),
      provider: wrapped.providerId,
      cellTowers: [tower],
      metadata: {
        providerKind: 'android-cellular',
        registered: Boolean(cell.registered ?? cell.isRegistered),
        operatorAlphaLong: stringValue(cell.operatorAlphaLong, 120),
        operatorAlphaShort: stringValue(cell.operatorAlphaShort, 80),
        bands: Array.isArray(cell.bands) ? cell.bands.slice(0, 32) : undefined,
        signalMetrics: tower.signal,
        identifiers: {
          mcc,
          mnc,
          lacTac,
          cellId,
          nci,
          pci,
          arfcn,
          radioType: type,
          systemId: type === 'cdma' ? systemId : undefined,
          networkId: type === 'cdma' ? networkId : undefined,
          baseStationId: type === 'cdma' ? baseStationId : undefined,
        },
        csiCqiReport: (() => {
          const signalRecord = record(cell.signal || cell.signalStrength || {});
          const report =
            (Array.isArray(signalRecord.csiCqiReport) ? signalRecord.csiCqiReport : null)
            || (Array.isArray(signalRecord.cqiReport) ? signalRecord.cqiReport : null)
            || (Array.isArray(cell.csiCqiReport) ? cell.csiCqiReport : null)
            || (Array.isArray(cell.cqiReport) ? cell.cqiReport : null);
          return report
            ? report.map((value: unknown) => finite(value)).filter((value): value is number => value !== null).slice(0, 32)
            : undefined;
        })(),
      },
    });
  }

  return normalizerBatch(
    wrapped.providerId,
    'android-cellular',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeAndroidRawGnss(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const epochs = list(
    wrapped.body.epochs || wrapped.body.events || wrapped.body.measurements
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of epochs.slice(0, 1000)) {
    const epoch = record(raw);
    const timestamp = timestampValue(
      epoch.timestamp
      || epoch.observedAt
      || epoch.utcTime
      || epoch.utcTimeMillis
      || epoch.UtcTimeMillis
      || wrapped.body.timestamp
    );
    if (!timestamp) continue;

    const epochClock = record(epoch.clock);
    const clock = Object.keys(epochClock).length ? epochClock : epoch;
    const rawSatellites = list(epoch.satellites || epoch.gnssMeasurements);
    const satellites = (rawSatellites.length ? rawSatellites : [epoch]).slice(0, 128)
      .map(rawSatellite => {
        const satellite = record(rawSatellite);
        return {
          svid: finite(satellite.svid ?? satellite.Svid),
          constellationType: finite(
            satellite.constellationType
            ?? satellite.ConstellationType
            ?? satellite.constellation
          ),
          receivedSvTimeNanos: finite(
            satellite.receivedSvTimeNanos ?? satellite.ReceivedSvTimeNanos
          ),
          receivedSvTimeUncertaintyNanos: finite(
            satellite.receivedSvTimeUncertaintyNanos
            ?? satellite.ReceivedSvTimeUncertaintyNanos
          ),
          pseudorangeMeters: finite(
            satellite.pseudorangeMeters ?? satellite.PseudorangeMeters
          ),
          pseudorangeRateMetersPerSecond: finite(
            satellite.pseudorangeRateMetersPerSecond
            ?? satellite.PseudorangeRateMetersPerSecond
          ),
          pseudorangeRateUncertaintyMetersPerSecond: finite(
            satellite.pseudorangeRateUncertaintyMetersPerSecond
            ?? satellite.PseudorangeRateUncertaintyMetersPerSecond
          ),
          accumulatedDeltaRangeMeters: finite(
            satellite.accumulatedDeltaRangeMeters
            ?? satellite.AccumulatedDeltaRangeMeters
          ),
          accumulatedDeltaRangeUncertaintyMeters: finite(
            satellite.accumulatedDeltaRangeUncertaintyMeters
            ?? satellite.AccumulatedDeltaRangeUncertaintyMeters
          ),
          carrierFrequencyHz: finite(
            satellite.carrierFrequencyHz ?? satellite.CarrierFrequencyHz
          ),
          cn0DbHz: finite(satellite.cn0DbHz ?? satellite.Cn0DbHz),
          basebandCn0DbHz: finite(
            satellite.basebandCn0DbHz ?? satellite.BasebandCn0DbHz
          ),
          codeType: stringValue(satellite.codeType ?? satellite.CodeType, 40),
          multipathIndicator: finite(
            satellite.multipathIndicator ?? satellite.MultipathIndicator
          ),
          state: finite(satellite.state ?? satellite.State),
          adrState: finite(
            satellite.accumulatedDeltaRangeState
            ?? satellite.AccumulatedDeltaRangeState
            ?? satellite.adrState
          ),
          snrInDb: finite(satellite.snrInDb ?? satellite.SnrInDb),
          automaticGainControlLevelDb: finite(
            satellite.automaticGainControlLevelDb
            ?? satellite.AutomaticGainControlLevelDb
          ),
          fullInterSignalBiasNanos: finite(
            satellite.fullInterSignalBiasNanos
            ?? satellite.FullInterSignalBiasNanos
          ),
          fullInterSignalBiasUncertaintyNanos: finite(
            satellite.fullInterSignalBiasUncertaintyNanos
            ?? satellite.FullInterSignalBiasUncertaintyNanos
          ),
          satelliteInterSignalBiasNanos: finite(
            satellite.satelliteInterSignalBiasNanos
            ?? satellite.SatelliteInterSignalBiasNanos
          ),
          satelliteInterSignalBiasUncertaintyNanos: finite(
            satellite.satelliteInterSignalBiasUncertaintyNanos
            ?? satellite.SatelliteInterSignalBiasUncertaintyNanos
          ),
        };
      });

    const automaticGainControls = list(
      epoch.automaticGainControls
      || epoch.gnssAutomaticGainControls
      || wrapped.body.automaticGainControls
    ).slice(0, 32).map(rawAgc => {
      const agc = record(rawAgc);
      return {
        carrierFrequencyHz: finite(
          agc.carrierFrequencyHz ?? agc.CarrierFrequencyHz
        ),
        levelDb: finite(
          agc.levelDb
          ?? agc.agcLevelDb
          ?? agc.AutomaticGainControlLevelDb
        ),
      };
    });

    const antennaInfo = list(
      epoch.antennaInfo
      || epoch.gnssAntennaInfo
      || wrapped.body.antennaInfo
    ).slice(0, 16).map(rawAntenna => {
      const antenna = record(rawAntenna);
      const phaseCenter = record(
        antenna.phaseCenterOffset
        || antenna.PhaseCenterOffset
      );
      return {
        carrierFrequencyMHz: finite(
          antenna.carrierFrequencyMHz ?? antenna.CarrierFrequencyMHz
        ),
        phaseCenterOffsetMm: {
          x: finite(phaseCenter.x ?? phaseCenter.offsetXMm),
          y: finite(phaseCenter.y ?? phaseCenter.offsetYMm),
          z: finite(phaseCenter.z ?? phaseCenter.offsetZMm),
          xUncertainty: finite(
            phaseCenter.xUncertainty ?? phaseCenter.offsetXUncertaintyMm
          ),
          yUncertainty: finite(
            phaseCenter.yUncertainty ?? phaseCenter.offsetYUncertaintyMm
          ),
          zUncertainty: finite(
            phaseCenter.zUncertainty ?? phaseCenter.offsetZUncertaintyMm
          ),
        },
      };
    });

    const integrity = assessSpectraGnssIntegrity({
      satellites,
      clock: {
        hardwareClockDiscontinuityCount: finite(
          clock.hardwareClockDiscontinuityCount ?? clock.HardwareClockDiscontinuityCount
        ),
        timeUncertaintyNanos: finite(
          clock.timeUncertaintyNanos ?? clock.TimeUncertaintyNanos
        ),
        biasUncertaintyNanos: finite(
          clock.biasUncertaintyNanos ?? clock.BiasUncertaintyNanos
        ),
        driftUncertaintyNanosPerSecond: finite(
          clock.driftUncertaintyNanosPerSecond ?? clock.DriftUncertaintyNanosPerSecond
        ),
        elapsedRealtimeUncertaintyNanos: finite(
          clock.elapsedRealtimeUncertaintyNanos ?? clock.ElapsedRealtimeUncertaintyNanos
        ),
      },
      automaticGainControls,
      previousHardwareClockDiscontinuityCount: finite(
        epoch.previousHardwareClockDiscontinuityCount
      ),
      navigationAuthentication: {
        status: stringValue(
          epoch.navigationAuthenticationStatus
          || epoch.osnmaStatus
          || wrapped.body.navigationAuthenticationStatus,
          80,
        ),
        authenticatedSatelliteCount: finite(
          epoch.authenticatedSatelliteCount
          ?? epoch.osnmaAuthenticatedSatelliteCount
        ),
        failedSatelliteCount: finite(
          epoch.failedAuthenticationCount
          ?? epoch.osnmaFailedSatelliteCount
        ),
      },
      spoofJamIndicators: {
        spoofingSuspected:
          epoch.spoofingSuspected === true
          || wrapped.body.spoofingSuspected === true,
        jammingSuspected:
          epoch.jammingSuspected === true
          || wrapped.body.jammingSuspected === true,
        cn0AnomalyScore: finite(
          epoch.cn0AnomalyScore ?? wrapped.body.cn0AnomalyScore
        ),
        agcAnomalyScore: finite(
          epoch.agcAnomalyScore ?? wrapped.body.agcAnomalyScore
        ),
      },
    });

    const solution = record(epoch.solution || epoch.fix);
    const latitude = bounded(solution.latitude ?? solution.lat, -90, 90);
    const longitude = bounded(
      solution.longitude ?? solution.lon ?? solution.lng,
      -180,
      180,
    );
    const accuracy = finite(
      solution.accuracyMeters ?? solution.horizontalAccuracyMeters ?? solution.accuracy
    );

    const rawDeviceRef = stringValue(
      epoch.deviceRef
      || epoch.deviceId
      || epoch.receiverId
      || wrapped.body.deviceRef
      || wrapped.body.deviceId,
      200,
    );

    const rawMetadata = {
      providerKind: 'android-raw-gnss',
      deviceRef: rawDeviceRef,
      correlationDomain: rawDeviceRef,
      clock: {
        timeNanos: finite(clock.timeNanos ?? clock.TimeNanos),
        elapsedRealtimeNanos: finite(
          clock.elapsedRealtimeNanos ?? clock.ElapsedRealtimeNanos
        ),
        elapsedRealtimeUncertaintyNanos: finite(
          clock.elapsedRealtimeUncertaintyNanos
          ?? clock.ElapsedRealtimeUncertaintyNanos
        ),
        fullBiasNanos: finite(clock.fullBiasNanos ?? clock.FullBiasNanos),
        biasNanos: finite(clock.biasNanos ?? clock.BiasNanos),
        biasUncertaintyNanos: finite(clock.biasUncertaintyNanos ?? clock.BiasUncertaintyNanos),
        timeUncertaintyNanos: finite(clock.timeUncertaintyNanos ?? clock.TimeUncertaintyNanos),
        driftNanosPerSecond: finite(clock.driftNanosPerSecond ?? clock.DriftNanosPerSecond),
        driftUncertaintyNanosPerSecond: finite(
          clock.driftUncertaintyNanosPerSecond ?? clock.DriftUncertaintyNanosPerSecond
        ),
        hardwareClockDiscontinuityCount: finite(
          clock.hardwareClockDiscontinuityCount ?? clock.HardwareClockDiscontinuityCount
        ),
      },
      satellites,
      satelliteCount: satellites.length,
      automaticGainControls,
      antennaInfo,
      navigationAuthentication: {
        status: stringValue(
          epoch.navigationAuthenticationStatus
          || epoch.osnmaStatus
          || wrapped.body.navigationAuthenticationStatus,
          80,
        ),
        authenticatedSatelliteCount: finite(
          epoch.authenticatedSatelliteCount
          ?? epoch.osnmaAuthenticatedSatelliteCount
        ),
        failedSatelliteCount: finite(
          epoch.failedAuthenticationCount
          ?? epoch.osnmaFailedSatelliteCount
        ),
      },
      integrity,
    };

    measurements.push(contextMeasurement(
      'gnss_raw',
      timestamp,
      wrapped.providerId,
      {
        satelliteCount: satellites.length,
        timeUncertaintyNanos: finite(clock.timeUncertaintyNanos),
        biasUncertaintyNanos: finite(clock.biasUncertaintyNanos),
      },
      rawMetadata,
    ));

    if (latitude !== null && longitude !== null) {
      measurements.push({
        kind: 'position',
        source: 'gnss_fix',
        timestamp,
        latitude,
        longitude,
        altitude: finite(solution.altitudeMeters ?? solution.altitude) ?? undefined,
        accuracy:
          accuracy !== null && accuracy > 0
            ? Math.min(5_000_000, accuracy)
            : undefined,
        confidence:
          accuracy !== null && accuracy > 0
            ? Math.max(0.4, Math.min(0.98, 1 - Math.log10(Math.max(1, accuracy)) / 6))
            : 0.72,
        provider: wrapped.providerId,
        recordId: stringValue(epoch.recordId || epoch.epochId, 300),
        correlationGroup:
          stringValue(epoch.correlationGroup, 300)
          || `gnss:${wrapped.providerId}`,
        metadata: {
          ...rawMetadata,
          accuracyConfidenceLevel: 0.68,
          solutionType: stringValue(
            solution.solutionType
            || solution.fixType
            || solution.method,
            80,
          ),
          hdop: finite(solution.hdop ?? solution.HDOP),
          vdop: finite(solution.vdop ?? solution.VDOP),
          pdop: finite(solution.pdop ?? solution.PDOP),
          horizontalProtectionLevelMeters: finite(
            solution.horizontalProtectionLevelMeters
            ?? solution.hpl
          ),
          verticalProtectionLevelMeters: finite(
            solution.verticalProtectionLevelMeters
            ?? solution.vpl
          ),
        },
      });
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'android-raw-gnss',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeGnssPrecisionSolution(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const solutions = list(
    wrapped.body.solutions
    || wrapped.body.positions
    || wrapped.body.measurements
    || wrapped.body.results
  );
  const inputs = solutions.length ? solutions : [wrapped.body];
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of inputs.slice(0, 2000)) {
    const solution = record(raw);
    const observedAt = timestampValue(
      solution.timestamp
      || solution.observedAt
      || solution.solutionTime
      || solution.gpsTime
      || wrapped.body.timestamp
    );
    const latitude = bounded(
      solution.latitude ?? solution.lat,
      -90,
      90,
    );
    const longitude = bounded(
      solution.longitude ?? solution.lng ?? solution.lon,
      -180,
      180,
    );
    if (!observedAt || latitude === null || longitude === null) continue;

    const solutionTypeRaw = String(
      solution.solutionType
      || solution.fixType
      || solution.mode
      || solution.method
      || 'gnss'
    ).trim().toLowerCase();
    const solutionType =
      /ppp.?rtk/.test(solutionTypeRaw) ? 'ppp-rtk'
      : /rtk.*fixed|fixed.*rtk|integer/.test(solutionTypeRaw) ? 'rtk-fixed'
      : /rtk.*float|float.*rtk/.test(solutionTypeRaw) ? 'rtk-float'
      : /network.?rtk|nrtk|vrs/.test(solutionTypeRaw) ? 'network-rtk'
      : /ppp/.test(solutionTypeRaw) ? 'ppp'
      : /sbas/.test(solutionTypeRaw) ? 'sbas'
      : /dgnss|dgps/.test(solutionTypeRaw) ? 'dgnss'
      : 'gnss';

    const accuracy = finite(
      solution.horizontalAccuracyMeters
      ?? solution.accuracyMeters
      ?? solution.accuracy
      ?? solution.sigmaHorizontalMeters
    );
    const accuracyLevel = bounded(
      solution.accuracyConfidenceLevel
      ?? solution.confidenceLevel
      ?? solution.confidencePercent !== undefined
        ? Number(solution.confidencePercent) / 100
        : undefined,
      0.2,
      0.9999,
    );
    const covariance = record(
      solution.covariance
      || solution.covarianceEnu
      || solution.positionCovariance
    );
    const correction = record(
      solution.corrections
      || solution.correctionStatus
      || wrapped.body.corrections
    );
    const integrity = record(
      solution.integrity
      || solution.integrityStatus
      || wrapped.body.integrity
    );

    const precisionDeviceRef = stringValue(
      solution.deviceRef
      || solution.deviceId
      || solution.roverId
      || solution.receiverId
      || wrapped.body.deviceRef
      || wrapped.body.deviceId,
      200,
    );

    const correctionAgeSeconds = finite(
      correction.ageSeconds
      ?? correction.correctionAgeSeconds
      ?? solution.correctionAgeSeconds
    );
    const ambiguityRatio = finite(
      solution.ambiguityRatio
      ?? solution.ratioTest
      ?? solution.ambiguityResolutionRatio
    );
    const baselineMeters = finite(
      solution.baselineMeters
      ?? solution.baseToRoverDistanceMeters
    );
    const horizontalProtectionLevelMeters = finite(
      integrity.horizontalProtectionLevelMeters
      ?? integrity.hpl
      ?? solution.horizontalProtectionLevelMeters
      ?? solution.hpl
    );
    const verticalProtectionLevelMeters = finite(
      integrity.verticalProtectionLevelMeters
      ?? integrity.vpl
      ?? solution.verticalProtectionLevelMeters
      ?? solution.vpl
    );

    const correctionTransport = stringValue(
      correction.transport
      || correction.protocol
      || solution.correctionTransport,
      80,
    );
    const correctionFormat = stringValue(
      correction.format
      || correction.messageFormat
      || solution.correctionFormat,
      80,
    );

    measurements.push({
      kind: 'position',
      source: 'gnss_fix',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: finite(
        solution.altitudeMeters
        ?? solution.ellipsoidHeightMeters
        ?? solution.altitude
      ) ?? undefined,
      accuracy:
        accuracy !== null && accuracy > 0
          ? Math.min(5_000_000, accuracy)
          : undefined,
      verticalAccuracy:
        finite(
          solution.verticalAccuracyMeters
          ?? solution.sigmaVerticalMeters
        ) ?? undefined,
      speed:
        finite(solution.speedMetersPerSecond ?? solution.speed) ?? undefined,
      heading:
        bounded(solution.headingDegrees ?? solution.heading, 0, 360) ?? undefined,
      confidence:
        bounded(solution.confidence, 0, 1)
        ?? (
          solutionType === 'rtk-fixed' || solutionType === 'network-rtk'
            ? 0.995
            : solutionType === 'ppp-rtk'
              ? 0.99
              : solutionType === 'ppp' || solutionType === 'rtk-float'
                ? 0.96
                : 0.90
        ),
      provider: wrapped.providerId,
      recordId: stringValue(
        solution.recordId
        || solution.solutionId
        || solution.epochId,
        300,
      ),
      correlationGroup:
        stringValue(solution.correlationGroup, 300)
        || `gnss-precision:${wrapped.providerId}`,
      metadata: {
        providerKind: 'gnss-precision-solution',
        solutionType,
        deviceRef: precisionDeviceRef,
        correlationDomain: precisionDeviceRef,
        accuracyConfidenceLevel: accuracyLevel ?? 0.68,
        covariance: {
          eastVariance: finite(
            covariance.eastVariance
            ?? covariance.xx
            ?? covariance[0]
          ),
          northVariance: finite(
            covariance.northVariance
            ?? covariance.yy
            ?? covariance[4]
          ),
          eastNorthCovariance: finite(
            covariance.eastNorthCovariance
            ?? covariance.xy
            ?? covariance[1]
          ),
        },
        correctionAgeSeconds,
        correctionTransport,
        correctionFormat,
        ntripMountpoint: stringValue(
          correction.mountpoint || solution.ntripMountpoint,
          200,
        ),
        rtcmMessages: Array.isArray(correction.rtcmMessages)
          ? correction.rtcmMessages.slice(0, 64)
          : undefined,
        ambiguityRatio,
        ambiguitiesFixed:
          solution.ambiguitiesFixed === true
          || solution.integerAmbiguityFixed === true
          || solutionType === 'rtk-fixed',
        baselineMeters,
        satellitesUsed: finite(
          solution.satellitesUsed ?? solution.numSatellites
        ),
        hdop: finite(solution.hdop ?? solution.HDOP),
        vdop: finite(solution.vdop ?? solution.VDOP),
        pdop: finite(solution.pdop ?? solution.PDOP),
        horizontalProtectionLevelMeters,
        verticalProtectionLevelMeters,
        integrityAvailable:
          horizontalProtectionLevelMeters !== null
          || verticalProtectionLevelMeters !== null
          || Object.keys(integrity).length > 0,
      },
    });

    if (
      correctionAgeSeconds !== null
      || correctionTransport
      || correctionFormat
    ) {
      measurements.push(contextMeasurement(
        'gnss_corrections',
        observedAt,
        wrapped.providerId,
        {
          correctionAgeSeconds,
          ambiguityRatio,
          baselineMeters,
          satellitesUsed: finite(
            solution.satellitesUsed ?? solution.numSatellites
          ),
        },
        {
          providerKind: 'gnss-precision-solution',
          solutionType,
          correctionTransport,
          correctionFormat,
          ntripMountpoint: stringValue(
            correction.mountpoint || solution.ntripMountpoint,
            200,
          ),
          horizontalProtectionLevelMeters,
          verticalProtectionLevelMeters,
        },
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'gnss-precision-solution',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeAppleNearbyInteraction(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const observations = list(
    wrapped.body.observations || wrapped.body.measurements || wrapped.body.updates
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of observations.slice(0, 2000)) {
    const observation = record(raw);
    const timestamp = timestampValue(
      observation.timestamp || observation.observedAt || observation.capturedAt
    );
    if (!timestamp) continue;

    const modeRaw = String(
      observation.mode || observation.measurementType || observation.technology || 'uwb'
    ).toLowerCase();
    const mode =
      /channel.?sounding|bluetooth/.test(modeRaw) ? 'bluetooth-channel-sounding'
      : /dl.?tdoa/.test(modeRaw) ? 'dl-tdoa'
      : /extended|edm/.test(modeRaw) ? 'uwb-edm'
      : 'uwb';
    const distanceMeters = finite(observation.distanceMeters ?? observation.distance);
    const anchor = anchorCoordinates(
      observation.anchor || observation.peerLocation || observation.referenceLocation
    );
    const bearingDegrees = bounded(
      observation.bearingDegrees ?? observation.azimuthDegrees,
      0,
      360,
    );
    const bearingReferenceRaw = String(
      observation.bearingReference || observation.reference || 'device'
    ).toLowerCase();
    const bearingReference = ['true_north', 'magnetic_north', 'device'].includes(bearingReferenceRaw)
      ? bearingReferenceRaw
      : 'device';
    const metadata = {
      providerKind: 'apple-nearby-interaction',
      mode,
      directionVector: observation.directionVector || observation.direction,
      distanceMeters,
      extendedDistanceMeasurement: mode === 'uwb-edm',
      dlTdoa: mode === 'dl-tdoa',
      bluetoothChannelSounding: mode === 'bluetooth-channel-sounding',
      peerRef: stringValue(observation.peerRef || observation.discoveryTokenRef, 200),
      timeDifferenceNanos: finite(
        observation.timeDifferenceNanos ?? observation.tdoaNanos
      ),
      anchorCoordinates: anchor || undefined,
    };

    const solution = record(observation.solution || observation.position);
    const solutionLatitude = bounded(solution.latitude ?? solution.lat, -90, 90);
    const solutionLongitude = bounded(
      solution.longitude ?? solution.lon ?? solution.lng,
      -180,
      180,
    );
    if (solutionLatitude !== null && solutionLongitude !== null) {
      const accuracy = finite(
        solution.accuracyMeters ?? solution.horizontalAccuracyMeters ?? solution.accuracy
      );
      measurements.push({
        kind: 'position',
        source:
          mode === 'bluetooth-channel-sounding'
            ? 'bluetooth_channel_sounding'
            : mode === 'dl-tdoa'
              ? 'uwb_direction'
              : 'uwb_range',
        timestamp,
        latitude: solutionLatitude,
        longitude: solutionLongitude,
        altitude: finite(solution.altitudeMeters ?? solution.altitude) ?? undefined,
        accuracy:
          accuracy !== null && accuracy > 0
            ? Math.min(5_000_000, accuracy)
            : undefined,
        confidence:
          accuracy !== null && accuracy > 0
            ? Math.max(0.5, Math.min(0.98, 1 - Math.log10(Math.max(1, accuracy)) / 6))
            : 0.8,
        provider: wrapped.providerId,
        recordId: stringValue(observation.recordId || observation.measurementId, 300),
        correlationGroup:
          stringValue(observation.correlationGroup, 300)
          || `nearby-interaction:${wrapped.providerId}:${metadata.peerRef || 'peer'}`,
        metadata,
      });
      continue;
    }

    if (anchor && distanceMeters !== null && distanceMeters >= 0) {
      const rangingAnchor: Record<string, unknown> = {
        id: metadata.peerRef,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        distanceMeters: Math.max(0.01, Math.min(1_000_000, distanceMeters)),
        uncertaintyMeters:
          finite(observation.uncertaintyMeters) ?? Math.max(0.1, distanceMeters * 0.03),
      };
      if (bearingDegrees !== null) rangingAnchor.bearingDegrees = bearingDegrees;
      rangingAnchor.bearingReference = bearingReference;
      const bearingUncertainty = bounded(
        observation.bearingUncertaintyDegrees,
        0.01,
        180,
      );
      if (bearingUncertainty !== null) {
        rangingAnchor.bearingUncertaintyDegrees = bearingUncertainty;
      }

      measurements.push({
        kind: 'ranging',
        source:
          mode === 'bluetooth-channel-sounding'
            ? 'bluetooth_channel_sounding'
            : bearingDegrees !== null
              ? 'uwb_direction'
              : 'uwb_range',
        timestamp,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(observation.correlationGroup, 300)
          || `nearby-interaction:${wrapped.providerId}:${metadata.peerRef || 'peer'}`,
        anchors: [rangingAnchor],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        'uwb_context',
        timestamp,
        wrapped.providerId,
        {
          distanceMeters,
          bearingDegrees,
          timeDifferenceNanos: finite(metadata.timeDifferenceNanos),
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'apple-nearby-interaction',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeBleGateway(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const observations = list(
    wrapped.body.observations || wrapped.body.scans || wrapped.body.measurements
  );
  const measurements: Array<Record<string, unknown>> = [];

  for (const raw of observations.slice(0, 4000)) {
    const observation = record(raw);
    const timestamp = timestampValue(
      observation.timestamp || observation.observedAt || observation.capturedAt
    );
    if (!timestamp) continue;
    const anchor = anchorCoordinates(
      observation.gateway || observation.locator || observation.scanner || observation
    );
    const distance = finite(observation.distanceMeters);
    const rssi = finite(observation.rssiDbm ?? observation.rssi);
    const txPower = finite(
      observation.txPowerAtOneMeterDbm ?? observation.txPower ?? observation.measuredPower
    );
    const bearingDegrees = bounded(
      observation.bearingDegrees ?? observation.azimuthDegrees,
      0,
      360,
    );
    const directionMethod =
      /aod/i.test(String(observation.directionMethod || observation.method || ''))
        ? 'aod'
        : bearingDegrees !== null
          ? 'aoa'
          : undefined;
    const gatewayRef = stringValue(
      observation.gatewayId
      || observation.locatorId
      || observation.scannerId,
      200,
    );
    const targetRef = stringValue(
      observation.targetRef
      || observation.beaconId
      || observation.address
      || observation.macAddress,
      200,
    );
    const metadata = {
      providerKind: 'ble-gateway',
      gatewayKind: stringValue(
        observation.gatewayKind || wrapped.body.gatewayKind,
        80,
      ),
      directionMethod,
      targetRef,
      rssiDbm: rssi,
      manufacturerData: observation.manufacturerData,
      serviceData: observation.serviceData,
    };

    if (
      anchor
      && (
        distance !== null
        || (rssi !== null && txPower !== null)
      )
    ) {
      const rangedAnchor: Record<string, unknown> = {
        id: gatewayRef,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
      };
      if (distance !== null) rangedAnchor.distanceMeters = Math.max(0.01, distance);
      if (rssi !== null) rangedAnchor.rssiDbm = Math.max(-127, Math.min(0, rssi));
      if (txPower !== null) {
        rangedAnchor.txPowerAtOneMeterDbm = Math.max(-127, Math.min(0, txPower));
      }
      if (bearingDegrees !== null) {
        rangedAnchor.bearingDegrees = bearingDegrees;
        const referenceRaw = String(observation.bearingReference || 'device').toLowerCase();
        rangedAnchor.bearingReference = ['true_north', 'magnetic_north', 'device']
          .includes(referenceRaw)
            ? referenceRaw
            : 'device';
      }
      const bearingUncertainty = bounded(
        observation.bearingUncertaintyDegrees,
        0.01,
        180,
      );
      if (bearingUncertainty !== null) {
        rangedAnchor.bearingUncertaintyDegrees = bearingUncertainty;
      }

      measurements.push({
        kind: 'ranging',
        source:
          bearingDegrees !== null
            ? directionMethod === 'aod' ? 'ble_aod' : 'ble_aoa'
            : 'ble_rssi',
        timestamp,
        provider: wrapped.providerId,
        correlationGroup:
          stringValue(observation.correlationGroup, 300)
          || `ble-gateway:${wrapped.providerId}:${targetRef || 'target'}`,
        anchors: [rangedAnchor],
        metadata,
      });
    } else {
      measurements.push(contextMeasurement(
        'ble_gateway',
        timestamp,
        wrapped.providerId,
        {
          rssiDbm: rssi,
          distanceMeters: distance,
          bearingDegrees,
        },
        metadata,
      ));
    }
  }

  return normalizerBatch(
    wrapped.providerId,
    'ble-gateway',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function normalizeLoraWanObservation(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const measurements: Array<Record<string, unknown>> = [];

  const result = record(
    wrapped.body.result || wrapped.body.locationEst || wrapped.body.location
  );
  const location = record(result.locationEst || result);
  const latitude = bounded(location.latitude ?? location.lat, -90, 90);
  const longitude = bounded(
    location.longitude ?? location.lon ?? location.lng,
    -180,
    180,
  );
  const timestamp = timestampValue(
    wrapped.body.timestamp
    || wrapped.body.observedAt
    || result.timestamp
  ) || new Date().toISOString();

  if (latitude !== null && longitude !== null) {
    const accuracy = finite(
      location.accuracy
      ?? location.toleranceHoriz
      ?? result.accuracy
      ?? result.toleranceHoriz
    );
    measurements.push({
      kind: 'position',
      source: 'network_region',
      timestamp,
      latitude,
      longitude,
      altitude: finite(location.altitude) ?? undefined,
      accuracy:
        accuracy !== null && accuracy > 0
          ? Math.min(5_000_000, accuracy)
          : undefined,
      confidence:
        accuracy !== null && accuracy > 0
          ? Math.max(0.3, Math.min(0.85, 1 - Math.log10(Math.max(1, accuracy)) / 5))
          : 0.45,
      provider: wrapped.providerId,
      recordId: stringValue(result.recordId || result.requestId, 300),
      correlationGroup: `lorawan:${wrapped.providerId}`,
      metadata: {
        providerKind: 'lorawan-observation',
        algorithmType: stringValue(result.algorithmType, 80),
        numberOfGatewaysUsed: finite(
          result.numberOfGatewaysUsed ?? result.numUsedGateways
        ),
        hdop: finite(result.HDOP ?? result.hdop),
      },
    });
  }

  const uplinks = list(
    wrapped.body.lorawan || wrapped.body.uplinks || wrapped.body.gatewayObservations
  );
  for (const raw of uplinks.slice(0, 1024)) {
    const uplink = record(raw);
    const gateway = record(uplink.antennaLocation || uplink.gatewayLocation);
    measurements.push(contextMeasurement(
      'lorawan_radio',
      timestampValue(uplink.timestamp || uplink.observedAt) || timestamp,
      wrapped.providerId,
      {
        rssiDbm: finite(uplink.rssi),
        snrDb: finite(uplink.snr),
        toaNanos: finite(uplink.toa ?? uplink.timeOfArrivalNanos),
        gatewayLatitude: bounded(gateway.latitude ?? gateway.lat, -90, 90),
        gatewayLongitude: bounded(
          gateway.longitude ?? gateway.lon ?? gateway.lng,
          -180,
          180,
        ),
        gatewayAltitude: finite(gateway.altitude),
      },
      {
        providerKind: 'lorawan-observation',
        gatewayId: stringValue(uplink.gatewayId, 200),
        antennaId: finite(uplink.antennaId),
      },
    ));
  }

  return normalizerBatch(
    wrapped.providerId,
    'lorawan-observation',
    wrapped.sessionId,
    wrapped.subjectLabel,
    measurements,
  );
}

function mergeBatches(
  kind: SpectraAdvancedRadioNormalizerKind,
  providerId: string,
  payload: unknown,
  batches: SpectraAdvancedNormalizedBatch[],
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  return normalizerBatch(
    wrapped.providerId,
    kind,
    wrapped.sessionId,
    wrapped.subjectLabel,
    batches.flatMap(batch => batch.measurements),
  );
}

function tryNormalize(
  kind: Exclude<
    SpectraAdvancedRadioNormalizerKind,
    'android-radio-collector' | 'universal-radio-log'
  >,
  providerId: string,
  payload: unknown,
): SpectraAdvancedNormalizedBatch | null {
  try {
    switch (kind) {
      case 'bluetooth-channel-sounding':
        return normalizeBluetoothChannelSounding(payload, providerId);
      case 'ble-direction-finding':
        return normalizeBleDirectionFinding(payload, providerId);
      case 'android-wifi-ranging':
        return normalizeAndroidWifiRanging(payload, providerId);
      case 'android-ranging-manager':
        return normalizeAndroidRangingManager(payload, providerId);
      case 'android-uwb-sensor-fusion':
        return normalizeAndroidUwbSensorFusion(payload, providerId);
      case 'nr-positioning':
        return normalizeNrPositioning(payload, providerId);
      case 'android-cellular':
        return normalizeAndroidCellular(payload, providerId);
      case 'android-raw-gnss':
        return normalizeAndroidRawGnss(payload, providerId);
      case 'gnss-precision-solution':
        return normalizeGnssPrecisionSolution(payload, providerId);
      case 'apple-nearby-interaction':
        return normalizeAppleNearbyInteraction(payload, providerId);
      case 'ble-gateway':
        return normalizeBleGateway(payload, providerId);
      case 'lorawan-observation':
        return normalizeLoraWanObservation(payload, providerId);
    }
  } catch {
    return null;
  }
}

function normalizeAndroidRadioCollector(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const body = wrapped.body;
  const batches: SpectraAdvancedNormalizedBatch[] = [];

  const candidates: Array<[
    Exclude<
      SpectraAdvancedRadioNormalizerKind,
      'android-radio-collector' | 'universal-radio-log'
    >,
    unknown
  ]> = [
    ['android-cellular', { ...body, cells: body.cells || body.cellInfo }],
    ['android-raw-gnss', { ...body, epochs: body.gnss || body.gnssEpochs || body.gnssMeasurements }],
    ['android-wifi-ranging', { ...body, results: body.wifiRtt || body.wifiRanging }],
    ['android-ranging-manager', { ...body, results: body.rangingManager || body.androidRanging || body.rangingResults }],
    ['android-uwb-sensor-fusion', { ...body, results: body.uwbSensorFusion || body.sensorFusionEstimates }],
    ['bluetooth-channel-sounding', { ...body, observations: body.bluetoothChannelSounding }],
    ['ble-direction-finding', { ...body, observations: body.bleDirectionFinding }],
    ['ble-gateway', { ...body, observations: body.bleScans || body.bluetoothScans }],
  ];

  for (const [kind, candidate] of candidates) {
    const batch = tryNormalize(kind, wrapped.providerId, candidate);
    if (batch) batches.push(batch);
  }

  return mergeBatches(
    'android-radio-collector',
    wrapped.providerId,
    payload,
    batches,
  );
}

function inferRecordKind(row: Record<string, any>): Exclude<
  SpectraAdvancedRadioNormalizerKind,
  'android-radio-collector' | 'universal-radio-log'
> | null {
  const explicit = String(
    row.kind || row.recordType || row.type || row.source || row.technology || ''
  ).toLowerCase();

  if (/channel.?sounding|pbr|bluetooth.?cs/.test(explicit)) return 'bluetooth-channel-sounding';
  if (/aoa|aod|direction/.test(explicit)) return 'ble-direction-finding';
  if (/wifi.*rtt|802\.11az|802\.11mc|ftm/.test(explicit)) return 'android-wifi-ranging';
  if (/gnss|gps.*raw|pseudorange/.test(explicit)) return 'android-raw-gnss';
  if (/nearby.?interaction|uwb|dl.?tdoa|edm/.test(explicit)) return 'apple-nearby-interaction';
  if (/lorawan|lora/.test(explicit)) return 'lorawan-observation';
  if (/ble|bluetooth|bluez|esp32/.test(explicit)) return 'ble-gateway';
  if (/cell|lte|nr|wcdma|gsm|cdma|radio/.test(explicit)) return 'android-cellular';

  if (row.pbrDistanceMeters !== undefined || row.rttDistanceMeters !== undefined) {
    return 'bluetooth-channel-sounding';
  }
  if (
    row.ssRsrp !== undefined
    || row.csiRsrp !== undefined
    || row.timingAdvance !== undefined
    || row.nci !== undefined
    || row.pci !== undefined
  ) return 'android-cellular';
  if (
    row.pseudorangeMeters !== undefined
    || row.pseudorangeRateMetersPerSecond !== undefined
    || row.accumulatedDeltaRangeMeters !== undefined
  ) return 'android-raw-gnss';

  return null;
}

function parseCsvRecords(text: string): Record<string, any>[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const gnssHeader = lines.find(line => /^#\s*Raw,/i.test(line));
  if (gnssHeader) {
    const header = gnssHeader.replace(/^#\s*/, '');
    const rawLines = lines.filter(line => /^Raw,/i.test(line)).slice(0, 5000);
    const parsed: Record<string, any>[] = [];
    for (const rawLine of rawLines) {
      try {
        const rows = parseCsv(`${header}\n${rawLine}`, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        }) as Record<string, any>[];
        for (const row of rows) {
          parsed.push({
            ...row,
            kind: 'gnss-raw',
            recordType: 'gnsslogger-raw',
            timestamp:
              row.UtcTimeMillis
              ?? row.utcTimeMillis
              ?? row.utcTime
              ?? row.timestamp,
          });
        }
      } catch {
        // Ignore malformed rows while preserving other valid logger records.
      }
    }
    if (parsed.length) return parsed;
  }

  try {
    const parsed = parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      comment: '#',
    }) as Record<string, any>[];
    return parsed.slice(0, 5000);
  } catch {
    return [];
  }
}

function parseUniversalRecords(body: Record<string, any>): Record<string, any>[] {
  if (Array.isArray(body.records)) return body.records.map(record);
  if (Array.isArray(body.rows)) return body.rows.map(record);
  if (Array.isArray(body.measurements)) return body.measurements.map(record);

  if (typeof body.text === 'string') {
    const text = body.text.trim();
    if (!text) return [];

    if (text.includes(',')) {
      const csvRecords = parseCsvRecords(text);
      if (csvRecords.length) return csvRecords;
    }

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const parsed: Record<string, any>[] = [];
    for (const line of lines.slice(0, 5000)) {
      try {
        const value = JSON.parse(line);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed.push(record(value));
        }
      } catch {
        // Preserve unknown plain-text rows without guessing a location or timestamp.
        parsed.push({ kind: 'raw-log-line', raw: line });
      }
    }
    return parsed;
  }

  return [];
}

function normalizeUniversalRadioLog(
  payload: unknown,
  providerId: string,
): SpectraAdvancedNormalizedBatch {
  const wrapped = envelope(payload, providerId);
  const rows = parseUniversalRecords(wrapped.body);
  const batches: SpectraAdvancedNormalizedBatch[] = [];
  const unknownMeasurements: Array<Record<string, unknown>> = [];

  for (const row of rows.slice(0, 5000)) {
    const kind = inferRecordKind(row);
    if (!kind) {
      const timestamp = timestampValue(
        row.timestamp || row.observedAt || wrapped.body.timestamp
      );
      if (timestamp) {
        unknownMeasurements.push(contextMeasurement(
          'radio_context',
          timestamp,
          wrapped.providerId,
          {},
          {
            providerKind: 'universal-radio-log',
            rawRecord: row,
          },
        ));
      }
      continue;
    }

    const candidate =
      kind === 'android-cellular' ? { cells: [row], timestamp: row.timestamp }
      : kind === 'android-raw-gnss' ? { epochs: [row], timestamp: row.timestamp }
      : kind === 'android-wifi-ranging' ? { results: [row], timestamp: row.timestamp }
      : { observations: [row], timestamp: row.timestamp };
    const batch = tryNormalize(kind, wrapped.providerId, candidate);
    if (batch) batches.push(batch);
  }

  if (unknownMeasurements.length) {
    batches.push({
      sessionId: wrapped.sessionId,
      subjectLabel: wrapped.subjectLabel,
      sourceId: wrapped.providerId,
      measurements: unknownMeasurements,
      metadata: { normalization: 'universal-radio-log-context' },
    });
  }

  return mergeBatches(
    'universal-radio-log',
    wrapped.providerId,
    payload,
    batches,
  );
}

export function normalizeSpectraAdvancedRadioPayload(
  kind: SpectraAdvancedRadioNormalizerKind,
  providerId: string,
  payload: unknown,
): SpectraAdvancedNormalizedBatch {
  const normalizedProviderId = providerId.trim().slice(0, 200);
  if (!normalizedProviderId) {
    throw new SpectraAdvancedRadioNormalizationError('Provider ID is required.');
  }

  switch (kind) {
    case 'bluetooth-channel-sounding':
      return normalizeBluetoothChannelSounding(payload, normalizedProviderId);
    case 'ble-direction-finding':
      return normalizeBleDirectionFinding(payload, normalizedProviderId);
    case 'android-wifi-ranging':
      return normalizeAndroidWifiRanging(payload, normalizedProviderId);
    case 'android-ranging-manager':
      return normalizeAndroidRangingManager(payload, normalizedProviderId);
    case 'android-uwb-sensor-fusion':
      return normalizeAndroidUwbSensorFusion(payload, normalizedProviderId);
    case 'nr-positioning':
      return normalizeNrPositioning(payload, normalizedProviderId);
    case 'android-cellular':
      return normalizeAndroidCellular(payload, normalizedProviderId);
    case 'android-raw-gnss':
      return normalizeAndroidRawGnss(payload, normalizedProviderId);
    case 'gnss-precision-solution':
      return normalizeGnssPrecisionSolution(payload, normalizedProviderId);
    case 'apple-nearby-interaction':
      return normalizeAppleNearbyInteraction(payload, normalizedProviderId);
    case 'android-radio-collector':
      return normalizeAndroidRadioCollector(payload, normalizedProviderId);
    case 'ble-gateway':
      return normalizeBleGateway(payload, normalizedProviderId);
    case 'lorawan-observation':
      return normalizeLoraWanObservation(payload, normalizedProviderId);
    case 'universal-radio-log':
      return normalizeUniversalRadioLog(payload, normalizedProviderId);
    default:
      throw new SpectraAdvancedRadioNormalizationError(
        'Unsupported advanced SPECTRA radio normalizer.',
      );
  }
}
