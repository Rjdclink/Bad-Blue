import assert from 'node:assert/strict';
import { importSpectraTelemetry } from '../server/services/spectra/SpectraTelemetryImport';

const timestamp = '2026-01-01T12:00:00.000Z';
const plain = importSpectraTelemetry('geojson', JSON.stringify({ observations: [
  { latitude: 45, longitude: -90, timestamp, accuracy: 12 },
  { latitude: 45, longitude: -90, accuracy: 1 },
  { latitude: null, longitude: null, timestamp },
  { latitudeE7: null, longitudeE7: null, timestamp },
  { latitude: 45, longitude: -90, timestampMs: null },
  { latitude: ' ', longitude: ' ', timestamp },
  { latitude: false, longitude: false, timestamp },
]}));
assert.equal(plain.length, 1, 'exports must reject missing time or coordinates');
assert.equal(plain[0].accuracy, 12, 'reported accuracy must survive import');
assert.equal(plain[0].timestamp, timestamp, 'capture time must survive import');

const e7 = importSpectraTelemetry('geojson', JSON.stringify({ locations: [
  { latitudeE7: 450000000, longitudeE7: -900000000, timestampMs: String(Date.parse(timestamp)), accuracy: 20 },
]}));
assert.equal(e7.length, 1);
assert.equal(e7[0].latitude, 45);
assert.equal(e7[0].longitude, -90);
assert.equal(e7[0].timestamp, timestamp);

const geojson = importSpectraTelemetry('geojson', JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-90, 45] }, properties: { timestamp, accuracy: 10 } },
]}));
assert.equal(geojson.length, 1, 'existing GeoJSON imports must remain unchanged');
assert.equal(geojson[0].accuracy, 10);
console.log('SPECTRA JSON location export checks passed.');
