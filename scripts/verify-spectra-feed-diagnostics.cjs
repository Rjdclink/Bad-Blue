// Offline checks of actual request accounting. No search, account or location data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-feed-check-'));
const logs = [];
const originalInfo = console.info;
const originalWarn = console.warn;
let passed = 0;
const check = (name, work) => { work(); passed++; originalInfo(`PASS ${name}`); };

(async () => {
  const mesh = fs.readFileSync(path.join(root, 'server/lexara/LegalProviderMesh.ts'), 'utf8');
  await esbuild.build({
    stdin: {
      contents: mesh + '\nexport { withTimeout as attempt };\n'
        + 'export * from "./DiscoveryDiagnostics";\n'
        + 'export * from "../../client/src/lib/spectraFeedStatus";\n',
      resolveDir: path.join(root, 'server/lexara'), loader: 'ts',
    },
    outfile: path.join(temp, 'check.cjs'), bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'unrelated-search-planning-fixtures', setup(build) {
      build.onResolve({ filter: /\/Lexara(PublicSourceRegistry|DiscoveryLearning|ResearchAssist)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: [
        'buildLexaraSourceQueries', 'getLexaraPublicSources', 'getLexaraSourceQueryHints',
        'getLexaraLearnedQueryPatterns', 'getLexaraLearnedSources', 'rankLexaraDiscoveryUrls', 'planLexaraResearchQueries',
      ].map(name => `export const ${name} = () => [];`).join('\n'), loader: 'js' }));
    } }],
  });
  const d = require(path.join(temp, 'check.cjs'));
  console.info = (...args) => logs.push(args);
  console.warn = (...args) => logs.push(args);
  const dns = new TypeError('fetch failed: https://example.invalid/?token=DO_NOT_LOG');
  dns.cause = Object.assign(new Error('private query DO_NOT_LOG'), { code: 'ENOTFOUND' });
  check('nested DNS error is classified without message leakage', () => assert.equal(d.discoveryErrorType(dns), 'dns'));
  check('HTTP and malformed responses stay distinct', () => {
    assert.equal(d.discoveryErrorType(new Error('Discovery HTTP 429')), 'http-429');
    assert.equal(d.discoveryErrorType(new SyntaxError('DO_NOT_LOG')), 'invalid-response');
  });
  let mixed;
  await d.withDiscoveryDiagnostics(async () => {
    const values = await Promise.all([
      d.attempt('searxng', 1000, undefined, async () => { throw dns; }),
      d.attempt('tavily', 1000, undefined, async () => []),
      d.attempt('openserp', 1000, undefined, async () => ['public-test-result']),
      d.attempt('duckDuckGoInstantAnswer', 1000, undefined, async () => { throw new SyntaxError('DO_NOT_LOG'); }),
    ]);
    mixed = d.getDiscoveryDiagnostics();
    check('diagnostics preserve caller results and null-on-error contract', () => assert.deepEqual(values, [null, [], ['public-test-result'], null]));
  });
  check('empty results cannot hide failed providers', () => {
    assert.equal(mixed.failed, 2); assert.equal(mixed.empty, 1); assert.equal(mixed.ok, 1);
    assert.equal(mixed.pending, 0); assert.equal(mixed.hasFailures, true);
    assert.equal(mixed.providers.find(p => p.provider === 'searxng').errors.dns, 1);
    assert.match(d.spectraFeedNotice(mixed), /incomplete/);
  });
  let timeout, cancellation;
  await d.withDiscoveryDiagnostics(async () => {
    await d.attempt('tavily', 250, undefined, signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    timeout = d.getDiscoveryDiagnostics();
  });
  await d.withDiscoveryDiagnostics(async () => {
    const controller = new AbortController(); controller.abort();
    await d.attempt('tavily', 1000, controller.signal, async () => { throw new Error('work must not run'); });
    cancellation = d.getDiscoveryDiagnostics();
  });
  check('deadline failure and caller cancellation remain distinct', () => {
    assert.equal(timeout.timeout, 1); assert.equal(timeout.hasFailures, true);
    assert.equal(cancellation.cancelled, 1); assert.equal(cancellation.hasFailures, false);
    assert.equal(cancellation.incomplete, true);
  });
  const concurrent = await Promise.all([1, 2].map(n => d.withDiscoveryDiagnostics(async () => {
    await new Promise(resolve => setTimeout(resolve, n));
    const finish = d.beginDiscoveryAttempt(n === 1 ? 'tavily' : 'searxng');
    finish(n === 1 ? 'empty' : 'skipped'); finish('failed', dns);
    return d.getDiscoveryDiagnostics();
  })));
  check('concurrent requests have isolated IDs and counters; completion is idempotent', () => {
    assert.notEqual(concurrent[0].requestId, concurrent[1].requestId);
    assert.equal(concurrent[0].empty, 1); assert.equal(concurrent[0].skipped, 0);
    assert.equal(concurrent[1].skipped, 1); assert.equal(concurrent[1].empty, 0);
    assert.equal(concurrent[0].failed + concurrent[1].failed, 0);
    assert.equal(d.getDiscoveryDiagnostics(), undefined);
  });
  await d.withDiscoveryDiagnostics(async () => {
    const finish = d.beginDiscoveryAttempt('DO_NOT_LOG');
    const pending = d.getDiscoveryDiagnostics(); finish('ok');
    check('pending snapshot is truthful and does not change after completion', () => {
      assert.equal(pending.pending, 1); assert.equal(pending.incomplete, true);
      assert.equal(pending.providers[0].provider, 'other');
      assert.equal(d.getDiscoveryDiagnostics().pending, 0);
    });
  });
  check('unknown or clean diagnostics do not invent a warning', () => {
    assert.equal(d.spectraFeedNotice(), null);
    assert.equal(d.spectraFeedNotice({ scope: 'discovery-http', hasFailures: false, incomplete: false }), null);
  });
  check('recorded diagnostics contain no raw exception or untrusted label', () => assert.ok(!JSON.stringify(logs).includes('DO_NOT_LOG')));
  originalInfo(`${passed} feed diagnostic checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  console.info = originalInfo; console.warn = originalWarn;
  fs.rmSync(temp, { recursive: true, force: true });
});
