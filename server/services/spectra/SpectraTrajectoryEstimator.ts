import type { GPSPoint } from '../geoconsole/types';

const EARTH_RADIUS_METERS = 6_378_137;
const RADIAL_99_FACTOR = Math.sqrt(-2 * Math.log(0.01));

export interface SpectraTrajectoryDependencyGroup {
  id: string;
  observationCount: number;
  sources: string[];
  providers: string[];
}

export interface SpectraTrajectoryDiagnostics {
  model: 'constant_velocity_rts_fixed_lag';
  fixedLagSeconds: number;
  inputObservationCount: number;
  measurementBucketCount: number;
  independentDomainCount: number;
  correlatedObservationCount: number;
  contradictionCount: number;
  motionConstraintViolations: number;
  latestRadius99Meters?: number;
  latestSpeedMps?: number;
  dependencyGroups: SpectraTrajectoryDependencyGroup[];
}

export interface SpectraTrajectoryEstimate {
  states: GPSPoint[];
  latest?: GPSPoint;
  diagnostics: SpectraTrajectoryDiagnostics;
}

interface LocalMeasurement {
  timestamp: Date;
  x: number;
  y: number;
  variance: number;
  confidence: number;
  supportPointCount: number;
  supportDomainCount: number;
  spreadMeters: number;
}

interface AxisRecord {
  timestamp: Date;
  measurement: LocalMeasurement;
  filteredState: [number, number];
  filteredCovariance: Matrix2;
  predictedState: [number, number];
  predictedCovariance: Matrix2;
  transitionFromPrevious: Matrix2;
  robustInflation: number;
  motionViolation: boolean;
  contradiction: boolean;
}

type Matrix2 = [[number, number], [number, number]];

export interface SpectraTrajectoryEstimatorOptions {
  fixedLagSeconds?: number;
  temporalBucketMs?: number;
  maxSpeedMps?: number;
  accelerationSigmaMps2?: number;
  maxStates?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validCoordinate(point: GPSPoint): boolean {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180
    && Number.isFinite(point.timestamp.getTime());
}

function localMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const originLatitudeRadians = originLatitude * Math.PI / 180;
  return {
    x: (longitude - originLongitude)
      * Math.PI / 180
      * EARTH_RADIUS_METERS
      * Math.cos(originLatitudeRadians),
    y: (latitude - originLatitude)
      * Math.PI / 180
      * EARTH_RADIUS_METERS,
  };
}

function geoFromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const originLatitudeRadians = originLatitude * Math.PI / 180;
  const longitudeScale = Math.max(0.05, Math.cos(originLatitudeRadians));
  return {
    latitude: originLatitude + y / EARTH_RADIUS_METERS * 180 / Math.PI,
    longitude: originLongitude
      + x / (EARTH_RADIUS_METERS * longitudeScale) * 180 / Math.PI,
  };
}

function sourceAccuracyDefault(point: GPSPoint): number {
  switch (point.source) {
    case 'uwb_range':
    case 'uwb_direction':
    case 'bluetooth_channel_sounding':
      return 1;
    case 'wifi_rtt':
      return 3;
    case 'gnss_fix':
    case 'device_gps':
      return 10;
    case 'browser_geolocation':
      return 25;
    case 'ble_aoa':
    case 'ble_aod':
      return 8;
    case 'wifi_fingerprint':
      return 35;
    case 'wifi_rssi':
    case 'wifi_handoff':
      return 80;
    case 'nr_positioning':
      return 15;
    case 'cell_serving':
    case 'cell_neighbor':
    case 'cellular':
      return 1_500;
    case 'network_region':
      return 25_000;
    case 'vehicle_telemetry':
      return 20;
    default:
      return 250;
  }
}

function confidenceRadiusToSigma(point: GPSPoint): number {
  const radius = Number(point.accuracy);
  const effectiveRadius =
    Number.isFinite(radius) && radius > 0
      ? radius
      : sourceAccuracyDefault(point);
  const rawLevel = Number(point.metadata?.accuracyConfidenceLevel);
  const confidenceLevel =
    Number.isFinite(rawLevel) && rawLevel > 0.05 && rawLevel < 0.999999
      ? rawLevel
      : 0.68;
  const denominator = Math.sqrt(-2 * Math.log(1 - confidenceLevel));
  return Math.max(0.1, effectiveRadius / Math.max(0.1, denominator));
}

