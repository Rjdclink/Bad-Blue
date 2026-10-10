import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGPSFromFile } from '../server/services/gpsIntelligence';
import { extractMediaMetadata } from '../server/services/locationIntelligence/MediaMetadataExtractor';
import { assessSpectraMediaCapture } from '../server/services/spectra/SpectraMediaEvidence';
import { withoutSpectraTimestamps } from '../shared/spectraTimestampClues';

// Exercise the installed decoder, not mocked tag descriptions. This catches
// ESM/CJS import compatibility and numeric GPS descriptions in actual JPEGs.
const fixture = JSON.parse(await readFile(new URL('./fixtures/spectra-synthetic-exif.json', import.meta.url), 'utf8'));
const phoneLike = /\d[\d\s().+-]{6,}\d/;
assert(!phoneLike.test(withoutSpectraTimestamps('Captured 2020-01-01T12:00:00.000Z. Original 2020:01:01 12:00:00.')));
assert(phoneLike.test(withoutSpectraTimestamps('Captured 2020-01-01. Contact +1 (202) 555-0123.')));
const directory = await mkdtemp(join(tmpdir(), 'spectra-exif-test-'));
try {
  const file = join(directory, 'synthetic.jpg');
  await writeFile(file, Buffer.from(fixture.jpegBase64, 'base64'));
  const gps = await extractGPSFromFile(file);
  assert(gps);
  assert(Math.abs(gps.latitude - 38.891333333333336) < 1e-7);
  assert(Math.abs(gps.longitude - (-77.026)) < 1e-7);
  assert.equal(gps.timestamp?.toISOString(), '2020-01-01T12:00:00.000Z');
  assert.equal(gps.accuracy, 10);
  const metadata = await extractMediaMetadata(file, 'synthetic.jpg');
  assert.equal(metadata.extractor, 'exifreader');
  assert.equal(metadata.device.make, 'SPECTRA TEST');
  const assessment = assessSpectraMediaCapture(metadata);
  assert.equal(assessment.status, 'accepted');
  assert.equal(assessment.evidenceRole, 'media_capture_scene');
  assert.equal(assessment.subjectPresenceVerified, false);
  assert.equal(assessment.currentPositionVerified, false);
  console.log('Real EXIF decode passed: numeric GPS, west sign, timestamp, accuracy, and historical scene classification.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
