/**
 * Hybrid Geoconsole API Routes
 * 
 * RESTful API endpoints for the geoconsole system
 * Location processing stays in memory while SPECTRA investigation evidence
 * may also be persisted through the canonical Postgres/PostGIS evidence store.
 */

import { Router, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import multer from 'multer';
import { hybridGeoconsole } from '../services/geoconsole';
import { GPSPoint, DataSource } from '../services/geoconsole/types';
import { assessLocationQuality } from '../services/geoconsole/location-quality';
import { selectCrawlerPlan } from '../services/crawlers/CrawlerSelectionUtility';
import { createLogger } from '../logger';
import { isAuthenticated } from '../auth';
import { getPlatformUserId } from '../authIdentity';
import { pool } from '../db';
import {
  normalizeClientEvidence,
  signServerEvidence,
} from '../services/geoconsole/evidence-proof';
import { getSpectraAdapterCapabilities } from '../services/spectra/SpectraAdapterRegistry';
import {
  getSpectraGenericPullAdapters,
  pullSpectraGenericAdapter,
} from '../services/spectra/SpectraGenericPullAdapters';
import {
  spectraRealtimeBridgeConfigured,
  subscribeSpectraDatabaseObservations,
} from '../services/spectra/SpectraRealtimeBridge';
import {
  importSpectraTelemetry,
  type SpectraTelemetryImportFormat,
} from '../services/spectra/SpectraTelemetryImport';
import { acquireSpectraPlaceContext } from '../services/spectra/SpectraPlaceContext';
import {
  acquireConfiguredSpectraCameras,
  configuredSpectraCameraJsonFeeds,
} from '../services/spectra/SpectraCameraDirectoryAdapters';
import {
  loadSpectraMotionContext,
  persistSpectraMotionContext,
  type SpectraMotionContext,
} from '../services/spectra/SpectraMotionContext';

const router = Router();
const log = createLogger('GeoconsoleRoutes');
const telemetryImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5_000_000, files: 1 },
});

const validDateString = z.string()
  .min(1)
  .refine(value => Number.isFinite(Date.parse(value)), {
    message: 'Invalid date/time value',
  })
  .transform(value => new Date(value));

// ============ VALIDATION SCHEMAS ============

const gpsPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().positive().max(5_000_000).optional(),
  timestamp: validDateString,
  source: z.enum([
    'device_gps', 'gnss_fix', 'gnss_raw',
    'exif_photo', 'exif_video', 'xmp_sidecar', 'json_sidecar',
    'wifi_handoff', 'wifi_rssi', 'wifi_rtt', 'wifi_fingerprint',
    'cellular', 'cell_serving', 'cell_neighbor',
    'uwb_range', 'uwb_direction',
    'bluetooth_proximity', 'ble_rssi', 'ble_aoa',
    'accelerometer', 'imu_gyro', 'magnetometer', 'barometer',
    'browser_geolocation', 'browser_timestamp', 'network_region',
    'social_media', 'social_geotag', 'visual_detection', 'vehicle_telemetry',
    'public_camera', 'traffic_cam', 'satellite_imagery', 'historical_location',
    'public_record', 'manual_input', 'interpolated', 'predicted'
  ]),
  confidence: z.number().min(0).max(1),
  verticalAccuracy: z.number().nonnegative().optional(),
  receivedAt: validDateString.optional(),
  observationKind: z.enum(['observed', 'inferred', 'interpolated', 'predicted', 'historical']).optional(),
  correlationGroup: z.string().max(200).optional(),
  provenance: z.object({
    provider: z.string().optional(),
    recordId: z.string().optional(),
    capturedAt: validDateString.optional(),
    transformedBy: z.array(z.string()).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const processRequestSchema = z.object({
  inputs: z.array(gpsPointSchema).min(1).max(2000),
  sessionId: z.string().min(1).max(200).optional(),
});

const reportRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  timeRange: z.object({
    start: validDateString,
    end: validDateString,
  }).refine(range => range.end.getTime() >= range.start.getTime(), {
    message: 'Time range end must not precede start',
  }).optional(),
});

const configUpdateSchema = z.object({
  timeline: z.object({
    historyDays: z.number().min(1).max(30).optional(),
    futurecastHours: z.number().min(1).max(1).optional(),
    playbackSpeed: z.number().min(1).max(3600).optional(),
    animationFps: z.number().min(1).max(60).optional(),
    trailFadeSeconds: z.number().min(3600).max(604800).optional(),
  }).optional(),
  orchestration: z.object({
    maxConcurrentOperations: z.number().min(1).max(16).optional(),
    computeBudget: z.number().min(100).max(10000).optional(),
    cacheStrategy: z.enum(['aggressive', 'balanced', 'minimal']).optional(),
    prefetchDepth: z.number().min(1).max(10).optional(),
    refinementPasses: z.number().min(1).max(5).optional(),
    adaptiveResolution: z.boolean().optional(),
    gpuAcceleration: z.boolean().optional(),
  }).optional(),
});


const telemetryAbsoluteSchema = z.object({
  kind: z.literal('position'),
  source: z.enum([
    'device_gps', 'gnss_fix', 'gnss_raw', 'browser_geolocation',
    'vehicle_telemetry', 'exif_photo', 'exif_video', 'xmp_sidecar',
    'json_sidecar', 'social_geotag', 'visual_detection', 'network_region',
    'public_camera', 'traffic_cam', 'satellite_imagery', 'historical_location', 'public_record',
  ]),
  timestamp: validDateString,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().positive().max(5_000_000).optional(),
  verticalAccuracy: z.number().nonnegative().max(5_000_000).optional(),
  speed: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  provider: z.string().trim().min(1).max(200).optional(),
  recordId: z.string().trim().min(1).max(300).optional(),
  correlationGroup: z.string().trim().min(1).max(300).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const telemetryRadioSchema = z.object({
  kind: z.literal('radio'),
  timestamp: validDateString,
  radioType: z.enum(['gsm', 'cdma', 'wcdma', 'lte', 'nr']).optional(),
  homeMobileCountryCode: z.number().int().min(0).max(999).optional(),
  homeMobileNetworkCode: z.number().int().min(0).max(32767).optional(),
  carrier: z.string().max(120).optional(),
  provider: z.string().max(200).optional(),
  wifiAccessPoints: z.array(z.object({
    macAddress: z.string().trim().min(11).max(32),
    signalStrength: z.number().min(-127).max(126).optional(),
    signalToNoiseRatio: z.number().optional(),
    channel: z.number().optional(),
    age: z.number().nonnegative().optional(),
  })).max(64).optional(),
  cellTowers: z.array(z.object({
    cellId: z.number().int().nonnegative().optional(),
    newRadioCellId: z.number().int().nonnegative().optional(),
    locationAreaCode: z.number().int().nonnegative().optional(),
    mobileCountryCode: z.number().int().min(0).max(999).optional(),
    mobileNetworkCode: z.number().int().min(0).max(32767),
    age: z.number().nonnegative().optional(),
    signalStrength: z.number().optional(),
    timingAdvance: z.number().nonnegative().optional(),
  })).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(value =>
  Boolean(value.wifiAccessPoints?.length || value.cellTowers?.length),
  { message: 'Radio telemetry requires Wi-Fi access points or cell towers.' },
);

const telemetryRangingAnchorSchema = z.object({
  id: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  distanceMeters: z.number().nonnegative().max(1_000_000).optional(),
  rssiDbm: z.number().min(-127).max(0).optional(),
  txPowerAtOneMeterDbm: z.number().min(-127).max(0).optional(),
  pathLossExponent: z.number().min(1).max(6).optional(),
  uncertaintyMeters: z.number().positive().max(1_000_000).optional(),
  bearingDegrees: z.number().min(0).max(360).optional(),
  bearingUncertaintyDegrees: z.number().positive().max(180).optional(),
  bearingReference: z.enum(['true_north', 'magnetic_north', 'device']).optional(),
}).refine(anchor =>
  anchor.distanceMeters !== undefined
  || (
    anchor.rssiDbm !== undefined
    && anchor.txPowerAtOneMeterDbm !== undefined
  ),
  { message: 'Ranging anchor requires distance or RSSI plus one-meter transmit power.' },
);

const telemetryRangingSchema = z.object({
  kind: z.literal('ranging'),
  source: z.enum([
    'wifi_rtt', 'wifi_rssi', 'uwb_range', 'uwb_direction',
    'bluetooth_proximity', 'ble_rssi', 'ble_aoa',
  ]),
  timestamp: validDateString,
  provider: z.string().max(200).optional(),
  correlationGroup: z.string().max(300).optional(),
  anchors: z.array(telemetryRangingAnchorSchema).min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
});

const telemetrySensorSchema = z.object({
  kind: z.literal('sensor'),
  source: z.enum(['accelerometer', 'imu_gyro', 'magnetometer', 'barometer']),
  timestamp: validDateString,
  provider: z.string().max(200).optional(),
  values: z.record(z.number()),
  metadata: z.record(z.unknown()).optional(),
});

const telemetryMeasurementSchema = z.union([
  telemetryAbsoluteSchema,
  telemetryRadioSchema,
  telemetryRangingSchema,
  telemetrySensorSchema,
]);

const telemetryBatchSchema = z.object({
  sessionId: z.string().trim().min(1).max(200).optional(),
  subjectLabel: z.string().trim().min(1).max(500).optional(),
  sourceId: z.string().trim().min(1).max(200).optional(),
  measurements: z.array(telemetryMeasurementSchema).min(1).max(2000),
  metadata: z.record(z.unknown()).optional(),
});

type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;
type TelemetryMeasurement = z.infer<typeof telemetryMeasurementSchema>;

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(',')}}`;
}

function providerTelemetryAuthorized(req: Request): boolean {
  const secret = String(process.env.SPECTRA_TELEMETRY_HMAC_SECRET || '').trim();
  if (!secret) return false;
  const timestamp = String(req.header('x-spectra-timestamp') || '').trim();
  const signature = String(req.header('x-spectra-signature') || '').trim().toLowerCase();
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${stableJson(req.body)}`)
    .digest('hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function confidenceForAccuracy(accuracyMeters: number, ceiling = 0.92): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0.35;
  const normalized = 1 - Math.log10(Math.max(1, accuracyMeters)) / 5;
  return Math.max(0.2, Math.min(ceiling, normalized));
}

function localMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const radius = 6_378_137;
  const originLatitudeRadians = originLatitude * Math.PI / 180;
  return {
    x: (longitude - originLongitude) * Math.PI / 180 * radius * Math.cos(originLatitudeRadians),
    y: (latitude - originLatitude) * Math.PI / 180 * radius,
  };
}

function geoFromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const radius = 6_378_137;
  const originLatitudeRadians = originLatitude * Math.PI / 180;
  return {
    latitude: originLatitude + y / radius * 180 / Math.PI,
    longitude: originLongitude + x / (radius * Math.cos(originLatitudeRadians)) * 180 / Math.PI,
  };
}

function rangingDistanceMeters(
  anchor: z.infer<typeof telemetryRangingAnchorSchema>,
): { distance: number; rssDerived: boolean } | null {
  if (Number.isFinite(anchor.distanceMeters)) {
    return {
      distance: Math.max(0.1, Math.min(1_000_000, Number(anchor.distanceMeters))),
      rssDerived: false,
    };
  }
  if (
    !Number.isFinite(anchor.rssiDbm)
    || !Number.isFinite(anchor.txPowerAtOneMeterDbm)
  ) return null;

  const exponent = Number(anchor.pathLossExponent ?? 2.2);
  const estimated = Math.pow(
    10,
    (Number(anchor.txPowerAtOneMeterDbm) - Number(anchor.rssiDbm)) / (10 * exponent),
  );
  if (!Number.isFinite(estimated)) return null;
  return {
    distance: Math.max(0.1, Math.min(1_000_000, estimated)),
    rssDerived: true,
  };
}

function directionalAnchorCandidate(
  anchor: z.infer<typeof telemetryRangingAnchorSchema>,
): { x: number; y: number; accuracy: number } | null {
  const resolvedRange = rangingDistanceMeters(anchor);
  if (
    anchor.bearingReference !== 'true_north'
    || !Number.isFinite(anchor.bearingDegrees)
    || !resolvedRange
  ) return null;

  const bearingRadians = Number(anchor.bearingDegrees) * Math.PI / 180;
  const angularUncertaintyRadians =
    Number(anchor.bearingUncertaintyDegrees ?? 12) * Math.PI / 180;
  const distanceUncertainty = Math.max(
    0.1,
    Number(
      anchor.uncertaintyMeters
      ?? (resolvedRange.rssDerived ? Math.max(3, resolvedRange.distance * 0.6) : 2),
    ),
  );
  const lateralUncertainty =
    Math.abs(Math.sin(angularUncertaintyRadians) * resolvedRange.distance);

  return {
    x: Math.sin(bearingRadians) * resolvedRange.distance,
    y: Math.cos(bearingRadians) * resolvedRange.distance,
    accuracy: Math.max(0.5, distanceUncertainty, lateralUncertainty),
  };
}

function rangingPoint(
  measurement: z.infer<typeof telemetryRangingSchema>,
): GPSPoint | null {
  const originLatitude = measurement.anchors.reduce((sum, anchor) => sum + anchor.latitude, 0)
    / measurement.anchors.length;
  const originLongitude = measurement.anchors.reduce((sum, anchor) => sum + anchor.longitude, 0)
    / measurement.anchors.length;
  const anchors = measurement.anchors.flatMap(anchor => {
    const resolvedRange = rangingDistanceMeters(anchor);
    if (!resolvedRange) return [];
    return [{
      ...localMeters(anchor.latitude, anchor.longitude, originLatitude, originLongitude),
      distance: resolvedRange.distance,
      uncertainty: Math.max(
        0.1,
        anchor.uncertaintyMeters
          ?? (resolvedRange.rssDerived ? Math.max(3, resolvedRange.distance * 0.6) : 2),
      ),
      rssDerived: resolvedRange.rssDerived,
      raw: anchor,
    }];
  });
  if (!anchors.length) return null;

  const directionalEstimates = anchors.flatMap(anchor => {
    const relative = directionalAnchorCandidate(anchor.raw);
    if (!relative) return [];
    return [{
      x: anchor.x + relative.x,
      y: anchor.y + relative.y,
      accuracy: relative.accuracy,
    }];
  });

  let x: number;
  let y: number;
  let rangeAccuracy = Number.POSITIVE_INFINITY;
  let residualRms = Number.POSITIVE_INFINITY;

  if (anchors.length >= 3) {
    const reference = anchors[0];
    let ata00 = 0;
    let ata01 = 0;
    let ata11 = 0;
    let atb0 = 0;
    let atb1 = 0;

    for (let index = 1; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const a0 = 2 * (anchor.x - reference.x);
      const a1 = 2 * (anchor.y - reference.y);
      const b =
        reference.distance ** 2 - anchor.distance ** 2
        - reference.x ** 2 - reference.y ** 2
        + anchor.x ** 2 + anchor.y ** 2;
      const weight = 1 / Math.max(0.25, anchor.uncertainty ** 2);
      ata00 += weight * a0 * a0;
      ata01 += weight * a0 * a1;
      ata11 += weight * a1 * a1;
      atb0 += weight * a0 * b;
      atb1 += weight * a1 * b;
    }

    const determinant = ata00 * ata11 - ata01 * ata01;
    if (Number.isFinite(determinant) && Math.abs(determinant) >= 1e-6) {
      x = (atb0 * ata11 - atb1 * ata01) / determinant;
      y = (ata00 * atb1 - ata01 * atb0) / determinant;
      const residuals = anchors.map(anchor =>
        Math.abs(Math.hypot(x - anchor.x, y - anchor.y) - anchor.distance)
      );
      residualRms = Math.sqrt(
        residuals.reduce((sum, residual) => sum + residual ** 2, 0) / residuals.length
      );
      const anchorUncertainty = Math.sqrt(
        anchors.reduce((sum, anchor) => sum + anchor.uncertainty ** 2, 0) / anchors.length
      );
      rangeAccuracy = Math.max(0.5, residualRms, anchorUncertainty);
    } else if (!directionalEstimates.length) {
      return null;
    } else {
      x = 0;
      y = 0;
    }
  } else if (!directionalEstimates.length) {
    // Range-only localization is underdetermined with fewer than three anchors.
    return null;
  } else {
    x = 0;
    y = 0;
  }

  if (directionalEstimates.length) {
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    if (Number.isFinite(rangeAccuracy)) {
      const rangeWeight = 1 / Math.max(0.25, rangeAccuracy ** 2);
      weightedX += x * rangeWeight;
      weightedY += y * rangeWeight;
      totalWeight += rangeWeight;
    }

    for (const estimate of directionalEstimates) {
      const weight = 1 / Math.max(0.25, estimate.accuracy ** 2);
      weightedX += estimate.x * weight;
      weightedY += estimate.y * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) return null;
    x = weightedX / totalWeight;
    y = weightedY / totalWeight;
  }

  const location = geoFromLocalMeters(x, y, originLatitude, originLongitude);
  if (
    !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
    || location.latitude < -90 || location.latitude > 90
    || location.longitude < -180 || location.longitude > 180
  ) return null;

  const directionalAccuracy = directionalEstimates.length
    ? Math.sqrt(
        directionalEstimates.reduce((sum, estimate) => sum + estimate.accuracy ** 2, 0)
        / directionalEstimates.length
      )
    : Number.POSITIVE_INFINITY;
  const accuracy = Math.max(
    0.5,
    Math.min(rangeAccuracy, directionalAccuracy),
  );

  return signServerEvidence({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
    timestamp: measurement.timestamp,
    receivedAt: new Date(),
    source: measurement.source,
    confidence: Math.min(
      0.95,
      confidenceForAccuracy(Number.isFinite(accuracy) ? accuracy : 25)
        + Math.min(0.18, Math.max(0, anchors.length - 2) * 0.06)
        + Math.min(0.08, directionalEstimates.length * 0.03),
    ),
    observationKind: 'inferred',
    correlationGroup: measurement.correlationGroup || `ranging:${measurement.provider || measurement.source}`,
    provenance: {
      provider: measurement.provider || 'spectra-ranging',
      capturedAt: measurement.timestamp,
      transformedBy: [
        anchors.length >= 3 ? 'spectra_weighted_multilateration' : 'spectra_directional_ranging',
        ...(directionalEstimates.length ? ['spectra_true_north_direction_fusion'] : []),
      ],
    },
    metadata: {
      ...(measurement.metadata || {}),
      anchorCount: anchors.length,
      rssDerivedAnchorCount: anchors.filter(anchor => anchor.rssDerived).length,
      directionalAnchorCount: directionalEstimates.length,
      residualRmsMeters: Number.isFinite(residualRms) ? residualRms : undefined,
      bearingReferencePolicy: 'only_true_north_bearings_used_for_absolute_position',
    },
  });
}

function openCellIdRadioName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'wcdma') return 'UMTS';
  return value.toUpperCase();
}