function correlationDomain(point: GPSPoint): string {
  const explicit = String(point.metadata?.correlationDomain || '').trim();
  if (explicit) return explicit.slice(0, 300);
  if (point.correlationGroup) return point.correlationGroup.slice(0, 300);
  return [
    point.source,
    point.provenance?.provider || 'unknown',
    point.provenance?.recordId || '',
  ].join(':').slice(0, 300);
}

function dependencyGroups(points: GPSPoint[]): SpectraTrajectoryDependencyGroup[] {
  const groups = new Map<string, {
    count: number;
    sources: Set<string>;
    providers: Set<string>;
  }>();

  for (const point of points) {
    const id = correlationDomain(point);
    const current = groups.get(id) || {
      count: 0,
      sources: new Set<string>(),
      providers: new Set<string>(),
    };
    current.count += 1;
    current.sources.add(point.source);
    if (point.provenance?.provider) current.providers.add(point.provenance.provider);
    groups.set(id, current);
  }

  return [...groups.entries()]
    .map(([id, value]) => ({
      id,
      observationCount: value.count,
      sources: [...value.sources].sort(),
      providers: [...value.providers].sort(),
    }))
    .sort((left, right) =>
      right.observationCount - left.observationCount || left.id.localeCompare(right.id)
    );
}

function aggregateTemporalBucket(
  points: GPSPoint[],
  originLatitude: number,
  originLongitude: number,
): LocalMeasurement {
  const perPoint = points.map(point => {
    const position = localMeters(
      point.latitude,
      point.longitude,
      originLatitude,
      originLongitude,
    );
    const sigma = confidenceRadiusToSigma(point);
    const confidence = clamp(Number(point.confidence) || 0.25, 0.01, 1);
    return {
      point,
      position,
      sigma,
      information: confidence / Math.max(0.01, sigma * sigma),
      domain: correlationDomain(point),
    };
  });

  const domainTotals = new Map<string, { total: number; strongest: number }>();
  for (const item of perPoint) {
    const current = domainTotals.get(item.domain) || { total: 0, strongest: 0 };
    current.total += item.information;
    current.strongest = Math.max(current.strongest, item.information);
    domainTotals.set(item.domain, current);
  }

  let totalInformation = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedConfidence = 0;

  for (const item of perPoint) {
    const domain = domainTotals.get(item.domain)!;
    const domainScale = domain.total > 0 ? domain.strongest / domain.total : 1;
    const effectiveInformation = item.information * domainScale;
    totalInformation += effectiveInformation;
    weightedX += item.position.x * effectiveInformation;
    weightedY += item.position.y * effectiveInformation;
    weightedConfidence += item.point.confidence * effectiveInformation;
  }

  if (totalInformation <= 0) {
    totalInformation = 1 / Math.max(1, sourceAccuracyDefault(points[0]) ** 2);
  }

  const x = weightedX / totalInformation;
  const y = weightedY / totalInformation;
  const variance = Math.max(0.01, 1 / totalInformation);
  const spreadMeters = Math.sqrt(
    perPoint.reduce((sum, item) => {
      const dx = item.position.x - x;
      const dy = item.position.y - y;
      return sum + dx * dx + dy * dy;
    }, 0) / Math.max(1, perPoint.length),
  );

  return {
    timestamp: new Date(
      Math.round(
        perPoint.reduce((sum, item) =>
          sum + item.point.timestamp.getTime() * item.information
        , 0) / Math.max(1e-9, perPoint.reduce((sum, item) => sum + item.information, 0))
      )
    ),
    x,
    y,
    variance,
    confidence: clamp(weightedConfidence / totalInformation, 0.05, 0.995),
    supportPointCount: points.length,
    supportDomainCount: domainTotals.size,
    spreadMeters,
  };
}

