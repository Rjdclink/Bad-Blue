import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compareSpectraPhotoEvidence,
  inspectSpectraVisualScene,
  parseSpectraVisualSceneAssessment,
  summarizeSpectraSceneOverlap,
} from '../server/services/spectra/SpectraVisualSceneAnalysis';
import { inspectSpectraPublicImageResponse } from '../server/services/spectra/SpectraPublicImageRecords';

const bytes = Buffer.from([255, 216, 255, 217]);
const sha = createHash('sha256').update(bytes).digest('hex');
const text = JSON.stringify({
  objects: ['road', 'street_sign', 'person', 'road', 'read license plate 123'],
  vehicles: ['truck', 'train', 'license_plate', 'truck'],
  settings: ['urban_street', 'parking_area', 'target home address'],
  location: { latitude: 40, longitude: -100 }, identity: 'synthetic person',
});
const parsed = parseSpectraVisualSceneAssessment(text, sha);
assert.ok(parsed);
assert.deepEqual(parsed.objects, ['road', 'street_sign']);
assert.deepEqual(parsed.vehicles, ['truck', 'train']);
assert.deepEqual(parsed.settings, ['urban_street', 'parking_area']);
assert.equal(parsed.evidenceRole, 'model_interpreted_scene_context');
assert.equal(parsed.validation, 'unverified_model_output');
assert.equal(parsed.facialIdentityCompared, false);
assert.equal(parsed.subjectPresenceVerified, false);
assert.equal(parsed.currentPositionVerified, false);
assert.ok(!JSON.stringify(parsed).includes('synthetic person'));
assert.ok(!JSON.stringify(parsed).includes('license plate'));
assert.ok(!JSON.stringify(parsed).includes('latitude'));
assert.equal(parseSpectraVisualSceneAssessment('not-json', sha), null);
assert.equal(parseSpectraVisualSceneAssessment('{}', sha), null);
assert.equal(parseSpectraVisualSceneAssessment(text, 'fake'), null);

let calls = 0;
const scene = await inspectSpectraVisualScene(bytes, 'image/jpeg', {
  analyzer: async (image, mimeType, signal) => {
    calls++;
    assert.equal(mimeType, 'image/jpeg');
    assert.equal(image.toString('hex'), bytes.toString('hex'));
    assert.equal(signal.aborted, false);
    return text;
  },
});
assert.equal(calls, 1);
assert.deepEqual(scene, parsed);
assert.equal(await inspectSpectraVisualScene(bytes, 'image/jpeg'), null,
  'scene analysis is disabled without explicit per-call authorization');
assert.equal(await inspectSpectraVisualScene(Buffer.alloc(3), 'image/jpeg', {
  analyzer: async () => text,
}), null, 'invalid/undersized images never enter model processing');

const match = compareSpectraPhotoEvidence(
  { contentSha256: sha, scene },
  { contentSha256: sha.toUpperCase(), scene },
);
assert.equal(match.exactSameBytes, true);
assert.equal(match.genericSceneTagOverlap, 1);
assert.equal(match.facialIdentityCompared, false);
assert.equal(match.sharedPersonIdentified, false);
assert.equal(match.locationMatchVerified, false);
const different = compareSpectraPhotoEvidence(
  { contentSha256: sha, scene },
  { contentSha256: createHash('sha256').update('different').digest('hex') },
);
assert.equal(different.exactSameBytes, false);
assert.equal(different.genericSceneTagOverlap, null);

const acquired = await inspectSpectraPublicImageResponse(
  new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
  {
    url: 'https://cdn.example.invalid/image.jpg',
    sourcePostUrl: 'https://x.com/fake/status/123456789',
    platform: 'X',
    sceneAnalyzer: async () => parsed,
  },
);
assert.ok(acquired);
assert.equal(acquired.observations.length, 0);
assert.deepEqual((acquired.structuredRecord as any).sceneAnalysis, parsed);
assert.equal((acquired.structuredRecord as any).evidenceRole, 'media_capture_scene');
assert.equal((acquired.structuredRecord as any).captureLocationIsSubjectPosition, false);
assert.equal((acquired.structuredRecord as any).imageBytesArchived, false);
assert.equal((acquired.structuredRecord as any).currentPositionVerified, false);

const failedModel = await inspectSpectraPublicImageResponse(
  new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
  {
    url: 'https://cdn.example.invalid/image2.jpg',
    sourcePostUrl: 'https://x.com/fake/status/123456780',
    platform: 'X',
    sceneAnalyzer: async () => { throw new Error('synthetic optional model failure'); },
  },
);
assert.ok(failedModel);
assert.equal((failedModel.structuredRecord as any).sceneAnalysis, undefined);
assert.equal(failedModel.observations.length, 0);

// Hash repost handling already exists in the Spectra evidence ledger;
// this separate model-only calculation must compare each classified file once.
const shaB = 'b'.repeat(64), shaC = 'c'.repeat(64);
const similar = parseSpectraVisualSceneAssessment(text, shaB)!;
const different = parseSpectraVisualSceneAssessment(JSON.stringify({
  objects: ['water'], vehicles: [], settings: ['coastal'],
}), shaC)!;
const record = (hash: string, labels: unknown) => ({
  structuredRecord: {
    evidenceRole: 'media_capture_scene',
    captureLocationIsSubjectPosition: false,
    currentPositionVerified: false,
    contentSha256: hash,
    sceneAnalysis: labels,
  },
});
const comparison = summarizeSpectraSceneOverlap([
  record(sha, parsed), record(sha, parsed), record(shaB, similar), record(shaC, different),
]);
assert.equal(comparison.distinctClassifiedScenes, 3);
assert.equal(comparison.comparedDistinctPairs, 3);
assert.equal(comparison.highGenericLabelOverlapPairs, 1);
assert.equal(comparison.strongestGenericLabelOverlap, 1);
assert.equal(comparison.facialIdentityComparisons, 0);
assert.equal(comparison.verifiedPersonLocations, 0);
assert.deepEqual(summarizeSpectraSceneOverlap([
  { structuredRecord: { ...record(sha, parsed).structuredRecord, currentPositionVerified: true } },
]), {
  distinctClassifiedScenes: 0, comparedDistinctPairs: 0, highGenericLabelOverlapPairs: 0,
  strongestGenericLabelOverlap: null, facialIdentityComparisons: 0, verifiedPersonLocations: 0,
});

console.log('Spectra visual scenes: opt-in model analysis, strict categories, safe scene-only comparisons and non-fatal model failures.');
