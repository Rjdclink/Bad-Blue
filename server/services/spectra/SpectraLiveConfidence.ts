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
  | 'vehicle';

export interface SpectraLiveSourceAssessment {
  family: SpectraLiveSourceFamily;
  source: GPSPoint['source'];
  provider?: string;
  observedAt: string;
  ageMs: number;
  accuracyMeters: number;
  confidence: number;
  latitude: number;
  longitude: number;
  supportsConsensus: boolean;
}

export interface SpectraLiveLocationAssessment {
  status: 'unavailable' | 'stale' | 'single-source' | 'corroborated' | 'high-confidence' | 'contradicted';
  isLive: boolean;
  confidenceScore: number;
  exceedsNinetyNinePercent: boolean;
  independentFamilyCount: number;
  strongConsensusFamilyCount: number;
  contradictionCount: number;
  freshestAgeMs?: number;
  consensusCenter?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  sources: SpectraLiveSourceAssessment[];
  reasons: string[];
}

const EARTH_RADIUS_METERS = 6_371_000;

const FAMILY_FRESHNESS_MS: Record<SpectraLiveSourceFamily, number> = {
  gnss: 30_000,
  'managed-device': 90_000,
  'carrier-network': 120_000,
  wifi: 30_000,
  uwb: 20_000,
  bluetooth: 20_000,
  cellular: 90_000,
  'enterprise-sensor': 60_000,
  'iot-solver': 90_000,
  vehicle: 30_000,
};

const FAMILY_RELIABILITY: Record<SpectraLiveSourceFamily, number> = {
  gnss: 0.985,
  'managed-device': 0.97,
  'carrier-network': 0.93,
  wifi: 0.96,
  uwb: 0.99,
  bluetooth: 0.985,
  cellular: 0.80,
  'enterprise-sensor': 0.93,
  'iot-solver': 0.94,
  vehicle: 0.97,
};

const HIGH_PRECISION_FAMILIES = new Set<SpectraLiveSourceFamily>([
  'gnss',
  'managed-device',
  'wifi',
  'uwb',
  'bluetooth',
  'vehicle',
]);

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
  if (Number.isFinite(reported) && reported > 0) return Math.min(5_000_000, reported);

  switch (family) {
    case 'uwb': return 2;
    case 'bluetooth': return point.source === 'bluetooth_channel_sounding' ? 2 : 10;
    case 'wifi': return point.source === 'wifi_rtt' ? 5 : 40;
    case 'gnss': return 20;
    case 'managed-device': return 30;
    case 'vehicle': return 30;
    case 'enterprise-sensor': return 50;
    case 'iot-solver': return 100;
    case 'cellular': return 2_000;
    case 'carrier-network': return 25_000;
  }
}

function familyRepresentative(
  points: GPSPoint[],
  family: SpectraLiveSourceFamily,
  nowMs: number,
): GPSPoint | null {
  const freshnessLimit = FAMILY_FRESHNESS_MS[family];
  return points
    .filter(point => {
      const timestampMs = point.timestamp.getTime();
      return Number.isFinite(timestampMs)
        && timestampMs <= nowMs + 5_000
        && nowMs - timestampMs <= freshnessLimit;
    })
    .sort((left, right) => {
      const leftAccuracy = effectiveAccuracy(left, family);
      const rightAccuracy = effectiveAccuracy(right, family);
      const accuracyDifference = leftAccuracy - rightAccuracy;
      if (Math.abs(accuracyDifference) > 0.01) return accuracyDifference;
      const confidenceDifference = right.confidence - left.confidence;
      if (Math.abs(confidenceDifference) > 0.001) return confidenceDifference;
      return right.timestamp.getTime() - left.timestamp.getTime();
    })[0] || null;
}

function agreementRadiusMeters(
  firstAccuracy: number,
  secondAccuracy: number,
): number {
  const combined = Math.sqrt(firstAccuracy ** 2 + secondAccuracy ** 2);
  return Math.max(10, Math.min(500, combined * 2.25));
}

