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

const age = factual('How old is Sarah Loretta Graves?', 'age-dob', ['vital-records','identity']);
assert.equal(age.subject, 'Sarah Loretta Graves');
assert.match(age.standaloneQuery, /Sarah Loretta Graves/i);

const license = factual('Does Sarah Loretta Graves hold any licenses?', 'professional-license', ['professional-license']);
assert.equal(license.subject, 'Sarah Loretta Graves');

const follow = planner.decideLexaraResearchNeed('Nursing license', ['Does Sarah Loretta Graves hold any licenses?']);
assert.equal(follow.needed, true);
assert.equal(follow.reason, 'research-follow-up');
assert.equal(follow.intent, 'factual');
assert.equal(follow.requestedFact, 'professional-license');
assert.equal(follow.subject, 'Sarah Loretta Graves');
assert(follow.sourceCategories.includes('healthcare-professional'));
assert.match(follow.standaloneQuery, /Sarah Loretta Graves/i);
assert.match(follow.standaloneQuery, /Nursing license/i);

factual('Is Sarah Loretta Graves married?', 'marriage-divorce', ['vital-records']);
factual('Where does Sarah Loretta Graves work?', 'employment', ['employment']);
factual('Where is Sarah Loretta Graves incarcerated?', 'incarceration', ['corrections']);
factual('Does Sarah Loretta Graves own real estate?', 'property', ['property']);
factual('What address does Sarah Loretta Graves live at?', 'contact-address', ['contacts-addresses']);
factual('Does Sarah Loretta Graves have any relatives?', 'relatives-associates', ['relationships']);
factual('What social media profiles does Sarah Loretta Graves use?', 'social-online', ['social-online']);
factual('Where did Sarah Loretta Graves go to college?', 'education', ['education']);
factual('Does Sarah Loretta Graves have a criminal record?', 'criminal-arrest', ['criminal-records']);
factual('Is Sarah Loretta Graves on probation or parole?', 'probation-parole', ['probation-parole']);
factual('Does Sarah Loretta Graves have an outstanding warrant?', 'warrant', ['warrants']);
factual('Is Sarah Loretta Graves on a sex offender registry?', 'sex-offender', ['sex-offender']);
factual('Has Sarah Loretta Graves filed bankruptcy?', 'bankruptcy-financial', ['financial-public']);


const legal = planner.decideLexaraResearchNeed('How do I file for divorce in Iowa?', []);
assert.equal(legal.needed, true);
assert.equal(legal.intent, 'legal');

const mixed = planner.decideLexaraResearchNeed("Can I use Sarah Loretta Graves's nursing license records in my divorce case?", []);
assert.equal(mixed.needed, true);
assert.equal(mixed.intent, 'mixed');
assert.equal(mixed.requestedFact, 'professional-license');
assert(mixed.sourceCategories.includes('healthcare-professional'));

console.log('PASS: Lexara native factual intent, inference, follow-up carryover, and legal/factual routing are verified.');
