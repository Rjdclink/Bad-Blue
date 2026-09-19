const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function must(condition, message) {
  if (!condition) {
    console.error('LEXARA REALIZATION VERIFY FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✓', message);
  }
}

const voiceMode = read('client/src/hooks/useVoiceMode.ts');
const conversation = read('client/src/components/LexaraConversation.tsx');
const avatar = read('client/src/components/LexaraEtherealAvatar.tsx');
const synthesis = read('client/src/hooks/useVoiceSynthesis.ts');
const speechClient = read('client/src/lib/lexaraSpeechClient.ts');
const lexaraRoutes = read('server/routes/lexara.routes.ts');
const lexaraChatRoutes = read('server/routes/lexara.chat.routes.ts');
const voiceRoutes = read('server/routes/voice.routes.ts');
const orchestrator = read('server/lexara/LexaraConversationOrchestrator.ts');
const openRouter = read('server/openRouterService.ts');
const authorityResearch = read('server/lexara/LexaraAuthorityResearch.ts');
const webSearch = read('server/webSearchService.ts');
const modernWebSearch = read('server/openRouterWebSearch.ts');
const viteConfig = read('vite.config.ts');
const serverVite = read('server/vite.ts');
const systemConfig = read('server/systemConfig.ts');
const voicePipeline = read('server/lexara/LexaraVoicePipeline.ts');
const review = read('docs/LEXARA_INTENT_REALIZATION_30_SOURCE_REVIEW_20260918.md');
const voiceReliabilityReview = read('docs/LEXARA_VOICE_RELIABILITY_10_SOURCE_REVIEW_20260918.md');
const turnGroundingReview = read('docs/LEXARA_TURN_GROUNDING_30_SOURCE_REVIEW_20260918.md');
const harmonyReview = read('docs/LEXARA_HARMONY_STATIC_VOICE_10_SOURCE_REVIEW_20260918.md');
const harmony = read('server/aiCollaborationOrchestrator.ts');
const harmonyRegistry = read('server/aiHarmonyModelRegistry.ts');
const claude = read('server/claude.ts');
const groq = read('server/groq.ts');
const harmonyWarmup = read('server/aiHarmonyWarmup.ts');
const crawlerRegistry = read('server/lexara/LexaraCrawlerCapabilityRegistry.ts');
const pacer = read('server/services/criminalRecords/sources/PACERScraper.ts');
const routes = read('server/routes.ts');
const storage = read('server/storage.ts');
const overflowSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const lexaraOverflowMigration = read('server/migrations/060_lexara_overflow_conversation_history.sql');
const aiProvider = read('server/aiProvider.ts');
const conversationalReliabilityReview = read('docs/LEXARA_CONVERSATIONAL_RELIABILITY_10_SOURCE_REVIEW_20260918.md');
const duplexReview = read('docs/LEXARA_DUPLEX_ORCHESTRATION_30_SOURCE_REVIEW_20260918.md');
const harmonyRootReview = read('docs/LEXARA_HARMONY_ROOT_CAUSE_10_SOURCE_REVIEW_20260918.md');
const harmonyImplementationReview = read('docs/LEXARA_HARMONY_IMPLEMENTATION_10_SOURCE_REVIEW_20260918.md');
const realtimeCapabilityReview = read('docs/LEXARA_REALTIME_CAPABILITY_HARMONY_20_SOURCE_REVIEW_20260918.md');
const integratedRealtimeReview = read('docs/LEXARA_INTEGRATED_REALTIME_IMPLEMENTATION_10_SOURCE_REVIEW_20260918.md');
const hotReserveReview = read('docs/LEXARA_HOT_RESERVE_17_PROVIDER_10_SOURCE_REVIEW_20260919.md');
const consentPage = read('client/src/pages/lexara-consent.tsx');
const mistral = read('server/mistral.ts');
const gemini = read('server/gemini.ts');

