const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function compile(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: relative,
  }).outputText;
}

function execute(relative, requireMap = {}) {
  const module = { exports: {} };
  const compiled = compile(relative);
  const localRequire = spec => {
    if (Object.prototype.hasOwnProperty.call(requireMap, spec)) return requireMap[spec];
    throw new Error(`Unexpected dependency from ${relative}: ${spec}`);
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    console, URL, process: { env: {} }, setTimeout, clearTimeout, AbortController,
  }, { filename: relative })(localRequire, module, module.exports);
  return module.exports;
}

const subject = execute('server/lexara/LexaraBackgroundSubject.ts');
const planner = execute('server/lexara/LexaraResearchIntentRouter.ts', {
  './LexaraBackgroundSubject': subject,
});

let claudeCalls = 0;
const claude = {
  async callClaude(prompt) {
    claudeCalls += 1;
    const current = String(prompt).split('CURRENT TURN:\n').pop().trim();
    let payload;
    if (current === 'Tell me about Avery Morgan Example.') {
      payload = {
        needed: true,
        intent: 'factual',
        requestedFact: 'general-public-record',
        subject: 'Avery Morgan Example',
        objective: 'Find the background facts requested about Avery Morgan Example.',
      };
    } else if (current === 'Avery Morgan Example is employed.') {
      payload = {
        needed: true,
        intent: 'factual',
        requestedFact: 'employment',
        subject: 'Avery Morgan Example',
        objective: 'Determine whether Avery Morgan Example is currently employed.',
      };
    } else if (current === 'Tell me more about her.') {
      payload = {
        needed: true,
        intent: 'factual',
        requestedFact: 'general-public-record',
        subject: 'Avery Morgan Example',
        objective: 'Continue the requested background research about Avery Morgan Example.',
      };
    } else if (current.includes('officer who arrested me')) {
      payload = {
        needed: true,
        intent: 'mixed',
        requestedFact: 'sanctions-discipline',
        subject: 'the officer who arrested me',
        objective: 'Verify the officer employment or misconduct fact relevant to the suppression issue.',
      };
    } else {
      payload = {
        needed: false,
        intent: current.includes('divorce') ? 'legal' : 'conversation',
        requestedFact: 'none',
        subject: '',
        objective: '',
      };
    }
    return { content: JSON.stringify(payload), tokensUsed: 20 };
  },
};

const router = execute('server/lexara/LexaraSequenceRouter.ts', {
  './LexaraResearchIntentRouter': planner,
});

const semantic = execute('server/lexara/LexaraSemanticIntentInterpreter.ts', {
  '../claude': claude,
  '../aiHarmonyModelRegistry': { CURRENT_AI_MODELS: { claudeFast: 'fixture-haiku' } },
  './LexaraBackgroundSubject': subject,
  './LexaraResearchIntentRouter': planner,
});

(async () => {
  let before = claudeCalls;
  const broad = await semantic.resolveLexaraResearchDecisionSemantic('Tell me about Avery Morgan Example.', []);
  assert.equal(claudeCalls, before + 1, 'broad natural-language background request uses semantic inference');
  assert.equal(broad.needed, true);
  assert.equal(broad.intent, 'factual');
  assert.equal(broad.requestedFact, 'general-public-record');
  assert.equal(broad.subject, 'Avery Morgan Example');
  assert.equal(broad.inferred, true);
  const broadPlan = router.planLexaraSequence('Tell me about Avery Morgan Example.', [], broad);
  assert.equal(broadPlan.sequence, 'lexara-background');
  assert.equal(broadPlan.useLegalResearch, false, 'pure factual background research should not invoke the legal-authority lane');
  assert.equal(broadPlan.useBackgroundResearch, true, 'Lexara-owned background research is active while Pantheon stays disconnected');

  before = claudeCalls;
  const statement = await semantic.resolveLexaraResearchDecisionSemantic('Avery Morgan Example is employed.', []);
  assert.equal(claudeCalls, before + 1, 'background statement does not require question syntax or magic search words');
  assert.equal(statement.intent, 'factual');
  assert.equal(statement.requestedFact, 'employment');

  before = claudeCalls;
  const contextual = await semantic.resolveLexaraResearchDecisionSemantic(
    'Tell me more about her.',
    ['We were talking about Avery Morgan Example.'],
    undefined,
    'USER: We were talking about Avery Morgan Example.\nLEXARA: I can focus on whatever specific background fact you want.',
  );
  assert.equal(claudeCalls, before + 1);
  assert.equal(contextual.intent, 'factual');
  assert.equal(contextual.subject, 'Avery Morgan Example');

  before = claudeCalls;
  const known = await semantic.resolveLexaraResearchDecisionSemantic('Where does Avery Example work?', []);
  assert.equal(claudeCalls, before, 'existing deterministic factual fast path remains zero-extra-call');
  assert.equal(known.intent, 'factual');
  assert.equal(known.requestedFact, 'employment');

  before = claudeCalls;
  const pureLegal = await semantic.resolveLexaraResearchDecisionSemantic('How do I file for divorce in Iowa?', []);
  assert.equal(claudeCalls, before + 1, 'semantic layer checks legal turns for a hidden background component');
  assert.equal(pureLegal.intent, 'legal');
  assert.equal(pureLegal.requestedFact, 'none');

  before = claudeCalls;
  const mixed = await semantic.resolveLexaraResearchDecisionSemantic(
    'The officer who arrested me was fired for misconduct. Does that affect my suppression motion?',
    [],
  );
  assert.equal(claudeCalls, before + 1);
  assert.equal(mixed.intent, 'mixed', 'legal plus external factual dependency becomes mixed research');
  assert.equal(mixed.requestedFact, 'sanctions-discipline');
  assert(mixed.sourceCategories.includes('sanctions-discipline'));
  const mixedPlan = router.planLexaraSequence(
    'The officer who arrested me was fired for misconduct. Does that affect my suppression motion?',
    [],
    mixed,
  );
  assert.equal(mixedPlan.sequence, 'combined-legal-background');
  assert.equal(mixedPlan.useLegalResearch, true, 'mixed semantic routing keeps legal authority research active');
  assert.equal(mixedPlan.useBackgroundResearch, true, 'mixed semantic routing also invokes Lexara-owned background research without Pantheon');

  before = claudeCalls;
  const casual = await semantic.resolveLexaraResearchDecisionSemantic('Thanks.', []);
  assert.equal(claudeCalls, before, 'obvious casual control turns do not pay semantic-classifier latency');
  assert.equal(casual.intent, 'conversation');

  console.log('PASS: Lexara semantic inference recognizes broad requests, statements, mixed legal/background turns, and preserves deterministic factual and casual fast paths.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
