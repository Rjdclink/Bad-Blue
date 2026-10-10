import assert from 'node:assert/strict';
import {
  mergePublicRetrievedMetadata,
  stripUnboundPublicGeoContext,
  unboundPublicGeoContext,
} from '../server/services/spectra/SpectraPublicEvidenceProvenance';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

// A fictional public-page venue coordinate must never be taken as an
// observation of a named individual. No real individual is used.
const original = 'https://discovery.example.org/venue';
const resolved = 'https://canonical.example.net/location';
const evidence: SpectraRetrievedEvidence = {
  requestedUrl: original,
  url: resolved,
  retrievedAt: '2026-10-10T02:00:00.000Z',
  title: 'Fictional public venue',
  textExcerpt: 'Venue information, not a device measurement',
  observations: [{
    latitude: 40.1234,
    longitude: -71.2345,
    timestamp: '2026-10-09T12:00:00.000Z',
    sourceUrl: resolved,
    acquisitionMethod: 'json-ld-geospatial-metadata',
  }],
};
const prior = {
  publishedAt: '2015-03-01T00:00:00.000Z',
  discoveryProvider: 'public-web',
};
const merged = mergePublicRetrievedMetadata(prior, evidence);
assert.equal(merged.requestedUrl, original);
assert.equal(merged.sourceUrl, resolved);
assert.equal(merged.publishedAt, prior.publishedAt,
  'an undated redirect fetch must not erase the known stale publication date');
assert.equal(merged.fetchedExcerpt, evidence.textExcerpt);
const pageGeotags = merged.retrievedLocationEvidence as ReturnType<typeof unboundPublicGeoContext>;
assert.equal(pageGeotags.length, 1);
assert.equal(pageGeotags[0].kind, 'public_source_geospatial_context');
assert.equal(pageGeotags[0].subjectMatchConfidence, 0);
assert.equal(pageGeotags[0].currentPositionVerified, false);

const subjectSafe = stripUnboundPublicGeoContext(merged);
assert.ok(!('retrievedLocationEvidence' in subjectSafe),
  'unbound venue coordinates must never enter subject coordinate extraction');
assert.equal(subjectSafe.publishedAt, prior.publishedAt);
assert.equal(subjectSafe.sourceUrl, resolved);
assert.deepEqual(stripUnboundPublicGeoContext(null), {});
assert.deepEqual(stripUnboundPublicGeoContext([evidence.observations]), {});

const morePrecise = mergePublicRetrievedMetadata(prior, {
  ...evidence,
  publishedAt: '2014-01-01T00:00:00.000Z',
});
assert.equal(morePrecise.publishedAt, '2014-01-01T00:00:00.000Z',
  'a directly observed source publication date takes precedence');
console.log('SPECTRA fetched-page venue provenance / redirect safety tests passed.');
