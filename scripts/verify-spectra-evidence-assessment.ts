import assert from 'node:assert/strict';
import { assessSpectraAcquiredEvidence } from '../server/services/spectra/SpectraEvidenceAssessment';
import type { SpectraAcquisitionEvidenceRecord } from '../server/services/spectra/SpectraAcquisitionRecords';

const retrievedAt = '2026-10-09T15:00:00.000Z';
const media = (url: string, post: string, hash: string, capturedAt?: string): SpectraAcquisitionEvidenceRecord => ({
  recordType: 'retrieved_document', provider: 'public-image-test',
  sourceUrl: url, retrievedAt,
  payload: { subjectAssociation: 'public_media_scene_unverified', publishedAt: '2026-10-09T14:00:00Z',
    structuredRecord: {
      evidenceRole: 'media_capture_scene', contentSha256: hash, sourcePostUrl: post,
      capturedAt, captureTimeStatus: capturedAt ? 'utc_offset_present' : 'timezone_unknown',
      captureGps: { latitude: 44.7, longitude: -87.3 },
      currentPositionVerified: false,
    },
  },
});
const photoHash = 'a'.repeat(64);
const photoA = media('https://cdn.example.test/img/scene.jpg',
  'https://social.example.test/post/1', photoHash, '2026-10-05T10:00:00Z');
const photoB = media('https://another.example.test/img/republished.jpg',
  'https://elsewhere.example.test/post/2', photoHash, '2026-10-05T10:00:00Z');
const undated = media('https://cdn.example.test/img/unknown.jpg',
  'https://social.example.test/post/3', 'b'.repeat(64));
const page: SpectraAcquisitionEvidenceRecord = {
  recordType: 'retrieved_document', provider: 'publisher', sourceUrl: 'https://publisher.example.test/article',
  retrievedAt,
  payload: { subjectAssociation: 'unverified_article_mention', publishedAt: '2026-10-08T10:00:00Z',
    title: 'Public article', textExcerpt: 'Fictional source content' },
};
const context = (family: string, provider: string, record: Record<string, unknown>): SpectraAcquisitionEvidenceRecord => ({
  recordType: 'geographic_context', provider,
  sourceUrl: 'https://public.example.test/context/' + family, retrievedAt,
  payload: { classification: 'geographic_context', contextFamily: family, record },
});
const input = [photoA, photoB, undated, page,
  context('cameras', 'transport', { latitude: 42, longitude: -71, observedAt: '2026-10-09T09:00:00Z' }),
  context('earthObservation', 'satellite', { id: 'scene-1', observedAt: '2026-09-02T10:00:00Z' }),
  context('weather', 'weather', { id: 'forecast-1' }),
];
const result = assessSpectraAcquiredEvidence(input, 2);
assert.equal(result.sourceRecordCount, 7);
assert.equal(result.uniqueContributionCount, 6);
assert.equal(result.duplicateCopies, 1, 'reposted identical image bytes count once');
assert.equal(result.countsByKind.photo_capture_scene, 2);
assert.equal(result.countsByKind.retrieved_source, 1);
assert.equal(result.countsByKind.camera_directory, 1);
assert.equal(result.countsByKind.satellite_scene, 1);
assert.equal(result.countsByKind.weather_context, 1);
assert.equal(result.observationsInPositionPipeline, 2);
assert.equal(result.undatedPhotoScenes, 1);
const samePhoto = result.contributions.find(c => c.key === 'photo:' + photoHash);
assert.ok(samePhoto);
assert.equal(samePhoto.copies, 2);
assert.equal(samePhoto.sourceEventAt, '2026-10-05T10:00:00.000Z');
assert.ok(samePhoto.sources.includes('https://social.example.test/post/1'));
assert.ok(samePhoto.sources.includes('https://elsewhere.example.test/post/2'));
assert.equal(samePhoto.subjectPositionEligible, false);
assert.equal(samePhoto.identityBinding, 'unverified');
const undatedPhoto = result.contributions.find(c => c.key === 'photo:' + 'b'.repeat(64));
assert.equal(undatedPhoto?.sourceEventAt, null,
  'publication/retrieval times cannot invent a capture date');
const camera = result.contributions.find(c => c.kind === 'camera_directory');
assert.equal(camera?.hasSceneCoordinates, false,
  'camera coordinates describe camera locations, not pictured subjects');
assert(result.contributions.every(c => c.subjectPositionEligible === false));
assert(!JSON.stringify(result).includes('"latitude"'),
  'the source correlation summary must not leak coordinates as person observations');
const reversed = assessSpectraAcquiredEvidence([...input].reverse());
assert.equal(reversed.uniqueContributionCount, result.uniqueContributionCount);
assert.equal(reversed.duplicateCopies, result.duplicateCopies);
console.log('SPECTRA acquired-record cross-source assessment passed.');