function add2(left: Matrix2, right: Matrix2): Matrix2 {
  return [
    [left[0][0] + right[0][0], left[0][1] + right[0][1]],
    [left[1][0] + right[1][0], left[1][1] + right[1][1]],
  ];
}

function sub2(left: Matrix2, right: Matrix2): Matrix2 {
  return [
    [left[0][0] - right[0][0], left[0][1] - right[0][1]],
    [left[1][0] - right[1][0], left[1][1] - right[1][1]],
  ];
}

function mul2(left: Matrix2, right: Matrix2): Matrix2 {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1],
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1],
    ],
  ];
}

function transpose2(value: Matrix2): Matrix2 {
  return [
    [value[0][0], value[1][0]],
    [value[0][1], value[1][1]],
  ];
}

function inverse2(value: Matrix2): Matrix2 | null {
  const determinant = value[0][0] * value[1][1] - value[0][1] * value[1][0];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const scale = 1 / determinant;
  return [
    [value[1][1] * scale, -value[0][1] * scale],
    [-value[1][0] * scale, value[0][0] * scale],
  ];
}

function mul2Vector(matrix: Matrix2, vector: [number, number]): [number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1],
  ];
}

function processNoise(
  deltaSeconds: number,
  accelerationSigmaMps2: number,
): Matrix2 {
  const dt = Math.max(0.001, deltaSeconds);
  const variance = accelerationSigmaMps2 ** 2;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;
  return [
    [variance * dt4 / 4, variance * dt3 / 2],
    [variance * dt3 / 2, variance * dt2],
  ];
}

function predictAxis(
  state: [number, number],
  covariance: Matrix2,
  deltaSeconds: number,
  accelerationSigmaMps2: number,
): {
  state: [number, number];
  covariance: Matrix2;
  transition: Matrix2;
} {
  const transition: Matrix2 = [
    [1, deltaSeconds],
    [0, 1],
  ];
  const predictedState = mul2Vector(transition, state);
  const predictedCovariance = add2(
    mul2(mul2(transition, covariance), transpose2(transition)),
    processNoise(deltaSeconds, accelerationSigmaMps2),
  );
  return {
    state: predictedState,
    covariance: predictedCovariance,
    transition,
  };
}

function updateAxis(
  predictedState: [number, number],
  predictedCovariance: Matrix2,
  measurementPosition: number,
  measurementVariance: number,
): {
  state: [number, number];
  covariance: Matrix2;
} {
  const innovationVariance = Math.max(
    1e-9,
    predictedCovariance[0][0] + measurementVariance,
  );
  const gainPosition = predictedCovariance[0][0] / innovationVariance;
  const gainVelocity = predictedCovariance[1][0] / innovationVariance;
  const residual = measurementPosition - predictedState[0];

  const state: [number, number] = [
    predictedState[0] + gainPosition * residual,
    predictedState[1] + gainVelocity * residual,
  ];

  const covariance: Matrix2 = [
    [
      Math.max(1e-9, (1 - gainPosition) * predictedCovariance[0][0]),
      (1 - gainPosition) * predictedCovariance[0][1],
    ],
    [
      predictedCovariance[1][0] - gainVelocity * predictedCovariance[0][0],
      Math.max(
        1e-9,
        predictedCovariance[1][1] - gainVelocity * predictedCovariance[0][1],
      ),
    ],
  ];

  covariance[1][0] = covariance[0][1];

  return { state, covariance };
}