async function openCellIdPoint(
  measurement: z.infer<typeof telemetryRadioSchema>,
): Promise<GPSPoint | null> {
  const key = String(process.env.OPENCELLID_API_KEY || '').trim();
  if (!key || !measurement.cellTowers?.length) return null;

  for (const tower of measurement.cellTowers.slice(0, 4)) {
    const mcc = tower.mobileCountryCode ?? measurement.homeMobileCountryCode;
    const mnc = tower.mobileNetworkCode ?? measurement.homeMobileNetworkCode;
    const lac = tower.locationAreaCode;
    const cellId = tower.newRadioCellId ?? tower.cellId;
    if (
      !Number.isFinite(mcc)
      || !Number.isFinite(mnc)
      || !Number.isFinite(lac)
      || !Number.isFinite(cellId)
    ) continue;

    const endpoint = new URL('https://opencellid.org/cell/get');
    endpoint.searchParams.set('key', key);
    endpoint.searchParams.set('mcc', String(mcc));
    endpoint.searchParams.set('mnc', String(mnc));
    endpoint.searchParams.set('lac', String(lac));
    endpoint.searchParams.set('cellid', String(cellId));
    endpoint.searchParams.set('format', 'json');
    const radio = openCellIdRadioName(measurement.radioType);
    if (radio) endpoint.searchParams.set('radio', radio);

    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LegalWhat-SPECTRA/1.0',
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const payload: any = await response.json();
      const latitude = Number(payload?.lat);
      const longitude = Number(payload?.lon);
      const range = Number(payload?.range);
      const samples = Number(payload?.samples);
      if (
        !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90
        || longitude < -180 || longitude > 180
      ) continue;

      const accuracy = Number.isFinite(range) && range > 0 ? Math.max(100, range) : 5_000;
      return signServerEvidence({
        latitude,
        longitude,
        accuracy,
        timestamp: measurement.timestamp,
        receivedAt: new Date(),
        source: 'cellular',
        confidence: Math.min(
          0.72,
          confidenceForAccuracy(accuracy, 0.68)
            + (Number.isFinite(samples) ? Math.min(0.08, Math.log10(Math.max(1, samples)) * 0.03) : 0),
        ),
        observationKind: 'inferred',
        correlationGroup: `radio:${measurement.provider || 'opencellid'}`,
        provenance: {
          provider: 'OpenCellID',
          recordId: `${mcc}:${mnc}:${lac}:${cellId}`,
          capturedAt: measurement.timestamp,
          transformedBy: ['spectra_cell_position_lookup'],
        },
        metadata: {
          ...(measurement.metadata || {}),
          radioType: measurement.radioType,
          cellRangeMeters: Number.isFinite(range) ? range : undefined,
          cellSamples: Number.isFinite(samples) ? samples : undefined,
          attribution: 'OpenCellID (CC BY-SA 4.0)',
        },
      });
    } catch {
      // One tower/provider failure never suppresses the remaining radio evidence.
    }
  }

  return null;
}

function sanitizedWifiAccessPoints(
  measurement: z.infer<typeof telemetryRadioSchema>,
) {
  return (measurement.wifiAccessPoints || []).filter(accessPoint => {
    const mac = accessPoint.macAddress.toLowerCase();
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return false;
    const firstOctet = Number.parseInt(mac.slice(0, 2), 16);
    return (firstOctet & 0x02) === 0;
  });
}

async function beaconDbRadioPoint(
  measurement: z.infer<typeof telemetryRadioSchema>,
): Promise<GPSPoint | null> {
  const wifiAccessPoints = sanitizedWifiAccessPoints(measurement);
  const cellTowers = (measurement.cellTowers || []).map(tower => ({
    radioType: measurement.radioType,
    mobileCountryCode: tower.mobileCountryCode ?? measurement.homeMobileCountryCode,
    mobileNetworkCode: tower.mobileNetworkCode ?? measurement.homeMobileNetworkCode,
    locationAreaCode: tower.locationAreaCode,
    cellId: tower.newRadioCellId ?? tower.cellId,
    signalStrength: tower.signalStrength,
    timingAdvance: tower.timingAdvance,
    age: tower.age,
  }));

  if (!wifiAccessPoints.length && !cellTowers.length) return null;

  try {
    const response = await fetch('https://api.beacondb.net/v1/geolocate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      body: JSON.stringify({
        considerIp: false,
        wifiAccessPoints: wifiAccessPoints.length ? wifiAccessPoints : undefined,
        cellTowers: cellTowers.length ? cellTowers : undefined,
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;

    const payload: any = await response.json();
    const latitude = Number(payload?.location?.lat);
    const longitude = Number(payload?.location?.lng);
    const accuracy = Number(payload?.accuracy);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return null;

    const source: DataSource = wifiAccessPoints.length ? 'wifi_fingerprint' : 'cellular';
    return signServerEvidence({
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: measurement.timestamp,
      receivedAt: new Date(),
      source,
      confidence: confidenceForAccuracy(accuracy, 0.8),
      observationKind: 'inferred',
      correlationGroup: `radio:${measurement.provider || 'beacondb'}`,
      provenance: {
        provider: 'beaconDB',
        capturedAt: measurement.timestamp,
        transformedBy: ['spectra_radio_geolocation'],
      },
      metadata: {
        ...(measurement.metadata || {}),
        radioType: measurement.radioType,
        wifiAccessPointCount: wifiAccessPoints.length,
        cellTowerCount: cellTowers.length,
        acquisitionMethod: 'beacondb-ichnaea-geolocation',
      },
    });
  } catch {
    return null;
  }
}

async function googleRadioPoint(
  measurement: z.infer<typeof telemetryRadioSchema>,
): Promise<GPSPoint | null> {
  const key = String(
    process.env.SPECTRA_GOOGLE_GEOLOCATION_API_KEY
    || process.env.GOOGLE_GEOLOCATION_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || ''
  ).trim();
  if (!key) return null;

  const wifiAccessPoints = sanitizedWifiAccessPoints(measurement);

  const endpoint = new URL('https://www.googleapis.com/geolocation/v1/geolocate');
  endpoint.searchParams.set('key', key);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        homeMobileCountryCode: measurement.homeMobileCountryCode,
        homeMobileNetworkCode: measurement.homeMobileNetworkCode,
        radioType: measurement.radioType,
        carrier: measurement.carrier,
        considerIp: false,
        wifiAccessPoints: wifiAccessPoints.length ? wifiAccessPoints : undefined,
        cellTowers: measurement.cellTowers?.length ? measurement.cellTowers : undefined,
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    const latitude = Number(payload?.location?.lat);
    const longitude = Number(payload?.location?.lng);
    const accuracy = Number(payload?.accuracy);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return null;

    const source: DataSource = wifiAccessPoints.length ? 'wifi_fingerprint' : 'cellular';
    return signServerEvidence({
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      timestamp: measurement.timestamp,
      receivedAt: new Date(),
      source,
      confidence: confidenceForAccuracy(accuracy, 0.88),
      observationKind: 'inferred',
      correlationGroup: `radio:${measurement.provider || 'google-geolocation'}`,
      provenance: {
        provider: measurement.provider || 'google-geolocation',
        capturedAt: measurement.timestamp,
        transformedBy: ['spectra_radio_geolocation'],
      },
      metadata: {
        ...(measurement.metadata || {}),
        radioType: measurement.radioType,
        wifiAccessPointCount: wifiAccessPoints.length,
        cellTowerCount: measurement.cellTowers?.length || 0,
      },
    });
  } catch {
    return null;
  }
}

async function radioPoint(
  measurement: z.infer<typeof telemetryRadioSchema>,
): Promise<GPSPoint | null> {
  const [googleOutcome, beaconOutcome, openCellOutcome] = await Promise.allSettled([
    googleRadioPoint(measurement),
    beaconDbRadioPoint(measurement),
    openCellIdPoint(measurement),
  ]);

  const googlePoint = googleOutcome.status === 'fulfilled' ? googleOutcome.value : null;
  const beaconPoint = beaconOutcome.status === 'fulfilled' ? beaconOutcome.value : null;
  const openCellPoint = openCellOutcome.status === 'fulfilled' ? openCellOutcome.value : null;
  const candidates = [googlePoint, beaconPoint, openCellPoint].filter(
    (point): point is GPSPoint => Boolean(point)
  );
  if (!candidates.length) return null;

  const selected = [...candidates].sort((left, right) =>
    (left.accuracy ?? Number.MAX_SAFE_INTEGER) - (right.accuracy ?? Number.MAX_SAFE_INTEGER)
    || right.confidence - left.confidence
  )[0];

  const corroboration = candidates
    .filter(point => point !== selected)
    .map(point => {
      const distance = Math.hypot(
        (selected.latitude - point.latitude) * 111_320,
        (selected.longitude - point.longitude)
          * 111_320
          * Math.max(0.15, Math.cos(selected.latitude * Math.PI / 180)),
      );
      return {
        provider: point.provenance?.provider || point.source,
        distanceMeters: Math.round(distance),
        accuracyMeters: point.accuracy,
      };
    });

  selected.metadata = {
    ...(selected.metadata || {}),
    radioCorroboration: corroboration,
  };
  return selected;
}

async function telemetryPoint(
  measurement: TelemetryMeasurement,
  trustedProvider: boolean,
): Promise<GPSPoint | null> {
  if (measurement.kind === 'sensor') return null;
  if (measurement.kind === 'radio') return radioPoint(measurement);
  if (measurement.kind === 'ranging') return rangingPoint(measurement);

  const candidate: GPSPoint = {
    latitude: measurement.latitude,
    longitude: measurement.longitude,
    altitude: measurement.altitude,
    accuracy: measurement.accuracy,
    verticalAccuracy: measurement.verticalAccuracy,
    timestamp: measurement.timestamp,
    receivedAt: new Date(),
    source: measurement.source,
    confidence: measurement.confidence,
    observationKind:
      measurement.source === 'historical_location' || measurement.source === 'public_record'
        ? 'historical'
        : 'observed',
    correlationGroup: measurement.correlationGroup
      || `${measurement.source}:${measurement.provider || 'telemetry-source'}`,
    provenance: {
      provider: measurement.provider || 'telemetry-source',
      recordId: measurement.recordId,
      capturedAt: measurement.timestamp,
      transformedBy: ['spectra_telemetry_ingest'],
    },
    metadata: {
      ...(measurement.metadata || {}),
      velocity: (
        measurement.speed !== undefined || measurement.heading !== undefined
      ) ? {
        speed: measurement.speed,
        heading: measurement.heading,
      } : undefined,
    },
  };

  return trustedProvider
    ? signServerEvidence(candidate)
    : normalizeClientEvidence(candidate);
}

interface TelemetryPushEvent {
  sessionId: string;
  userId?: string;
  points: Array<Record<string, unknown>>;
  receivedAt: string;
}

const telemetryPushEmitter = new EventEmitter();
telemetryPushEmitter.setMaxListeners(0);

function pointFingerprint(point: GPSPoint): string {
  return createHash('sha256')
    .update([
      Number(point.latitude).toFixed(7),
      Number(point.longitude).toFixed(7),
      point.timestamp.toISOString(),
      point.source,
      point.correlationGroup || '',
      point.provenance?.provider || '',
      point.provenance?.recordId || '',
    ].join('|'))
    .digest('hex');
}

function serializedPoint(point: GPSPoint): Record<string, unknown> {
  return {
    ...point,
    timestamp: point.timestamp.toISOString(),
    receivedAt: point.receivedAt?.toISOString(),
    provenance: point.provenance
      ? {
          ...point.provenance,
          capturedAt: point.provenance.capturedAt instanceof Date
            ? point.provenance.capturedAt.toISOString()
            : point.provenance.capturedAt,
        }
      : undefined,
  };
}

