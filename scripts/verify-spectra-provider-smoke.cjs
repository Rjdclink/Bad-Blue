const assert = require('node:assert/strict');
const { runProviderChecks } = require('./check-spectra-providers.cjs');
(async () => {
  const calls = [], logs = [];
  const env = { TAVILY_API_KEY: 'DO_NOT_LOG', SERPAPI_KEY: ' ', SERPAPI_API_KEY: 'DO_NOT_LOG', SCRAPINGBEE_API_KEY: 'DO_NOT_LOG', LEXARA_DDGS_BACKEND: 'yahoo,grokipedia' };
  const fetchImpl = async (raw, init) => {
    const url = new URL(raw); calls.push({ url, init });
    if (url.hostname.includes('openserp')) return new Response('DO_NOT_LOG', { status: 503 });
    if (url.pathname === '/health' || url.pathname === '/healthz') return new Response('{}', { status: 200 });
    if (url.hostname === 'api.tavily.com') throw Object.assign(new Error('DO_NOT_LOG'), { cause: { code: 'ENOTFOUND' } });
    if (url.hostname === 'serpapi.com') return new Response(JSON.stringify({ error: 'DO_NOT_LOG' }));
    if (url.hostname.includes('scrapingbee')) return new Response('DO_NOT_LOG', { status: 401 });
    return new Response(JSON.stringify({ results: [{ url: 'https://example.test/docs' }] }));
  };
  const { results, summary } = await runProviderChecks({ env, fetchImpl, emit: value => logs.push(value) });
  assert.equal(calls.length, 8); // Three health checks; two healthy self-hosted searches; three keyed searches.
  assert.equal(calls.filter(x => x.url.hostname.includes('openserp')).length, 1);
  assert.equal(summary.successfulSearches, 2);
  assert.equal(results.find(x => x.provider === 'tavily').status, 'dns');
  assert.equal(results.find(x => x.provider === 'serpapi').status, 'upstream-error');
  assert.equal(results.find(x => x.provider === 'scrapingbee').status, 'http-401');
  assert.equal(calls.find(x => x.url.hostname === 'serpapi.com').url.searchParams.get('api_key'), 'DO_NOT_LOG');
  assert.equal(JSON.parse(calls.find(x => x.url.hostname.includes('ddgs') && x.url.pathname === '/search/text').init.body).backend, env.LEXARA_DDGS_BACKEND);
  assert(calls.every(x => x.init.signal instanceof AbortSignal));
  assert(!JSON.stringify(logs).includes('DO_NOT_LOG'));
  const missing = await runProviderChecks({ env: { DDGS_URL: 'invalid-url' }, fetchImpl: async () => new Response('', { status: 503 }), emit: () => {} });
  assert.equal(missing.results.filter(r => r.status === 'not-configured').length, 3);
  assert.equal(missing.results.find(r => r.provider === 'ddgs').status, 'invalid-configuration');
  for (const payload of [{}, { key: { usage: 1, limit: 1 }, account: { plan_usage: 1, plan_limit: 1, paygo_usage: 0, paygo_limit: 0 } }]) {
    const requested = [];
    const budget = await runProviderChecks({ env: { TAVILY_API_KEY: 'DO_NOT_LOG' }, emit: () => {}, fetchImpl: async raw => {
      requested.push(String(raw)); return new Response(JSON.stringify(payload));
    } });
    assert.equal(requested.filter(url => url === 'https://api.tavily.com/search').length, 0);
    assert(['budget-unavailable', 'quota-exhausted'].includes(budget.results.find(row => row.provider === 'tavily').status));
  }
  console.info('PASS bounded provider checks, credential alias, failed-health short circuit and secret-free logs');
})().catch(error => { console.error(error); process.exitCode = 1; });