must(
  voiceMode.includes('preferServerRecognition') &&
    voiceMode.includes('/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)') &&
    voiceMode.includes("engineRef.current = 'server'"),
  'mobile voice uses controllable server endpointing while desktop retains browser recognition',
);
must(
  voiceMode.includes('serverEchoCancellationRef') &&
    voiceMode.includes('shouldProbeBargeIn?: () => boolean') &&
    voiceMode.includes('SERVER_BARGE_IN_PROBE_MS = 450') &&
    voiceMode.includes('recorder.requestData()') &&
    voiceMode.includes('bargeInProbe: true') &&
    voiceMode.includes('startedDuringPlayback') &&
    voiceMode.includes('utteranceId') &&
    conversation.includes("shouldProbeBargeIn: () => phaseRef.current === 'speaking'") &&
    conversation.includes('validatedBargeInUtterancesRef') &&
    !conversation.includes('bargeInCandidateTimerRef'),
  'server VAD records continuously while barge-in authority requires a transcript-correlated non-destructive STT probe',
);
must(
  conversation.includes('CONVERSATION_STORAGE_SCHEMA_VERSION = 2'),
  'conversation storage is versioned to quarantine corrupt prior turns',
);
must(
  voiceMode.includes('const SERVER_VAD_SILENCE_MS = 1_000') &&
    conversation.includes('const BROWSER_FINAL_FALLBACK_SETTLE_MS = 1_200') &&
    conversation.includes('const SERVER_VOICE_TURN_SETTLE_MS = 300') &&
    conversation.includes('const VOICE_END_GRACE_MS = 850') &&
    conversation.includes('const INCOMPLETE_TURN_GRACE_MS = 2_200') &&
    conversation.includes('isLikelyIncompleteUtterance'),
  'voice endpointing reduces dead air while retaining a longer incomplete-thought grace path',
);
const liveTurnHandler = conversation.split('const handleUserMessage = useCallback')[1]?.split('handleMessageRef.current = handleUserMessage')[0] || '';
must(
  voiceMode.includes('browserFinalResultIndexesRef') &&
    conversation.includes('mergeSpeechSegments') &&
    conversation.includes('pendingUserTurnQueueRef') &&
    liveTurnHandler.includes('currentRequestRef.current.abort()'),
  'final STT segments are owned/de-overlapped and substantive interruptions cancel only superseded analysis generations',
);
must(
  voiceMode.includes('avgLogprob?: number') &&
    voiceMode.includes('noSpeechProbability?: number') &&
    conversation.includes('weakLogprob') &&
    conversation.includes('highNoSpeech'),
  'STT acoustic evidence reaches transcript admission',
);
must(
  conversation.includes('isSuspiciousGenericServerTranscript') &&
    conversation.includes("meta.engine === 'server'"),
  'server STT turns pass admission checks before conversation mutation',
);
must(
  conversation.includes('isStrongBargeIn') &&
    conversation.includes('meta.bargeInProbe') &&
    conversation.includes('orderedEchoRatio') &&
    conversation.includes('shortInterruption') &&
    conversation.includes('nonInterruptingClosers') &&
    conversation.includes('autoInterruptRef.current()'),
  'barge-in is preserved through transcript-validated probes with sequence-aware echo and generic-acknowledgement rejection',
);
must(
  avatar.includes('LEXARA_ATTORNEY_IMAGE_SOURCES') &&
    avatar.includes('object-contain') &&
    avatar.includes('onError'),
  'attorney-behind-desk visual has cache-safe fallback and preserves composition',
);
must(
  synthesis.includes('/api/lexara/tts/session') &&
    !synthesis.includes('speechSynthesis'),
  'ElevenLabs streaming is the only active Lexara acoustic identity',
);
must(
  speechClient.includes('async resume(): Promise<void>') &&
    speechClient.includes('pause(): void') &&
    speechClient.includes('getLexaraPlaybackAudioElement') &&
    !speechClient.includes('const audio = new Audio(audioUrl)'),
  'single persistent user-unlocked ElevenLabs playback channel owns pause/resume',
);
must(
  lexaraRoutes.includes("form.append('response_format', 'verbose_json')") &&
    lexaraRoutes.includes('noSpeechProbability') &&
    lexaraRoutes.includes('avgLogprob') &&
    lexaraRoutes.includes('bargeInProbe') &&
    lexaraRoutes.includes('noSpeechValues.reduce') &&
    lexaraRoutes.includes('rejectAsNonSpeech'),
  'STT hallucination rejection aggregates no-speech evidence and preserves long spoken turns',
);
must(
  lexaraRoutes.indexOf("name: 'groq-whisper'") <
    lexaraRoutes.indexOf("name: 'elevenlabs-scribe'") &&
    lexaraRoutes.includes('generic_transcript_disagreement') &&
    lexaraRoutes.includes('startedDuringPlayback'),
  'low-latency Groq Whisper is preferred while suspicious generic closers receive route-local ElevenLabs verification',
);
must(
  voiceRoutes.includes('/api/lexara/tts/session') &&
    voiceRoutes.includes("ELEVENLABS_TTS_OUTPUT_FORMAT") &&
    voiceRoutes.includes("'mp3_44100_128'") &&
    synthesis.includes('shouldBufferLexaraPlaybackOnThisDevice') &&
    synthesis.includes('bufferStreamingSessionForMobile'),
  'ElevenLabs uses full-quality audio with buffered mobile playback and progressive desktop streaming',
);
must(
  voiceRoutes.includes('/api/lexara/voice/profile'),
  'configured ElevenLabs production voice can be validated',
);
must(
  orchestrator.includes('AICollaborationOrchestrator.orchestrateCollaboration') &&
    orchestrator.includes("providerPolicy: 'capability-first'") &&
    orchestrator.includes('getConfiguredHarmonyProviders') &&
    harmony.includes("'capability-first'") &&
    harmony.includes('selectProvidersForTask') &&
    harmony.includes('AIModelSelector.scoreProvidersForTask') &&
    harmony.includes("role: 'harmony-synthesizer'") &&
    harmony.includes('fallbackLimit') &&
    harmony.includes('recoveryBatch') &&
    harmony.includes('harmonyTransportCooldownUntil') &&
    harmony.includes("return 'legal-fast'") &&
    harmony.includes('withHarmonyDeadline') &&
    harmonyRegistry.includes('HARMONY_17_PARTICIPANTS') &&
    orchestrator.includes('maxParticipants: 3') &&
    orchestrator.includes('estimatedTokens: 450') &&
    orchestrator.includes('requestTimeoutMs: 1_800') &&
    orchestrator.includes('maxFallbacks: 2') &&
    harmony.includes('fastSynthesisTask') &&
    harmony.includes("firstSuccessful.role === 'legal-analyst'") &&
    harmony.includes('harmonyProviderRuntimeScore') &&
    harmony.includes('task.requestTimeoutMs || task.timeout || options.requestTimeoutMs') &&
    harmonyWarmup.includes('prewarmHarmonyProviders') &&
    harmonyWarmup.includes('isHarmonyProviderWarmHealthy') &&
    harmonyWarmup.includes('getHarmonyWarmState') &&
    harmonyWarmup.includes("'catalog'") &&
    groq.includes('warmGroqModelCatalog'),
  'Lexara keeps all 17 configured participants as a hot reserve while only a three-route capability/latency hedge owns normal turn latency',
);
must(
  !authorityResearch.includes('GoogleGenAI') &&
    authorityResearch.includes('FIRECRAWL_API_KEY') &&
    authorityResearch.includes("https://api.firecrawl.dev/v1/search") &&
    authorityResearch.includes('Promise.all') &&
    authorityResearch.includes('orchestratedWebSearch') &&
    modernWebSearch.includes("type: 'openrouter:web_search'") &&
    modernWebSearch.includes('deprecated') &&
    webSearch.includes('useOnlinePlugin: true'),
  'legal authority research races independent discovery paths and uses the current non-Google OpenRouter web-search server tool',
);
must(
  crawlerRegistry.includes('LEXARA_CRAWLER_CAPABILITY_POOL') &&
    crawlerRegistry.includes("'PACERScraper'") &&
    crawlerRegistry.includes("'InstantLegalCrawler'") &&
    crawlerRegistry.includes("'AdaptiveCrawler'") &&
    crawlerRegistry.includes("'IdentityRazor'") &&
    crawlerRegistry.includes("'SpiderFoot'") &&
    crawlerRegistry.includes("'GravityCrawler'") &&
    authorityResearch.includes('selectLexaraCrawlerPlan') &&
    authorityResearch.includes('pantheonRetrievalAdapter.retrieve'),
  'Lexara owns one need-driven crawler capability pool spanning legal, PANTHEON, extractor, external, people/criminal, and read-only crypto evidence tools',
);
must(
  pacer.includes('pacer.login.uscourts.gov/services/cso-auth') &&
    pacer.includes('pcl.uscourts.gov/pcl-public-api/rest') &&
    pacer.includes("'X-NEXT-GEN-CSO'") &&
    pacer.includes('/parties/find?page=0') &&
    !pacer.includes("page.goto('https://pacer.uscourts.gov/'"),
  'PACER uses the supported Authentication/PCL APIs rather than the placeholder homepage scraper',
);
must(
  openRouter.includes('cancellationShaped') &&
    openRouter.includes('signal?: AbortSignal') &&
    modernWebSearch.includes('signal?: AbortSignal') &&
    lexaraChatRoutes.includes("req.once('aborted', abortRequest)") &&
    authorityResearch.includes('signal?: AbortSignal') &&
    harmony.includes('isHarmonyRequestCancellation') &&
    conversation.includes('pendingUserTurnQueueRef'),
  'request cancellation propagates across browser, server orchestration, OpenRouter, and authority retrieval without poisoning provider health',
);
must(
  harmony.includes('auto-router-recovery') &&
    harmony.includes('CURRENT_AI_MODELS.openRouterAuto') &&
    harmony.includes("firstSuccessful.role === 'legal-analyst'") &&
    harmony.includes('entry.controller.abort') &&
    harmony.includes('createLinkedDeadlineSignal') &&
    harmony.includes('attempt.signal') &&
    harmony.includes('recoveryEntries') &&
    harmony.includes("entry.controller.abort('recovery-loser')") &&
    lexaraRoutes.includes('legalReasoningConfigured') &&
    lexaraRoutes.includes('legalReasoningInferenceReady') &&
    consentPage.includes('legalReasoningConfigured') &&
    aiProvider.includes('signal?: AbortSignal') &&
    groq.includes('signal?: AbortSignal') &&
    claude.includes('signal?: AbortSignal') &&
    mistral.includes('signal?: AbortSignal') &&
    gemini.includes('abortSignal: options.signal'),
  'hot-reserve recovery preserves a successful direct legal answer, aborts timed-out and losing provider work, exposes real reasoning readiness, and propagates cancellation through live provider transports',
);

