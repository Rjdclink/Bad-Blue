const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function must(condition, message) {
  if (!condition) {
    console.error('AI HARMONY VERIFY FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✓', message);
  }
}

const registry = read('server/aiHarmonyModelRegistry.ts');
const collaboration = read('server/aiCollaborationOrchestrator.ts');
const provider = read('server/aiProvider.ts');
const subAgent = read('server/aiSubAgent.ts');
const lexara = read('server/lexara/LexaraConversationOrchestrator.ts');
const cryptoHarmony = read('server/services/cryptocrawl/ai/cryptocrawler-ai-harmony.ts');
const forge = read('server/services/4ji-orchestrator/forge-ai.ts');
const governor = read('server/aiTokenGovernor.ts');
const tokenMetrics = read('server/repositories/tokenMetricsRepository.ts');
const efficientAI = read('server/efficientAI.ts');
const factCheck = read('server/services/factCheckEngine.ts');
const officerCollector = read('server/officerDataCollector.ts');
const groq = read('server/groq.ts');
const fullSystemTest = read('server/fullSystemTest.ts');
const quickDiagnostic = read('server/quickDiagnostic.ts');
const runDiagnostics = read('server/runDiagnostics.ts');
const systemConfig = read('server/systemConfig.ts');
const serverIndex = read('server/index.ts');
const legalModelOrchestrator = read('server/legalModelOrchestrator.ts');
const mlRoutingWorker = read('server/services/mlnlp/mlRoutingWorker.ts');
const constants = read('server/constants.ts');
const openRouterService = read('server/openRouterService.ts');
const harmonyWarmup = read('server/aiHarmonyWarmup.ts');

const registrySection = registry.split('HARMONY_17_PARTICIPANTS')[1]?.split('if (HARMONY_17_PARTICIPANTS.length !== 17)')[0] || '';
const participantCount = (registrySection.match(/provider:\s*PROVIDER\./g) || []).length;
must(participantCount === 17, `Harmony registry contains exactly 17 logical participants (found ${participantCount})`);

for (const model of [
  'gemini-3.8-flash',
  'claude-sonnet-5',
  'claude-opus-5',
  'openai/gpt-oss-120b',
  'mistral-small-2603',
  'mistral-medium-3-5',
  'deepseek/deepseek-v4.1-flash',
  'x-ai/grok-4.6',
  'moonshotai/kimi-k3',
  'qwen/qwen3.8-max-0902',
  'openai/gpt-5.6-luna',
  'command-a-plus-05-2026',
  'MiniMax-M3',
]) {
  must(registry.includes(model), `current Harmony registry includes ${model}`);
}

must(
  harmonyWarmup.includes('prewarmHarmonyProviders') &&
    harmonyWarmup.includes('isHarmonyProviderWarmHealthy') &&
    harmonyWarmup.includes('warmGroqModelCatalog') &&
    collaboration.includes('isHarmonyProviderWarmHealthy') &&
    serverIndex.includes('prewarmHarmonyProviders()'),
  'Harmony prewarms live model catalogs without making warmup a startup dependency',
);

must(
  collaboration.includes('selectProvidersForTask') &&
  collaboration.includes('AIModelSelector.scoreProvidersForTask') &&
  collaboration.includes("role: 'harmony-synthesizer'") &&
  collaboration.includes('getConfiguredHarmonyProviders') &&
  collaboration.includes('fallbackProviders') &&
  collaboration.includes('rankFallbackProviders') &&
  collaboration.includes('fallbackLimit') &&
  collaboration.includes('recoveryBatch') &&
  collaboration.includes('harmonyTransportCooldownUntil') &&
  collaboration.includes('requestTimeoutMs') &&
  collaboration.includes('maxFallbacks') &&
  collaboration.includes('withHarmonyDeadline') &&
  collaboration.includes('Promise.any') &&
  collaboration.includes("model: 'harmony-current'"),
  'shared orchestrator exposes the full configured capability pool as a hot reserve while each task uses a bounded capability-matched hedge, one synthesis authority, deadlines, and route-local recovery',
);

must(
  collaboration.includes("Return ONLY valid JSON") &&
  provider.includes("providerPolicy: 'capability-first'") &&
  provider.includes("await import('./aiCollaborationOrchestrator')") &&
  !provider.includes('AUTONOMOUS_BLOCK_GEMINI'),
  'platform AI entry point routes through capability-first Harmony, preserves structured JSON, and has no context-based provider exclusion',
);

must(
  provider.includes('getConfiguredHarmonyProviders().length > 0 || shouldUseZeroApiMode()') &&
  !subAgent.includes('AUTONOMOUS_LIMIT_REACHED') &&
  governor.includes('budget accounting must not hard-partition user vs.') &&
  !governor.includes('AUTONOMOUS: Only Groq') &&
  !governor.includes('USER: Only Gemini') &&
  tokenMetrics.includes('workerTokens: number; workerRequests: number') &&
  subAgent.includes('Platform invariant: every service enters the shared capability-driven') &&
  subAgent.includes('generateUserText(') &&
  subAgent.indexOf('generateUserText(') < subAgent.indexOf('const providers: Array<{'),
  'legacy AI fallback and autonomous readiness delegate to context-neutral Harmony before route-local compatibility recovery',
);

must(
  lexara.includes('getConfiguredHarmonyProviders') &&
  lexara.includes("providerPolicy: 'capability-first'"),
  'LEXARA uses the shared configured Harmony capability pool',
);

must(
  cryptoHarmony.includes('executeFullHarmony') &&
  cryptoHarmony.includes('getConfiguredHarmonyProviders') &&
  cryptoHarmony.includes("providerPolicy: 'capability-first'"),
  'CryptoCrawler AI analysis uses the shared configured Harmony mesh',
);