function telemetryEvidenceClass(point: GPSPoint): string {
  if (point.observationKind === 'predicted' || point.source === 'predicted') return 'PREDICTED';
  if (point.observationKind === 'interpolated' || point.source === 'interpolated') return 'INTERPOLATED';
  if (
    point.observationKind === 'historical'
    || point.source === 'historical_location'
    || point.source === 'public_record'
  ) return 'HISTORICAL';
  if (point.observationKind === 'inferred') return 'INFERRED';

  const ageMs = Math.max(0, Date.now() - point.timestamp.getTime());
  if (ageMs <= 5 * 60_000) return 'CURRENT';
  if (ageMs <= 24 * 60 * 60_000) return 'RECENT';
  return 'HISTORICAL';
}

function pointMetadataConfidence(point: GPSPoint, key: string): number | null {
  const value = Number(point.metadata?.[key]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function pointMetadataString(point: GPSPoint, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = point.metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2_000);
  }
  return null;
}

const GENERIC_TELEMETRY_SUBJECT_RE = /^(?:person|individual|target|device|vehicle|car|truck|business|company|organization|object|place|address|thing|property|phone|phone number)$/i;

function telemetrySubjectsCompatible(existing: string, incoming: string): boolean {
  if (!existing || !incoming || existing === incoming) return true;
  if (GENERIC_TELEMETRY_SUBJECT_RE.test(existing) || GENERIC_TELEMETRY_SUBJECT_RE.test(incoming)) return true;
  return existing.includes(incoming) || incoming.includes(existing);
}

async function persistTelemetryBatch(input: {
  batch: TelemetryBatch;
  sessionId: string;
  userId?: string;
  providerId?: string;
  points: GPSPoint[];
}): Promise<{ available: boolean; investigationId?: string; eventId?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingSession = await client.query(
      `SELECT user_id, subject_label
       FROM public.spectra_investigations
       WHERE session_id = $1
       FOR UPDATE`,
      [input.sessionId],
    );
    if (existingSession.rows.length && input.userId) {
      const existingUserId = String(existingSession.rows[0]?.user_id || '');
      if (existingUserId && existingUserId !== input.userId) {
        throw new Error('SPECTRA telemetry session ownership mismatch');
      }

      const existingSubject = String(existingSession.rows[0]?.subject_label || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const incomingSubject = String(input.batch.subjectLabel || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!telemetrySubjectsCompatible(existingSubject, incomingSubject)) {
        throw new Error('SPECTRA telemetry session subject mismatch');
      }
    }

    const investigationResult = await client.query(
      `INSERT INTO public.spectra_investigations
        (user_id, subject_label, session_id, clues, state)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (session_id)
       DO UPDATE SET
         user_id = COALESCE(public.spectra_investigations.user_id, EXCLUDED.user_id),
         subject_label = COALESCE(public.spectra_investigations.subject_label, EXCLUDED.subject_label),
         state = public.spectra_investigations.state || EXCLUDED.state,
         updated_at = now()
       RETURNING id, user_id`,
      [
        input.userId || null,
        input.batch.subjectLabel || null,
        input.sessionId,
        JSON.stringify([]),
        JSON.stringify({
          sourceId: input.providerId || input.batch.sourceId || null,
          lastTelemetryAt: new Date().toISOString(),
        }),
      ],
    );
    const investigationId = String(investigationResult.rows[0]?.id || '');
    const effectiveUserId = String(investigationResult.rows[0]?.user_id || input.userId || '') || undefined;

    const eventHash = createHash('sha256')
      .update(stableJson({
        sourceId: input.providerId || input.batch.sourceId || null,
        subjectLabel: input.batch.subjectLabel || null,
        measurements: input.batch.measurements,
      }))
      .digest('hex');
    const observedTimes = input.batch.measurements
      .map(measurement => measurement.timestamp?.getTime())
      .filter((value): value is number => Number.isFinite(value));
    const observedAt = observedTimes.length ? new Date(Math.min(...observedTimes)) : null;

    const eventResult = await client.query(
      `INSERT INTO public.spectra_telemetry_events
        (investigation_id, user_id, source_id, provider, subject_label, session_id, observed_at, event_hash, payload)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (session_id, event_hash)
       DO UPDATE SET received_at = now()
       RETURNING id`,
      [
        investigationId,
        effectiveUserId || null,
        input.batch.sourceId || null,
        input.providerId || input.batch.sourceId || null,
        input.batch.subjectLabel || null,
        input.sessionId,
        observedAt,
        eventHash,
        JSON.stringify({
          metadata: input.batch.metadata || {},
          measurements: input.batch.measurements,
        }),
      ],
    );
    const eventId = String(eventResult.rows[0]?.id || '');

    for (const point of input.points) {
      await client.query(
        `INSERT INTO public.spectra_location_observations
          (
            investigation_id, telemetry_event_id, user_id, session_id, subject_label,
            source_type, provider, latitude, longitude, altitude, accuracy_meters,
            confidence, observation_kind, evidence_class, subject_match_confidence,
            timestamp_confidence, acquisition_method, source_url,
            observed_at, received_at, correlation_group,
            provenance, metadata, evidence_fingerprint
          )
         VALUES (
            $1::uuid, $2::uuid, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21,
            $22::jsonb, $23::jsonb, $24
         )
         ON CONFLICT (session_id, evidence_fingerprint) DO NOTHING`,
        [
          investigationId,
          eventId,
          effectiveUserId || null,
          input.sessionId,
          input.batch.subjectLabel || null,
          point.source,
          point.provenance?.provider || null,
          point.latitude,
          point.longitude,
          point.altitude ?? null,
          point.accuracy ?? null,
          point.confidence,
          point.observationKind || 'observed',
          telemetryEvidenceClass(point),
          pointMetadataConfidence(point, 'subjectMatchConfidence'),
          pointMetadataConfidence(point, 'timestampConfidence'),
          pointMetadataString(point, 'acquisitionMethod')
            || point.provenance?.transformedBy?.[0]
            || null,
          pointMetadataString(point, 'sourceUrl', 'url'),
          point.timestamp,
          point.receivedAt || new Date(),
          point.correlationGroup || null,
          JSON.stringify(point.provenance || {}),
          JSON.stringify(point.metadata || {}),
          pointFingerprint(point),
        ],
      );
    }

    await client.query('COMMIT');

    const pushEvent: TelemetryPushEvent = {
      sessionId: input.sessionId,
      userId: effectiveUserId,
      points: input.points.map(serializedPoint),
      receivedAt: new Date().toISOString(),
    };
    telemetryPushEmitter.emit(input.sessionId, pushEvent);

    return { available: true, investigationId, eventId };
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '42P01') {
      return { available: false };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function processTelemetryBatch(
  batch: TelemetryBatch,
  trustedProvider: boolean,
  userId?: string,
  providerId?: string,
): Promise<{
  sessionId: string;
  inputCount: number;
  positionCount: number;
  contextOnlyCount: number;
  quality: ReturnType<typeof assessLocationQuality>;
  result: Awaited<ReturnType<typeof hybridGeoconsole.processLocationData>> | null;
  persistence: { available: boolean; investigationId?: string; eventId?: string };
}> {
  const sessionId = batch.sessionId || randomUUID();
  const pointOutcomes = await Promise.allSettled(
    batch.measurements.map(measurement => telemetryPoint(measurement, trustedProvider))
  );
  const points = pointOutcomes.flatMap(outcome =>
    outcome.status === 'fulfilled' && outcome.value ? [outcome.value] : []
  );
  const quality = assessLocationQuality(points);
  const result = quality.points.length
    ? await hybridGeoconsole.processLocationData(quality.points, sessionId)
    : null;

  const persistence = await persistTelemetryBatch({
    batch,
    sessionId,
    userId,
    providerId,
    points: quality.points,
  }).catch(error => {
    log.warn('SPECTRA telemetry persistence unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { available: false };
  });

  return {
    sessionId,
    inputCount: batch.measurements.length,
    positionCount: quality.points.length,
    contextOnlyCount: batch.measurements.length - points.length,
    quality,
    result,
    persistence,
  };
}

router.post('/telemetry/provider/:providerId', async (req: Request, res: Response) => {
  if (!providerTelemetryAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Invalid telemetry provider signature.' });
  }
  const validation = telemetryBatchSchema.safeParse({
    ...req.body,
    sourceId: req.params.providerId,
  });
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid telemetry payload.',
      details: validation.error.errors,
    });
  }

  try {
    const processed = await processTelemetryBatch(validation.data, true, undefined, req.params.providerId);
    return res.json({
      success: true,
      data: {
        sessionId: processed.sessionId,
        inputCount: processed.inputCount,
        positionCount: processed.positionCount,
        persistence: processed.persistence,
        contextOnlyCount: processed.contextOnlyCount,
        fusedLocations: processed.result?.fusedLocations.map(location => ({
          ...location,
          point: signServerEvidence(location.point),
        })) || [],
        trail: processed.result?.trail || null,
        futurecast: processed.result?.futurecast.map(signServerEvidence) || [],
        inputQuality: {
          acceptedCount: processed.quality.acceptedCount,
          rejectedCount: processed.quality.rejectedCount,
          issues: processed.quality.issues,
        },
      },
    });
  } catch (error) {
    log.error('Provider telemetry ingest failed', { error });
    return res.status(500).json({ success: false, error: 'Telemetry processing failed.' });
  }
});

// Every ordinary GeoConsole/SPECTRA endpoint below remains authenticated.
router.use(isAuthenticated);

