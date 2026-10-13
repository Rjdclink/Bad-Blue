import assert from 'node:assert/strict';
import { summarizeSpectraMediaEvidence } from '../server/services/spectra/SpectraMediaCorrelation';
import { parseSpectraVisualSceneAssessment } from '../server/services/spectra/SpectraVisualSceneAnalysis';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const now = new Date('2026-10-13T12:00:00.000Z');
const shaA = 'a'.repeat(64), shaB = 'b'.repeat(64), shaC = 'c'.repeat(64);
const labels = (sha: string, objects: string[]) =>
  parseSpectraVisualSceneAssessment(JSON.stringify({
    objects, vehicles: ['truck'], settings: ['urban_street'],
    identity: 'untrusted synthetic person',
    location: 'not evidence of a subject position',
  }), sha);
const image = (sha: string, number: number, objects: string[]): SpectraRetrievedEvidence => ({
  url: `https://cdn.example.net/photo-${number}.jpg`,
  requestedUrl: `https://cdn.example.net/photo-${number}.jpg`,
  retrievedAt: now.toISOString(),
  observations: [],
  structuredRecord: {
    evidenceRole: 'media_capture_scene',
    sourcePostUrl: `https://social.example.net/post/${number}`,
    contentSha256: sha,
    captureLocationIsSubjectPosition: false,
    currentPositionVerified: false,
    captureTimeStatus: 'missing',
    sceneAnalysis: labels(sha, objects),
  },
});

const records = [
  image(shaA, 1, ['road']),
  image(shaA, 2, ['road']),
  image(shaB, 3, ['road']),
  image(shaC, 4, ['water']),
];
const found = summarizeSpectraMediaEvidence(records, now);
assert.equal(found.inspectedImageRecords, 4);
assert.equal(found.distinctImageHashes, 3);
assert.equal(found.duplicateImageRecords, 1, 'reposts of identical bytes are not independent files');
assert.equal(found.classifiedSceneFiles, 3);
assert.equal(found.comparableScenePairs, 3);
assert.equal(found.highGenericSceneOverlapPairs, 1);
assert.equal(found.strongestGenericTagOverlap, 1);
assert.equal(found.faceComparisons, 0);
assert.equal(found.verifiedPersonLocations, 0);
assert.ok(!JSON.stringify(found).includes('untrusted synthetic person'));
assert.ok(!JSON.stringify(found).includes('social.example.net'));

const invalid: SpectraRetrievedEvidence = {
  ...image(shaA, 10, ['road']),
  structuredRecord: {
    ...(image(shaA, 10, ['road']).structuredRecord as Record<string, unknown>),
    currentPositionVerified: true,
  },
};
assert.equal(summarizeSpectraMediaEvidence([invalid], now).inspectedImageRecords, 0,
  'person-location-claiming records must be excluded');
assert.equal(summarizeSpectraMediaEvidence([], now).comparableScenePairs, 0);

console.log('Spectra media correlation: exact-byte dedup, bounded generic scene similarities, no identity or position inference.');
