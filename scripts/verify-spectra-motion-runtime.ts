import assert from 'node:assert/strict';
import { MonteCarloPathEngine } from '../server/services/geoconsole/monteCarloPathEngine';
import type { GPSPoint } from '../server/services/geoconsole/types';

const engine = new MonteCarloPathEngine({ iterations: 8 });
const start = Date.parse('2026-01-01T12:00:00Z');
const points: GPSPoint[] = [0, 1, 2].map(index => ({
  latitude: 45,
  longitude: -90 + index * 0.0001,
  timestamp: new Date(start + index * 30_000),
  accuracy: 6,
  source: 'browser_geolocation',
  observationKind: 'observed',
  confidence: 0.7,
}));

const single = await engine.generateMotionTrail([points[0]]);
assert.equal(single.points.length, 1);
assert.equal(single.totalDistance, 0);
const trail = await engine.generateMotionTrail(points);
assert.equal(trail.points.length, 3);
assert(trail.totalDistance > 15 && trail.totalDistance < 16,
  'a measured multi-point trail must calculate its distance in meters');
const interrupted = await engine.generateMotionTrail([
  points[0], { ...points[1], metadata: { gapBeforeSeconds: 30 } },
]);
assert.equal(interrupted.totalDistance, 0, 'an evidence gap must not count as observed travel');

const path = await engine.interpolatePath(points[0], points[1]);
assert.equal(path.method, 'linear');
assert.equal(path.interpolatedPoints[0].longitude, points[0].longitude);
assert.equal(path.interpolatedPoints.at(-1)?.longitude, points[1].longitude);
const prediction = await engine.generateFuturecast(points);
assert.equal(prediction.length, 12);
assert(prediction.every(point => point.source === 'predicted'
  && point.observationKind === 'predicted'
  && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)));
assert.deepEqual(await engine.generateFuturecast(points.slice(0, 2)), [],
  'insufficient observations must not produce a prediction');

console.log('Spectra motion runtime passed: single and multi-point trails, gaps, interpolation, labeled Futurecast.');