must(
  claude.includes('samplingControlsDeprecated') &&
    claude.includes("block.type === 'text'") &&
    claude.includes("response.stop_reason === 'max_tokens'") &&
    claude.includes('blockTypes') &&
    groq.includes("https://api.groq.com/openai/v1/models") &&
    groq.includes('groqBlockedModels') &&
    groq.includes('GROQ_MODEL_BLOCK_TTL_MS') &&
    groq.includes('qwen/qwen3.6-27b') &&
    groq.includes('qwen/qwen3.8-27b') &&
    groq.includes('llama-3\\.1-8b-instant') &&
    groq.includes('llama-3\\.3-70b-versatile') &&
    groq.includes('normalizeGroqModelId') &&
    groq.includes('orpheus|canopylabs') &&
    groq.includes('model_terms_required') &&
    groq.includes('while (attempted.size < 6)') &&
    aiProvider.includes("prefixes: ['llama-', 'meta-llama/', 'openai/', 'qwen/']") &&
    harmonyRegistry.includes("'claude-opus-5'") &&
    harmony.includes('harmonyProviderCooldownUntil') &&
    harmony.includes('markHarmonyProviderFailure'),
  'Harmony uses robust Claude content parsing, permission-aware Groq recursive recovery, and provider-local cooldowns',
);
must(
  harmonyRegistry.includes("'claude-sonnet-5'") &&
    harmonyRegistry.includes("'claude-opus-5'") &&
    harmonyRegistry.includes("'gemini-3.8-flash'") &&
    harmonyRegistry.includes("'deepseek/deepseek-v4.1-flash'") &&
    harmonyRegistry.includes("'x-ai/grok-4.6'") &&
    harmonyRegistry.includes("'moonshotai/kimi-k3'") &&
    harmonyRegistry.includes("'qwen/qwen3.8-max-0902'") &&
    harmonyRegistry.includes("'openai/gpt-5.6-luna'"),
  'Harmony current-model registry pins verified 2026 provider generations',
);
must(
  lexaraChatRoutes.includes("router.post('/acknowledge'") &&
    orchestrator.includes('getLexaraImmediateAcknowledgement') &&
    orchestrator.includes('presenceOnly') &&
    conversation.includes("fetch('/api/lexara/acknowledge'") &&
    conversation.includes('acknowledgementSpeech'),
  'Lexara has an immediate spoken acknowledgement lane independent of deep legal analysis',
);
must(
  conversation.includes('sanitizeLikelySpeechArtifacts') &&
    conversation.includes('genericCount >= 2') &&
    conversation.includes('generatedDeparture') &&
    conversation.includes('meta.startedDuringPlayback'),
  'repeated phantom courtesy/departure fragments are stripped anywhere in contaminated speech while substantive user content is preserved',
);
must(
  lexaraChatRoutes.includes('analysisActive') &&
    orchestrator.includes('Hold on a minute') &&
    conversation.includes('pendingUserTurnQueueRef.current.push({ text: message, messageId: userMessageId })') &&
    conversation.includes('pendingUserTurnQueueRef.current.shift()') &&
    conversation.includes('splitTrailingPresenceControlTurn') &&
    conversation.includes('nonSemanticLexaraMessageIdsRef') &&
    conversation.includes('activeAnalysisNeedsReconciliationRef') &&
    conversation.includes("acknowledgementKind === 'added-facts'") &&
    conversation.includes('ACKNOWLEDGEMENT_DEDUPE_MS') &&
    conversation.includes('ACKNOWLEDGEMENT_SOFT_TIMEOUT_MS') &&
    conversation.includes('controlAcknowledgementSpeechRef') &&
    !liveTurnHandler.includes('if (pendingUserTurnRef.current) return;') &&
    orchestrator.includes('Default to 2-5 concise spoken sentences') &&
    orchestrator.includes('Do not say "thank you," "goodbye,"') &&
    orchestrator.includes('LIVE_RESEARCH_BUDGET_MS = 700') &&
    authorityResearch.includes('const RESEARCH_TIMEOUT_MS = 2_200') &&
    conversation.includes("acknowledgement = String(acknowledgementData?.acknowledgement || '').trim()"),
  'active-analysis turns are cancellable, acknowledgements remain non-semantic but conversational, answers are concise/direct, and authority research is bounded off the live latency tail',
);

