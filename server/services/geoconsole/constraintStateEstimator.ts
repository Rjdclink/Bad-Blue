import type { GPSPoint } from './types';

const EARTH_RADIUS_METERS = 6_378_137;
const CHI2_RADIUS_95 = 2.44774683068;
const HUBER_K = 1.5;

export interface ConstraintAnchor {
  id?: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracyMeters?: number;
}

interface ConstraintBase {
  id?: string;
  confidence?: number;
  correlationGroup?: string;
}

export interface PositionConstraint extends ConstraintBase {
  type: 'position';
  latitude: number;
  longitude: number;
  uncertaintyMeters: number;
}

export interface RangeConstraint extends ConstraintBase {
  type: 'range';
  anchor: ConstraintAnchor;
  distanceMeters: number;
  uncertaintyMeters: number;
}

export interface RangeDifferenceConstraint extends ConstraintBase {
  type: 'range_difference';
  anchorA: ConstraintAnchor;
  anchorB: ConstraintAnchor;
  rangeDifferenceMeters: number;
  uncertaintyMeters: number;
}

export interface BearingConstraint extends ConstraintBase {
  type: 'bearing';
  anchor: ConstraintAnchor;
  bearingDegrees: number;
  bearingUncertaintyDegrees: number;
}

export interface SectorConstraint extends ConstraintBase {
  type: 'sector';
  anchor: ConstraintAnchor;
  centerBearingDegrees: number;
  halfWidthDegrees: number;
  minRangeMeters?: number;
  maxRangeMeters?: number;
  uncertaintyMeters?: number;
}

export type SpectraSpatialConstraint =
  | PositionConstraint
  | RangeConstraint
  | RangeDifferenceConstraint
  | BearingConstraint
  | SectorConstraint;

export interface ConstraintSolveResult {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  confidence: number;
  covariance: {
    eastVariance: number;
    northVariance: number;
    eastNorthCovariance: number;
  };
  residualRms: number;
  iterations: number;
  constraintCount: number;
  independentDomainCount: number;
  contradictionCount: number;
  supportKinds: string[];
}

interface LocalPoint {
  x: number;
  y: number;
}

interface NormalEquation {
  h00: number;
  h01: number;
  h11: number;
  g0: number;
  g1: number;
  weightedResidual: number;
  weightSum: number;
  equationCount: number;
  contradictionCount: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function wrapAngleRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function localMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): LocalPoint {
  const originLatitudeRadians = radians(originLatitude);
  return {
    x:
      radians(longitude - originLongitude)
      * EARTH_RADIUS_METERS
      * Math.max(0.05, Math.cos(originLatitudeRadians)),
    y: radians(latitude - originLatitude) * EARTH_RADIUS_METERS,
  };
}

function geoFromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const originLatitudeRadians = radians(originLatitude);
  return {
    latitude: originLatitude + y / EARTH_RADIUS_METERS * 180 / Math.PI,
    longitude:
      originLongitude
      + x
      / (
        EARTH_RADIUS_METERS
        * Math.max(0.05, Math.cos(originLatitudeRadians))
      )
      * 180 / Math.PI,
  };
}

function anchorKey(anchor: ConstraintAnchor): string {
  return [
    anchor.id || '',
    anchor.latitude.toFixed(7),
    anchor.longitude.toFixed(7),
  ].join('|');
}

