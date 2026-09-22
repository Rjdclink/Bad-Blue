import assert from 'node:assert/strict';
import {
  acquirePantheonResource,
  admitPantheonUrl,
  detectPublicAccessBarrier,
  isPantheonRobotsAllowed,
} from '../server/services/crawlers/PublicAcquisitionInfrastructure';
import { canonicalizeSixDegreesTarget } from '../server/services/crawlers/SixDegreesCrawler';
import {
  extractPantheonDiscoveredCandidates,
  extractPantheonSourceNavigationCandidates,
} from '../server/services/crawlers/PantheonRetrievalAdapter';

const publicUrl = admitPantheonUrl('https://example.com/public-record?q=smith&utm_source=test#section');
assert.equal(publicUrl.ok, true, 'a normal public evidence URL must be admitted');
if (publicUrl.ok) {
  assert.equal(publicUrl.url, 'https://example.com/public-record?q=smith');
}
assert.equal(
  admitPantheonUrl('https://fdc.myflorida.com/public-records').ok,
  true,
  'ordinary hostnames beginning with an IPv6-looking prefix must remain public',
);

assert.deepEqual(
  extractPantheonDiscoveredCandidates(
    '<a href="/records/jane-example">Record</a><a href="https://news.example.org/jane-example">News</a>',
    'https://records.example.gov/search?q=jane',
  ).slice(0, 2),
  [
    'https://records.example.gov/records/jane-example',
    'https://news.example.org/jane-example',
  ],
  'subject discovery must preserve absolute results and resolve relative result URLs before ledger admission',
);

assert.deepEqual(
  extractPantheonDiscoveredCandidates(
    '<nav><a href="https://www.hhs.gov/">Health</a></nav>'
      + '<article><a href="https://news.example.org/people/sarah-loretta-graves">Sarah Loretta Graves of Hartley</a></article>',
    'https://www.bing.com/search?q=sarah+loretta+graves',
    [],
    'Sarah Loretta Graves',
    'Hartley, Iowa',
  ),
  ['https://news.example.org/people/sarah-loretta-graves'],
  'search discovery must reject generic navigation and admit only subject-relevant result pages',
);

const publicLookupTargets = extractPantheonDiscoveredCandidates(
  '<form method="get" action="/records/search"><input name="name"><input name="location"></form>',
  'https://records.example.gov/',
  [],
  'Sarah Loretta Graves',
  'Hartley, Iowa',
);
assert.equal(publicLookupTargets.length, 1, 'a public same-source GET lookup form must become one controlled candidate');
assert.equal(
  publicLookupTargets[0],
  'https://records.example.gov/records/search?name=Sarah+Loretta+Graves&location=Hartley%2C+Iowa',
  'the public lookup candidate must carry the submitted subject and locality',
);
assert.deepEqual(
  extractPantheonDiscoveredCandidates(
    '<form method="post" action="/records/search"><input name="name"></form><form method="get" action="https://other.example.org/search"><input name="name"></form>',
    'https://records.example.gov/',
    [],
    'Sarah Loretta Graves',
  ),
  [],
  'POST and cross-source forms must never become Pantheon acquisition requests',
);
assert.deepEqual(
  extractPantheonDiscoveredCandidates(
    '<form method="get" action="/records/lookup"><input name="phone"><input name="county"></form>',
    'https://records.example.gov/',
    [],
    '(605) 555-1212',
    'Minnehaha County, SD',
    'phone',
  ),
  ['https://records.example.gov/records/lookup?phone=%28605%29+555-1212&county=Minnehaha+County%2C+SD'],
  'a phone investigation must fill the source phone field rather than a name field',
);
assert.deepEqual(
  extractPantheonDiscoveredCandidates(
    '<form method="get" action="/records/lookup"><input name="name"></form>',
    'https://records.example.gov/',
    [],
    '(605) 555-1212',
    undefined,
    'phone',
  ),
  [],
  'a typed non-name investigation must not inject its value into a name-only public form',
);
assert.deepEqual(
  extractPantheonSourceNavigationCandidates(
    '<nav><a href="/records/search">Public record search</a><a href="/about">About</a><a href="https://other.example.org/search">Search</a></nav>',
    'https://records.example.gov/',
  ),
  ['https://records.example.gov/records/search'],
  'only bounded same-source record-search navigation may precede subject lookup',
);

assert.equal(
  isPantheonRobotsAllowed(
    'https://records.example.gov/private/person',
    'https://records.example.gov/robots.txt',
    'User-agent: *\nDisallow: /private/',
  ),
  false,
  'robots exclusions must be enforced before public-page acquisition',
);
assert.equal(
  isPantheonRobotsAllowed(
    'https://records.example.gov/public/person',
    'https://records.example.gov/robots.txt',
    'User-agent: *\nDisallow: /private/',
  ),
  true,
);

for (const rejected of [
  'https://https//https//www.example.com/person',
  'https://example.com/users/sign_in',
  'https://example.com/records?api_key=secret',
  'https://user:password@example.com/records',
]) {
  assert.equal(admitPantheonUrl(rejected).ok, false, `credential-gated or malformed URL must be skipped: ${rejected}`);
}

assert.deepEqual(
  canonicalizeSixDegreesTarget('https://Example.com/person?id=7'),
  { domain: 'example.com', url: 'https://example.com/person?id=7' },
  'SixDegrees must separate a canonical host from the executable URL',
);
assert.throws(
  () => canonicalizeSixDegreesTarget('https://https//www.example.com'),
  /Malformed recursive URL rejected/,
  'SixDegrees must never accept recursive scheme chains',
);

const unauthorized = await acquirePantheonResource(
  'https://example.com/unplanned',
  1_000,
  {
    investigationId: 'fixture-investigation',
    categoryId: 'fixture-category',
    workId: 'fixture-work',
    capability: 'sixdegrees',
    deadlineAt: Date.now() + 1_000,
    canonicalUrl: 'https://example.com/authorized',
  },
);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.errorType, 'invalid_url');
assert.match(unauthorized.error || '', /outside the canonical work authorization/);

assert.match(
  detectPublicAccessBarrier('<html><title>Sign in</title><form action="/login"><input type="password"></form></html>') || '',
  /sign-in required/,
);
assert.match(
  detectPublicAccessBarrier('{"error":"API key is required"}', 'application/json') || '',
  /API key or access token required/,
);
assert.equal(
  detectPublicAccessBarrier('<html><title>Public Records</title><article>Public record content</article><a href="/login">Sign in</a></html>'),
  undefined,
  'a public page must not be rejected merely because it contains a sign-in link',
);

console.log('Pantheon retrieval behavior verification passed.');
