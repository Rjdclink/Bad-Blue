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

const meshEvidence = execute('server/lexara/LegalProviderMesh.ts', {
  './LexaraPublicSourceRegistry': {},
  './LexaraDiscoveryLearning': {},
  './LexaraResearchAssist': {},
});

const mesh = {
  mergeLegalMeshCandidateEvidence: meshEvidence.mergeLegalMeshCandidateEvidence,
  async discoverLegalMeshTier3(query, _signal, options) {
    state.tierCalls.push({ query, options });
    if (state.mode === 'reported-death') return [{ ...candidate('https://records.example.test/obituary'), excerpt: 'Avery Morgan Example passed away February 6, 2020.' }];
    if (state.mode === 'native-failure') throw new Error('fixture native discovery outage');
    if (state.mode === 'empty') return [candidate('https://records.example.test/empty')];
    if (state.mode === 'employment') return [candidate('https://records.example.test/employer')];
    if (state.mode === 'targeted-throughput') return [
      candidate('https://records.example.test/employer'),
      ...Array.from({ length: 5 }, (_, index) => candidate(`https://records.example.test/targeted-${index + 1}`)),
    ];
    if (state.mode === 'custom-general') return [candidate('https://records.example.test/civic-medal')];
    if (state.mode === 'delayed-general' || state.mode === 'claude-source-only') {
      return Array.from({ length: 6 }, (_, index) =>
        candidate(`https://records.example.test/broad-${index + 1}`));
    }
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
        if (target.endsWith('/civic-medal')) {
          return [{
            target,
            content: 'Avery Example of Iowa received the Cedar Civic Medal in 2025 for volunteer service.',
            retrievedAt: '2026-10-01T12:00:04.000Z',
            contentType: 'text/html',
          }];
        }
        if (target === 'https://records.example.test/employer') {
          return [{
            target,
            content: 'Avery Example of Iowa is employed by Example Industries as a compliance analyst.',
            retrievedAt: '2026-09-30T12:00:02.000Z',
            contentType: 'text/html',
          }];
        }
        if (target === 'https://claude.example.test/max-token-source') {
          return [{
            target,
            content: 'Public record for Avery Loretta Example of Hartley, Iowa lists a 2024 civil filing.',
            retrievedAt: '2026-10-02T03:05:55.000Z',
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
    if (state.mode === 'delayed-general') {
      await new Promise(resolve => setTimeout(resolve, 25));
      return {
        candidates: [candidate('https://claude.example.test/background', 'claude-web-search')],
        citationEvidence: [{
          url: 'https://claude.example.test/background',
          content: 'Public record for Avery Loretta Example of Hartley, Iowa lists a 2024 civil filing.',
          retrievedAt: '2026-10-02T03:05:55.000Z',
        }],
        searches: 2,
      };
    }
    if (state.mode === 'claude-source-only') {
      await new Promise(resolve => setTimeout(resolve, 25));
      return {
        candidates: [candidate('https://claude.example.test/max-token-source', 'claude-web-search')],
        citationEvidence: [],
        searches: 2,
      };
    }
    if (state.mode !== 'claude-only' && state.mode !== 'native-failure') {
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
  './LexaraAuthoritativeLookup': {
    async lookupLexaraAuthoritativeSources() { return []; },
  },
  './LexaraPeopleToolLanes': {
    async runLexaraPeopleToolLanes() {
      return { candidates: [], evidence: [], lanesAttempted: [] };
    },
  },
});

function reset(mode) {
  state.mode = mode;
  state.tierCalls = [];
  state.supplementalCalls = [];
  state.retrievalCalls = [];
  state.claudeCalls = [];
}

(async () => {
  reset('reported-death');
  const reportedDeath = await investigator.investigateLexaraBackgroundQuestion(
    'When did Avery Morgan Example pass away?',
    { resolvedSubject: { name: 'Avery Morgan Example', kind: 'person', identifiable: true },
      researchDecision: { needed: true, reason: 'external-fact-question', objective: 'Find the death date of Avery Morgan Example', objectiveKind: 'external-fact', intent: 'factual', requestedFact: 'death-date', sourceCategories: ['vital-records'], subject: 'Avery Morgan Example', standaloneQuery: 'Avery Morgan Example death date', inferred: true } },
  );
  assert.equal(reportedDeath.endpoint, 'best-available-evidence');
  assert.match(reportedDeath.evidenceSummary, /REPORTED IN SEARCH EXCERPT/);
  assert.match(reportedDeath.evidenceSummary, /February 6, 2020/);
  assert.equal(state.claudeCalls.length, 0, 'an explicit subject-matched obituary excerpt avoids redundant Claude research');
  assert.equal(reportedDeath.coverageLimited, true, 'a search excerpt is not upgraded to independent page verification');

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
  assert.equal(state.tierCalls[0].options.firstUseful, true,
    'ordinary live background turns request first-useful provider/query timing');
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

  reset('targeted-throughput');
  const targetedThroughput = await investigator.investigateLexaraBackgroundQuestion(
    'Where does Avery Example work?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(state.retrievalCalls[0].length, 6,
    'targeted factual lookups retain the newer six-target live throughput');
  assert.equal(targetedThroughput.endpoint, 'evidence-sufficient');


  const mergedSubject = subject.mergeCompatibleLexaraBackgroundSubjects(
    { name: 'Example of Hartley', kind: 'person', identifiable: true, location: 'Hartley, Iowa' },
    { name: 'Avery Loretta Example of Hartley', kind: 'person', identifiable: true, location: 'Hartley, Iowa' },
  );
  assert.equal(mergedSubject.name, 'Avery Loretta Example of Hartley',
    'a shorter compatible subject must never replace the fuller identity from the user turn');
  const conflictingMiddle = subject.mergeCompatibleLexaraBackgroundSubjects(
    { name: 'Avery Ann Example', kind: 'person', identifiable: true, location: 'Iowa' },
    { name: 'Avery Beth Example', kind: 'person', identifiable: true, location: 'Iowa' },
  );
  assert.equal(conflictingMiddle.name, 'Avery Ann Example',
    'matching first and last names must not fuse conflicting middle-name identities');

  reset('delayed-general');
  const broadBackground = await investigator.investigateLexaraBackgroundQuestion(
    'What do you know about Avery Loretta Example of Hartley, Iowa?',
    {
      resolvedSubject: { name: 'Example of Hartley', kind: 'person', identifiable: true, location: 'Hartley, Iowa' },
      researchDecision: {
        needed: true,
        reason: 'external-fact-question',
        objective: 'Find the background facts the user is asking about for Avery Loretta Example of Hartley.',
        objectiveKind: 'external-fact',
        intent: 'factual',
        requestedFact: 'general-public-record',
        sourceCategories: ['general-public-records'],
        subject: 'Example of Hartley',
        subjectKind: 'person',
        standaloneQuery: 'Avery Loretta Example Hartley Iowa background',
        inferred: true,
      },
    },
  );
  assert.equal(state.retrievalCalls[0].length, 6,
    'broad live person background keeps the optimized six-target first pass');
  assert.equal(state.claudeCalls[0].subject.name, 'Avery Loretta Example',
    'the full compatible identity reaches the Claude background lane after location cleanup');
  assert.equal(broadBackground.endpoint, 'evidence-sufficient',
    'native exhaustion must leave the remaining live budget for the already-running Claude web lane');
  assert(broadBackground.discoveryLanes.includes('claude-web-search'));
  assert.match(broadBackground.evidenceSummary, /2024 civil filing/i);

  reset('claude-source-only');
  const sourceOnlyClaude = await investigator.investigateLexaraBackgroundQuestion(
    'What do you know about Avery Loretta Example of Hartley, Iowa?',
    {
      resolvedSubject: { name: 'Avery Loretta Example of Hartley', kind: 'person', identifiable: true, location: 'Hartley, Iowa' },
      researchDecision: {
        needed: true,
        reason: 'external-fact-question',
        objective: 'Find the background facts the user is asking about for Avery Loretta Example of Hartley.',
        objectiveKind: 'external-fact',
        intent: 'factual',
        requestedFact: 'general-public-record',
        sourceCategories: ['general-public-records'],
        subject: 'Avery Loretta Example of Hartley',
        subjectKind: 'person',
        standaloneQuery: 'Avery Loretta Example Hartley Iowa background',
        inferred: true,
      },
    },
  );
  assert(state.retrievalCalls.some(call => call.includes('https://claude.example.test/max-token-source')),
    'Claude source URLs that survive without citation text are retrieved inside the remaining live budget');
  assert(sourceOnlyClaude.discoveryLanes.includes('claude-web-search'));
  assert.match(sourceOnlyClaude.evidenceSummary, /2024 civil filing/i,
    'source-only Claude web results remain usable evidence instead of being discarded');

  reset('custom-general');
  const customGeneral = await investigator.investigateLexaraBackgroundQuestion(
    'Did Avery Example receive a civic medal?',
    {
      jurisdiction: 'Iowa',
      researchDecision: {
        needed: true,
        reason: 'external-fact-question',
        objective: 'Determine whether Avery Example received a civic medal.',
        objectiveKind: 'external-fact',
        intent: 'factual',
        requestedFact: 'general-public-record',
        sourceCategories: ['general-public-records'],
        subject: 'Avery Example',
        standaloneQuery: 'Avery Example civic medal Iowa',
        inferred: true,
      },
    },
  );
  assert.equal(customGeneral.endpoint, 'evidence-sufficient',
    'open-ended background objectives are evidence-gated by their semantic objective, not a fixed keyword taxonomy');
  assert.match(customGeneral.evidenceSummary, /Cedar Civic Medal/i);

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

  reset('native-failure');
  const nativeFailure = await investigator.investigateLexaraBackgroundQuestion(
    'Where does Avery Example work?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(nativeFailure.endpoint, 'evidence-sufficient',
    'a native discovery outage must not discard Claude parallel evidence');
  assert(nativeFailure.discoveryLanes.includes('claude-web-search'));
  assert.match(nativeFailure.evidenceSummary, /Parallel Research LLC/);

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
  assert.match(inferredPrompt, /answer in one sentence containing the requested fact/i);
  assert.match(inferredPrompt, /did NOT clear Lexara's independent verification threshold/i);
  assert.match(inferredPrompt, /Keep source URLs internal/i);
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
  assert.equal(wrongIdentity.endpoint, 'sources-exhausted',
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
  assert.equal(empty.endpoint, 'sources-exhausted');
  assert.deepEqual(Array.from(empty.sources), []);
  assert.equal(empty.searchLeads, undefined);
  assert.match(empty.coverageNote, /not a negative-record conclusion|not proof that no record exists/i);

  reset('dob-recursive');
  const legal = await investigator.investigateLexaraBackgroundQuestion(
    'LEGAL-ONLY: explain the filing standard.',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(legal, null, 'legal-only research never enters Lexara background retrieval');
  assert.equal(state.tierCalls.length, 0);
  assert.equal(state.retrievalCalls.length, 0);

  const formatted = investigator.formatLexaraBackgroundResearchForSystem(empty);
  assert.match(formatted, /No verified subject-specific source content established the requested fact/);
  assert.match(formatted, /Do not infer a negative fact/);

  console.log('PASS: Lexara native background investigation is wired end to end with recursion, fact gating, provenance, location preservation, honest exhaustion, and legal-only isolation.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