function anchorUncertainty(anchor: ConstraintAnchor): number {
  const value = Number(anchor.accuracyMeters);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function constraintConfidence(constraint: SpectraSpatialConstraint): number {
  const value = Number(constraint.confidence);
  return Number.isFinite(value) ? clamp(value, 0.05, 1) : 0.8;
}

function correlationKey(constraint: SpectraSpatialConstraint): string {
  if (constraint.correlationGroup) return constraint.correlationGroup;
  switch (constraint.type) {
    case 'position':
      return `position:${constraint.latitude.toFixed(6)}:${constraint.longitude.toFixed(6)}`;
    case 'range':
    case 'bearing':
    case 'sector':
      return `${constraint.type}:${anchorKey(constraint.anchor)}`;
    case 'range_difference':
      return `range-difference:${anchorKey(constraint.anchorA)}:${anchorKey(constraint.anchorB)}`;
  }
}

function robustWeight(normalizedResidual: number): number {
  const absolute = Math.abs(normalizedResidual);
  return absolute <= HUBER_K ? 1 : HUBER_K / Math.max(HUBER_K, absolute);
}

function addEquation(
  equation: NormalEquation,
  residual: number,
  jacobianX: number,
  jacobianY: number,
  baseWeight: number,
): void {
  if (
    !Number.isFinite(residual)
    || !Number.isFinite(jacobianX)
    || !Number.isFinite(jacobianY)
    || !Number.isFinite(baseWeight)
    || baseWeight <= 0
  ) return;

  const robust = robustWeight(residual);
  const weight = baseWeight * robust;
  equation.h00 += weight * jacobianX * jacobianX;
  equation.h01 += weight * jacobianX * jacobianY;
  equation.h11 += weight * jacobianY * jacobianY;
  equation.g0 += weight * jacobianX * residual;
  equation.g1 += weight * jacobianY * residual;
  equation.weightedResidual += weight * residual * residual;
  equation.weightSum += weight;
  equation.equationCount += 1;
  if (robust < 0.35) equation.contradictionCount += 1;
}

function solve2x2(
  a00: number,
  a01: number,
  a11: number,
  b0: number,
  b1: number,
): { x: number; y: number; determinant: number } | null {
  const determinant = a00 * a11 - a01 * a01;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return {
    x: (a11 * b0 - a01 * b1) / determinant,
    y: (-a01 * b0 + a00 * b1) / determinant,
    determinant,
  };
}

function bearingCandidate(
  anchor: ConstraintAnchor,
  bearingDegrees: number,
  distanceMeters: number,
  originLatitude: number,
  originLongitude: number,
): LocalPoint {
  const anchorLocal = localMeters(
    anchor.latitude,
    anchor.longitude,
    originLatitude,
    originLongitude,
  );
  const theta = radians(bearingDegrees);
  return {
    x: anchorLocal.x + Math.sin(theta) * distanceMeters,
    y: anchorLocal.y + Math.cos(theta) * distanceMeters,
  };
}

function originForConstraints(
  constraints: SpectraSpatialConstraint[],
): { latitude: number; longitude: number } | null {
  const coordinates: Array<{ latitude: number; longitude: number }> = [];

  for (const constraint of constraints) {
    if (constraint.type === 'position') {
      coordinates.push({
        latitude: constraint.latitude,
        longitude: constraint.longitude,
      });
      continue;
    }
    if (constraint.type === 'range_difference') {
      coordinates.push(constraint.anchorA, constraint.anchorB);
      continue;
    }
    coordinates.push(constraint.anchor);
  }

  if (!coordinates.length) return null;
  return {
    latitude:
      coordinates.reduce((sum, item) => sum + item.latitude, 0)
      / coordinates.length,
    longitude:
      coordinates.reduce((sum, item) => sum + item.longitude, 0)
      / coordinates.length,
  };
}

function initialEstimate(
  constraints: SpectraSpatialConstraint[],
  originLatitude: number,
  originLongitude: number,
): LocalPoint {
  const candidates: LocalPoint[] = [];

  for (const constraint of constraints) {
    if (constraint.type === 'position') {
      candidates.push(localMeters(
        constraint.latitude,
        constraint.longitude,
        originLatitude,
        originLongitude,
      ));
    }
  }

  for (const constraint of constraints) {
    if (constraint.type !== 'bearing') continue;
    const matchingRange = constraints.find(candidate =>
      candidate.type === 'range'
      && anchorKey(candidate.anchor) === anchorKey(constraint.anchor)
    ) as RangeConstraint | undefined;
    if (!matchingRange) continue;
    candidates.push(bearingCandidate(
      constraint.anchor,
      constraint.bearingDegrees,
      matchingRange.distanceMeters,
      originLatitude,
      originLongitude,
    ));
  }

  for (const constraint of constraints) {
    if (constraint.type !== 'sector') continue;
    let representativeRange: number | null = null;
    if (
      Number.isFinite(constraint.minRangeMeters)
      && Number.isFinite(constraint.maxRangeMeters)
    ) {
      representativeRange = (
        Number(constraint.minRangeMeters)
        + Number(constraint.maxRangeMeters)
      ) / 2;
    } else if (Number.isFinite(constraint.maxRangeMeters)) {
      representativeRange = Math.max(1, Number(constraint.maxRangeMeters) * 0.5);
    } else if (Number.isFinite(constraint.minRangeMeters)) {
      representativeRange = Math.max(1, Number(constraint.minRangeMeters));
    }
    if (representativeRange !== null) {
      candidates.push(bearingCandidate(
        constraint.anchor,
        constraint.centerBearingDegrees,
        representativeRange,
        originLatitude,
        originLongitude,
      ));
    }
  }

  if (!candidates.length) {
    const anchors: LocalPoint[] = [];
    for (const constraint of constraints) {
      if (constraint.type === 'position') continue;
      if (constraint.type === 'range_difference') {
        anchors.push(
          localMeters(
            constraint.anchorA.latitude,
            constraint.anchorA.longitude,
            originLatitude,
            originLongitude,
          ),
          localMeters(
            constraint.anchorB.latitude,
            constraint.anchorB.longitude,
            originLatitude,
            originLongitude,
          ),
        );
      } else {
        anchors.push(localMeters(
          constraint.anchor.latitude,
          constraint.anchor.longitude,
          originLatitude,
          originLongitude,
        ));
      }
    }
    if (anchors.length) candidates.push({
      x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
      y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
    });
  }

  if (!candidates.length) return { x: 0, y: 0 };
  return {
    x: candidates.reduce((sum, point) => sum + point.x, 0) / candidates.length,
    y: candidates.reduce((sum, point) => sum + point.y, 0) / candidates.length,
  };
}

function buildNormalEquation(
  constraints: SpectraSpatialConstraint[],
  estimate: LocalPoint,
  originLatitude: number,
  originLongitude: number,
  correlationCounts: Map<string, number>,
): NormalEquation {
  const equation: NormalEquation = {
    h00: 0,
    h01: 0,
    h11: 0,
    g0: 0,
    g1: 0,
    weightedResidual: 0,
    weightSum: 0,
    equationCount: 0,
    contradictionCount: 0,
  };

  for (const constraint of constraints) {
    const key = correlationKey(constraint);
    const dependencyDiscount = 1 / Math.max(1, correlationCounts.get(key) || 1);
    const baseWeight = constraintConfidence(constraint) * dependencyDiscount;

    if (constraint.type === 'position') {
      const target = localMeters(
        constraint.latitude,
        constraint.longitude,
        originLatitude,
        originLongitude,
      );
      const sigma = Math.max(0.25, constraint.uncertaintyMeters);
      addEquation(
        equation,
        (estimate.x - target.x) / sigma,
        1 / sigma,
        0,
        baseWeight,
      );
      addEquation(
        equation,
        (estimate.y - target.y) / sigma,
        0,
        1 / sigma,
        baseWeight,
      );
      continue;
    }

    if (constraint.type === 'range') {
      const anchor = localMeters(
        constraint.anchor.latitude,
        constraint.anchor.longitude,
        originLatitude,
        originLongitude,
      );
      const dx = estimate.x - anchor.x;
      const dy = estimate.y - anchor.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const sigma = Math.max(
        0.25,
        Math.hypot(
          constraint.uncertaintyMeters,
          anchorUncertainty(constraint.anchor),
        ),
      );
      addEquation(
        equation,
        (distance - constraint.distanceMeters) / sigma,
        dx / distance / sigma,
        dy / distance / sigma,
        baseWeight,
      );
      continue;
    }

    if (constraint.type === 'range_difference') {
      const anchorA = localMeters(
        constraint.anchorA.latitude,
        constraint.anchorA.longitude,
        originLatitude,
        originLongitude,
      );
      const anchorB = localMeters(
        constraint.anchorB.latitude,
        constraint.anchorB.longitude,
        originLatitude,
        originLongitude,
      );
      const dax = estimate.x - anchorA.x;
      const day = estimate.y - anchorA.y;
      const dbx = estimate.x - anchorB.x;
      const dby = estimate.y - anchorB.y;
      const distanceA = Math.max(0.01, Math.hypot(dax, day));
      const distanceB = Math.max(0.01, Math.hypot(dbx, dby));
      const sigma = Math.max(
        0.25,
        Math.hypot(
          constraint.uncertaintyMeters,
          anchorUncertainty(constraint.anchorA),
          anchorUncertainty(constraint.anchorB),
        ),
      );
      addEquation(
        equation,
        (
          distanceA
          - distanceB
          - constraint.rangeDifferenceMeters
        ) / sigma,
        (dax / distanceA - dbx / distanceB) / sigma,
        (day / distanceA - dby / distanceB) / sigma,
        baseWeight,
      );
      continue;
    }

    if (constraint.type === 'bearing') {
      const anchor = localMeters(
        constraint.anchor.latitude,
        constraint.anchor.longitude,
        originLatitude,
        originLongitude,
      );
      const dx = estimate.x - anchor.x;
      const dy = estimate.y - anchor.y;
      const distanceSquared = Math.max(0.01, dx * dx + dy * dy);
      const theta = Math.atan2(dx, dy);
      const sigma = Math.max(0.002, radians(constraint.bearingUncertaintyDegrees));
      const residual = wrapAngleRadians(theta - radians(constraint.bearingDegrees));
      addEquation(
        equation,
        residual / sigma,
        dy / distanceSquared / sigma,
        -dx / distanceSquared / sigma,
        baseWeight,
      );
      continue;
    }

    const anchor = localMeters(
      constraint.anchor.latitude,
      constraint.anchor.longitude,
      originLatitude,
      originLongitude,
    );
    const dx = estimate.x - anchor.x;
    const dy = estimate.y - anchor.y;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    const theta = Math.atan2(dx, dy);
    const center = radians(constraint.centerBearingDegrees);
    const halfWidth = radians(constraint.halfWidthDegrees);
    const angularOffset = wrapAngleRadians(theta - center);
    const outside = Math.abs(angularOffset) - halfWidth;

    if (outside > 0) {
      const sigma = Math.max(
        radians(0.5),
        radians(Math.max(1, constraint.halfWidthDegrees / 3)),
      );
      const edgeResidual = Math.sign(angularOffset) * outside;
      const distanceSquared = Math.max(0.01, distance * distance);
      addEquation(
        equation,
        edgeResidual / sigma,
        dy / distanceSquared / sigma,
        -dx / distanceSquared / sigma,
        baseWeight,
      );
    }

    const radialSigma = Math.max(
      1,
      Number(constraint.uncertaintyMeters)
      || Math.max(25, distance * 0.15),
    );
    if (
      Number.isFinite(constraint.minRangeMeters)
      && distance < Number(constraint.minRangeMeters)
    ) {
      addEquation(
        equation,
        (distance - Number(constraint.minRangeMeters)) / radialSigma,
        dx / distance / radialSigma,
        dy / distance / radialSigma,
        baseWeight,
      );
    }
    if (
      Number.isFinite(constraint.maxRangeMeters)
      && distance > Number(constraint.maxRangeMeters)
    ) {
      addEquation(
        equation,
        (distance - Number(constraint.maxRangeMeters)) / radialSigma,
        dx / distance / radialSigma,
        dy / distance / radialSigma,
        baseWeight,
      );
    }
  }

  return equation;
}

export function solveSpectraSpatialConstraints(
  constraints: SpectraSpatialConstraint[],
): ConstraintSolveResult | null {
  if (!constraints.length) return null;

  const origin = originForConstraints(constraints);
  if (!origin) return null;

  const correlationCounts = new Map<string, number>();
  for (const constraint of constraints) {
    const key = correlationKey(constraint);
    correlationCounts.set(key, (correlationCounts.get(key) || 0) + 1);
  }

  let estimate = initialEstimate(
    constraints,
    origin.latitude,
    origin.longitude,
  );
  let finalEquation: NormalEquation | null = null;
  let iterations = 0;

  for (let iteration = 0; iteration < 16; iteration += 1) {
    iterations = iteration + 1;
    const equation = buildNormalEquation(
      constraints,
      estimate,
      origin.latitude,
      origin.longitude,
      correlationCounts,
    );
    finalEquation = equation;

    if (equation.equationCount < 2) return null;

    const scale = Math.max(1, equation.h00 + equation.h11);
    const damping = scale * 1e-8;
    const step = solve2x2(
      equation.h00 + damping,
      equation.h01,
      equation.h11 + damping,
      -equation.g0,
      -equation.g1,
    );
    if (!step) return null;

    const stepMagnitude = Math.hypot(step.x, step.y);
    const stepScale = stepMagnitude > 20_000
      ? 20_000 / stepMagnitude
      : 1;
    estimate = {
      x: estimate.x + step.x * stepScale,
      y: estimate.y + step.y * stepScale,
    };

    if (stepMagnitude * stepScale < 0.02) break;
  }

  finalEquation = buildNormalEquation(
    constraints,
    estimate,
    origin.latitude,
    origin.longitude,
    correlationCounts,
  );
  const information = solve2x2(
    finalEquation.h00 + 1e-12,
    finalEquation.h01,
    finalEquation.h11 + 1e-12,
    1,
    0,
  );
  const determinant =
    finalEquation.h00 * finalEquation.h11
    - finalEquation.h01 * finalEquation.h01;

  if (
    !Number.isFinite(determinant)
    || determinant <= 1e-10
    || !information
  ) return null;

  const covarianceEast = finalEquation.h11 / determinant;
  const covarianceNorth = finalEquation.h00 / determinant;
  const covarianceCross = -finalEquation.h01 / determinant;
  if (
    !Number.isFinite(covarianceEast)
    || !Number.isFinite(covarianceNorth)
    || covarianceEast <= 0
    || covarianceNorth <= 0
  ) return null;

  const residualRms = Math.sqrt(
    finalEquation.weightedResidual
    / Math.max(1e-9, finalEquation.weightSum),
  );
  const radialSigma = Math.sqrt(
    Math.max(0.0001, (covarianceEast + covarianceNorth) / 2),
  );
  const accuracyMeters = Math.max(0.25, radialSigma * CHI2_RADIUS_95);

  const domainReliability = new Map<string, number>();
  for (const constraint of constraints) {
    const key = correlationKey(constraint);
    domainReliability.set(
      key,
      Math.max(
        domainReliability.get(key) || 0,
        Math.min(0.995, constraintConfidence(constraint)),
      ),
    );
  }
  let missProbability = 1;
  for (const reliability of domainReliability.values()) {
    missProbability *= 1 - reliability;
  }
  const independentReliability = 1 - missProbability;
  const residualPenalty = 1 / (1 + Math.max(0, residualRms - 1) ** 2);
  const confidence = clamp(
    independentReliability * residualPenalty,
    0.05,
    0.95,
  );

  const coordinate = geoFromLocalMeters(
    estimate.x,
    estimate.y,
    origin.latitude,
    origin.longitude,
  );

  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    accuracyMeters,
    confidence,
    covariance: {
      eastVariance: covarianceEast,
      northVariance: covarianceNorth,
      eastNorthCovariance: covarianceCross,
    },
    residualRms,
    iterations,
    constraintCount: constraints.length,
    independentDomainCount: domainReliability.size,
    contradictionCount: finalEquation.contradictionCount,
    supportKinds: [...new Set(constraints.map(constraint => constraint.type))],
  };
}

