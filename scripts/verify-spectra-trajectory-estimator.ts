import assert from 'node:assert/strict';
import type { GPSPoint } from '../server/services/geoconsole/types';
import { estimateSpectraTrajectory } from '../server/services/spectra/SpectraTrajectoryEstimator';

const BASE_LAT = 43.5446;
const BASE_LON = -96.7311;
const R = 6_378_137;
const start = new Date('2026-10-03T18:00:00.000Z');

function offset(eastMeters: number, northMeters: number) {
  return {
    latitude: BASE_LAT + northMeters / R * 180 / Math.PI,
    longitude: BASE_LON
      + eastMeters
      / (R * Math.cos(BASE_LAT * Math.PI / 180))
      * 180 / Math.PI,
  };
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

const points: GPSPoint[] = [];

for (let index = 0; index < 7; index += 1) {
  const t = new Date(start.getTime() + index * 10_000);
  const truthEast = index * 100;

  points.push({
    ...offset(truthEast + 2, 1),
    accuracy: 8,
    timestamp: t,
    source: 'gnss_fix',
    confidence: 0.97,
    observationKind: 'observed',
    correlationGroup: 'device-a:gnss',
    provenance: { provider: 'same-device-gnss' },
    metadata: {
      accuracyConfidenceLevel: 0.68,
      correlationDomain: 'device-a',
    },
  });

  // Correlated duplicate from the same device/domain must not count as a
  // second independent source of probability.
  points.push({
    ...offset(truthEast + 3, 2),
    accuracy: 7,
    timestamp: new Date(t.getTime() + 30),
    source: 'visual_positioning',
    confidence: 0.95,
    observationKind: 'observed',
    correlationGroup: 'device-a:vps',
    provenance: { provider: 'same-device-vps' },
    metadata: {
      accuracyConfidenceLevel: 0.68,
      correlationDomain: 'device-a',
      providerKind: 'arcore-geospatial-pose',
    },
  });

  points.push({
    ...offset(truthEast - 1, -2),
    accuracy: 5,
    timestamp: new Date(t.getTime() + 60),
    source: 'wifi_rtt',
    confidence: 0.96,
    observationKind: 'inferred',
    correlationGroup: 'wifi-array-a',
    provenance: { provider: 'independent-wifi-rtt-array' },
    metadata: {
      accuracyConfidenceLevel: 0.68,
      correlationDomain: 'wifi-array-a',
    },
  });
}

// A precise-looking but physically inconsistent independent outlier should be
// down-weighted and reported rather than dragging the path several kilometers.
points.push({
  ...offset(5_000, 5_000),
  accuracy: 4,
  timestamp: new Date(start.getTime() + 30_050),
  source: 'uwb_range',
  confidence: 0.99,
  observationKind: 'inferred',
  correlationGroup: 'bad-anchor-batch',
  provenance: { provider: 'independent-outlier-anchor' },
  metadata: {
    accuracyConfidenceLevel: 0.68,
    correlationDomain: 'outlier-anchor-domain',
  },
});

const estimate = estimateSpectraTrajectory(points, {
  fixedLagSeconds: 3_600,
  maxSpeedMps: 90,
  accelerationSigmaMps2: 4,
});

assert.ok(estimate.states.length >= 7);
assert.ok(estimate.latest);
assert.ok(estimate.diagnostics.independentDomainCount >= 3);
assert.ok(estimate.diagnostics.correlatedObservationCount > 0);
assert.ok(estimate.diagnostics.contradictionCount >= 1);
assert.ok(estimate.diagnostics.motionConstraintViolations >= 1);
assert.ok(Number.isFinite(estimate.diagnostics.latestRadius99Meters));
assert.ok((estimate.diagnostics.latestRadius99Meters ?? Infinity) > 0);
assert.ok(Number.isFinite(estimate.diagnostics.latestSpeedMps));

const truthLatest = offset(600, 0);
const latestError = distanceMeters(estimate.latest!, truthLatest);
assert.ok(
  latestError < 80,
  `Expected robust smoothed endpoint within 80 m of truth, observed ${latestError.toFixed(2)} m`,
);

const domains = new Set(
  estimate.diagnostics.dependencyGroups.map(group => group.id),
);
assert.ok(domains.has('device-a'));
assert.ok(domains.has('wifi-array-a'));
assert.ok(domains.has('outlier-anchor-domain'));

const single = estimateSpectraTrajectory([points[0]]);
assert.equal(single.states.length, 1);
assert.equal(single.states[0].observationKind, 'inferred');
assert.equal(single.states[0].metadata?.dependencyAware, true);

console.log('SPECTRA dependency-aware trajectory estimator regression checks passed.');
