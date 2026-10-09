import assert from 'node:assert/strict';
import {
  inferCorroboratedRegionalCity,
  type RegionalSourceExcerpt,
} from '../server/services/spectra/SpectraRegionalInference';

// A fixed, fictional regression suite. Never substitute a supplied
// person's known location into inference input or call this field accuracy.
const asOf = new Date('2026-10-09T00:00:00.000Z');
type Fixture = {
  id: string;
  name: string;
  expectedCity: string | null;
  sources: RegionalSourceExcerpt[];
};
function source(domain: string, claim: string, publishedAt?: string): RegionalSourceExcerpt {
  return {
    url: 'https://' + domain + '/profile',
    snippet: claim,
    ...(publishedAt ? { metadata: { publishedAt } } : {}),
  };
}
const fixtures: Fixture[] = [
  {
    id: 'two-independent-city-references',
    name: 'Morgan Vale',
    expectedCity: 'Boulder, CO',
    sources: [
      source('records.example.org', 'Morgan Vale lives in Boulder, Colorado.', '2026-07-01'),
      source('news.example.net', 'Morgan Vale currently resides in Boulder, CO.', '2026-08-01'),
    ],
  },
  {
    id: 'different-residence-phrasing',
    name: 'Casey Rivera',
    expectedCity: 'Salem, OR',
    sources: [
      source('registry.example.edu', 'Casey Rivera lives in Salem, Oregon.'),
      source('staff.example.com', 'Casey Rivera is based in Salem, OR.'),
    ],
  },
  {
    id: 'abbreviated-state-and-punctuation',
    name: 'Jamie Patel',
    expectedCity: 'Madison, WI',
    sources: [
      source('directory.example.net', 'Jamie Patel lives in Madison, WI.'),
      source('alumni.example.edu', 'Jamie Patel currently resides in Madison, Wisconsin.'),
    ],
  },
  {
    id: 'third-source-support',
    name: 'Jordan Blake',
    expectedCity: 'Reno, NV',
    sources: [
      source('people.example.net', 'Jordan Blake lives in Reno, NV.'),
      source('directory.example.edu', 'Jordan Blake is based in Reno, Nevada.'),
      source('business.example.com', 'Jordan Blake currently resides in Reno, NV.'),
    ],
  },
  {
    id: 'outdated-but-conflicting-reference-excluded',
    name: 'Harper Stone',
    expectedCity: 'Salem, OR',
    sources: [
      source('one.example.org', 'Harper Stone lives in Salem, Oregon.', '2026-08-01'),
      source('two.example.net', 'Harper Stone resides in Salem, OR.', '2026-08-02'),
      source('three.example.com', 'Harper Stone lives in Helena, Montana.', '2012-03-01'),
    ],
  },
  {
    id: 'no-evidence',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [],
  },
  {
    id: 'one-publisher-only',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [source('one.example.org', 'Morgan Vale lives in Boulder, CO.')],
  },
  {
    id: 'sister-subdomains',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [
      source('profile.example.org', 'Morgan Vale lives in Boulder, CO.'),
      source('news.example.org', 'Morgan Vale currently resides in Boulder, Colorado.'),
    ],
  },
  {
    id: 'exact-syndicated-copy',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Morgan Vale lives in Boulder, Colorado.'),
      source('two.example.net', 'Morgan Vale lives in Boulder, Colorado.'),
    ],
  },
  {
    id: 'two-to-one-conflict',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Morgan Vale lives in Boulder, Colorado.'),
      source('two.example.net', 'Morgan Vale is based in Boulder, CO.'),
      source('three.example.com', 'Morgan Vale currently resides in Helena, Montana.'),
    ],
  },
  {
    id: 'old-publication',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Morgan Vale lives in Boulder, Colorado.', '2011-02-11'),
      source('two.example.net', 'Morgan Vale currently resides in Boulder, CO.', '2026-08-01'),
    ],
  },
  {
    id: 'unrelated-person',
    name: 'Morgan Vale',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Morgan Vale interviewed Jaime Chen who lives in Boulder, CO.'),
      source('two.example.net', 'Morgan Vale visited Jaime Chen, who resides in Boulder, Colorado.'),
    ],
  },
  {
    id: 'historical-location-only',
    name: 'Casey Rivera',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Casey Rivera formerly lived in Salem, OR.'),
      source('two.example.net', 'Casey Rivera previously resided in Salem, Oregon.'),
    ],
  },
  {
    id: 'no-residence-claim',
    name: 'Jamie Patel',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Jamie Patel traveled to Madison, WI.'),
      source('two.example.net', 'Jamie Patel attended school in Madison, Wisconsin.'),
    ],
  },
  {
    id: 'contact-information-only',
    name: 'Jordan Blake',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Jordan Blake: email jordan@example.test'),
      source('two.example.net', 'Jordan Blake: phone 555-010-0333'),
    ],
  },
  {
    id: 'future-dated-location',
    name: 'Jordan Blake',
    expectedCity: null,
    sources: [
      source('one.example.org', 'Jordan Blake lives in Reno, NV.', '2028-01-01'),
      source('two.example.net', 'Jordan Blake currently resides in Reno, Nevada.', '2026-08-01'),
    ],
  },
];

let correctCities = 0;
let falseCityClaims = 0;
let correctlyAbstained = 0;
let missedCities = 0;
for (const fixture of fixtures) {
  const predicted = inferCorroboratedRegionalCity(fixture.name, fixture.sources, asOf);
  const predictedCity = predicted ? predicted.city + ', ' + predicted.state : null;
  if (predictedCity === fixture.expectedCity) {
    if (predictedCity) correctCities += 1;
    else correctlyAbstained += 1;
    continue;
  }
  if (predictedCity) falseCityClaims += 1;
  else missedCities += 1;
  assert.fail(
    'City inference regression ' + fixture.id +
    ': expected ' + fixture.expectedCity + ', received ' + predictedCity,
  );
}
assert.equal(fixtures.length, 16);
assert.equal(correctCities, 5);
assert.equal(correctlyAbstained, 11);
assert.equal(falseCityClaims, 0);
assert.equal(missedCities, 0);
console.log('SPECTRA synthetic city-level regression results:', JSON.stringify({
  cases: fixtures.length,
  correctCityPredictions: correctCities,
  correctlyAbstained,
  falseCityPredictions: falseCityClaims,
  missedCities,
  description: 'Synthetic deterministic regression fixtures, not real-world accuracy',
}));