must(
  forge.includes('executeHarmonyTask') &&
  forge.includes('getConfiguredHarmonyProviders') &&
  forge.includes("providerPolicy: 'capability-first'") &&
  !forge.includes('const priorityA = this.providerPriority'),
  '4JI Forge execution uses shared capability Harmony rather than static provider ranking',
);

must(
  efficientAI.includes('generateAutonomousText') &&
  efficientAI.includes('generateUserText') &&
  !efficientAI.includes('generateGroqStructuredResponse') &&
  factCheck.includes('AICollaborationOrchestrator.orchestrateCollaboration') &&
  factCheck.includes('getConfiguredHarmonyProviders') &&
  !factCheck.includes("from '../gemini'") &&
  !factCheck.includes("from '../claude'") &&
  !factCheck.includes('generateGroqLegalConsultation') &&
  officerCollector.includes('runGroundedOfficerSearch') &&
  officerCollector.includes('generateOfficerSearchContent') &&
  !officerCollector.includes('generateGroqStructuredResponse') &&
  !officerCollector.includes('Groq-only'),
  'legacy worker, legal fact-check, and officer-analysis services cannot bypass Harmony or reintroduce Groq-only execution',
);

must(
  systemConfig.includes('HARMONY_17_PARTICIPANTS') &&
  systemConfig.includes('getConfiguredHarmonyParticipants') &&
  !systemConfig.includes("user: ['gemini-pro'") &&
  serverIndex.includes('participantCount: HARMONY_17_PARTICIPANTS.length') &&
  serverIndex.includes('configuredCount: getConfiguredHarmonyParticipants().length') &&
  legalModelOrchestrator.includes('getConfiguredHarmonyProviders') &&
  legalModelOrchestrator.includes('AICollaborationOrchestrator.orchestrateCollaboration') &&
  legalModelOrchestrator.includes('full configured Harmony mesh') &&
  mlRoutingWorker.includes('HARMONY_17_PARTICIPANTS.map') &&
  mlRoutingWorker.includes('runtime model participation is owned by') &&
  !constants.includes('llama-3.1-nemotron') &&
  !constants.includes('cloudflare/llama-3.1') &&
  !constants.includes('sambanova/llama-3.1') &&
  openRouterService.includes("isCircuitOpen('grok')") &&
  openRouterService.includes("isCircuitOpen('kimi')"),
  'system config, health, legal ML metadata, compatibility aliases, and OpenRouter status all derive from current Harmony authority without stale local model priorities',
);

must(
  !groq.includes("'llama-3.1-8b-instant',") &&
  !groq.includes("'llama-3.3-70b-versatile',") &&
  groq.includes("'openai/gpt-oss-20b'") &&
  groq.includes("'openai/gpt-oss-120b'") &&
  groq.includes("'qwen/qwen3.6-27b'") &&
  groq.includes("'qwen/qwen3.8-27b'") &&
  groq.includes('orpheus|canopylabs'),
  'Groq recovery avoids shutdown developer-tier Llama IDs and uses current permitted text-model candidates while excluding speech models',
);

const activeRuntimeFiles = [
  'server/aiProvider.ts',
  'server/aiSubAgent.ts',
  'server/aiCollaborationOrchestrator.ts',
  'server/aiHarmonyModelRegistry.ts',
  'server/aiModelSelector.ts',
  'server/openRouterService.ts',
  'server/openRouterWebSearch.ts',
  'server/gemini.ts',
  'server/claude.ts',
  'server/groq.ts',
  'server/geigerRateLimiter.ts',
  'server/constants.ts',
  'server/systemConfig.ts',
  'server/fourJIOrchestrator.ts',
  'server/services/4ji-orchestrator/forge-ai.ts',
  'server/routing/routingEngine.ts',
  'server/aiModelOrchestration.ts',
  'server/lexara/LexaraMediaExtraction.ts',
  'server/officerDataCollector.ts',
  'server/emailVerification.ts',
  'server/workerTokenBudget.ts',
  'server/services/cryptocrawl/ai/cryptocrawler-ai-harmony.ts',
  'server/aiTokenGovernor.ts',
  'server/repositories/tokenMetricsRepository.ts',
  'server/efficientAI.ts',
  'server/services/factCheckEngine.ts',
  'server/fullSystemTest.ts',
  'server/quickDiagnostic.ts',
  'server/runDiagnostics.ts',
  'server/index.ts',
  'server/badblueWorker.ts',
  'server/legalModelOrchestrator.ts',
  'server/services/mlnlp/mlRoutingWorker.ts',
  'server/comprehensiveDiagnostics.ts',
  'server/testDiagnostics.ts',
];

const retiredOrSuperseded = [
  /gemini-2\.5/i,
  /gemini-2\.0/i,
  /claude-opus-4-1-20250805/i,
  /claude-3-sonnet/i,
  /claude-3-5-sonnet/i,
  /qwen-2\.5-72/i,
  /deepseek-r1t2/i,
  /grok-4\.1/i,
  /kimi-k2/i,
  /gpt-4o-mini/i,
  /mistral-7b/i,
  /groq-llama-3\.3-70b/i,
  /llama-3\.1-nemotron/i,
  /cloudflare\/llama-3\.1/i,
  /sambanova\/llama-3\.1/i,
];

for (const path of activeRuntimeFiles) {
  const content = read(path);
  for (const pattern of retiredOrSuperseded) {
    must(!pattern.test(content), `${path} has no stale fallback matching ${pattern}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('AI Harmony platform verification passed.');