function contradictionRadiusMeters(
  firstAccuracy: number,
  secondAccuracy: number,
): number {
  const combined = Math.sqrt(firstAccuracy ** 2 + secondAccuracy ** 2);
  return Math.max(100, Math.min(2_000, combined * 3.5));
}

function combinedIndependentConfidence(
  assessments: SpectraLiveSourceAssessment[],
  freshestAgeMs: number,
): number {
  let missProbability = 1;
  for (const assessment of assessments) {
    const reliability = FAMILY_RELIABILITY[assessment.family];
    const observationConfidence = Math.max(0.05, Math.min(0.999, assessment.confidence));
    const accuracyPenalty =
      assessment.accuracyMeters <= 10 ? 1
      : assessment.accuracyMeters <= 50 ? 0.98
      : assessment.accuracyMeters <= 100 ? 0.95
      : assessment.accuracyMeters <= 500 ? 0.88
      : assessment.accuracyMeters <= 2_000 ? 0.70
      : 0.45;
    const effective = Math.max(
      0.05,
      Math.min(0.999, reliability * observationConfidence * accuracyPenalty),
    );
    missProbability *= 1 - effective;
  }

  const freshnessPenalty =
    freshestAgeMs <= 10_000 ? 1
    : freshestAgeMs <= 30_000 ? 0.995
    : freshestAgeMs <= 60_000 ? 0.985
    : 0.96;

  return Math.max(0, Math.min(0.9999, (1 - missProbability) * freshnessPenalty));
}

