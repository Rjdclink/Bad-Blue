import assert from 'node:assert/strict';
import { estimateSpectraConstraintState } from '../server/services/spectra/SpectraConstraintStateEstimator';
import { MonteCarloPathEngine } from '../server/services/geoconsole/monteCarloPathEngine';
import type { GPSPoint } from '../server/services/geoconsole/types';

function point(
  latitude: number,
  longitude: number,
  second: number,
  accuracy = 8,
  overrides: Partial<GPSPoint> = {},
): GPSPoint {
  return {
    latitude,
    longitude,
    accuracy,
    timestamp: new Date(Date.UTC(2026, 9, 3, 18, 0, second)),
    source: 'gnss_fix',
    confidence: 0.95,
    observationKind: 'observed',
    correlationGroup: 'test:gnss',
    provenance: {
      provider: 'test-provider',
      recordId: `p-${second}-${latitude}-${longitude}`,
    },
    metadata: {
      accuracyConfidenceLevel: 0.68,
    },
    ...overrides,
  };
}

function state(pointValue: GPSPoint): Record<string, unknown> {
  const value = pointValue.metadata?.stateEstimator;
  assert.ok(value && typeof value === 'object', 'stateEstimator metadata should exist');
  return value as Record<string, unknown>;
}

const smoothTrajectory = [
  point(41.25650, -95.93450, 0, 6),
  point(41.25662, -95.93432, 10, 6),
  point(41.25675, -95.93412, 20, 6),
  point(41.25688, -95.93391, 30, 6),
];

const smoothResult = estimateSpectraConstraintState(smoothTrajectory);
assert.equal(smoothResult.summary.algorithm, 'constant_velocity_kalman_rts');
assert.equal(smoothResult.summary.inputCount, smoothTrajectory.length);
assert.equal(smoothResult.summary.smoothedCount, smoothTrajectory.length);
assert.equal(smoothResult.summary.segmentCount, 1);
assert.equal(smoothResult.points.length, smoothTrajectory.length);

const firstState = state(smoothResult.points[0]);
const lastState = state(smoothResult.points[smoothResult.points.length - 1]);
assert.equal(firstState.backwardSmoothed, true);
assert.equal(lastState.backwardSmoothed, false);
assert.ok(Number(firstState.posteriorSigmaMeters) > 0);
assert.ok(Number(lastState.confidenceRadius95Meters) > 0);
assert.ok(Number(lastState.speedMps) >= 0);
assert.ok(
  smoothResult.points[0].provenance?.transformedBy?.includes('spectra_backward_rts_smoother'),
  'earlier trajectory points should be refined by the backward smoother',
);

const outlierTrajectory = [
  point(41.25650, -95.93450, 0, 4),
  point(41.25662, -95.93432, 10, 4),
  point(42.10000, -96.90000, 20, 2, {
    correlationGroup: 'test:bad-fix',
    provenance: { provider: 'test-bad-provider', recordId: 'bad-fix' },
  }),
  point(41.25688, -95.93391, 30, 4),
];

const outlierResult = estimateSpectraConstraintState(outlierTrajectory);
assert.ok(
  outlierResult.summary.robustlyDownweightedCount >= 1,
  'grossly inconsistent measurements should be robustly downweighted',
);
const outlierState = state(outlierResult.points[2]);
assert.ok(
  Number(outlierState.robustMeasurementInflation) > 1,
  'the outlier should have inflated measurement variance rather than dominating the state',
);

const splitTrajectory = [
  point(41.25650, -95.93450, 0, 8),
  point(41.25660, -95.93435, 10, 8),
  {
    ...point(41.26000, -95.93000, 20, 8),
    timestamp: new Date(Date.UTC(2026, 9, 3, 18, 10, 20)),
  },
];

const splitResult = estimateSpectraConstraintState(splitTrajectory);
assert.equal(splitResult.summary.segmentCount, 2);
assert.equal(splitResult.points.length, splitTrajectory.length);

const discontinuityTrajectory = [
  point(41.25650, -95.93450, 0, 8),
  point(41.25660, -95.93435, 10, 8),
  point(41.25670, -95.93420, 20, 8, {
    metadata: {
      accuracyConfidenceLevel: 0.68,
      continuity: 'discontinuous',
      gapBeforeSeconds: 1,
    },
  }),
];
const discontinuityResult = estimateSpectraConstraintState(discontinuityTrajectory);
assert.equal(discontinuityResult.summary.segmentCount, 2);

const futurecastEngine = new MonteCarloPathEngine();
const futurecast = await futurecastEngine.generateFuturecast(smoothResult.points, 1);
assert.ok(futurecast.length > 0);
assert.equal(futurecast[0].metadata?.stateEstimatorSeeded, true);
assert.ok(Number(futurecast[0].metadata?.stateEstimatorInfluence) >= 0.2);
assert.ok(Number(futurecast[0].metadata?.stateEstimatorInfluence) <= 0.7);
assert.ok(Number(futurecast[0].metadata?.stateEstimatorRadius95Meters) > 0);

console.log('SPECTRA constraint-state estimator verification passed');
