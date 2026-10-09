import assert from 'node:assert/strict';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  extractStreetAddressHint,
  extractLocationClues,
  geocodeBestLocation,
} from '../server/services/geoconsole/city-state-geocoder';

// Fictional parsing-only fixture; never geocoded or associated with a person.
const conversational = 'Located in North Exampleton, Oregon, near a library, 123 Example Street.';
const address = extractStreetAddressHint(conversational);
assert.ok(address, 'street address should be extracted from conversational clue');
assert.equal(address?.street.toLowerCase(), '123 example street');
assert.equal(address?.city, 'North Exampleton');
assert.equal(address?.state, 'OR');

for (const message of [
  '123 Main Street, Salem, Oregon',
  '123 Main Street, Salem, OR',
  'The address is 123 Main Street, Salem, Oregon',
  '123 Main Street, Suite 4, Salem, OR',
]) {
  const parsed = extractStreetAddressHint(message);
  assert.equal(parsed?.street, '123 Main Street');
  assert.equal(parsed?.city, 'Salem', `street must not contaminate city: ${message}`);
  assert.equal(parsed?.state, 'OR');
}

const regional = extractCityStateHint(conversational);
assert.equal(regional?.city, 'North Exampleton');
assert.equal(regional?.state, 'OR');

const clues = extractLocationClues(conversational);
assert.ok(clues.some(value => /123 example street/i.test(value)), 'street clue must be preserved');
assert.ok(clues.some(value => /North Exampleton, OR/i.test(value)), 'regional clue must be preserved');

for (const natural of [
  'He is at 123 Example Street in North Exampleton Oregon',
  'Try 123 Example Street, North Exampleton, OR',
  'Last known at 123 Example Street near North Exampleton, Oregon',
  'The address is 123 Example Street; North Exampleton Oregon',
]) {
  assert.ok(extractStreetAddressHint(natural), 'natural phrasing lost street clue: ' + natural);
}

assert.equal(extractFreeformLocationHint('located in North Exampleton, Oregon'), 'North Exampleton, Oregon');

// Mixed identity/contact clues must preserve an explicitly supplied place.
// Use varied places and phrasing so this is not tied to one person's baseline.
for (const [message, city, state] of [
  ['My last known location was Salem, Oregon. My email is jane@example.test and phone is 555-010-0200.', 'Salem', 'OR'],
  ['My name is Jane Mary Doe. My last location was Madison, Wisconsin.', 'Madison', 'WI'],
  ['My previous location: Lincoln, Nebraska', 'Lincoln', 'NE'],
  ['Last seen at Grand Rapids MI. Email: jane@example.test', 'Grand Rapids', 'MI'],
  ['Current location is Kansas City, Missouri', 'Kansas City', 'MO'],
  ['My last known location was Salem, OR', 'Salem', 'OR'],
  ['Her previous location: Lincoln, NE', 'Lincoln', 'NE'],
] as const) {
  const hint = extractCityStateHint(message);
  assert.equal(hint?.city, city, `mixed clue city: ${message}`);
  assert.equal(hint?.state, state, `mixed clue state: ${message}`);
  assert.ok(extractLocationClues(message).includes(`${city}, ${state}`));
}

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