export function assessSpectraLiveLocation(
  observations: GPSPoint[],
  now: Date = new Date(),
): SpectraLiveLocationAssessment {
  const nowMs = now.getTime();
  const grouped = new Map<SpectraLiveSourceFamily, GPSPoint[]>();

  for (const point of observations) {
    const family = sourceFamily(point);
    if (!family) continue;
    const bucket = grouped.get(family) || [];
    bucket.push(point);
    grouped.set(family, bucket);
  }

  const representatives = [...grouped.entries()].flatMap(([family, points]) => {
    const point = familyRepresentative(points, family, nowMs);
    return point ? [{ family, point }] : [];
  });

  if (!representatives.length) {
    const hadSupportedSources = [...grouped.values()].some(points => points.length > 0);
    return {
      status: hadSupportedSources ? 'stale' : 'unavailable',
      isLive: false,
      confidenceScore: 0,
      exceedsNinetyNinePercent: false,
      independentFamilyCount: 0,
      strongConsensusFamilyCount: 0,
      contradictionCount: 0,
      sources: [],
      reasons: [
        hadSupportedSources
          ? 'Supported location evidence exists, but no observation is within its live freshness window.'
          : 'No supported live-location source families are available.',
      ],
    };
  }

  const sorted = [...representatives].sort((left, right) => {
    const leftAccuracy = effectiveAccuracy(left.point, left.family);
    const rightAccuracy = effectiveAccuracy(right.point, right.family);
    return leftAccuracy - rightAccuracy
      || right.point.confidence - left.point.confidence
      || right.point.timestamp.getTime() - left.point.timestamp.getTime();
  });

  const anchor = sorted[0];
  const anchorAccuracy = effectiveAccuracy(anchor.point, anchor.family);
  const assessments: SpectraLiveSourceAssessment[] = [];
  const consensus: typeof sorted = [];
  let contradictionCount = 0;

  for (const candidate of sorted) {
    const accuracy = effectiveAccuracy(candidate.point, candidate.family);
    const distance = distanceMeters(
      anchor.point.latitude,
      anchor.point.longitude,
      candidate.point.latitude,
      candidate.point.longitude,
    );
    const agrees = distance <= agreementRadiusMeters(anchorAccuracy, accuracy);
    const strongConflict =
      accuracy <= 500
      && anchorAccuracy <= 500
      && distance > contradictionRadiusMeters(anchorAccuracy, accuracy);

    if (agrees) consensus.push(candidate);
    if (strongConflict) contradictionCount += 1;

    assessments.push({
      family: candidate.family,
      source: candidate.point.source,
      provider: candidate.point.provenance?.provider,
      observedAt: candidate.point.timestamp.toISOString(),
      ageMs: Math.max(0, nowMs - candidate.point.timestamp.getTime()),
      accuracyMeters: accuracy,
      confidence: candidate.point.confidence,
      latitude: candidate.point.latitude,
      longitude: candidate.point.longitude,
      supportsConsensus: agrees,
    });
  }

  const consensusAssessments = assessments.filter(item => item.supportsConsensus);
  const strongConsensus = consensusAssessments.filter(item =>
    item.accuracyMeters <= 100
    && item.confidence >= 0.65
  );
  const precisionFamilyCount = new Set(
    strongConsensus
      .filter(item => HIGH_PRECISION_FAMILIES.has(item.family))
      .map(item => item.family),
  ).size;
  const freshestAgeMs = Math.min(...assessments.map(item => item.ageMs));

  let weightedLatitude = 0;
  let weightedLongitude = 0;
  let totalWeight = 0;
  for (const item of consensusAssessments) {
    const weight = 1 / Math.max(1, item.accuracyMeters ** 2);
    weightedLatitude += item.latitude * weight;
    weightedLongitude += item.longitude * weight;
    totalWeight += weight;
  }
  const center =
    totalWeight > 0
      ? {
          latitude: weightedLatitude / totalWeight,
          longitude: weightedLongitude / totalWeight,
        }
      : {
          latitude: anchor.point.latitude,
          longitude: anchor.point.longitude,
        };

  const consensusRadius = consensusAssessments.reduce((radius, item) => {
    const spread = distanceMeters(
      center.latitude,
      center.longitude,
      item.latitude,
      item.longitude,
    );
    return Math.max(radius, spread + item.accuracyMeters);
  }, 0);

  const reasons: string[] = [];
  if (contradictionCount > 0) {
    reasons.push('Fresh high-quality source families materially contradict one another.');
  }
  if (consensusAssessments.length < 2) {
    reasons.push('A live fix requires agreement from at least two independent source families.');
  }
  if (strongConsensus.length < 3) {
    reasons.push('A score above 99% requires at least three independent high-quality source families within 100 m reported accuracy.');
  }
  if (precisionFamilyCount < 2) {
    reasons.push('A score above 99% requires at least two independent precision-ranging/GNSS source families.');
  }
  if (freshestAgeMs > 30_000) {
    reasons.push('The freshest corroborating observation is older than 30 seconds.');
  }

  let score = combinedIndependentConfidence(consensusAssessments, freshestAgeMs);

  if (contradictionCount > 0) {
    score = Math.min(score, 0.69);
  } else if (consensusAssessments.length < 2) {
    score = Math.min(score, 0.89);
  } else if (strongConsensus.length < 3 || precisionFamilyCount < 2 || freshestAgeMs > 30_000) {
    score = Math.min(score, 0.989);
  } else {
    score = Math.max(score, 0.991);
  }

  const exceedsNinetyNinePercent =
    score > 0.99
    && contradictionCount === 0
    && strongConsensus.length >= 3
    && precisionFamilyCount >= 2
    && freshestAgeMs <= 30_000;

  const status: SpectraLiveLocationAssessment['status'] =
    contradictionCount > 0 ? 'contradicted'
    : exceedsNinetyNinePercent ? 'high-confidence'
    : consensusAssessments.length >= 2 ? 'corroborated'
    : 'single-source';

  return {
    status,
    isLive: true,
    confidenceScore: Number(score.toFixed(4)),
    exceedsNinetyNinePercent,
    independentFamilyCount: assessments.length,
    strongConsensusFamilyCount: strongConsensus.length,
    contradictionCount,
    freshestAgeMs,
    consensusCenter: {
      latitude: center.latitude,
      longitude: center.longitude,
      radiusMeters: Math.max(1, consensusRadius),
    },
    sources: assessments,
    reasons,
  };
}
