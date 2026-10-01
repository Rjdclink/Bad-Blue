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
  claudeCalls: [],
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
    if (state.mode === 'age-inference') return [candidate('https://records.example.test/juvenile')];
    if (state.mode === 'converged-inference') return [
      candidate('https://records.example.test/juvenile-a'),
      candidate('https://records.example.test/juvenile-b'),
      candidate('https://records.example.test/juvenile-c'),
    ];
    if (state.mode === 'wrong-identity') return [candidate('https://records.example.test/wrong-identity')];
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
            content: 'Avery Example appears in a public profile and is associated with Des Moines, Iowa.',
            retrievedAt: '2026-09-30T12:00:00.000Z',
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/dob')) {
          return [{
            target,
            content: 'Official record for Avery Example of Des Moines, Iowa. Date of birth: 01/02/1984.',
            retrievedAt: '2026-09-30T12:00:01.000Z',
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/juvenile')) {
          return [{
            target,
            content: 'In 2002, Avery Example of Des Moines, Iowa was a juvenile.',
            retrievedAt: '2026-09-30T12:00:02.000Z',
            contentType: 'text/html',
          }];
        }
        if (/\/juvenile-[abc]$/.test(target)) {
          const year = target.endsWith('-a') ? 2001 : target.endsWith('-b') ? 2002 : 2003;
          return [{
            target,
            content: `In ${year}, Avery Example of Des Moines, Iowa was a juvenile in a public proceeding.`,
            retrievedAt: `2026-09-30T12:00:0${year - 2000}.000Z`,
            contentType: 'text/html',
          }];
        }
        if (target.endsWith('/wrong-identity')) {
          return [{
            target,
            content: 'Avery Example is an attorney in Toronto, Canada and has practiced employment law for many years.',
            retrievedAt: '2026-09-30T12:00:02.500Z',
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

const claudeParallel = {
  async searchLexaraBackgroundWithClaude(input) {
    state.claudeCalls.push(input);
    if (state.mode !== 'claude-only') {
      return { candidates: [], citationEvidence: [], searches: 1 };
    }
    return {
      candidates: [candidate('https://claude.example.test/employer', 'claude-web-search')],
      citationEvidence: [{
        url: 'https://claude.example.test/employer',
        content: 'Avery Example of Iowa is employed by Parallel Research LLC.',
        retrievedAt: '2026-10-01T12:00:00.000Z',
      }],
      searches: 2,
    };
  },
};

const investigator = execute('server/lexara/LexaraBackgroundInvestigation.ts', {
  './LexaraResearchIntentRouter': planner,
  './LexaraBackgroundSubject': subject,
  './LegalProviderMesh': mesh,
  './LexaraRetrievalBoundary': retrieval,
  './LexaraPublicSourceRegistry': registry,
  './LexaraDiscoveryLearning': learning,
  './LexaraClaudeBackgroundSearch': claudeParallel,
});

function reset(mode) {
  state.mode = mode;
  state.tierCalls = [];
  state.supplementalCalls = [];
  state.retrievalCalls = [];
  state.claudeCalls = [];
}

(async () => {
  reset('dob-recursive');
  const progress = [];
  const dob = await investigator.investigateLexaraBackgroundQuestion(
    'How old is Avery Example of Des Moines, Iowa?',
    { onProgress: event => progress.push(event) },
  );
  assert.equal(dob.endpoint, 'evidence-sufficient');
  assert.equal(dob.recursionPasses, 2, 'DOB search recursively broadens after a subject-only first source');
  assert.deepEqual(state.retrievalCalls, [
    ['https://records.example.test/profile'],
    ['https://records.example.test/dob'],
  ]);
  assert.equal(state.tierCalls[0].options.subject, 'Avery Example', 'person name is normalized before search');
  assert.equal(state.tierCalls[0].options.jurisdiction, 'Des Moines, Iowa', 'city and state both survive subject normalization');
  assert.match(dob.evidenceSummary, /SOURCE: https:\/\/records\.example\.test\/dob/);
  assert.match(dob.evidenceSummary, /RETRIEVED: 2026-09-30T12:00:01\.000Z/);
  assert.match(dob.evidenceSummary, /ASSESSMENT: DIRECT/);
  assert.equal(progress.some(event => Boolean(event.evidence)), false,
    'progress events never expose source excerpts before the final answer');
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
  const verifiedPrompt = investigator.formatLexaraBackgroundResearchForSystem(employment);
  assert.match(verifiedPrompt, /cleared Lexara's subject-match and evidence threshold/i);
  assert.match(verifiedPrompt, /do not call it a guess/i);


  reset('claude-only');
  const claudeOnly = await investigator.investigateLexaraBackgroundQuestion(
    'Where does Avery Example work?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(claudeOnly.endpoint, 'evidence-sufficient',
    'Claude web search runs beside native lanes and can independently establish the requested fact');
  assert.deepEqual(Array.from(claudeOnly.sources), ['https://claude.example.test/employer']);
  assert(claudeOnly.discoveryLanes.includes('claude-web-search'));
  assert.equal(state.claudeCalls.length, 1, 'Claude parallel lane runs once alongside initial native discovery');
  assert.match(claudeOnly.evidenceSummary, /Parallel Research LLC/);

  reset('age-inference');
  const inferredAge = await investigator.investigateLexaraBackgroundQuestion(
    'How old is Avery Example of Des Moines, Iowa?',
  );
  assert.equal(inferredAge.endpoint, 'best-available-evidence');
  assert.equal(inferredAge.recursionPasses, 1, 'recursion stops when broadening yields no unseen sources');
  assert.match(inferredAge.evidenceSummary, /ASSESSMENT: INFERENTIAL/);
  assert.match(inferredAge.evidenceSummary, /juvenile/i);
  const inferredPrompt = investigator.formatLexaraBackgroundResearchForSystem(inferredAge);
  assert.match(inferredPrompt, /strongest defensible estimate/i);
  assert.match(inferredPrompt, /first sentence must contain only the requested fact/i);
  assert.match(inferredPrompt, /did NOT clear Lexara's verification threshold/i);
  assert.match(inferredPrompt, /This is only a guess, not a verified fact/i);

  reset('converged-inference');
  const converged = await investigator.investigateLexaraBackgroundQuestion(
    'How old is Avery Example of Des Moines, Iowa?',
  );
  assert.equal(converged.endpoint, 'best-available-evidence');
  assert.equal(converged.recursionPasses, 1,
    'ordinary live factual research stops when several useful inferential sources converge');
  assert.equal(converged.sources.length, 3);

  reset('wrong-identity');
  const wrongIdentity = await investigator.investigateLexaraBackgroundQuestion(
    'How old is Avery Morgan Example of Des Moines, Iowa?',
  );
  assert.equal(wrongIdentity.endpoint, 'search-leads-only',
    'matching first and last name alone cannot establish identity when middle name and location do not match');
  assert.equal(wrongIdentity.evidenceSummary, undefined);

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
