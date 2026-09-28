const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const { getEventListeners } = require('node:events');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'server/lexara/LexaraConversationOrchestrator.ts');
const sourceUrl = 'https://records.example.test/jane-avery';
const evidenceText = 'Jane Avery was arrested and booked in Iowa in the official 2024 record.';
const verifiedEvidence = {
  text: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: ${evidenceText}`,
  sourceUrl,
  endpoint: 'evidence-sufficient',
};

globalThis.__lexaraMeshTurnTest = { scenario: null };

const mocks = {
  '../aiCollaborationOrchestrator': `
    export const AICollaborationOrchestrator = {async orchestrateCollaboration(...args) {
      const s=globalThis.__lexaraMeshTurnTest.scenario;
      s.collaborationCalls++;
      s.providerPolicies.push(args[4]?.providerPolicy);
      if (args[0] === 'lexara-evidence-correction' && s.waitForCorrectionAbort) {
        s.correctionSignal = args[4].signal;
        s.onCorrectionStart?.();
        await new Promise((_resolve, reject) => {
          const aborted = () => { s.correctionAborted = true; reject(s.correctionSignal.reason); };
          if (s.correctionSignal.aborted) aborted();
          else s.correctionSignal.addEventListener('abort', aborted, { once: true });
        });
      }
      if (s.collaborationError) throw new Error('fixture provider mesh failure');
      return {finalAnswer:s.modelAnswer || 'No successful responses from collaboration.'};
    }};
  `,
  '../openRouterService': `
    export async function generateOpenRouterText() {
      globalThis.__lexaraMeshTurnTest.scenario.openRouterCalls++;
      throw new Error('OpenRouter must not be required by this fixture');
    }
  `,
  '../aiHarmonyModelRegistry': `
    export const CURRENT_AI_MODELS={openRouterAuto:'fixture-openrouter'};
    export function getConfiguredHarmonyProviders(){return globalThis.__lexaraMeshTurnTest.scenario.providers || [];}
  `,
  '../aiTokenGovernor': `export const UsageContext={USER:'user'};`,
  '../aiModelSelector': `export const TaskComplexity={COMPREHENSIVE:'comprehensive',MODERATE:'moderate'};export const TaskPriority={CRITICAL:'critical'};`,
  './LexaraAuthorityResearch': `
    export async function researchLegalAuthority(){return null;}
    export function formatAuthorityResearchForSystem(){return '';}
  `,
  './LexaraPantheonInvestigation': `
    export async function investigatePersonQuestion(){return globalThis.__lexaraMeshTurnTest.scenario.investigation;}
    export function formatPantheonInvestigationForSystem(){return ' VERIFIED EVIDENCE FIXTURE ';}
  `,
  './LexaraLegalDomainProfiles': `
    export function getLexaraLegalDomainProfile(){return null;}
    export function formatLexaraDomainSpecialization(){return '';}
  `,
  './LexaraResearchIntentRouter': `
    export function decideLexaraResearchNeed(){return {needed:false,reason:'none',objective:'',objectiveKind:'none'};}
    export function isLexaraLegalAuthorityIntent(){return false;}
  `,
  './LexaraSequenceRouter': `
    export function planLexaraSequence(){
      const s=globalThis.__lexaraMeshTurnTest.scenario;
      return {sequence:s.legalOnly?'lexara-legal':'pantheon-background',
        researchDecision:{needed:false,reason:'none',objective:'',objectiveKind:'none'},
        useLegalResearch:!!s.legalOnly,usePantheon:!s.legalOnly,recursive:false,
        classifyPantheon:!s.legalOnly,documentAction:false,reason:'fixture'};
    }
  `,
};

async function loadOrchestrator() {
  const plugin = {
    name: 'lexara-mesh-turn-fixtures',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.prototype.hasOwnProperty.call(mocks, args.path)) {
          return { path: args.path, namespace: 'mesh-turn-fixture' };
        }
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: 'mesh-turn-fixture' }, args => ({
        contents: mocks[args.path], loader: 'ts',
      }));
    },
  };
  const bundle = await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', write: false, plugins: [plugin], logLevel: 'silent',
  });
  const filename = path.join(root, 'scripts/.lexara-providerless-e2e.bundle.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(bundle.outputFiles[0].text, filename);
  return loaded.exports;
}

function setup(overrides = {}) {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  globalThis.__lexaraMeshTurnTest.scenario = {
    providers: [],
    collaborationCalls: 0,
    providerPolicies: [],
    openRouterCalls: 0,
    investigation: {
      evidenceSummary: verifiedEvidence.text,
      sources: [sourceUrl],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: verifiedEvidence.endpoint,
      coverageLimited: false,
      recursionPasses: 1,
    },
    ...overrides,
  };
}

async function main() {
  const orchestrator = await loadOrchestrator();
  const state = () => globalThis.__lexaraMeshTurnTest.scenario;
  setup({ legalOnly: true, providers: ['claude'], modelAnswer: 'Discuss property, custody, and support with your attorney.' });
  const answer = await orchestrator.generateLexaraConversationResponse('What should I discuss before divorce?', { jurisdiction: 'Iowa' });
  assert.equal(answer.text, state().modelAnswer);
  assert.deepEqual(state().providerPolicies, ['legalwhat']);
  assert.equal(state().openRouterCalls, 0);
  console.log('PASS legal turn retains a successful answer through the canonical mesh');

  setup({ legalOnly: true, providers: ['claude'], collaborationError: true });
  process.env.OPENROUTER_API_KEY = 'fixture-present-but-excluded';
  const failed = await orchestrator.generateLexaraConversationResponse('What should I discuss before divorce?', { jurisdiction: 'Iowa' });
  assert.match(failed.text, /^The live legal-reasoning service is temporarily unavailable/);
  assert.equal(state().openRouterCalls, 0);
  console.log('PASS exhausted mesh cannot reopen the excluded gateway or invent an answer');

  setup({ providers: ['claude'], modelAnswer: 'I cannot provide personal information about a private individual.', waitForCorrectionAbort: true });
  const deadlineParent = new AbortController();
  const started = Date.now();
  await orchestrator.generateLexaraConversationResponse('Was Jane Avery arrested in Iowa?', { jurisdiction: 'Iowa', signal: deadlineParent.signal });
  const elapsed = Date.now() - started;
  assert(elapsed >= 2400 && elapsed < 3500, `Correction deadline: ${elapsed}ms`);
  assert.equal(state().correctionAborted, true);
  assert.equal(deadlineParent.signal.aborted, false);
  assert.equal(getEventListeners(deadlineParent.signal, 'abort').length, 0);
  assert.deepEqual(state().providerPolicies, ['legalwhat', 'legalwhat']);
  assert.equal(state().openRouterCalls, 0);
  console.log('PASS optional correction retains its original total deadline and scoped route');

  const cancelledParent = new AbortController();
  setup({ providers: ['claude'], modelAnswer: 'I cannot provide personal information about a private individual.', waitForCorrectionAbort: true,
    onCorrectionStart: () => cancelledParent.abort('fixture superseded turn') });
  const cancelStarted = Date.now();
  await orchestrator.generateLexaraConversationResponse('Was Jane Avery arrested in Iowa?', { jurisdiction: 'Iowa', signal: cancelledParent.signal });
  assert(Date.now() - cancelStarted < 500);
  assert.equal(state().correctionAborted, true);
  assert.equal(state().correctionSignal.reason, 'fixture superseded turn');
  assert.equal(getEventListeners(cancelledParent.signal, 'abort').length, 0);
  console.log('PASS caller cancellation reaches optional correction without leaked listeners');
  console.log('4/4 production-base conversation mesh checks passed; provider I/O mocked.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
