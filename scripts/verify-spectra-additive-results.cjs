const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleFixture = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync('client/src/lib/spectraResultRetention.ts', 'utf8')), {
  module: moduleFixture, exports: moduleFixture.exports, Map, Date,
});
const helpers = moduleFixture.exports;
const point = { latitude: 42, longitude: -94, timestamp: '2026-10-14T12:00:00Z', source: 'device_gps', confidence: 0.8 };
const candidate = { latitude: 42, longitude: -94, label: 'Fixture region', basis: 'regional_context', confidence: 0.25 };
const page = fs.readFileSync('client/src/pages/spectra.tsx', 'utf8');
const start = page.indexOf('  const acquireTarget = useCallback(');
const end = page.indexOf('  const acquireTargetRef = useRef(', start);
assert(start > 0 && end > start);
const state = {};
let payload;
let status = 200;
const context = {
  ...helpers, AbortController, Date, Map, Set, Promise,
  publicPlaceMode: true, directEvidence: [], spectraSessionId: null,
  acquisitionControllerRef: { current: null }, requestRef: { current: 0 },
  resultTargetRef: { current: '' }, originLexaraSessionIdRef: { current: null },
  mappedResultRef: { current: false },
  useCallback: fn => fn, addMessage() {}, speakIfEnabled() {},
  spectraFeedNotice: () => null, spectraFeedNotices: () => [],
  spectraPipelineNotices: () => [], spectraObservationNotices: () => [],
  spectraRetrievalNotices: () => [],
  fetch: async () => ({ ok: status === 200, json: async () => payload }),
};
for (const [, name] of page.matchAll(/\b(set[A-Z]\w+)\(/g)) {
  context[name] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
}
vm.createContext(context);
vm.runInContext(compile(page.slice(start, end) + '\nglobalThis.acquire = acquireTarget;'), context);
(async () => {
  payload = { success: true, locationObservations: [point], candidateLocations: [candidate], acquisition: { locationConfidence: 0.8 } };
  await context.acquire('Fixture Museum', 'fixture', []);
  assert.equal(state.setObservations.length, 1);
  assert.equal(state.setCandidateLocations.length, 1);
  payload = { success: true, locationObservations: [], candidateLocations: [], acquisition: { locationConfidence: 0 } };
  await context.acquire('Fixture Museum', 'fixture', [], undefined, true);
  assert.equal(state.setObservations.length, 1, 'empty supplemental result retains previous observation');
  assert.equal(state.setCandidateLocations.length, 1, 'empty supplemental result retains previous estimate');
  assert.equal(state.setConfidence, 0.8);
  payload = { success: true, candidateLocations: [{ ...candidate, label: 'Weaker alternative', confidence: 0.03 }] };
  await context.acquire('Fixture Museum', 'fixture', [], undefined, true);
  assert.equal(state.setCandidateLocations.length, 2, 'supplemental candidate is additive');
  assert.equal(state.setCandidateLocations[0].label, candidate.label, 'weaker candidate does not displace existing estimate');
  payload = { success: false, error: 'Fixture provider unavailable' }; status = 503;
  await context.acquire('Fixture Museum', 'fixture', [], undefined, true);
  assert.equal(state.setObservations.length, 1);
  assert.equal(state.setCandidateLocations.length, 2);
  assert.equal(state.setPhase, 'active', 'failed refresh does not disable working map');
  await context.acquire('Fixture Museum', 'fixture', []);
  assert.equal(state.setPhase, 'active', 'explicit supplemental failure also retains working map');
  status = 200; payload = { success: true };
  await context.acquire('Different Museum', 'fixture', []);
  assert.equal(state.setObservations.length, 0, 'different target must not inherit previous evidence');
  assert.equal(state.setCandidateLocations.length, 0);
  assert.equal(state.setConfidence, null);
  assert.equal(helpers.retainSpectraObservations([point], [{ ...point }]).length, 1, 'repeated observations deduplicate');
  const revised = { ...candidate, confidence: 0.6, sourceUrls: ['https://example.test/evidence'] };
  assert.equal(helpers.retainSpectraCandidates([candidate], [revised])[0], revised, 'stronger duplicate keeps its provenance');

  // Execute the production supplemental-lane catch before Promise.all joins it
  // to the independent regional source. No real device or network is used.
  const route = fs.readFileSync('server/routes/spectra.routes.ts', 'utf8');
  const laneStart = route.indexOf('    const activeAcquisitionPromise = acquireSpectraEnrolledTelemetry(');
  const laneEnd = route.indexOf('    const publicAccountPromise', laneStart);
  assert(laneStart > 0 && laneEnd > laneStart);
  const lane = { userId: 'fixture', phone: '', deviceRef: undefined,
    requestedSessionId: 'fixture', resolvedTargetLabel: 'Fixture Museum',
    acquireSpectraEnrolledTelemetry: async () => { throw Error('Fixture source unavailable'); },
  };
  vm.createContext(lane);
  vm.runInContext(compile(route.slice(laneStart, laneEnd) + '\nglobalThis.result = activeAcquisitionPromise;'), lane);
  const [supplement, independent] = await Promise.all([lane.result, Promise.resolve(candidate)]);
  assert.equal(supplement.batches.length, 0);
  assert.equal(supplement.attempts[0].status, 'failed', 'failure remains visible in diagnostics');
  assert.equal(independent, candidate, 'device failure cannot reject independent regional result');
  console.log('PASS additive results, empty/error refresh retention, target isolation, deduplication, and supplemental error isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
