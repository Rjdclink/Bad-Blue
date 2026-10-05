import assert from 'node:assert/strict';
import {
  buildSpectraSpatialConstraints,
  solveSpectraConstraintLayer,
} from '../server/services/spectra/SpectraConstraintSolver';
import type { GPSPoint } from '../server/services/geoconsole/types';

const R = 6_378_137;
const D = Math.PI / 180;
function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const p1 = a.latitude * D;
  const p2 = b.latitude * D;
  const dp = (b.latitude - a.latitude) * D;
  const dl = (b.longitude - a.longitude) * D;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

const target = { latitude: 43.5446, longitude: -96.7311 };
const now = new Date('2026-10-03T20:00:00.000Z');

function point(overrides: Partial<GPSPoint> = {}): GPSPoint {
  return {
    latitude: target.latitude,
    longitude: target.longitude,
    accuracy: 20,
    timestamp: now,
    source: 'gnss_fix',
    confidence: 0.9,
    observationKind: 'observed',
    provenance: { provider: 'test-provider' },
    metadata: {},
    ...overrides,
  };
}

function anchor(latitude: number, longitude: number, uncertaintyMeters = 1) {
  return {
    latitude,
    longitude,
    distanceMeters: distance(target, { latitude, longitude }),
    uncertaintyMeters,
  };
}

// Multi-anchor convergence: a biased seed is pulled toward the common range intersection.
{
  const anchors = [
    anchor(43.5446, -96.7308),
    anchor(43.5449, -96.7311),
    anchor(43.5444, -96.73135),
    anchor(43.54475, -96.73142),
  ];
  const seed = point({
    latitude: 43.5450,
    longitude: -96.7305,
    accuracy: 60,
    source: 'uwb_range',
    correlationGroup: 'uwb-session-a',
    metadata: { constraintAnchors: anchors },
  });
  const before = distance(seed, target);
  const solved = solveSpectraConstraintLayer([seed]);
  const after = distance(solved.points[0], target);
  assert.ok(after < before * 0.6, `multi-anchor solution should converge: before=${before}, after=${after}`);
  assert.ok(solved.constraints.filter(c => c.kind === 'range').length >= 4);
}

// Handoff continuity: a short handoff interval cannot create an impossible teleport.
{
  const first = point({
    timestamp: new Date(now.getTime() - 20_000),
    source: 'wifi_handoff',
    metadata: { maxPhysicalSpeedMps: 15 },
  });
  const second = point({
    latitude: 43.5546,
    longitude: -96.7111,
    timestamp: new Date(now.getTime() - 10_000),
    source: 'wifi_handoff',
    metadata: { maxPhysicalSpeedMps: 15 },
  });
  const third = point({
    latitude: 43.5450,
    longitude: -96.7307,
    timestamp: now,
    source: 'wifi_handoff',
    metadata: { maxPhysicalSpeedMps: 15 },
  });
  const solved = solveSpectraConstraintLayer([first, second, third]);
  assert.ok(distance(solved.points[0], solved.points[1]) <= 155);
  assert.ok(distance(solved.points[1], solved.points[2]) <= 155);
}

// Contradictory evidence is surfaced and may reduce confidence, never increase it.
{
  const contradictory = point({
    source: 'uwb_range',
    confidence: 0.99,
    accuracy: 1,
    metadata: {
      constraintAnchors: [
        {
          latitude: 43.5446,
          longitude: -96.7308,
          distanceMeters: 2_000,
          uncertaintyMeters: 0.5,
        },
        {
          latitude: 43.5449,
          longitude: -96.7311,
          distanceMeters: 2_500,
          uncertaintyMeters: 0.5,
        },
        {
          latitude: 43.5444,
          longitude: -96.73135,
          distanceMeters: 3_000,
          uncertaintyMeters: 0.5,
        },
      ],
    },
  });
  const solved = solveSpectraConstraintLayer([contradictory]);
  assert.ok(solved.diagnostics.contradictoryConstraintCount > 0);
  assert.ok(solved.points[0].confidence <= contradictory.confidence);
}

