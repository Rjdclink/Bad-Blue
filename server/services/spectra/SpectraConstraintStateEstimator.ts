import type { GPSPoint } from '../geoconsole/types';

type Vector4 = [number, number, number, number];
type Matrix4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
];

interface FilterRecord {
  point: GPSPoint;
  filteredState: Vector4;
  filteredCovariance: Matrix4;
  predictedState: Vector4;
  predictedCovariance: Matrix4;
  transition: Matrix4;
  innovationMeters: number;
  normalizedInnovationSquared: number;
  robustInflation: number;
}

export interface SpectraConstraintStateSummary {
  algorithm: 'constant_velocity_kalman_rts';
  inputCount: number;
  smoothedCount: number;
  segmentCount: number;
  robustlyDownweightedCount: number;
  latestPosteriorSigmaMeters?: number;
  latestConfidenceRadius95Meters?: number;
}

export interface SpectraConstraintStateResult {
  points: GPSPoint[];
  summary: SpectraConstraintStateSummary;
}

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_SEGMENT_GAP_MS = 5 * 60_000;
const MAX_SEGMENT_POINTS = 240;
const MAX_NIS_BEFORE_ROBUST_INFLATION = 9.21; // 99% chi-square gate, 2 DOF.
const MAX_ROBUST_INFLATION = 100;
const MIN_POSITION_SIGMA_METERS = 0.25;
const MAX_POSITION_SIGMA_METERS = 250_000;
const DEFAULT_VELOCITY_SIGMA_MPS = 15;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeLongitude(value: number): number {
  let result = value;
  while (result > 180) result -= 360;
  while (result <= -180) result += 360;
  return result;
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
    longitude: normalizeLongitude(
      originLongitude
      + x
      / (EARTH_RADIUS_METERS * Math.max(0.05, Math.cos(originLatitudeRadians)))
      * 180 / Math.PI,
    ),
  };
}

function sourceFallbackSigma(point: GPSPoint): number {
  switch (point.source) {
    case 'uwb_range':
    case 'uwb_direction':
    case 'bluetooth_channel_sounding':
      return 2;
    case 'wifi_rtt':
      return 4;
    case 'gnss_fix':
    case 'device_gps':
    case 'visual_positioning':
      return 12;
    case 'browser_geolocation':
      return 25;
    case 'ble_aoa':
    case 'ble_aod':
      return 12;
    case 'wifi_fingerprint':
      return 40;
    case 'wifi_rssi':
    case 'wifi_handoff':
      return 100;
    case 'nr_positioning':
      return 25;
    case 'cell_serving':
    case 'cell_neighbor':
    case 'cellular':
      return 2_000;
    case 'network_region':
      return 25_000;
    default:
      return 250;
  }
}

function radiusToSigma(radiusMeters: number, confidenceLevel: number): number {
  const denominator = Math.sqrt(
    Math.max(1e-12, -2 * Math.log(Math.max(1e-12, 1 - confidenceLevel))),
  );
  return radiusMeters / denominator;
}

function measurementSigmaMeters(point: GPSPoint): number {
  const covariance = point.metadata?.covariance;
  if (covariance && typeof covariance === 'object') {
    const record = covariance as Record<string, unknown>;
    const east = Number(record.eastVariance ?? record.xx);
    const north = Number(record.northVariance ?? record.yy);
    if (
      Number.isFinite(east)
      && east >= 0
      && Number.isFinite(north)
      && north >= 0
    ) {
      return clamp(
        Math.sqrt(Math.max(0.0001, (east + north) / 2)),
        MIN_POSITION_SIGMA_METERS,
        MAX_POSITION_SIGMA_METERS,
      );
    }
  }

  const radius = Number(point.accuracy);
  if (!Number.isFinite(radius) || radius <= 0) {
    return sourceFallbackSigma(point);
  }

  const level = Number(point.metadata?.accuracyConfidenceLevel);
  const sigma = Number.isFinite(level) && level > 0.1 && level < 0.9999
    ? radiusToSigma(radius, level)
    : radiusToSigma(radius, 0.68);

  const confidence = clamp(Number(point.confidence) || 0.25, 0.05, 1);
  return clamp(
    sigma / Math.sqrt(confidence),
    MIN_POSITION_SIGMA_METERS,
    MAX_POSITION_SIGMA_METERS,
  );
}