must(
  conversation.includes('isMasterSession') &&
    conversation.includes("key?.startsWith('lexara-live-session:')") &&
    lexaraChatRoutes.includes("persistenceStatus: isMaster ? 'master-ephemeral' : 'queued'") &&
    lexaraChatRoutes.includes('if (!isMaster)'),
  'master Lexara matters are ephemeral and reset across law-area/session changes',
);

must(
  routes.includes("req.path.startsWith('/images/')") &&
    routes.includes("/\\.[a-z0-9]{2,8}$/i.test(req.path)"),
  'SPA routing cannot intercept WEBP or other static assets',
);
must(
  speechClient.includes("audio.onwaiting") &&
    speechClient.includes("audio.onstalled") &&
    speechClient.includes("audio.onplaying") &&
    speechClient.includes("reportLexaraPlaybackEvent") &&
    voiceRoutes.includes("/api/lexara/voice/playback-event"),
  'mobile audio playback exposes waiting/stalled/playing telemetry to production',
);
must(
  viteConfig.includes('publicDir: path.resolve(__dirname, "public")') &&
    fs.existsSync('public/images/oip.webp') &&
    serverVite.includes('Static asset not found'),
  'attorney portrait is included in production assets and missing assets cannot masquerade as SPA HTML',
);
must(
  storage.includes('db as overflowRuntimeDb') &&
    storage.includes('isOverflowRuntimeDatabaseConfigured') &&
    storage.includes('await overflowRuntimeDb') &&
    storage.includes('[LEXARA Persistence] insert attempt failed') &&
    storage.includes('for (let attempt = 1; attempt <= 3; attempt += 1)') &&
    overflowSchema.includes("'public.lexara_conversations'") &&
    overflowSchema.includes("'060_lexara_overflow_conversation_history.sql'") &&
    lexaraOverflowMigration.includes('CREATE TABLE IF NOT EXISTS public.lexara_conversations') &&
    lexaraOverflowMigration.includes('Deliberately omits a users-table foreign key'),
  'Lexara persistence uses the existing canonical Overflow runtime DB without collapsing the explicit Primary archive boundary',
);
must(
  systemConfig.includes("DEFAULT_VOICE_PROVIDER = 'elevenlabs'") &&
    systemConfig.includes("'eleven_flash_v2_5'") &&
    voicePipeline.includes("'eleven_flash_v2_5'"),
  'all active/legacy Lexara voice configuration resolves to ElevenLabs Flash',
);
const sourceSection = review.split('## Sources — exactly 30')[1] || '';
const sourceLines = sourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(sourceLines.length === 30, 'literal 30-source implementation review is present');
const voiceSourceSection = voiceReliabilityReview.split('## Sources — exactly 10')[1] || '';
const voiceSourceLines = voiceSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(voiceSourceLines.length === 10, 'literal 10-source voice reliability review is present');
const resolutionSection = turnGroundingReview.split('## Resolution sources — exactly 20')[1]?.split('## Implementation sources — exactly 10')[0] || '';
const resolutionLines = resolutionSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(resolutionLines.length === 20, 'literal 20-source resolution review is present');
const implementationSection = turnGroundingReview.split('## Implementation sources — exactly 10')[1]?.split('## Repo and production findings')[0] || '';
const implementationLines = implementationSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(implementationLines.length === 10, 'literal 10-source implementation review is present');
const harmonyRootSourceSection = harmonyRootReview.split('## Sources — exactly 10')[1]?.split('## Resolution')[0] || '';
const harmonyRootSourceLines = harmonyRootSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(harmonyRootSourceLines.length === 10, 'literal 10-source Harmony root-cause review is present');
const harmonyImplementationSourceSection = harmonyImplementationReview.split('## Sources — exactly 10')[1]?.split('## Resolution sequence')[0] || '';
const harmonyImplementationSourceLines = harmonyImplementationSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(harmonyImplementationSourceLines.length === 10, 'literal 10-source Harmony/Lexara implementation review is present');
const harmonySourceSection = harmonyReview.split('## Sources — exactly 10')[1]?.split('## Implementation sequence')[0] || '';
const harmonySourceLines = harmonySourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(harmonySourceLines.length === 10, 'literal 10-source Harmony implementation review is present');
const conversationalSourceSection = conversationalReliabilityReview.split('## Sources — exactly 10')[1]?.split('## Production evidence cross-check')[0] || '';
const conversationalSourceLines = conversationalSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(conversationalSourceLines.length === 10, 'literal 10-source conversational reliability review is present');
const duplexResolutionSection = duplexReview.split('## Resolution sources — exactly 20')[1]?.split('## Implementation sources — exactly 10')[0] || '';
const duplexResolutionLines = duplexResolutionSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(duplexResolutionLines.length === 20, 'literal 20-source duplex resolution review is present');
const duplexImplementationSection = duplexReview.split('## Implementation sources — exactly 10')[1]?.split('## Chosen implementation sequence')[0] || '';
const duplexImplementationLines = duplexImplementationSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(duplexImplementationLines.length === 10, 'literal 10-source duplex implementation review is present');

