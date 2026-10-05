// Execute the real research entry points, mesh, registry and discovery coordinator.
// External transports/provider inference/database I/O are fixtures, not live acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const testCases = [];
const test = (name, run) => testCases.push({ name, run });
const factual = 'The fictional contract requires written notice before termination';
const urls = ['https://example.test/contract-a', 'https://example.test/contract-b'];
const contribution = (provider, index, role = 'legal-analyst') => ({
  provider, model: provider + '-fixture', role, taskId: provider,
  success: true, content: factual + '. Source: ' + urls[index], latencyMs: 5, tokensUsed: 20,
});

function harness(options = {}) {
  const env = { ANTHROPIC_API_KEY: 'fixture', MISTRAL_API_KEY: 'fixture',
    OPENROUTER_API_KEY: 'forbidden-fixture', FIRECRAWL_API_KEY: 'forbidden-fixture', ...options.env };
  const calls = { gateway: [], http: [], reasoning: [], crawlers: [], paid: 0 };
  const cache = new Map();
  const enums = fs.readFileSync(path.join(root, 'server/aiTokenGovernor.ts'), 'utf8')
    .match(/export enum (?:AIProvider|UsageContext|TaskPriority|TaskComplexity)\s*\{[^}]+\}/g).join('\n');
  const governor = {};
  vm.runInNewContext(ts.transpileModule(enums, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: governor });
  governor.aiTokenGovernor = { getBudgetForTask: async () => ({ verbosityLevel: 'normal', maxTokens: 3000 }) };
  const contributions = options.contributions ?? [contribution('claude', 0), contribution('mistral', 1)];
  const stubs = {
    'server/aiTokenGovernor.ts': governor,
    'server/aiCollaborationOrchestrator.ts': { AICollaborationOrchestrator: { orchestrateCollaboration: async (...args) => {
      calls.reasoning.push(args);
      if (options.reasoningFailure) throw new Error('fixture unavailable');
      return { finalAnswer: 'Fixture synthesis', contributions, providersUsed: ['claude', 'mistral'], totalTokens: 40 };
    } } },
    'server/groq.ts': { getGroqClient() { throw new Error('unexpected direct Groq SDK'); } },
    'server/mistral.ts': { callMistral() { throw new Error('unexpected direct Mistral SDK'); } },
    'server/claude.ts': { callClaude() { throw new Error('unexpected direct Claude SDK'); } },
    'server/gemini.ts': { callGemini() { throw new Error('unexpected direct Gemini SDK'); } },
    'server/zeroApiIntelligence.ts': {
      generateZeroApiResponse: async () => ({ content: 'Existing local fallback remains available' }),
      shouldUseZeroApiMode: () => false, getZeroApiStatus: () => ({}),
    },
    'server/openRouterService.ts': new Proxy({}, { get() { throw new Error('OpenRouter legal inference reached'); } }),
    'server/openRouterWebSearch.ts': { orchestratedWebSearch: async query => {
      calls.gateway.push(query);
      if (!options.allowLegacyGateway) throw new Error('forbidden gateway reached');
      return { sources: options.gatewaySources?.(calls.gateway.length) ?? [urls[0]] };
    } },
    'server/services/pantheon/PantheonDiscoveryLearning.ts': {
      getPantheonLearnedQueryPatterns: async () => options.learnedPattern ? [options.learnedPattern] : [],
      getPantheonLearnedSources: async () => [],
      rankPantheonDiscoveryUrls: values => [...new Set(values)],
    },
    'server/services/pantheon/PantheonResearchAssist.ts': {
      planPantheonResearchQueries: async () => ({ queries: [], assistants: [] }),
    },
    'server/services/pantheon/PantheonSupplementalDiscovery.ts': { supplementalPantheonDiscovery: async () => {
      calls.paid++; return { urls: options.paidUrls || [], attempted: true, provider: 'serpapi' };
    } },
    ...(options.discoveryStub ? { 'server/services/pantheon/PantheonDiscoveryCoordinator.ts': {
      discoverPantheonSourcesParallel: options.discoveryStub,
    } } : {}),
    'server/services/crawlers/PantheonRetrievalAdapter.ts': { pantheonRetrievalAdapter: { retrieve: async request => {
      calls.crawlers.push(request);
      return { evidence: request.targets.map(target => ({ target, content: 'Extracted fixture source evidence' })) };
    } } },
    'server/lexara/LexaraDiscoveryLearning.ts': {
      rememberLexaraDiscoveryOutcome: async () => {},
      getLexaraLearnedQueryPatterns: async () => options.learnedPattern ? [options.learnedPattern] : [],
      getLexaraLearnedSources: async () => options.learnedSources || [],
      rankLexaraDiscoveryUrls: values => [...new Set(values)],
    },
    'server/lexara/LexaraResearchAssist.ts': {
      planLexaraResearchQueries: async query => ({ queries: [query + ' official'], providers: ['claude'] }),
    },
    'server/lexara/LexaraRetrievalBoundary.ts': { lexaraRetrievalAdapter: { retrieve: async request => {
      calls.crawlers.push(request);
      return { evidence: request.targets.map(target => ({ target, content: 'Extracted fixture source evidence' })) };
    } } },
    'server/lexara/LexaraResearchIntentRouter.ts': { decideLexaraResearchNeed: () => ({ needed: true }) },
  };
  const forbidden = /openrouter|firecrawl/i;
  async function fixtureFetch(raw, init) {
    const url = String(raw); calls.http.push({ url, init });
    assert(!forbidden.test(url), 'removed transport received an HTTP request: ' + url);
    const payload = options.fetchPayload?.(url, init, calls.http.length) ?? { results: [] };
    return { ok: true, json: async () => payload };
  }
  function load(relative) {
    if (stubs[relative]) return stubs[relative];
    if (cache.has(relative)) return cache.get(relative).exports;
    assert(!/cryptocrawl|cryptara/i.test(relative), 'out-of-scope module');
    const filename = path.join(root, relative);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} }; cache.set(relative, module);
    const requireLocal = spec => {
      if (spec === '@google/genai') return { GoogleGenAI: class { constructor() { throw new Error('unexpected Google SDK'); } } };
      if (spec === 'url') return require('node:url');
      if (spec === 'dns') return require('node:dns');
      if (spec === 'net') return require('node:net');
      if (spec === 'node:async_hooks') return require('node:async_hooks');
      if (spec === 'node:crypto') return require('node:crypto');
      if (spec === 'node:child_process') return require('node:child_process');
      assert(spec.startsWith('.'), 'unexpected dependency: ' + spec);
      let next = path.relative(root, path.resolve(path.dirname(filename), spec));
      if (!next.endsWith('.ts')) next += '.ts';
      return load(next);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled.outputText}\n})`, {
      process: { env }, console: { log() {}, warn() {}, error() {}, info() {} },
      fetch: fixtureFetch, URL, AbortController, DOMException, setTimeout, clearTimeout,
    }, { filename })(requireLocal, module, module.exports);
    return module.exports;
  }
  return { load, calls };
}

test('removed transports and Firecrawl-only seed adapter are not selectable', () => {
  const h = harness(); const registry = h.load('server/lexara/LexaraCrawlerCapabilityRegistry.ts');
  const pool = registry.getLexaraCrawlerCapabilityPool();
  assert.equal(pool.length, 60);
  assert(!pool.some(item => ['firecrawl', 'openrouter-web-search', 'seed-startrek'].includes(item.id)));
  for (const id of ['startrek', 'birdofprey', 'sixdegrees', 'seed-birdofprey', 'seed-trinity', 'instant-legal']) assert(pool.some(x => x.id === id));
});
test('one failed search query cannot erase the other Pantheon search leads', async () => {
  let queries = 0;
  const h = harness({ discoveryStub: async () => {
    if (++queries === 2) throw new Error('one search lane failed');
    return { evidence: [{ url: urls[0], title: 'Public record', lane: 'ddgs' }] };
  } });
  const candidates = await h.load('server/services/pantheon/PantheonSearchFirstDiscovery.ts')
    .discoverPantheonSearchFirstCandidates({ name: 'Jane Doe', categories: [{ label: 'Court Records', registry: ['court'] }] });
  assert.equal(queries, 3, 'searches run independently');
  assert.equal(candidates.length, 1, 'successful search results survive the failed query');
  assert.equal(candidates[0].url, urls[0]);
});
for (const configured of [false, true]) {
  test(`enhanced legal search retains independent contributions with gateway key ${configured ? 'present' : 'absent'}`, async () => {
    const h = harness({ env: { OPENROUTER_API_KEY: configured ? 'forbidden' : '' } });
    const result = await h.load('server/enhancedLegalSearch.ts').performEnhancedLegalSearch('Fictional contract facts', { context: 'Preserve this context', requireSources: true });
    assert.equal(h.calls.reasoning.length, 1);
    assert.equal(h.calls.reasoning[0][4].providerPolicy, 'legalwhat');
    assert(h.calls.reasoning[0][1].includes('Preserve this context'));
    assert.equal(result.modelResponses.length, 2);
    assert(result.attributedFacts.some(f => f.fact === factual));
    assert(result.metadata.totalSources >= 2);
    assert.equal(h.calls.gateway.length, 0);
  });
}
test('syntheses, failed routes and duplicate provider/model responses do not create independent votes', async () => {
  const first = contribution('claude', 0);
  const h = harness({ contributions: [first, { ...first }, { ...contribution('mistral', 1), success: false }, contribution('mistral', 1, 'harmony-synthesizer')] });
  const result = await h.load('server/enhancedLegalSearch.ts').performEnhancedLegalSearch('Fictional contract facts');
  assert.equal(result.modelResponses.length, 1);
  assert.equal(result.attributedFacts.length, 0);
});
test('existing AI callers retain their response shape unless contributions are requested', async () => {
  const h = harness();
  const result = await h.load('server/aiProvider.ts').generateUserText('fixture-legal', 'Fictional contract facts', { providerPolicy: 'legalwhat' });
  assert.equal(result.content, 'Fixture synthesis');
  assert.equal(Object.hasOwn(result, 'contributions'), false);
});
test('mesh failure preserves the existing local fallback without gateway recovery', async () => {
  const h = harness({ reasoningFailure: true });
  const result = await h.load('server/enhancedLegalSearch.ts').performEnhancedLegalSearch('Fictional contract facts');
  assert.equal(result.modelResponses[0].model, 'lmai');
  assert.equal(result.attributedFacts.length, 0);
  assert.equal(h.calls.reasoning.length, 1); assert.equal(h.calls.gateway.length, 0);
});
test('both legal discovery tiers preserve DDGS results while carrying the canonical exclusion policy', async () => {
  const h = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, fetchPayload: () => ({ results: [{ href: urls[0], title: 'Fresh result', body: 'Fresh source evidence' }] }) });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  const primary = await mesh.discoverLegalMeshTier3('contract fixture');
  const supplemental = await mesh.discoverLegalMeshSupplemental('contract fixture', []);
  assert.equal(primary[0].url, urls[0]); assert.equal(primary[0].excerpt, 'Fresh source evidence');
  assert.equal(supplemental[0].url, urls[0]); assert.equal(h.calls.gateway.length, 0);
});
test('duplicate discovery URLs retain complementary excerpts and survive empty learned records', async () => {
  const url = 'https://example.test/obituary';
  const h = harness({
    env: { TAVILY_API_KEY: 'fixture', DDGS_URL: 'https://ddgs.example.test' },
    learnedSources: [url],
    fetchPayload: endpoint => endpoint.includes('api.tavily.com')
      ? { results: [{ url, title: 'Obituary', content: 'Avery Morgan Example was born in Iowa.' }] }
      : endpoint.includes('ddgs.example.test')
        ? { results: [{ href: url, title: 'Obituary', body: 'Avery Morgan Example passed away February 6, 2020.' }] }
        : { results: [] },
  });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  const found = await mesh.discoverLegalMeshTier3('Avery Morgan Example death date', undefined, { firstUseful: true });
  const result = found.find(item => item.url === url);
  assert(result?.excerpt.includes('was born in Iowa'));
  assert(result?.excerpt.includes('passed away February 6, 2020'));
  assert.equal(found.filter(item => item.url === url).length, 1);
});

test('subject-specific evidence precedes generic official and learned sources', async () => {
  const h = harness({
    env: { TAVILY_API_KEY: 'fixture' },
    learnedSources: ['https://generic.gov/records'],
    fetchPayload: endpoint => endpoint.includes('api.tavily.com') ? { results: [
      { url: 'https://generic.gov/records', title: 'Vital records', content: 'General registration instructions' },
      { url: 'https://example.test/short', title: 'Avery Example obituary', content: 'A partial name lead' },
      { url: 'https://example.org/full', title: 'Avery Morgan Example obituary', content: 'Avery Morgan Example passed away February 6, 2020.' },
    ] } : { results: [] },
  });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  const found = await mesh.discoverLegalMeshTier3('Avery Morgan Example death date', undefined, {
    subject: 'Avery Morgan Example', requestedFact: 'death-date', firstUseful: true,
  });
  assert.equal(found[0].url, 'https://example.org/full');
  assert.equal(found[1].url, 'https://example.test/short');
  assert(found.some(item => item.url === 'https://generic.gov/records'), 'official fallback remains available');
});

test('malformed search URLs do not discard valid discovery results', async () => {
  const h = harness({
    env: { TAVILY_API_KEY: 'fixture' },
    fetchPayload: () => ({ results: [
      { url: 'not a URL', title: 'Malformed provider item' },
      { url: urls[0], title: 'Valid provider item', content: 'Relevant evidence' },
    ] }),
  });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  const result = await mesh.discoverLegalMeshTier3('contract fixture');
  assert(result.some(item => item.url === urls[0]));
});
test('Lexara retains slower provider evidence after fast discovery leads in live and default modes', async () => {
  let liveSlowProviderFinished = false;
  const live = harness({
    env: { TAVILY_API_KEY: 'fixture', DDGS_URL: 'https://ddgs.fixture.test' },
    fetchPayload: async url => {
      if (url.includes('api.tavily.com')) {
        return { results: [{ url: urls[0], title: 'Fast Tavily result', content: 'Fast irrelevant discovery lead' }] };
      }
      if (url.includes('ddgs.fixture.test')) {
        await new Promise(resolve => setTimeout(resolve, 120));
        liveSlowProviderFinished = true;
        return { results: [{ href: urls[1], title: 'Slow DDGS result', body: 'Slow useful evidence' }] };
      }
      return { results: [] };
    },
  });
  const liveMesh = live.load('server/lexara/LegalProviderMesh.ts');
  const firstUseful = await liveMesh.discoverLegalMeshTier3(
    'contract fixture',
    undefined,
    { firstUseful: true },
  );
  assert(firstUseful.some(item => item.url === urls[0]), 'fast discovery lead remains available');
  assert(firstUseful.some(item => item.url === urls[1]), 'slower independent evidence must survive');
  assert.equal(
    liveSlowProviderFinished,
    true,
    'unverified discovery leads must not cancel slower provider evidence',
  );

  let comprehensiveSlowProviderFinished = false;
  const comprehensive = harness({
    env: { TAVILY_API_KEY: 'fixture', DDGS_URL: 'https://ddgs.fixture.test' },
    fetchPayload: async url => {
      if (url.includes('api.tavily.com')) {
        return { results: [{ url: urls[0], title: 'Fast Tavily result', content: 'Fast useful evidence' }] };
      }
      if (url.includes('ddgs.fixture.test')) {
        await new Promise(resolve => setTimeout(resolve, 40));
        comprehensiveSlowProviderFinished = true;
        return { results: [{ href: urls[1], title: 'Slow DDGS result', body: 'Slow useful evidence' }] };
      }
      return { results: [] };
    },
  });
  const comprehensiveMesh = comprehensive.load('server/lexara/LegalProviderMesh.ts');
  const allResults = await comprehensiveMesh.discoverLegalMeshTier3('contract fixture');
  assert.equal(
    comprehensiveSlowProviderFinished,
    true,
    'default discovery must retain comprehensive provider waiting for non-background callers',
  );
  assert(allResults.some(item => item.url === urls[0]));
  assert(allResults.some(item => item.url === urls[1]));
});

test('production DDGS uses its independent code default without custom variables', async () => {
  const h = harness({
    env: { RAILWAY_ENVIRONMENT_ID: '91154a53-01a3-470c-8fdc-c0f13b4702fa', DDGS_URL: '' },
    fetchPayload: endpoint => endpoint.includes('lexara-ddgs.railway.internal')
      ? { results: [{ href: urls[0], title: 'Independent engine result', body: 'Source evidence' }] }
      : { results: [] },
  });
  const result = await h.load('server/lexara/LegalProviderMesh.ts').discoverLegalMeshTier3('fixture');
  assert(result.some(item => item.url === urls[0]));
  assert(h.calls.http.some(call => call.url === 'http://lexara-ddgs.railway.internal:4479/search/text'));
  assert(!h.calls.http.some(call => call.url.includes('pantheon-ddgs')));
});

test('learned query history cannot insert a prior person or answer instruction into a new search', async () => {
  const h = harness({ learnedPattern: 'Previous Privateperson answer briefly and give your sources business registry' });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  await mesh.discoverLegalMeshTier3('Avery Example business', undefined, { categories: ['business'], subject: 'Avery Example' });
  await mesh.discoverLegalMeshSupplemental('Avery Example business', [], undefined, { categories: ['business'], subject: 'Avery Example' });
  assert(!JSON.stringify(h.calls.http).includes('Previous Privateperson'));
  assert(!JSON.stringify(h.calls.http).includes('answer briefly'));
});

test('production code defaults activate all independent engines and aggregate OpenSERP', async () => {
  const h = harness({
    env: {
      RAILWAY_ENVIRONMENT_ID: '91154a53-01a3-470c-8fdc-c0f13b4702fa',
      SEARXNG_URL: '', DDGS_URL: '', OPENSERP_URL: '',
    },
    fetchPayload: endpoint => endpoint.includes('railway.internal')
      ? { results: [{ url: urls[0], href: urls[0], title: 'Engine evidence', content: 'Source excerpt', body: 'Source excerpt' }] }
      : { results: [] },
  });
  await h.load('server/lexara/LegalProviderMesh.ts').discoverLegalMeshTier3('fixture');
  for (const lane of ['searxng', 'ddgs', 'openserp']) {
    assert(h.calls.http.some(call => call.url.includes('lexara-' + lane + '.railway.internal')));
  }
  const openserp = h.calls.http.find(call => call.url.includes('lexara-openserp'));
  assert.equal(new URL(openserp.url).searchParams.get('mode'), 'balanced');
});

test('retired Pantheon internal search endpoints are ignored by the Lexara mesh', async () => {
  const h = harness({
    env: {
      DDGS_URL: 'http://pantheon-ddgs.railway.internal:8080',
      SEARXNG_URL: 'http://pantheon-searxng.railway.internal:8080',
      OPENSERP_URL: 'http://pantheon-openserp.railway.internal:8080',
    },
  });
  const mesh = h.load('server/lexara/LegalProviderMesh.ts');
  await mesh.discoverLegalMeshTier3('contract fixture', undefined, { firstUseful: true });
  assert.equal(
    h.calls.http.some(call => /pantheon-(?:ddgs|searxng|openserp)\.railway\.internal/i.test(call.url)),
    false,
    'retired Pantheon internal endpoints must never receive Lexara search traffic',
  );
});

test('legal discovery misses and learned-query retries never reopen OpenRouter', async () => {
  const h = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, learnedPattern: 'court records' });
  const result = await h.load('server/services/pantheon/PantheonDiscoveryCoordinator.ts').discoverPantheonSourcesParallel('contract fixture', [], { providerPolicy: 'legalwhat', includePaidFallback: true, timeoutMs: 250 });
  assert.equal(result.urls.length, 0); assert.equal(h.calls.gateway.length, 0);
  assert.equal(h.calls.http.length, 2); assert.equal(h.calls.paid, 0);
  assert(!result.lanesAttempted.includes('first-party'));
});
for (const retry of [false, true]) {
  test(`shared default discovery preserves develop's gateway exclusion on ${retry ? 'learned retry' : 'initial search'}`, async () => {
    const h = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, learnedPattern: 'court records', fetchPayload: (_url, _init, n) => ({ results: retry && n === 1 ? [] : [{ href: urls[0], title: 'Independent result', body: 'Fresh evidence' }] }) });
    const result = await h.load('server/services/pantheon/PantheonDiscoveryCoordinator.ts').discoverPantheonSourcesParallel('contract fixture', [], { timeoutMs: 250 });
    assert.equal(result.urls[0], urls[0]);
    assert.equal(h.calls.gateway.length, 0);
    assert.equal(h.calls.http.length, retry ? 2 : 1);
    assert.equal(h.calls.paid, 0);
  });
}
test('Lexara delegated discovery excludes the gateway on initial, recovery and recursive searches', async () => {
  const filename = 'server/lexara/LexaraPantheonInvestigation.ts';
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const callOptions = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'discoverPantheonSourcesParallel') {
      callOptions.push(node.arguments[2].getText(parsed));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(callOptions.length, 3, 'cover initial discovery, failed-crawl recovery and recursive broadening');
  for (const expression of callOptions) {
    const options = vm.runInNewContext(`(${expression})`, {
      categories: ['identity'], context: { jurisdiction: 'Iowa' },
      PERSON_RECURSIVE_MAX_TARGETS_PER_PASS: 12, remainingMs: 5000,
    });
    assert.equal(options.providerPolicy, 'capability-first');
    const success = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, fetchPayload: () => ({ results: [{ href: urls[0], title: 'Fresh result', body: 'Preserved evidence' }] }) });
    const result = await success.load('server/services/pantheon/PantheonDiscoveryCoordinator.ts').discoverPantheonSourcesParallel('fixture person', [], options);
    assert.equal(result.urls[0], urls[0]);
    assert.equal(result.evidence[0].snippet, 'Preserved evidence');
    assert.equal(success.calls.gateway.length, 0);
    const miss = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, learnedPattern: 'court records' });
    await miss.load('server/services/pantheon/PantheonDiscoveryCoordinator.ts').discoverPantheonSourcesParallel('fixture person', [], options);
    assert.equal(miss.calls.gateway.length, 0, 'a miss and learned retry must retain the exclusion');
    assert.equal(miss.calls.http.length, 2);
  }
});
test('direct official-authority results retain their evidence and avoid unnecessary discovery', async () => {
  const h = harness({ env: { COURTLISTENER_API_TOKEN: 'fixture' }, fetchPayload: () => ({ results: [{ caseName: 'Fixture Case', absolute_url: '/opinion/1/fixture/', snippet: 'Relevant source excerpt' }] }) });
  const result = await h.load('server/lexara/LexaraAuthorityResearch.ts').researchLegalAuthority('Find case law', { jurisdiction: 'Iowa' });
  assert.equal(result.sources[0].excerpt, 'Relevant source excerpt');
  assert.equal(h.calls.http.length, 1); assert.equal(h.calls.crawlers.length, 0); assert.equal(h.calls.gateway.length, 0);
});
test('discovered legal URLs still reach crawler enrichment and return to Lexara', async () => {
  const h = harness({ env: { DDGS_URL: 'https://ddgs.fixture.test' }, fetchPayload: () => ({ results: [{ href: 'https://fixture.gov/opinion', title: 'Fixture authority' }] }) });
  const result = await h.load('server/lexara/LexaraAuthorityResearch.ts').researchLegalAuthority('Find the statute', { jurisdiction: 'Iowa' });
  assert.equal(h.calls.crawlers.length, 1); assert.equal(h.calls.crawlers[0].purpose, 'lexara_legal_research');
  assert.equal(h.calls.crawlers[0].targets[0], 'https://fixture.gov/opinion');
  assert.equal(result.sources[0].excerpt, 'Extracted fixture source evidence');
  assert(result.summary.includes('Extracted fixture source evidence')); assert.equal(h.calls.gateway.length, 0);
});
test('complete discovery exhaustion cannot activate removed emergency providers even with their keys set', async () => {
  const h = harness({ learnedPattern: 'court records' });
  const result = await h.load('server/lexara/LexaraAuthorityResearch.ts').researchLegalAuthority('Find the statute');
  assert.equal(result, null); assert.equal(h.calls.gateway.length, 0); assert(h.calls.http.every(call => !/openrouter|firecrawl/i.test(call.url)));
});
test('cancelled research starts no provider or crawler work', async () => {
  const h = harness(); const controller = new AbortController(); controller.abort();
  const result = await h.load('server/lexara/LexaraAuthorityResearch.ts').researchLegalAuthority('Find the statute', { signal: controller.signal });
  assert.equal(result, null); assert.equal(h.calls.http.length, 0); assert.equal(h.calls.gateway.length, 0); assert.equal(h.calls.crawlers.length, 0);
});
test('release source-registry guard requires independent discovery and rejects the retired routes', () => {
  const verifier = fs.readFileSync(path.join(root, 'scripts/verify-pantheon-source-registry.cjs'), 'utf8');
  const start = verifier.indexOf("for(const required of ['searchCourtListener'");
  const end = verifier.indexOf('const searchFirst=', start);
  assert(start >= 0 && end > start);
  const guard = verifier.slice(start, end);
  const authority = fs.readFileSync(path.join(root, 'server/lexara/LexaraAuthorityResearch.ts'), 'utf8');
  const legalMesh = fs.readFileSync(path.join(root, 'server/lexara/LegalProviderMesh.ts'), 'utf8');
  const verify = (research = authority, mesh = legalMesh) => vm.runInNewContext(guard, { authority: research, legalMesh: mesh });
  assert.doesNotThrow(() => verify());
  for (const forbidden of ['orchestratedWebSearch', 'FIRECRAWL_API_KEY', 'api.firecrawl.dev']) {
    assert.throws(() => verify(authority + '\n' + forbidden), /Removed Lexara research route/);
  }
  assert.throws(() => verify(authority, legalMesh.replaceAll('discoverPantheonSourcesParallel', '') + '\nPantheonDiscoveryCoordinator'), /depends on Pantheon/);
});
(async () => {
  let passed = 0;
  for (const { name, run } of testCases) { await run(); passed++; console.log('PASS', name); }
  console.log(`${passed}/${testCases.length} Lexara research routing checks passed (external I/O mocked).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
