// Offline display checks: no searches, accounts, network requests or real records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleFixture = { exports: {} };
vm.runInNewContext(compile(read('client/src/lib/spectraFeedStatus.ts')), {
  module: moduleFixture, exports: moduleFixture.exports,
});
const d = moduleFixture.exports;
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('PASS', name); };
const feed = { requestId: 'fixture', scope: 'discovery-http', hasFailures: true,
  incomplete: true, dispatched: 4, ok: 1, empty: 1, failed: 1, timeout: 1,
  cancelled: 0, skipped: 3, pending: 0, partial: 1,
  providers: [
    { provider: 'searxng', errors: { 'http-502': 1, 'queue-capacity': 2 } },
    { provider: 'ddgs', errors: { 'queue-timeout': 1, 'provider-unavailable': 1 } },
  ],
};
const pipeline = { scope: 'evidence-pipeline',
  publicRetrieval: { selected: 0, retrieved: 0, deadlineExpiredPasses: 0 },
  telemetry: { configuredCollectors: 2, fulfilled: 2, failed: 0, normalizationFailed: 0, observations: 0 },
  observations: { accepted: 1, rejected: 1, supplied: 1, saved: 1, normalized: 2,
    qualityIssues: { duplicate_point: 1, missing_accuracy: 1 } },
  coordinateFusion: { executed: false },
};
check('provider attempts stay separate from distinct evidence and reachability', () => {
  const text = d.spectraFeedNotices(feed).join(' ');
  assert.match(text, /4 dispatched; 1 returned results; 1 returned no results/);
  assert.match(text, /not distinct sources or accepted location evidence/);
  assert.match(text, /not that a source was reached/);
  assert.match(text, /1 provider attempts returned partial results/);
});
check('known provider failures and queue outcomes are displayed precisely', () => {
  const text = d.spectraFeedNotices(feed).join(' ');
  assert.match(text, /SearXNG: 1 HTTP 502; 2 queue full/);
  assert.match(text, /DDGS: 1 queue wait expired; 1 provider unavailable \(specific cause unconfirmed\)/);
  assert(!text.includes('cooldown'), 'unavailable does not prove a cooldown');
});
check('displayed diagnostics never copy raw provider or exception strings', () => {
  const marker = 'PRIVATE_URL_OR_ERROR';
  const text = d.spectraFeedNotices({ ...feed, providers: [
    { provider: marker, errors: { timeout: 1 } },
    { provider: 'tavily', errors: { [marker]: 1, '__proto__': 1, 'http-429': 1 } },
    { provider: 'constructor', errors: { timeout: 1 } },
  ] }).join(' ');
  assert(!text.includes(marker));
  assert(!text.includes('constructor'));
  assert.match(text, /Tavily: 1 HTTP 429/);
});
check('legacy and absent diagnostics do not invent zero-attempt reports', () => {
  assert.equal(d.spectraFeedNotices().length, 0);
  assert.equal(d.spectraFeedNotices({ scope: 'other' }).length, 0);
  assert.equal(d.spectraFeedNotices({ scope: 'discovery-http' }).length, 0);
});
check('non-finite and negative counters cannot appear as successful attempts', () => {
  const text = d.spectraFeedNotices({ ...feed, dispatched: NaN, ok: -3, empty: Infinity }).join(' ');
  assert.match(text, /0 dispatched; 0 returned results; 0 returned no results/);
  assert(!/NaN|Infinity|-3/.test(text));
});
check('fulfilled telemetry and configured collectors do not claim measurements', () => {
  const text = d.spectraPipelineNotices(pipeline).join(' ');
  assert.match(text, /2 collectors configured; 2 collection attempts fulfilled; 0 coordinate observations received/);
  assert.match(text, /do not establish usable measurements/);
  assert.match(text, /1 supplied with this request; 1 loaded from saved records; 2 entered quality checks/);
});
check('quality warnings are not added to rejection counts', () => {
  const text = d.spectraPipelineNotices(pipeline).join(' ');
  assert.match(text, /1 location observations did not pass/);
  assert.match(text, /1 missing accuracy; 1 duplicate observations/);
  assert.match(text, /warnings on retained observations; issue counts are not rejection counts/);
});
check('historical media does not become current presence through display wording', () => {
  const text = d.spectraObservationNotices([
    { source: 'exif_photo', observationKind: 'historical' },
    { source: 'historical_location' }, { source: 'device_gps' },
  ], 'stale').join(' ');
  assert.match(text, /2 historical observations/);
  assert.match(text, /do not establish current presence/);
  assert.match(text, /evidence is stale; current location is unverified/);
});
check('conflict and spatial corroboration preserve the identity distinction', () => {
  assert.match(d.spectraObservationNotices([], 'conflicted').join(' '), /evidence conflicts/);
  assert.match(d.spectraObservationNotices([], 'corroborated').join(' '), /subject identity is assessed separately/);
  assert.equal(d.spectraObservationNotices([], 'UNTRUSTED_STATUS').length, 0);
});
check('actual page attaches collection diagnostics on both response paths', () => {
  const page = read('client/src/pages/spectra.tsx');
  const start = page.indexOf('setPipelineNotices([\n        ...spectraFeedNotices');
  const end = page.indexOf('setPlaceSources(', start);
  assert(start > 0 && end > start);
  for (const publicPlace of [undefined, { diagnostics: {
    retrieved: 0, selected: 2, supported: 0, outcome: 'no-supported-address',
    distinctRetrievedUrls: 0, duplicateRetrievedUrls: 0,
  } }]) {
    let notices;
    vm.runInNewContext(compile(page.slice(start, end)), {
      ...d, payload: { acquisition: { feedDiagnostics: feed, pipelineDiagnostics: pipeline,
        liveLocationStatus: publicPlace ? undefined : 'conflicted' }, publicPlace },
      points: [], setPipelineNotices(value) { notices = value; },
    });
    assert.match(notices.join(' '), /SearXNG: 1 HTTP 502/);
    assert.match(notices.join(' '), publicPlace ? /no-supported-address/ : /evidence conflicts/);
  }
});
check('failed application responses retain recorded provider details', () => {
  const page = read('client/src/pages/spectra.tsx');
  const start = page.indexOf('if (!response.ok || !payload.success)');
  const end = page.indexOf('const discoveredPoints', start);
  assert(start > 0 && end > start);
  let notices;
  assert.throws(() => vm.runInNewContext(compile(page.slice(start, end)), {
    ...d, response: { ok: false }, payload: { success: false, feedDiagnostics: feed },
    setFeedNotice() {}, setPipelineNotices(value) { notices = value; },
  }), /Target acquisition failed/);
  assert.match(notices.join(' '), /SearXNG: 1 HTTP 502/);
});
console.log(`${passed} evidence status checks passed`);
