const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'server/lexara/LexaraConversationOrchestrator.ts');
const sourceUrl = 'https://records.example.test/jane-avery';
const evidenceText = 'Jane Avery was arrested and booked in Iowa in the official 2024 record.';
const verifiedEvidence = {
  text: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: ${evidenceText}`,
  sourceUrl,
  endpoint: 'evidence-sufficient',
};

globalThis.__lexaraProviderlessTest = { scenario: null };

const mocks = {
  '../aiCollaborationOrchestrator': `
    export const AICollaborationOrchestrator = {async orchestrateCollaboration(...args) {
      const s=globalThis.__lexaraProviderlessTest.scenario;
      s.collaborationCalls++;
      if (s.collaborationError) throw new Error('fixture provider mesh failure');
      return {finalAnswer:s.modelAnswer || 'No successful responses from collaboration.'};
    }};
  `,
  '../openRouterService': `
    export async function generateOpenRouterText() {
      globalThis.__lexaraProviderlessTest.scenario.openRouterCalls++;
      throw new Error('OpenRouter must not be required by this fixture');
    }
  `,
  '../aiHarmonyModelRegistry': `
    export const CURRENT_AI_MODELS={openRouterAuto:'fixture-openrouter'};
    export function getConfiguredHarmonyProviders(){return globalThis.__lexaraProviderlessTest.scenario.providers || [];}
  `,
  '../aiTokenGovernor': `export const UsageContext={USER:'user'};`,
  '../aiModelSelector': `export const TaskComplexity={COMPREHENSIVE:'comprehensive'};export const TaskPriority={CRITICAL:'critical'};`,
  './LexaraAuthorityResearch': `
    export async function researchLegalAuthority(){return null;}
    export function formatAuthorityResearchForSystem(){return '';}
  `,
  './LexaraPantheonInvestigation': `
    export async function investigatePersonQuestion(){return globalThis.__lexaraProviderlessTest.scenario.investigation;}
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
      const s=globalThis.__lexaraProviderlessTest.scenario;
      return {sequence:s.legalOnly?'lexara-legal':'pantheon-background',
        researchDecision:{needed:false,reason:'none',objective:'',objectiveKind:'none'},
        useLegalResearch:!!s.legalOnly,usePantheon:!s.legalOnly,recursive:false,
        classifyPantheon:!s.legalOnly,documentAction:false,reason:'fixture'};
    }
  `,
};

async function loadOrchestrator() {
  const plugin = {
    name: 'providerless-lexara-fixtures',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.prototype.hasOwnProperty.call(mocks, args.path)) {
          return { path: args.path, namespace: 'providerless-fixture' };
        }
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: 'providerless-fixture' }, args => ({
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
  globalThis.__lexaraProviderlessTest.scenario = {
    providers: [],
    collaborationCalls: 0,
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

  setup();
  const sourceFallback = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.match(sourceFallback.text, /Jane Avery was arrested and booked in Iowa/);
  assert.match(sourceFallback.text, new RegExp(sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sourceFallback.text, /retrieved evidence, not a separate conclusion/);
  assert.equal(sourceFallback.pantheonStatus, 'completed',
    'evidence-sufficient source excerpt answers the exact named-subject and arrest question');
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.collaborationCalls, 0);
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.openRouterCalls, 0);
  assert.equal(process.env.OPENROUTER_API_KEY, undefined);
  assert.equal(process.env.FIRECRAWL_API_KEY, undefined);

  setup({ providers: ['claude'], modelAnswer: 'The verified answer from the configured Harmony provider.' });
  const meshAnswer = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(meshAnswer.text, 'The verified answer from the configured Harmony provider.');
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.collaborationCalls, 1);
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.openRouterCalls, 0,
    'a successful configured Harmony answer does not use OpenRouter');

  setup({ providers: ['claude'], collaborationError: true });
  const meshFailureFallback = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.match(meshFailureFallback.text, /Jane Avery was arrested and booked in Iowa/);
  assert.equal(meshFailureFallback.pantheonStatus, 'completed',
    'a configured mesh failure does not block a directly verified source answer');
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.openRouterCalls, 0,
    'failed Harmony and absent OpenRouter still preserve verified source material');

  setup({ providers: ['claude'], modelAnswer: 'I cannot provide personal information about a private individual.' });
  const refusalFallback = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.match(refusalFallback.text, /retrieved evidence, not a separate conclusion/);
  assert.doesNotMatch(refusalFallback.text, /cannot provide personal information/i);
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.openRouterCalls, 0);

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: Jane Avery was told "I cannot provide personal information about a private individual."`,
      sources: [sourceUrl],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: 'evidence-sufficient',
    },
  });
  const quotedRefusal = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.doesNotMatch(quotedRefusal.text, /cannot provide personal information/i,
    'a quoted source excerpt must not be mistaken for an answer or echo a blanket permission refusal');
  assert.equal(quotedRefusal.pantheonStatus, 'partial',
    'a source quoting a refusal does not complete the requested fact');

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: ${evidenceText}`,
      sources: ['https://unrelated.example.test/other'],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: 'evidence-sufficient',
    },
  });
  const invalidCitation = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.match(invalidCitation.text, /source citation could not be validated/i);
  assert.doesNotMatch(invalidCitation.text, /unrelated\.example\.test/,
    'evidence summary is not cited when its URL is outside the verified sources');
  assert.equal(invalidCitation.pantheonStatus, 'partial');

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: A different person was arrested in Iowa in the official 2024 record.`,
      sources: [sourceUrl],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: 'evidence-sufficient',
    },
  });
  const wrongSubject = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(wrongSubject.pantheonStatus, 'partial', 'a matching fact term cannot compensate for a missing subject match');

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: Jane Avery appears in an official 2024 court filing.`,
      sources: [sourceUrl],
      categories: ['courts'],
      fullBackgroundReportRequested: false,
      endpoint: 'evidence-sufficient',
    },
  });
  const missingFact = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(missingFact.pantheonStatus, 'partial', 'subject identity alone cannot complete an unanswered fact question');

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: STRONG (96%)\nEVIDENCE: ${evidenceText}`,
      sources: [sourceUrl],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: 'evidence-sufficient',
    },
  });
  const missingCurrentness = await orchestrator.generateLexaraConversationResponse(
    'Is Jane Avery currently listed as arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(missingCurrentness.pantheonStatus, 'partial',
    'historical arrest evidence does not answer a current-status question without currentness in the excerpt');

  setup({
    investigation: {
      evidenceSummary: `1. SOURCE: ${sourceUrl}\nASSESSMENT: PARTIAL/INFERENTIAL (72%)\nEVIDENCE: ${evidenceText}`,
      sources: [sourceUrl],
      categories: ['criminal'],
      fullBackgroundReportRequested: false,
      endpoint: 'partial-evidence',
    },
  });
  const lowConfidence = await orchestrator.generateLexaraConversationResponse(
    'Was Jane Avery arrested in Iowa?',
    { jurisdiction: 'Iowa' },
  );
  assert.equal(lowConfidence.pantheonStatus, 'partial',
    'matching text on a partial evidence endpoint is not marked completed');

  setup({ legalOnly: true });
  const legalFailure = await orchestrator.generateLexaraConversationResponse(
    'What does Iowa law require for this filing?',
    { jurisdiction: 'Iowa' },
  );
  assert.match(legalFailure.text, /live legal-reasoning service is temporarily unavailable/i);
  assert.equal(legalFailure.pantheonEndpoint, undefined);
  assert.equal(globalThis.__lexaraProviderlessTest.scenario.openRouterCalls, 0);

  console.log('LEXARA providerless background fallback passed (OpenRouter and Firecrawl unset; Harmony, source fallback, refusal guard, citation validation, and legal-only failure verified).');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});