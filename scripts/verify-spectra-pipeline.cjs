// Offline regression checks. No network, accounts, or real personal records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const FakeTimers = require('@sinonjs/fake-timers');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file)), { module, exports: module.exports,
    require: name => load(path.relative(root, path.resolve(root, path.dirname(file), name + '.ts'))),
  });
  return module.exports;
}
const diagnostics = load('server/services/spectra/SpectraPipelineDiagnostics.ts');
const retrievalDiagnostics = load('server/services/spectra/SpectraRetrievalDiagnostics.ts');
const client = load('client/src/lib/spectraFeedStatus.ts');
const route = read('server/routes/spectra.routes.ts');
const settle = route.slice(route.indexOf('async function settleWithin'), route.indexOf('\nfunction extractPhoneNumber'));
const discovery = route.slice(route.indexOf('async function runDiscoveryPass'), route.indexOf('\nfunction normalizeConfidence'));
const fixture = { url: 'https://example.org/document', title: 'Public document', provider: 'fixture' };
function pass(overrides = {}) {
  const scope = {
    AbortController, setTimeout, clearTimeout,
    discoverLegalMeshTier3: async () => [fixture],
    discoverLegalMeshSupplemental: async () => [],
    discoveryResultFromCandidate: value => ({ ...value }),
    dedupeDiscoveryResults: values => values,
    chooseSpectraPublicRetrievalUrls: values => values.map(value => value.url),
    mergePublicRetrievedMetadata: (_prior, value) => ({ retrieved: true, publishedAt: value.publishedAt }),
    retrieveSpectraPublicEvidence: async () => [],
    ...retrievalDiagnostics,
    ...overrides,
  };
  vm.runInNewContext(compile(settle + '\n' + discovery + '\nthis.run = runDiscoveryPass;'), scope);
  return scope.run;
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS', name); }
async function timed(run) {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try { await run(clock); assert.equal(clock.countTimers(), 0, 'deadline timers must be cleared'); }
  finally { clock.uninstall(); }
}
const empty = {
  discoveryResults: 0, retrieval: { selected: 0, retrieved: 0, deadlineExpiredPasses: 0 },
  configuredCollectors: 0, activeAttempts: [], activeBatchOutcomes: [], activeObservations: 0,
  suppliedObservations: 0, savedObservations: 0, normalizedObservations: 0,
  acceptedObservations: 0, rejectedObservations: 0, qualityIssues: [],
  solvedObservations: 0, fusedCandidates: 0, regionalCandidates: 0,
};
(async () => {
  await check('expired discovery does not pre-cancel reading a selected page', () => timed(async clock => {
    let sourceSignal, retrievalSignal;
    const run = pass({
      discoverLegalMeshTier3: (_query, signal) => new Promise(resolve => {
        sourceSignal = signal;
        signal.addEventListener('abort', () => resolve([fixture]), { once: true });
      }),
      retrieveSpectraPublicEvidence: async (_urls, signal) => {
        retrievalSignal = signal;
        assert.equal(signal.aborted, false);
        return [{ ...fixture, requestedUrl: fixture.url, observations: [], publishedAt: '2020-01-01' }];
      },
    });
    const pending = run(['public document'], { useClaude: false });
    await clock.tickAsync(10_000);
    const result = await pending;
    assert.equal(sourceSignal.aborted, true);
    assert.notEqual(sourceSignal, retrievalSignal);
    assert.equal(result.retrieval.selected, 1);
    assert.equal(result.retrieval.retrieved, 1);
    assert.equal(result.results[0].metadata.retrieved, true);
  }));
  await check('stalled retrieval returns within its own bounded deadline', () => timed(async clock => {
    let signal;
    const run = pass({ retrieveSpectraPublicEvidence: (_urls, s) => {
      signal = s; return new Promise(() => {});
    } });
    const pending = run(['public document'], { useClaude: false });
    await clock.tickAsync(5_000);
    const result = await pending;
    assert.equal(signal.aborted, true);
    assert.equal(result.retrieval.deadlineExpiredPasses, 1);
    assert.equal(result.retrieval.retrieved, 0);
    assert.equal(result.results.length, 1, 'keep discovery leads without pretending they were fetched');
  }));
  await check('empty query batch neither dispatches nor invents retrievals', async () => {
    const result = await pass({ discoverLegalMeshTier3: () => { throw Error('must not dispatch'); } })([], { useClaude: false });
    assert.equal(result.attempted, 0); assert.equal(result.retrieval.selected, 0);
  });
  await check('late retrieval diagnostics cannot mutate a returned pass', () => timed(async clock => {
    let record;
    const run = pass({ retrieveSpectraPublicEvidence: (_urls, _signal, observer) => {
      record = observer; return new Promise(() => {});
    } });
    const pending = run(['public document'], { useClaude: false });
    await clock.tickAsync(5_000);
    const result = await pending;
    assert.equal(result.retrieval.diagnostics.unreported, 1);
    record({ targetIndex: 0, reason: 'retrieved', httpStatus: 200 });
    assert.equal(result.retrieval.diagnostics.unreported, 1);
    assert.equal(result.retrieval.diagnostics.completed, 0);
  }));
  await check('normalization failures and quality rejections stay visible without raw records', () => {
    const marker = 'PRIVATE_FIXTURE_MUST_NOT_APPEAR';
    const report = diagnostics.buildSpectraPipelineDiagnostics({ ...empty,
      discoveryResults: 4, retrieval: { selected: 3, retrieved: 1, deadlineExpiredPasses: 1 },
      activeAttempts: [{ status: 'fulfilled', label: marker }, { status: 'failed', reason: marker }],
      activeBatchOutcomes: [{ status: 'rejected', reason: marker }],
      normalizedObservations: 2, rejectedObservations: 2,
      qualityIssues: [{ code: 'invalid_timestamp', message: marker }, { code: marker }],
    });
    assert.equal(report.publicRetrieval.notRetrieved, 2);
    assert.equal(report.telemetry.normalizationFailed, 1);
    assert.equal(report.observations.qualityIssues.invalid_timestamp, 1);
    assert.equal(report.observations.qualityIssues.other, 1);
    assert.equal(report.coordinateFusion.executed, false);
    assert.equal(report.outcome, 'no-mappable-evidence');
    assert(!JSON.stringify(report).includes(marker));
    const text = client.spectraPipelineNotices(report).join(' ');
    assert.match(text, /1 of 3/); assert.match(text, /data processing failed/);
    assert.match(text, /2 location observations did not pass/);
  });
  await check('regional context is not reported as executed coordinate fusion', () => {
    const report = diagnostics.buildSpectraPipelineDiagnostics({ ...empty, regionalCandidates: 1 });
    assert.equal(report.outcome, 'regional-context');
    assert.equal(report.coordinateFusion.executed, false);
    assert.match(client.spectraPipelineNotices(report).join(' '), /Regional inference is evaluated separately/);
  });
  await check('accepted observation path reports fusion separately from retrieved pages', () => {
    const report = diagnostics.buildSpectraPipelineDiagnostics({ ...empty,
      configuredCollectors: 1, activeObservations: 1, normalizedObservations: 1,
      acceptedObservations: 1, solvedObservations: 1, fusedCandidates: 1,
    });
    assert.equal(report.coordinateFusion.executed, true);
    assert.equal(report.outcome, 'location-observations');
    assert(!client.spectraPipelineNotices(report).join(' ').includes('no usable observations'));
  });
  await check('partial responses have an accurate warning instead of a skipped-check claim', () => {
    assert.match(client.spectraFeedNotice({ scope: 'discovery-http', hasFailures: false, incomplete: true, partial: 1 }), /partial results/);
    assert.equal(client.spectraPipelineNotices().length, 0);
  });
  console.log(`${passed} pipeline checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