router.get('/telemetry-history/:sessionId', async (req: Request, res: Response) => {
  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId || sessionId.length > 200) {
    return res.status(400).json({ success: false, error: 'Invalid telemetry session.' });
  }

  try {
    const owner = await pool.query(
      `SELECT id
       FROM public.spectra_investigations
       WHERE session_id = $1 AND user_id = $2
       LIMIT 1`,
      [sessionId, userId],
    );
    if (!owner.rows.length) {
      return res.status(404).json({ success: false, error: 'Telemetry session not found.' });
    }

    const history = await pool.query(
      `SELECT
         source_type, provider, latitude, longitude, altitude, accuracy_meters,
         confidence, observation_kind, evidence_class,
         subject_match_confidence, timestamp_confidence, acquisition_method, source_url,
         observed_at, received_at, correlation_group, provenance, metadata
       FROM public.spectra_location_observations
       WHERE session_id = $1 AND user_id = $2
       ORDER BY observed_at ASC
       LIMIT 2000`,
      [sessionId, userId],
    );

    return res.json({
      success: true,
      data: history.rows.map((row: any) => ({
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        altitude: row.altitude == null ? undefined : Number(row.altitude),
        accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
        timestamp: new Date(row.observed_at).toISOString(),
        receivedAt: new Date(row.received_at).toISOString(),
        source: row.source_type,
        confidence: Number(row.confidence),
        observationKind: row.observation_kind,
        evidenceClass: row.evidence_class,
        subjectMatchConfidence: row.subject_match_confidence == null
          ? undefined
          : Number(row.subject_match_confidence),
        timestampConfidence: row.timestamp_confidence == null
          ? undefined
          : Number(row.timestamp_confidence),
        acquisitionMethod: row.acquisition_method || undefined,
        sourceUrl: row.source_url || undefined,
        correlationGroup: row.correlation_group || undefined,
        provenance: row.provenance || undefined,
        metadata: row.metadata || {},
      })),
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return res.status(503).json({ success: false, error: 'SPECTRA persistence is not initialized.' });
    }
    log.error('Telemetry history load failed', { error, userId, sessionId });
    return res.status(500).json({ success: false, error: 'Telemetry history could not be loaded.' });
  }
});

