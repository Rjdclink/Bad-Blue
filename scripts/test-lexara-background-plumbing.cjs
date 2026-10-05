const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, overrides = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    console, Buffer, URL, AbortController, setTimeout, clearTimeout, process, ...globals,
  })(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), module, module.exports);
  return module.exports;
}
(async () => {
  const subject = load('server/lexara/LexaraBackgroundSubject.ts');
  const router = load('server/lexara/LexaraResearchIntentRouter.ts', { './LexaraBackgroundSubject': subject });
  const history = ['What can you tell me about Avery Morgan Example?', 'What business does Avery Example operate?'];
  const decision = router.decideLexaraResearchNeed('What court cases involve Avery Morgan Example?', history);
  assert.equal(decision.requestedFact, 'court-record');
  assert(decision.sourceCategories.includes('courts'));
  assert.equal(subject.resolveLexaraBackgroundSubject(history[1], history.slice(0, 1)).name, 'Avery Morgan Example');
  assert.equal(subject.resolveLexaraBackgroundSubject('Tell me about Avery Beth Example.', ['Tell me about Avery Ann Example.']).name, 'Avery Beth Example');

  const logs = [];
  const usage = load('server/claudeUsage.ts', {}, { console: { info: (event, payload) => logs.push({ event, payload }), warn: (event, payload) => logs.push({ event, payload }) } });
  let report;
  await usage.runClaudeUsageScope(async () => {
    report = usage.createClaudeUsageReporter();
    await Promise.all([
      usage.meterClaudeRequest('claude-sonnet-5-5', 'web-search', async () => ({ usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 200, server_tool_use: { web_search_requests: 2 } } })),
      usage.meterClaudeRequest('claude-haiku-4-5', 'planner', async () => ({ usage: { input_tokens: 1000, output_tokens: 100 } })),
    ]);
  });
  report(); // HTTP finish callbacks may execute outside the async scope.
  const total = logs.find(entry => entry.event === '[Claude Turn Usage]').payload;
  assert.equal(total.calls, 2);
  assert.equal(total.estimatedUsd, 0.0251);
  assert.equal(total.complete, true);
  await usage.runClaudeUsageScope(async () => {
    await assert.rejects(usage.meterClaudeRequest('claude-sonnet-5-5', 'web-search', async () => { throw new Error('aborted'); }));
    usage.createClaudeUsageReporter()();
  });
  assert.equal(logs.at(-1).payload.complete, false, 'missing API usage must remain unknown');

  const pdf = Buffer.from('JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MTAwNTEwNTU0MysxMScwMCcpIC9DcmVhdG9yIChhbm9ueW1vdXMpIC9LZXl3b3JkcyAoKSAvTW9kRGF0ZSAoRDoyMDI2MTAwNTEwNTU0MysxMScwMCcpIC9Qcm9kdWNlciAoUmVwb3J0TGFiIFBERiBMaWJyYXJ5IC0gXChvcGVuc291cmNlXCkpIAogIC9TdWJqZWN0ICh1bnNwZWNpZmllZCkgL1RpdGxlICh1bnRpdGxlZCkgL1RyYXBwZWQgL0ZhbHNlCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSAvVHlwZSAvUGFnZXMKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0ZpbHRlciBbIC9BU0NJSTg1RGVjb2RlIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMTU1Cj4+CnN0cmVhbQpHYXBARTVta0lfJ0xfW1lgRVRAOGsvVSRFJD9bTidxXEtNbSdyPlVqPjEpKEQ3PjxhWmEiVylvT15Fa0g+QGs+WWAxZWpDKChOTFNCTjtfQ1ZlXFkqZCk5SmROOzpfPGFDakRaXVI3OzVPWURhaTYxRlcpPy1UTDopVy51aVNEb0QoZkxMaCdgayFVRjc7KE0lV1hsNygsJXB+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwNDAyIDAwMDAwIG4gCjAwMDAwMDA0NzAgMDAwMDAgbiAKMDAwMDAwMDczMSAwMDAwMCBuIAowMDAwMDAwNzkwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDUyM2ViMTZhZDIyYTY5YTI5MjQxMDk2YWM1MDc1ODRmPjw1MjNlYjE2YWQyMmE2OWEyOTI0MTA5NmFjNTA3NTg0Zj5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTAzNQolJUVPRgo=', 'base64');
  const retrieval = load('server/lexara/LexaraRetrievalBoundary.ts', {
    'node:dns/promises': { lookup: async () => [{ address: '8.8.8.8' }] },
  }, { fetch: async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }) });
  const result = await retrieval.lexaraRetrievalAdapter.retrieve({ purpose: 'lexara_legal_research', targets: ['https://records.example.test/opinion.pdf'] });
  assert.equal(result.evidence.length, 1);
  assert.match(result.evidence[0].content, /Avery Morgan Example court case 23-2217/);
  console.log('PASS plural court routing, full identity continuity, conflicting identities, whole-turn cost arithmetic, unknown billing, and real PDF text extraction');
})().catch(error => { console.error(error); process.exitCode = 1; });