function accelerationSigma(point: GPSPoint): number {
  if (point.source === 'vehicle_telemetry') return 4;
  if (
    point.source === 'cellular'
    || point.source === 'cell_serving'
    || point.source === 'cell_neighbor'
    || point.source === 'network_region'
  ) return 5;
  return 2.5;
}

function identity4(): Matrix4 {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function transpose4(matrix: Matrix4): Matrix4 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0], matrix[3][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1], matrix[3][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2], matrix[3][2]],
    [matrix[0][3], matrix[1][3], matrix[2][3], matrix[3][3]],
  ];
}

function multiply4(a: Matrix4, b: Matrix4): Matrix4 {
  const result = identity4().map(row => row.map(() => 0)) as Matrix4;
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      for (let k = 0; k < 4; k += 1) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

function multiply4Vector(matrix: Matrix4, vector: Vector4): Vector4 {
  return matrix.map(row =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0)
  ) as Vector4;
}

function add4(a: Matrix4, b: Matrix4): Matrix4 {
  return a.map((row, i) =>
    row.map((value, j) => value + b[i][j])
  ) as Matrix4;
}

function subtract4(a: Matrix4, b: Matrix4): Matrix4 {
  return a.map((row, i) =>
    row.map((value, j) => value - b[i][j])
  ) as Matrix4;
}

function inverse4(input: Matrix4): Matrix4 | null {
  const matrix = input.map((row, i) => [
    ...row,
    ...identity4()[i],
  ]);

  for (let column = 0; column < 4; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }

    const pivot = matrix[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) return null;
    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];

    for (let j = 0; j < 8; j += 1) matrix[column][j] /= pivot;

    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let j = 0; j < 8; j += 1) {
        matrix[row][j] -= factor * matrix[column][j];
      }
    }
  }

  return matrix.map(row => row.slice(4, 8)) as Matrix4;
}

function symmetrizeCovariance(matrix: Matrix4): Matrix4 {
  const result = matrix.map(row => [...row]) as Matrix4;
  for (let i = 0; i < 4; i += 1) {
    result[i][i] = Math.max(1e-6, result[i][i]);
    for (let j = i + 1; j < 4; j += 1) {
      const value = (result[i][j] + result[j][i]) / 2;
      result[i][j] = value;
      result[j][i] = value;
    }
  }
  return result;
}

