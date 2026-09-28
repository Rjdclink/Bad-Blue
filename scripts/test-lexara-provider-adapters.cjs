const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tests = [];
const test = (name, run) => tests.push({ name, run });
function load(file, stubs, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const requireStub = id => {
    if (id in stubs) return stubs[id];
    throw new Error('Unexpected dependency ' + id);
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled.outputText}\n})`, {
    process: { env: { ANTHROPIC_API_KEY: 'fixture', MISTRAL_API_KEY: 'fixture', GROQ_API_KEY: 'fixture' } },
    console: { log() {}, warn() {}, error() {} }, Error, DOMException, AbortController,
    setTimeout, clearTimeout, ...globals,
  })(requireStub, module, module.exports);
  return module.exports;
}
function claudeHarness(responses) {
  const calls = [];
  class Anthropic {
    messages = { create: async (body, options) => {
      calls.push({ body, options });
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    } };
  }
  return { calls, api: load('server/claude.ts', {
    '@anthropic-ai/sdk': Anthropic,
    './aiHarmonyModelRegistry': { CURRENT_AI_MODELS: { claudeBalanced: 'claude-sonnet-5' } },
  }) };
}
test('Claude sends explicit conversational effort and leaves Harmony in charge of retries', async () => {
  const h = claudeHarness([{ content: [{ type: 'text', text: 'Fixture answer' }],
    stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 4 } }]);
  const controller = new AbortController();
  assert.equal((await h.api.callClaude('Fixture', { providerPolicy: 'legalwhat', effort: 'medium', signal: controller.signal })).content, 'Fixture answer');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.output_config.effort, 'medium');
  assert.equal(h.calls[0].options.maxRetries, 0);
  assert.equal(h.calls[0].options.signal, controller.signal);
  await h.api.callClaude('Complex work');
  assert.equal(h.calls[1].body.output_config, undefined, 'complex/default effort remains unchanged');
  assert.equal(h.calls[1].options.maxRetries, undefined, 'unrelated callers preserve SDK defaults');
});
test('Claude never starts a second generation after exhausting the scoped token budget', async () => {
  const h = claudeHarness([{ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 4, output_tokens: 16 } }]);
  await assert.rejects(h.api.callClaude('Fixture', { providerPolicy: 'legalwhat', maxTokens: 16 }), /stop_reason=max_tokens/);
  assert.equal(h.calls.length, 1);
  const legacy = claudeHarness([
    { content: [], stop_reason: 'max_tokens', usage: { input_tokens: 4, output_tokens: 16 } },
    { content: [{ type: 'text', text: 'Continuation' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 8 } },
  ]);
  assert.equal((await legacy.api.callClaude('Fixture')).content, 'Continuation');
  assert.equal(legacy.calls.length, 2);
});
test('Mistral preserves Retry-After and status without performing a duplicate SDK call', async () => {
  let calls = 0;
  class Mistral {
    chat = { complete: async () => {
      calls++;
      throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429,
        headers: { get: name => name === 'retry-after' ? '600' : '0' } });
    } };
  }
  const api = load('server/mistral.ts', { '@mistralai/mistralai': { Mistral } });
  await assert.rejects(api.callMistral('Fixture'), error => error.status === 429 && error.retryAfterMs === 600000);
  assert.equal(calls, 1);
});
test('Mistral cancellation preserves the caller reason', async () => {
  const controller = new AbortController();
  const reason = new Error('fixture deadline');
  class Mistral { chat = { complete: async () => { controller.abort(reason); throw new Error('SDK abort'); } }; }
  const api = load('server/mistral.ts', { '@mistralai/mistralai': { Mistral } });
  await assert.rejects(api.callMistral('Fixture', { signal: controller.signal }), error => error === reason);
});
function groqHarness(fetch) {
  return load('server/groq.ts', { './rateLimitTracker': { rateLimitTracker: {
    recordGroqError() {}, recordGroqSuccess() {},
  } } }, { fetch });
}
const catalog = { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }] }) };
test('Groq preserves the actual permission rejection when all permitted candidates are exhausted', async () => {
  let calls = 0;
  const api = groqHarness(async url => {
    if (url.endsWith('/models')) return catalog;
    calls++;
    return { ok: false, status: 403, text: async () => 'model_permission_blocked_project' };
  });
  const result = await api.warmGroqModelCatalog();
  assert.equal(result.ready, false);
  assert.match(result.error, /403.*model=.*model_permission_blocked_project/);
  assert.equal(calls, 2);
});
test('Groq recovers from a retired catalog model through another live candidate', async () => {
  let calls = 0;
  const api = groqHarness(async url => {
    if (url.endsWith('/models')) return catalog;
    calls++;
    return calls === 1
      ? { ok: false, status: 404, text: async () => 'model_not_found' }
      : { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 3 } }) };
  });
  const result = await api.warmGroqModelCatalog();
  assert.equal(result.ready, true);
  assert.equal(result.model, 'openai/gpt-oss-20b');
  assert.equal(calls, 2);
});
test('Groq parent cancellation stops catalog lookup and never starts inference', async () => {
  const controller = new AbortController();
  let catalogAborted = false;
  let inferenceCalls = 0;
  const api = groqHarness(async (url, options) => {
    if (!url.endsWith('/models')) { inferenceCalls++; throw new Error('Unexpected inference'); }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => { catalogAborted = true; reject(options.signal.reason); }, { once: true });
      controller.abort(new Error('fixture cancelled'));
    });
  });
  await assert.rejects(api.getGroqClient().chat.completions.create({ model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'Fixture' }], signal: controller.signal }), /fixture cancelled/);
  assert.equal(catalogAborted, true);
  assert.equal(inferenceCalls, 0);
});
(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failures++; console.error('FAIL', name, '-', error.message); }
  }
  console.log(`${tests.length - failures}/${tests.length} adapter checks passed; provider I/O was mocked.`);
  process.exitCode = failures ? 1 : 0;
})();
