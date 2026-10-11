// One bounded deployment check. Never log URLs, credentials, queries or bodies.
// These checks establish connectivity/search response health, not evidence quality.
const QUERY = 'NASA Worldview documentation';
const key = (env, names) => names.map(name => String(env[name] || '').trim()).find(Boolean) || '';
const jsonHeaders = { accept: 'application/json', 'content-type': 'application/json' };

async function runProviderChecks({ env = process.env, fetchImpl = fetch, emit = value => console.info('[SPECTRA Provider Smoke]', JSON.stringify(value)) } = {}) {
  const results = [];
  async function request(provider, phase, url, init = {}, inspect) {
    const start = Date.now();
    let result;
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
      result = { provider, phase, httpStatus: response.status, status: response.ok ? 'ok' : `http-${response.status}` };
      if (response.ok && inspect) {
        const body = await response.json();
        const checked = inspect(body);
        result = { ...result, ...checked };
      } else if (response.body?.cancel) await response.body.cancel();
    } catch (error) {
      const code = error?.cause?.code || error?.code;
      const status = ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'dns'
        : ['ECONNREFUSED', 'ECONNRESET'].includes(code) ? 'connection'
        : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout'
        : error?.name === 'SyntaxError' ? 'invalid-response' : 'request-failed';
      result = { provider, phase, status };
    }
    result.durationMs = Date.now() - start;
    results.push(result); emit(result); return result;
  }
  const rows = (body, field) => Array.isArray(body?.[field])
    ? { status: body[field].length ? 'ok' : 'empty', resultCount: body[field].length }
    : { status: 'invalid-response' };
  const missing = provider => {
    const result = { provider, phase: 'search', status: 'not-configured' }; results.push(result); emit(result);
  };
  async function independent(provider, envName, port, healthPath, searchPath, params, body) {
    const base = key(env, [envName]) || `http://lexara-${provider}.railway.internal:${port}`;
    let health, search;
    try { health = new URL(healthPath, base); search = new URL(searchPath, base); }
    catch { const result = { provider, phase: 'health', status: 'invalid-configuration' }; results.push(result); emit(result); return; }
    if (!/^https?:$/.test(health.protocol)) { const result = { provider, phase: 'health', status: 'invalid-configuration' }; results.push(result); emit(result); return; }
    const ready = await request(provider, 'health', health);
    if (ready.status !== 'ok') return;
    for (const [name, value] of Object.entries(params || {})) search.searchParams.set(name, value);
    await request(provider, 'search', search, body ? { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) } : { headers: { accept: 'application/json' } }, payload => {
      const result = rows(payload?.data?.results ? payload.data : payload, 'results');
      const failures = payload?.unresponsive_engines || payload?.meta?.engines_failed;
      if (Array.isArray(failures) && failures.length) return { ...result, status: result.resultCount ? 'partial' : 'upstream-error', failedEngines: failures.length };
      return result;
    });
  }
  await Promise.all([
    independent('ddgs', 'DDGS_URL', 4479, '/health', '/search/text', {}, { query: QUERY, max_results: 3, safesearch: 'off', backend: 'yahoo' }),
    independent('searxng', 'SEARXNG_URL', 8080, '/healthz', '/search', { q: QUERY, format: 'json', engines: 'google cse,brave,bing', safesearch: '0' }),
    independent('openserp', 'OPENSERP_URL', 7000, '/health', '/mega/search', { text: QUERY, limit: '3', mode: 'balanced', engines: 'baidu' }),
    (async () => {
      const apiKey = key(env, ['TAVILY_API_KEY']); if (!apiKey) return missing('tavily');
      await request('tavily', 'search', 'https://api.tavily.com/search', { method: 'POST', headers: { ...jsonHeaders, authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query: QUERY, search_depth: 'basic', max_results: 3, include_answer: false, include_raw_content: false }) }, body => rows(body, 'results'));
    })(),
    (async () => {
      const apiKey = key(env, ['SERPAPI_KEY', 'SERPAPI_API_KEY']); if (!apiKey) return missing('serpapi');
      const endpoint = new URL('https://serpapi.com/search.json');
      for (const [name, value] of Object.entries({ engine: 'google', q: QUERY, api_key: apiKey, num: '3' })) endpoint.searchParams.set(name, value);
      await request('serpapi', 'search', endpoint, { headers: { accept: 'application/json' } }, body => {
        if (body?.search_metadata?.status === 'Success' && body?.search_information?.organic_results_state === 'Fully empty'
          && (!Array.isArray(body.organic_results) || !body.organic_results.length)) return { status: 'empty', resultCount: 0 };
        return body?.error ? { status: 'upstream-error' } : rows(body, 'organic_results');
      });
    })(),
    (async () => {
      const apiKey = key(env, ['SCRAPINGBEE_API_KEY']); if (!apiKey) return missing('scrapingbee');
      const endpoint = new URL('https://app.scrapingbee.com/api/v1/google'); endpoint.searchParams.set('search', QUERY);
      await request('scrapingbee', 'search', endpoint, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` } }, body => rows(body, 'organic_results'));
    })(),
  ]);
  const summary = { phase: 'summary', checks: results.length, successfulSearches: results.filter(r => r.phase === 'search' && r.status === 'ok').length, issues: results.filter(r => r.status !== 'ok').length };
  emit(summary);
  return { results, summary };
}

module.exports = { runProviderChecks };
// External outages must not block database migration or take the serving app
// offline. Each failure is explicit in deployment logs for release review.
if (require.main === module) runProviderChecks().catch(() => {
  console.error('[SPECTRA Provider Smoke]', JSON.stringify({ phase: 'summary', status: 'check-failed' }));
  process.exitCode = 1;
});
