// Runs the actual Harmony registry, selector and orchestrator with provider I/O isolated.
// No external provider, production database or server startup is invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const keys = ['GEMINI_API_KEY','ANTHROPIC_API_KEY','GROQ_API_KEY','MISTRAL_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','XAI_API_KEY','CEREBRAS_API_KEY','FIREWORKS_API_KEY','COHERE_API_KEY','TOGETHER_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_API_TOKEN'];
function harness(enabled, { fail = false, warm = true, stall = false, recoveryModels = [], reply } = {}) {
  const env = Object.fromEntries(enabled.map(key => [key, 'fixture-key']));
  const calls = [];
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
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
      return { content: reply ? await reply(call) : 'Supported fixture answer', tokensUsed: 8 };
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
      AbortController, DOMException, setTimeout, clearTimeout, Date: Clock,
      fetch: async (url, options = {}) => {
        const transport = String(url).includes('api.x.ai') ? 'xai'
          : String(url).includes('api.openai.com') ? 'openai'
          : String(url).includes('cerebras') ? 'cerebras'
          : String(url).includes('cloudflare') ? 'cloudflare' : String(url).includes('cohere') ? 'cohere' : 'unknown-http';
        calls.push({ transport, ...(['openai','xai'].includes(transport) ? { request: JSON.parse(options.body), model: JSON.parse(options.body).model, prompt: JSON.parse(options.body).messages?.at(-1)?.content } : {}) });
        const failure = typeof fail === 'function' ? fail(transport, options.body ? JSON.parse(options.body).model : undefined)
          : (fail === true || fail === transport ? 'fixture HTTP failure' : null);
        if (failure) throw new Error(failure);
        return { ok: true, json: async () => transport === 'openai'
          ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Direct OpenAI fixture answer' }] }], usage: { total_tokens: 8 } }
          : transport === 'cohere' ? { message: { content: [{ type: 'text', text: 'Cohere fixture answer' }] } }
          : { choices: [{ message: { content: 'Direct HTTP fixture answer' } }], usage: { total_tokens: 8 } } };
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
  return { registry, engine, attributes, calls, run, env, entry, legalModel, factCheck,
    admission: load('server/legalProviderAdmission.ts'), now: () => clock, advance: ms => { clock += ms; } };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('legal policy has exactly Claude, Gemini and direct xAI Grok', () => {
  const h = harness(keys);
  assert.equal(h.registry.getConfiguredHarmonyProviders().length, 17);
  assert.deepEqual(Array.from(h.registry.getConfiguredHarmonyProviders('legalwhat')).sort(), ['claude','gemini','xai']);
  assert.equal(h.registry.isHarmonyProviderAllowed('grok','legalwhat'), false);
  assert.equal(h.registry.isHarmonyProviderAllowed('groq','legalwhat'), false);
});
test('all direct failures cannot escape through gateway recovery', async () => {
  const h = harness(['GEMINI_API_KEY','OPENROUTER_API_KEY'], { fail: true });
  const result = await h.run(['gemini']);
  assert(!h.calls.some(call => call.transport === 'openrouter'));
  assert.match(result.finalAnswer, /No successful responses/);
});
test('an empty scoped pool cannot reopen excluded configured providers', async () => {
  const h = harness(['COHERE_API_KEY']);
  await assert.rejects(h.run([]), /No providers available/);
  assert.equal(h.calls.length, 0);
});
test('allowed direct fallback survives a provider failure', async () => {
  const h = harness(['GEMINI_API_KEY','XAI_API_KEY','OPENROUTER_API_KEY'], { fail: 'gemini' });
  const result = await h.run(['gemini','xai']);
  assert.equal(result.finalAnswer, 'Direct HTTP fixture answer');
  assert(h.calls.some(call => call.transport === 'xai'));
  assert(!h.calls.some(call => call.transport === 'openrouter'));
});
test('GPT OSS alias cannot duplicate Groq or escape to a paid gateway', async () => {
  const h = harness(['GROQ_API_KEY','OPENROUTER_API_KEY']);
  assert(!h.registry.getConfiguredHarmonyProviders('legalwhat').includes('gpt_oss'));
  await assert.rejects(h.run(['gpt_oss']), /No providers available/);
  assert.equal(h.calls.length, 0);
});
test('removed providers cannot execute even with valid configured keys', async () => {
  const h = harness(keys);
  for (const provider of ['openai','cohere','mistral','cerebras']) {
    const result = await h.engine.executeTask(circuitTask(h, provider), new Map());
    assert.equal(result.success, false); assert.match(result.error, /excluded/);
  }
  assert.equal(h.calls.length, 0);
});
test('Claude is primary for fast legal conversation', async () => {
  const h = harness(keys);
  await h.engine.orchestrateCollaboration('fast-conversation','Facts',
    {...h.attributes, needsFastResponse:true}, ['claude','gemini','groq'],
    {providerPolicy:'legalwhat',maxParticipants:1});
  assert.equal(h.calls[0].transport,'claude');
});
test('legal models use the scoped Claude, Gemini and xAI IDs', () => {
  const h = harness(keys);
  for (const [provider, model] of [['claude','claude-sonnet-5'], ['gemini','gemini-3.8-flash'], ['xai','grok-4.7']]) {
    assert.equal(h.engine.getLegalTaskModel(provider, h.attributes), model);
    assert.equal(h.engine.getLegalTaskModel(provider, {...h.attributes, needsFastResponse:true}), model);
  }
});
test('Cloudflare is no longer an authorized legal transport', async () => {
  const h = harness(['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_API_TOKEN']);
  await assert.rejects(h.run(['cloudflare']), /No providers available/);
  assert.equal(h.calls.length, 0);
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
test('xAI failure uses Gemini without the excluded gateway', async () => {
  const h = harness(['XAI_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY'], { fail: 'xai' });
  const result = await h.engine.executeTask({
    id: 'fixture-scoped-fallback', provider: 'xai', model: 'grok-4.7',
    role: 'legal-analyst', prompt: 'Fixture', priority: 1, attributes: h.attributes,
    providerPolicy: 'legalwhat', fallbackProviders: ['openrouter','cohere','gemini'], maxFallbacks: 1,
  }, new Map());
  assert.equal(result.success, true);
  assert.equal(result.provider, 'gemini');
  assert.deepEqual(h.calls.map(call => call.transport), ['xai','gemini']);
});
test('parent deadline cancels a stalled parallel race without starting fallback', async () => {
  const h = harness(['GEMINI_API_KEY','GROQ_API_KEY','OPENROUTER_API_KEY'], { stall: true });
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort('fixture-parent-deadline'), 40);
  try {
    const result = await h.engine.orchestrateCollaboration(
      'fixture-correction-cancellation', 'Fixture question',
      { ...h.attributes, needsLegalAnalysis: false, needsFastResponse: true },
      ['gemini','groq'],
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
  ['xai', 'xai HTTP 429 Rate limit exceeded'],
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
  const h = harness(['XAI_API_KEY','GEMINI_API_KEY']);
  const result = await h.engine.orchestrateCollaboration(
    'document-generation', 'Draft a demand letter with supplied facts',
    { ...h.attributes, needsFastResponse: false, estimatedTokens: 3000 },
    ['xai','gemini'], { providerPolicy: 'legalwhat', maxParticipants: 2, maxFallbacks: 0 },
  );
  assert.equal(result.finalAnswer, 'Direct HTTP fixture answer');
  assert(h.calls.some(call => /Draft the complete requested legal document/.test(call.prompt)));
  assert(h.calls.some(call => /do not shorten the document/.test(call.prompt)));
});
test('a request-local rejected provider stays skipped independently of warm readiness', async () => {
  const h = harness(keys);
  const result = await h.engine.executeTask(circuitTask(h, 'xai', {
    failedProviders: new Set(['xai']), allowCoolingRecovery: true,
  }), new Map());
  assert.equal(result.provider, 'gemini');
  assert(!h.calls.some(call => call.transport === 'xai'));
});
test('Gemini overload recovers once through a catalog-confirmed alternate', async () => {
  const h = harness(['GEMINI_API_KEY'], {
    recoveryModels: ['gemini-3.8-flash'],
    fail: (_provider, model) => model === 'fixture-primary' ? '503 UNAVAILABLE high demand' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: [] }), new Map());
  assert.equal(result.success, true);
  assert.equal(result.model, 'gemini-3.8-flash');
  assert.deepEqual(h.calls.map(call => call.model), ['fixture-primary', 'gemini-3.8-flash']);
});
test('Gemini overload without a catalog alternate preserves independent fallback', async () => {
  const h = harness(['GEMINI_API_KEY','XAI_API_KEY'], {
    fail: provider => provider === 'gemini' ? '503 UNAVAILABLE' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: ['xai'] }), new Map());
  assert.equal(result.provider, 'xai');
  assert.deepEqual(h.calls.map(call => call.transport), ['gemini','xai']);
});
test('Gemini quota failure does not try a model-capacity alternate', async () => {
  const h = harness(['GEMINI_API_KEY','XAI_API_KEY'], {
    recoveryModels: ['gemini-3.8-flash'],
    fail: provider => provider === 'gemini' ? '429 RESOURCE_EXHAUSTED' : null,
  });
  const result = await h.engine.executeTask(circuitTask(h, 'gemini', { fallbackProviders: ['xai'] }), new Map());
  assert.equal(result.provider, 'xai');
  assert.equal(h.calls.filter(call => call.transport === 'gemini').length, 1);
});
test('xAI model denial uses an independent configured provider', async () => {
  const h = harness(['XAI_API_KEY','GEMINI_API_KEY'], { fail: 'xai' });
  const result = await h.engine.executeTask(circuitTask(h,'xai', { model:'grok-4.7' }), new Map());
  assert.equal(result.provider, 'gemini');
  assert.deepEqual(h.calls.map(x => x.transport), ['xai','gemini']);
});
test('xAI model-specific denial tries the direct older supported model', async () => {
  const h = harness(['XAI_API_KEY'], { fail: (provider,model) =>
    provider === 'xai' && model === 'grok-4.7' ? 'model blocked at project' : null });
  const result = await h.run(['xai']);
  assert.equal(result.finalAnswer,'Direct HTTP fixture answer');
  assert.deepEqual(h.calls.map(call => call.model),['grok-4.7','grok-4.6']);
});
test('xAI quota failure does not retry the same account', async () => {
  const h = harness(['XAI_API_KEY'], { fail: 'xai' });
  await h.run(['xai']);
  assert.equal(h.calls.length, 1);
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
  const h = harness(['COHERE_API_KEY']);
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
  const empty = harness(['COHERE_API_KEY']);
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

test('Claude stays primary when eligible and Gemini supports it', async () => {
  const h = harness(keys);
  for(let i=0;i<3;i++) { await h.run(['claude','gemini','xai']); h.advance(1000); }
  assert(h.calls.every(x=>x.transport==='claude'));
  const chosen=Array.from(h.engine.selectLegalProvidersForTask(h.attributes,['gemini','claude','xai'],2));
  assert.equal(chosen[0],'claude'); assert.equal(chosen.length,2);
});
test('Claude alone remains a working legal primary', async () => {
  const h=harness(['ANTHROPIC_API_KEY']);
  const result=await h.run(['claude']);
  assert.equal(result.finalAnswer,'Supported fixture answer');
  assert.equal(h.calls[0].transport,'claude');
});
test('explicit exceptional review can use Claude Sonnet', async () => {
  const h = harness(['ANTHROPIC_API_KEY']);
  const result = await h.engine.orchestrateCollaboration('exception-review', 'Review disputed reasoning',
    h.attributes, ['claude'], { providerPolicy: 'legalwhat', legalReviewReason: 'difficult-review',
      maxParticipants: 1, maxFallbacks: 0 });
  assert(result.contributions.some(x => x.success));
  assert.equal(h.calls[0].model, 'claude-sonnet-5');
});
test('Claude synthesis does not invoke a redundant exceptional review', async () => {
  const h = harness(['ANTHROPIC_API_KEY','GEMINI_API_KEY','GROQ_API_KEY'], {
    reply: call => call.transport === 'claude' ? 'Reviewed answer with uncertainty'
      : /Synthesize/.test(call.prompt) ? '[LEGAL_REVIEW_REQUIRED] Material conflict remains.' : 'Independent analysis',
  });
  const result = await h.engine.orchestrateCollaboration('legal-reasoning', 'Resolve this issue',
    h.attributes, ['gemini','groq','claude'], { providerPolicy: 'legalwhat', maxParticipants: 2 });
  assert.equal(result.finalAnswer, 'Reviewed answer with uncertainty');
  assert.equal(h.calls.filter(x => x.transport === 'claude').length, 2);
});
test('drafting overrides a caller fast flag and uses the full drafting path', async () => {
  const h = harness(['GEMINI_API_KEY','XAI_API_KEY']);
  await h.engine.orchestrateCollaboration('document-drafting', 'Draft the supplied facts',
    { ...h.attributes, needsFastResponse: true }, ['gemini','xai'],
    { providerPolicy: 'legalwhat', maxParticipants: 2 });
  assert(h.calls.some(x => x.model === 'gemini-3.8-flash'));
  assert(h.calls.some(x => /do not shorten the document/.test(x.prompt)));
});
test('independent legal analyses actually overlap', async () => {
  let active = 0, peak = 0;
  const h = harness(['GEMINI_API_KEY','ANTHROPIC_API_KEY'], { reply: async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 20)); active--; return 'Independent answer';
  } });
  await h.engine.orchestrateCollaboration('legal-analysis', 'Facts', h.attributes,
    ['gemini','claude'], { providerPolicy: 'legalwhat', maxParticipants: 2 });
  assert.equal(peak, 2);
});
test('atomic admission prevents concurrent transport duplication', async () => {
  const h = harness(keys), a = h.admission;
  const leases = await Promise.all(Array.from({ length: 20 }, () => a.reserveLegalProvider('groq','model',100,'Facts')));
  assert.equal(leases.filter(Boolean).length, 1);
  await a.releaseLegalProvider(leases.find(Boolean));
  assert(await a.reserveLegalProvider('groq','model',100,'Facts'));
});
test('Sonnet and Opus share the same account reservation', async () => {
  const h = harness(keys), a = h.admission;
  const lease = await a.reserveLegalProvider('claude','model',100,'Facts');
  assert(lease);
  assert.equal(await a.reserveLegalProvider('claude_opus','model',100,'Facts'), null);
  await a.releaseLegalProvider(lease);
});
test('Claude has no artificial daily request cap', async () => {
  const h = harness(keys), a = h.admission;
  for (let i = 0; i < 30; i++) {
    const lease = await a.reserveLegalProvider('claude','model',100,'Facts');
    assert(lease, 'request ' + i); await a.releaseLegalProvider(lease);
  }
});
test('actual configured sliding allowance rejects overspend without partial reservation', async () => {
  const h = harness(keys), a = h.admission;
  h.env.LEXARA_GROQ_RPM = '2'; h.env.LEXARA_GROQ_TPM = '250';
  let lease = await a.reserveLegalProvider('groq','model',100,'Facts');
  assert(lease); await a.releaseLegalProvider(lease);
  assert.equal(await a.reserveLegalProvider('groq','model',200,'Facts'), null);
  lease = await a.reserveLegalProvider('groq','model',100,'Facts');
  assert(lease); await a.releaseLegalProvider(lease);
  assert.equal(await a.reserveLegalProvider('groq','model',1,''), null);
  h.advance(60001);
  assert(await a.reserveLegalProvider('groq','model',100,'Facts'));
});
test('Retry-After pauses the whole account and cancellation does not extend it', async () => {
  const h = harness(keys), a = h.admission;
  await a.noteLegalProviderError('claude','model', Object.assign(new Error('429 rate limit'), { headers: { 'retry-after': '120' } }));
  assert.equal(a.canUseLegalProvider('claude_opus','different'), false);
  h.advance(61000);
  assert.equal(a.canUseLegalProvider('claude','model'), false);
  await a.noteLegalProviderError('claude','model', new Error('Superseded generation'));
  h.advance(60000);
  assert.equal(a.canUseLegalProvider('claude','model'), true);
});
test('actual remaining-token headers reserve output before dispatch', async () => {
  const h = harness(keys), a = h.admission;
  await a.noteLegalProviderHeaders('groq', { 'x-ratelimit-remaining-tokens': '100', 'x-ratelimit-reset-tokens': '2m' });
  assert.equal(await a.reserveLegalProvider('groq','model',101,''), null);
  const lease = await a.reserveLegalProvider('groq','model',80,'');
  assert(lease); await a.releaseLegalProvider(lease);
  assert.equal(await a.reserveLegalProvider('groq','model',21,''), null);
  h.advance(120001);
  assert(await a.reserveLegalProvider('groq','model',101,''));
});
test('legacy model catalog entries cannot reenter legal recovery', async () => {
  const h = harness(['GEMINI_API_KEY','XAI_API_KEY'], {
    recoveryModels: ['gemini-2.5-flash'],
    fail: provider => provider === 'gemini' ? '503 UNAVAILABLE' : null,
  });
  await h.engine.executeTask(circuitTask(h,'gemini',{ fallbackProviders: ['groq'] }), new Map());
  assert(!h.calls.some(x => x.model === 'gemini-2.5-flash'));
});

test('DeepSeek and Kimi share quota and cannot double-spend one account', async () => {
  const h = harness(keys), a = h.admission;
  const lease = await a.reserveLegalProvider('deepseek','model',100,'Facts');
  assert(lease);
  assert.equal(await a.reserveLegalProvider('kimi','model',100,'Facts'),null);
  await a.releaseLegalProvider(lease);
  await a.noteLegalProviderError('deepseek','model',new Error('402 insufficient credits'));
  assert.equal(a.canUseLegalProvider('kimi','model'),false);
});
test('support failure prefers Claude before another support provider', async () => {
  const h = harness(keys,{fail:'gemini'});
  const result = await h.engine.executeTask(circuitTask(h,'gemini',{
    fallbackProviders:['groq','claude','deepseek'],maxFallbacks:1,
  }),new Map());
  assert.equal(result.provider,'claude'); assert.equal(result.success,true);
});
test('a slow failed primary leaves a full fallback attempt window', async () => {
  const h = harness(keys, { fail: provider => {
    if(provider==='claude') { h.advance(95); return 'fixture failure'; }
    return null;
  } });
  const seen=[]; const execute=h.engine.executeTask;
  h.engine.executeTask=function(task,completed) {
    seen.push({provider:task.provider,remaining:task.deadlineAt-h.now()});
    return execute.call(this,task,completed);
  };
  const result=await h.run(['claude','gemini']);
  assert.equal(result.finalAnswer,'Supported fixture answer');
  assert(h.calls.some(call=>call.transport==='gemini'));
  assert(seen.find(item=>item.provider==='gemini').remaining >= 100, 'fallback receives a full 100ms fixture window');
});
test('excluded OpenRouter specialists cannot enter the legal lane', async () => {
  for (const provider of ['deepseek','kimi']) {
    const h = harness(['OPENROUTER_API_KEY']);
    await assert.rejects(h.run([provider]), /No providers available/);
    assert.equal(h.calls.length, 0);
  }
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failures++; console.error('FAIL', name, '-', error.message); }
  }
  console.log(`${tests.length - failures}/${tests.length} scoped behavior checks passed; provider I/O was mocked.`);
  process.exitCode = failures ? 1 : 0;
})();