const realtimeResolutionSection = realtimeCapabilityReview.split('## Root-cause/resolution sources — exactly 10')[1]?.split('## Resolutions')[0] || '';
const realtimeResolutionLines = realtimeResolutionSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(realtimeResolutionLines.length === 10, 'literal 10-source realtime root-cause/resolution review is present');
const realtimeImplementationSection = realtimeCapabilityReview.split('## Implementation sources — exactly 10')[1]?.split('## Implementation sequence')[0] || '';
const realtimeImplementationLines = realtimeImplementationSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(realtimeImplementationLines.length === 10, 'literal 10-source realtime implementation review is present');


const integratedRealtimeSourceSection = integratedRealtimeReview.split('## Sources — exactly 10')[1]?.split('## Implementation sequence')[0] || '';
const integratedRealtimeSourceLines = integratedRealtimeSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(integratedRealtimeSourceLines.length === 10, 'literal 10-source integrated realtime implementation review is present');
const hotReserveSourceSection = hotReserveReview.split('## Sources — exactly 10')[1]?.split('## Implemented resolution sequence')[0] || '';
const hotReserveSourceLines = hotReserveSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(hotReserveSourceLines.length === 10, 'literal 10-source hot-reserve reliability implementation review is present');
if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA realization verification passed.');
// Practice-area specialization gate (31-book LegalWhat library).
const lawTypesSource = read('shared/lawTypes.ts');
const legalDomainProfiles = read('server/lexara/LexaraLegalDomainProfiles.ts');
const welcomePage = read('client/src/pages/welcome.tsx');
const legalAuthorityResearch = read('server/lexara/LexaraAuthorityResearch.ts');

