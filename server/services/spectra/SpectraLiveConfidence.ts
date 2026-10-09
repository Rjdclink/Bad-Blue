import type { GPSPoint } from '../geoconsole/types';

export type SpectraLiveSourceFamily =
  | 'gnss'
  | 'managed-device'
  | 'carrier-network'
  | 'wifi'
  | 'uwb'
  | 'bluetooth'
  | 'cellular'
  | 'enterprise-sensor'
  | 'iot-solver'
  | 'visual-positioning'
  | 'vehicle';

export interface SpectraLiveSourceAssessment {
  family: SpectraLiveSourceFamily;
  source: GPSPoint['source'];
  provider?: string;
  observedAt: string;
  ageMs: number;
  accuracyMeters: number;
  accuracyConfidenceLevel: number;
  sigmaMeters: number;
  confidence: number;
  freshnessWeight: number;
  reliabilityWeight: number;
  robustWeight: number;
  residualMeters: number;
  normalizedResidual: number;
  temporalSkewMs: number;
  temporalInflationMeters: number;
  latitude: number;
  longitude: number;
}

export interface SpectraLiveLocationAssessment {
  status: 'unavailable' | 'stale' | 'estimated' | 'corroborated' | 'conflicted';
  isLive: boolean;
  confidenceScore: number;
  confidenceRadiusMeters95?: number;
  confidenceRadiusMeters99?: number;
  posteriorSigmaMeters?: number;
  effectiveSourceCount: number;
  independentFamilyCount: number;
  independentDomainCount: number;
  residualScale: number;
  consistencyScore: number;
  consistencyPenalty: number;
  freshnessScore: number;
  freshestAgeMs?: number;
  consensusCenter?: {
    latitude: number;
    longitude: number;
  };
  sources: SpectraLiveSourceAssessment[];
  reasons: string[];
}

