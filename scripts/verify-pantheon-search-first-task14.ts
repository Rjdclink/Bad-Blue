import assert from 'node:assert/strict';
import {
  buildPantheonSearchQueryVariants,
  discoverPantheonSourcesParallel,
  prioritizePantheonDiscoveryEvidenceGroups,
} from '../server/services/pantheon/PantheonDiscoveryCoordinator';
import { pantheonRetrievalAdapter } from '../server/services/crawlers/PantheonRetrievalAdapter';
import { twoStageDeployer } from '../server/services/pantheon/razors/TwoStageDeployer';
import { pantheonOrchestrator } from '../server/services/pantheonCrawlerOrchestrator';

const savedFetch = globalThis.fetch;
const localOnly = process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
const providerEnv = [
  'SEARXNG_URL',
  'DDGS_URL',
  'OPENSERP_URL',
  'GEMINI_API_KEY',
  'PANTHEON_DDGS_BACKEND',
  'PANTHEON_DDGS_FALLBACK_BACKENDS',
] as const;
const savedProviders = Object.fromEntries(providerEnv.map(key => [key, process.env[key]]));
const ddgsBackends: string[] = [];
const searchUrl = 'https://fresh-search.fixture.invalid/franklin-roosevelt';
const searchServiceUrl = 'https://free-search.fixture.invalid';
const primaryEvidenceUrl = 'https://9.9.9.9/records/task14-primary';

process.env.PANTHEON_FRONTIER_LOCAL_ONLY = '1';
for (const key of providerEnv) delete process.env[key];
process.env.DDGS_URL = searchServiceUrl;
process.env.PANTHEON_DDGS_BACKEND = 'primary-engine-fixture';
process.env.PANTHEON_DDGS_FALLBACK_BACKENDS = 'secondary-engine-fixture,tertiary-engine-fixture';