router.get('/telemetry-stream/:sessionId', async (req: Request, res: Response) => {
  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).end();

  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId || sessionId.length > 200) return res.status(400).end();

  try {
    const owner = await pool.query(
      `SELECT id
       FROM public.spectra_investigations
       WHERE session_id = $1 AND user_id = $2
       LIMIT 1`,
      [sessionId, userId],
    );
    if (!owner.rows.length) return res.status(404).end();
  } catch (error: any) {
    if (error?.code === '42P01') return res.status(503).end();
    log.error('Telemetry stream ownership check failed', { error, userId, sessionId });
    return res.status(500).end();
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  const listener = (event: TelemetryPushEvent) => {
    if (event.userId !== userId || res.writableEnded) return;
    res.write(`event: observation-batch\ndata: ${JSON.stringify(event)}\n\n`);
  };
  telemetryPushEmitter.on(sessionId, listener);

  const unsubscribeDatabase = subscribeSpectraDatabaseObservations(sessionId, row => {
    if (String(row.user_id || '') !== userId || res.writableEnded) return;
    const event: TelemetryPushEvent = {
      sessionId,
      userId,
      receivedAt: row.received_at || new Date().toISOString(),
      points: [{
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        altitude: row.altitude == null ? undefined : Number(row.altitude),
        accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
        timestamp: new Date(row.observed_at).toISOString(),
        receivedAt: new Date(row.received_at).toISOString(),
        source: row.source_type,
        confidence: Number(row.confidence),
        observationKind: row.observation_kind,
        correlationGroup: row.correlation_group || undefined,
        provenance: row.provenance || undefined,
        metadata: {
          ...(row.metadata || {}),
          evidenceClass: row.evidence_class || undefined,
          subjectMatchConfidence: row.subject_match_confidence ?? undefined,
          timestampConfidence: row.timestamp_confidence ?? undefined,
          acquisitionMethod: row.acquisition_method || undefined,
          sourceUrl: row.source_url || undefined,
          databaseObservationId: row.id,
          crossReplicaRealtime: true,
        },
      }],
    };
    res.write(`event: observation-batch\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 25_000);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    telemetryPushEmitter.off(sessionId, listener);
    unsubscribeDatabase();
  };
  req.once('close', cleanup);
  res.once('close', cleanup);
});

router.get('/telemetry-capabilities', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      transports: ['https-json', 'signed-webhook', 'structured-import'],
      positionSources: [
        'browser_geolocation', 'device_gps', 'gnss_fix', 'gnss_raw',
        'vehicle_telemetry', 'exif_photo', 'exif_video', 'social_geotag',
        'visual_detection', 'network_region', 'public_camera', 'traffic_cam',
        'historical_location', 'public_record',
      ],
      radioSources: ['wifi_fingerprint', 'cellular'],
      rangingSources: [
        'wifi_rtt', 'wifi_rssi', 'uwb_range', 'uwb_direction',
        'bluetooth_proximity', 'ble_rssi', 'ble_aoa',
      ],
      contextSources: ['accelerometer', 'imu_gyro', 'magnetometer', 'barometer'],
      radioGeolocationConfigured: true,
      radioGeolocationProviders: {
        beaconDb: true,
        google: Boolean(
          process.env.SPECTRA_GOOGLE_GEOLOCATION_API_KEY
          || process.env.GOOGLE_GEOLOCATION_API_KEY
          || process.env.GOOGLE_MAPS_API_KEY
        ),
        openCellId: Boolean(process.env.OPENCELLID_API_KEY),
      },
      providerWebhookConfigured: Boolean(process.env.SPECTRA_TELEMETRY_HMAC_SECRET),
      crossReplicaRealtimeConfigured: spectraRealtimeBridgeConfigured(),
      adapters: getSpectraAdapterCapabilities(),
      genericPullAdapters: getSpectraGenericPullAdapters(),
    },
  });
});

type SpectraImportSource =
  | 'device_gps'
  | 'gnss_fix'
  | 'vehicle_telemetry'
  | 'social_geotag'
  | 'historical_location'
  | 'public_record';

async function runStructuredTelemetryImport(input: {
  format: SpectraTelemetryImportFormat;
  content: string;
  sessionId?: string;
  subjectLabel?: string;
  source?: SpectraImportSource;
}, userId: string) {
  const imported = importSpectraTelemetry(input.format, input.content);
  const defaultSource: 'gnss_fix' | 'historical_location' =
    input.format === 'nmea' || input.format === 'gpx'
      ? 'gnss_fix'
      : 'historical_location';
  const source = input.source || defaultSource;

  if (!imported.length) {
    return {
      format: input.format,
      sessionId: input.sessionId,
      parsedObservationCount: 0,
      processedObservationCount: 0,
      persistence: { available: false },
      fusedLocations: [],
      futurecast: [],
      inputQuality: {
        acceptedCount: 0,
        rejectedCount: 0,
        issues: [],
      },
      message: 'No timestamped coordinate observations were present in the import.',
    };
  }

  const batch = telemetryBatchSchema.parse({
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
    sourceId: `import:${input.format}`,
    measurements: imported.map(point => ({
      kind: 'position',
      source,
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude,
      accuracy: point.accuracy,
      confidence: point.confidence,
      provider: `SPECTRA ${input.format.toUpperCase()} import`,
      recordId: point.recordId,
      correlationGroup: `import:${input.format}`,
      metadata: {
        ...(point.metadata || {}),
        importedArtifact: true,
        originalFormat: input.format,
      },
    })),
    metadata: {
      acquisitionMode: 'structured-telemetry-import',
      format: input.format,
      importedObservationCount: imported.length,
    },
  });

  const processed = await processTelemetryBatch(
    batch,
    true,
    userId,
    `import:${input.format}`,
  );

  return {
    format: input.format,
    sessionId: processed.sessionId,
    parsedObservationCount: imported.length,
    processedObservationCount: processed.positionCount,
    persistence: processed.persistence,
    fusedLocations: processed.result?.fusedLocations.map(location => ({
      ...location,
      point: signServerEvidence(location.point),
    })) || [],
    futurecast: processed.result?.futurecast.map(signServerEvidence) || [],
    inputQuality: {
      acceptedCount: processed.quality.acceptedCount,
      rejectedCount: processed.quality.rejectedCount,
      issues: processed.quality.issues,
    },
  };
}

function inferTelemetryImportFormat(fileName: string): SpectraTelemetryImportFormat | null {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  if (extension === 'geojson' || extension === 'json') return 'geojson';
  if (extension === 'gpx') return 'gpx';
  if (extension === 'kml') return 'kml';
  if (extension === 'nmea' || extension === 'log' || extension === 'txt') return 'nmea';
  if (extension === 'csv') return 'csv';
  if (extension === 'ndjson' || extension === 'jsonl') return 'ndjson';
  return null;
}

router.post('/telemetry/import', async (req: Request, res: Response) => {
  const validation = z.object({
    format: z.enum(['geojson', 'gpx', 'kml', 'nmea', 'csv', 'ndjson']),
    content: z.string().min(1).max(5_000_000),
    sessionId: z.string().trim().min(1).max(200).optional(),
    subjectLabel: z.string().trim().min(1).max(500).optional(),
    source: z.enum([
      'device_gps',
      'gnss_fix',
      'vehicle_telemetry',
      'social_geotag',
      'historical_location',
      'public_record',
    ]).optional(),
  }).safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid telemetry import.',
      details: validation.error.errors,
    });
  }

  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

  try {
    const data = await runStructuredTelemetryImport({
      ...validation.data,
      format: validation.data.format as SpectraTelemetryImportFormat,
    }, userId);
    return res.json({ success: true, data });
  } catch (error) {
    log.warn('SPECTRA telemetry import failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(400).json({ success: false, error: 'Telemetry import could not be parsed.' });
  }
});

router.post(
  '/telemetry/import-file',
  telemetryImportUpload.single('file'),
  async (req: Request, res: Response) => {
    const userId = getPlatformUserId(req.user as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ success: false, error: 'A telemetry file is required.' });
    }

    const requestedFormat = typeof req.body?.format === 'string'
      ? req.body.format.trim().toLowerCase()
      : '';
    const inferredFormat = inferTelemetryImportFormat(req.file.originalname);
    const format = (
      ['geojson', 'gpx', 'kml', 'nmea', 'csv', 'ndjson'] as const
    ).includes(requestedFormat as any)
      ? requestedFormat as SpectraTelemetryImportFormat
      : inferredFormat;

    if (!format) {
      return res.status(400).json({ success: false, error: 'Unsupported telemetry file format.' });
    }

    const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim().slice(0, 200)
      : undefined;
    const subjectLabel = typeof req.body?.subjectLabel === 'string' && req.body.subjectLabel.trim()
      ? req.body.subjectLabel.trim().slice(0, 500)
      : undefined;
    const sourceRaw = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
    const allowedSources = new Set<SpectraImportSource>([
      'device_gps',
      'gnss_fix',
      'vehicle_telemetry',
      'social_geotag',
      'historical_location',
      'public_record',
    ]);
    const source = allowedSources.has(sourceRaw as SpectraImportSource)
      ? sourceRaw as SpectraImportSource
      : undefined;

    try {
      const data = await runStructuredTelemetryImport({
        format,
        content: req.file.buffer.toString('utf8'),
        sessionId,
        subjectLabel,
        source,
      }, userId);
      return res.json({ success: true, data });
    } catch (error) {
      log.warn('SPECTRA telemetry file import failed', {
        format,
        fileName: req.file.originalname,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(400).json({ success: false, error: 'Telemetry file could not be parsed.' });
    }
  },
);

router.post('/telemetry/pull/:adapterId', async (req: Request, res: Response) => {
  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

  const adapterId = String(req.params.adapterId || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(adapterId)) {
    return res.status(400).json({ success: false, error: 'Invalid telemetry adapter.' });
  }

  try {
    const points = await pullSpectraGenericAdapter(adapterId);
    if (!points.length) {
      return res.json({
        success: true,
        data: {
          adapterId,
          inputCount: 0,
          positionCount: 0,
          message: 'The configured provider returned no usable location observations.',
        },
      });
    }

    const batch = telemetryBatchSchema.parse({
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
      subjectLabel: typeof req.body?.subjectLabel === 'string' ? req.body.subjectLabel : undefined,
      sourceId: adapterId,
      measurements: points.map(point => ({
        kind: 'position',
        source: point.source,
        timestamp: point.timestamp.toISOString(),
        latitude: point.latitude,
        longitude: point.longitude,
        altitude: point.altitude,
        accuracy: point.accuracy,
        verticalAccuracy: point.verticalAccuracy,
        confidence: point.confidence,
        provider: point.provenance?.provider || adapterId,
        recordId: point.provenance?.recordId,
        correlationGroup: point.correlationGroup,
        metadata: point.metadata,
      })),
      metadata: { acquisitionMode: 'configured-https-pull' },
    });

    const processed = await processTelemetryBatch(batch, true, userId, adapterId);
    return res.json({
      success: true,
      data: {
        adapterId,
        sessionId: processed.sessionId,
        inputCount: processed.inputCount,
        positionCount: processed.positionCount,
        contextOnlyCount: processed.contextOnlyCount,
        persistence: processed.persistence,
        fusedLocations: processed.result?.fusedLocations.map(location => ({
          ...location,
          point: signServerEvidence(location.point),
        })) || [],
        futurecast: processed.result?.futurecast.map(signServerEvidence) || [],
        inputQuality: {
          acceptedCount: processed.quality.acceptedCount,
          rejectedCount: processed.quality.rejectedCount,
          issues: processed.quality.issues,
        },
      },
    });
  } catch (error) {
    log.warn('Configured SPECTRA telemetry pull failed', {
      adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ success: false, error: 'Configured telemetry source was unavailable.' });
  }
});

router.post('/telemetry-ingest', async (req: Request, res: Response) => {
  const validation = telemetryBatchSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid telemetry payload.',
      details: validation.error.errors,
    });
  }

  const userId = getPlatformUserId(req.user as any);
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

  try {
    const processed = await processTelemetryBatch(validation.data, false, userId, validation.data.sourceId);
    return res.json({
      success: true,
      data: {
        sessionId: processed.sessionId,
        inputCount: processed.inputCount,
        positionCount: processed.positionCount,
        persistence: processed.persistence,
        contextOnlyCount: processed.contextOnlyCount,
        fusedLocations: processed.result?.fusedLocations.map(location => ({
          ...location,
          point: signServerEvidence(location.point),
        })) || [],
        trail: processed.result?.trail || null,
        futurecast: processed.result?.futurecast.map(signServerEvidence) || [],
        inputQuality: {
          acceptedCount: processed.quality.acceptedCount,
          rejectedCount: processed.quality.rejectedCount,
          issues: processed.quality.issues,
        },
      },
    });
  } catch (error) {
    log.error('Telemetry ingest failed', { error, userId });
    return res.status(500).json({ success: false, error: 'Telemetry processing failed.' });
  }
});

// ============ API ENDPOINTS ============

/**
 * GET /api/geoconsole/street-imagery
 * Provider-neutral nearest public street image adapter.
 */
router.get('/street-imagery', async (req: Request, res: Response) => {
  const validation = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }).safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({ success: false, error: 'Invalid coordinates' });
  }

  const { lat, lng } = validation.data;
  const endpoint = process.env.KARTAVIEW_API_URL || 'https://api.openstreetcam.org/2.0/photo/';
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    zoomLevel: '18',
    join: 'sequence',
    orderBy: 'id',
    orderDirection: 'desc',
  });

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, error: 'Street imagery provider unavailable' });
    }

    const payload: any = await response.json();
    const data = payload?.result?.data;
    const photo = Array.isArray(data) ? data[0] : data;

    return res.json({
      success: true,
      data: photo || null,
      metadata: {
        provider: 'public_street_imagery',
        timestamp: new Date(),
      },
    });
  } catch (error) {
    log.warn('Street imagery lookup failed', { error });
    return res.status(502).json({ success: false, error: 'Street imagery unavailable' });
  }
});

interface PublicCameraResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provider: string;
  imageUrl?: string;
  videoUrl?: string;
  observedAt?: string;
  status?: {
    disabled?: boolean;
    qualityWarning?: boolean;
    quality?: number | null;
  };
  metadata?: Record<string, unknown>;
}

const cameraCache = new Map<string, { expiresAt: number; items: PublicCameraResult[] }>();
const CAMERA_CACHE_MS = 30 * 60_000;

function cameraCacheKey(lat: number, lng: number, radiusMiles: number): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusMiles.toFixed(1)}`;
}

function configuredArcGisCameraLayers(): Array<{ url: string; provider: string }> {
  const raw = String(process.env.SPECTRA_CAMERA_ARCGIS_FEEDS || '').trim();
  if (!raw) return [];
  return raw.split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .flatMap(entry => {
      const [urlRaw, providerRaw] = entry.split('|').map(value => value.trim());
      if (!/^https:\/\//i.test(urlRaw || '')) return [];
      return [{
        url: String(urlRaw).replace(/\/$/, ''),
        provider: providerRaw || new URL(urlRaw).hostname,
      }];
    });
}

function cameraBoundingBox(latitude: number, longitude: number, radiusMiles: number) {
  const radiusMeters = Math.max(250, Math.min(100_000, radiusMiles * 1609.344));
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.15, Math.cos(latitude * Math.PI / 180)));
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLng: longitude - lngDelta,
    maxLng: longitude + lngDelta,
  };
}

function cameraAttributeString(
  attributes: Record<string, unknown>,
  patterns: RegExp[],
): string | undefined {
  for (const [key, value] of Object.entries(attributes)) {
    if (!patterns.some(pattern => pattern.test(key))) continue;
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

function cameraAttributeNumber(
  attributes: Record<string, unknown>,
  patterns: RegExp[],
): number | undefined {
  const value = cameraAttributeString(attributes, patterns);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function trafficLandCameras(
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<PublicCameraResult[]> {
  const key = String(process.env.TRAFFICLAND_API_KEY || '').trim();
  const system = String(process.env.TRAFFICLAND_SYSTEM || '').trim();
  if (!key || !system) return [];

  const endpoint = new URL('https://api.trafficland.com/v2.2/json/video_feeds/poi');
  endpoint.searchParams.set('lat', String(lat));
  endpoint.searchParams.set('lon', String(lng));
  endpoint.searchParams.set('radius', String(radiusMiles));
  endpoint.searchParams.set('uom', 'mi');
  endpoint.searchParams.set('key', key);
  endpoint.searchParams.set('system', system);

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return [];

  const payload: any = await response.json();
  const rows = Array.isArray(payload) ? payload : [];
  return rows.flatMap((row: any) => {
    const latitude = Number(row?.location?.latitude);
    const longitude = Number(row?.location?.longitude);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return [];

    const updatedAt = Number(row?.updatedAt);
    return [{
      id: String(row?.publicId || `${latitude},${longitude}`),
      name: String(row?.name || 'Traffic camera'),
      latitude,
      longitude,
      provider: String(row?.providerFullName || row?.provider || 'TrafficLand'),
      imageUrl: String(row?.content?.hugeJpeg || row?.content?.fullJpeg || row?.content?.halfJpeg || '') || undefined,
      observedAt: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : undefined,
      status: {
        disabled: row?.status?.isDisabled === true,
        qualityWarning: row?.status?.hasQualityWarning === true,
        quality: Number.isFinite(Number(row?.status?.quality?.current))
          ? Number(row.status.quality.current)
          : null,
      },
      metadata: {
        orientation: row?.orientation,
        city: row?.location?.cityName,
        state: row?.location?.stateName,
        country: row?.location?.countryName,
        refreshRateMs: row?.policy?.refreshRate,
      },
    } satisfies PublicCameraResult];
  });
}

export async function arcGisCameras(
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<PublicCameraResult[]> {
  const layers = configuredArcGisCameraLayers();
  if (!layers.length) return [];

  const box = cameraBoundingBox(lat, lng, radiusMiles);
  const settled = await Promise.allSettled(layers.map(async layer => {
    const endpoint = new URL(`${layer.url}/query`);
    endpoint.searchParams.set('f', 'json');
    endpoint.searchParams.set('where', '1=1');
    endpoint.searchParams.set('outFields', '*');
    endpoint.searchParams.set('returnGeometry', 'true');
    endpoint.searchParams.set('geometryType', 'esriGeometryEnvelope');
    endpoint.searchParams.set('geometry', `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`);
    endpoint.searchParams.set('inSR', '4326');
    endpoint.searchParams.set('outSR', '4326');
    endpoint.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    endpoint.searchParams.set('resultRecordCount', '200');

    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return [];

    const payload: any = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    return features.flatMap((feature: any, index: number) => {
      const attributes = feature?.attributes && typeof feature.attributes === 'object'
        ? feature.attributes as Record<string, unknown>
        : {};
      const latitude = Number(
        cameraAttributeNumber(attributes, [/^latitude$/i, /^lat$/i]) ?? feature?.geometry?.y
      );
      const longitude = Number(
        cameraAttributeNumber(attributes, [/^longitude$/i, /^lon$/i, /^lng$/i]) ?? feature?.geometry?.x
      );
      if (
        !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90
        || longitude < -180 || longitude > 180
      ) return [];

      const imageUrl = cameraAttributeString(attributes, [
        /^ImageURL$/i, /snapshot/i, /still.*image/i, /^image$/i, /image.*url/i,
      ]);
      const videoUrl = cameraAttributeString(attributes, [
        /^VideoURL$/i, /stream/i, /video.*url/i, /^video$/i,
      ]);
      return [{
        id: String(
          cameraAttributeString(attributes, [/^COMMON_ID$/i, /^device_id$/i, /^camera_?id$/i, /^id$/i])
          || cameraAttributeNumber(attributes, [/^FID$/i, /^OBJECTID$/i])
          || `${layer.provider}-${index + 1}`
        ),
        name: cameraAttributeString(attributes, [
          /^Desc_$/i, /description/i, /intersection/i, /location/i, /^name$/i, /^Route$/i,
        ]) || `${layer.provider} camera`,
        latitude,
        longitude,
        provider: layer.provider,
        imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
        videoUrl: videoUrl && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined,
        metadata: attributes,
      } satisfies PublicCameraResult];
    });
  }));

  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

/**
 * GET /api/geoconsole/public-cameras
 * Nationwide camera discovery: TrafficLand when configured plus any
 * state/local ArcGIS camera feeds registered in SPECTRA_CAMERA_ARCGIS_FEEDS.
 */
router.get('/public-cameras', async (req: Request, res: Response) => {
  const validation = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMiles: z.coerce.number().min(0.25).max(62).default(10),
  }).safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({ success: false, error: 'Invalid camera search coordinates' });
  }

  const { lat, lng, radiusMiles } = validation.data;
  const cacheKey = cameraCacheKey(lat, lng, radiusMiles);
  const cached = cameraCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ success: true, data: cached.items, cached: true });
  }

  const settled = await Promise.allSettled([
    trafficLandCameras(lat, lng, radiusMiles),
    arcGisCameras(lat, lng, radiusMiles),
    acquireConfiguredSpectraCameras(lat, lng, radiusMiles),
  ]);

  const seen = new Set<string>();
  const cameras = settled
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .filter(camera => {
      const key = `${camera.provider}:${camera.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 250);

  cameraCache.set(cacheKey, {
    expiresAt: Date.now() + CAMERA_CACHE_MS,
    items: cameras,
  });

  return res.json({
    success: true,
    data: cameras,
    cached: false,
    providers: {
      trafficLand: Boolean(process.env.TRAFFICLAND_API_KEY && process.env.TRAFFICLAND_SYSTEM),
      arcGisFeeds: configuredArcGisCameraLayers().length,
      jsonFeeds: configuredSpectraCameraJsonFeeds(),
    },
  });
});

interface PublicGeoMediaResult {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  provider: string;
  capturedAt?: string;
  imageUrl?: string;
  pageUrl?: string;
  accuracy?: number;
  metadata?: Record<string, unknown>;
}

export async function wikimediaNearbyMedia(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<PublicGeoMediaResult[]> {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('generator', 'geosearch');
  endpoint.searchParams.set('ggscoord', `${lat}|${lng}`);
  endpoint.searchParams.set('ggsradius', String(Math.max(10, Math.min(10_000, radiusMeters))));
  endpoint.searchParams.set('ggslimit', '100');
  endpoint.searchParams.set('ggsnamespace', '6');
  endpoint.searchParams.set('prop', 'coordinates|imageinfo');
  endpoint.searchParams.set('iiprop', 'url|timestamp|mime');

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA/1.0',
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return [];

  const payload: any = await response.json();
  const pages = payload?.query?.pages && typeof payload.query.pages === 'object'
    ? Object.values(payload.query.pages)
    : [];

  return pages.flatMap((page: any) => {
    const coordinate = Array.isArray(page?.coordinates) ? page.coordinates[0] : null;
    const latitude = Number(coordinate?.lat);
    const longitude = Number(coordinate?.lon);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return [];

    const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    return [{
      id: String(page?.pageid || page?.title || `${latitude},${longitude}`),
      title: String(page?.title || 'Wikimedia media'),
      latitude,
      longitude,
      provider: 'Wikimedia Commons',
      capturedAt: undefined,
      imageUrl: typeof imageInfo?.url === 'string' ? imageInfo.url : undefined,
      pageUrl: typeof imageInfo?.descriptionurl === 'string' ? imageInfo.descriptionurl : undefined,
      metadata: {
        namespace: page?.ns,
        mime: imageInfo?.mime,
        uploadTimestamp: imageInfo?.timestamp
          ? new Date(imageInfo.timestamp).toISOString()
          : undefined,
        coordinateType: coordinate?.type,
        coordinateName: coordinate?.name,
      },
    } satisfies PublicGeoMediaResult];
  });
}

export async function flickrNearbyMedia(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<PublicGeoMediaResult[]> {
  const apiKey = String(process.env.FLICKR_API_KEY || '').trim();
  if (!apiKey) return [];

  const endpoint = new URL('https://www.flickr.com/services/rest/');
  endpoint.searchParams.set('method', 'flickr.photos.search');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('nojsoncallback', '1');
  endpoint.searchParams.set('lat', String(lat));
  endpoint.searchParams.set('lon', String(lng));
  endpoint.searchParams.set('radius', String(Math.max(0.1, Math.min(32, radiusKm))));
  endpoint.searchParams.set('radius_units', 'km');
  endpoint.searchParams.set('has_geo', '1');
  endpoint.searchParams.set('per_page', '100');
  endpoint.searchParams.set('extras', 'geo,date_taken,date_upload,url_o,url_l,url_c,owner_name');

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LegalWhat-SPECTRA/1.0',
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return [];

  const payload: any = await response.json();
  const photos = Array.isArray(payload?.photos?.photo) ? payload.photos.photo : [];
  return photos.flatMap((photo: any) => {
    const latitude = Number(photo?.latitude);
    const longitude = Number(photo?.longitude);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90
      || longitude < -180 || longitude > 180
    ) return [];

    const taken = typeof photo?.datetaken === 'string' && Number.isFinite(Date.parse(photo.datetaken))
      ? new Date(photo.datetaken).toISOString()
      : undefined;
    return [{
      id: String(photo?.id || `${latitude},${longitude}`),
      title: String(photo?.title || 'Flickr photo'),
      latitude,
      longitude,
      provider: 'Flickr',
      capturedAt: taken,
      imageUrl: String(photo?.url_o || photo?.url_l || photo?.url_c || '') || undefined,
      pageUrl: photo?.owner && photo?.id
        ? `https://www.flickr.com/photos/${encodeURIComponent(String(photo.owner))}/${encodeURIComponent(String(photo.id))}`
        : undefined,
      accuracy: Number.isFinite(Number(photo?.accuracy)) ? Number(photo.accuracy) : undefined,
      metadata: {
        ownerName: photo?.ownername,
        dateUploaded: photo?.dateupload,
      },
    } satisfies PublicGeoMediaResult];
  });
}