interface PreparedMeasurement {
  family: SpectraLiveSourceFamily;
  point: GPSPoint;
  x: number;
  y: number;
  reportedAccuracyMeters: number;
  accuracyConfidenceLevel: number;
  sigmaMeters: number;
  freshnessWeight: number;
  reliabilityWeight: number;
  baseWeight: number;
  robustWeight: number;
  temporalSkewMs: number;
  temporalInflationMeters: number;
  correlationKey: string;
  correlationWeight: number;
  protectionLevelMeters?: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_ACCURACY_CONFIDENCE = 0.68;
const MIN_EVIDENCE_WEIGHT = 1e-6;
const MIN_LIVE_FRESHNESS_WEIGHT = 0.125;
const MAX_CONFIDENCE_SCORE = 0.999999;

const FAMILY_FRESHNESS_HALF_LIFE_MS: Record<SpectraLiveSourceFamily, number> = {
  gnss: 30_000,
  'managed-device': 90_000,
  'carrier-network': 120_000,
  wifi: 30_000,
  uwb: 20_000,
  bluetooth: 20_000,
  cellular: 90_000,
  'enterprise-sensor': 60_000,
  'iot-solver': 90_000,
  'visual-positioning': 20_000,
  vehicle: 30_000,
};

const FAMILY_RELIABILITY: Record<SpectraLiveSourceFamily, number> = {
  gnss: 0.985,
  'managed-device': 0.97,
  'carrier-network': 0.90,
  wifi: 0.96,
  uwb: 0.99,
  bluetooth: 0.985,
  cellular: 0.80,
  'enterprise-sensor': 0.93,
  'iot-solver': 0.94,
  'visual-positioning': 0.97,
  vehicle: 0.97,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const latitude1 = toRadians(latitudeA);
  const latitude2 = toRadians(latitudeB);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1)
    * Math.cos(latitude2)
    * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2
    * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function providerKind(point: GPSPoint): string {
  return String(point.metadata?.providerKind || '').trim().toLowerCase();
}

function sourceFamily(point: GPSPoint): SpectraLiveSourceFamily | null {
  const kind = providerKind(point);
  if (
    kind.includes('android-managed-lost-mode')
    || kind.includes('apple-managed-lost-mode')
  ) return 'managed-device';
  if (
    kind.includes('camara-location')
    || kind.includes('carrier-location')
    || point.metadata?.networkDerived === true
  ) return 'carrier-network';
  if (
    kind.includes('meraki-scanning')
    || kind.includes('cisco-spaces')
  ) return 'enterprise-sensor';
  if (kind.includes('aws-iot-device-location')) return 'iot-solver';
  if (kind.includes('connected-vehicle-location')) return 'vehicle';
  if (
    kind.includes('arcore-geospatial-pose')
    || kind.includes('visual-positioning')
    || point.source === 'visual_positioning'
  ) return 'visual-positioning';

  switch (point.source) {
    case 'device_gps':
    case 'gnss_fix':
      return 'gnss';
    case 'wifi_rtt':
    case 'wifi_rssi':
    case 'wifi_handoff':
    case 'wifi_fingerprint':
      return 'wifi';
    case 'uwb_range':
    case 'uwb_direction':
      return 'uwb';
    case 'bluetooth_proximity':
    case 'bluetooth_channel_sounding':
    case 'ble_rssi':
    case 'ble_aoa':
    case 'ble_aod':
      return 'bluetooth';
    case 'cellular':
    case 'cell_serving':
    case 'cell_neighbor':
    case 'nr_positioning':
      return 'cellular';
    case 'vehicle_telemetry':
      return 'vehicle';
    case 'network_region':
      return 'carrier-network';
    default:
      return null;
  }
}

function effectiveAccuracy(point: GPSPoint, family: SpectraLiveSourceFamily): number {
  const reported = Number(point.accuracy);
  if (Number.isFinite(reported) && reported > 0) {
    return Math.min(5_000_000, reported);
  }

  switch (family) {
    case 'uwb': return 2;
    case 'bluetooth': return point.source === 'bluetooth_channel_sounding' ? 2 : 10;
    case 'wifi': return point.source === 'wifi_rtt' ? 5 : 40;
    case 'gnss': return 20;
    case 'managed-device': return 30;
    case 'vehicle': return 30;
    case 'enterprise-sensor': return 50;
    case 'iot-solver': return 100;
    case 'visual-positioning': return 5;
    case 'cellular': return 2_000;
    case 'carrier-network': return 25_000;
  }
}

function accuracyConfidenceLevel(
  point: GPSPoint,
  family: SpectraLiveSourceFamily,
): number {
  const metadataValue = Number(
    point.metadata?.accuracyConfidenceLevel
    ?? point.metadata?.horizontalAccuracyConfidence
    ?? point.metadata?.confidenceLevel
  );
  if (Number.isFinite(metadataValue) && metadataValue > 0 && metadataValue < 1) {
    return clamp(metadataValue, 0.2, 0.9999);
  }

  // Android Location horizontal accuracy is documented at the 68th percentile.
  if (
    family === 'gnss'
    || family === 'managed-device'
    || point.metadata?.androidLocationAccuracy === true
  ) return 0.68;

  // Network service areas are often geometric bounds, not calibrated Gaussian radii.
  if (family === 'carrier-network') return 0.50;

  return DEFAULT_ACCURACY_CONFIDENCE;
}

function metadataCovarianceSigma(point: GPSPoint): number | null {
  const covariance = point.metadata?.covariance;
  if (!covariance || typeof covariance !== 'object') return null;
  const record = covariance as Record<string, unknown>;
  const east = Number(record.eastVariance ?? record.xx);
  const north = Number(record.northVariance ?? record.yy);
  if (!Number.isFinite(east) || !Number.isFinite(north) || east < 0 || north < 0) {
    return null;
  }
  return Math.sqrt(Math.max(0.0025, (east + north) / 2));
}

function horizontalProtectionLevel(point: GPSPoint): number | undefined {
  const value = Number(
    point.metadata?.horizontalProtectionLevelMeters
    ?? point.metadata?.hpl
  );
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function correlationKey(
  point: GPSPoint,
  family: SpectraLiveSourceFamily,
): string {
  const domain = String(
    point.metadata?.correlationDomain
    ?? point.metadata?.deviceRef
    ?? point.metadata?.vehicleRef
    ?? point.metadata?.peerRef
    ?? ''
  ).trim().toLowerCase();
  if (domain) return `domain:${domain}`;

  const provider = String(point.provenance?.provider || '').trim().toLowerCase();
  if (provider) return `provider:${provider}`;

  return `family:${family}`;
}

function radiusToSigma(radiusMeters: number, confidenceLevel: number): number {
  const denominator = Math.sqrt(
    Math.max(1e-12, -2 * Math.log(Math.max(1e-12, 1 - confidenceLevel))),
  );
  return Math.max(0.05, radiusMeters / denominator);
}

function confidenceRadius(sigmaMeters: number, probability: number): number {
  const multiplier = Math.sqrt(
    Math.max(0, -2 * Math.log(Math.max(1e-12, 1 - probability))),
  );
  return sigmaMeters * multiplier;
}

function measurementQualityWeight(point: GPSPoint): number {
  let weight = 1;
  const metadata = point.metadata || {};

  const integrity = metadata.integrity;
  if (integrity && typeof integrity === 'object') {
    const integrityRecord = integrity as Record<string, unknown>;
    const score = Number(integrityRecord.integrityScore);
    const readiness = Number(integrityRecord.precisionReadinessScore);
    if (Number.isFinite(score) && Number.isFinite(readiness)) {
      weight *= clamp(Math.sqrt(score * readiness), 0.10, 1);
    } else if (Number.isFinite(score)) {
      weight *= clamp(score, 0.10, 1);
    }
    if (integrityRecord.spoofingSuspected === true) weight *= 0.10;
    if (integrityRecord.jammingSuspected === true) weight *= 0.35;
    if (String(integrityRecord.navigationAuthenticationStatus || '').toLowerCase() === 'failed') {
      weight *= 0.25;
    }
  }

  const nlosProbability = Number(metadata.nlosProbability);
  if (Number.isFinite(nlosProbability)) {
    weight *= clamp(1 - nlosProbability, 0.05, 1);
  }

  const nadm = Number(metadata.normalizedAttackDetectorMetric);
  if (Number.isFinite(nadm) && nadm !== 255) {
    const nadmWeight =
      nadm <= 0 ? 1
      : nadm === 1 ? 0.995
      : nadm === 2 ? 0.97
      : nadm === 3 ? 0.70
      : nadm === 4 ? 0.30
      : nadm === 5 ? 0.10
      : 0.03;
    weight *= nadmWeight;
  }

  const ambiguityRatio = Number(metadata.ambiguityRatio);
  if (Number.isFinite(ambiguityRatio) && ambiguityRatio >= 0) {
    const ambiguityWeight = 0.75 + 0.25 * (1 - Math.exp(-ambiguityRatio / 3));
    weight *= clamp(ambiguityWeight, 0.75, 1);
  }

  const satellitesUsed = Number(metadata.satellitesUsed);
  if (Number.isFinite(satellitesUsed) && satellitesUsed > 0) {
    const satelliteWeight = 0.60 + 0.40 * (1 - Math.exp(-satellitesUsed / 8));
    weight *= clamp(satelliteWeight, 0.60, 1);
  }

  const hdop = Number(metadata.hdop);
  if (Number.isFinite(hdop) && hdop > 0) {
    weight *= clamp(1 / Math.sqrt(Math.max(1, hdop)), 0.25, 1);
  }

  const correctionAgeSeconds = Number(metadata.correctionAgeSeconds);
  if (Number.isFinite(correctionAgeSeconds) && correctionAgeSeconds >= 0) {
    weight *= Math.pow(0.5, correctionAgeSeconds / 30);
  }

  const attempted = Number(metadata.attemptedMeasurements);
  const successful = Number(metadata.successfulMeasurements);
  if (
    Number.isFinite(attempted)
    && attempted > 0
    && Number.isFinite(successful)
    && successful >= 0
  ) {
    weight *= clamp(successful / attempted, 0.1, 1);
  }

  if (
    metadata.solutionType === 'rtk-fixed'
    && metadata.ambiguitiesFixed === false
  ) {
    weight *= 0.5;
  }

  return clamp(weight, MIN_EVIDENCE_WEIGHT, 1);
}

function freshnessWeight(
  ageMs: number,
  family: SpectraLiveSourceFamily,
): number {
  if (ageMs <= 0) return 1;
  const halfLife = FAMILY_FRESHNESS_HALF_LIFE_MS[family];
  return clamp(Math.pow(0.5, ageMs / halfLife), MIN_EVIDENCE_WEIGHT, 1);
}

function velocityVector(point: GPSPoint): { eastMps: number; northMps: number } | null {
  const velocity = point.metadata?.velocity;
  if (!velocity || typeof velocity !== 'object') return null;
  const record = velocity as Record<string, unknown>;
  const speed = Number(record.speed ?? record.speedMetersPerSecond);
  const heading = Number(record.heading ?? record.headingDegrees);
  if (
    !Number.isFinite(speed)
    || speed < 0
    || !Number.isFinite(heading)
  ) return null;

  const headingRadians = toRadians((heading % 360 + 360) % 360);
  return {
    eastMps: Math.sin(headingRadians) * speed,
    northMps: Math.cos(headingRadians) * speed,
  };
}

function timestampUncertaintySeconds(point: GPSPoint): number {
  const directMs = Number(point.metadata?.timestampUncertaintyMillis);
  if (Number.isFinite(directMs) && directMs >= 0) return directMs / 1000;

  const clock = point.metadata?.clock;
  if (clock && typeof clock === 'object') {
    const nanos = Number(
      (clock as Record<string, unknown>).elapsedRealtimeUncertaintyNanos
    );
    if (Number.isFinite(nanos) && nanos >= 0) return nanos / 1_000_000_000;
  }

  const nanos = Number(point.metadata?.elapsedRealtimeUncertaintyNanos);
  return Number.isFinite(nanos) && nanos >= 0
    ? nanos / 1_000_000_000
    : 0;
}

function accelerationSigmaMetersPerSecondSquared(
  family: SpectraLiveSourceFamily,
): number {
  switch (family) {
    case 'vehicle': return 3.0;
    case 'managed-device':
    case 'gnss':
    case 'wifi':
    case 'uwb':
    case 'bluetooth':
    case 'enterprise-sensor':
    case 'visual-positioning': return 1.5;
    case 'cellular':
    case 'carrier-network':
    case 'iot-solver': return 2.5;
  }
}

function unknownMotionSigmaMetersPerSecond(
  family: SpectraLiveSourceFamily,
): number {
  switch (family) {
    case 'vehicle': return 8;
    case 'cellular':
    case 'carrier-network': return 6;
    case 'visual-positioning': return 2;
    default: return 2.5;
  }
}

function localMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const originLatitudeRadians = toRadians(originLatitude);
  return {
    x: toRadians(longitude - originLongitude)
      * EARTH_RADIUS_METERS
      * Math.max(0.05, Math.cos(originLatitudeRadians)),
    y: toRadians(latitude - originLatitude) * EARTH_RADIUS_METERS,
  };
}

function geoFromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const originLatitudeRadians = toRadians(originLatitude);
  return {
    latitude: originLatitude + y / EARTH_RADIUS_METERS * 180 / Math.PI,
    longitude:
      originLongitude
      + x
      / (EARTH_RADIUS_METERS * Math.max(0.05, Math.cos(originLatitudeRadians)))
      * 180 / Math.PI,
  };
}

