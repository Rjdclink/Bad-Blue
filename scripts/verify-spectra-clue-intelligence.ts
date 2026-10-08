import assert from 'node:assert/strict';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  extractStreetAddressHint,
  extractLocationClues,
  geocodeBestLocation,
} from '../server/services/geoconsole/city-state-geocoder';

const conversational = 'Located in Spirit Lake, Iowa, near Arbai, 109 27th Street.';
const address = extractStreetAddressHint(conversational);
assert.ok(address, 'street address should be extracted from conversational clue');
assert.equal(address?.street.toLowerCase(), '109 27th street');
assert.equal(address?.city, 'Spirit Lake');
assert.equal(address?.state, 'IA');

const regional = extractCityStateHint(conversational);
assert.equal(regional?.city, 'Spirit Lake');
assert.equal(regional?.state, 'IA');

const clues = extractLocationClues(conversational);
assert.ok(clues.some(value => /109 27th street/i.test(value)), 'street clue must be preserved');
assert.ok(clues.some(value => /Spirit Lake, IA/i.test(value)), 'regional clue must be preserved');

for (const natural of [
  'He is at 109 27th Street in Spirit Lake Iowa',
  'Try 109 27th Street, Spirit Lake, IA',
  'Last known at 109 27th Street near Spirit Lake, Iowa',
  'The address is 109 27th Street; Spirit Lake Iowa',
]) {
  assert.ok(extractStreetAddressHint(natural), 'natural phrasing lost street clue: ' + natural);
}

assert.equal(extractFreeformLocationHint('located in Spirit Lake, Iowa'), 'Spirit Lake, Iowa');

// Conversational words such as "me" must not become state abbreviations.
// A willing geocoder can return a real place for an unrelated query, so the
// identity-only launch must be rejected before any geocoding request is made.
const originalFetch = globalThis.fetch;
let geocoderRequests = 0;
try {
  globalThis.fetch = async () => {
    geocoderRequests += 1;
    return new Response(JSON.stringify([{ lat: '20', lon: '50', display_name: 'Unrelated place' }]));
  };
  for (const clue of [
    'Show me Jane Mary Doe. Her email is jane@example.test and phone is 555-010-0200.',
    'SHOW ME Jane Mary Doe',
    'Find Jane Mary Doe in my contacts',
    'Hi Jane Mary Doe',
  ]) {
    assert.equal(extractCityStateHint(clue), null, `identity text is not a region: ${clue}`);
    assert.deepEqual(extractLocationClues(clue), [], `identity text is not a location clue: ${clue}`);
    assert.equal(await geocodeBestLocation(clue), null);
  }
  assert.equal(geocoderRequests, 0, 'identity-only commands must never query a geocoder');
} finally {
  globalThis.fetch = originalFetch;
}
for (const geographic of ['Portland, ME', 'Portland me', 'Last known in Portland ME near the station']) {
  assert.equal(extractCityStateHint(geographic)?.city, 'Portland');
  assert.equal(extractCityStateHint(geographic)?.state, 'ME');
}
console.log('SPECTRA clue-intelligence verification passed.');
