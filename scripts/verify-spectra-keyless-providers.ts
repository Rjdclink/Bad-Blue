import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpectraKeylessProviders, extractWithLocalCrawl4AI } from '../server/services/spectra/SpectraKeylessProviders';
import { createSpectraProviderConnections } from '../server/services/spectra/SpectraProviderConnections';
import { getDiscoveryDiagnostics, withDiscoveryDiagnostics } from '../server/lexara/DiscoveryDiagnostics';
import { retrieveSpectraPublicEvidence } from '../server/services/spectra/SpectraPublicRetrieval';
import { mergePublicRetrievedMetadata } from '../server/services/spectra/SpectraPublicEvidenceProvenance';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fixture = { url: 'https://example.com/', requestedUrl: 'https://example.com/', retrievedAt: '2026-10-13T00:00:00Z',
  publishedAt: '2020-01-01T00:00:00Z', textExcerpt: 'Short source', observations: [] };
let checks = 0;
async function check(name: string, run: () => Promise<void>) { await run(); checks++; console.log('PASS', name); }

await check('Firecrawl uses anonymous v2 contract and validates search results', async () => {
  const calls: any[] = [];
  const providers = createSpectraKeylessProviders({ env: { FIRECRAWL_API_KEY: 'NEVER_SEND' }, transport: async (url, init) => {
    calls.push({url, init});
    return response({ success: true, data: { web: [
      { url: 'https://example.com/#x', title: 'Public docs', description: 'Snippet' },
      { url: 'https://example.com/#y' }, { url: 'javascript:alert(1)' }, {url: 'https://user:pass@example.com/'},
    ] } });
  } });
  const found = await providers.search('Public documentation');
  assert.equal(found.length, 1); assert.equal(found[0].provider, 'firecrawl-keyless');
  assert.equal(calls[0].url, 'https://api.firecrawl.dev/v2/search');
  assert(!JSON.stringify(calls).includes('NEVER_SEND'));
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body).sources, ['web']);
});
await check('denials activate cooldown without retries or account fallbacks', async () => {
  for (const code of [401, 402, 403, 429]) {
    let calls = 0;
    const p = createSpectraKeylessProviders({ env: {}, transport: async () => { calls++; return response({}, code); } });
    await withDiscoveryDiagnostics(async () => {
      assert.deepEqual(await p.search('fixture'), []); assert.deepEqual(await p.search('fixture again'), []);
      assert.equal(calls, 1);
      assert.equal(getDiscoveryDiagnostics()?.providers[0].errors[`http-${code}`], 1);
      assert.equal(getDiscoveryDiagnostics()?.providers[0].errors.cooldown, 1);
    });
  }
});
await check('invalid and oversized provider responses stay empty and sanitized', async () => {
  for (const body of [{ success: false, error: 'SECRET_FIXTURE' }, { success: true, data: {web: 'bad'} }]) {
    assert.deepEqual(await createSpectraKeylessProviders({env: {}, transport: async () => response(body)}).search('q'), []);
  }
  let cancelled = false;
  const p = createSpectraKeylessProviders({env: {}, transport: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(2_000_001)); }, cancel() { cancelled = true; },
  }))});
  assert.deepEqual(await p.search('q'), []); assert(cancelled);
});
await check('Jina is Reader-only, anonymous, with source identity and 18 RPM bound', async () => {
  let calls = 0;
  const p = createSpectraKeylessProviders({env: {}, transport: async (url, init) => {
    assert.equal(url, 'https://r.jina.ai/https://example.com/');
    assert(!new Headers(init?.headers).has('authorization')); calls++;
    return response({code: 200, data: {url: fixture.url, content: '# Documentation'}});
  }});
  for (let i=0; i<18; i++) assert.equal(await p.read(fixture.url), '# Documentation');
  assert.equal(await p.read(fixture.url), null); assert.equal(calls, 18);
  const wrong = createSpectraKeylessProviders({env: {}, transport: async () => response({code:200,data:{url:'https://other.example/',content:'Wrong'}})});
  assert.equal(await wrong.read(fixture.url), null);
});
await check('cancellation prevents dispatch and reaches the in-flight transport', async () => {
  const stopped = new AbortController(); stopped.abort();
  const p = createSpectraKeylessProviders({env: {}, transport: async () => { throw Error('must not dispatch'); }});
  assert.deepEqual(await p.search('q', stopped.signal), []);
  const live = new AbortController(); let observed = false;
  const pending = createSpectraKeylessProviders({env: {}, transport: (_url, init) => new Promise((_resolve,reject) => {
    init!.signal!.addEventListener('abort', () => { observed = true; reject(init!.signal!.reason); });
    live.abort();
  })}).search('q', live.signal);
  assert.deepEqual(await pending, []); assert(observed);
});
await check('Crawl4AI is explicit when unconfigured and honors concurrent capacity', async () => {
  let calls = 0;
  const p = createSpectraKeylessProviders({env: {}, localExtract: async () => { calls++; return 'markdown'; }});
  assert.equal(await p.extract('html',fixture.url), null); assert.equal(calls,0);
  const releases: Array<() => void> = [];
  const active = createSpectraKeylessProviders({env: {SPECTRA_CRAWL4AI_PYTHON:'fixture'}, localExtract: async () => {
    calls++; await new Promise<void>(resolve => releases.push(resolve)); return 'markdown';
  }});
  const a = active.extract('html',fixture.url); const b = active.extract('html',fixture.url);
  assert.equal(await active.extract('html',fixture.url), null); assert.equal(calls,2);
  releases.forEach(release => release()); assert.deepEqual(await Promise.all([a,b]), ['markdown','markdown']);
});
await check('composition retains native providers, deduplicates, and survives individual failures', async () => {
  const native = {...fixture,title:'Native title',tier:3 as const,provider:'openserp'};
  const c = createSpectraProviderConnections({discover:async () => [native], retrieve:retrieveSpectraPublicEvidence,
    validate:async url => new URL(url), providers: { search:async () => [{...native,title:'Alternate'}, {...native,url:'https://example.org/',provider:'firecrawl-keyless'}], read:async()=>null,extract:async()=>null }});
  const results = await c.discover('docs'); assert.equal(results.length,2); assert.equal(results[0].title,'Native title');
  const broken = createSpectraProviderConnections({discover:async () => {throw Error('offline');}, retrieve:retrieveSpectraPublicEvidence,
    validate:async url => new URL(url),providers:{search:async()=>[native],read:async()=>null,extract:async()=>null}});
  assert.equal((await broken.discover('docs')).length,1);
});
await check('a slow-lane deadline retains native partial results', async () => {
  const controller = new AbortController();
  const native = {...fixture,title:'Native partial',tier:3 as const,provider:'searxng'};
  const c = createSpectraProviderConnections({discover:async()=>[native],retrieve:retrieveSpectraPublicEvidence,
    validate:async url=>new URL(url),providers:{search:async()=>{controller.abort();return [];},read:async()=>null,extract:async()=>null}});
  assert.equal((await c.discover('docs',controller.signal))[0].provider,'searxng');
});
await check('first-useful search cancels the slower adapter', async () => {
  let cancelled = false;
  const native = {...fixture,title:'Native',tier:3 as const,provider:'ddgs'};
  const c = createSpectraProviderConnections({discover:async()=>[native],retrieve:retrieveSpectraPublicEvidence,
    validate:async url=>new URL(url),providers:{
      search:(_query,signal)=>new Promise(resolve=>signal!.addEventListener('abort',()=>{cancelled=true;resolve([]);},{once:true})),
      read:async()=>null,extract:async()=>null,
    }});
  assert.equal((await c.discover('docs',undefined,{firstUseful:true}))[0].provider,'ddgs');
  assert(cancelled);
});
await check('HTML enrichment retains timestamps and observations and rejects challenge pages', async () => {
  let html = '<html><p>Short source</p></html>'; let readers = 0;
  const c = createSpectraProviderConnections({discover:async()=>[], validate:async url => new URL(url),
    retrieve:async (_targets,signal,_diagnostic,enhance) => [await enhance!(html,fixture,signal)],
    providers:{search:async()=>[],extract:async()=> '# Source',read:async()=> {readers++; return 'Rendered page content with more details.';}}});
  const found = (await c.retrieve([fixture.url]))[0];
  assert.equal(found.textExtractionProvider,'jina-reader'); assert.equal(found.publishedAt,fixture.publishedAt);
  assert.deepEqual(found.observations,[]); assert.equal(found.retrievedAt,fixture.retrievedAt);
  assert.equal(mergePublicRetrievedMetadata(undefined,found).fetchedTextProvider,'jina-reader');
  html = '<html>Verify you are human CAPTCHA</html>';
  assert.deepEqual((await c.retrieve([fixture.url]))[0],fixture); assert.equal(readers,1);
});
await check('direct denial and unsupported MIME never invoke enrichment', async () => {
  const saved = globalThis.fetch;
  try {
    for (const status of [401,403,429]) {
      globalThis.fetch = async () => new Response('', {status});
      let deniedEnrichment = false;
      assert.deepEqual(await retrieveSpectraPublicEvidence(['https://93.184.216.34/'], undefined, undefined,
        async (_html,evidence) => { deniedEnrichment = true; return evidence; }), []);
      assert.equal(deniedEnrichment, false);
    }
    for (const [type,body] of [['application/pdf','pdf'],['application/json','{}'],['text/plain','text']]) {
      globalThis.fetch = async () => new Response(body, {headers:{'content-type':type}});
      let enriched=false;
      await retrieveSpectraPublicEvidence(['https://93.184.216.34/'],undefined,undefined,async (_html,evidence)=>{enriched=true;return evidence;});
      assert.equal(enriched,false, 'enrichment is HTML-only');
    }
    globalThis.fetch = async () => new Response('<html><body>Direct source content</body></html>',{headers:{'content-type':'text/html'}});
    let enhanced=false;
    const direct=await retrieveSpectraPublicEvidence(['https://93.184.216.34/'],undefined,undefined,async ()=>{enhanced=true;throw Error('reader offline');});
    assert(enhanced); assert(direct[0].textExcerpt?.includes('Direct source content'));
  } finally { globalThis.fetch=saved; }
});
await check('both Spectra entry paths use composed adapters; container enables local extractor', async () => {
  const routes=readFileSync('server/routes/spectra.routes.ts','utf8');
  assert(routes.includes('discover: discoverSharedMeshTier3, retrieve: retrieveDirectPublicEvidence, validate: assertPublicUrl'));
  assert(routes.includes('discover: (query, signal) => discoverLegalMeshTier3(query, signal'));
  assert(routes.includes('retrieve: retrieveSpectraPublicEvidence'));
  const docker=readFileSync('Dockerfile','utf8');
  assert(docker.includes('SPECTRA_CRAWL4AI_PYTHON=/opt/spectra-crawl4ai/bin/python'));
  assert(docker.includes('spectra-crawl4ai-requirements.txt'));
  assert(readFileSync('scripts/spectra-crawl4ai-requirements.txt','utf8').includes('crawl4ai==0.9.4'));
});
if (process.env.SPECTRA_CRAWL4AI_PYTHON) {
  await check('real installed Crawl4AI extracts bounded Markdown without invented fields', async () => {
    const result = await extractWithLocalCrawl4AI(process.env.SPECTRA_CRAWL4AI_PYTHON!, '<html><body><h1>Public document</h1><script>secret_script()</script><p>Fixture content</p></body></html>',fixture.url,AbortSignal.timeout(3000));
    assert(result?.includes('# Public document')); assert(result?.includes('Fixture content')); assert(!result?.includes('secret_script'));
  });
}
console.log(`${checks} keyless provider checks passed`);
