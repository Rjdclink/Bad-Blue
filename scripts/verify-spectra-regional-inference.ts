import assert from 'node:assert/strict';
import {
  inferCorroboratedRegionalCity,
  type RegionalSourceExcerpt,
} from '../server/services/spectra/SpectraRegionalInference';

// Synthetic identity and location examples; none is the real benchmark target.
const person = 'Taylor Morgan';
const first: RegionalSourceExcerpt = {
  url: 'https://profile.example.org/person/taylor',
  title: 'Taylor Morgan',
  snippet: 'Taylor Morgan lives in Cedar Rapids, Iowa.',
};
const second: RegionalSourceExcerpt = {
  url: 'https://people.example.net/taylor',
  snippet: 'Taylor Morgan currently resides in Cedar Rapids, IA.',
};
const winner = inferCorroboratedRegionalCity(person, [first, second]);
assert.equal(winner?.city, 'Cedar Rapids');
assert.equal(winner?.state, 'IA');
assert.equal(winner?.independentSourceCount, 2);
assert.equal(winner?.currentPositionVerified, false);
assert.equal(winner?.sourceDomains.length, 2);

// Multiple copies on one website are one source, not corroboration.
assert.equal(inferCorroboratedRegionalCity(person, [
  first, { ...first, url: 'https://profile.example.org/duplicate' },
]), null);

// Different subdomains of one publisher are not independent sources.
assert.equal(inferCorroboratedRegionalCity(person, [
  { ...first, url: 'https://profiles.example.org/person/taylor' },
  { ...second, url: 'https://news.example.org/taylor' },
]), null);
assert.equal(inferCorroboratedRegionalCity(person, [
  { ...first, url: 'https://profiles.example.co.uk/person/taylor' },
  { ...second, url: 'https://news.example.co.uk/taylor' },
]), null);

// A residence statement about someone else in the same sentence must not
// be attributed to the searched name.
assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', snippet: 'Taylor Morgan interviewed Jordan Lee, who lives in Cedar Rapids, IA.' },
  { url: 'https://two.example.net/', snippet: 'Taylor Morgan visited Jordan Lee, who resides in Cedar Rapids, IA.' },
]), null);

// A broad mention of a city is not a residence or subject match.
assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', snippet: 'Taylor Morgan attended a conference in Omaha, Nebraska.' },
  { url: 'https://two.example.org/', snippet: 'Taylor Morgan visited Omaha, NE.' },
]), null);
assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', title: person, snippet: 'Morgan Ellis lives in Cedar Rapids, Iowa.' },
  second,
]), null);

// A past-tense city mention does not establish a current residence even
// when two sites repeat it using otherwise valid subject and city labels.
assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', snippet: 'Taylor Morgan was based in Helena, MT.' },
  { url: 'https://two.example.net/', snippet: 'Taylor Morgan was located in Helena, Montana.' },
]), null);

// Archived or contradictory city reports do not establish a current city.
assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', snippet: 'Taylor Morgan formerly lived in Helena, Montana.' },
  { url: 'https://two.example.org/', snippet: 'Taylor Morgan previously resided in Helena, MT.' },
]), null);
// These city claims need four independent publishers; subdomains sharing
// example.org would count as one source, which is correct production behavior.
assert.equal(inferCorroboratedRegionalCity(person, [
  first,
  second,
  { url: 'https://helena.example.com/', snippet: 'Taylor Morgan lives in Helena, Montana.' },
  { url: 'https://helena.example.edu/', snippet: 'Taylor Morgan resides in Helena, MT.' },
]), null);

assert.equal(inferCorroboratedRegionalCity(person, [
  { url: 'https://one.example.org/', snippet: 'Taylor Morgan email taylor@example.test and phone 555-010-0100.' },
  { url: 'https://two.example.org/', snippet: 'Taylor Morgan contact details only.' },
]), null, 'identifiers alone cannot establish geographic position');
assert.equal(inferCorroboratedRegionalCity('Taylor', [first, second]), null,
  'single-word identity hints cannot resolve a subject');

// City-level accuracy should prefer abstaining over reporting weak,
 // contradictory, copied or stale geographic associations.
const testAsOf = new Date('2026-10-09T00:00:00.000Z');
assert.equal(inferCorroboratedRegionalCity(person, [
  first,
  { url: 'https://copies.example.net/taylor', snippet: first.snippet },
], testAsOf), null, 'an exact copied claim across different publishers is not independent');

assert.equal(inferCorroboratedRegionalCity(person, [
  { ...first, metadata: { publishedAt: '2016-04-02', retrievedAt: '2026-10-09' } },
  second,
], testAsOf), null, 'a newly fetched old biography must not establish a present-day city');

assert.equal(inferCorroboratedRegionalCity(person, [
  { ...first, metadata: { publishedAt: 'not a date' } },
  second,
], testAsOf), null, 'badly formed publication dates cannot strengthen location claims');

assert.equal(inferCorroboratedRegionalCity(person, [
  { ...first, metadata: { publishedAt: '2030-01-01' } },
  second,
], testAsOf), null, 'future-dated claims cannot strengthen city evidence');

const freshDated = inferCorroboratedRegionalCity(person, [
  { ...first, metadata: { datePublished: '2026-09-24' } },
  { ...second, metadata: { publicationDate: '2026-09-25' } },
], testAsOf);
assert.equal(freshDated?.city, 'Cedar Rapids', 'dated fresh independent claims remain usable');
assert.equal(freshDated?.independentSourceCount, 2);

assert.equal(inferCorroboratedRegionalCity(person, [
  first,
  second,
  { url: 'https://conflict.example.com/', snippet: 'Taylor Morgan lives in Helena, Montana.' },
], testAsOf), null, 'an explicit contradictory current-city claim must lead to abstention');
assert.equal(inferCorroboratedRegionalCity(person, [
  first,
  second,
], new Date('invalid')), null, 'invalid evaluation timestamps must not generate predictions');

console.log('SPECTRA broad-city public-source corroboration tests passed.');
