import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  retrieveLexaraConversationalSource,
} from '../server/lexara/LexaraPantheonInvestigation';
import {
  pantheonRetrievalAdapter,
  type PantheonRetrievalResponse,
} from '../server/services/crawlers/PantheonRetrievalAdapter';
import { acquirePublicResource } from '../server/services/crawlers/PublicAcquisitionInfrastructure';
import type { PantheonRegistrationAuthority } from '../server/services/pantheon/PantheonContactRegistrationBroker';
import { pantheonOrchestrator } from '../server/services/pantheonCrawlerOrchestrator';

const target = 'https://8.8.8.8/records/case-search';
const originalFetch = globalThis.fetch;
const originalSearch = pantheonOrchestrator.searchAllIsolatedWithAudit;
const originalFrontierMode = process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
const originalSnapshotDirectory = process.env.PANTHEON_RAW_SNAPSHOT_DIR;
const snapshotDirectory = await mkdtemp(path.join(os.tmpdir(), 'lexara-access-fixture-'));
const registrationRequests: string[] = [];
const sourceRequests: Array<{ cookie?: string; status: number }> = [];
let rejectAuthorizedSession = false;
const registrationAuthority: PantheonRegistrationAuthority = {
  enabled: true,
  profile: {
    firstName: 'Fixture',
    lastName: 'Researcher',
    email: 'fixture@example.test',
    phone: '+15555550123',
  },
  allowedHosts: new Set(['8.8.8.8']),
};

process.env.PANTHEON_FRONTIER_LOCAL_ONLY = '1';
process.env.PANTHEON_RAW_SNAPSHOT_DIR = snapshotDirectory;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
  if (url.pathname === '/records/case-search' && method === 'GET') {
    if (/contact-registration/i.test(headers.get('user-agent') || '')) {
      registrationRequests.push(`GET ${url.hostname}`);
      return new Response(
        '<form method="post" action="/register">'
          + '<input name="first_name"><input name="last_name">'
          + '<input name="email"><input name="phone"></form>',
        { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'visit=fixture; Path=/' } },
      );
    }
    const cookie = headers.get('cookie') || undefined;
    const authorized = Boolean(cookie?.includes('authorized-session=fixture')) && !rejectAuthorizedSession;
    const status = authorized ? 200 : 401;
    sourceRequests.push({ cookie, status });
    return new Response(
      authorized
        ? '<html><title>Court Records</title><article>Fixture docket record 3819.</article></html>'
        : '<html><title>Sign in required</title><p>Please sign in to view this source.</p></html>',
      {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    );
  }
  if (url.pathname === '/register' && method === 'POST') {
    registrationRequests.push(`POST ${url.hostname}`);
    return new Response('Contact-only registration complete.', {
      status: 200,
      headers: { 'content-type': 'text/html', 'set-cookie': 'authorized-session=fixture; Path=/; Secure' },
    });
  }
  throw new Error(`Unexpected test request: ${method} ${url.hostname}${url.pathname}`);
};

pantheonOrchestrator.searchAllIsolatedWithAudit = async targets => {
  const targetUrl = targets[0];
  const result = await acquirePublicResource(targetUrl, 2_000);
  const retrievedAt = new Date().toISOString();
  const status = result.ok ? 'completed_with_content' as const : 'failed' as const;
  return {
    results: [],
    audit: [{
      crawler: 'fixture-crawler',
      capabilityClass: 'primary' as const,
      status,
      evidenceCount: 0,
      attempts: 1,
      targets: 1,
      error: result.error,
      sourceOutcomes: [{
        sourceUrl: targetUrl,
        status,
        retrievedAt,
        durationMs: 1,
        error: result.error,
      }],
    }],
  };
};

try {
  const request = {
    purpose: 'lexara_legal_research',
    targets: [target],
    depth: 1,
    budgetMs: 4_000,
    deadlineAt: Date.now() + 8_000,
    subject: 'Fixture Subject',
    categoryLabel: 'Court Records',
    primaryCrawlers: ['startrek'],
  } satisfies Parameters<typeof pantheonRetrievalAdapter.retrieve>[0];

  const authorized = await retrieveLexaraConversationalSource(request, { registrationAuthority });
  assert.equal(
    authorized.available,
    true,
    `the allowlisted authorized conversational retry reaches its source (${authorized.reason || 'no reason'})`,
  );
  assert.equal(authorized.accessOutcome, undefined);
  assert.deepEqual(registrationRequests, ['GET 8.8.8.8', 'POST 8.8.8.8'],
    'the configured contact-only registration route stays on the allowlisted source host');
  assert.deepEqual(sourceRequests.map(item => item.status), [401, 200],
    'the initial public request sees the barrier and only the authorized retry succeeds');
  assert.match(sourceRequests[1]?.cookie || '', /authorized-session=fixture/);

  rejectAuthorizedSession = true;
  const requestsBeforeUnauthorizedRetry = sourceRequests.length;
  const stillRestricted = await retrieveLexaraConversationalSource(request, { registrationAuthority });
  assert.equal(stillRestricted.available, false, 'a source that still returns 401 remains unavailable');
  assert.equal(stillRestricted.accessOutcome?.status, 'access_limited');
  assert.match(stillRestricted.reason || '', /HTTP 401|access limited/i,
    'the authorized retry failure remains an access barrier rather than a no-record conclusion');
  const unauthorizedRetryRequests = sourceRequests.slice(requestsBeforeUnauthorizedRetry);
  assert.equal(unauthorizedRetryRequests.at(-1)?.status, 401);
  assert.match(unauthorizedRetryRequests.at(-1)?.cookie || '', /authorized-session=fixture/,
    'the failed retry was genuinely made with the configured source session');

  const registrationCount = registrationRequests.length;
  const unapproved = await retrieveLexaraConversationalSource({
    ...request,
    targets: ['https://9.9.9.9/records/case-search'],
  }, {
    registrationAuthority,
    retrieve: async () => ({
      available: false,
      reason: 'Sign in required.',
      accessOutcome: { status: 'access_limited' as const, reason: 'Sign in required.' },
      plan: {} as PantheonRetrievalResponse['plan'],
      evidence: [],
      crawlerAudit: [],
    }),
  });
  assert.equal(unapproved.accessOutcome?.status, 'access_limited');
  assert.equal(registrationRequests.length, registrationCount,
    'an unrelated host receives no registration request or source-session credentials');
} finally {
  globalThis.fetch = originalFetch;
  pantheonOrchestrator.searchAllIsolatedWithAudit = originalSearch;
  if (originalFrontierMode == null) delete process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
  else process.env.PANTHEON_FRONTIER_LOCAL_ONLY = originalFrontierMode;
  if (originalSnapshotDirectory == null) delete process.env.PANTHEON_RAW_SNAPSHOT_DIR;
  else process.env.PANTHEON_RAW_SNAPSHOT_DIR = originalSnapshotDirectory;
  await rm(snapshotDirectory, { recursive: true, force: true });
}

console.log('Lexara conversational authorized-source routing verification passed.');
