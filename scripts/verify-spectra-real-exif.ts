import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGPSFromFile } from '../server/services/gpsIntelligence';
import { extractMediaMetadata } from '../server/services/locationIntelligence/MediaMetadataExtractor';
import { assessSpectraMediaCapture } from '../server/services/spectra/SpectraMediaEvidence';
import { inspectSpectraPublicImageResponse } from '../server/services/spectra/SpectraPublicImageRecords';

// This is a synthetic JPEG. It is not a photograph or a record of any person.
const fixture = JSON.parse(await readFile(
  new URL('./fixtures/spectra-synthetic-exif.json', import.meta.url), 'utf8',
));
const bytes = Buffer.from(fixture.jpegBase64, 'base64');
const directory = await mkdtemp(join(tmpdir(), 'spectra-exif-fixture-'));
try {
  const path = join(directory, 'synthetic.jpg');
  await writeFile(path, bytes);
  const gps = await extractGPSFromFile(path);
  assert.ok(gps, 'the installed decoder must read EXIF geotags');
  assert.ok(Math.abs(gps.latitude - 38.891333333333336) < 1e-7);
  assert.ok(Math.abs(gps.longitude - (-77.026)) < 1e-7,
    'west must remain a negative longitude');
  assert.equal(gps.timestamp?.toISOString(), '2020-01-01T12:00:00.000Z');
  assert.equal(gps.accuracy, 10);
  const report = await extractMediaMetadata(path, 'synthetic.jpg');
  assert.equal(report.extractor, 'exifreader', 'the primary EXIF reader must not fail its ESM import');
  assert.equal(report.device.make, 'SPECTRA TEST');
  const assessment = assessSpectraMediaCapture(report);
  assert.equal(assessment.status, 'accepted');
  assert.equal(assessment.evidenceRole, 'media_capture_scene');
  assert.equal(assessment.subjectPresenceVerified, false);
  assert.equal(assessment.currentPositionVerified, false);

  const response = new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  const image = await inspectSpectraPublicImageResponse(response, {
    url: 'https://cdn.bsky.app/img/fixture-synthetic',
    sourcePostUrl: 'https://bsky.app/profile/fixture.example/post/1',
    platform: 'Bluesky',
  });
  assert.ok(image, 'public-image EXIF reader must parse actual JPEG bytes');
  const content = image.structuredRecord as any;
  assert.equal(content.captureTimeStatus, 'utc_offset_present');
  assert.equal(content.capturedAt, '2020-01-01T12:00:00.000Z');
  assert.ok(Math.abs(content.captureGps.latitude - gps.latitude) < 1e-7);
  assert.ok(Math.abs(content.captureGps.longitude - gps.longitude) < 1e-7);
  assert.equal(content.evidenceRole, 'media_capture_scene');
  assert.equal(content.currentPositionVerified, false);
  assert.equal(image.observations.length, 0, 'scene geotags are not person location fixes');
  console.log('SPECTRA installed EXIF decoder checks passed: upload and public image extraction.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
