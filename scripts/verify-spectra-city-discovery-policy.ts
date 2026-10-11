import assert from 'node:assert/strict';
import {
  assessSpectraCityDiscoveryReadiness,
  chooseSpectraPublicRetrievalUrls,
  publicPublisherDomain,
  type SpectraPublicDiscoverySource,
} from '../server/services/spectra/SpectraCityDiscoveryPolicy';
import { buildSpectraPriorityTargets } from '../server/services/spectra/SpectraSourceRegistry';

const asOf = new Date('2026-10-10T00:00:00.000Z');
const record = (
  url: string, snippet: string, reliability: 'high' | 'medium' | 'low' = 'medium',
): SpectraPublicDiscoverySource => ({
  url, snippet, reliability, relevanceScore: reliability === 'high' ? 90 : 70,
});

// No account, uploaded photo, browser history, or social handle is needed to
// initiate searches for independently published profile-city references.
const noClues = buildSpectraPriorityTargets('Taylor Morgan', '');
assert.ok(noClues.some(item => item.sourceId === 'public-profile-city'));
assert.ok(noClues.some(item => item.sourceId === 'social-location'));
assert.ok(noClues.some(item => item.sourceId === 'media-location'));

assert.equal(publicPublisherDomain('https://profiles.example.co.uk/member'), 'example.co.uk');
assert.equal(publicPublisherDomain('https://news.example.co.uk/article'), 'example.co.uk');
assert.equal(publicPublisherDomain('ftp://example.org/data'), null);
assert.equal(publicPublisherDomain('https://localhost/testing'), null);

const diverse = chooseSpectraPublicRetrievalUrls([
  record('https://one.example.org/post1', 'A', 'high'),
  record('https://news.example.org/post2', 'A', 'high'),
  record('https://three.example.net/post3', 'B'),
  record('https://four.example.com/post4', 'C'),
], 3);
assert.deepEqual(diverse, [
  'https://one.example.org/post1',
  'https://three.example.net/post3',
  'https://four.example.com/post4',
], 'fetch independent publishers before second pages from same domain');
assert.equal(chooseSpectraPublicRetrievalUrls([], 8).length, 0);
assert.equal(chooseSpectraPublicRetrievalUrls([
  record('https://a.example.org/one', 'A'),
  record('https://b.example.org/two', 'B'),
], 2).length, 2, 'supplement remaining slots with other pages if needed');

const irrelevant = [
  record('https://one.example.org/news', 'Local civic news with no named subject city.'),
  record('https://two.example.net/archive', 'A public archive without any residence claim.'),
  record('https://three.example.com/news', 'Unrelated location article.', 'high'),
  record('https://four.example.edu/directory', 'A page lacking the named person.'),
  record('https://five.example.gov/notice', 'Unrelated government records.', 'high'),
  record('https://six.example.io/blog', 'No subject associated with a city.'),
];
const noise = assessSpectraCityDiscoveryReadiness({
  subject: 'Taylor Morgan',
  sources: irrelevant,
  backgroundConfidence: 0.95,
  asOf,
});
assert.equal(noise.publisherCount, 6);
assert.equal(noise.publicCityCorroborated, false);
assert.equal(noise.sufficientToStop, false,
  'six independent URLs and a high model score must not end city research without city evidence');

const confirmed = assessSpectraCityDiscoveryReadiness({
  subject: 'Taylor Morgan',
  sources: [
    record('https://profile.example.org/biography',
      'Taylor Morgan lives in Sioux Falls, South Dakota.'),
    record('https://directory.example.net/biography',
      'Taylor Morgan currently resides in Sioux Falls, SD.'),
    ...irrelevant.slice(2),
  ],
  backgroundConfidence: 0.60,
  asOf,
});
assert.equal(confirmed.publicCityCorroborated, true);
assert.equal(confirmed.city, 'Sioux Falls');
assert.equal(confirmed.state, 'SD');
assert.equal(confirmed.publisherCount, 6);
assert.equal(confirmed.sufficientToStop, true);

const contradiction = assessSpectraCityDiscoveryReadiness({
  subject: 'Taylor Morgan',
  sources: [
    record('https://profile.example.org/a', 'Taylor Morgan lives in Sioux Falls, South Dakota.'),
    record('https://directory.example.net/b', 'Taylor Morgan resides in Sioux Falls, SD.'),
    record('https://third.example.com/c', 'Taylor Morgan lives in Madison, Wisconsin.'),
    ...irrelevant.slice(3),
  ],
  backgroundConfidence: 0.95,
  asOf,
});
assert.equal(contradiction.publicCityCorroborated, false);
assert.equal(contradiction.sufficientToStop, false);

const repeated = assessSpectraCityDiscoveryReadiness({
  subject: 'Taylor Morgan',
  sources: [
    record('https://one.example.org/a', 'Taylor Morgan lives in Sioux Falls, South Dakota.'),
    record('https://two.example.net/b', 'Taylor Morgan lives in Sioux Falls, South Dakota.'),
    ...irrelevant.slice(2),
  ],
  backgroundConfidence: 0.95,
  asOf,
});
assert.equal(repeated.sufficientToStop, false, 'copied claims are not independent city corroboration');

console.log('SPECTRA public-city discovery verified: unconditional public-profile search, publisher diversification, real city-evidence early stop and contradictions.');
