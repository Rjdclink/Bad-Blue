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
const voiceRoutes = read('server/routes/voice.routes.ts');
const orchestrator = read('server/lexara/LexaraConversationOrchestrator.ts');
const openRouter = read('server/openRouterService.ts');
const authorityResearch = read('server/lexara/LexaraAuthorityResearch.ts');
const webSearch = read('server/webSearchService.ts');
const viteConfig = read('vite.config.ts');
const serverVite = read('server/vite.ts');
const systemConfig = read('server/systemConfig.ts');
const voicePipeline = read('server/lexara/LexaraVoicePipeline.ts');
const review = read('docs/LEXARA_INTENT_REALIZATION_30_SOURCE_REVIEW_20260918.md');
const voiceReliabilityReview = read('docs/LEXARA_VOICE_RELIABILITY_10_SOURCE_REVIEW_20260918.md');
const turnGroundingReview = read('docs/LEXARA_TURN_GROUNDING_30_SOURCE_REVIEW_20260918.md');
const harmonyReview = read('docs/LEXARA_HARMONY_STATIC_VOICE_10_SOURCE_REVIEW_20260918.md');
const harmony = read('server/aiCollaborationOrchestrator.ts');
const claude = read('server/claude.ts');
const groq = read('server/groq.ts');
const routes = read('server/routes.ts');
const config = read('server/config.ts');
const db = read('server/db.ts');
const storage = read('server/storage.ts');
const aiProvider = read('server/aiProvider.ts');
const conversationalReliabilityReview = read('docs/LEXARA_CONVERSATIONAL_RELIABILITY_10_SOURCE_REVIEW_20260918.md');

must(
  voiceMode.includes('preferServerRecognition') &&
    voiceMode.includes('/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)') &&
    voiceMode.includes("engineRef.current = 'server'"),
  'mobile voice uses controllable server endpointing while desktop retains browser recognition',
);
must(
  voiceMode.includes('serverEchoCancellationRef') &&
    voiceMode.includes("optionsRef.current.onVoiceStart?.({") &&
    conversation.includes('bargeInCandidateTimerRef') &&
    conversation.includes("meta.echoCancellation === true"),
  'sustained echo-cancelled server voice activity can yield the floor without raw-noise interruption',
);
must(
  conversation.includes('CONVERSATION_STORAGE_SCHEMA_VERSION = 2'),
  'conversation storage is versioned to quarantine corrupt prior turns',
);
must(
  voiceMode.includes('const SERVER_VAD_SILENCE_MS = 1_500') &&
    conversation.includes('const BROWSER_FINAL_FALLBACK_SETTLE_MS = 2_200') &&
    conversation.includes('const SERVER_VOICE_TURN_SETTLE_MS = 500') &&
    conversation.includes('const VOICE_END_GRACE_MS = 1_400') &&
    conversation.includes('const INCOMPLETE_TURN_GRACE_MS = 3_200') &&
    conversation.includes('isLikelyIncompleteUtterance'),
  'voice endpointing tolerates natural pauses and defers incomplete thoughts before reasoning',
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
    conversation.includes("if (phaseRef.current === 'speaking')") &&
    conversation.includes('orderedEchoRatio') &&
    conversation.includes('autoInterruptRef.current()'),
  'barge-in is preserved with final acoustic evidence and sequence-aware echo rejection',
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
    lexaraRoutes.includes('avgLogprob'),
  'STT hallucination rejection uses speech evidence before acceptance',
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
    orchestrator.includes("providerPolicy: 'capability-first-no-google'") &&
    orchestrator.includes('getLexaraHarmonyProviders') &&
    !orchestrator.includes("providers.push(AIProvider.GEMINI)") &&
    harmony.includes("export type CollaborationProviderPolicy = 'default' | 'capability-first-no-google'") &&
    harmony.includes('fallbackProviders') &&
    harmony.includes('Promise.any'),
  'Lexara reasoning uses capability-first Harmony with route-local non-Google failover',
);
must(
  !authorityResearch.includes('GoogleGenAI') &&
    authorityResearch.includes('FIRECRAWL_API_KEY') &&
    authorityResearch.includes("https://api.firecrawl.dev/v1/search") &&
    authorityResearch.includes('orchestratedWebSearch') &&
    authorityResearch.includes('never sends a plain-text query') &&
    webSearch.includes('useOnlinePlugin: true'),
  'legal authority research separates discovery from URL-only crawling with no Google-specific dependency',
);
must(
  openRouter.includes('cancellationShaped') &&
    conversation.includes('pendingUserTurnRef'),
  'request cancellation cannot poison the live provider mesh',
);
must(
  claude.includes('samplingControlsDeprecated') &&
    groq.includes("https://api.groq.com/openai/v1/models") &&
    groq.includes('groqBlockedModels') &&
    aiProvider.includes("prefixes: ['llama-', 'meta-llama/', 'openai/', 'qwen/']") &&
    harmony.includes("'claude-opus-5'") &&
    harmony.includes('harmonyProviderCooldownUntil') &&
    harmony.includes('markHarmonyProviderFailure'),
  'Harmony uses active Claude IDs, Groq project-aware model recovery, and provider-local cooldowns',
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
  config.includes('SUPABASE_DATABASE_URL_OVERFLOW') &&
    config.includes('SUPABASE_SECRET_KEY_OVERFLOW') &&
    db.includes("'lexara_conversations'") &&
    storage.includes('[LEXARA Persistence] insert attempt failed') &&
    storage.includes('for (let attempt = 1; attempt <= 3; attempt += 1)'),
  'Lexara persistence is bound to Overflow authority, schema-verified, retryable, and diagnostically complete',
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
const harmonySourceSection = harmonyReview.split('## Sources — exactly 10')[1]?.split('## Implementation sequence')[0] || '';
const harmonySourceLines = harmonySourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(harmonySourceLines.length === 10, 'literal 10-source Harmony implementation review is present');
const conversationalSourceSection = conversationalReliabilityReview.split('## Sources — exactly 10')[1]?.split('## Production evidence cross-check')[0] || '';
const conversationalSourceLines = conversationalSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(conversationalSourceLines.length === 10, 'literal 10-source conversational reliability review is present');

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA realization verification passed.');
