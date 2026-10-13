const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname,
  '../client/src/components/geoconsole/SpectraEvidenceRecords.tsx'), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    const controller = new AbortController();');
const needle = '  }, [scope, sessionId, refreshKey, provider, latestGeneration]);';
const end = source.indexOf(needle, start);
assert(start > 0 && end > start, 'evidence-record refresh effect must be present');
const effect = source.slice(start, end + needle.length);
const compiled = ts.transpileModule(effect, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

let nextTimer = 1;
const timers = new Map();
const listeners = new Map();
const requests = [];
const pending = [];
let cleanup = null;
let loading = true;
const document = {
  visibilityState: 'hidden',
  addEventListener(name, fn) { listeners.set(name, fn); },
  removeEventListener(name, fn) {
    if (listeners.get(name) === fn) listeners.delete(name);
  },
};
const context = vm.createContext({
  AbortController, document, URL, Promise,
  scope: 'public', sessionId: null, provider: '', refreshKey: 'active', latestGeneration: 0,
  browsingOlder: { current: false }, setShowingOlder() {},
  olderController: { current: null }, exhaustedOlder: { current: false },
  setLoadingMore() {}, setRecords() {}, setNextCursor() {}, setFeeds() {}, setError() {},
  setLoading(value) { loading = value; },
  setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  useEffect(fn) { cleanup = fn(); },
  fetch(url, init) {
    requests.push({ url, init });
    return new Promise(resolve => pending.push(resolve));
  },
});
vm.runInContext(compiled, context);
const flush = () => new Promise(resolve => setImmediate(resolve));
const succeed = index => pending[index]({
  ok: true,
  json: async () => ({ success: true, persistenceAvailable: true, records: [], feeds: [] }),
});

(async () => {
  assert.equal(requests.length, 0, 'hidden page must not immediately poll public feeds');
  assert(timers.size === 1, 'hidden page retains only one deferred refresh');
  document.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  assert.equal(requests.length, 1, 'visibility resumes a single request immediately');
  listeners.get('visibilitychange')();
  assert.equal(requests.length, 1, 'a second visible event cannot overlap an active fetch');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), null);
  succeed(0);
  await flush();
  assert.equal(loading, false);
  assert.equal(timers.size, 1, 'one recurring refresh is scheduled');

  document.visibilityState = 'hidden';
  const [timeout, fn] = [...timers][0];
  timers.delete(timeout);
  fn();
  await flush();
  assert.equal(requests.length, 1, 'timer fired in a hidden tab must not make an HTTP request');
  document.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  assert.equal(requests.length, 2, 'returning to a visible tab refreshes the evidence');
  succeed(1);
  await flush();
  context.browsingOlder.current = true;
  listeners.get('visibilitychange')();
  await flush();
  assert.equal(requests.length, 2, 'history browsing must not be overwritten by a live refresh');
  context.browsingOlder.current = false;
  cleanup();
  assert.equal(listeners.size, 0, 'cleanup removes the visibility listener');
  assert.equal(timers.size, 0, 'cleanup cancels the next refresh');
  assert(requests[1].init.signal.aborted, 'cleanup aborts in-flight or future fetches');
  console.log('SPECTRA public evidence polling checks passed without a browser or HTTP request.');
})().catch(error => { console.error(error); process.exitCode = 1; });