function selectFamilyRepresentative(
  points: GPSPoint[],
  family: SpectraLiveSourceFamily,
  nowMs: number,
): GPSPoint | null {
  let selected: GPSPoint | null = null;
  let selectedInformation = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const timestampMs = point.timestamp.getTime();
    if (!Number.isFinite(timestampMs) || timestampMs > nowMs + 5_000) continue;

    const ageMs = Math.max(0, nowMs - timestampMs);
    const accuracy = effectiveAccuracy(point, family);
    const level = accuracyConfidenceLevel(point, family);
    const sigma = metadataCovarianceSigma(point) ?? radiusToSigma(accuracy, level);
    const fresh = freshnessWeight(ageMs, family);
    const reliability = clamp(
      FAMILY_RELIABILITY[family]
      * clamp(point.confidence, 0.01, 1)
      * fresh
      * measurementQualityWeight(point),
      MIN_EVIDENCE_WEIGHT,
      1,
    );
    const information = reliability / Math.max(0.0025, sigma ** 2);

    if (information > selectedInformation) {
      selected = point;
      selectedInformation = information;
    }
  }

  return selected;
}

function effectiveSampleSize(weights: number[]): number {
  const positive = weights.filter(weight => Number.isFinite(weight) && weight > 0);
  if (!positive.length) return 0;
  const sum = positive.reduce((total, weight) => total + weight, 0);
  const sumSquares = positive.reduce((total, weight) => total + weight ** 2, 0);
  return sumSquares > 0 ? (sum ** 2) / sumSquares : 0;
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun approximation to the standard normal CDF.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erfApprox = 1 - (
    (
      (
        (
          (1.061405429 * t - 1.453152027) * t
          + 1.421413741
        ) * t - 0.284496736
      ) * t + 0.254829592
    ) * t
  ) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erfApprox);
}

