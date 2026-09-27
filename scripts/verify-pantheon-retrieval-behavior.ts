import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquirePublicResource,
  acquirePantheonResource,
  admitPantheonUrl,
  detectPublicAccessBarrier,
  isPantheonRobotsAllowed,
  runWithPantheonAcquisitionContext,
} from '../server/services/crawlers/PublicAcquisitionInfrastructure';
import { canonicalizeSixDegreesTarget } from '../server/services/crawlers/SixDegreesCrawler';
import {
  classifyPantheonRetrievalAccessOutcome,
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

const originalFetch = globalThis.fetch;
const originalFrontierMode = process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
const originalSnapshotDirectory = process.env.PANTHEON_RAW_SNAPSHOT_DIR;
const snapshotDirectory = await mkdtemp(path.join(os.tmpdir(), 'pantheon-access-fixture-'));
const authorizedHeader = 'Bearer fixture-only-authorized-route';
let redirectedCredentialObserved = false;
let unrelatedOriginCredentialObserved = false;
process.env.PANTHEON_FRONTIER_LOCAL_ONLY = '1';
process.env.PANTHEON_RAW_SNAPSHOT_DIR = snapshotDirectory;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
  if (url.hostname === '1.1.1.1') {
    return new Response('<html><title>Public Records</title><article>Public record 7482.</article></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (url.hostname === '8.8.8.8') {
    if (url.pathname === '/records/cross-origin-redirect') {
      return new Response('', {
        status: 302,
        headers: { location: 'https://9.9.9.9/records/redirect-target' },
      });
    }
    const headers = new Headers(init.headers);
    return headers.get('authorization') === authorizedHeader
      ? new Response('<html><title>Authorized Records</title><article>Authorized record 6193.</article></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      : new Response('<html><title>Sign in required</title><p>Please sign in to view records.</p></html>', {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
  }
  if (url.hostname === '9.9.9.9') {
    if (url.pathname === '/records/redirect-target') {
      redirectedCredentialObserved ||= new Headers(init.headers).has('authorization');
      return new Response('<html><title>Public Redirect Result</title><article>Public redirected record.</article></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    unrelatedOriginCredentialObserved ||= new Headers(init.headers).has('authorization');
    return new Response('<html><title>Sign in required</title><p>Please sign in to view records.</p></html>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  throw new Error(`Unexpected fixture request: ${url.hostname}${url.pathname}`);
};

const authorizedWork = (url: string, investigationId: string, requestHeaders?: Record<string, string>) => ({
  investigationId,
  categoryId: `${investigationId}:category`,
  workId: `${investigationId}:work`,
  capability: 'startrek',
  deadlineAt: Date.now() + 5_000,
  canonicalUrl: url,
  requestHeaders,
});

try {
  const publicRecordUrl = 'https://1.1.1.1/records/public-check';
  const publicRecord = await acquirePantheonResource(
    publicRecordUrl,
    4_000,
    authorizedWork(publicRecordUrl, 'public-fixture'),
  );
  assert.equal(publicRecord.ok, true, 'an accessible public source must be acquired');
  assert.match(publicRecord.content, /Public record 7482/, 'publicly fetched source content remains attributable evidence');

  const configuredRouteUrl = 'https://8.8.8.8/records/authorized-check';
  const configuredRoute = await acquirePantheonResource(
    configuredRouteUrl,
    4_000,
    authorizedWork(configuredRouteUrl, 'authorized-fixture', { authorization: authorizedHeader }),
  );
  assert.equal(configuredRoute.ok, true, 'a source reached through the already-authorized request-header route must be retrieved');
  assert.match(configuredRoute.content, /Authorized record 6193/);

  const redirectedUrl = 'https://8.8.8.8/records/cross-origin-redirect';
  const redirected = await acquirePantheonResource(
    redirectedUrl,
    4_000,
    authorizedWork(redirectedUrl, 'redirected-fixture', { authorization: authorizedHeader }),
  );
  assert.equal(redirected.ok, true, 'public cross-origin redirects remain usable');
  assert.equal(redirectedCredentialObserved, false, 'authorized headers must not be sent to a different redirect origin');

  const unrelatedTargetResult = await runWithPantheonAcquisitionContext(
    authorizedWork('https://8.8.8.8/records/authorized-check', 'unrelated-target-fixture', {
      authorization: authorizedHeader,
    }),
    undefined,
    () => acquirePublicResource('https://9.9.9.9/records/controlled-check', 4_000),
  );
  assert.equal(unrelatedTargetResult.ok, false);
  assert.equal(unrelatedOriginCredentialObserved, false,
    'an acquisition context must not send source credentials to an unrelated initial target origin');

  const controlledUrl = 'https://9.9.9.9/records/controlled-check';
  const controlledResult = await acquirePantheonResource(
    controlledUrl,
    4_000,
    authorizedWork(controlledUrl, 'controlled-fixture'),
  );
  assert.equal(controlledResult.ok, false, 'a controlled source without an authorized route remains inaccessible');
  assert.equal(controlledResult.errorType, 'auth_required');
  assert.equal(controlledResult.status, 401);
  assert.equal(
    classifyPantheonRetrievalAccessOutcome(controlledResult)?.status,
    'access_limited',
    'an authentication wall remains an explicit access-limited outcome, not a no-record result',
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalFrontierMode == null) delete process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
  else process.env.PANTHEON_FRONTIER_LOCAL_ONLY = originalFrontierMode;
  if (originalSnapshotDirectory == null) delete process.env.PANTHEON_RAW_SNAPSHOT_DIR;
  else process.env.PANTHEON_RAW_SNAPSHOT_DIR = originalSnapshotDirectory;
  await rm(snapshotDirectory, { recursive: true, force: true });
}

console.log('Pantheon retrieval behavior verification passed.');
