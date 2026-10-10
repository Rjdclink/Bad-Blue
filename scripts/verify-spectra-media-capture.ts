import assert from 'node:assert/strict';
import { assessSpectraMediaCapture } from '../server/services/spectra/SpectraMediaEvidence';

// Fictional data: evaluate a file's creation scene, not a person's position.
const asOf = new Date('2026-10-09T16:00:00.000Z');
const scene = {
  gps: {
    latitude: 41.25,
    longitude: -72.5,
    timestamp: new Date('2026-10-09T10:00:00.000Z'),
    accuracy: 12,
  },
  metadataConflicts: [],
};

const recent = assessSpectraMediaCapture(scene, asOf);
assert.equal(recent.status, 'accepted');
assert.equal(recent.ageMs, 6 * 60 * 60_000);
assert.equal(recent.ageBand, 'within_24_hours');
assert.equal(recent.capturedAt, '2026-10-09T10:00:00.000Z');
assert.equal(recent.evidenceRole, 'media_capture_scene');
assert.equal(recent.currentPositionVerified, false);
assert.equal(recent.subjectPresenceVerified, false);

assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: new Date('2026-10-04T16:00:00.000Z') },
}, asOf).ageBand, 'within_7_days');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: new Date('2026-09-25T16:00:00.000Z') },
}, asOf).ageBand, 'within_30_days');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: new Date('2025-08-01T16:00:00.000Z') },
}, asOf).ageBand, 'older');

assert.equal(assessSpectraMediaCapture({
  ...scene, metadataConflicts: ['EXIFReader and ExifTool reported different GPS coordinates.'],
}, asOf).status, 'conflicting_gps', 'conflicting extractors must stop location admission');
assert.equal(assessSpectraMediaCapture({
  gps: undefined, metadataConflicts: [],
}, asOf).status, 'missing_gps');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, latitude: 91 },
}, asOf).status, 'invalid_gps');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, longitude: Number.NaN },
}, asOf).status, 'invalid_gps');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: undefined },
}, asOf).status, 'missing_capture_time');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: new Date('2026-10-10T16:00:00.000Z') },
}, asOf).status, 'future_capture_time');
assert.equal(assessSpectraMediaCapture({
  ...scene, gps: { ...scene.gps, timestamp: new Date('2026-10-09T16:02:00.000Z') },
}, asOf).ageMs, 0, 'small clock drift must not produce negative evidence ages');
assert.throws(
  () => assessSpectraMediaCapture(scene, new Date('not-a-date')),
  /valid evaluation time/,
);

console.log('SPECTRA media-scene recency, provenance, and conflicting-GPS checks passed.');
