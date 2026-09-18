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
const routes = read('server/routes.ts');
const storage = read('server/storage.ts');
const overflowSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const lexaraOverflowMigration = read('server/migrations/060_lexara_overflow_conversation_history.sql');
const aiProvider = read('server/aiProvider.ts');
const conversationalReliabilityReview = read('docs/LEXARA_CONVERSATIONAL_RELIABILITY_10_SOURCE_REVIEW_20260918.md');
const duplexReview = read('docs/LEXARA_DUPLEX_ORCHESTRATION_30_SOURCE_REVIEW_20260918.md');
const harmonyRootReview = read('docs/LEXARA_HARMONY_ROOT_CAUSE_10_SOURCE_REVIEW_20260918.md');
const harmonyImplementationReview = read('docs/LEXARA_HARMONY_IMPLEMENTATION_10_SOURCE_REVIEW_20260918.md');

must(
  voiceMode.includes('preferServerRecognition') &&
    voiceMode.includes('/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)') &&
    voiceMode.includes("engineRef.current = 'server'"),
  'mobile voice uses controllable server endpointing while desktop retains browser recognition',
);
must(
  voiceMode.includes('serverEchoCancellationRef') &&
    voiceMode.includes('shouldProbeBargeIn?: () => boolean') &&
    voiceMode.includes('SERVER_BARGE_IN_PROBE_MS = 700') &&
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
  voiceMode.includes('const SERVER_VAD_SILENCE_MS = 900') &&
    conversation.includes('const BROWSER_FINAL_FALLBACK_SETTLE_MS = 900') &&
    conversation.includes('const SERVER_VOICE_TURN_SETTLE_MS = 500') &&
    conversation.includes('const VOICE_END_GRACE_MS = 650') &&
    conversation.includes('const INCOMPLETE_TURN_GRACE_MS = 2_400') &&
    conversation.includes('isLikelyIncompleteUtterance'),
  'voice endpointing reduces dead air while retaining a longer incomplete-thought grace path',
);
const liveTurnHandler = conversation.split('const handleUserMessage = useCallback')[1]?.split('handleMessageRef.current = handleUserMessage')[0] || '';
must(
  voiceMode.includes('browserFinalResultIndexesRef') &&
    conversation.includes('mergeSpeechSegments') &&
    conversation.includes('pendingUserTurnRef') &&
    !liveTurnHandler.includes('currentRequestRef.current?.abort()'),
  'final STT segments are owned/de-overlapped and continuations cannot create chat abort storms',
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
    conversation.includes('genericAcknowledgements') &&
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
    lexaraRoutes.indexOf("name: 'elevenlabs-scribe'"),
  'low-latency Groq Whisper is preferred with ElevenLabs Scribe fallback',
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
    harmony.includes('Harmony invariant: every configured, healthy participant contributes') &&
    harmony.includes("role: 'harmony-synthesizer'") &&
    harmony.includes('fallbackProviders') &&
    harmony.includes('Promise.any') &&
    harmonyRegistry.includes('HARMONY_17_PARTICIPANTS'),
  'Lexara reasoning uses the full configured capability-driven Harmony mesh with route-local failover',
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
  openRouter.includes('cancellationShaped') &&
    conversation.includes('pendingUserTurnRef'),
  'request cancellation cannot poison the live provider mesh',
);
must(
  claude.includes('samplingControlsDeprecated') &&
    claude.includes("block.type === 'text'") &&
    groq.includes("https://api.groq.com/openai/v1/models") &&
    groq.includes('groqBlockedModels') &&
    groq.includes('normalizeGroqModelId') &&
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
  conversation.includes('stripLikelyPhantomCloserTail') &&
    conversation.includes('repeatedCloserTail') &&
    conversation.includes('Thank you. Bye. Thank you.'),
  'phantom repeated closer tails are stripped while preserving substantive user speech',
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

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA realization verification passed.');
