// Offline regressions: real functions, synthetic records, no external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = path => fs.readFileSync(path, 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function load(path, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read(path)), { module, exports: module.exports,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    console, Date, Buffer });
  return module.exports;
}
(async () => {
  const { spectraAccessLogPath } = load('server/services/spectra/SpectraAccessLogging.ts');
  const index = read('server/index.ts');
  const start = index.indexOf('app.use((req, res, next) => {\n  const start = Date.now();');
  const end = index.indexOf('\n});', start) + 4;
  assert(start >= 0 && end > start);
  let middleware;
  const logs = [];
  vm.runInNewContext(compile(index.slice(start, end)), {
    app: { use(fn) { middleware = fn; } }, spectraAccessLogPath, Date,
    log: value => logs.push(value),
  });
  for (const path of ['/api/spectra/acquire', '/API/SPECTRA/acquire',
    '/api/spectra/sessions/PRIVATE_SESSION/records', '/api/spectra/PRIVATE_VALUE']) {
    let finish, serializations = 0;
    const body = { target: 'PRIVATE_TARGET', toJSON() { serializations++; throw Error('must not serialize'); } };
    const res = { statusCode: 200, json(value) { return value; }, on(_name, fn) { finish = fn; } };
    middleware({ path, method: 'POST' }, res, () => {});
    assert.equal(res.json(body), body, 'response must reach the client unchanged');
    finish();
    assert.equal(serializations, 0);
  }
  assert(!logs.join('\n').includes('PRIVATE_'));
  assert(logs.some(line => line.includes(':sessionId')));
  console.log('PASS access logs exclude response data and session IDs');

  let queryError;
  const persistence = load('server/services/spectra/SpectraAcquisitionPersistence.ts', {
    '../../db': { pool: { async query() { if (queryError) throw queryError; return { rows: [] }; } } },
    './SpectraAcquisitionRecords': {},
  });
  for (const name of ['loadSpectraSessionObservations', 'loadSpectraSessionIdentityBindings']) {
    assert.equal((await persistence[name]('fixture-user', 'fixture-session')).length, 0);
    for (const code of ['42P01', '08006']) {
      queryError = Object.assign(new Error('PRIVATE_DATABASE_DETAIL'), { code });
      await assert.rejects(persistence[name]('fixture-user', 'fixture-session'), error => error.code === code);
    }
    queryError = undefined;
  }
  console.log('PASS unavailable session storage cannot masquerade as an empty record set');

  const page = read('client/src/pages/spectra.tsx');
  const acquireStart = page.indexOf('  const acquireTarget = useCallback(');
  const acquireEnd = page.indexOf('\n  // Keep the latest acquisition handler', acquireStart);
  const requests = [], errors = [];
  const context = { AbortController, Date, Map, Set, Promise,
    publicPlaceMode: true, directEvidence: [], spectraSessionId: null,
    acquisitionControllerRef: { current: null }, requestRef: { current: 0 },
    originLexaraSessionIdRef: { current: null },
    useCallback: fn => fn, addMessage() {}, speakIfEnabled() {},
    spectraFeedNotice() {}, spectraFeedNotices() {},
    fetch(url, init) { requests.push({ url, init }); return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }); },
  };
  for (const [, name] of page.matchAll(/\b(set[A-Z]\w+)\(/g)) context[name] = () => {};
  context.setLastError = value => { if (value) errors.push(value); };
  vm.createContext(context);
  vm.runInContext(compile(page.slice(acquireStart, acquireEnd) + '\nglobalThis.acquire = acquireTarget;'), context);
  const first = context.acquire('Public Museum', 'fixture', []);
  const second = context.acquire('Public Library', 'fixture', []);
  assert(requests[0].init.signal.aborted, 'superseded acquisition must abort');
  // Execute the real unmount cleanup, not a copy of its controller logic.
  const cleanupMatch = page.match(/useEffect\(\(\) => \(\) => \{\n    requestRef.current \+= 1;[\s\S]*?\n  \}, \[\]\);/);
  assert(cleanupMatch);
  context.useEffect = fn => { context.cleanup = fn(); };
  vm.runInContext(compile(cleanupMatch[0]), context);
  context.cleanup();
  await Promise.all([first, second]);
  assert(requests[1].init.signal.aborted, 'unmount must abort the current acquisition');
  assert.equal(errors.length, 0, 'cancellation must not display acquisition errors');
  console.log('PASS replacement and unmount abort requests without stale errors');

  const recordsSource = read('client/src/components/geoconsole/SpectraEvidenceRecords.tsx');
  const olderStart = recordsSource.indexOf('  const loadOlder = async () => {');
  const olderEnd = recordsSource.indexOf('\n  return <details', olderStart);
  let records = Array.from({ length: 500 }, (_, i) => ({ id: `first-${i}` }));
  let cursor = 'before-500';
  const history = { AbortController, Set, Promise, scope: 'session', sessionId: 'fixture',
    nextCursor: cursor, loadingMore: false, olderController: { current: null },
    exhaustedOlder: { current: false }, browsingOlder: { current: false },
    setShowingOlder() {}, setLoadingMore() {}, setError() {},
    setRecords(fn) { records = fn(records); }, setNextCursor(value) { cursor = value; },
    fetch: async () => ({ ok: true, json: async () => ({ success: true, persistenceAvailable: true,
      records: Array.from({ length: 100 }, (_, i) => ({ id: `older-${i}` })), nextCursor: 'before-600' }) }),
  };
  vm.createContext(history);
  vm.runInContext(compile(recordsSource.slice(olderStart, olderEnd) + '\nglobalThis.older = loadOlder;'), history);
  await history.older();
  assert.equal(records.length, 500);
  assert.equal(records.at(-1).id, 'older-99', 'newly fetched history must remain inspectable');
  assert.equal(cursor, 'before-600');
  assert(history.browsingOlder.current, 'live polling must not overwrite historical browsing');
  console.log('PASS bounded history navigation retains newly fetched older records');
})().catch(error => { console.error(error); process.exitCode = 1; });