interface State1D {
  position: number;
  velocity: number;
}

interface Covariance2 {
  p00: number;
  p01: number;
  p10: number;
  p11: number;
}

interface AxisStep {
  filteredState: State1D;
  filteredCovariance: Covariance2;
  predictedState: State1D;
  predictedCovariance: Covariance2;
  dt: number;
  outlierDownweighted: boolean;
}

function inverse2(matrix: Covariance2): Covariance2 | null {
  const determinant = matrix.p00 * matrix.p11 - matrix.p01 * matrix.p10;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return {
    p00: matrix.p11 / determinant,
    p01: -matrix.p01 / determinant,
    p10: -matrix.p10 / determinant,
    p11: matrix.p00 / determinant,
  };
}

function multiply2(left: Covariance2, right: Covariance2): Covariance2 {
  return {
    p00: left.p00 * right.p00 + left.p01 * right.p10,
    p01: left.p00 * right.p01 + left.p01 * right.p11,
    p10: left.p10 * right.p00 + left.p11 * right.p10,
    p11: left.p10 * right.p01 + left.p11 * right.p11,
  };
}

function subtract2(left: Covariance2, right: Covariance2): Covariance2 {
  return {
    p00: left.p00 - right.p00,
    p01: left.p01 - right.p01,
    p10: left.p10 - right.p10,
    p11: left.p11 - right.p11,
  };
}

