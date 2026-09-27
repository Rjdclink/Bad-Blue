const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const express = require('express');

const root = path.resolve(__dirname, '..');
const subjectPath = path.join(root, 'server/lexara/LexaraBackgroundSubject.ts');
const investigationPath = path.join(root, 'server/lexara/LexaraPantheonInvestigation.ts');
const routesPath = path.join(root, 'server/routes/lexara.chat.routes.ts');

function evidence(subject, options = {}) {
  const sourceUrl = options.sourceUrl || `https://records.example.test/${encodeURIComponent(subject.toLowerCase().replace(/\s+/g, '-'))}`;
  const content = options.content || `Verified public record for ${subject}.`;
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const retrievedAt = '2025-01-02T03:04:05.000Z';
  return {
    schemaVersion: 'pantheon-source-result-v1',
    evidenceId: crypto.createHash('sha256').update(`${sourceUrl}:${contentHash}`).digest('hex'),
    crawler: 'fixture-crawler',
    capabilityId: 'fixture-crawler',
    categoryLabel: 'Public records',
    target: sourceUrl,
    sourceUrl,
    content,
    contentHash,
    confidence: options.confidence ?? 0.96,
    retrievedAt,
    status: 'completed_with_content',
    provenance: { sourceUrl, transport: 'direct-http', retrievedAt, durationMs: 1 },
    metadata: options.metadata || {},
  };
}

function loadBundle(output, filename) {
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

async function bundleEntry(entry, plugin, filename) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    plugins: [plugin],
    logLevel: 'silent',
  });
  return loadBundle(result.outputFiles[0].text, filename);
}

const seam = {
  scenario: null,
};
globalThis.__lexaraBackgroundChatTest = seam;