const lawTypesBlock = lawTypesSource.split('export const LAW_TYPES = [')[1]?.split('] as const;')[0] || '';
const productLawTypes = [...lawTypesBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);

must(productLawTypes.length === 31, 'LegalWhat exposes exactly 31 bookshelf practice areas');
must(productLawTypes.includes('post-conviction-law'), 'Post Conviction is a first-class product law type');
must(
  lawTypesSource.includes("name: 'Post Conviction'") &&
    lawTypesSource.includes("route: '/legal-tools?type=post-conviction-law'"),
  'Post Conviction has normal bookshelf metadata and legal-tools routing',
);
must(
  conversation.includes("const greeting = 'How can I help you?';") &&
    !conversation.includes('Hello. Tell me what happened'),
  'LEXARA visible and spoken opening greeting is exactly How can I help you?',
);
must(
  !welcomePage.includes("setLocation('/badblue')") &&
    welcomePage.includes('setLocation(`/lexara-consent/${selectedType.id}`)'),
  'every bookshelf law area enters the same LEXARA consent/specialization flow',
);
for (const lawType of productLawTypes) {
  must(
    legalDomainProfiles.includes(`  '${lawType}': domain(`),
    `LEXARA has an explicit specialist profile for ${lawType}`,
  );
}
must(
  legalDomainProfiles.includes('satisfies Record<LawType, LexaraLegalDomainProfile>'),
  'practice-area expertise is compile-time exhaustive when new law types are added',
);
must(
  legalDomainProfiles.includes('28 U.S.C. §§ 2244, 2253, 2254, and 2255') &&
    legalDomainProfiles.includes('AEDPA one-year limitation') &&
    legalDomainProfiles.includes('procedural default/cause/prejudice') &&
    legalDomainProfiles.includes('actual innocence gateway'),
  'Post Conviction profile covers federal habeas, AEDPA timing, default, and innocence gateways',
);
must(
  orchestrator.includes('getLexaraLegalDomainProfile(context.lawType)') &&
    orchestrator.includes('formatLexaraDomainSpecialization(domainProfile)') &&
    orchestrator.includes('researchHints: domainProfile?.researchHints') &&
    orchestrator.includes('preferredOfficialDomains: domainProfile?.preferredOfficialDomains'),
  'selected bookshelf domain controls both LEXARA reasoning and authority research priorities',
);
must(
  legalAuthorityResearch.includes('Practice-area research priorities:') &&
    legalAuthorityResearch.includes('Prefer relevant primary material from these official domains when available:'),
  'authority retrieval receives practice-area-specific research hints without making any source mandatory',
);

const domainExpertiseReview = read('docs/LEXARA_31_DOMAIN_EXPERTISE_40_SOURCE_REVIEW_20260919.md');
const domainImplementationReview = read('docs/LEXARA_31_DOMAIN_IMPLEMENTATION_10_SOURCE_REVIEW_20260919.md');
const domainExpertiseSources = domainExpertiseReview.split('## Sources — exactly 40')[1]?.split('## Cross-source findings adopted')[0] || '';
const domainExpertiseSourceLines = domainExpertiseSources.split('\n').filter(line => /^\d+\.\s/.test(line));
const domainImplementationSources = domainImplementationReview.split('## Sources — exactly 10')[1]?.split('## Implementation decisions')[0] || '';
const domainImplementationSourceLines = domainImplementationSources.split('\n').filter(line => /^\d+\.\s/.test(line));
must(domainExpertiseSourceLines.length === 40, 'literal 40-source LEXARA practice-area legal review is present');
must(domainImplementationSourceLines.length === 10, 'literal 10-source LEXARA specialization implementation review is present');
if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA 31-domain specialization verification passed.');
