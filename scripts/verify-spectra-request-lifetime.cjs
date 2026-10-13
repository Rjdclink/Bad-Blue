// Execute the real lifecycle and transport functions with synthetic requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const moduleFixture = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('server/lexara/DiscoveryDiagnostics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleFixture, exports: moduleFixture.exports, require,
  AbortController, AbortSignal, DOMException, Request, setTimeout, clearTimeout, console });
const d = moduleFixture.exports;
const scope = work => {
  const req = new EventEmitter(), res = new EventEmitter();
  let result;
  d.discoveryRequestLifetime(req, res, () => { result = work(req, res); });
  return { req, res, result };
};
const transport = (_input, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});
(async () => {
  let firstSignal, secondSignal;
  const first = scope(() => {
    firstSignal = d.discoverySignal();
    return d.discoveryFetch(transport, 'https://example.test/public-document').catch(error => error.name);
  });
  const second = scope(() => {
    secondSignal = d.discoverySignal();
    return d.discoveryFetch(transport, 'https://example.test/public-document').catch(error => error.name);
  });
  first.req.emit('close');
  assert.equal(firstSignal.aborted, false, 'normal request-body completion is not a disconnect');
  first.res.emit('close');
  assert.equal(await first.result, 'AbortError');
  assert.equal(secondSignal.aborted, false, 'one request cannot cancel another');
  second.res.emit('finish');
  assert.equal(await second.result, 'AbortError');
  for (const request of [first, second]) {
    assert.equal(request.req.listenerCount('aborted'), 0);
    assert.equal(request.res.listenerCount('finish'), 0);
    assert.equal(request.res.listenerCount('close'), 0);
  }
  console.log('PASS disconnect and completion cancel upstream work with isolated request scopes and cleanup');

  let requests = 0, persisted = false;
  const cancelled = scope(async (req, res) => {
    res.emit('close');
    assert.throws(() => d.discoveryFetch(async () => { requests++; }, 'https://example.test'), /Acquisition ended/);
    try { d.throwIfDiscoveryCancelled(); persisted = true; } catch {}
  });
  await cancelled.result;
  assert.equal(requests, 0); assert.equal(persisted, false);
  console.log('PASS cancelled work cannot dispatch another request or pass the persistence guard');

  const local = new AbortController();
  const combined = scope(async (_req, res) => {
    const promise = d.discoveryFetch(transport, 'https://example.test', { signal: local.signal }).catch(e => e.name);
    local.abort();
    assert.equal(await promise, 'AbortError');
    assert.equal(d.discoverySignal().aborted, false, 'provider timeout cannot abort the whole acquisition');
    res.emit('finish');
  });
  await combined.result;
  const init = { headers: { accept: 'application/json' } };
  await d.discoveryFetch(async (_url, options) => { assert.equal(options, init); return new Response('{}'); }, 'https://example.test', init);
  console.log('PASS provider cancellation is preserved and unscoped callers are unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; });