const investigationPlugin = {
  name: 'lexara-investigation-seams',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === '../services/crawlers/PantheonRetrievalAdapter') return { path: 'retrieval', namespace: 'lexara-test' };
      if (args.path === '../services/pantheon/PantheonSovereignSourceRegistry') return { path: 'registry', namespace: 'lexara-test' };
      if (args.path === '../services/inmateSearch/InmateSearchAggregator') return { path: 'inmates', namespace: 'lexara-test' };
      if (args.path === '../services/pantheon/PantheonEntityResolution') return { path: 'matcher', namespace: 'lexara-test' };
      if (args.path === './LexaraCrawlerCapabilityRegistry') return { path: 'assignments', namespace: 'lexara-test' };
      if (args.path === '../services/pantheon/PantheonCrawlerCapabilityMatrix') return { path: 'crawler-ids', namespace: 'lexara-test' };
      if (args.path === '../services/pantheon/PantheonDiscoveryCoordinator') return { path: 'discovery', namespace: 'lexara-test' };
      if (args.path === '../services/pantheon/PantheonDiscoveryLearning') return { path: 'learning', namespace: 'lexara-test' };
      if (args.path === './LexaraResearchIntentRouter') return { path: 'intent', namespace: 'lexara-test' };
      if (args.path === './LexaraBackgroundSubject') return { path: subjectPath };
      if (args.path === '../services/pantheon/PantheonSourceResult') {
        return { path: path.join(root, 'server/services/pantheon/PantheonSourceResult.ts') };
      }
      if (args.path === '../services/crawlers/PublicAcquisitionInfrastructure') {
        return { path: 'acquisition', namespace: 'lexara-test' };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'lexara-test' }, args => {
      const source = {
        retrieval: `
          export const pantheonRetrievalAdapter = { async retrieve(request) {
            const s = globalThis.__lexaraBackgroundChatTest.scenario;
            s.retrievalCalls.push([...request.targets]);
            if (s.mode === 'throw') throw new Error('fixture crawler outage');
            const pass = s.retrievalCalls.length;
            const selected = s.evidenceForPass ? (s.evidenceForPass[pass - 1] || []) : (s.evidence || []);
            const evidence = selected.map(item => ({...item}));
            const sourceOutcomes = evidence.map(item => ({
              sourceUrl:item.sourceUrl,
              status:s.mode === 'audit-rejected' ? 'failed' : 'completed_with_content',
            }));
            s.auditInputs.push({crawlerStatus:evidence.length?'completed_with_content':'completed_no_evidence',sourceOutcomes});
            return {
              available: s.available !== false,
              reason: s.available === false ? 'fixture unavailable' : undefined,
              evidence,
              crawlerAudit:[{
                crawler:'fixture-crawler',
                status:s.available === false?'unavailable':evidence.length?'completed_with_content':'completed_no_evidence',
                attempts:1,evidenceCount:evidence.length,sourceOutcomes,
              }],
              frontierCandidates: pass === 1 ? {discoveredCandidates:s.frontier || [],sourceNavigationCandidates:[]} : {discoveredCandidates:[],sourceNavigationCandidates:[]},
            };
          }};
        `,
        registry: `
          export function buildPantheonCategoryTargets() {
            return ['unavailable','recursive'].includes(globalThis.__lexaraBackgroundChatTest.scenario.mode)
              ? [] : [{url:'https://seed.example.test/one'}];
          }
        `,
        inmates: `export async function searchInmates() { return {inmates:[]}; }`,
        matcher: `export function matchPantheonSubject(item, subject) { const matched=String(item.content).toLowerCase().includes(String(subject).toLowerCase()); return {matched,score:matched?0.92:0.1,conflicts:[],independentCorrelates:matched?[subject]:[]}; }`,
        assignments: `
          export function buildLexaraDynamicCrawlerAssignments() {
            if (globalThis.__lexaraBackgroundChatTest.scenario.mode === 'failed') throw new Error('fixture assignment failure');
            return [];
          }
          export function getLexaraCrawlerReadiness() { return []; }
        `,
        'crawler-ids': `
          export const PANTHEON_PRIMARY_CRAWLER_IDS=['fixture-primary'];
          export const PANTHEON_RAZOR_SKILL_IDS=[];
          export const PANTHEON_SECONDARY_CRAWLER_IDS=[];
          export const PANTHEON_PORTABLE_CAPABILITY_IDS=[];
          export const PANTHEON_REPORT_CATEGORY_LABELS=${JSON.stringify([
            'Identity & Identity Verification', 'Phone Numbers', 'Email Addresses',
            'Current Address', 'Address History', 'Relatives & Family',
            'Associates & Household Connections', 'Social-Media Profiles',
            'Usernames & Online Accounts', 'Photos & Public Images', 'Employment History',
            'Education', 'Professional Licenses & Credentials', 'Business Ownership & Affiliations',
            'Property & Real Estate', 'Vehicles & Transportation Records', 'Court Records',
            'Criminal Records', 'Arrest & Police Records', 'Incarceration & Corrections',
            'Probation & Parole Information', 'Warrants & Wanted-Person Records',
            'Sex-Offender Registries', 'Civil Litigation & Judgments',
            'Bankruptcies, Liens & Financial Public Records',
            'Marriage, Divorce & Vital-Record Information', 'News & Media Mentions',
            'Internet & Web Footprint', 'Government, Political & Public-Service Records',
            'Relationship & Timeline Intelligence',
          ])};
        `,
        discovery: `
          export async function discoverPantheonSourcesParallel() {
            const s=globalThis.__lexaraBackgroundChatTest.scenario;
            s.discoveryCalls++;
            if (s.mode === 'unavailable' || s.mode === 'failed') return {urls:[],lanesAttempted:['fixture-lane']};
            if (s.discoveryCalls === 1) return {urls:[...(s.urls || [])],lanesAttempted:['fixture-lane']};
            return {urls:[...(s.followupUrls || [])],lanesAttempted:['fixture-lane']};
          }
        `,
        learning: `export function rememberPantheonDiscoveryOutcome() { return Promise.resolve(); }`,
        intent: `
          export function decideLexaraResearchNeed() { return {needed:false,objectiveKind:'none'}; }
          export function isLexaraLegalAuthorityIntent() { return false; }
        `,
        acquisition: `export function admitPantheonUrl(value) { return {ok:true,url:value}; }`,
      }[args.path];
      return { contents: source, loader: 'ts' };
    });
  },
};

