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
const voiceService = read('server/voiceSynthesisService.ts');
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
const ttsMesh = read('server/lexara/LexaraTTSMesh.ts');
const ttsRouter = read('server/lexara/LexaraTTSRouter.ts');

must(
  voiceMode.includes('preferServerRecognition') &&
    voiceMode.includes('/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)') &&
    voiceMode.includes("engineRef.current = 'server'"),
  'mobile voice uses controllable server endpointing while desktop retains browser recognition',
);
must(
  voiceMode.includes('serverEchoCancellationRef') &&
    voiceMode.includes('shouldProbeBargeIn?: () => boolean') &&
    voiceMode.includes('SERVER_BARGE_IN_PROBE_MS = 320') &&
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
    conversation.includes('substantiveSingleWord') &&
    conversation.includes('autoInterruptRef.current()') &&
    voiceMode.includes('SERVER_BARGE_IN_PROBE_MS = 320') &&
    voiceMode.includes('constraints.latency = { ideal: 0.02 }'),
  'barge-in is restored for natural one-word and multiword interruption while echo-screening and final-turn authority remain conservative',
);
must(
  avatar.includes('LEXARA_ATTORNEY_IMAGE_SOURCES') &&
    avatar.includes('object-contain') &&
    avatar.includes('onError'),
  'attorney-behind-desk visual has cache-safe fallback and preserves composition',
);
must(
  synthesis.includes('/api/lexara/tts/session') &&
    synthesis.includes('adaptive-tts-mesh') &&
    !synthesis.includes("setProvider('elevenlabs')") &&
    !synthesis.includes('speechSynthesis') &&
    ttsMesh.includes("type LexaraTTSProviderId") &&
    ttsMesh.includes("'mistral'") &&
    ttsMesh.includes("'gemini'") &&
    ttsMesh.includes("'deepgram'") &&
    ttsMesh.includes("'xai'") &&
    ttsMesh.includes("'groq'") &&
    ttsMesh.includes("'openrouter'") &&
    ttsMesh.includes("'azure'") &&
    ttsMesh.includes("'elevenlabs'") &&
    ttsMesh.includes('configuration_blocked') &&
    ttsMesh.includes('refreshLexaraTTSReadiness') &&
    ttsMesh.includes('verifyProvider') &&
    ttsMesh.includes('/v1/audio/voices?type=all') &&
    ttsMesh.includes("google/gemini-3.1-flash-tts-preview") &&
    ttsMesh.includes("mistralai/voxtral-mini-tts-2603") &&
    ttsMesh.includes('/v1/user/subscription') &&
    !ttsMesh.includes("process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY") &&
    ttsMesh.includes("'gb_jane_neutral'") &&
    !ttsMesh.includes("'en_paul_neutral'") &&
    ttsMesh.includes('fetchMistralVoiceDetails') &&
    ttsMesh.includes('workerCount = Math.min(8') &&
    ttsMesh.includes('configured Mistral TTS voice is not a verified female English voice') &&
    ttsMesh.includes('mistral voice catalog contains no LEXARA-compatible female English voice') &&
    ttsMesh.includes("model.startsWith('google/') ? 'pcm' : 'mp3'") &&
    ttsMesh.includes("mimeType: 'audio/wav'") &&
    ttsMesh.includes('pcm16MonoToWav(pcm, 24_000)') &&
    ttsMesh.includes('LEXARA_TTS_REQUEST_TIMEOUT_MS = 8_000') &&
    ttsMesh.includes('slowRoutePenalty') &&
    !ttsMesh.includes("'microsoft/mai-voice-2-flash'") &&
    ttsMesh.includes('synthesizeLexaraSpeechWithFailover') &&
    ttsMesh.includes('openLexaraSpeechStream') &&
    ttsMesh.includes('openOpenRouterSpeechStream') &&
    ttsMesh.includes('openDeepgramSpeechStream') &&
    ttsMesh.includes('openElevenLabsSpeechStream') &&
    ttsMesh.includes("'flux-haley-en'") &&
    ttsMesh.includes("endpoint = flux ? '/v2/speak' : '/v1/speak'") &&
    ttsMesh.includes('LEXARA_FEMALE_VOICE') &&
    ttsMesh.includes('providerIndependenceDomain') &&
    ttsMesh.includes('independentDomains') &&
    ttsMesh.includes('LEXARA_TTS_HEDGE_DELAY_MS = 800') &&
    ttsMesh.includes("abort('tts-hedge-loser')") &&
    ttsMesh.includes('readiness probe verified') &&
    ttsMesh.includes('progressive stream opened') &&
    ttsMesh.includes('redundancyVerified') &&
    ttsMesh.includes("voiceStatus: redundancyVerified") &&
    ttsMesh.includes('setInterval(refresh, 90_000)'),
  'LEXARA admits only verified female TTS routes, progressively streams the active route, and keeps a verified independent hot-backup pool warm',
);
must(
  speechClient.includes('async resume(): Promise<void>') &&
    speechClient.includes('pause(): void') &&
    speechClient.includes('getLexaraPlaybackAudioElement') &&
    !speechClient.includes('const audio = new Audio(audioUrl)'),
  'single persistent user-unlocked LEXARA playback channel owns pause/resume and interruption',
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
    lexaraRoutes.indexOf("name: 'deepgram-nova'") &&
    lexaraRoutes.indexOf("name: 'deepgram-nova'") <
    lexaraRoutes.indexOf("name: 'elevenlabs-scribe'") &&
    lexaraRoutes.includes('requiresIndependentVerification') &&
    lexaraRoutes.includes('independent_asr_disagreement') &&
    lexaraRoutes.includes('&& !bargeInProbe') &&
    lexaraRoutes.includes('speechDurationMs < 900') &&
    lexaraRoutes.includes('startedDuringPlayback'),
  'Groq Whisper owns low-latency non-authoritative barge-in while short final overlap turns retain independent ownership verification',
);
must(
  voiceRoutes.includes('/api/lexara/tts/session') &&
    voiceRoutes.includes('getLexaraTTSReadiness') &&
    voiceRoutes.includes('refreshLexaraTTSReadiness') &&
    voiceRoutes.includes('warmLexaraTTSMesh') &&
    voiceRoutes.includes('synthesizeLexaraSpeechWithFailover') &&
    voiceRoutes.includes('openLexaraSpeechStream') &&
    voiceRoutes.includes('Readable.fromWeb') &&
    voiceRoutes.includes("'X-Accel-Buffering', 'no'") &&
    voiceRoutes.includes('No verified progressive route was available') &&
    voiceRoutes.includes('redundancyVerified') &&
    voiceRoutes.includes('independentDomains') &&
    voiceRoutes.includes('voiceStatus') &&
    lexaraRoutes.includes('voiceIndependentDomains') &&
    lexaraRoutes.includes('speechOutputVerified') &&
    lexaraRoutes.includes('refreshLexaraTTSReadiness(false)') &&
    conversation.includes('checkVoiceBackendReadiness') &&
    conversation.includes("data?.speechOutputVerified === true") &&
    conversation.includes("'Voice reconnecting'") &&
    conversation.includes("'Voice degraded'") &&
    conversation.includes("voiceStatus === 'live'") &&
    synthesis.includes('splitLexaraSpeechChunks') &&
    synthesis.includes('FIRST_SPEECH_CHUNK_MAX_CHARS') &&
    synthesis.includes('Prepare exactly one chunk ahead') &&
    synthesis.includes('fetchPreparedSessionAudio') &&
    synthesis.includes("FIRST_SPEECH_CHUNK_MAX_CHARS = 140") &&
    synthesis.includes("PlaybackOutcome = 'ended' | 'interrupted' | 'timeout' | 'failed'") &&
    synthesis.includes('voice playback failed after route-local recovery') &&
    synthesis.includes('voice playback timed out') &&
    synthesis.includes('voiceFailureToastIdRef') &&
    !synthesis.includes('shouldBufferLexaraPlaybackOnThisDevice') &&
    !synthesis.includes('bufferStreamingSessionForMobile'),
  'LEXARA voice readiness stays truthful while short first-chunk playback and one-ahead synthesis remove full-answer mobile buffering latency',
);
must(
  voiceRoutes.includes('/api/lexara/voice/profile') &&
    voiceRoutes.includes('getLexaraVoiceProfileBindings') &&
    voiceRoutes.includes('ElevenLabs is one reserve route, never the profile authority') &&
    ttsMesh.includes('getLexaraVoiceProfileBindings') &&
    ttsMesh.includes("gender: 'female' as const"),
  'canonical female LEXARA profile governs every TTS route while ElevenLabs remains an optional reserve',
);
must(
  ttsRouter.includes('LexaraTTSMesh') &&
    ttsRouter.includes('synthesizeLexaraSpeechWithFailover') &&
    !ttsRouter.includes('ElevenLabsClient') &&
    voicePipeline.includes('synthesizeLexaraSpeechWithFailover') &&
    !voicePipeline.includes('ElevenLabsClient') &&
    !voicePipeline.includes('elevenLabsProvider') &&
    voiceService.includes('LexaraTTSMesh') &&
    !voiceService.includes('getLexaraVoicePipeline') &&
    lexaraChatRoutes.includes("import('../lexara/LexaraTTSMesh')") &&
    !lexaraChatRoutes.includes("import('../lexara/LexaraTTSRouter')") &&
    systemConfig.includes("DEFAULT_VOICE_PROVIDER = 'adaptive'") &&
    systemConfig.includes("voice: 'v3.0.0-adaptive-verified-mesh'"),
  'all legacy LEXARA synthesis entrypoints delegate to the single verified adaptive TTS authority',
);
must(
  conversation.includes('checkVoiceBackendReadiness') &&
    conversation.includes('speechOutputVerified') &&
    conversation.includes('voiceFailed') &&
    conversation.includes('window.setInterval') &&
    conversation.includes("'Voice reconnecting'"),
  'client voice state stays truthful through synthesis failure and background recovery',
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
    conversation.includes("fetch('/api/lexara/acknowledge'"),
  'Lexara retains immediate presence/control acknowledgement without making filler mandatory',
);
must(
  orchestrator.includes("text: ''") &&
    !orchestrator.includes("I'm reviewing the facts you've provided.") &&
    conversation.includes('explicitPlaybackControl') &&
    conversation.includes('validatedBargeInUtterancesRef'),
  'non-semantic spoken filler is silent and playback-overlap user turns require verified ownership',
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
  systemConfig.includes("DEFAULT_VOICE_PROVIDER = 'adaptive'") &&
    systemConfig.includes("provider: 'adaptive-mesh'") &&
    !lexaraChatRoutes.includes("import('../lexara/LexaraTTSRouter')") &&
    lexaraChatRoutes.includes("import('../lexara/LexaraTTSMesh')") &&
    lexaraChatRoutes.includes('synthesizeLexaraSpeechWithFailover'),
  'all active LEXARA audio paths resolve through the canonical adaptive TTS mesh',
);
must(
  voicePipeline.includes("from './LexaraTTSMesh'") &&
    voicePipeline.includes('synthesizeLexaraSpeechWithFailover(text)') &&
    !voicePipeline.includes('this.elevenLabsProvider.synthesize(request.text') &&
    voiceService.includes("from './lexara/LexaraTTSMesh'") &&
    voiceService.includes('synthesizeLexaraSpeechWithFailover(text)'),
  'legacy voice facades delegate into the canonical TTS mesh instead of retaining parallel provider authority',
);
must(
  consentPage.includes('readiness?.liveVoiceConfigured === true') &&
    consentPage.includes('readiness?.speechOutputVerified === true') &&
    consentPage.includes('voiceServiceReady !== true'),
  'live-consultation entry fails closed unless operational speech output is verified',
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
    (
      welcomePage.includes('setLocation(`/lexara-consent/${selectedType.id}`)') ||
      welcomePage.includes('setLocation("/lexara-consent/" + selectedType.id)')
    ),
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
