// Synthetic transport fixtures only. No network calls, identities, accounts or devices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const FakeTimers = require('@sinonjs/fake-timers');
const root = path.resolve(__dirname, '..');
const fixtureUrl = 'https://example.org/public-document';
const marker = 'PRIVATE_FIXTURE_MUST_NOT_APPEAR';
const plain = value => JSON.parse(JSON.stringify(value));

function load(file, overrides = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, AbortController, Date,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer),
    fetch: async () => { throw new Error('Unexpected network request'); },
    require: name => {
      if (name === 'node:dns/promises') return {
        lookup: overrides.lookup || (async () => [{ address: '93.184.216.34' }]),
      };
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(root, path.dirname(file), name + '.ts')));
      return require(name);
    },
    ...overrides,
  });
  return module.exports;
}
const d = load('server/services/spectra/SpectraRetrievalDiagnostics.ts');
const client = load('client/src/lib/spectraFeedStatus.ts');
const json = (body = '{}', status = 200, headers = {}) => new Response(body, {
  status, headers: { 'content-type': 'application/json', ...headers },
});
async function retrieve(overrides = {}, urls = [fixtureUrl], signal) {
  const events = [];
  const module = load('server/services/spectra/SpectraPublicRetrieval.ts', overrides);
  const evidence = await module.retrieveSpectraPublicEvidence(urls, signal, row => events.push(row));
  assert.equal(events.length, new Set(urls.map(s => s.trim()).filter(Boolean)).size);
  assert(!JSON.stringify(events).includes(marker));
  return { evidence, events: plain(events) };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS', name); }

(async () => {
  await check('retrieved empty JSON is distinct from accepted location evidence', async () => {
    const result = await retrieve({ fetch: async () => json() });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].observations.length, 0);
    assert.deepEqual(plain(result.evidence[0].structuredRecord), {});
    assert.deepEqual(result.events, [{ targetIndex: 0, reason: 'retrieved', httpStatus: 200 }]);
  });
  await check('actual JSON records are retained with explicit archive size omissions', async () => {
    const body = { id: 'public-record-1', properties: { value: 12, unit: 'fixture' } };
    const small = await retrieve({ fetch: async () => json(JSON.stringify(body)) });
    assert.deepEqual(plain(small.evidence[0].structuredRecord), body);
    const large = await retrieve({ fetch: async () => json(JSON.stringify({ body: 'é'.repeat(130_000) })) });
    assert.equal(large.evidence[0].structuredRecord, undefined);
    assert.equal(large.evidence[0].structuredRecordOmitted, true, 'measure the archive budget in UTF-8 bytes');
    assert.equal(large.events[0].reason, 'retrieved', 'a retrieval succeeded even when its body exceeds the archive budget');
  });
  await check('HTML response keeps publication time separate from retrieval time', async () => {
    const result = await retrieve({ fetch: async () => new Response(
      '<html><head><meta property="article:published_time" content="2020-01-02"></head><body>Public archive</body></html>',
      { headers: { 'content-type': 'text/html' } },
    ) });
    assert.equal(result.evidence[0].publishedAt, '2020-01-02T00:00:00.000Z');
    assert.notEqual(result.evidence[0].publishedAt, result.evidence[0].retrievedAt);
  });
  await check('malformed URL and existing URL-policy rejection stay distinct', async () => {
    const invalid = await retrieve({}, ['not-a-url']);
    const blocked = await retrieve({}, ['file:///example']);
    assert.equal(invalid.events[0].reason, 'invalid_url');
    assert.equal(blocked.events[0].reason, 'blocked_url');
    assert.equal(invalid.evidence.length + blocked.evidence.length, 0);
  });
  await check('DNS and transport failures do not leak exception messages', async () => {
    const dns = await retrieve({ lookup: async () => { throw Error(marker); } });
    const network = await retrieve({ fetch: async () => { throw Error(marker); } });
    assert.equal(dns.events[0].reason, 'dns_error');
    assert.equal(network.events[0].reason, 'network_error');
  });
  await check('HTTP failures preserve status codes without reading error bodies', async () => {
    for (const status of [403, 429, 500, 502]) {
      const result = await retrieve({ fetch: async () => json(marker, status) });
      assert.equal(result.events[0].reason, 'http_error');
      assert.equal(result.events[0].httpStatus, status);
      assert.equal(result.evidence.length, 0);
    }
  });
  await check('unsupported images remain unsupported and report that explicitly', async () => {
    const result = await retrieve({ fetch: async () => new Response(marker, {
      headers: { 'content-type': 'image/jpeg' },
    }) });
    assert.equal(result.events[0].reason, 'unsupported_content_type');
    assert.equal(result.evidence.length, 0);
  });
  await check('invalid JSON is not reported as an empty successful response', async () => {
    const result = await retrieve({ fetch: async () => json(marker) });
    assert.equal(result.events[0].reason, 'invalid_response');
    assert.equal(result.evidence.length, 0);
  });
  await check('existing header and body size limits report response_too_large', async () => {
    for (const response of [json('{}', 200, { 'content-length': '2000001' }), json('x'.repeat(2_000_001))]) {
      const result = await retrieve({ fetch: async () => response });
      assert.equal(result.events[0].reason, 'response_too_large');
    }
  });
  await check('redirect failure reasons remain distinguishable', async () => {
    const missing = await retrieve({ fetch: async () => new Response(null, { status: 302 }) });
    let calls = 0;
    const loop = await retrieve({ fetch: async () => {
      calls++; return new Response(null, { status: 302, headers: { location: '/again' } });
    } });
    assert.equal(missing.events[0].reason, 'redirect_missing_location');
    assert.equal(loop.events[0].reason, 'redirect_limit');
    assert.equal(calls, 4, 'existing redirect bound must not increase');
  });
  await check('successful redirects preserve requested and final provenance', async () => {
    let calls = 0;
    const result = await retrieve({ fetch: async () => ++calls === 1
      ? new Response(null, { status: 301, headers: { location: '/final' } }) : json() });
    assert.equal(result.evidence[0].requestedUrl, fixtureUrl);
    assert.equal(result.evidence[0].url, 'https://example.org/final');
    assert.equal(result.events.length, 1);
  });
  await check('pre-cancelled work performs neither DNS nor HTTP', async () => {
    const controller = new AbortController(); controller.abort();
    const result = await retrieve({ lookup: async () => { assert.fail('DNS started after cancellation'); } }, [fixtureUrl], controller.signal);
    assert.equal(result.events[0].reason, 'cancelled');
  });
  await check('request timeout and caller cancellation remain separate', async () => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Error(marker)), { once: true });
      });
      const pending = retrieve({ fetch });
      await clock.tickAsync(2_200);
      assert.equal((await pending).events[0].reason, 'timeout');
      const controller = new AbortController();
      const cancelled = retrieve({ fetch }, [fixtureUrl], controller.signal);
      await clock.tickAsync(1); controller.abort();
      assert.equal((await cancelled).events[0].reason, 'cancelled');
      assert.equal(clock.countTimers(), 0);
    } finally { clock.uninstall(); }
  });
  await check('observer failure does not discard a successful response', async () => {
    const module = load('server/services/spectra/SpectraPublicRetrieval.ts', { fetch: async () => json() });
    const evidence = await module.retrieveSpectraPublicEvidence([fixtureUrl], undefined, () => { throw Error(marker); });
    assert.equal(evidence.length, 1);
  });
  await check('URL de-duplication still emits one result per selected target', async () => {
    const result = await retrieve({ fetch: async () => json() }, [fixtureUrl, fixtureUrl, ' ' + fixtureUrl + ' ']);
    assert.equal(result.events.length, 1);
    assert.equal(result.evidence.length, 1);
  });
  await check('diagnostic snapshots are idempotent, sanitized and sealed', () => {
    const ledger = d.createSpectraRetrievalDiagnostics(3);
    const row = { targetIndex: 0, reason: 'http_error', httpStatus: 502, raw: marker };
    ledger.record(row); row.reason = marker;
    ledger.record({ targetIndex: 0, reason: 'retrieved' });
    ledger.record({ targetIndex: 1, reason: marker });
    ledger.record({ targetIndex: 9, reason: 'retrieved' });
    const snapshot = ledger.finish();
    ledger.record({ targetIndex: 2, reason: 'retrieved' });
    assert.deepEqual(plain(snapshot), { countingUnit: 'page-selection', completed: 1, unreported: 2,
      reasons: { http_error: 1 }, httpStatuses: { 502: 1 } });
    assert.deepEqual(plain(ledger.finish()), plain(snapshot));
    assert(!JSON.stringify(snapshot).includes(marker));
  });
  await check('merging passes retains attempt units and filters untrusted labels', () => {
    const result = d.mergeSpectraRetrievalDiagnostics([
      { completed: 1, unreported: 0, reasons: { retrieved: 1, [marker]: 10 }, httpStatuses: { 200: 1, [marker]: 10 } },
      { completed: 1, unreported: 1, reasons: { retrieved: 1 }, httpStatuses: { 200: 1 } },
    ]);
    assert.equal(result.completed, 2);
    assert.equal(result.unreported, 1);
    assert.equal(result.countingUnit, 'page-selection');
    assert(!JSON.stringify(result).includes(marker));
  });
  await check('client notices distinguish failures, HTTP statuses and unconfirmed outcomes', () => {
    const notice = client.spectraRetrievalNotices({ completed: 2, unreported: 1,
      reasons: { http_error: 1, timeout: 1, [marker]: 1 }, httpStatuses: { 502: 1, [marker]: 1 },
    }).join(' ');
    assert.match(notice, /HTTP errors/); assert.match(notice, /502: 1/);
    assert.match(notice, /timed out/); assert.match(notice, /unconfirmed/);
    assert(!notice.includes(marker));
    assert.deepEqual(plain(client.spectraRetrievalNotices()), []);
  });
  await check('public venue rejections, duplicate URLs and retrieval counts remain separate', async () => {
    const place = load('server/services/spectra/SpectraPublicPlace.ts');
    const page = { url: fixtureUrl, requestedUrl: fixtureUrl, title: 'Unrelated public archive',
      retrievedAt: '2026-01-01T00:00:00Z', observations: [] };
    const result = await place.acquirePublicPlace('Example Public Library', '', {
      discover: async () => [{ url: fixtureUrl }],
      retrieve: async (_urls, _signal, record) => {
        record({ targetIndex: 0, reason: 'retrieved', httpStatus: 200 });
        return [page, { ...page }];
      },
      geocode: async () => { assert.fail('unsupported pages must abstain'); },
    });
    assert.equal(result.diagnostics.retrieved, 2);
    assert.equal(result.diagnostics.distinctRetrievedUrls, 1);
    assert.equal(result.diagnostics.duplicateRetrievedUrls, 1);
    assert.equal(result.diagnostics.rejectionReasons['name-unmatched'], 2);
    assert.equal(result.diagnostics.supported, 0);
    assert.equal(result.diagnostics.retrieval.reasons.retrieved, 1);
    assert.equal(result.candidates.length, 0);
  });
  console.log(`${passed} retrieval diagnostic checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