// Dependency graph: duplicated correlated observations stay one independent domain.
{
  const correlated = Array.from({ length: 5 }, (_, index) => point({
    timestamp: new Date(now.getTime() + index * 10),
    correlationGroup: 'same-radio-capture',
    provenance: { provider: 'same-modem' },
    metadata: { dependencyGroup: 'same-radio-capture' },
  }));
  const constraints = buildSpectraSpatialConstraints(correlated);
  const solved = solveSpectraConstraintLayer(correlated);
  assert.equal(new Set(constraints.map(c => c.dependencyKey)).size, 1);
  assert.equal(solved.diagnostics.independentDependencyCount, 1);
}

// Backward smoothing: later evidence refines a recent outlier rather than only the latest point.
{
  const a = point({ timestamp: new Date(now.getTime() - 20_000), metadata: { maxPhysicalSpeedMps: 10 } });
  const b = point({
    latitude: 43.5485,
    longitude: -96.7250,
    timestamp: new Date(now.getTime() - 10_000),
    accuracy: 80,
    metadata: { maxPhysicalSpeedMps: 10 },
  });
  const c = point({
    latitude: 43.54475,
    longitude: -96.7309,
    timestamp: now,
    metadata: { maxPhysicalSpeedMps: 10 },
  });
  const before = distance(b, target);
  const solved = solveSpectraConstraintLayer([a, b, c]);
  const after = distance(solved.points[1], target);
  assert.equal(solved.diagnostics.backwardSmoothingApplied, true);
  assert.ok(after < before);
  assert.ok(solved.points[1].provenance?.transformedBy?.includes('spectra_forward_backward_motion_smoother'));
}

// Uncertainty growth: physically impossible motion expands uncertainty instead of manufacturing precision.
{
  const a = point({
    timestamp: new Date(now.getTime() - 1_000),
    accuracy: 2,
    metadata: { maxPhysicalSpeedMps: 2 },
  });
  const b = point({
    latitude: 43.5546,
    longitude: -96.7111,
    timestamp: now,
    accuracy: 2,
    metadata: { maxPhysicalSpeedMps: 2 },
  });
  const solved = solveSpectraConstraintLayer([a, b]);
  assert.ok((solved.points[1].accuracy ?? 0) > 2);
  assert.ok(solved.points[1].confidence <= b.confidence);
}

// Road/terrain constraints are represented in the common constraint layer.
{
  const constrained = point({
    latitude: 43.5449,
    longitude: -96.7305,
    metadata: {
      roadPolyline: [
        { latitude: 43.5444, longitude: -96.7311 },
        { latitude: 43.5448, longitude: -96.7311 },
      ],
      roadMaxOffsetMeters: 5,
      terrainAllowedCenter: target,
      terrainAllowedRadiusMeters: 100,
    },
  });
  const constraints = buildSpectraSpatialConstraints([constrained]);
  assert.ok(constraints.some(c => c.kind === 'road'));
  assert.ok(constraints.some(c => c.kind === 'terrain'));
}

// TDOA and AoA/AoD-style metadata are converted into common constraints.
{
  const p = point({
    source: 'nr_positioning',
    metadata: {
      constraintAnchors: [{
        latitude: 43.5445,
        longitude: -96.7313,
        distanceMeters: 30,
        uncertaintyMeters: 4,
        aoaDegrees: 45,
        bearingUncertaintyDegrees: 6,
      }],
      tdoaConstraints: [{
        anchorA: { latitude: 43.5444, longitude: -96.7314 },
        anchorB: { latitude: 43.5448, longitude: -96.7308 },
        distanceDifferenceMeters: 12,
        uncertaintyMeters: 5,
      }],
    },
  });
  const constraints = buildSpectraSpatialConstraints([p]);
  assert.ok(constraints.some(c => c.kind === 'bearing'));
  assert.ok(constraints.some(c => c.kind === 'range_difference'));
}

console.log('SPECTRA constraint-solver regression checks passed.');