function chiSquareSurvivalApprox(statistic: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(statistic) || statistic < 0) return 0;
  if (degreesOfFreedom <= 0) return 1;
  // Wilson-Hilferty transform approximates a chi-square variable with a normal.
  const k = degreesOfFreedom;
  const z = (
    Math.cbrt(statistic / k)
    - (1 - 2 / (9 * k))
  ) / Math.sqrt(2 / (9 * k));
  return clamp(1 - normalCdf(z), 0, 1);
}

function combinedIndependentReliability(
  measurements: PreparedMeasurement[],
): number {
  const strongestByDomain = new Map<string, number>();

  for (const measurement of measurements) {
    // Reliability is combined once per independent correlation domain.
    // The spatial information matrix already applies the 1/N common-mode
    // discount, so applying it again here would artificially lower a domain's
    // reliability merely because it emitted multiple correlated modalities.
    const effective = clamp(
      measurement.reliabilityWeight
      * measurement.robustWeight,
      0,
      0.999999,
    );
    strongestByDomain.set(
      measurement.correlationKey,
      Math.max(strongestByDomain.get(measurement.correlationKey) || 0, effective),
    );
  }

  let missProbability = 1;
  for (const effective of strongestByDomain.values()) {
    missProbability *= 1 - effective;
  }
  return clamp(1 - missProbability, 0, MAX_CONFIDENCE_SCORE);
}