const routeMocks = {
  '../logger': `export function createLogger(){return {info(){},warn(){},error(){}};}`,
  '../../shared/lexaraVoicePersona': `export const LEXARA_PERSONA={name:'Lexara',traits:[]};`,
  '../lexara/personaKernel': `export const LEXARA_KERNEL={identity:{name:'Lexara',age:0,style:''},speech:{}}; export function mergePersonaWithKernel(x){return x;}`,
  '../lexara/LexaraConversationOrchestrator': `
    export async function generateLexaraConversationResponse(prompt, context) {
      globalThis.__lexaraBackgroundChatTest.chatCalls.push({prompt,context});
      const handoff=/\\b(?:full|complete|comprehensive|entire)\\s+(?:background\\s+)?(?:report|check|investigation)\\b|\\b(?:run|do|generate|prepare)\\s+(?:a\\s+)?background\\s+(?:report|check)\\b/i.test(prompt);
      if (globalThis.__lexaraBackgroundChatTest.chatResult) return globalThis.__lexaraBackgroundChatTest.chatResult;
      return {text:'Mock legal response',jurisdiction:'Iowa',mappedLawType:'general',pantheonEndpoint:handoff?'report-handoff':null,pantheonStatus:handoff?'consent-required':null};
    }
    export function getLexaraImmediateAcknowledgement(){return {text:'',terminal:false,kind:'analysis'};}
  `,
  '../masterPassword': `export const MASTER_USER_ID='master-user';`,
  '../auth': `export function isAuthenticated(req,res,next){req.user={id:'master-user',isMasterBypass:true};next();}`,
  '../aiHarmonyModelRegistry': `export function getConfiguredHarmonyParticipants(){return [];} export function getConfiguredHarmonyProviders(){return [];}`,
  '../lexara/legalDocumentRegistry': `export function isBlankLegalDocumentRequest(){return false;} export function resolveLegalDocumentType(){return null;}`,
};

const routePlugin = {
  name: 'lexara-chat-api-mocks',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'express') return null;
      if (Object.prototype.hasOwnProperty.call(routeMocks, args.path)) {
        return { path: args.path, namespace: 'lexara-route-mock' };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'lexara-route-mock' }, args => ({
      contents: routeMocks[args.path],
      loader: 'ts',
    }));
  },
};

// This second API harness keeps the production route, sequence router,
// conversation orchestrator, and investigation together. Only external
// acquisition, AI, authentication, and storage are replaced with fixtures.
const integratedMocks = {
  ...routeMocks,
  '../aiCollaborationOrchestrator': `
    export const AICollaborationOrchestrator = {async orchestrateCollaboration(_id, _prompt, _task, _providers, options) {
      const s = globalThis.__lexaraBackgroundChatTest.scenario;
      s.answerCalls.push({retrievalPasses:s.retrievalCalls.length, audits:s.auditInputs.length, grounded:options.systemPrompt.includes('SOURCE:')});
      return {finalAnswer:'Fixture Lexara answer citing the verified source.'};
    }};
  `,
  '../openRouterService': `export async function generateOpenRouterText(){throw new Error('fixture fallback unavailable');}`,
  '../aiHarmonyModelRegistry': `
    export const CURRENT_AI_MODELS={openRouterAuto:'fixture'};
    export function getConfiguredHarmonyParticipants(){return ['fixture'];}
    export function getConfiguredHarmonyProviders(){return ['fixture'];}
  `,
  '../aiTokenGovernor': `export const UsageContext={USER:'user'};`,
  '../aiModelSelector': `export const TaskComplexity={COMPREHENSIVE:'comprehensive'};export const TaskPriority={CRITICAL:'critical'};`,
  './LexaraAuthorityResearch': `
    export async function researchLegalAuthority(){return null;}
    export function formatAuthorityResearchForSystem(){return '';}
  `,
  './LexaraLegalDomainProfiles': `
    export function getLexaraLegalDomainProfile(){return null;}
    export function formatLexaraDomainSpecialization(){return '';}
  `,
};
delete integratedMocks['../lexara/LexaraConversationOrchestrator'];

