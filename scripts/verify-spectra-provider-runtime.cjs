// Exercise real provider adapters and admission control with local HTTP fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-provider-check-'));
const logs = [];
const saved = { fetch: global.fetch, info: console.info, warn: console.warn, env: { ...process.env } };
let passed = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const workFor = ms => signal => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(['fixture']); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
});

(async () => {
  const mesh = fs.readFileSync(path.join(root, 'server/lexara/LegalProviderMesh.ts'), 'utf8');
  await esbuild.build({
    stdin: { contents: mesh + `
      export { withTimeout as attempt, tavily, ddgsBackend, searxng, openserp, scrapingBee, commonCrawl, serpApi, duckDuckGoInstantAnswer };
      export * from './DiscoveryDiagnostics';
      export function resetFixture() { engineCooldownUntil.clear(); laneFailures.clear(); laneInFlight.clear(); laneQueued.clear(); captchaDisabledEngines.clear(); captchaDisabledEngines.add('duckduckgo'); }
    `, resolveDir: path.join(root, 'server/lexara'), loader: 'ts' },
    outfile: path.join(temp, 'check.cjs'), bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'unrelated-planning-fixtures', setup(build) {
      build.onResolve({ filter: /\/Lexara(PublicSourceRegistry|DiscoveryLearning|ResearchAssist)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: [
        'buildLexaraSourceQueries', 'getLexaraPublicSources', 'getLexaraSourceQueryHints', 'getLexaraLearnedQueryPatterns',
        'getLexaraLearnedSources', 'rankLexaraDiscoveryUrls', 'planLexaraResearchQueries',
      ].map(name => `export const ${name} = () => [];`).join('\n') }));
    } }],
  });
  const d = require(path.join(temp, 'check.cjs'));
  console.info = console.warn = (...args) => logs.push(args);
  process.env.TAVILY_API_KEY = process.env.SCRAPINGBEE_API_KEY = process.env.SERPAPI_KEY = 'FIXTURE_DO_NOT_LOG';
  process.env.SEARXNG_URL = process.env.DDGS_URL = process.env.OPENSERP_URL = 'http://fixture.invalid';
  const test = async (name, run) => {
    d.resetFixture();
    global.fetch = () => { throw new Error('Unexpected HTTP fixture'); };
    await run(); passed++; saved.info(`PASS ${name}`);
  };
  const capture = async run => d.withDiscoveryDiagnostics(async () => { const result = await run(); return { result, stats: d.getDiscoveryDiagnostics() }; });

  await test('DNS outage stops a forty-job fan-out after two dispatched attempts', async () => {
    let requests = 0;
    const dns = Object.assign(new Error('DO_NOT_LOG'), { cause: Object.assign(new Error('DO_NOT_LOG'), { code: 'ENOTFOUND' }) });
    const { stats } = await capture(() => Promise.all(Array.from({ length: 40 }, () => d.attempt('searxng', 1000, undefined, async () => {
      requests++; await delay(15); throw dns;
    }))));
    assert.equal(requests, 2); assert.equal(stats.dispatched, 2); assert.equal(stats.failed, 2);
    assert.equal(stats.skipped, 38); assert.equal(stats.pending, 0); assert.equal(stats.incomplete, true);
  });
  await test('queued request receives its full HTTP budget after admission', async () => {
    const { stats, result } = await capture(() => Promise.all([
      d.attempt('tavily', 500, undefined, workFor(180)),
      d.attempt('tavily', 500, undefined, workFor(180)),
      d.attempt('tavily', 250, undefined, workFor(190)),
    ]));
    assert.equal(result.filter(Boolean).length, 3); assert.equal(stats.ok, 3); assert.equal(stats.timeout, 0);
  });
  await test('queue deadline is skipped work, not an upstream timeout', async () => {
    let ran = false;
    const { stats } = await capture(() => Promise.all([
      d.attempt('tavily', 500, undefined, workFor(1000)), d.attempt('tavily', 500, undefined, workFor(1000)),
      d.attempt('tavily', 250, undefined, async () => { ran = true; return []; }),
    ]));
    assert.equal(ran, false); assert.equal(stats.timeout, 2); assert.equal(stats.skipped, 1);
    assert.equal(stats.dispatched, 2); assert.equal(stats.providers[0].errors['queue-timeout'], 1);
  });
  await test('cancelling queued work dispatches no request', async () => {
    const c = new AbortController();
    const active = [d.attempt('tavily', 500, undefined, workFor(100)), d.attempt('tavily', 500, undefined, workFor(100))];
    const pending = capture(() => d.attempt('tavily', 500, c.signal, () => { throw new Error('Must not dispatch'); }));
    c.abort(); const { stats } = await pending; await Promise.all(active);
    assert.equal(stats.cancelled, 1); assert.equal(stats.dispatched, 0);
  });
  await test('results arriving after cancellation are not returned', async () => {
    const c = new AbortController();
    const { result } = await capture(() => d.attempt('tavily', 500, c.signal, async () => { c.abort(); return ['late']; }));
    assert.equal(result, null);
  });
  await test('ScrapingBee uses documented JSON search and keeps its key out of the URL', async () => {
    global.fetch = async (raw, init) => {
      const url = new URL(raw);
      assert.equal(url.pathname, '/api/v1/google'); assert.equal(url.searchParams.get('search'), 'NASA Worldview documentation');
      assert.equal(url.searchParams.has('api_key'), false); assert.equal(init.headers.authorization, 'Bearer FIXTURE_DO_NOT_LOG');
      return json({ organic_results: [{ url: 'https://example.test/docs', title: 'Documentation', description: 'Fixture excerpt' }] });
    };
    const { result, stats } = await capture(() => d.scrapingBee('NASA Worldview documentation', []));
    assert.equal(result[0].excerpt, 'Fixture excerpt'); assert.equal(stats.ok, 1);
  });
  await test('malformed provider schema is a failure, not zero results', async () => {
    global.fetch = async () => json({ results: 'invalid' });
    const { stats } = await capture(() => d.ddgsBackend('fixture', 'yahoo', 500));
    assert.equal(stats.failed, 1); assert.equal(stats.empty, 0); assert.equal(stats.providers[0].errors['invalid-response'], 1);
  });
  await test('Common Crawl collection HTTP 503 remains visible', async () => {
    global.fetch = async () => json({ error: 'DO_NOT_LOG' }, 503);
    const { stats } = await capture(() => d.commonCrawl('historical fixture', ['https://example.test/docs'], {}));
    assert.equal(stats.failed, 1); assert.equal(stats.empty, 0); assert.equal(stats.providers[0].errors['http-503'], 1);
  });
  await test('HTTP 200 challenge is not parsed as evidence or retried', async () => {
    let requests = 0;
    global.fetch = async () => { requests++; return new Response('<html>CAPTCHA DO_NOT_LOG</html>', { headers: { 'content-type': 'text/html' } }); };
    const { stats } = await capture(async () => { await d.duckDuckGoInstantAnswer('fixture'); await d.duckDuckGoInstantAnswer('fixture'); });
    assert.equal(requests, 1); assert.equal(stats.failed, 1); assert.equal(stats.skipped, 1);
  });
  await test('Common Crawl retains good rows when another host or row fails', async () => {
    global.fetch = async raw => {
      const url = new URL(raw);
      if (url.pathname === '/collinfo.json') return json([{ 'cdx-api': 'https://index.commoncrawl.org/fixture-index' }]);
      if (url.searchParams.get('url').startsWith('failed.test')) return json({}, 503);
      return new Response('{"url":"https://example.test/docs"}\ninvalid-json');
    };
    const { result, stats } = await capture(() => d.commonCrawl('historical fixture', ['https://example.test', 'https://failed.test'], {}));
    assert.equal(result.length, 1); assert.equal(stats.ok, 1); assert.equal(stats.partial, 1); assert.equal(stats.incomplete, true);
  });
  await test('authentication rejection cools down without leaking response detail', async () => {
    let requests = 0;
    global.fetch = async () => { requests++; return json({ error: 'DO_NOT_LOG' }, 401); };
    const { stats } = await capture(async () => { await d.tavily('fixture'); await d.tavily('fixture'); });
    assert.equal(requests, 1); assert.equal(stats.failed, 1); assert.equal(stats.skipped, 1);
    assert.equal(stats.providers[0].errors['http-401'], 1);
  });
  await test('partial SearXNG response retains results and marks incomplete coverage', async () => {
    global.fetch = async () => json({ results: [{ url: 'https://example.test/docs' }], unresponsive_engines: [['bing', 'timeout']] });
    const { result, stats } = await capture(() => d.searxng('fixture'));
    assert.equal(result.length, 1); assert.equal(stats.ok, 1); assert.equal(stats.partial, 1); assert.equal(stats.incomplete, true);
  });
  await test('OpenSERP engine failure with no results is not a clean empty search', async () => {
    global.fetch = async () => json({ results: [], meta: { engines_failed: ['baidu'], engine_errors: [{ engine: 'baidu', error: 'DO_NOT_LOG' }] } });
    const { stats } = await capture(() => d.openserp('fixture'));
    assert.equal(stats.failed, 1); assert.equal(stats.empty, 0); assert.equal(stats.providers[0].errors['upstream-error'], 1);
  });
  await test('SerpAPI error payload is not a clean empty search', async () => {
    global.fetch = async () => json({ error: 'DO_NOT_LOG' });
    const { stats } = await capture(() => d.serpApi('fixture', []));
    assert.equal(stats.failed, 1); assert.equal(stats.empty, 0);
  });
  await test('disabled OpenSERP engine is skipped rather than counted as healthy empty', async () => {
    let requests = 0;
    global.fetch = async () => { requests++; return json({ results: [], meta: { engines_failed: ['baidu'], engine_errors: [{ engine: 'baidu', error: 'CAPTCHA DO_NOT_LOG' }] } }); };
    const { stats } = await capture(async () => { await d.openserp('fixture'); await d.openserp('fixture'); });
    assert.equal(requests, 1); assert.equal(stats.failed, 1); assert.equal(stats.skipped, 1); assert.equal(stats.empty, 0);
  });
  await test('SerpAPI documented successful empty result remains empty', async () => {
    global.fetch = async () => json({ error: 'DO_NOT_LOG', search_metadata: { status: 'Success' }, search_information: { organic_results_state: 'Fully empty' } });
    const { stats } = await capture(() => d.serpApi('fixture', []));
    assert.equal(stats.failed, 0); assert.equal(stats.empty, 1);
  });
  await test('queued requests recheck engine exclusions before dispatching HTTP', async () => {
    let requests = 0;
    global.fetch = async () => { requests++; await delay(10); return json({ results: [], meta: { engines_failed: ['baidu'], engine_errors: [{ engine: 'baidu', error: 'CAPTCHA' }] } }); };
    const { stats } = await capture(() => Promise.all([d.openserp('fixture'), d.openserp('fixture'), d.openserp('fixture')]));
    assert.equal(requests, 2); assert.equal(stats.failed, 2); assert.equal(stats.skipped, 1);
  });
  assert(!JSON.stringify(logs).includes('DO_NOT_LOG'));
  saved.info(`${passed} provider runtime checks passed; no external requests or personal data used`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = saved.fetch; console.info = saved.info; console.warn = saved.warn;
  for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
  Object.assign(process.env, saved.env);
  fs.rmSync(temp, { recursive: true, force: true });
});
