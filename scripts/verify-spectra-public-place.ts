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
const conflict = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => [page(), { ...page('Boston, MA 02110'), url: 'https://second.example/visit' }] });
assert.equal(conflict.diagnostics.outcome, 'conflicting-addresses');
assert.equal(conflict.candidates.length, 0);
assert.equal(geocodeCalls, 1, 'conflicts must abstain before geocoding');
const failed = await acquirePublicPlace(target, '', { ...deps, geocode: async () => { throw Error('offline'); } });
assert.equal(failed.diagnostics.outcome, 'geocoding-unavailable');
assert.equal(failed.candidates.length, 0);
const empty = await acquirePublicPlace(target, '', { ...deps, retrieve: async () => [] });
assert.equal(empty.diagnostics.outcome, 'no-supported-address');
assert.equal(empty.diagnostics.retrieved, 0);
const unavailable = await acquirePublicPlace(target, 'https://secret:credential@bad.example/private', {
  ...deps,
  retrieve: async (urls, _signal, onFailure) => {
    assert(!urls.some(value => value.includes('credential')));
    onFailure?.(url, 'http-403');
    return [];
  },
});
assert.equal(unavailable.sources[0].status, 'http-403');
assert(!JSON.stringify(unavailable).includes('credential'));
await assert.rejects(acquirePublicPlace('Example Person', '', deps));
console.log('Public-place pipeline passed: visible addresses, footer exclusion, name binding, source links, conflicts, geocoder failure and abstention.');
