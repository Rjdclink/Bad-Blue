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

const state = {
  mode: 'dob-recursive',
  tierCalls: [],
  supplementalCalls: [],
  retrievalCalls: [],
};

const planner = {
  decideLexaraResearchNeed(prompt) {
    const value = String(prompt || '').toLowerCase();
    if (value.includes('legal-only')) {
      return {
        needed: true, reason: 'legal-authority', objective: prompt, objectiveKind: 'legal-authority',
        intent: 'legal', requestedFact: 'none', sourceCategories: [], standaloneQuery: prompt, inferred: false,
      };
    }
    const employment = /\b(?:work|employ)/i.test(prompt);
    return {
      needed: true,
      reason: 'external-fact-question',
      objective: prompt,
      objectiveKind: 'external-fact',
      intent: 'factual',
      requestedFact: employment ? 'employment' : 'age-dob',
      sourceCategories: employment ? ['employment','general-public-records'] : ['vital-records','identity','general-public-records'],
      subject: 'Avery Example',
      standaloneQuery: prompt,
      inferred: true,
    };
  },
};

function candidate(url, provider = 'fixture-search') {
  return { url, title: 'Fixture result', excerpt: 'discovery only', tier: 3, provider };
}

const mesh = {
  async discoverLegalMeshTier3(query, _signal, options) {
    state.tierCalls.push({ query, options });
    if (state.mode === 'empty') return [candidate('https://records.example.test/empty')];
    if (state.mode === 'employment') return [candidate('https://records.example.test/employer')];
    if (state.mode === 'dob-recursive' && state.tierCalls.length === 1) {
      return [candidate('https://records.example.test/profile')];
    }
    return [];
  },
  async discoverLegalMeshSupplemental(query, existingUrls, _signal, options) {
    state.supplementalCalls.push({ query, existingUrls, options });
    if (state.mode === 'dob-recursive' && !existingUrls.includes('https://records.example.test/dob')) {
      return [candidate('https://records.example.test/dob', 'fixture-supplemental')];
    }
    return [];
  },
};

const retrieval = {
  lexaraRetrievalAdapter: {
    async retrieve(request) {
      state.retrievalCalls.push([...request.targets]);
      const evidence = request.targets.flatMap(target => {
        if (target.endsWith('/profile')) {
          return [{
            target,
            content: 'Avery Example appears in a public profile and is associated with Des Moines.',
            retrievedAt: '2026-09-30T12:00:00.000Z',
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/dob')) {
          return [{
            target,
            content: 'Official record for Avery Example of Des Moines. Date of birth: 01/02/1984.',
            retrievedAt: '2026-09-30T12:00:01.000Z',
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/employer')) {
          return [{
            target,
            content: 'Avery Example of Iowa is employed by Example Industries as a compliance analyst.',
            retrievedAt: '2026-09-30T12:00:02.000Z',
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/empty')) {
          return [{
            target,
            content: 'This page concerns Different Person and contains no record for the requested subject.',
            retrievedAt: '2026-09-30T12:00:03.000Z',
            contentType: 'text/html',
          }];
        }
        return [];
      });
      return { evidence };
    },
  },
};

const registry = {
  getLexaraSourceQueryHints(categories) {
    return categories.includes('employment')
      ? ['employment','employer','staff directory','professional profile']
      : ['birth record','date of birth','identity','public record'];
  },
};

const learning = {
  async rememberLexaraDiscoveryOutcome() {},
};

const investigator = execute('server/lexara/LexaraBackgroundInvestigation.ts', {
  './LexaraResearchIntentRouter': planner,
  './LexaraBackgroundSubject': subject,
  './LegalProviderMesh': mesh,
  './LexaraRetrievalBoundary': retrieval,
  './LexaraPublicSourceRegistry': registry,
  './LexaraDiscoveryLearning': learning,
});

function reset(mode) {
  state.mode = mode;
  state.tierCalls = [];
  state.supplementalCalls = [];
  state.retrievalCalls = [];
}

(async () => {
  reset('dob-recursive');
  const progress = [];
  const dob = await investigator.investigateLexaraBackgroundQuestion(
    'How old is Avery Example of Des Moines?',
    { onProgress: event => progress.push(event) },
  );
  assert.equal(dob.endpoint, 'evidence-sufficient');
  assert.equal(dob.recursionPasses, 2, 'DOB search recursively broadens after a subject-only first source');
  assert.deepEqual(state.retrievalCalls, [
    ['https://records.example.test/profile'],
    ['https://records.example.test/dob'],
  ]);
  assert.equal(state.tierCalls[0].options.subject, 'Avery Example', 'person name is normalized before search');
  assert.equal(state.tierCalls[0].options.jurisdiction, 'Des Moines', 'location suffix survives subject normalization');
  assert.match(dob.evidenceSummary, /SOURCE: https:\/\/records\.example\.test\/dob/);
  assert.match(dob.evidenceSummary, /RETRIEVED: 2026-09-30T12:00:01\.000Z/);
  assert.match(dob.evidenceSummary, /ASSESSMENT: DIRECT/);
  assert.equal(progress.at(-1).endpoint, 'evidence-sufficient');

  reset('employment');
  const employment = await investigator.investigateLexaraBackgroundQuestion(
    'Where does Avery Example work?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(employment.endpoint, 'evidence-sufficient');
  assert.equal(employment.recursionPasses, 1);
  assert.deepEqual(state.retrievalCalls, [['https://records.example.test/employer']]);
  assert.match(employment.evidenceSummary, /employed by Example Industries/i);

  reset('empty');
  const sameNameWrongContext = await investigator.investigateLexaraBackgroundQuestion(
    'What is the date of birth of Avery Example?',
    { jurisdiction: 'Iowa' },
  );
  assert.notEqual(sameNameWrongContext.endpoint, 'evidence-sufficient',
    'a page that does not correlate the requested subject/location cannot stop the investigation');

  reset('empty');
  const empty = await investigator.investigateLexaraBackgroundQuestion(
    'What is the date of birth of Avery Example?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(empty.endpoint, 'search-leads-only');
  assert.deepEqual(Array.from(empty.sources), []);
  assert.deepEqual(Array.from(empty.searchLeads || []), ['https://records.example.test/empty']);
  assert.match(empty.coverageNote, /not a negative-record conclusion/i);

  reset('dob-recursive');
  const legal = await investigator.investigateLexaraBackgroundQuestion(
    'LEGAL-ONLY: explain the filing standard.',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(legal, null, 'legal-only research never enters Lexara background retrieval');
  assert.equal(state.tierCalls.length, 0);
  assert.equal(state.retrievalCalls.length, 0);

  const formatted = investigator.formatLexaraBackgroundResearchForSystem(empty);
  assert.match(formatted, /UNVERIFIED SEARCH LEADS/);
  assert.match(formatted, /Do not infer a negative fact/);

  console.log('PASS: Lexara native background investigation is wired end to end with recursion, fact gating, provenance, location preservation, honest exhaustion, and legal-only isolation.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