function add2(left: Covariance2, right: Covariance2): Covariance2 {
  return {
    p00: left.p00 + right.p00,
    p01: left.p01 + right.p01,
    p10: left.p10 + right.p10,
    p11: left.p11 + right.p11,
  };
}

function transpose2(matrix: Covariance2): Covariance2 {
  return {
    p00: matrix.p00,
    p01: matrix.p10,
    p10: matrix.p01,
    p11: matrix.p11,
  };
}

function runAxisFilter(
  measurements: number[],
  timestamps: number[],
  sigmas: number[],
): { states: State1D[]; covariances: Covariance2[]; outliers: boolean[] } {
  const count = measurements.length;
  if (!count) return { states: [], covariances: [], outliers: [] };

  const initialDt = count > 1
    ? Math.max(0.1, (timestamps[1] - timestamps[0]) / 1000)
    : 1;
  const initialVelocity = count > 1
    ? clamp((measurements[1] - measurements[0]) / initialDt, -120, 120)
    : 0;
  let state: State1D = {
    position: measurements[0],
    velocity: initialVelocity,
  };
  let covariance: Covariance2 = {
    p00: Math.max(1, sigmas[0] ** 2),
    p01: 0,
    p10: 0,
    p11: 900,
  };

  const steps: AxisStep[] = [{
    filteredState: { ...state },
    filteredCovariance: { ...covariance },
    predictedState: { ...state },
    predictedCovariance: { ...covariance },
    dt: 0,
    outlierDownweighted: false,
  }];

  for (let index = 1; index < count; index += 1) {
    const dt = clamp((timestamps[index] - timestamps[index - 1]) / 1000, 0.05, 300);
    const accelerationSigma = 4;
    const q = accelerationSigma ** 2;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt2 * dt2;

    const predictedState: State1D = {
      position: state.position + state.velocity * dt,
      velocity: state.velocity,
    };
    const predictedCovariance: Covariance2 = {
      p00:
        covariance.p00
        + dt * (covariance.p01 + covariance.p10)
        + dt2 * covariance.p11
        + q * dt4 / 4,
      p01: covariance.p01 + dt * covariance.p11 + q * dt3 / 2,
      p10: covariance.p10 + dt * covariance.p11 + q * dt3 / 2,
      p11: covariance.p11 + q * dt2,
    };

    const measurementVariance = Math.max(1, sigmas[index] ** 2);
    const innovation = measurements[index] - predictedState.position;
    const nominalInnovationVariance = predictedCovariance.p00 + measurementVariance;
    const normalizedInnovation = Math.abs(innovation)
      / Math.sqrt(Math.max(1, nominalInnovationVariance));
    const outlierDownweighted = normalizedInnovation > 4;
    const robustMeasurementVariance = outlierDownweighted
      ? measurementVariance * Math.min(100, (normalizedInnovation / 4) ** 2)
      : measurementVariance;
    const innovationVariance =
      predictedCovariance.p00 + robustMeasurementVariance;
    const gainPosition = predictedCovariance.p00 / innovationVariance;
    const gainVelocity = predictedCovariance.p10 / innovationVariance;

    state = {
      position: predictedState.position + gainPosition * innovation,
      velocity: predictedState.velocity + gainVelocity * innovation,
    };

    const p00 = (1 - gainPosition) * predictedCovariance.p00;
    const p01 = (1 - gainPosition) * predictedCovariance.p01;
    const p10 =
      predictedCovariance.p10
      - gainVelocity * predictedCovariance.p00;
    const p11 =
      predictedCovariance.p11
      - gainVelocity * predictedCovariance.p01;

    covariance = {
      p00: Math.max(0.0001, p00),
      p01: (p01 + p10) / 2,
      p10: (p01 + p10) / 2,
      p11: Math.max(0.0001, p11),
    };

    steps.push({
      filteredState: { ...state },
      filteredCovariance: { ...covariance },
      predictedState,
      predictedCovariance,
      dt,
      outlierDownweighted,
    });
  }

  const smoothedStates = steps.map(step => ({ ...step.filteredState }));
  const smoothedCovariances = steps.map(step => ({ ...step.filteredCovariance }));

  for (let index = count - 2; index >= 0; index -= 1) {
    const next = steps[index + 1];
    const current = steps[index];
    const dt = next.dt;
    const cross: Covariance2 = {
      p00:
        current.filteredCovariance.p00
        + dt * current.filteredCovariance.p01,
      p01: current.filteredCovariance.p01,
      p10:
        current.filteredCovariance.p10
        + dt * current.filteredCovariance.p11,
      p11: current.filteredCovariance.p11,
    };
    const inversePrediction = inverse2(next.predictedCovariance);
    if (!inversePrediction) continue;
    const gain = multiply2(cross, inversePrediction);

    const stateDelta = {
      position:
        smoothedStates[index + 1].position
        - next.predictedState.position,
      velocity:
        smoothedStates[index + 1].velocity
        - next.predictedState.velocity,
    };

    smoothedStates[index] = {
      position:
        current.filteredState.position
        + gain.p00 * stateDelta.position
        + gain.p01 * stateDelta.velocity,
      velocity:
        current.filteredState.velocity
        + gain.p10 * stateDelta.position
        + gain.p11 * stateDelta.velocity,
    };

    const covarianceDelta = subtract2(
      smoothedCovariances[index + 1],
      next.predictedCovariance,
    );
    const gainDelta = multiply2(
      multiply2(gain, covarianceDelta),
      transpose2(gain),
    );
    smoothedCovariances[index] = add2(
      current.filteredCovariance,
      gainDelta,
    );
  }

  return {
    states: smoothedStates,
    covariances: smoothedCovariances,
    outliers: steps.map(step => step.outlierDownweighted),
  };
}

