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
  collaboration.includes('Harmony invariant: every configured, healthy participant contributes') &&
  collaboration.includes("role: 'harmony-synthesizer'") &&
  collaboration.includes('getConfiguredHarmonyProviders') &&
  collaboration.includes('fallbackProviders') &&
  collaboration.includes('rankFallbackProviders') &&
  collaboration.includes('alternatives.slice(0, 3)') &&
  collaboration.includes('Promise.any') &&
  collaboration.includes("model: 'harmony-current'"),
  'shared orchestrator requires full configured participation, one final synthesis authority, bounded route-local failover, and full-mesh legacy quick calls',
);

must(
  collaboration.includes("Return ONLY valid JSON with no markdown fences") &&
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
  'LEXARA uses the shared configured Harmony mesh',
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
];

const retiredOrSuperseded = [
  /gemini-2\.5/i,
  /gemini-2\.0/i,
  /claude-opus-4-1-20250805/i,
  /claude-3-sonnet/i,
  /qwen-2\.5-72/i,
  /deepseek-r1t2/i,
  /grok-4\.1/i,
  /kimi-k2/i,
  /gpt-4o-mini/i,
  /mistral-7b/i,
];

for (const path of activeRuntimeFiles) {
  const content = read(path);
  for (const pattern of retiredOrSuperseded) {
    must(!pattern.test(content), `${path} has no stale fallback matching ${pattern}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('AI Harmony platform verification passed.');