export function assessSpectraLiveLocation(
  observations: GPSPoint[],
  now: Date = new Date(),
): SpectraLiveLocationAssessment {
  const nowMs = now.getTime();
  const grouped = new Map<
    string,
    { family: SpectraLiveSourceFamily; points: GPSPoint[] }
  >();

  for (const point of observations) {
    const family = sourceFamily(point);
    if (!family) continue;
    const domain = correlationKey(point, family);
    const key = `${family}|${domain}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.points.push(point);
    } else {
      grouped.set(key, { family, points: [point] });
    }
  }

  const representatives = [...grouped.values()].flatMap(({ family, points }) => {
    const point = selectFamilyRepresentative(points, family, nowMs);
    return point ? [{ family, point }] : [];
  });

  if (!representatives.length) {
    const hadSupportedSources = [...grouped.values()].some(group => group.points.length > 0);
    return {
      status: hadSupportedSources ? 'stale' : 'unavailable',
      isLive: false,
      confidenceScore: 0,
      effectiveSourceCount: 0,
      independentFamilyCount: 0,
      independentDomainCount: 0,
      residualScale: 0,
      consistencyScore: 0,
      consistencyPenalty: 0,
      freshnessScore: 0,
      sources: [],
      reasons: [
        hadSupportedSources
          ? 'Supported location observations exist but their temporal weight has decayed below the live evidence floor.'
          : 'No supported live-location observations are available.',
      ],
    };
  }

  const fusionEpochMs = Math.max(
    ...representatives.map(item => item.point.timestamp.getTime()),
  );

  const originLatitude = representatives.reduce(
    (sum, item) => sum + item.point.latitude,
    0,
  ) / representatives.length;
  const originLongitude = representatives.reduce(
    (sum, item) => sum + item.point.longitude,
    0,
  ) / representatives.length;

  const prepared: PreparedMeasurement[] = representatives.map(({ family, point }) => {
    const local = localMeters(
      point.latitude,
      point.longitude,
      originLatitude,
      originLongitude,
    );
    const pointTimeMs = point.timestamp.getTime();
    const ageMs = Math.max(0, nowMs - pointTimeMs);
    const temporalSkewMs = Math.max(0, fusionEpochMs - pointTimeMs);
    const temporalSkewSeconds = temporalSkewMs / 1000;
    const accuracy = effectiveAccuracy(point, family);
    const level = accuracyConfidenceLevel(point, family);
    const spatialSigma =
      metadataCovarianceSigma(point)
      ?? radiusToSigma(accuracy, level);
    const velocity = velocityVector(point);
    const timeUncertaintySeconds = timestampUncertaintySeconds(point);
    const accelerationSigma =
      accelerationSigmaMetersPerSecondSquared(family);
    const temporalInflationMeters = velocity
      ? Math.hypot(
          Math.hypot(velocity.eastMps, velocity.northMps) * timeUncertaintySeconds,
          0.5 * accelerationSigma * temporalSkewSeconds ** 2,
        )
      : Math.hypot(
          unknownMotionSigmaMetersPerSecond(family) * temporalSkewSeconds,
          unknownMotionSigmaMetersPerSecond(family) * timeUncertaintySeconds,
        );
    const sigma = Math.hypot(spatialSigma, temporalInflationMeters);
    const alignedX = velocity
      ? local.x + velocity.eastMps * temporalSkewSeconds
      : local.x;
    const alignedY = velocity
      ? local.y + velocity.northMps * temporalSkewSeconds
      : local.y;
    const fresh = freshnessWeight(ageMs, family);
    const reliability = clamp(
      FAMILY_RELIABILITY[family]
      * clamp(point.confidence, 0.01, 1)
      * fresh
      * measurementQualityWeight(point),
      MIN_EVIDENCE_WEIGHT,
      1,
    );
    return {
      family,
      point,
      x: alignedX,
      y: alignedY,
      reportedAccuracyMeters: accuracy,
      accuracyConfidenceLevel: level,
      sigmaMeters: sigma,
      freshnessWeight: fresh,
      reliabilityWeight: reliability,
      baseWeight: reliability / Math.max(0.0025, sigma ** 2),
      robustWeight: 1,
      temporalSkewMs,
      temporalInflationMeters,
      correlationKey: correlationKey(point, family),
      correlationWeight: 1,
      protectionLevelMeters: horizontalProtectionLevel(point),
    };
  });

  const correlationCounts = new Map<string, number>();
  for (const measurement of prepared) {
    correlationCounts.set(
      measurement.correlationKey,
      (correlationCounts.get(measurement.correlationKey) || 0) + 1,
    );
  }
  for (const measurement of prepared) {
    const count = correlationCounts.get(measurement.correlationKey) || 1;
    measurement.correlationWeight = 1 / count;
    measurement.baseWeight *= measurement.correlationWeight;
  }

  let centerX = 0;
  let centerY = 0;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (const measurement of prepared) {
      const weight = measurement.baseWeight * measurement.robustWeight;
      totalWeight += weight;
      weightedX += measurement.x * weight;
      weightedY += measurement.y * weight;
    }

    if (totalWeight <= 0) break;
    centerX = weightedX / totalWeight;
    centerY = weightedY / totalWeight;

    for (const measurement of prepared) {
      const residual = Math.hypot(
        measurement.x - centerX,
        measurement.y - centerY,
      );
      const normalizedResidual = residual / Math.max(0.1, measurement.sigmaMeters);
      // Huber-style continuous down-weighting; no binary inlier threshold.
      measurement.robustWeight = normalizedResidual <= 1.5
        ? 1
        : 1.5 / normalizedResidual;
    }
  }

  const informationSum = prepared.reduce(
    (sum, measurement) =>
      sum + measurement.baseWeight * measurement.robustWeight,
    0,
  );
  const nominalPosteriorSigma = informationSum > 0
    ? Math.sqrt(1 / informationSum)
    : Number.POSITIVE_INFINITY;

  let weightedResidualStatistic = 0;
  let totalResidualWeight = 0;
  const sourceAssessments: SpectraLiveSourceAssessment[] = prepared.map(measurement => {
    const residual = Math.hypot(
      measurement.x - centerX,
      measurement.y - centerY,
    );
    const normalizedResidual = residual / Math.max(0.1, measurement.sigmaMeters);
    const weight = measurement.reliabilityWeight * measurement.robustWeight;
    weightedResidualStatistic += normalizedResidual ** 2 * weight;
    totalResidualWeight += weight;

    return {
      family: measurement.family,
      source: measurement.point.source,
      provider: measurement.point.provenance?.provider,
      observedAt: measurement.point.timestamp.toISOString(),
      ageMs: Math.max(0, nowMs - measurement.point.timestamp.getTime()),
      accuracyMeters: measurement.reportedAccuracyMeters,
      accuracyConfidenceLevel: measurement.accuracyConfidenceLevel,
      sigmaMeters: measurement.sigmaMeters,
      confidence: measurement.point.confidence,
      freshnessWeight: measurement.freshnessWeight,
      reliabilityWeight: measurement.reliabilityWeight,
      robustWeight: measurement.robustWeight,
      residualMeters: residual,
      normalizedResidual,
      temporalSkewMs: measurement.temporalSkewMs,
      temporalInflationMeters: measurement.temporalInflationMeters,
      latitude: measurement.point.latitude,
      longitude: measurement.point.longitude,
    };
  });

  const effectiveCount = effectiveSampleSize(
    prepared.map(measurement => measurement.baseWeight * measurement.robustWeight),
  );
  const degreesOfFreedom = Math.max(1, 2 * prepared.length - 2);
  const consistencyScore = chiSquareSurvivalApprox(
    weightedResidualStatistic,
    degreesOfFreedom,
  );
  const residualScale = Math.max(
    1,
    Math.sqrt(
      weightedResidualStatistic
      / Math.max(1e-9, totalResidualWeight * Math.max(1, effectiveCount - 1)),
    ),
  );

  const posteriorSigma = Number.isFinite(nominalPosteriorSigma)
    ? nominalPosteriorSigma * residualScale
    : Number.POSITIVE_INFINITY;

  const protectionLevelFloor = prepared.reduce((maximum, measurement) =>
    Math.max(maximum, measurement.protectionLevelMeters || 0)
  , 0);

  const center = geoFromLocalMeters(
    centerX,
    centerY,
    originLatitude,
    originLongitude,
  );

  const freshnessScore = prepared.reduce(
    (sum, measurement) => sum + measurement.freshnessWeight,
    0,
  ) / prepared.length;
  const independentReliability = combinedIndependentReliability(prepared);

  // A chi-square survival probability is a diagnostic p-value, not the
  // probability that the position is correct. Do not multiply by it directly.
  // Penalize only statistically abnormal residual inconsistency while leaving
  // normally distributed residuals neutral.
  const consistencyPenalty = consistencyScore >= 0.05
    ? 1
    : Math.sqrt(clamp(consistencyScore / 0.05, 0, 1));

  const confidenceScore = clamp(
    independentReliability
    * consistencyPenalty
    * Math.sqrt(clamp(freshnessScore, 0, 1)),
    0,
    MAX_CONFIDENCE_SCORE,
  );

  const reasons: string[] = [];
  if (correlationCounts.size === 1) {
    reasons.push('The estimate is supported by one correlation domain; independent corroboration is not established.');
  }
  if (consistencyScore < 0.05) {
    reasons.push('Independent source residuals are statistically inconsistent.');
  }
  if (freshnessScore < 0.5) {
    reasons.push('Temporal decay materially reduces the weight of the available observations.');
  }
  if (residualScale > 2) {
    reasons.push('Posterior uncertainty was inflated because source residuals exceed their reported uncertainty.');
  }
  if (correlationCounts.size < prepared.length) {
    reasons.push('Correlated upstream observations were de-weighted to prevent confidence double-counting.');
  }
  if (protectionLevelFloor > 0) {
    reasons.push('The reported 99% radius is not allowed below the supplied horizontal protection level.');
  }
  if (
    prepared.some(measurement =>
      measurement.temporalInflationMeters
      > Math.max(0.25, measurement.sigmaMeters * 0.5)
    )
  ) {
    reasons.push('Measurement-time separation materially increased posterior uncertainty.');
  }

  const freshestAgeMs = Math.min(
    ...sourceAssessments.map(source => source.ageMs),
  );

  const maxFreshnessWeight = Math.max(
    ...prepared.map(measurement => measurement.freshnessWeight),
  );
  const isLive = maxFreshnessWeight >= MIN_LIVE_FRESHNESS_WEIGHT;

  const status: SpectraLiveLocationAssessment['status'] =
    !isLive ? 'stale'
    : consistencyScore < 0.01 ? 'conflicted'
    : correlationCounts.size >= 2 ? 'corroborated'
    : 'estimated';

  return {
    status,
    isLive,
    confidenceScore: Number(confidenceScore.toFixed(6)),
    confidenceRadiusMeters95: Number(
      confidenceRadius(posteriorSigma, 0.95).toFixed(3),
    ),
    confidenceRadiusMeters99: Number(
      Math.max(
        confidenceRadius(posteriorSigma, 0.99),
        protectionLevelFloor,
      ).toFixed(3),
    ),
    posteriorSigmaMeters: Number(posteriorSigma.toFixed(3)),
    effectiveSourceCount: Number(effectiveCount.toFixed(3)),
    independentFamilyCount: new Set(prepared.map(item => item.family)).size,
    independentDomainCount: new Set(prepared.map(item => item.correlationKey)).size,
    residualScale: Number(residualScale.toFixed(3)),
    consistencyScore: Number(consistencyScore.toFixed(6)),
    consistencyPenalty: Number(consistencyPenalty.toFixed(6)),
    freshnessScore: Number(freshnessScore.toFixed(6)),
    freshestAgeMs,
    consensusCenter: {
      latitude: center.latitude,
      longitude: center.longitude,
    },
    sources: sourceAssessments,
    reasons,
  };
}