/**
 * GET /api/geoconsole/public-geotagged-media
 * Public geotagged media around a map position. Results remain context evidence;
 * they are not promoted into a target observation without independent subject matching.
 */
router.get('/public-geotagged-media', async (req: Request, res: Response) => {
  const validation = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().min(10).max(32_000).default(5_000),
  }).safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({ success: false, error: 'Invalid media search coordinates' });
  }

  const { lat, lng, radiusMeters } = validation.data;
  const [wikimediaResult, flickrResult] = await Promise.allSettled([
    wikimediaNearbyMedia(lat, lng, radiusMeters),
    flickrNearbyMedia(lat, lng, radiusMeters / 1000),
  ]);

  const seen = new Set<string>();
  const media = [
    ...(wikimediaResult.status === 'fulfilled' ? wikimediaResult.value : []),
    ...(flickrResult.status === 'fulfilled' ? flickrResult.value : []),
  ].filter(item => {
    const key = `${item.provider}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);

  return res.json({
    success: true,
    data: media,
    providers: {
      wikimedia: true,
      flickr: Boolean(process.env.FLICKR_API_KEY),
    },
  });
});

router.get('/place-context', async (req: Request, res: Response) => {
  const validation = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().min(50).max(30_000).default(2_000),
  }).safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({ success: false, error: 'Invalid place-context coordinates' });
  }

  const { lat, lng, radiusMeters } = validation.data;
  const data = await acquireSpectraPlaceContext(lat, lng, radiusMeters);
  return res.json({
    success: true,
    data,
    providers: {
      openStreetMapOverpass: true,
      geoNames: Boolean(process.env.GEONAMES_USERNAME),
    },
  });
});

interface EnvironmentContextResult {
  weather?: Record<string, unknown>;
  earthObservation?: Array<Record<string, unknown>>;
}

export async function nwsLatestObservation(lat: number, lng: number): Promise<Record<string, unknown> | null> {
  const headers = {
    Accept: 'application/geo+json,application/json',
    'User-Agent': 'LegalWhat-SPECTRA/1.0',
  };

  try {
    const pointResponse = await fetch(`https://api.weather.gov/points/${lat},${lng}`, {
      headers,
      signal: AbortSignal.timeout(6_000),
    });
    if (!pointResponse.ok) return null;
    const point: any = await pointResponse.json();
    const stationsUrl = String(point?.properties?.observationStations || '').trim();
    if (!/^https:\/\/api\.weather\.gov\//i.test(stationsUrl)) return null;

    const stationResponse = await fetch(`${stationsUrl}?limit=1`, {
      headers,
      signal: AbortSignal.timeout(6_000),
    });
    if (!stationResponse.ok) return null;
    const stationPayload: any = await stationResponse.json();
    const station = Array.isArray(stationPayload?.features) ? stationPayload.features[0] : null;
    const stationId = String(station?.properties?.stationIdentifier || '').trim();
    if (!stationId) return null;

    const observationResponse = await fetch(
      `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
      {
        headers,
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!observationResponse.ok) return null;
    const observation: any = await observationResponse.json();
    const properties = observation?.properties || {};
    return {
      provider: 'National Weather Service',
      stationId,
      stationName: station?.properties?.name,
      observedAt: properties.timestamp,
      textDescription: properties.textDescription,
      temperatureC: properties.temperature?.value,
      relativeHumidityPct: properties.relativeHumidity?.value,
      windSpeedMps: properties.windSpeed?.value,
      windDirectionDegrees: properties.windDirection?.value,
      visibilityMeters: properties.visibility?.value,
      precipitationLastHourMm: properties.precipitationLastHour?.value,
    };
  } catch {
    return null;
  }
}

export async function copernicusItems(
  lat: number,
  lng: number,
  from: Date,
  to: Date,
): Promise<Array<Record<string, unknown>>> {
  const delta = 0.05;
  const endpoint = new URL('https://stac.dataspace.copernicus.eu/v1/search');
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox: [lng - delta, lat - delta, lng + delta, lat + delta],
    datetime: `${from.toISOString()}/${to.toISOString()}`,
    limit: 20,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    fields: {
      include: [
        'id',
        'collection',
        'bbox',
        'geometry',
        'properties.datetime',
        'properties.eo:cloud_cover',
        'properties.platform',
        'properties.instruments',
        'links',
      ],
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/geo+json,application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'LegalWhat-SPECTRA/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const payload: any = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    return features.map((feature: any) => ({
      provider: 'Copernicus Data Space',
      id: feature?.id,
      collection: feature?.collection,
      observedAt: feature?.properties?.datetime,
      cloudCover: feature?.properties?.eo?.cloud_cover ?? feature?.properties?.['eo:cloud_cover'],
      platform: feature?.properties?.platform,
      instruments: feature?.properties?.instruments,
      bbox: feature?.bbox,
      geometry: feature?.geometry,
      links: Array.isArray(feature?.links)
        ? feature.links
            .filter((link: any) => ['preview', 'thumbnail', 'self'].includes(String(link?.rel || '')))
            .slice(0, 5)
        : [],
    }));
  } catch {
    return [];
  }
}

/**
 * GET /api/geoconsole/environment-context
 * Independent time/place context from NWS observations and Copernicus STAC.
 */
router.get('/environment-context', async (req: Request, res: Response) => {
  const validation = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }).safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({ success: false, error: 'Invalid environment-context request' });
  }

  const now = new Date();
  const to = validation.data.to ? new Date(validation.data.to) : now;
  const from = validation.data.from
    ? new Date(validation.data.from)
    : new Date(to.getTime() - 24 * 60 * 60_000);
  if (from.getTime() > to.getTime()) {
    return res.status(400).json({ success: false, error: 'from must not be later than to' });
  }

  const [weatherOutcome, earthOutcome] = await Promise.allSettled([
    nwsLatestObservation(validation.data.lat, validation.data.lng),
    copernicusItems(validation.data.lat, validation.data.lng, from, to),
  ]);

  const data: EnvironmentContextResult = {
    weather: weatherOutcome.status === 'fulfilled' && weatherOutcome.value
      ? weatherOutcome.value
      : undefined,
    earthObservation: earthOutcome.status === 'fulfilled'
      ? earthOutcome.value
      : [],
  };

  return res.json({
    success: true,
    data,
    requestedWindow: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
});

/**
 * POST /api/geoconsole/process
 * Process raw location inputs through the full pipeline
 */
router.post('/process', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const validation = processRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { inputs, sessionId } = validation.data;
    const effectiveSessionId = sessionId || randomUUID();

    // Convert validated data to GPSPoint array
    const gpsPoints: GPSPoint[] = inputs.map(input =>
      normalizeClientEvidence({
        ...input,
        timestamp: input.timestamp,
        source: input.source as DataSource,
      })
    );

    const quality = assessLocationQuality(gpsPoints);
    const crawlerSelection = selectCrawlerPlan({
      purpose: 'map_evidence_render',
      targetCount: quality.acceptedCount,
    });

    log.info('Processing location data', {
      inputCount: gpsPoints.length,
      acceptedCount: quality.acceptedCount,
      sessionId: effectiveSessionId,
    });

    const result = await hybridGeoconsole.processLocationData(quality.points, effectiveSessionId);
    const signedFusedLocations = result.fusedLocations.map(location => ({
      ...location,
      point: signServerEvidence(location.point),
    }));
    const signedPrimaryFusedLocations = result.primaryFusedLocations.map(location => ({
      ...location,
      point: signServerEvidence(location.point),
    }));
    const signedTrailPoints = result.trail.points.map(trailPoint => ({
      ...trailPoint,
      position: signServerEvidence(trailPoint.position),
    }));
    const signedFuturecast = result.futurecast.map(signServerEvidence);

    res.json({
      success: true,
      data: {
        sessionId: effectiveSessionId,
        fusedLocations: signedFusedLocations,
        primaryFusedLocations: signedPrimaryFusedLocations,
        trail: {
          id: result.trail.id,
          pointCount: signedTrailPoints.length,
          startTime: result.trail.startTime,
          endTime: result.trail.endTime,
          totalDistance: result.trail.totalDistance,
          averageSpeed: result.trail.averageSpeed,
          maxSpeed: result.trail.maxSpeed,
          points: signedTrailPoints,
          segments: result.trail.segments,
          stops: result.trail.stops,
        },
        futurecast: signedFuturecast,
        inputQuality: {
          acceptedCount: quality.acceptedCount,
          rejectedCount: quality.rejectedCount,
          issues: quality.issues,
        },
        crawlerSelection,
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Process endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  }
});

/**
 * POST /api/geoconsole/report
 * Generate comprehensive intelligence report
 */
router.post('/report', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const validation = reportRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { sessionId, subject, timeRange } = validation.data;

    log.info('Generating intelligence report', { sessionId, subject });

    const report = await hybridGeoconsole.generateIntelligenceReport(
      sessionId,
      subject,
      timeRange
    );

    res.json({
      success: true,
      data: report,
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Report endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Report generation failed',
    });
  }
});

/**
 * GET /api/geoconsole/status
 * Get system status and orchestration state
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const state = hybridGeoconsole.getOrchestrationState();

    res.json({
      success: true,
      data: {
        status: 'operational',
        orchestration: state,
        capabilities: {
          multimodalFusion: true,
          uncertaintyAwareFusion: true,
          monteCarloInterpolation: true,
          futurecastPrediction: true,
          mapRenderer: 'maplibre',
          terrain3d: true,
          satelliteImagery: true,
          earthObservationTimeline: true,
          weatherRadarOverlay: true,
          streetImagery: true,
          publicCameraIntegration:
            Boolean(process.env.TRAFFICLAND_API_KEY && process.env.TRAFFICLAND_SYSTEM)
            || configuredArcGisCameraLayers().length > 0
            || configuredSpectraCameraJsonFeeds().length > 0,
        },
      },
    });
  } catch (error) {
    log.error('Status endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
    });
  }
});

/**
 * POST /api/geoconsole/config
 * Update system configuration
 */
router.post('/config', async (req: Request, res: Response) => {
  try {
    const validation = configUpdateSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration',
        details: validation.error.errors,
      });
    }

    hybridGeoconsole.updateConfig(validation.data);

    res.json({
      success: true,
      message: 'Configuration updated',
    });
  } catch (error) {
    log.error('Config endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
    });
  }
});

/**
 * POST /api/geoconsole/clear-cache
 * Clear all in-memory caches
 */
router.post('/clear-cache', async (req: Request, res: Response) => {
  try {
    hybridGeoconsole.clearCaches();

    res.json({
      success: true,
      message: 'All caches cleared',
    });
  } catch (error) {
    log.error('Clear cache endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear caches',
    });
  }
});

/**
 * POST /api/geoconsole/interpolate
 * Interpolate path between two points
 */
router.post('/interpolate', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const schema = z.object({
      startPoint: gpsPointSchema,
      endPoint: gpsPointSchema,
      config: z.object({
        iterations: z.number().int().min(100).max(1000).optional(),
        maxSpeed: z.number().min(1).max(100).optional(),
      }).optional(),
    });

    const validation = schema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { startPoint, endPoint, config } = validation.data;

    if (endPoint.timestamp.getTime() <= startPoint.timestamp.getTime()) {
      return res.status(400).json({
        success: false,
        error: 'Interpolation endPoint must be later than startPoint',
      });
    }

    // Use the Monte Carlo engine directly
    const { monteCarloPathEngine } = await import('../services/geoconsole/monteCarloPathEngine');
    
    const path = await monteCarloPathEngine.interpolatePath(
      normalizeClientEvidence({
        ...startPoint,
        source: startPoint.source as DataSource,
      }),
      normalizeClientEvidence({
        ...endPoint,
        source: endPoint.source as DataSource,
      }),
      config
    );

    res.json({
      success: true,
      data: {
        id: path.id,
        pointCount: path.interpolatedPoints.length,
        confidence: path.confidence,
        method: path.method,
        metadata: path.metadata,
        // Include simplified heatmap data
        probabilityHeatmap: {
          bounds: path.probabilityDistribution.bounds,
          peakProbability: path.probabilityDistribution.peakProbability,
        },
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Interpolate endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Interpolation failed',
    });
  }
});

/**
 * POST /api/geoconsole/futurecast
 * Generate future position predictions
 */
router.post('/futurecast', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const schema = z.object({
      recentPoints: z.array(gpsPointSchema).min(3).max(100),
      hours: z.number().min(1).max(1).optional(),
    });

    const validation = schema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { recentPoints, hours = 1 } = validation.data;

    const { monteCarloPathEngine } = await import('../services/geoconsole/monteCarloPathEngine');
    
    const gpsPoints: GPSPoint[] = recentPoints.map(p =>
      normalizeClientEvidence({
        ...p,
        source: p.source as DataSource,
      })
    );

    const futurecast = await monteCarloPathEngine.generateFuturecast(gpsPoints, hours);

    res.json({
      success: true,
      data: {
        predictions: futurecast.map(signServerEvidence),
        hours,
        confidence: futurecast.length > 0 
          ? futurecast.reduce((sum, p) => sum + p.confidence, 0) / futurecast.length 
          : 0,
      },
      metadata: {
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        cacheHit: false,
      },
    });
  } catch (error) {
    log.error('Futurecast endpoint error', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Futurecast failed',
    });
  }
});

export default router;