function pointAccuracy(point: GPSPoint): number {
  const accuracy = Number(point.accuracy);
  return Number.isFinite(accuracy) && accuracy > 0
    ? clamp(accuracy, 1, 100_000)
    : 250;
}

function pointDistanceMeters(left: GPSPoint, right: GPSPoint): number {
  const latitudeRadians = radians((left.latitude + right.latitude) / 2);
  const dx =
    radians(right.longitude - left.longitude)
    * EARTH_RADIUS_METERS
    * Math.max(0.05, Math.cos(latitudeRadians));
  const dy = radians(right.latitude - left.latitude) * EARTH_RADIUS_METERS;
  return Math.hypot(dx, dy);
}

function smoothSegment(points: GPSPoint[]): GPSPoint[] {
  if (points.length < 3) return points.map(point => ({ ...point }));

  const originLatitude = points[0].latitude;
  const originLongitude = points[0].longitude;
  const local = points.map(point => localMeters(
    point.latitude,
    point.longitude,
    originLatitude,
    originLongitude,
  ));
  const timestamps = points.map(point => point.timestamp.getTime());
  const sigmas = points.map(point => pointAccuracy(point));

  const east = runAxisFilter(
    local.map(point => point.x),
    timestamps,
    sigmas,
  );
  const north = runAxisFilter(
    local.map(point => point.y),
    timestamps,
    sigmas,
  );

  return points.map((point, index) => {
    const original = local[index];
    let smoothedX = east.states[index].position;
    let smoothedY = north.states[index].position;
    const correction = Math.hypot(
      smoothedX - original.x,
      smoothedY - original.y,
    );
    const maxCorrection = Math.max(25, pointAccuracy(point) * 1.5);
    const correctionCapped = correction > maxCorrection;
    if (correctionCapped) {
      const scale = maxCorrection / correction;
      smoothedX = original.x + (smoothedX - original.x) * scale;
      smoothedY = original.y + (smoothedY - original.y) * scale;
    }

    const coordinate = geoFromLocalMeters(
      smoothedX,
      smoothedY,
      originLatitude,
      originLongitude,
    );
    const covarianceSigma = Math.sqrt(Math.max(
      0.0001,
      (
        Math.max(0.0001, east.covariances[index].p00)
        + Math.max(0.0001, north.covariances[index].p00)
      ) / 2,
    ));
    const posteriorRadius95 = covarianceSigma * CHI2_RADIUS_95;
    const originalAccuracy = pointAccuracy(point);
    const speed = Math.hypot(
      east.states[index].velocity,
      north.states[index].velocity,
    );
    const heading = (
      Math.atan2(
        east.states[index].velocity,
        north.states[index].velocity,
      )
      * 180 / Math.PI
      + 360
    ) % 360;
    const outlierDownweighted =
      east.outliers[index] || north.outliers[index];

    return {
      ...point,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      // State smoothing is allowed to stabilize the trajectory, but it must not
      // claim better precision than the underlying observation supplied.
      accuracy: Math.max(originalAccuracy, posteriorRadius95),
      confidence: outlierDownweighted
        ? Math.max(0.05, point.confidence * 0.85)
        : point.confidence,
      provenance: {
        ...(point.provenance || {}),
        transformedBy: [
          ...(point.provenance?.transformedBy || []),
          'spectra_fixed_lag_state_smoothing',
        ],
      },
      metadata: {
        ...(point.metadata || {}),
        velocity: {
          speed,
          heading,
        },
        stateEstimator: {
          model: 'constant_velocity_fixed_lag',
          correctionMeters: correction,
          correctionCapped,
          posteriorRadius95Meters: posteriorRadius95,
          originalAccuracyMeters: originalAccuracy,
          outlierDownweighted,
        },
      },
    };
  });
}

export function smoothSpectraTrajectory(points: GPSPoint[]): GPSPoint[] {
  if (points.length < 3) return points.map(point => ({ ...point }));

  const sorted = [...points].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const segments: GPSPoint[][] = [];
  let segment: GPSPoint[] = [];

  for (const point of sorted) {
    if (!segment.length) {
      segment.push(point);
      continue;
    }

    const previous = segment[segment.length - 1];
    const dtSeconds =
      (point.timestamp.getTime() - previous.timestamp.getTime()) / 1000;
    const distance = pointDistanceMeters(previous, point);
    const requiredSpeed = dtSeconds > 0
      ? distance / dtSeconds
      : Number.POSITIVE_INFINITY;
    const discontinuity =
      dtSeconds <= 0
      || dtSeconds > 300
      || requiredSpeed > 150
      || point.observationKind === 'historical'
      || previous.observationKind === 'historical'
      || point.observationKind === 'predicted'
      || previous.observationKind === 'predicted';

    if (discontinuity) {
      segments.push(segment);
      segment = [point];
    } else {
      segment.push(point);
    }
  }
  if (segment.length) segments.push(segment);

  return segments.flatMap(smoothSegment);
}