const integratedPlugin = {
  name: 'lexara-real-stack-fixtures',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === '../lexara/LexaraConversationOrchestrator' && args.importer === routesPath) {
        return { path: path.join(root, 'server/lexara/LexaraConversationOrchestrator.ts') };
      }
      if (Object.prototype.hasOwnProperty.call(integratedMocks, args.path)) {
        return { path: args.path, namespace: 'lexara-integrated-mock' };
      }
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'lexara-integrated-mock' }, args => ({
      contents: integratedMocks[args.path],
      loader: 'ts',
    }));
  },
};

async function investigate(investigator, testScenario, prompt, context = {}) {
  seam.scenario = {
    mode: 'success', urls: ['https://search.example.test/lead'], evidence: [],
    discoveryCalls: 0, retrievalCalls: [], auditInputs: [], ...testScenario,
  };
  const result = await investigator.investigatePersonQuestion(prompt, context);
  return { result, scenario: seam.scenario };
}

async function testInvestigation(investigator) {
  const cases = [
    ['person', 'What public record verifies Jane Avery, born 1984, in Iowa?', 'Jane Avery', { jurisdiction: 'Iowa' }],
    ['company', 'What public records show the business history of Acme Corporation?', 'Acme Corporation', {}],
    ['place', 'What public records exist for Lake Example, Oregon?', 'Lake Example', { jurisdiction: 'Oregon' }],
    ['other', 'What is the public history of the project named Aurora Project?', 'Aurora Project', {}],
  ];
  for (const [kind, prompt, subject, context] of cases) {
    const item = evidence(subject, { content: `Official record identifies ${subject} and documents a verified public filing.` });
    const { result, scenario } = await investigate(investigator, { evidence: [item] }, prompt, context);
    assert.equal(result.endpoint, 'evidence-sufficient', `${kind} subject reaches evidence endpoint`);
    assert.match(result.evidenceSummary, new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(scenario.retrievalCalls[0].length, 1, `${kind} retrieval isolates one target per pass`);
    assert.ok(scenario.retrievalCalls[0].includes('https://search.example.test/lead'), `${kind} discovered URL reaches retrieval`);
    assert.equal(scenario.evidence[0].crawler, 'fixture-crawler', `${kind} evidence carries crawler attribution`);
    assert.equal(scenario.auditInputs[0].crawlerStatus, 'completed_with_content', `${kind} has a successful crawler audit`);
    assert.equal(result.sources[0], item.sourceUrl, 'retrieved source, not discovered URL, is cited');
    if (kind === 'place') assert.ok(result.categories.includes('geography'), 'place research includes geography');
    if (kind === 'company') assert.ok(result.categories.includes('corporate'), 'company research includes corporate records');
  }

  const personPrompt = cases[0][1];
  const mismatch = evidence('Unrelated Person', { content: 'Official record for Unrelated Person only.' });
  const rejected = await investigate(investigator, { evidence: [mismatch] }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(rejected.result.endpoint, 'sources-exhausted');
  assert.deepEqual(rejected.result.sources, [], 'identity-mismatched retrieved content is rejected');
  assert.ok(rejected.scenario.retrievalCalls[0].includes('https://search.example.test/lead'));

  const rejectedAudit = await investigate(investigator, {
    mode: 'audit-rejected', evidence: [evidence('Jane Avery')],
  }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(rejectedAudit.result.endpoint, 'sources-exhausted');
  assert.deepEqual(rejectedAudit.result.sources, [], 'content without a successful per-URL crawler audit is not accepted');
  assert.equal(rejectedAudit.scenario.auditInputs[0].sourceOutcomes[0].status, 'failed');

  const leadOnly = await investigate(investigator, { evidence: [] }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(leadOnly.result.endpoint, 'sources-exhausted');
  assert.deepEqual(leadOnly.result.sources, [], 'a discovered URL is only a lead, not verified evidence');
  assert.ok(leadOnly.scenario.retrievalCalls[0].includes('https://search.example.test/lead'), 'the lead is passed to retrieval for content acquisition');

  const firstPass = evidence('Jane Avery', { confidence: 0.2, sourceUrl: 'https://records.example.test/partial', content: 'Jane Avery appears in a limited public record.' });
  const secondPass = evidence('Jane Avery', { confidence: 0.99, sourceUrl: 'https://records.example.test/verified', content: 'Jane Avery is identified in the verified official record.' });
  const recursive = await investigate(investigator, {
    mode: 'recursive',
    urls: ['https://search.example.test/first'],
    evidenceForPass: [[firstPass], [secondPass]],
    frontier: ['https://search.example.test/frontier'],
    followupUrls: ['https://search.example.test/second'],
  }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(recursive.result.endpoint, 'evidence-sufficient');
  assert.equal(recursive.result.recursionPasses, 2);
  assert.deepEqual(recursive.scenario.retrievalCalls, [
    ['https://search.example.test/first'],
    ['https://search.example.test/frontier'],
  ], 'recursive retrieval isolates frontier targets in pass order');

  const eventOrder = [];
  seam.scenario = { mode: 'unavailable', urls: [], discoveryCalls: 0, retrievalCalls: [] };
  await investigator.investigatePersonQuestion(personPrompt, {
    jurisdiction: 'Iowa',
    onProgress: event => eventOrder.push(event.type === 'endpoint' ? `endpoint:${event.endpoint}` : event.type),
  });
  assert.equal(eventOrder.at(-1), 'endpoint:unavailable');

  const empty = await investigate(investigator, { evidence: [] }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(empty.result.endpoint, 'sources-exhausted', 'an available but empty retrieval is explicit exhaustion');
  const retrievalFailure = await investigate(investigator, {
    mode: 'throw', urls: ['https://search.example.test/failure'], followupUrls: [],
  }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(retrievalFailure.result.endpoint, 'unavailable', 'crawler failure is not treated as a negative record result');
  const unavailable = await investigate(investigator, { mode: 'unavailable', urls: [] }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(unavailable.result.endpoint, 'unavailable', 'no executable source target is explicit unavailability');
  const failed = await investigate(investigator, { mode: 'failed', urls: ['https://search.example.test/fail'] }, personPrompt, { jurisdiction: 'Iowa' });
  assert.equal(failed.result.endpoint, 'failed', 'an investigation exception is explicitly failed');

  const progress = [];
  const ordered = await investigate(investigator, { evidence: [evidence('Jane Avery')] }, personPrompt, {
    jurisdiction: 'Iowa', onProgress: event => progress.push(event.type === 'endpoint' ? `endpoint:${event.endpoint}` : event.type),
  });
  assert.equal(ordered.result.endpoint, 'evidence-sufficient');
  assert.equal(progress.at(-1), 'endpoint:evidence-sufficient');
  assert.equal(progress.filter(value => value.startsWith('endpoint:')).length, 1, 'terminal endpoint is emitted once and last');

  const report = await investigator.investigatePersonQuestion(
    'Run a full background report on Jane Avery, born 1984, in Iowa.',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(report.endpoint, 'report-handoff');
  assert.equal(report.fullBackgroundReportRequested, true);
  assert.equal(report.recursionPasses, 0, 'full report handoff does not enter the quick lookup crawler');

  const nonBackground = await investigator.investigatePersonQuestion('Explain the general idea of public records.', {});
  assert.equal(nonBackground, null, 'ordinary non-background turns do not enter Pantheon');
}

async function withServer(router, run) {
  const app = express();
  app.use('/api/lexara', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}/api/lexara`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testChatRoutes(router) {
  seam.chatCalls = [];
  seam.chatResult = null;
  await withServer(router, async baseUrl => {
    const post = (path, body) => fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const ordinary = await post('/chat', { prompt: 'Explain contract consideration.', includeAudio: false });
    assert.equal(ordinary.status, 200);
    const ordinaryBody = await ordinary.json();
    assert.equal(ordinaryBody.success, true);
    assert.equal(ordinaryBody.pantheonReportHandoff, null);
    assert.equal(ordinaryBody.pantheonStatus, null);
    assert.equal(ordinaryBody.jobCompleted, true);
    assert.equal(ordinaryBody.jobStatus, 'completed');
    assert.equal(ordinaryBody.persistenceStatus, 'master-ephemeral', 'test auth keeps route independent of database persistence');

    const stream = await post('/chat/stream', {
      prompt: 'Explain ordinary contract consideration.',
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const streamText = await stream.text();
    assert.match(streamText, /event: started/);
    assert.match(streamText, /event: complete/);
    assert.match(streamText, /"pantheonReportHandoff":null/);

    const reportPost = await post('/chat', {
      prompt: 'Run a full background report on Jane Avery, born 1984, in Iowa.',
      includeAudio: false,
    });
    const reportBody = await reportPost.json();
    assert.equal(reportPost.status, 200);
    assert.equal(seam.chatCalls.at(-1).prompt, 'Run a full background report on Jane Avery, born 1984, in Iowa.');
    assert.equal(reportBody.pantheonReportHandoff.requested, true);
    assert.equal(reportBody.pantheonReportHandoff.started, false);
    assert.equal(reportBody.pantheonReportHandoff.categoryCount, 30);
    assert.equal(reportBody.jobCompleted, false, 'consent handoff is not a completed report');
    assert.equal(reportBody.jobStatus, 'consent-required');
    assert.match(reportBody.response, /review the report scope and provide the required public-records consent/);
    for (const [endpoint, status, complete] of [
      ['evidence-sufficient', 'completed', true],
      ['best-available-evidence', 'partial', false],
      ['sources-exhausted', 'partial', false],
      ['unavailable', 'unavailable', false],
      ['failed', 'failed', false],
      ['clarification-required', 'clarification-required', false],
    ]) {
      seam.chatResult = {
        text: complete ? 'Verified source-backed fixture answer' : 'Fixture answer limited by the stated endpoint',
        pantheonEndpoint: endpoint, pantheonStatus: status,
      };
      const response = await post('/chat', { prompt: 'Research Acme Corporation history', includeAudio: false });
      const data = await response.json();
      assert.equal(data.pantheonEndpoint, endpoint);
      assert.equal(data.jobStatus, status);
      assert.equal(data.jobCompleted, complete, `${endpoint} must not claim completed research`);
      assert.equal(data.response, seam.chatResult.text);
    }
    seam.chatResult = { text: 'Source access unavailable', pantheonEndpoint: 'unavailable', pantheonStatus: 'unavailable' };
    const limitedStream = await post('/chat/stream', { prompt: 'Research Acme Corporation history' });
    const limitedStreamText = await limitedStream.text();
    assert.match(limitedStreamText, /"jobStatus":"unavailable"/);
    assert.match(limitedStreamText, /"jobCompleted":false/);
    seam.chatResult = null;
    assert.equal(seam.chatCalls.length, 10, 'both API paths reach the mocked conversation orchestrator');
  });
}

async function testIntegratedChatRoutes(router) {
  await withServer(router, async baseUrl => {
    const post = (prompt, context = {}) => fetch(`${baseUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, context }),
    });
    const apiCases = [
      ['person', 'What public record verifies Jane Avery, born 1984, in Iowa?', 'Jane Avery'],
      ['company', 'What public records show the business history of Acme Corporation?', 'Acme Corporation'],
      ['place', 'What public records exist for Lake Example, Oregon?', 'Lake Example'],
      ['entity', 'What is the public history of the project named Aurora Project?', 'Aurora Project'],
    ];
    for (const [kind, prompt, subject] of apiCases) {
      seam.scenario = {
        mode: 'success', urls: ['https://search.example.test/lead'],
        evidence: [evidence(subject, {
          sourceUrl: 'https://search.example.test/lead',
          content: `${subject} is identified in this fetched public record.`,
        })],
        discoveryCalls: 0, retrievalCalls: [], auditInputs: [], answerCalls: [],
      };
      const success = await post(prompt);
      const text = await success.text();
      assert.equal(success.status, 200, `${kind} API request succeeds`);
      assert.deepEqual(seam.scenario.retrievalCalls[0], ['https://search.example.test/lead']);
      assert.equal(seam.scenario.auditInputs[0].sourceOutcomes[0].status, 'completed_with_content');
      assert.equal(seam.scenario.answerCalls.length, 1, `${kind} calls the answer only after research`);
      assert.deepEqual(seam.scenario.answerCalls[0], { retrievalPasses: 1, audits: 1, grounded: true });
      const evidenceEvent = text.indexOf('"type":"evidence"');
      const endpointEvent = text.indexOf('"endpoint":"evidence-sufficient"');
      const completeEvent = text.indexOf('event: complete');
      assert.ok(evidenceEvent >= 0 && evidenceEvent < endpointEvent && endpointEvent < completeEvent,
        `${kind} fetched evidence precedes the endpoint and Lexara answer`);
      assert.match(text, /"jobStatus":"completed"/);
      assert.match(text, /"jobCompleted":true/);
      assert.match(text, /Fixture Lexara answer citing the verified source/);
    }

    seam.scenario = {
      mode: 'success', urls: ['https://search.example.test/lead'],
      evidence: [evidence('Different Company', {
        sourceUrl: 'https://search.example.test/lead',
        content: 'Only Different Company appears in this fetched business record.',
      })],
      discoveryCalls: 0, retrievalCalls: [], auditInputs: [], answerCalls: [],
    };
    const mismatch = await post('What public records show the business history of Acme Corporation?');
    const mismatchText = await mismatch.text();
    assert.match(mismatchText, /"endpoint":"sources-exhausted"/);
    assert.match(mismatchText, /"jobStatus":"partial"/);
    assert.match(mismatchText, /"jobCompleted":false/);
    assert.equal(seam.scenario.answerCalls.length, 0, 'identity-mismatched evidence never enters the answer model');
    assert.ok(seam.scenario.retrievalCalls.length > 0);

    seam.scenario = {
      mode: 'success', urls: ['https://search.example.test/lead'], evidence: [],
      discoveryCalls: 0, retrievalCalls: [], auditInputs: [], answerCalls: [],
    };
    const empty = await post('What public records show the business history of Acme Corporation?');
    const emptyText = await empty.text();
    assert.match(emptyText, /"endpoint":"sources-exhausted"/);
    assert.match(emptyText, /"jobCompleted":false/);
    assert.equal(seam.scenario.answerCalls.length, 0, 'empty crawls do not invoke the answer model');

    seam.scenario = {
      mode: 'throw', urls: ['https://search.example.test/lead'], evidence: [],
      discoveryCalls: 0, retrievalCalls: [], auditInputs: [], answerCalls: [],
    };
    const failedCrawl = await post('What public records show the business history of Acme Corporation?');
    const failedCrawlText = await failedCrawl.text();
    assert.match(failedCrawlText, /"endpoint":"unavailable"/);
    assert.match(failedCrawlText, /"jobCompleted":false/);
    assert.equal(seam.scenario.answerCalls.length, 0);

    seam.scenario = {
      mode: 'unavailable', urls: [], evidence: [],
      discoveryCalls: 0, retrievalCalls: [], auditInputs: [], answerCalls: [],
    };
    const unavailable = await post('What public records show the business history of Acme Corporation?');
    const unavailableText = await unavailable.text();
    assert.match(unavailableText, /"endpoint":"unavailable"/);
    assert.match(unavailableText, /"jobStatus":"unavailable"/);
    assert.match(unavailableText, /"jobCompleted":false/);
    assert.equal(seam.scenario.answerCalls.length, 0);
  });
}

(async () => {
  const investigator = await bundleEntry(
    investigationPath,
    investigationPlugin,
    path.join(root, 'scripts/.lexara-investigation-e2e.bundle.cjs'),
  );
  await testInvestigation(investigator);

  seam.chatCalls = [];
  const routes = await bundleEntry(
    routesPath,
    routePlugin,
    path.join(root, 'scripts/.lexara-chat-e2e.bundle.cjs'),
  );
  await testChatRoutes(routes.default || routes);
  const integratedRoutes = await bundleEntry(
    routesPath,
    { name: 'lexara-integrated-suite', setup(build) {
      investigationPlugin.setup(build);
      integratedPlugin.setup(build);
    } },
    path.join(root, 'scripts/.lexara-integrated-chat-e2e.bundle.cjs'),
  );
  await testIntegratedChatRoutes(integratedRoutes.default || integratedRoutes);
  console.log('Lexara background chat API E2E passed (mocked providers, crawler, and database).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});