try {
  const variants = buildPantheonSearchQueryVariants(
    'Franklin Delano Roosevelt biography | official biography | presidential library',
  );
  assert.ok(variants.some(query => query.includes('Franklin Delano Roosevelt biography')));

  const fresh = { url: searchUrl, lane: 'ddgs' as const };
  const commonCrawl = { url: 'https://commoncrawl.fixture.invalid/fdr', lane: 'commoncrawl' as const };
  const learned = { url: 'https://learned.fixture.invalid/fdr', lane: 'learned' as const };
  const prioritized = prioritizePantheonDiscoveryEvidenceGroups(
    [[fresh], [commonCrawl], [learned]],
    new Set(),
    3,
  );
  assert.deepEqual(prioritized.map(item => item.url), [searchUrl, commonCrawl.url, learned.url],
    'fresh query-specific search results must outrank Common Crawl and learned candidates');

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === 'free-search.fixture.invalid' && url.pathname === '/search/text') {
      const body = JSON.parse(String(init.body));
      ddgsBackends.push(body.backend);
      if (body.backend === 'primary-engine-fixture' && body.query === 'stalled-primary-fixture') {
        return new Promise<Response>(() => {});
      }
      if (body.backend === 'primary-engine-fixture') {
        return new Response('primary provider unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({
        results: [{
          href: searchUrl,
          title: 'Franklin D. Roosevelt Presidential Library',
          body: 'Official biography and archival history.',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === '9.9.9.9' && url.pathname === '/records/task14-primary') {
      return new Response(
        '<html><title>Franklin Delano Roosevelt Biography</title><article>Franklin Delano Roosevelt was the 32nd president of the United States.</article></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
    throw new Error(`Unexpected external request in Task 14 search fixture: ${url.href}`);
  };

  const discovery = await discoverPantheonSourcesParallel(
    'Give me a brief background on Franklin Delano Roosevelt.',
    [],
    { timeoutMs: 1_000, limit: 3 },
  );
  assert.ok(discovery.evidence.some(item => item.url === searchUrl),
    'a configured fallback provider group must return live query-specific candidates');
  assert.ok(ddgsBackends.includes('primary-engine-fixture')
    && ddgsBackends.includes('secondary-engine-fixture,tertiary-engine-fixture'),
  'DDGS fallback must use the configured multi-provider group, not a hard-coded provider');

  const stalledAt = Date.now();
  const afterStalledPrimary = await discoverPantheonSourcesParallel(
    'stalled-primary-fixture',
    [],
    { timeoutMs: 1_000, limit: 2 },
  );
  assert.ok(afterStalledPrimary.evidence.some(item => item.url === searchUrl),
    'a preferred provider that ignores abort must not block the configured fallback group');
  assert.ok(Date.now() - stalledAt < 2_000,
    'a stalled provider must settle within the discovery budget');

  const orchestrator = pantheonOrchestrator as any;
  const deployer = twoStageDeployer as any;
  const originalSearch = orchestrator.searchAllIsolatedWithAudit;
  const originalDeploy = deployer.deployBackgroundReport;
  const controller = new AbortController();
  orchestrator.searchAllIsolatedWithAudit = async () => ({
    results: [{
      crawler: 'cerberus',
      target: primaryEvidenceUrl,
      content: 'Franklin Delano Roosevelt was the 32nd president of the United States.',
      confidence: 0.95,
      timestamp: Date.now(),
    }],
    audit: [{
      crawler: 'cerberus',
      capabilityClass: 'primary',
      status: 'completed_with_content',
      evidenceCount: 1,
      attempts: 1,
      targets: 1,
      sourceOutcomes: [{
        sourceUrl: primaryEvidenceUrl,
        status: 'completed_with_content',
        retrievedAt: new Date().toISOString(),
        durationMs: 1,
      }],
    }],
  });
  deployer.deployBackgroundReport = async () => {
    controller.abort();
    throw new Error('supplemental crawler aborted');
  };
  try {
    const retrieval = await pantheonRetrievalAdapter.retrieve({
      purpose: 'background_report',
      targets: [primaryEvidenceUrl],
      depth: 1,
      budgetMs: 5_000,
      deadlineAt: Date.now() + 5_000,
      subject: 'Franklin Delano Roosevelt',
      categoryLabel: 'Government, Political & Public-Service Records',
      registryCategory: 'government-employment',
      sourceKind: 'public-page',
      sourceAuthority: 'primary',
      sourceJurisdiction: 'US',
      workType: 'authoritative-source',
      subjectScoped: true,
      capabilityHint: ['cerberus', 'phantom'],
      signal: controller.signal,
      authority: {
        investigationId: 'task14-secondary-abort-regression',
        categoryId: 'task14-secondary-abort-regression:government',
        categoryIndex: 0,
        categoryLabel: 'Government, Political & Public-Service Records',
        workId: 'task14-primary-work',
        canonicalUrl: primaryEvidenceUrl,
        capability: 'cerberus',
        deadlineAt: Date.now() + 5_000,
        subject: 'Franklin Delano Roosevelt',
      },
    });
    assert.ok(retrieval.evidence.some(item => item.capabilityId === 'cerberus'),
      'a secondary-crawler abort must not erase completed primary-source evidence');
    assert.ok(retrieval.crawlerAudit.some(item =>
      item.crawler === 'phantom' && ['failed', 'timed_out'].includes(item.status)),
    'a secondary-crawler abort must remain visible in the retrieval audit');
  } finally {
    orchestrator.searchAllIsolatedWithAudit = originalSearch;
    deployer.deployBackgroundReport = originalDeploy;
  }
} finally {
  globalThis.fetch = savedFetch;
  if (localOnly === undefined) delete process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
  else process.env.PANTHEON_FRONTIER_LOCAL_ONLY = localOnly;
  for (const key of providerEnv) {
    const value = savedProviders[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Pantheon search-first and secondary-crawler regressions passed.');