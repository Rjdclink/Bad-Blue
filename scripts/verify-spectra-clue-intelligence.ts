import assert from 'node:assert/strict';
import {
  extractCityStateHint,
  extractFreeformLocationHint,
  extractStreetAddressHint,
  extractLocationClues,
  geocodeBestLocation,
  geocodeCityState,
} from '../server/services/geoconsole/city-state-geocoder';
import { assessLocationQuality } from '../server/services/geoconsole/location-quality';
import type { GPSPoint } from '../server/services/geoconsole/types';

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

// Distinguish an explicitly reported city from the person's name and
// surrounding contact/identity wording. Do not use any real benchmark data.
for (const [text, city, state] of [
  ['Taylor Morgan lives in Cedar Rapids, IA', 'Cedar Rapids', 'IA'],
  ['Taylor Morgan resides in Cedar Rapids, IA', 'Cedar Rapids', 'IA'],
  ['Taylor Morgan is based in Cedar Rapids, IA', 'Cedar Rapids', 'IA'],
  ['Cedar Rapids, IA', 'Cedar Rapids', 'IA'],
] as const) {
  const found = extractCityStateHint(text);
  assert.equal(found?.city, city, `identity prefix was included in city: ${text}`);
  assert.equal(found?.state, state);
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
// A public geocoder can return a null, blank, or out-of-range coordinate.
// No such payload may create a false (0,0) feature on the map.
const coordinateFixtures: Array<{ location: string; payload: unknown }> = [
  { location: 'Northvale, NM', payload: [{ lat: null, lon: '-106' }] },
  { location: 'Eastvale, NM', payload: [{ lat: '', lon: '-106' }] },
  { location: 'Westvale, NM', payload: [{ lat: '91', lon: '-106' }] },
  { location: 'Southvale, NM', payload: [{ lat: '45', lon: '-181' }] },
  { location: 'Midvale, NM', payload: [{ lat: undefined, lon: undefined }] },
];
try {
  for (const fixture of coordinateFixtures) {
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.payload));
    assert.equal(await geocodeCityState(fixture.location), null,
      `Malformed geocoder result should not map: ${fixture.location}`);
  }
  globalThis.fetch = async () => new Response(JSON.stringify([
    { lat: '0', lon: '0', display_name: 'Valid coordinate origin' },
  ]));
  const validZero = await geocodeCityState('Zerovale, NM');
  assert.equal(validZero?.latitude, 0, 'actual zero latitude remains valid');
  assert.equal(validZero?.longitude, 0, 'actual zero longitude remains valid');

  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not a feature list' }));
  await assert.rejects(geocodeCityState('Malformedvale, NM'), /invalid data/,
    'provider response must be an array before caching');
} finally {
  globalThis.fetch = originalFetch;
}

// General fusion quality must reject invented/impossible fixes and preserve
// real timestamps without silently constructing higher precision.
const referencePoint: GPSPoint = {
  latitude: 45,
  longitude: -120,
  timestamp: new Date('2026-01-01T12:00:00.000Z'),
  source: 'public_record',
  observationKind: 'historical',
  confidence: 0.8,
  accuracy: 250,
};
for (const [label, point, expectedCode] of [
  ['missing latitude', { ...referencePoint, latitude: NaN }, 'invalid_coordinate'],
  ['out-of-range latitude', { ...referencePoint, latitude: 91 }, 'invalid_coordinate'],
  ['out-of-range longitude', { ...referencePoint, longitude: -181 }, 'invalid_coordinate'],
  ['invalid timestamp', { ...referencePoint, timestamp: new Date('invalid') }, 'invalid_timestamp'],
  ['invalid confidence', { ...referencePoint, confidence: Number.POSITIVE_INFINITY }, 'invalid_confidence'],
] as const) {
  const quality = assessLocationQuality([point]);
  assert.equal(quality.acceptedCount, 0, label);
  assert.equal(quality.issues[0]?.code, expectedCode, label);
}

const missingAccuracy = assessLocationQuality([{ ...referencePoint, accuracy: -1 }]);
assert.equal(missingAccuracy.acceptedCount, 1,
  'a bad accuracy value should not erase otherwise valid location evidence');
assert.equal(missingAccuracy.points[0].accuracy, undefined,
  'invalid accuracy must not enter fusion as a precision measurement');
assert.equal(missingAccuracy.issues[0]?.code, 'invalid_accuracy');
assert.ok(missingAccuracy.points[0].confidence < referencePoint.confidence);

const isoDate = assessLocationQuality([
  { ...referencePoint, timestamp: '2026-01-01T12:00:00.000Z' as unknown as Date },
]);
assert.ok(isoDate.points[0]?.timestamp instanceof Date);
assert.equal(isoDate.points[0].timestamp.toISOString(), '2026-01-01T12:00:00.000Z');

// Malformed Nominatim bounding boxes must fall back to honest regional
// uncertainty. Missing bounds must not be coerced into coordinates at zero.
const invalidBounds: Array<{ city: string; bounds: unknown }> = [
  { city: 'Blankbounds', bounds: ['', '', '', ''] },
  { city: 'Nullbounds', bounds: [null, null, null, null] },
  { city: 'Partiallynull', bounds: ['43.4', '43.6', null, '-96.4'] },
  { city: 'Reversedbounds', bounds: ['44', '43', '-97', '-96'] },
  { city: 'Invalidrange', bounds: ['95', '96', '-97', '-96'] },
];
try {
  for (const { city, bounds } of invalidBounds) {
    globalThis.fetch = async () => new Response(JSON.stringify([
      { lat: '0', lon: '0', boundingbox: bounds },
    ]));
    const result = await geocodeCityState(`${city}, NM`);
    assert.equal(result?.accuracyMeters, 25_000,
      `Malformed bounding box must not imply region precision: ${city}`);
  }

  globalThis.fetch = async () => new Response(JSON.stringify([
    { lat: '0', lon: '0', boundingbox: ['0', '0', '0', '0'] },
  ]));
  assert.equal((await geocodeCityState('Validbounds, NM'))?.accuracyMeters, 25_000,
    'An area without measurable extent preserves the conservative uncertainty fallback');
} finally {
  globalThis.fetch = originalFetch;
}

// Concurrent callers must share one geocoder request lane instead of all
// waking together and exceeding the public provider's request budget.
const geocoderStarts: number[] = [];
try {
  globalThis.fetch = async () => {
    geocoderStarts.push(Date.now());
    return new Response(JSON.stringify([
      { lat: '41', lon: '-100', boundingbox: ['40.9', '41.1', '-100.1', '-99.9'] },
    ]));
  };
  const responses = await Promise.all([
    geocodeCityState('Queuealpha, NM'),
    geocodeCityState('Queuebeta, NM'),
    geocodeCityState('Queuegamma, NM'),
  ]);
  assert.equal(responses.filter(Boolean).length, 3);
  assert.equal(geocoderStarts.length, 3, 'each distinct uncached request should execute');
  for (let index = 1; index < geocoderStarts.length; index += 1) {
    assert.ok(geocoderStarts[index] - geocoderStarts[index - 1] >= 900,
      'parallel geocoder calls should not burst within the same second');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('SPECTRA clue-intelligence verification passed.');
