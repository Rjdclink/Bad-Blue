const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// Synthetic fixture only: these prompts test Lexara routing, not real-world facts about any person.

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
    console, URL, process: { env: {} }, setTimeout, clearTimeout,
  }, { filename: relative })(localRequire, module, module.exports);
  return module.exports;
}

const subject = execute('server/lexara/LexaraBackgroundSubject.ts');
const planner = execute('server/lexara/LexaraResearchIntentRouter.ts', {
  './LexaraBackgroundSubject': subject,
});
const router = execute('server/lexara/LexaraSequenceRouter.ts', {
  './LexaraResearchIntentRouter': planner,
});

function factual(prompt, fact, categories = []) {
  const decision = planner.decideLexaraResearchNeed(prompt, []);
  assert.equal(decision.needed, true, prompt);
  assert.equal(decision.intent, 'factual', prompt);
  assert.equal(decision.requestedFact, fact, prompt);
  for (const category of categories) assert(decision.sourceCategories.includes(category), `${prompt}: missing ${category}`);
  const plan = router.planLexaraSequence(prompt, []);
  assert.equal(plan.useLegalResearch, true, prompt);
  assert.equal(plan.useBackgroundResearch, false, prompt);
  return decision;
}

const age = factual('How old is Avery Example?', 'age-dob', ['vital-records','identity']);
assert.equal(age.subject, 'Avery Example');
assert.match(age.standaloneQuery, /Avery Example/i);

const license = factual('Does Avery Example hold any licenses?', 'professional-license', ['professional-license']);
assert.equal(license.subject, 'Avery Example');

const follow = planner.decideLexaraResearchNeed('Nursing license', ['Does Avery Example hold any licenses?']);
assert.equal(follow.needed, true);
assert.equal(follow.reason, 'research-follow-up');
assert.equal(follow.intent, 'factual');
assert.equal(follow.requestedFact, 'professional-license');
assert.equal(follow.subject, 'Avery Example');
assert(follow.sourceCategories.includes('healthcare-professional'));
assert.match(follow.standaloneQuery, /Avery Example/i);
assert.match(follow.standaloneQuery, /Nursing license/i);
const followPlan = router.planLexaraSequence('Nursing license', ['Does Avery Example hold any licenses?']);
assert.equal(followPlan.useBackgroundResearch, false, 'Lexara follow-up must never route to Pantheon');

factual('Is Avery Example married?', 'marriage-divorce', ['vital-records']);
factual('Where does Avery Example work?', 'employment', ['employment']);
factual('Where is Avery Example incarcerated?', 'incarceration', ['corrections']);
factual('Does Avery Example own real estate?', 'property', ['property']);
factual('What address does Avery Example live at?', 'contact-address', ['contacts-addresses']);
factual('Does Avery Example have any relatives?', 'relatives-associates', ['relationships']);
factual('What social media profiles does Avery Example use?', 'social-online', ['social-online']);
factual('Find a public photo of Avery Example.', 'public-image', ['public-images']);
factual('Did Avery Example hold public office or work for the government?', 'government-public', ['government-public']);
factual('Where did Avery Example go to college?', 'education', ['education']);
factual('Does Avery Example have a criminal record?', 'criminal-arrest', ['criminal-records']);
factual('Is Avery Example on probation or parole?', 'probation-parole', ['probation-parole']);
factual('Does Avery Example have an outstanding warrant?', 'warrant', ['warrants']);
factual('Is Avery Example on a sex offender registry?', 'sex-offender', ['sex-offender']);
factual('Has Avery Example filed bankruptcy?', 'bankruptcy-financial', ['financial-public']);


const legal = planner.decideLexaraResearchNeed('How do I file for divorce in Iowa?', []);
assert.equal(legal.needed, true);
assert.equal(legal.intent, 'legal');
assert.equal(legal.requestedFact, 'none');
assert.equal(legal.sourceCategories.length, 0);
const legalPlan = router.planLexaraSequence('How do I file for divorce in Iowa?', []);
assert.equal(legalPlan.useLegalResearch, true);
assert.equal(legalPlan.useBackgroundResearch, false, 'Pure legal procedure must stay on Lexara and never route to Pantheon');

const mixed = planner.decideLexaraResearchNeed("Can I use Avery Example's nursing license records in my divorce case?", []);
assert.equal(mixed.needed, true);
assert.equal(mixed.intent, 'mixed');
assert.equal(mixed.requestedFact, 'professional-license');
assert(mixed.sourceCategories.includes('healthcare-professional'));
const mixedPlan = router.planLexaraSequence("Can I use Avery Example's nursing license records in my divorce case?", []);
assert.equal(mixedPlan.useBackgroundResearch, false, 'Lexara mixed research must never route to Pantheon');

console.log('PASS: Lexara-owned factual intent, inference, follow-up carryover, and legal/factual routing are verified with Pantheon disconnected.');