function runAxisFilter(
  measurements: LocalMeasurement[],
  axis: 'x' | 'y',
  options: Required<Pick<
    SpectraTrajectoryEstimatorOptions,
    'maxSpeedMps' | 'accelerationSigmaMps2'
  >>,
  externalInflations: number[],
): AxisRecord[] {
  const records: AxisRecord[] = [];
  const first = measurements[0];
  const firstPosition = axis === 'x' ? first.x : first.y;
  let state: [number, number] = [firstPosition, 0];
  let covariance: Matrix2 = [
    [Math.max(1, first.variance), 0],
    [0, Math.max(25, options.maxSpeedMps ** 2 / 9)],
  ];

  records.push({
    timestamp: first.timestamp,
    measurement: first,
    filteredState: state,
    filteredCovariance: covariance,
    predictedState: state,
    predictedCovariance: covariance,
    transitionFromPrevious: [[1, 0], [0, 1]],
    robustInflation: 1,
    motionViolation: false,
    contradiction: false,
  });

  for (let index = 1; index < measurements.length; index += 1) {
    const measurement = measurements[index];
    const previous = records[index - 1];
    const deltaSeconds = Math.max(
      0.001,
      (measurement.timestamp.getTime() - previous.timestamp.getTime()) / 1000,
    );

    const predicted = predictAxis(
      state,
      covariance,
      deltaSeconds,
      options.accelerationSigmaMps2,
    );

    const targetPosition = axis === 'x' ? measurement.x : measurement.y;
    const residual = targetPosition - predicted.state[0];
    const innovationSigma = Math.sqrt(
      Math.max(0.01, predicted.covariance[0][0] + measurement.variance),
    );
    const normalizedResidual = Math.abs(residual) / innovationSigma;

    let robustInflation = normalizedResidual <= 3.5
      ? 1
      : Math.min(100, (normalizedResidual / 3.5) ** 2);
    robustInflation = Math.max(
      robustInflation,
      externalInflations[index] ?? 1,
    );
    const contradiction = normalizedResidual > 5;
    const motionViolation = (externalInflations[index] ?? 1) > 1;

    const updated = updateAxis(
      predicted.state,
      predicted.covariance,
      targetPosition,
      measurement.variance * robustInflation,
    );

    state = updated.state;
    covariance = updated.covariance;

    records.push({
      timestamp: measurement.timestamp,
      measurement,
      filteredState: state,
      filteredCovariance: covariance,
      predictedState: predicted.state,
      predictedCovariance: predicted.covariance,
      transitionFromPrevious: predicted.transition,
      robustInflation,
      motionViolation,
      contradiction,
    });
  }

  return records;
}

function smoothAxis(records: AxisRecord[]): Array<{
  state: [number, number];
  covariance: Matrix2;
}> {
  if (!records.length) return [];
  const smoothed = records.map(record => ({
    state: [...record.filteredState] as [number, number],
    covariance: [
      [...record.filteredCovariance[0]] as [number, number],
      [...record.filteredCovariance[1]] as [number, number],
    ] as Matrix2,
  }));

  for (let index = records.length - 2; index >= 0; index -= 1) {
    const current = records[index];
    const next = records[index + 1];
    const inversePredicted = inverse2(next.predictedCovariance);
    if (!inversePredicted) continue;

    const smootherGain = mul2(
      mul2(current.filteredCovariance, transpose2(next.transitionFromPrevious)),
      inversePredicted,
    );
    const stateResidual: [number, number] = [
      smoothed[index + 1].state[0] - next.predictedState[0],
      smoothed[index + 1].state[1] - next.predictedState[1],
    ];
    const correction = mul2Vector(smootherGain, stateResidual);

    smoothed[index].state = [
      current.filteredState[0] + correction[0],
      current.filteredState[1] + correction[1],
    ];

    const covarianceResidual = sub2(
      smoothed[index + 1].covariance,
      next.predictedCovariance,
    );
    smoothed[index].covariance = add2(
      current.filteredCovariance,
      mul2(
        mul2(smootherGain, covarianceResidual),
        transpose2(smootherGain),
      ),
    );
  }

  return smoothed;
}

