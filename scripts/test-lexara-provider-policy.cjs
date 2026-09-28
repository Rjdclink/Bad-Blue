// Runs the actual Harmony registry, selector and orchestrator with provider I/O isolated.
// No external provider, production database or server startup is invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const keys = ['GEMINI_API_KEY','ANTHROPIC_API_KEY','GROQ_API_KEY','MISTRAL_API_KEY','OPENROUTER_API_KEY','XAI_API_KEY','CEREBRAS_API_KEY','FIREWORKS_API_KEY','COHERE_API_KEY','TOGETHER_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_API_TOKEN'];
function harness(enabled, { fail = false, warm = true, stall = false, recoveryModels = [] } = {}) {
  const env = Object.fromEntries(enabled.map(key => [key, 'fixture-key']));
  const calls = [];
  const cache = new Map();
  const enumSource = fs.readFileSync(path.join(root, 'server/aiTokenGovernor.ts'), 'utf8')
    .match(/export enum (?:AIProvider|UsageContext|TaskPriority|TaskComplexity)\s*\{[^}]+\}/g).join('\n');
  const governor = {};
  vm.runInNewContext(ts.transpileModule(enumSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: governor });
  const stubs = {
    'server/aiTokenGovernor.ts': governor,
    'server/aiHarmonyWarmup.ts': {
      getHarmonyResolvedModel: provider => load('server/aiHarmonyModelRegistry.ts').getCurrentModelForProvider(provider),
      getHarmonyWarmState: () => warm ? 'ready' : 'catalog',
      getHarmonyRecoveryModels: () => recoveryModels,
      isHarmonyProviderWarmHealthy: () => warm,
      markHarmonyProviderWarmSuccess: () => {},
    },
    'server/aiProvider.ts': { runProvider: async (provider, prompt, options) => {
      const call = { transport: provider, model: options.model, prompt };
      calls.push(call);
      if (stall) {
        assert(options.signal, 'stalled provider must receive the linked cancellation signal');
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            call.aborted = true;
            call.abortReason = options.signal.reason;
            reject(new DOMException('Fixture provider cancelled', 'AbortError'));
          };
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      const failure = typeof fail === 'function' ? fail(provider, options.model)
        : (fail === true || fail === provider ? 'fixture provider failure' : null);
      if (failure) throw new Error(failure);
      return { content: 'Supported fixture answer', tokensUsed: 8 };
    } },
    'server/openRouterService.ts': { generateOpenRouterText: async (_prompt, options) => {
      calls.push({ transport: 'openrouter', model: options.model });
      return { content: 'Gateway fixture answer', model: options.model, latencyMs: 1 };
    } },
  };
  function load(relative) {
    if (stubs[relative]) return stubs[relative];
    if (cache.has(relative)) return cache.get(relative).exports;
    const filename = path.join(root, relative);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} };
    cache.set(relative, module);
    const requireLocal = spec => {
      if (!spec.startsWith('.')) throw new Error('Unexpected external dependency: ' + spec);
      let next = path.relative(root, path.resolve(path.dirname(filename), spec));
      if (!next.endsWith('.ts')) next += '.ts';
      return load(next);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled.outputText}\n})`, {
      process: { env }, console: { info() {}, warn() {}, log() {}, error() {} },
      AbortController, DOMException, setTimeout, clearTimeout,
      fetch: async url => {
        const transport = String(url).includes('cerebras') ? 'cerebras'
          : String(url).includes('cloudflare') ? 'cloudflare' : 'unknown-http';
        calls.push({ transport });
        const failure = typeof fail === 'function' ? fail(transport)
          : (fail === true || fail === transport ? 'fixture HTTP failure' : null);
        if (failure) throw new Error(failure);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Direct HTTP fixture answer' } }], usage: { total_tokens: 8 } }) };
      },
    }, { filename })(requireLocal, module, module.exports);
    return module.exports;
  }
  const registry = load('server/aiHarmonyModelRegistry.ts');
  const { AICollaborationOrchestrator: engine } = load('server/aiCollaborationOrchestrator.ts');
  const attributes = { context: 'user', complexity: 'comprehensive', priority: 'critical', needsLegalAnalysis: true, needsReasoning: true, estimatedTokens: 150 };
  const run = (pool, policy = 'legalwhat') => engine.orchestrateCollaboration('fixture-legal-reasoning', 'Fixture question', attributes, pool, {
    providerPolicy: policy, maxParticipants: 1, maxFallbacks: 1, requestTimeoutMs: 100,
  });
  function entry(result = { finalAnswer: 'Fixture entry answer', providersUsed: ['gemini'], totalTokens: 8 }) {
    delete stubs['server/aiProvider.ts'];
    stubs['server/aiCollaborationOrchestrator.ts'] = { AICollaborationOrchestrator: { orchestrateCollaboration: async (...args) => {
      calls.push({ task: args[0], pool: Array.from(args[3]), policy: args[4]?.providerPolicy });
      return result;
    } } };
    governor.aiTokenGovernor = { getBudgetForTask: async () => ({ verbosityLevel: 'normal', maxTokens: 150 }) };
    stubs['server/groq.ts'] = { getGroqClient() { throw new Error('Unexpected direct SDK use'); } };
    stubs['server/mistral.ts'] = { callMistral() { throw new Error('Unexpected direct SDK use'); } };
    stubs['server/claude.ts'] = { callClaude() { throw new Error('Unexpected direct SDK use'); } };
    stubs['server/gemini.ts'] = { callGemini() { throw new Error('Unexpected direct SDK use'); } };
    stubs['server/zeroApiIntelligence.ts'] = {
      generateZeroApiResponse: async () => ({ content: 'Existing local fallback' }),
      shouldUseZeroApiMode: () => false, getZeroApiStatus: () => ({}),
    };
    return load('server/aiProvider.ts');
  }
  function legalModel(result) {
    entry(result);
    stubs['server/logger.ts'] = { createLogger: () => ({ info() {}, warn() {}, error() {} }) };
    stubs['server/services/mlnlp.ts'] = { routeTask: async () => ({ decision: { shouldParallelize: false, primaryModel: 'fixture', reasoning: 'fixture', confidence: 1 } }) };
    return load('server/legalModelOrchestrator.ts');
  }
  function factCheck(result) {
    entry(result);
    return load('server/services/factCheckEngine.ts');
  }
  return { registry, engine, attributes, calls, run, env, entry, legalModel, factCheck };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('scoped registry excludes gateway aliases and retains independent providers', () => {
  const h = harness(keys);
  assert.equal(h.registry.getConfiguredHarmonyProviders().length, 17, 'global mesh preserved');
  const scoped = Array.from(h.registry.getConfiguredHarmonyProviders('legalwhat'));
  for (const banned of ['openrouter','deepseek','grok','kimi','qwen','gpt5_mini','gpt_oss','xai','cerebras','fireworks','together']) assert(!scoped.includes(banned), banned);
  for (const retained of ['gemini','claude','claude_opus','groq','mistral','cohere','cloudflare']) assert(scoped.includes(retained), retained);
});
test('all direct failures cannot escape through gateway recovery', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY'], { fail: true });
  const result = await h.run(['gemini']);
  assert(!h.calls.some(call => call.transport === 'openrouter'));
  assert.match(result.finalAnswer, /No successful responses/);
});
test('an empty scoped pool cannot reopen excluded configured providers', async () => {
  const h = harness(['OPENROUTER_API_KEY']);
  await assert.rejects(h.run([]), /No providers available/);
  assert.equal(h.calls.length, 0);
});
test('allowed direct fallback survives a provider failure', async () => {
  const h = harness(['GEMINI_API_KEY','MISTRAL_API_KEY','OPENROUTER_API_KEY'], { fail: 'gemini' });
  const result = await h.run(['gemini','mistral']);
  assert.equal(result.finalAnswer, 'Supported fixture answer');
  assert(h.calls.some(call => call.transport === 'mistral'));
  assert(!h.calls.some(call => call.transport === 'openrouter'));
});
test('GPT OSS alias cannot duplicate Groq or escape to a paid gateway', async () => {
  const h = harness(['GROQ_API_KEY','OPENROUTER_API_KEY']);
  assert(!h.registry.getConfiguredHarmonyProviders('legalwhat').includes('gpt_oss'));
  const result = await h.run(['gpt_oss']);
  assert.match(result.finalAnswer, /No successful responses/);
  assert.equal(h.calls.length, 0);
});
test('Cloudflare is an independent direct fallback when configured', async () => {
  const h = harness(['GEMINI_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_API_TOKEN'], { fail: 'gemini' });
  const result = await h.run(['gemini','cloudflare']);
  assert.equal(result.finalAnswer, 'Direct HTTP fixture answer');
  assert(h.calls.some(call => call.transport === 'cloudflare'));
});
test('global policy retains existing gateway participant and recovery behavior', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY'], { fail: true });
  const result = await h.run(['gemini'], 'capability-first');
  assert.equal(result.finalAnswer, 'Gateway fixture answer');
  assert(h.calls.some(call => call.transport === 'openrouter'));
});
test('execution guard rejects excluded task and fallback transports', async () => {
  const h = harness(keys);
  const result = await h.engine.executeTask({
    id: 'fixture-direct-dispatch', provider: 'openrouter', model: 'openrouter/auto', role: 'legal-analyst',
    prompt: 'Fixture', priority: 1, attributes: h.attributes, providerPolicy: 'legalwhat',
    fallbackProviders: ['deepseek','gemini'], maxFallbacks: 1,
  }, new Map());
  assert.equal(result.success, false);
  assert.match(result.error, /excluded/);
  assert.equal(h.calls.length, 0);
});
test('allowed primary failure skips excluded fallbacks and preserves direct recovery', async () => {
  const h = harness(['MISTRAL_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY'], { fail: 'mistral' });
  const result = await h.engine.executeTask({
    id: 'fixture-scoped-fallback', provider: 'mistral', model: h.registry.CURRENT_AI_MODELS.mistralFast,
    role: 'legal-analyst', prompt: 'Fixture', priority: 1, attributes: h.attributes,
    providerPolicy: 'legalwhat', fallbackProviders: ['openrouter','deepseek','gemini'], maxFallbacks: 1,
  }, new Map());
  assert.equal(result.success, true);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.content, 'Supported fixture answer');
  assert.deepEqual(h.calls.map(call => call.transport), ['mistral','gemini']);
});
test('parent deadline cancels a stalled parallel race without starting fallback', async () => {
  const h = harness(['GEMINI_API_KEY','MISTRAL_API_KEY','OPENROUTER_API_KEY'], { stall: true });
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort('fixture-parent-deadline'), 40);
  try {
    const result = await h.engine.orchestrateCollaboration(
      'fixture-correction-cancellation', 'Fixture question',
      { ...h.attributes, needsLegalAnalysis: false, needsFastResponse: true },
      ['gemini','mistral'],
      { providerPolicy: 'legalwhat', maxParticipants: 1, maxFallbacks: 3,
        requestTimeoutMs: 5000, signal: controller.signal },
    );
    assert(Date.now() - startedAt < 1000, 'parent cancellation must beat the five-second task deadline');
    assert.match(result.finalAnswer, /^No successful responses from collaboration\.?$/);
    assert.equal(h.calls.length, 1, 'no fallback or gateway request may start after parent cancellation');
    assert.equal(h.calls[0].aborted, true, 'the active provider must observe cancellation');
    assert.equal(h.calls[0].abortReason, 'fixture-parent-deadline');
  } finally {
    clearTimeout(timer);
    controller.abort('fixture-cleanup');
  }
});
for (const [policy, legalTimeout, raceTimeout] of [['legalwhat', 2500, 2500], ['capability-first', 1400, 5000]]) {
  test(`${policy} preserves the intended caller/strategy timeout precedence`, async () => {
    const h = harness(['GEMINI_API_KEY']);
    const observed = [];
    const execute = h.engine.executeTask;
    h.engine.executeTask = function(task, completed) {
      observed.push(task.requestTimeoutMs);
      return execute.call(this, task, completed);
    };
    await h.engine.orchestrateCollaboration('fixture-legal-budget', 'Fixture',
      { ...h.attributes, needsFastResponse: true }, ['gemini'],
      { providerPolicy: policy, maxParticipants: 1, maxFallbacks: 0, requestTimeoutMs: 2500 });
    assert(observed.length > 0);
    assert(observed.every(timeout => timeout === legalTimeout), `legal task budgets: ${observed}`);
    observed.length = 0;
    await h.engine.orchestrateCollaboration('fixture-correction-budget', 'Fixture',
      { ...h.attributes, needsLegalAnalysis: false, needsReasoning: false, needsFastResponse: true }, ['gemini'],
      { providerPolicy: policy, maxParticipants: 1, maxFallbacks: 0, requestTimeoutMs: 2500 });
    assert(observed.length > 0);
    assert(observed.every(timeout => timeout === raceTimeout), `race task budgets: ${observed}`);
  });
}

function circuitTask(h, provider, overrides = {}) {
  return { id: 'fixture-runtime-circuit', provider, model: 'fixture-primary', role: 'legal-analyst',
    prompt: 'Fixture', priority: 1, attributes: h.attributes, providerPolicy: 'legalwhat',
    fallbackProviders: ['gemini'], maxFallbacks: 1, requestTimeoutMs: 100,
    failedProviders: new Set(), ...overrides };
}
for (const [provider, failure] of [
  ['cloudflare', 'cloudflare HTTP 402 Payment required'],
  ['mistral', 'Mistral API error Status 429 Rate limit exceeded'],
  ['groq', 'No permitted capability-compatible Groq model is currently available'],
  ['claude', 'claude timed out after 6000ms'],
]) {
  test(provider + ' runtime circuit cannot be bypassed by legal recovery', async () => {
    const h = harness(keys, { fail: p => p === provider ? failure : null });
    const first = await h.engine.executeTask(circuitTask(h, provider), new Map());
    const second = await h.engine.executeTask(circuitTask(h, provider, { allowCoolingRecovery: true }), new Map());
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.provider, 'gemini');
    assert.equal(h.calls.filter(call => call.transport === provider).length, 1);
  });
}
test('document routing requests a complete draft and full document synthesis', async () => {
  const h = harness(['ANTHROPIC_API_KEY','GEMINI_API_KEY']);
  const result = await h.engine.orchestrateCollaboration(
    'document-generation', 'Draft a demand letter with supplied facts',
    { ...h.attributes, needsFastResponse: false, estimatedTokens: 3000 },
    ['claude','gemini'], { providerPolicy: 'legalwhat', maxParticipants: 2, maxFallbacks: 0 },
  );
  assert.equal(result.finalAnswer, 'Supported fixture answer');
  assert(h.calls.some(call => /Draft the complete requested legal document/.test(call.prompt)));
  assert(h.calls.some(call => /do not shorten the document/.test(call.prompt)));
});
test('a request-local rejected provider stays skipped independently of warm readiness', async () => {
  const h = harness(keys);
  const result = await h.engine.executeTask(circuitTask(h, 'mistral', {
    failedProviders: new Set(['mistral']), allowCoolingRecovery: true,
  }), new Map());
  assert.equal(result.provider, 'gemini');
  assert(!h.calls.some(call => call.transport === 'mistral'));
});
test('Gemini overload recovers once through a catalog-confirmed alternate', async () => {
  const h = harness(['GEMINI_API_KEY'], {
    recoveryModels: ['fixture-alternate-flash'],
    fail: (_provider, model) => model === 'fixture-primary' ? '503 UNAVAILABLE high demand' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: [] }), new Map());
  assert.equal(result.success, true);
  assert.equal(result.model, 'fixture-alternate-flash');
  assert.deepEqual(h.calls.map(call => call.model), ['fixture-primary', 'fixture-alternate-flash']);
});
test('Gemini overload without a catalog alternate preserves independent fallback', async () => {
  const h = harness(['GEMINI_API_KEY','MISTRAL_API_KEY'], {
    fail: provider => provider === 'gemini' ? '503 UNAVAILABLE' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: ['mistral'] }), new Map());
  assert.equal(result.provider, 'mistral');
  assert.deepEqual(h.calls.map(call => call.transport), ['gemini','mistral']);
});
test('Gemini quota failure does not try a model-capacity alternate', async () => {
  const h = harness(['GEMINI_API_KEY','MISTRAL_API_KEY'], {
    recoveryModels: ['fixture-alternate-flash'],
    fail: provider => provider === 'gemini' ? '429 RESOURCE_EXHAUSTED' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: ['mistral'] }), new Map());
  assert.equal(result.provider, 'mistral');
  assert.equal(h.calls.filter(call => call.transport === 'gemini').length, 1);
});

const scopedCallerCounts = {
  'server/legalAI.ts': 17,
  'server/consultationCoordinator.ts': 3,
  'server/legalConsultationEngine.ts': 7,
  'server/documentCreatorAI.ts': 3,
  'server/legalModelOrchestrator.ts': 5,
  'server/factCheckingEngine.ts': 1,
  'server/evidenceIntelligenceTool.ts': 6,
  'server/fmiIntelligenceTool.ts': 2,
  'server/universalDocumentGenerator.ts': 1,
  'server/complaintDraftingSystem.ts': 1,
  'server/enhancedLegalSearch.ts': 1,
  'server/services/legalIntelligence/semanticExtractor.ts': 1,
  'server/services/legalIntelligence/extractors/precedentExtractor.ts': 1,
  'server/services/4ji-orchestrator/legalwhat-orchestrator.ts': 3,
};
for (const [relative, expected] of Object.entries(scopedCallerCounts)) {
  test(`${relative} keeps every legal generation call on the scoped policy`, () => {
    const file = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    let count = 0;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'generateUserText') {
        count++;
        const options = node.arguments[2];
        assert(options && ts.isObjectLiteralExpression(options), `${relative}: explicit options required`);
        assert(options.properties.some(prop => ts.isPropertyAssignment(prop)
          && prop.name.getText(file) === 'providerPolicy' && prop.initializer.getText(file) === "'legalwhat'"),
          `${relative}: generation call ${count} must retain legal routing`);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(count, expected, 'established reasoning and drafting callers remain present');
  });
}
test('legal consensus uses the scoped registry and the same Harmony authority', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY']);
  const module = h.legalModel({ finalAnswer: 'Fixture consensus', providersUsed: ['gemini'], totalTokens: 8,
    contributions: [{ role: 'legal-analyst', model: 'fixture', success: true, content: 'Fixture consensus' }] });
  const result = await module.executeWithConsensus({ ...h.attributes, legalTaskType: 'legal-reasoning' }, 'Fixture');
  assert.equal(result.result, 'Fixture consensus');
  assert.equal(h.calls[0].policy, 'legalwhat');
  assert.deepEqual(h.calls[0].pool, ['gemini']);
});
test('legal consensus with only excluded credentials retains providerless handling', async () => {
  const h = harness(['OPENROUTER_API_KEY']);
  const result = await h.legalModel().executeWithConsensus({ ...h.attributes, legalTaskType: 'legal-reasoning' }, 'Fixture');
  assert.equal(result.result, 'Existing local fallback');
  assert.equal(result.recommendation, 'needs-review');
  assert.equal(h.calls.length, 0);
});
test('legal advisory metadata never recommends an excluded route', () => {
  const h = harness(['OPENROUTER_API_KEY']);
  const selection = h.legalModel().selectModelsForTask('legal-reasoning', 100, 3);
  const allowedModels = h.registry.HARMONY_17_PARTICIPANTS
    .filter(p => h.registry.isHarmonyProviderAllowed(p.provider, 'legalwhat')).map(p => p.model);
  for (const model of [selection.primary, ...selection.fallback]) assert(allowedModels.includes(model), model);
});
test('fact-checking uses scoped legal consensus and preserves providerless uncertainty', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY']);
  const result = await h.factCheck({ finalAnswer: '', providersUsed: ['gemini'], totalTokens: 8,
    contributions: [{ role: 'legal-analyst', model: 'fixture', success: true,
      content: JSON.stringify({ verified: false, reasoning: 'Fixture claim is unsupported', sources: [] }) }] })
    .factCheckClaim({ claim: 'Fixture', context: { lawType: 'family', state: 'Iowa' } });
  assert.equal(result.verified, false);
  assert.equal(h.calls[0].policy, 'legalwhat');
  assert.deepEqual(h.calls[0].pool, ['gemini']);
  const empty = harness(['OPENROUTER_API_KEY']);
  const unavailable = await empty.factCheck().factCheckClaim({ claim: 'Fixture', context: { lawType: 'family', state: 'Iowa' } });
  assert.equal(unavailable.verified, false);
  assert.equal(unavailable.confidence, 0);
  assert.equal(empty.calls.length, 0);
});
test('unified legal-analysis helper passes the policy and excludes the gateway pool', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY']);
  assert.equal(await h.entry().generateLegalAnalysis('fixture', 'Fixture legal question'), 'Fixture entry answer');
  assert.equal(h.calls[0].policy, 'legalwhat');
  assert.deepEqual(h.calls[0].pool, ['gemini']);
});
test('scoped exhausted reasoning preserves and truthfully labels the existing local fallback', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY']);
  const entry = h.entry({ finalAnswer: 'No successful responses from collaboration.', providersUsed: [], totalTokens: 0 });
  const response = await entry.generateUserText('legal-fixture', 'Fixture', { providerPolicy: 'legalwhat' });
  assert.equal(response.content, 'Existing local fallback');
  assert.equal(response.provider, 'lmai');
});
test('unscoped generation retains its previous default policy and participant pool', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY']);
  await h.entry().generateUserText('unscoped-fixture', 'Fixture');
  assert.equal(h.calls[0].policy, 'capability-first');
  assert(h.calls[0].pool.includes('openrouter'));
});
// Exercise the real Claude adapter against an isolated SDK constructor so key
// readiness and inference cannot silently disagree when only the alias is set.
for (const [name, env, expectedKey] of [
  ['canonical key takes precedence', { ANTHROPIC_API_KEY: ' canonical ', CLAUDE_API_KEY: 'alias' }, 'canonical'],
  ['alias-only configuration reaches inference', { CLAUDE_API_KEY: ' alias ' }, 'alias'],
  ['blank canonical key falls through to alias', { ANTHROPIC_API_KEY: ' ', CLAUDE_API_KEY: ' alias ' }, 'alias'],
  ['blank credentials stay unavailable', { ANTHROPIC_API_KEY: ' ', CLAUDE_API_KEY: ' ' }, null],
]) {
  test(`Claude credential consistency: ${name}`, async () => {
    const constructedKeys = [];
    class FixtureAnthropic {
      constructor(options) {
        constructedKeys.push(options.apiKey);
        this.messages = { create: async () => ({
          content: [{ type: 'text', text: 'Fixture Claude answer' }],
          stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 },
        }) };
      }
    }
    const source = fs.readFileSync(path.join(root, 'server/claude.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const module = { exports: {} };
    const requireFixture = spec => {
      if (spec === '@anthropic-ai/sdk') return FixtureAnthropic;
      if (spec === './aiHarmonyModelRegistry') return { CURRENT_AI_MODELS: { claudeBalanced: 'fixture-model' } };
      throw new Error('Unexpected Claude dependency: ' + spec);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
      process: { env }, console: { error() {} }, DOMException,
    })(requireFixture, module, module.exports);
    assert.equal(module.exports.isClaudeAvailable(), expectedKey !== null);
    if (expectedKey === null) {
      await assert.rejects(module.exports.callClaude('Fixture'), /key|environment/i);
      assert.equal(constructedKeys.length, 0);
    } else {
      const result = await module.exports.callClaude('Fixture');
      assert.equal(result.content, 'Fixture Claude answer');
      assert.deepEqual(constructedKeys, [expectedKey]);
    }
  });
}
(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failures++; console.error('FAIL', name, '-', error.message); }
  }
  console.log(`${tests.length - failures}/${tests.length} scoped behavior checks passed; provider I/O was mocked.`);
  process.exitCode = failures ? 1 : 0;
})();
