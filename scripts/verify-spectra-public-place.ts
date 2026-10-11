import assert from 'node:assert/strict';
import { htmlEvidence } from '../server/services/spectra/SpectraPublicRetrieval';
import { acquirePublicPlace, assessPublicPlacePage, isPublicPlaceTarget } from '../server/services/spectra/SpectraPublicPlace';

const target = 'Example Natural History Museum';
const url = 'https://museum.example/visit';
function page(city = 'Washington, D.C. 20560', name = target) {
  return { url, requestedUrl: url, retrievedAt: '2026-10-10T12:00:00Z',
    ...htmlEvidence(`<title>Visit | ${name}</title><main><h1>Plan your visit to this public museum.</h1><div>Location</div><div>10th St. & Constitution Ave. NW<br>${city}</div></main><footer><address>1 Main Street<br>Boston, MA 02110</address></footer>`, url),
  };
}
assert(isPublicPlaceTarget(target));
assert(!isPublicPlaceTarget('Example Person'));
assert(!isPublicPlaceTarget('person@example.com museum'));
assert.deepEqual(assessPublicPlacePage(target, page()), { status: 'supported', city: 'Washington', state: 'DC' });
assert.equal(assessPublicPlacePage(target, page('Washington, D.C. 20560', 'Different Art Museum')).status, 'name-unmatched');
assert.equal(assessPublicPlacePage(target, { ...page(), addressBlocks: ['Washington, DC 20560'] }).status, 'no-supported-address');
assert.equal(assessPublicPlacePage(target, { ...page(), addressBlocks: ['1 Main Street\nBoston, MA 02110\nSeattle, WA 98101'] }).status, 'conflicting-addresses');
assert.equal(assessPublicPlacePage(target, { ...page(), addressBlocks: [] }).status, 'no-supported-address', 'page coordinates alone cannot establish a venue address');

let geocodeCalls = 0;
const deps = {
  discover: async () => [{ url }],
  retrieve: async () => [page()],
  geocode: async (city: string) => { geocodeCalls++; assert.equal(city, 'Washington, DC'); return { latitude: 38.9, longitude: -77.0, accuracyMeters: 20_000 }; },
};
const result = await acquirePublicPlace(target, 'Use public visitor pages.', deps);
assert.equal(result.diagnostics.outcome, 'public-place-city');
assert.equal(result.candidates.length, 1);
assert.equal(result.candidates[0].confidence, 0, 'no invented probability');
assert.equal(result.sources[0].url, url);
assert.equal(result.candidates[0].accuracyMeters, 20_000);
assert.equal(result.records.length, 1);
assert.equal(result.records[0].sourceUrl, url);
assert.equal(result.records[0].requestedUrl, url);
assert.equal(result.records[0].classification, 'public_venue_document');
assert.equal(result.records[0].snapshotKind, 'extracted_document');
assert.match(result.records[0].recordId, /^sha256:[a-f0-9]{64}$/);
assert.equal(result.records[0].textExcerpt, page().textExcerpt, 'retain actual extracted content rather than only a source URL');
assert.match(result.records[0].textExcerpt || '', /Plan your visit to this public museum/);
assert.deepEqual(result.records[0].addressBlocks, page().addressBlocks);
assert.deepEqual(result.records[0].assessment, { status: 'supported', city: 'Washington', state: 'DC' });
assert.equal(result.records[0].retrievedAt, page().retrievedAt);
assert.equal(result.records[0].publishedAt, undefined, 'retrieval time must never become a fabricated publication date');
const conflict = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => [page(), { ...page('Boston, MA 02110'), url: 'https://second.example/visit' }] });
assert.equal(conflict.diagnostics.outcome, 'conflicting-addresses');
assert.equal(conflict.candidates.length, 0);
assert.equal(geocodeCalls, 1, 'conflicts must abstain before geocoding');
const refreshed = await acquirePublicPlace(target, '', {
  ...deps, retrieve: async () => [{ ...page(), retrievedAt: '2026-10-11T12:00:00Z', requestedUrl: 'https://museum.example/visitor-redirect' }],
});
assert.equal(refreshed.records[0].recordId, result.records[0].recordId, 'unchanged content must retain its hash on later retrieval and redirects');
assert.equal(refreshed.records[0].retrievedAt, '2026-10-11T12:00:00Z');
assert.equal(refreshed.records[0].requestedUrl, 'https://museum.example/visitor-redirect');
const changed = await acquirePublicPlace(target, '', {
  ...deps, retrieve: async () => [{ ...page(), textExcerpt: 'The visitor entrance has changed.' }],
});
assert.notEqual(changed.records[0].recordId, result.records[0].recordId, 'changed extracted content must produce a new snapshot identity');
const rejectedPage = page('Washington, D.C. 20560', 'Different Art Museum');
const rejected = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => [rejectedPage] });
assert.equal(rejected.candidates.length, 0);
assert.equal(rejected.records[0].assessment.status, 'name-unmatched', 'retention must not promote rejected evidence to a supported venue match');
assert.equal(rejected.records[0].textExcerpt, rejectedPage.textExcerpt);
const structuredRecord = { id: 'public-venue-7', name: target, city: 'Washington', state: 'DC' };
const structured = await acquirePublicPlace(target, '', {
  ...deps, retrieve: async () => [{ url, requestedUrl: url, retrievedAt: page().retrievedAt, contentType: 'application/json', observations: [], structuredRecord }],
});
assert.equal(structured.records[0].snapshotKind, 'structured_record');
assert.deepEqual(structured.records[0].structuredRecord, structuredRecord);
assert.equal(structured.records[0].assessment.status, 'name-unmatched');
assert.equal(structured.candidates.length, 0, 'retaining JSON must not bypass the visible venue address rules');
const tooMany = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => Array.from({ length: 12 }, () => rejectedPage) });
assert.equal(tooMany.records.length, 8, 'retention stays within the bounded page retrieval limit');
const failed = await acquirePublicPlace(target, '', { ...deps, geocode: async () => { throw Error('offline'); } });
assert.equal(failed.diagnostics.outcome, 'geocoding-unavailable');
assert.equal(failed.candidates.length, 0);
const empty = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => [] });
assert.equal(empty.diagnostics.outcome, 'no-supported-address');
assert.equal(empty.diagnostics.retrieved, 0);
assert.deepEqual(empty.records, []);
await assert.rejects(acquirePublicPlace('Example Person', '', deps));
console.log('Public-place pipeline passed: bounded document/JSON snapshots, stable content hashes, truthful timestamps, rejected-source retention, visible addresses, footer exclusion, name binding, conflicts, geocoder failure and abstention.');