export function estimateSpectraTrajectory(
  inputs: GPSPoint[],
  options: SpectraTrajectoryEstimatorOptions = {},
): SpectraTrajectoryEstimate {
  const fixedLagSeconds = clamp(options.fixedLagSeconds ?? 3_600, 30, 86_400);
  const temporalBucketMs = clamp(options.temporalBucketMs ?? 750, 50, 10_000);
  const maxSpeedMps = clamp(options.maxSpeedMps ?? 90, 5, 400);
  const accelerationSigmaMps2 = clamp(options.accelerationSigmaMps2 ?? 6, 0.2, 30);
  const maxStates = Math.round(clamp(options.maxStates ?? 240, 3, 2_000));

  const usable = inputs
    .filter(point =>
      validCoordinate(point)
      && point.observationKind !== 'predicted'
      && point.source !== 'predicted'
      && point.observationKind !== 'historical'
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const groups = dependencyGroups(usable);
  const baseDiagnostics: SpectraTrajectoryDiagnostics = {
    model: 'constant_velocity_rts_fixed_lag',
    fixedLagSeconds,
    inputObservationCount: usable.length,
    measurementBucketCount: 0,
    independentDomainCount: groups.length,
    correlatedObservationCount: groups.reduce(
      (sum, group) => sum + Math.max(0, group.observationCount - 1),
      0,
    ),
    contradictionCount: 0,
    motionConstraintViolations: 0,
    dependencyGroups: groups,
  };

  if (!usable.length) {
    return { states: [], diagnostics: baseDiagnostics };
  }

  const latestTimeMs = usable[usable.length - 1].timestamp.getTime();
  const cutoffMs = latestTimeMs - fixedLagSeconds * 1000;
  const recent = usable.filter(point => point.timestamp.getTime() >= cutoffMs);
  const originLatitude = recent.reduce((sum, point) => sum + point.latitude, 0) / recent.length;
  const originLongitude = recent.reduce((sum, point) => sum + point.longitude, 0) / recent.length;

  const buckets = new Map<number, GPSPoint[]>();
  for (const point of recent) {
    const key = Math.round(point.timestamp.getTime() / temporalBucketMs);
    const bucket = buckets.get(key) || [];
    bucket.push(point);
    buckets.set(key, bucket);
  }

  let measurements = [...buckets.values()]
    .map(points => aggregateTemporalBucket(points, originLatitude, originLongitude))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  if (measurements.length > maxStates) measurements = measurements.slice(-maxStates);
  baseDiagnostics.measurementBucketCount = measurements.length;

  if (!measurements.length) {
    return { states: [], diagnostics: baseDiagnostics };
  }

  if (measurements.length === 1) {
    const measurement = measurements[0];
    const coordinate = geoFromLocalMeters(
      measurement.x,
      measurement.y,
      originLatitude,
      originLongitude,
    );
    const radius99 = RADIAL_99_FACTOR * Math.sqrt(measurement.variance);
    const single: GPSPoint = {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      accuracy: radius99,
      timestamp: measurement.timestamp,
      receivedAt: new Date(),
      source: 'interpolated',
      confidence: Math.min(0.95, measurement.confidence),
      observationKind: 'inferred',
      correlationGroup: 'trajectory:spectra-rts',
      provenance: {
        provider: 'spectra-trajectory-estimator',
        capturedAt: measurement.timestamp,
        transformedBy: ['dependency_aware_measurement_fusion'],
      },
      metadata: {
        model: 'constant_velocity_rts_fixed_lag',
        smoothed: false,
        covarianceMeters2: {
          eastVariance: measurement.variance,
          northVariance: measurement.variance,
          eastNorthCovariance: 0,
        },
        uncertaintyRadius99Meters: radius99,
        supportPointCount: measurement.supportPointCount,
        supportDomainCount: measurement.supportDomainCount,
        measurementSpreadMeters: measurement.spreadMeters,
        dependencyAware: true,
        motionConstrained: true,
      },
    };
    baseDiagnostics.latestRadius99Meters = radius99;
    baseDiagnostics.latestSpeedMps = 0;
    return {
      states: [single],
      latest: single,
      diagnostics: baseDiagnostics,
    };
  }

  const motionInflations = measurements.map(() => 1);
  let motionConstraintViolations = 0;
  for (let index = 1; index < measurements.length; index += 1) {
    const deltaSeconds = Math.max(
      0.001,
      (measurements[index].timestamp.getTime() - measurements[index - 1].timestamp.getTime()) / 1000,
    );
    const distance = Math.hypot(
      measurements[index].x - measurements[index - 1].x,
      measurements[index].y - measurements[index - 1].y,
    );
    const impliedSpeed = distance / deltaSeconds;
    if (impliedSpeed > maxSpeedMps) {
      motionConstraintViolations += 1;
      motionInflations[index] = Math.min(
        100,
        Math.max(1, (impliedSpeed / maxSpeedMps) ** 2),
      );
    }
  }

  const xRecords = runAxisFilter(
    measurements,
    'x',
    { maxSpeedMps, accelerationSigmaMps2 },
    motionInflations,
  );
  const yRecords = runAxisFilter(
    measurements,
    'y',
    { maxSpeedMps, accelerationSigmaMps2 },
    motionInflations,
  );

  const xSmoothed = smoothAxis(xRecords);
  const ySmoothed = smoothAxis(yRecords);
  const contradictionCount = Math.max(
    xRecords.filter(record => record.contradiction).length,
    yRecords.filter(record => record.contradiction).length,
  );

  const states: GPSPoint[] = measurements.map((measurement, index) => {
    const xState = xSmoothed[index];
    const yState = ySmoothed[index];
    const coordinate = geoFromLocalMeters(
      xState.state[0],
      yState.state[0],
      originLatitude,
      originLongitude,
    );
    const eastVariance = Math.max(0.01, xState.covariance[0][0]);
    const northVariance = Math.max(0.01, yState.covariance[0][0]);
    const radialSigma = Math.sqrt(Math.max(eastVariance, northVariance));
    const radius99 = RADIAL_99_FACTOR * radialSigma;
    const velocityEast = xState.state[1];
    const velocityNorth = yState.state[1];
    const speed = Math.hypot(velocityEast, velocityNorth);
    const heading = speed > 0.05
      ? (Math.atan2(velocityEast, velocityNorth) * 180 / Math.PI + 360) % 360
      : undefined;

    const supportFactor = 0.78 + 0.22 * Math.min(1, measurement.supportDomainCount / 3);
    const spreadPenalty = measurement.spreadMeters <= radialSigma * 3
      ? 1
      : Math.max(0.35, radialSigma * 3 / Math.max(0.1, measurement.spreadMeters));
    const confidence = clamp(
      measurement.confidence * supportFactor * spreadPenalty,
      0.05,
      0.995,
    );

    return {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      accuracy: radius99,
      timestamp: measurement.timestamp,
      receivedAt: new Date(),
      source: 'interpolated',
      confidence,
      observationKind: 'inferred',
      correlationGroup: 'trajectory:spectra-rts',
      provenance: {
        provider: 'spectra-trajectory-estimator',
        capturedAt: measurement.timestamp,
        transformedBy: [
          'dependency_aware_measurement_fusion',
          'constant_velocity_kalman_filter',
          'rauch_tung_striebel_smoother',
        ],
      },
      metadata: {
        model: 'constant_velocity_rts_fixed_lag',
        smoothed: true,
        dependencyAware: true,
        motionConstrained: true,
        fixedLagSeconds,
        covarianceMeters2: {
          eastVariance,
          northVariance,
          eastNorthCovariance: 0,
        },
        uncertaintyRadius99Meters: radius99,
        velocity: {
          eastMps: velocityEast,
          northMps: velocityNorth,
          speed,
          heading,
        },
        supportPointCount: measurement.supportPointCount,
        supportDomainCount: measurement.supportDomainCount,
        measurementSpreadMeters: measurement.spreadMeters,
        robustInflation: Math.max(
          xRecords[index].robustInflation,
          yRecords[index].robustInflation,
        ),
        contradiction:
          xRecords[index].contradiction || yRecords[index].contradiction,
        motionConstraintViolation: motionInflations[index] > 1,
      },
    } satisfies GPSPoint;
  });

  const latest = states[states.length - 1];
  baseDiagnostics.contradictionCount = contradictionCount;
  baseDiagnostics.motionConstraintViolations = motionConstraintViolations;
  baseDiagnostics.latestRadius99Meters = latest?.accuracy;
  baseDiagnostics.latestSpeedMps = Number(
    (latest?.metadata?.velocity as Record<string, unknown> | undefined)?.speed,
  );

  return {
    states,
    latest,
    diagnostics: baseDiagnostics,
  };
}
