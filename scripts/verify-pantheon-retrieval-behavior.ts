import assert from 'node:assert/strict';
import {
  acquirePantheonResource,
  admitPantheonUrl,
  detectPublicAccessBarrier,
} from '../server/services/crawlers/PublicAcquisitionInfrastructure';
import { canonicalizeSixDegreesTarget } from '../server/services/crawlers/SixDegreesCrawler';
import { extractPantheonDiscoveredCandidates } from '../server/services/crawlers/PantheonRetrievalAdapter';

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