function transitionMatrix(dt: number): Matrix4 {
  return [
    [1, 0, dt, 0],
    [0, 1, 0, dt],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function processNoise(dt: number, accelerationSigmaMps2: number): Matrix4 {
  const q = accelerationSigmaMps2 ** 2;
  const dt2 = dt ** 2;
  const dt3 = dt ** 3;
  const dt4 = dt ** 4;
  return [
    [q * dt4 / 4, 0, q * dt3 / 2, 0],
    [0, q * dt4 / 4, 0, q * dt3 / 2],
    [q * dt3 / 2, 0, q * dt2, 0],
    [0, q * dt3 / 2, 0, q * dt2],
  ];
}

function initialCovariance(positionSigma: number): Matrix4 {
  const p = positionSigma ** 2;
  const v = DEFAULT_VELOCITY_SIGMA_MPS ** 2;
  return [
    [p, 0, 0, 0],
    [0, p, 0, 0],
    [0, 0, v, 0],
    [0, 0, 0, v],
  ];
}

function updateWithPosition(
  predictedState: Vector4,
  predictedCovariance: Matrix4,
  measurementX: number,
  measurementY: number,
  measurementSigma: number,
): {
  state: Vector4;
  covariance: Matrix4;
  innovationMeters: number;
  normalizedInnovationSquared: number;
  robustInflation: number;
} {
  const innovationX = measurementX - predictedState[0];
  const innovationY = measurementY - predictedState[1];

  let variance = measurementSigma ** 2;
  const baseS00 = predictedCovariance[0][0] + variance;
  const baseS01 = predictedCovariance[0][1];
  const baseS10 = predictedCovariance[1][0];
  const baseS11 = predictedCovariance[1][1] + variance;
  const baseDeterminant = baseS00 * baseS11 - baseS01 * baseS10;
  const baseInverse = Math.abs(baseDeterminant) > 1e-12
    ? [
        [baseS11 / baseDeterminant, -baseS01 / baseDeterminant],
        [-baseS10 / baseDeterminant, baseS00 / baseDeterminant],
      ]
    : [[1 / Math.max(1, baseS00), 0], [0, 1 / Math.max(1, baseS11)]];

  const nis =
    innovationX * (baseInverse[0][0] * innovationX + baseInverse[0][1] * innovationY)
    + innovationY * (baseInverse[1][0] * innovationX + baseInverse[1][1] * innovationY);

  const robustInflation = Number.isFinite(nis) && nis > MAX_NIS_BEFORE_ROBUST_INFLATION
    ? clamp(nis / MAX_NIS_BEFORE_ROBUST_INFLATION, 1, MAX_ROBUST_INFLATION)
    : 1;
  variance *= robustInflation;

  const s00 = predictedCovariance[0][0] + variance;
  const s01 = predictedCovariance[0][1];
  const s10 = predictedCovariance[1][0];
  const s11 = predictedCovariance[1][1] + variance;
  const determinant = s00 * s11 - s01 * s10;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return {
      state: predictedState,
      covariance: predictedCovariance,
      innovationMeters: Math.hypot(innovationX, innovationY),
      normalizedInnovationSquared: Number.isFinite(nis) ? nis : Number.POSITIVE_INFINITY,
      robustInflation,
    };
  }

  const inverse = [
    [s11 / determinant, -s01 / determinant],
    [-s10 / determinant, s00 / determinant],
  ];

  const gain = Array.from({ length: 4 }, (_, row) => [
    predictedCovariance[row][0] * inverse[0][0]
      + predictedCovariance[row][1] * inverse[1][0],
    predictedCovariance[row][0] * inverse[0][1]
      + predictedCovariance[row][1] * inverse[1][1],
  ]);

  const state = predictedState.map((value, row) =>
    value + gain[row][0] * innovationX + gain[row][1] * innovationY
  ) as Vector4;

  const identityMinusKh = identity4();
  for (let row = 0; row < 4; row += 1) {
    identityMinusKh[row][0] -= gain[row][0];
    identityMinusKh[row][1] -= gain[row][1];
  }

  const covariance = symmetrizeCovariance(
    multiply4(identityMinusKh, predictedCovariance),
  );

  return {
    state,
    covariance,
    innovationMeters: Math.hypot(innovationX, innovationY),
    normalizedInnovationSquared: Number.isFinite(nis) ? nis : Number.POSITIVE_INFINITY,
    robustInflation,
  };
}

function splitSegments(points: GPSPoint[]): GPSPoint[][] {
  const segments: GPSPoint[][] = [];
  let current: GPSPoint[] = [];

  for (const point of points) {
    if (!current.length) {
      current.push(point);
      continue;
    }

    const previous = current[current.length - 1];
    const gapMs = point.timestamp.getTime() - previous.timestamp.getTime();
    const explicitBreak =
      point.metadata?.continuity === 'discontinuous'
      || Number(point.metadata?.gapBeforeSeconds || 0) > 0;

    if (gapMs <= 0 || gapMs > MAX_SEGMENT_GAP_MS || explicitBreak) {
      segments.push(current.slice(-MAX_SEGMENT_POINTS));
      current = [point];
    } else {
      current.push(point);
      if (current.length > MAX_SEGMENT_POINTS) current.shift();
    }
  }

  if (current.length) segments.push(current);
  return segments;
}

function smoothSegment(segment: GPSPoint[]): {
  points: GPSPoint[];
  robustlyDownweightedCount: number;
} {
  if (segment.length < 2) {
    return { points: segment.map(point => ({ ...point })), robustlyDownweightedCount: 0 };
  }

  const originLatitude = segment[0].latitude;
  const originLongitude = segment[0].longitude;
  const firstLocal = localMeters(
    segment[0].latitude,
    segment[0].longitude,
    originLatitude,
    originLongitude,
  );
  const firstSigma = measurementSigmaMeters(segment[0]);

  const records: FilterRecord[] = [{
    point: segment[0],
    filteredState: [firstLocal.x, firstLocal.y, 0, 0],
    filteredCovariance: initialCovariance(firstSigma),
    predictedState: [firstLocal.x, firstLocal.y, 0, 0],
    predictedCovariance: initialCovariance(firstSigma),
    transition: identity4(),
    innovationMeters: 0,
    normalizedInnovationSquared: 0,
    robustInflation: 1,
  }];

  let robustlyDownweightedCount = 0;

  for (let index = 1; index < segment.length; index += 1) {
    const point = segment[index];
    const previous = records[index - 1];
    const dt = clamp(
      (point.timestamp.getTime() - previous.point.timestamp.getTime()) / 1000,
      0.05,
      300,
    );
    const transition = transitionMatrix(dt);
    const predictedState = multiply4Vector(transition, previous.filteredState);
    const predictedCovariance = symmetrizeCovariance(
      add4(
        multiply4(
          multiply4(transition, previous.filteredCovariance),
          transpose4(transition),
        ),
        processNoise(dt, accelerationSigma(point)),
      ),
    );

    const measurement = localMeters(
      point.latitude,
      point.longitude,
      originLatitude,
      originLongitude,
    );
    const updated = updateWithPosition(
      predictedState,
      predictedCovariance,
      measurement.x,
      measurement.y,
      measurementSigmaMeters(point),
    );
    if (updated.robustInflation > 1.01) robustlyDownweightedCount += 1;

    records.push({
      point,
      filteredState: updated.state,
      filteredCovariance: updated.covariance,
      predictedState,
      predictedCovariance,
      transition,
      innovationMeters: updated.innovationMeters,
      normalizedInnovationSquared: updated.normalizedInnovationSquared,
      robustInflation: updated.robustInflation,
    });
  }

  const smoothedStates = records.map(record => [...record.filteredState] as Vector4);
  const smoothedCovariances = records.map(record =>
    record.filteredCovariance.map(row => [...row]) as Matrix4
  );

  for (let index = records.length - 2; index >= 0; index -= 1) {
    const current = records[index];
    const next = records[index + 1];
    const inversePredicted = inverse4(next.predictedCovariance);
    if (!inversePredicted) continue;

    const gain = multiply4(
      multiply4(current.filteredCovariance, transpose4(next.transition)),
      inversePredicted,
    );
    const stateDelta = smoothedStates[index + 1].map(
      (value, component) => value - next.predictedState[component],
    ) as Vector4;
    const correction = multiply4Vector(gain, stateDelta);
    smoothedStates[index] = current.filteredState.map(
      (value, component) => value + correction[component],
    ) as Vector4;

    const covarianceDelta = subtract4(
      smoothedCovariances[index + 1],
      next.predictedCovariance,
    );
    smoothedCovariances[index] = symmetrizeCovariance(
      add4(
        current.filteredCovariance,
        multiply4(
          multiply4(gain, covarianceDelta),
          transpose4(gain),
        ),
      ),
    );
  }

  const points = records.map((record, index) => {
    const state = smoothedStates[index];
    const covariance = smoothedCovariances[index];
    const location = geoFromLocalMeters(
      state[0],
      state[1],
      originLatitude,
      originLongitude,
    );
    const sigma = Math.sqrt(
      Math.max(
        MIN_POSITION_SIGMA_METERS ** 2,
        (covariance[0][0] + covariance[1][1]) / 2,
      ),
    );
    const radius95 = sigma * Math.sqrt(-2 * Math.log(0.05));
    const speed = Math.hypot(state[2], state[3]);
    const heading = speed > 0.05
      ? (Math.atan2(state[2], state[3]) * 180 / Math.PI + 360) % 360
      : undefined;

    return {
      ...record.point,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: clamp(radius95, 0.25, 5_000_000),
      provenance: {
        ...(record.point.provenance || {}),
        transformedBy: [
          ...(record.point.provenance?.transformedBy || []),
          'spectra_constant_velocity_state_estimator',
          ...(index < records.length - 1 ? ['spectra_backward_rts_smoother'] : []),
        ],
      },
      metadata: {
        ...(record.point.metadata || {}),
        stateEstimator: {
          algorithm: 'constant_velocity_kalman_rts',
          posteriorSigmaMeters: sigma,
          confidenceRadius95Meters: radius95,
          covariance: {
            eastVariance: covariance[0][0],
            northVariance: covariance[1][1],
            eastNorthCovariance: covariance[0][1],
          },
          velocityEastMps: state[2],
          velocityNorthMps: state[3],
          speedMps: speed,
          headingDegrees: heading,
          innovationMeters: record.innovationMeters,
          normalizedInnovationSquared: record.normalizedInnovationSquared,
          robustMeasurementInflation: record.robustInflation,
          backwardSmoothed: index < records.length - 1,
        },
        accuracyConfidenceLevel: 0.95,
        covariance: {
          eastVariance: covariance[0][0],
          northVariance: covariance[1][1],
          eastNorthCovariance: covariance[0][1],
        },
        velocity: {
          speed,
          heading,
        },
      },
    } satisfies GPSPoint;
  });

  return { points, robustlyDownweightedCount };
}

export function estimateSpectraConstraintState(points: GPSPoint[]): SpectraConstraintStateResult {
  const eligible = points
    .filter(point =>
      Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && Number.isFinite(point.timestamp.getTime())
      && point.observationKind !== 'predicted'
      && point.source !== 'predicted'
      && point.observationKind !== 'interpolated'
      && point.source !== 'interpolated'
    )
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (!eligible.length) {
    return {
      points: [],
      summary: {
        algorithm: 'constant_velocity_kalman_rts',
        inputCount: 0,
        smoothedCount: 0,
        segmentCount: 0,
        robustlyDownweightedCount: 0,
      },
    };
  }

  const segments = splitSegments(eligible);
  const smoothed: GPSPoint[] = [];
  let robustlyDownweightedCount = 0;

  for (const segment of segments) {
    const result = smoothSegment(segment);
    smoothed.push(...result.points);
    robustlyDownweightedCount += result.robustlyDownweightedCount;
  }

  const latest = smoothed[smoothed.length - 1];
  const latestState = latest?.metadata?.stateEstimator as
    | Record<string, unknown>
    | undefined;

  return {
    points: smoothed,
    summary: {
      algorithm: 'constant_velocity_kalman_rts',
      inputCount: eligible.length,
      smoothedCount: smoothed.length,
      segmentCount: segments.length,
      robustlyDownweightedCount,
      latestPosteriorSigmaMeters: Number.isFinite(Number(latestState?.posteriorSigmaMeters))
        ? Number(latestState?.posteriorSigmaMeters)
        : undefined,
      latestConfidenceRadius95Meters: Number.isFinite(Number(latestState?.confidenceRadius95Meters))
        ? Number(latestState?.confidenceRadius95Meters)
        : undefined,
    },
  };
}
