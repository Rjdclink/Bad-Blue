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
const representationEngine = read('server/lexara/LexaraRepresentationEngine.ts');
const matterStorage = read('server/lexara/LexaraMatterStorage.ts');
const fmiRoutes = read('server/routes/fmi.routes.ts');
const landingPage = read('client/src/pages/landing.tsx');
const avatar = read('client/src/components/LexaraEtherealAvatar.tsx');
const viewport = read('client/src/components/LexaraViewport.tsx');
const embodimentEngine = read('client/src/lib/lexaraEmbodimentEngine.ts');
const preparedFacePoses = read('client/src/lib/lexaraPreparedFacePoses.ts');
const synthesis = read('client/src/hooks/useVoiceSynthesis.ts');
const speechClient = read('client/src/lib/lexaraSpeechClient.ts');
const lexaraLocation = read('client/src/lib/lexaraLocation.ts');
const jurisdictionResolver = read('server/lexara/LexaraJurisdictionResolver.ts');
must(synthesis.includes('FIRST_SPEECH_CHUNK_MAX_CHARS = 140'), 'LEXARA must preserve bounded first-audible speech unit');
must(synthesis.includes('firstSpeechChunk(text)'), 'LEXARA must start a bounded first speech unit before long-answer buffering');
must(synthesis.includes('remainingUnit'), 'LEXARA must preserve the remainder of the answer after first-audible playback');
must(
  synthesis.includes('lexaraRealtimeVoiceClient.ensureSpeechOutputReady()') &&
    synthesis.includes('if (realtimeOutputReady)') &&
    synthesis.includes('await lexaraRealtimeVoiceClient.speak(') &&
    synthesis.indexOf('lexaraRealtimeVoiceClient.ensureSpeechOutputReady()') < synthesis.indexOf('await speakWithServer(cleanText, options, turnId)'),
  'LEXARA must verify and use the prewarmed realtime acoustic path before progressive media fallback',
);
const realtimeVoiceClient = read('client/src/lib/lexaraRealtimeVoiceClient.ts');
const lexaraConversationOrchestrator = read('server/lexara/LexaraConversationOrchestrator.ts');
const lexaraPantheonInvestigation = read('server/lexara/LexaraPantheonInvestigation.ts');
const lexaraBackgroundInvestigation = read('server/lexara/LexaraBackgroundInvestigation.ts');
const inmateSearchAggregator = read('server/services/inmateSearch/InmateSearchAggregator.ts');
const liveAvatarReview = read('docs/LEXARA_LIVE_AVATAR_100_SOURCE_REVIEW_20260920.md');
const embodiedConversationReview = read('docs/LEXARA_EMBODIED_CONVERSATION_50_SOURCE_BLUEPRINT_20260920.md');
const realtimeVoiceGateway = read('server/lexara/LexaraRealtimeVoiceGateway.ts');
const serverIndex = read('server/index.ts');
const lexaraRoutes = read('server/routes/lexara.routes.ts');
const lexaraChatRoutes = read('server/routes/lexara.chat.routes.ts');
const legalDocumentRegistry = read('server/lexara/legalDocumentRegistry.ts');
const consultationRoutes = read('server/routes/consultation.routes.ts');
const documentRoutes = read('server/routes/document.routes.ts');
const authSource = read('server/auth.ts');
const universalDocumentGenerator = read('server/universalDocumentGenerator.ts');
const appSource = read('client/src/App.tsx');
const loginPage = read('client/src/pages/login.tsx');
const voiceRoutes = read('server/routes/voice.routes.ts');
const orchestrator = read('server/lexara/LexaraConversationOrchestrator.ts');
const openRouter = read('server/openRouterService.ts');
const authorityResearch = read('server/lexara/LexaraAuthorityResearch.ts');
const lexaraRetrievalBoundary = read('server/lexara/LexaraRetrievalBoundary.ts');
const lexaraResearchIntent = read('server/lexara/LexaraResearchIntentRouter.ts');
const lexaraSourceRegistry = read('server/lexara/LexaraPublicSourceRegistry.ts');
const lexaraLegalMesh = read('server/lexara/LegalProviderMesh.ts');
const lexaraDiscoveryLearning = read('server/lexara/LexaraDiscoveryLearning.ts');
const lexaraResearchAssist = read('server/lexara/LexaraResearchAssist.ts');
const pantheonInvestigation = read('server/lexara/LexaraPantheonInvestigation.ts');
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
const aiSubAgent = read('server/aiSubAgent.ts');
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
  conversation.includes('fetch(`/api/lexara/conversations/latest?${params}`') &&
    conversation.includes('if (!historyReadyRef.current) return;') &&
    !conversation.includes('loadStoredConversation('),
  'signed-in Lexara history restores from owner-scoped server storage before new turns can begin',
);
must(
  voiceMode.includes('SERVER_VAD_MIN_SILENCE_MS = 1_800') &&
    voiceMode.includes('SERVER_VAD_MAX_SILENCE_MS = 3_200') &&
    voiceMode.includes('fallbackSilenceWindowMs') &&
    voiceMode.includes('initializeRealtimeRecognition') &&
    voiceMode.includes("provider: 'deepgram-flux'") &&
    conversation.includes('const BROWSER_FINAL_FALLBACK_SETTLE_MS = 1_200') &&
    conversation.includes('Choose DOCX or PDF to generate your draft and download it.') &&
    conversation.includes('generateAndDownloadPendingDocument') &&
    conversation.includes("fetch('/api/lexara/documents/export'") &&
    conversation.includes('URL.createObjectURL(blob)') &&
    lexaraChatRoutes.includes('const explicit =') &&
    lexaraChatRoutes.includes('const currentType = resolveLegalDocumentType(prompt)') &&
    lexaraChatRoutes.includes('Current-turn document language is authoritative') &&
    orchestrator.includes('Default to 1-3 concise sentences') &&
    orchestrator.includes('Never invent, print, or suggest a document URL') &&
    conversation.includes('const SERVER_VOICE_TURN_SETTLE_MS = 300') &&
    conversation.includes('const FLUX_FINAL_SETTLE_MS = 1_200') &&
    conversation.includes('const VOICE_END_GRACE_MS = 850') &&
    conversation.includes('const INCOMPLETE_TURN_GRACE_MS = 2_200') &&
    conversation.includes('isLikelyIncompleteUtterance'),
  'semantic Flux endpointing is primary on mobile while the legacy fallback waits adaptively through natural pauses',
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
    conversation.includes('nonInterruptingBackchannels') &&
    conversation.includes('substantiveSingleWord') &&
    conversation.includes('autoInterruptRef.current()') &&
    voiceMode.includes('SERVER_BARGE_IN_PROBE_MS = 320') &&
    voiceMode.includes('constraints.latency = { ideal: 0.02 }'),
  'barge-in is restored for natural one-word and multiword interruption while echo-screening and final-turn authority remain conservative',
);
must(
  avatar.includes("renderer: 'embodied-canvas-v2'") &&
    avatar.includes("data-live-avatar={LIVE_AVATAR_ENABLED ? 'embodied-canvas' : 'static'}") &&
    viewport.includes('LEXARAAttorneyPortrait'),
  'production Lexara viewport uses the visibly animated attorney portrait rig rather than the legacy Ethereal identity',
);

must(
  avatar.includes('LEXARA_ATTORNEY_IMAGE_SOURCES') &&
    avatar.includes('object-contain') &&
    avatar.includes('onError'),
  'attorney-behind-desk visual has cache-safe fallback and preserves composition',
);
must(
  avatar.includes('VITE_LEXARA_LIVE_AVATAR_ENABLED') &&
    avatar.includes('window.requestAnimationFrame') &&
    avatar.includes('<canvas') &&
    avatar.includes('LexaraEmbodimentEngine') &&
    avatar.includes('drawMouth') &&
    avatar.includes('drawBlink') &&
    avatar.includes("data-live-avatar={LIVE_AVATAR_ENABLED ? 'embodied-canvas' : 'static'}") &&
    avatar.includes('prefers-reduced-motion') &&
    avatar.includes('getLexaraServerPlaybackClock') &&
    avatar.includes('lexaraRealtimeVoiceClient.getPlaybackClock()') &&
    avatar.includes("style={{ contain: 'layout paint' }}") &&
    avatar.includes("'avatar-renderer-ready'") &&
    avatar.includes("'avatar-motion-started'") &&
    !avatar.includes('HEAD_MASK') &&
    !avatar.includes('MOUTH_MASK') &&
    !avatar.includes('TORSO_MASK') &&
    !avatar.includes("/api/lexara/chat") &&
    !avatar.includes("/api/lexara/tts/session"),
  'LEXARA uses a visible fail-open embodied canvas renderer rather than the retired sub-pixel CSS-mask shimmer, and visual work cannot enter the reasoning/TTS critical path',
);
must(
  embodimentEngine.includes("export type LexaraEmbodimentMode = 'idle' | 'listening' | 'thinking' | 'speaking'") &&
    embodimentEngine.includes('class OneEuroScalar') &&
    embodimentEngine.includes('scheduleBlink') &&
    embodimentEngine.includes('scheduleNod') &&
    embodimentEngine.includes('scheduleGazeShift') &&
    embodimentEngine.includes("input.mode === 'listening'") &&
    embodimentEngine.includes("input.mode === 'thinking'") &&
    embodimentEngine.includes("input.mode === 'speaking'") &&
    embodimentEngine.includes('speechClockSec') &&
    embodimentEngine.includes('mouthOpen') &&
    embodimentEngine.includes('gestureEnergy') &&
    embodimentEngine.includes('breathHold') &&
    embodimentEngine.includes('jawTension') &&
    embodimentEngine.includes('shoulderAsymmetry') &&
    embodimentEngine.includes('fidget'),
  'one persistent behavioral planner coordinates listening, thinking, speaking, gaze, blink, respiration, nod, gesture and speech-linked facial state',
);
must(
  realtimeVoiceClient.includes('getPlaybackClock():') &&
    realtimeVoiceClient.includes('playbackLevel') &&
    realtimeVoiceClient.includes('playbackBrightness') &&
    realtimeVoiceClient.includes('playbackZeroCrossingRate') &&
    realtimeVoiceClient.includes('energySum += sample * sample') &&
    realtimeVoiceClient.includes('diffEnergySum += diff * diff') &&
    realtimeVoiceClient.includes('zeroCrossings += 1') &&
    realtimeVoiceClient.includes('startThresholdFrames = Math.max(128, Math.round(sampleRate * 0.120))') &&
    speechClient.includes('getLexaraServerPlaybackClock'),
  'avatar synchronization derives mouth cues from the already-rendered realtime PCM clock and a bounded mobile jitter cushion without becoming playback authority',
);
must(
  voiceRoutes.includes("'avatar-renderer-ready'") &&
    voiceRoutes.includes("'avatar-motion-started'") &&
    voiceRoutes.includes("'avatar-renderer-error'") &&
    voiceRoutes.includes('mouthOpen:') &&
    voiceRoutes.includes('reducedMotion:'),
  'production logs can distinguish voice playback from a real rendered avatar and actual speech-linked mouth motion',
);
must(
  ttsMesh.includes("return configured('deepgram') ? ['deepgram'] : []") &&
    ttsMesh.includes("'flux-haley-en'") &&
    ttsMesh.includes("endpoint = flux ? '/v2/speak' : '/v1/speak'") &&
    ttsMesh.includes('openDeepgramSpeechStream') &&
    ttsMesh.includes('process.env.DEEPGRAM?.trim()') &&
    ttsMesh.includes('warm readiness snapshot') &&
    ttsMesh.includes('readiness probe verified') &&
    ttsMesh.includes('progressive stream opened') &&
    !ttsMesh.includes("process.env.LEXARA_TTS_ACTIVE_PROVIDERS || 'deepgram'"),
  'LEXARA voice provider selection is locked to Deepgram and cannot be re-enabled by alternate-provider environment settings',
);
must(
  speechClient.includes('async resume(): Promise<void>') &&
    speechClient.includes('pause(): void') &&
    speechClient.includes('getLexaraPlaybackAudioElement') &&
    !speechClient.includes('const audio = new Audio(audioUrl)'),
  'single persistent user-unlocked LEXARA playback channel owns pause/resume and interruption',
);
must(
  speechClient.includes("latencyHint: 'interactive'") &&
    !speechClient.includes('    audio.load();') &&
    realtimeVoiceClient.includes('CAPTURE_FRAME_MS = 80') &&
    realtimeVoiceClient.includes('AudioWorkletNode') &&
    realtimeVoiceClient.includes("'lexara-capture-processor'") &&
    realtimeVoiceClient.includes("'lexara-playback-processor'") &&
    realtimeVoiceClient.includes("type: 'tts_interrupt'") &&
    realtimeVoiceClient.includes('playbackOffsetMs') &&
    realtimeVoiceClient.includes('createMediaStreamDestination()') &&
    realtimeVoiceClient.includes('candidateAudio.srcObject = candidateDestination.stream') &&
    realtimeVoiceClient.includes('outputSampleRate: context.sampleRate') &&
    realtimeVoiceClient.includes('sessionRenderedFrames') &&
    realtimeVoiceClient.includes('interruptInFlight') &&
    realtimeVoiceClient.includes('SpeechInterrupted') &&
    realtimeVoiceClient.includes('sampleRate * 0.120') &&
    realtimeVoiceClient.includes('mobile-network jitter gap occurs') &&
    orchestrator.includes('LIVE_RESEARCH_BUDGET_MS = 10_000') &&
    orchestrator.includes('LIVE_REASONING_PROVIDER_ATTEMPT_MS = 15_000') &&
    !orchestrator.includes('LIVE_REASONING_MAX_FALLBACKS') &&
    !realtimeVoiceClient.includes('LEXARA_REALTIME_OUTPUT_SAMPLE_RATE = 24_000') &&
    realtimeVoiceClient.includes('audio.defaultPlaybackRate = 1') &&
    realtimeVoiceClient.includes('audio.playbackRate = 1') &&
    realtimeVoiceClient.includes("message.type === 'config_ack'") &&
    realtimeVoiceClient.includes('realtimeOutputSampleRate') &&
    realtimeVoiceClient.includes('sourceSampleRate: this.realtimeOutputSampleRate') &&
    realtimeVoiceClient.includes('sourceRate !== sampleRate') &&
    realtimeVoiceClient.includes("reportRealtimeVoiceEvent('realtime-clock-negotiated'") &&
    realtimeVoiceGateway.includes("url.searchParams.set('speed', '1.0')") &&
    realtimeVoiceGateway.includes("url.searchParams.set('expressivity', '0')") &&
    realtimeVoiceGateway.includes('const DEFAULT_OUTPUT_SAMPLE_RATE = 48_000') &&
    synthesis.includes('lexaraRealtimeVoiceClient.ensureSpeechOutputReady()') &&
    synthesis.includes('if (realtimeOutputReady)') &&
    synthesis.includes('await lexaraRealtimeVoiceClient.speak(cleanText') &&
    synthesis.includes('await speakWithServer(cleanText, options, turnId)') &&
    synthesis.includes('/api/lexara/tts/session'),
  'Lexara speech uses realtime Deepgram PCM when healthy while retaining the Deepgram-only server route as acoustic recovery',
);
must(
  realtimeVoiceClient.includes("reportRealtimeVoiceEvent('realtime-first-audio'") &&
    realtimeVoiceClient.includes("reportRealtimeVoiceEvent('realtime-playing'") &&
    realtimeVoiceClient.includes("reportRealtimeVoiceEvent('realtime-interrupted'") &&
    realtimeVoiceClient.includes("reportRealtimeVoiceEvent('realtime-ended'") &&
    realtimeVoiceClient.includes('startThresholdFrames') &&
    realtimeVoiceClient.includes('0.120') &&
    voiceRoutes.includes("'realtime-first-audio'") &&
    voiceRoutes.includes("'realtime-playing'") &&
    voiceRoutes.includes("'realtime-interrupted'") &&
    voiceRoutes.includes("'realtime-ended'"),
  'realtime voice measures first-audio, first-rendered-sample, interruption, and completion while buffering only a tiny jitter window',
);
must(
  realtimeVoiceGateway.includes("wss://api.deepgram.com/v2/listen") &&
    realtimeVoiceGateway.includes("wss://api.deepgram.com/v2/speak") &&
    realtimeVoiceGateway.includes("'flux-general-en'") &&
    realtimeVoiceGateway.includes("'flux-haley-en'") &&
    realtimeVoiceGateway.includes("type: 'Configure'") &&
    realtimeVoiceGateway.includes("type: 'ForceEndTurn'") &&
    realtimeVoiceGateway.includes("type: 'Speak'") &&
    realtimeVoiceGateway.includes("type: 'Flush'") &&
    realtimeVoiceGateway.includes('activeTurnId === turnId') &&
    realtimeVoiceClient.includes('beginSpeechStream') &&
    realtimeVoiceClient.includes('appendSpeechStream') &&
    realtimeVoiceClient.includes('endSpeechStream') &&
    lexaraChatRoutes.includes("send('answer-delta'") &&
    lexaraChatRoutes.includes("send('speech-chunk'") &&
    realtimeVoiceGateway.includes("type: 'Interrupt'") &&
    realtimeVoiceGateway.includes("type: 'time_ms'") &&
    realtimeVoiceGateway.includes('recentTurnIds') &&
    realtimeVoiceGateway.includes('issueLexaraRealtimeVoiceTicket') &&
    voiceRoutes.includes('/api/lexara/realtime-ticket') &&
    serverIndex.includes('attachLexaraRealtimeVoiceGateway'),
  'one authenticated persistent Flux duplex session owns semantic turns, synthesis, dedupe, and precise interruption',
);
must(
  voiceMode.includes("eventType === 'StartOfTurn'") &&
    voiceMode.includes("eventType === 'TurnResumed'") &&
    voiceMode.includes("eventType === 'EagerEndOfTurn'") &&
    conversation.includes('EagerEndOfTurn is display/preparation-only') &&
    voiceMode.includes("eventType !== 'EndOfTurn'") &&
    voiceMode.includes('serverRealtimeFallbackRef') &&
    voiceMode.includes('initializeServerRecognition(stream)') &&
    voiceMode.includes('startServerVad()') &&
    conversation.includes('keyterms: voiceKeyterms') &&
    conversation.includes("meta.provider === 'deepgram-flux'"),
  'Flux turn events graft onto existing echo/barge-in authority and automatically recover to the legacy server recognizer',
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
    conversation.includes("setVoiceStatus(ready ? 'live' : 'reconnecting')") &&
    !conversation.includes("? 'Voice degraded'") &&
    synthesis.includes('One successful Lexara turn owns sequential progressive media streams') &&
    synthesis.includes('createStreamingAudioSession(firstUnit, stableTurnId)') &&
    synthesis.includes('remainingUnit') &&
    !synthesis.includes('splitLexaraSpeechChunks') &&
    !synthesis.includes('fetchPreparedSessionAudio') &&
    !synthesis.includes('preparedCurrent') &&
    synthesis.includes("PlaybackOutcome = 'ended' | 'interrupted' | 'timeout' | 'failed'") &&
    synthesis.includes('voice playback failed after route-local recovery') &&
    synthesis.includes('voiceFailureToastIdRef') &&
    !synthesis.includes('shouldBufferLexaraPlaybackOnThisDevice') &&
    !synthesis.includes('bufferStreamingSessionForMobile'),
  'LEXARA voice readiness stays truthful while bounded sequential progressive streams own successful playback and buffered synthesis remains recovery-only',
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
  orchestrator.includes('callClaudeStreaming') &&
    orchestrator.includes('callClaude(') &&
    orchestrator.includes('CURRENT_AI_MODELS.claudeBalanced') &&
    orchestrator.includes('CURRENT_AI_MODELS.claudeDeep') &&
    orchestrator.includes("progressiveClaudeAllowed = !backgroundResearchRequested") &&
    orchestrator.includes('!sequencePlan.documentAction') &&
    orchestrator.includes('cacheSystemPrompt: true') &&
    orchestrator.includes("reasoningProvider: 'claude'") &&
    !orchestrator.includes('AICollaborationOrchestrator.orchestrateCollaboration') &&
    !orchestrator.includes('getConfiguredHarmonyProviders') &&
    !orchestrator.includes('maxFallbacks'),
  'Lexara uses direct Claude reasoning with safe progressive streaming and no multi-provider routing overhead',
);
must(
  !authorityResearch.includes('openRouterWebSearch') &&
    !authorityResearch.includes('FIRECRAWL_API_KEY') &&
    !authorityResearch.includes('api.firecrawl.dev') &&
    authorityResearch.includes('discoverLegalMeshTier3') &&
    authorityResearch.includes('discoverLegalMeshSupplemental') &&
    authorityResearch.includes('forceResearch') &&
    authorityResearch.includes('researchIntent'),
  'Lexara legal and factual research use the independent Lexara search mesh without OpenRouter or Firecrawl',
);
must(
  lexaraResearchIntent.includes("'age-dob'") &&
    lexaraResearchIntent.includes("'professional-license'") &&
    lexaraResearchIntent.includes("'marriage-divorce'") &&
    lexaraResearchIntent.includes("'employment'") &&
    lexaraResearchIntent.includes('standaloneQuery') &&
    lexaraResearchIntent.includes('research-follow-up') &&
    lexaraResearchIntent.includes('sourceCategories'),
  'one Lexara-owned semantic planner carries inferred factual intent and follow-up context into research',
);
must(
  lexaraLegalMesh.includes('duckduckgo-instant-answer') &&
    lexaraLegalMesh.includes('SEARXNG_URL') &&
    lexaraLegalMesh.includes('DDGS_URL') &&
    lexaraLegalMesh.includes('OPENSERP_URL') &&
    lexaraLegalMesh.includes('TAVILY_API_KEY') &&
    lexaraLegalMesh.includes('index.commoncrawl.org') &&
    lexaraLegalMesh.includes('SERPAPI_KEY') &&
    lexaraLegalMesh.includes('SCRAPINGBEE_API_KEY') &&
    lexaraLegalMesh.includes('planLexaraResearchQueries') &&
    !lexaraLegalMesh.includes('PantheonDiscoveryCoordinator'),
  'Lexara owns the former non-crawler discovery lanes, archive fallback, paid fallback, and query expansion',
);
must(
  lexaraSourceRegistry.includes('cdc-vital-records') &&
    lexaraSourceRegistry.includes('nursys-license') &&
    lexaraSourceRegistry.includes('careeronestop-license-finder') &&
    lexaraSourceRegistry.includes('bop-inmate-locator') &&
    lexaraSourceRegistry.includes('finra-brokercheck') &&
    lexaraSourceRegistry.includes('sec-edgar') &&
    lexaraSourceRegistry.includes('icann-rdap') &&
    lexaraSourceRegistry.includes('uspto-patents') &&
    lexaraSourceRegistry.includes('usagov-state-local'),
  'Lexara owns category-aware authoritative source routing for vital, license, employment, court, corrections, business, property, domain and IP facts',
);
must(
  lexaraDiscoveryLearning.includes('lexara_discovery_learning') &&
    lexaraDiscoveryLearning.includes('rememberLexaraDiscoveryOutcome') &&
    lexaraDiscoveryLearning.includes('getLexaraLearnedQueryPatterns') &&
    lexaraResearchAssist.includes("providerPolicy:'legalwhat'") &&
    lexaraResearchAssist.includes('maxParticipants:1') &&
    lexaraResearchAssist.includes('maxFallbacks:0'),
  'Lexara owns discovery learning while scarce support providers stay out of query planning',
);
must(
  authorityResearch.includes('lexaraRetrievalAdapter.retrieve') &&
    authorityResearch.includes('enrichAuthoritySourcesWithLexaraRetrieval') &&
    !authorityResearch.includes('selectLexaraCrawlerPlan') &&
    lexaraRetrievalBoundary.includes("purpose: 'lexara_legal_research'") &&
    !lexaraRetrievalBoundary.includes('PantheonRetrievalAdapter') &&
    !lexaraRetrievalBoundary.includes('pantheonRetrievalAdapter') &&
    !lexaraRetrievalBoundary.includes('../services/pantheon/'),
  'Lexara legal research owns an independent retrieval boundary and does not execute through Pantheon',
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
    groq.includes("while (attempted.size < (request.providerPolicy === 'legalwhat' ? 1 : 2))") &&
    aiProvider.includes("prefixes: ['llama-', 'meta-llama/', 'openai/', 'qwen/']") &&
    harmonyRegistry.includes("'claude-opus-5-5'") &&
    harmony.includes('harmonyProviderCooldownUntil') &&
    harmony.includes('markHarmonyProviderFailure'),
  'Harmony uses robust Claude content parsing, permission-aware Groq recursive recovery, and provider-local cooldowns',
);
must(
  harmonyRegistry.includes("'claude-haiku-4-5-20251001'") &&
    harmonyRegistry.includes("'claude-sonnet-5-5'") &&
    harmonyRegistry.includes("'claude-opus-5-5'") &&
    harmonyRegistry.includes('return provider === PROVIDER.CLAUDE') &&
    !harmonyRegistry.includes("geminiFast: 'gemini-3.8-flash'") &&
    !harmonyRegistry.includes("xaiFast: 'grok-4.7'"),
  'LegalWhat inference authority is Claude-only with trial Haiku, paid Sonnet, and paid deep Opus workload selection',
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
  lexaraChatRoutes.includes("send('complete'") &&
    lexaraChatRoutes.includes('documentIntent,') &&
    lexaraChatRoutes.includes('reasoningDocumentIntent') &&
    lexaraChatRoutes.includes('for (const message of [...previousMessages].reverse())') &&
    !lexaraChatRoutes.includes("if (message.role !== 'user') continue;"),
  'LEXARA live SSE must preserve document intent and resolve referential document follow-ups from the full dialogue'
);
must(
  conversation.includes('pendingActionRef') &&
    conversation.includes('pendingAction: pendingActionRef.current?.label') &&
    conversation.includes("pendingActionRef.current = { kind: 'document', label: pendingTitle }") &&
    lexaraChatRoutes.includes('pendingAction = cleanOptionalString') &&
    orchestrator.includes("I'm still working on your"),
  'LEXARA must preserve and name a pending document action across presence/check-in turns'
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
    orchestrator.includes('Default to 1-3 concise sentences') &&
    orchestrator.includes('Do not say "thank you," "goodbye,"') &&
    orchestrator.includes('LIVE_RESEARCH_BUDGET_MS = 10_000') &&
    authorityResearch.includes('const RESEARCH_TIMEOUT_MS = 3 * 60_000') &&
    conversation.includes("acknowledgement = String(acknowledgementData?.acknowledgement || '').trim()"),
  'active-analysis turns are cancellable, acknowledgements remain non-semantic but conversational, answers are concise/direct, and authority research is bounded off the live latency tail',
);

must(
  conversation.includes('isMasterSession') &&
    conversation.includes("key?.startsWith('lexara-live-session:')") &&
    lexaraChatRoutes.includes("persistenceStatus: 'master-ephemeral'") &&
    lexaraChatRoutes.includes('await persistConversationTurn(req, {') &&
    lexaraChatRoutes.includes("persistenceStatus: 'saved'"),
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
    speechClient.includes('options.onStart?.()') &&
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
  storage.includes('getLexaraConversationPersistenceDb()') &&
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
const liveAvatarSourceSection = liveAvatarReview.split('## Sources - exactly 100')[1]?.split('## Implementation decision')[0] || '';
const liveAvatarSourceLines = liveAvatarSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(liveAvatarSourceLines.length === 100, 'literal 100-source LEXARA live-avatar implementation blueprint is present');
const embodiedConversationSourceSection = embodiedConversationReview.split('## Sources — exactly 50')[1]?.split('## Acceptance criteria')[0] || '';
const embodiedConversationSourceLines = embodiedConversationSourceSection.split('\n').filter(line => /^\d+\.\s/.test(line));
must(embodiedConversationSourceLines.length === 50, 'literal 50-source LEXARA embodied-conversation implementation blueprint is present');
must(
  voiceMode.includes('unmountCleanupRef') &&
    voiceMode.includes('cleanup.cleanupServerRecognition(true)') &&
    voiceMode.includes('  }, []);'),
  'realtime voice consultation socket cleanup is unmount-scoped rather than render-callback-scoped',
);
if (false) { // Legacy Lexara→Pantheon integration assertions retained for history; routing is intentionally disconnected.
must(
  lexaraConversationOrchestrator.includes('new Promise<null>(resolve => setTimeout(() => resolve(null), 0))') &&
    lexaraConversationOrchestrator.includes('Never name or infer a county from a city'),
  'person-record lookup cannot block before the live research budget or invent county jurisdiction',
);
must(
  lexaraPantheonInvestigation.includes('PERSON_RECURSIVE_TOTAL_BUDGET_MS = 10 * 60_000') &&
    lexaraPantheonInvestigation.includes('perPassBudgetMs = Math.min(pass === 0 ? 6_000 : 8_000, remainingMs)') &&
    lexaraPantheonInvestigation.includes('NEVER name, infer, recommend, or substitute a county'),
  'targeted Pantheon research is bounded for live conversation and county claims require evidence',
);
must(
  lexaraPantheonInvestigation.includes("['transportation']") &&
    lexaraPantheonInvestigation.includes("['education','credentials']") &&
    lexaraPantheonInvestigation.includes("['sex-offender']") &&
    lexaraPantheonInvestigation.includes("['bankruptcy','financial-public','property']") &&
    lexaraPantheonInvestigation.includes("['news','adverse-media']") &&
    lexaraPantheonInvestigation.includes("['government-employment','campaign-finance','lobbying','government-contracting']") &&
    lexaraPantheonInvestigation.includes("['relationship-graph','chronology','corroboration','contradictions','provenance']"),
  'Lexara routes person-record questions across the complete Pantheon report-domain surface rather than a narrow subset',
);
must(
  lexaraPantheonInvestigation.includes('coverageLimited?: boolean') &&
    lexaraPantheonInvestigation.includes('COVERAGE STATUS:') &&
    lexaraPantheonInvestigation.includes('This is not proof that no record exists') &&
    lexaraPantheonInvestigation.includes('never infer absence from a failed search'),
  'Pantheon retrieval gaps are communicated to Lexara as coverage limits rather than false negative records',
);
must(
  lexaraConversationOrchestrator.includes('initialBackground.fullBackgroundReportRequested'),
  'full background-report requests are explicitly handed back to Pantheon workflow instead of silently falling through ordinary chat',
);
must(
  lexaraConversationOrchestrator.includes('backgroundCategories:') &&
    lexaraConversationOrchestrator.includes('backgroundSourceCount:') &&
    lexaraConversationOrchestrator.includes('backgroundCoverageLimited:'),
  'Lexara production telemetry proves Pantheon category/source/coverage handoff per live turn',
);
must(
  pantheonInvestigation.includes("import { searchInmates }") &&
    pantheonInvestigation.includes("STRUCTURED CUSTODY SOURCE:") &&
    pantheonInvestigation.includes("inmate.facilityName") &&
    pantheonInvestigation.includes("inmate.custodyStatus"),
  'Lexara custody questions consume verified structured inmate results before generic Pantheon corroboration',
);
must(
  pantheonInvestigation.includes("date\\s+of\\s+death") &&
    pantheonInvestigation.includes("['vital-records','historical','chronology','news','family-probate','estate']"),
  'Lexara death questions route through Pantheon vital historical chronology news and probate evidence',
);
must(
  pantheonInvestigation.includes('incarcerat(?:e|ed|ion)?') &&
    pantheonInvestigation.includes('wife|die|died|death|deceased|obituary') &&
    pantheonInvestigation.includes('where\\s+(?:does|did)\\s+.+?\\s+live'),
  'Lexara recognizes natural incarceration residence and death question wording',
);
must(
  pantheonInvestigation.includes("STRUCTURED CUSTODY SOURCE:") &&
    pantheonInvestigation.includes("searchInmates({"),
  'Lexara consumes structured custody records for incarceration questions',
);
must(
  pantheonInvestigation.includes("incarcerat(?:e|ed|ion)?") &&
    pantheonInvestigation.includes("where\\s+(?:does|did)\\s+.+?\\s+live") &&
    pantheonInvestigation.includes("wife|die|died|death|deceased|obituary"),
  'natural incarceration residence and death wording routes to Pantheon',
);
must(
  inmateSearchAggregator.includes("INMATE_ENABLE_STATE_DOC', true") &&
    inmateSearchAggregator.includes("purpose: 'state_doc_inmate_search'") &&
    inmateSearchAggregator.includes("return [];"),
  'official state corrections discovery participates by default while person-level custody results fail closed without structured proof',
);
must(
  lexaraPantheonInvestigation.includes('Do not state that a record belongs to the subject unless the identifiers support that match.') &&
    lexaraPantheonInvestigation.includes('NEVER name, infer, recommend, or substitute a county'),
  'Lexara person-record handoff preserves identity and county truth boundaries',
);
must(
  lexaraPantheonInvestigation.includes('specificFullName') &&
    lexaraPantheonInvestigation.includes('split(/\\s+/).length >= 3'),
  'specific three-or-more-part names can enter bounded identity research without forcing a redundant identifier prompt',
);
must(
  lexaraPantheonInvestigation.includes("'sheriff jail roster'") &&
    lexaraPantheonInvestigation.includes("'criminal court records'") &&
    lexaraPantheonInvestigation.includes("'mortgage record'") &&
    lexaraPantheonInvestigation.includes("'death record'"),
  'person-record discovery uses record-type-specific official-source terms for custody criminal property and vital records',
);

for (const question of [
  'Where is Jordan Michael Carter incarcerated?',
  'Is Sarah Loretta Graves married?',
  "How much is William Rodney Lawrence's mortgage?",
  'Where does Tessa Gracie Bendland live?',
  'When did Brian Kenneth Lee Clinkenbeard die?',
  'Has Jeremy Scott Rose ever been arrested and what were the charged crimes?',
]) {
  must(
    lexaraPantheonInvestigation.includes('PERSON_RECORD_PATTERN') &&
      lexaraPantheonInvestigation.includes('CATEGORY_RULES') &&
      lexaraPantheonInvestigation.includes('requestedCategories(prompt)'),
    'natural-language person-record examples route through Pantheon: ' + question,
  );
}
must(
  lexaraPantheonInvestigation.includes("structured_custody_budget_exhausted") &&
    lexaraPantheonInvestigation.includes('STRUCTURED_CUSTODY_BUDGET_MS = 5 * 60_000'),
  'structured custody lookup is bounded so slow inmate providers cannot stall Lexara',
);
must(
  lexaraPantheonInvestigation.includes("from '../services/pantheon/PantheonEntityResolution'") &&
    lexaraPantheonInvestigation.includes("const identityMatch = resolvedEntityType === 'person'") &&
    lexaraPantheonInvestigation.includes('matchPantheonSubject(item, resolvedSubject, context.jurisdiction)') &&
    lexaraPantheonInvestigation.includes('if (!identityMatch.matched) {'),
  'Lexara accepts Pantheon person-record evidence only after subject matching',
);
must(
  lexaraPantheonInvestigation.includes("['identity','identity-resolution','vital-records','historical','chronology']") &&
    lexaraPantheonInvestigation.includes("'professional license lookup','license verification','disciplinary order','reinstatement order'"),
  'person fact research broadens across record families rather than using a fact-specific single source',
);
must(
  lexaraPantheonInvestigation.includes('PERSON_RECURSIVE_MAX_PASSES = 30') &&
    lexaraPantheonInvestigation.includes('PERSON_RECURSIVE_MAX_TARGETS_PER_PASS = 10') &&
    lexaraPantheonInvestigation.includes('PERSON_RECURSIVE_MAX_TOTAL_TARGETS = 30') &&
    lexaraPantheonInvestigation.includes('discoverPantheonSourcesParallel(') &&
    lexaraPantheonInvestigation.includes('bestConfidence >= PERSON_HIGH_CONFIDENCE_STOP_THRESHOLD'),
  'recursive person research broadens dynamically with explicit bounded low-latency endpoints',
);
must(
  lexaraPantheonInvestigation.includes('Separate historical status from current status') &&
    lexaraPantheonInvestigation.includes('label it as an inference'),
  'Lexara preserves current-versus-historical truth and labels derived person facts',
);
must(
  lexaraPantheonInvestigation.includes('PERSON_PROGRESSIVE_CONFIDENCE_THRESHOLD = 0.50') &&
    lexaraPantheonInvestigation.includes("'partial-evidence'") &&
    lexaraPantheonInvestigation.includes('lack of corroboration alone is not a reason to suppress it') &&
    lexaraPantheonInvestigation.includes('evidenceRetrieved:') &&
    lexaraPantheonInvestigation.includes('evidenceRejectedIdentityMismatch:') &&
    lexaraPantheonInvestigation.includes('evidenceRejectedBelowAssessment:') &&
    lexaraPantheonInvestigation.includes('evidenceContradictions:'),
  'Lexara preserves 50%+ partial/single-source evidence, distinguishes partial evidence from exhaustion, and exposes rejection telemetry',
);
must(
  !lexaraPantheonInvestigation.includes('authorityBonus') &&
    !lexaraPantheonInvestigation.includes('freshnessBonus') &&
    !lexaraPantheonInvestigation.includes('correlateBonus'),
  'source prestige, freshness, and corroboration do not act as evidence-survival gates',
);
}
must(
  !lexaraConversationOrchestrator.includes("from './LexaraBackgroundResearchBoundary'") &&
    !lexaraConversationOrchestrator.includes("from './LexaraPantheonInvestigation'") &&
    lexaraConversationOrchestrator.includes("from './LexaraBackgroundInvestigation'") &&
    lexaraConversationOrchestrator.includes("const backgroundResearchRequested = researchDecision.intent === 'factual' || mixedLegalFactNeed") &&
    lexaraConversationOrchestrator.includes('const researchRouteSelected = sequencePlan.useLegalResearch || researchDecision.needed') &&
    !lexaraBackgroundInvestigation.includes('../services/pantheon/') &&
    !lexaraBackgroundInvestigation.includes('PantheonRetrievalAdapter') &&
    lexaraBackgroundInvestigation.includes('discoverLegalMeshTier3') &&
    lexaraBackgroundInvestigation.includes('discoverLegalMeshSupplemental') &&
    lexaraBackgroundInvestigation.includes('lexaraRetrievalAdapter') &&
    lexaraBackgroundInvestigation.includes('directlyAnswers'),
  'Lexara background research is native, recursive, fact-gated, and Pantheon-disconnected while legal reasoning remains on its existing route',
);
must(
  !conversation.includes('{interimTranscript && !isSpeaking && (') &&
    conversation.includes('Only a final, echo-screened committed turn can enter'),
  'interim STT hypotheses cannot render as apparent user messages',
);
must(
  orchestrator.includes('private individual, or the requested fact being personal, is NEVER by itself a reason') &&
    orchestrator.includes('backgroundInvestigation && isPersonPermissionRefusal(text)') &&
    orchestrator.includes('I could not independently verify the requested fact from the sources I was able to assess.'),
  'Lexara has no blanket private-individual permission refusal after Pantheon targeting',
);
// Practice-area specialization gate (40-book LegalWhat library).
const lawTypesSource = read('shared/lawTypes.ts');
const legalDomainProfiles = read('server/lexara/LexaraLegalDomainProfiles.ts');
const welcomePage = read('client/src/pages/welcome.tsx');
const legalAuthorityResearch = read('server/lexara/LexaraAuthorityResearch.ts');

const lawTypesBlock = lawTypesSource.split('export const LAW_TYPES = [')[1]?.split('] as const;')[0] || '';
const productLawTypes = [...lawTypesBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);

must(productLawTypes.length === 40, 'LegalWhat exposes exactly 40 bookshelf practice areas');
must(productLawTypes.includes('post-conviction-law'), 'Post Conviction is a first-class product law type');

must(
  authSource.includes('(req.user as any).accessState = decision.accessState') &&
    lexaraChatRoutes.includes('allowClaudeOpus: canUseClaudeOpus(req)') &&
    lexaraRoutes.includes("providerPolicy: 'legalwhat'") &&
    lexaraRoutes.includes('allowClaudeOpus: canUsePaidClaude(req)') &&
    aiSubAgent.includes("options.allowClaudeOpus === true ? CURRENT_AI_MODELS.claudeBalanced : CURRENT_AI_MODELS.claudeFast") &&
    lexaraConversationOrchestrator.includes('allowClaudeOpus?: boolean') &&
    lexaraConversationOrchestrator.includes('requiresDeepClaudeForTurn') &&
    lexaraConversationOrchestrator.includes("sequencePlan.sequence === 'combined-legal-background'") &&
    lexaraConversationOrchestrator.includes("Never reveal or discuss underlying model names") &&
    consultationRoutes.includes("claudeWorkload: 'document-drafting'") &&
    documentRoutes.includes('const allowClaudeOpus =') &&
    universalDocumentGenerator.includes("claudeWorkload: 'document-drafting'"),
  'paid/master Claude escalation is server-derived end to end, trial fails closed, and Lexara never exposes internal model policy',
);

must(
  legalDocumentRegistry.includes('export const LEGAL_DOCUMENT_TYPES = [') &&
    legalDocumentRegistry.includes('resolveLegalDocumentType') &&
    legalDocumentRegistry.includes('isBlankLegalDocumentRequest') &&
    legalDocumentRegistry.includes('validateLegalDocumentDraft') &&
    consultationRoutes.includes("res.json({ types: LEGAL_DOCUMENT_TYPES })") &&
    consultationRoutes.includes('validated: true') &&
    consultationRoutes.includes('templateMode') &&
    lexaraChatRoutes.includes("documentType: currentType || historyType || 'Custom Document'") &&
    conversation.includes("data?.validated !== true || String(data?.documentType || '') !== pendingDocument.title") &&
  'LEXARA uses one canonical legal-document registry, current-turn precedence, template mode, and validated same-type export handoff',
);
must(
  lawTypesSource.includes("name: 'Post Conviction'") &&
    lawTypesSource.includes("route: '/legal-tools?type=post-conviction-law'"),
  'Post Conviction has normal bookshelf metadata and legal-tools routing',
);
must(
  conversation.includes("const greeting = hasSavedMatters") &&
    conversation.includes("'You have saved legal matters I can pull up if you want to continue where you left off. How may I help you?'") &&
    conversation.includes(": 'How may I help you?';") &&
    conversation.includes('if (liveEnabled && !voiceReady) return;') &&
    conversation.includes('await speakLexara(greeting, greetingGeneration).catch(() => false);') &&
    conversation.includes('if (liveEnabled && !started && greetingGeneration === generationRef.current)') &&
    conversation.includes('if (!greetingRef.current && !userSpeechObservedRef.current) {') &&
    conversation.includes('void sendGreeting();') &&
    !conversation.includes('Hello. Tell me what happened'),
  'LEXARA queues the correct new-user or saved-matter returning-user greeting until live voice is ready',
);
must(
  appSource.includes('<Route path="/welcome"><Redirect to="/lexara-consent" /></Route>') &&
    appSource.includes('<Route path="/lexara-consent" component={LexaraConsentPage} />') &&
    loginPage.includes('"/lexara-consent"'),
  'Authenticated LegalWhat entry routes directly to general LEXARA consent without bookshelf selection',
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
if (false) { // Legacy mixed Lexara/Pantheon routing assertions retained but inactive.
must(
  lexaraConversationOrchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns)') &&
    lexaraConversationOrchestrator.includes('sequencePlan.useBackgroundResearch && sequencePlan.useLegalResearch') &&
    lexaraConversationOrchestrator.includes('const backgroundResearchRequested = sequencePlan.useBackgroundResearch') &&
    lexaraConversationOrchestrator.includes('const authorityResearchPromise = sequencePlan.useLegalResearch') &&
    lexaraPantheonInvestigation.includes("researchDecision.objectiveKind !== 'legal-authority' || context.delegatedByLexara"),
  'legal-only questions stay on Lexara while explicit mixed legal/background questions may delegate factual retrieval to Pantheon',
);

must(
  pantheonInvestigation.includes('shouldUsePantheonForPersonQuestion') &&
    pantheonInvestigation.includes('PERSON_RECORD_PATTERN.test(recentText) && IDENTIFIER_PATTERN.test(prompt)') &&
    pantheonInvestigation.includes("researchDecision.needed && (researchDecision.objectiveKind !== 'legal-authority' || context.delegatedByLexara) && hasEnoughIdentityContext(combined)") &&
    pantheonInvestigation.includes('export function hasEnoughIdentityContext') &&
    pantheonInvestigation.includes('buildPantheonCategoryTargets') &&
    pantheonInvestigation.includes('discoverPantheonSourcesParallel') &&
    pantheonInvestigation.includes('Dynamic search/index discovery is the primary locator') &&
    pantheonInvestigation.includes('categorySeedUrls') &&
    pantheonInvestigation.includes("purpose: 'lexara_legal_research'") &&
    pantheonInvestigation.includes('depth: 3') &&
    pantheonInvestigation.includes('budgetMs: perPassBudgetMs') &&
    pantheonInvestigation.includes('perPassBudgetMs = Math.min(pass === 0 ? 6_000 : 8_000, remainingMs)') &&
    pantheonInvestigation.includes('fullBackgroundReportRequested') &&
    pantheonInvestigation.includes('needsIdentityClarification?: boolean') &&
    orchestrator.includes('initialBackground?.clarification && (initialBackground.needsIdentityClarification || initialBackground.fullBackgroundReportRequested)') &&
    orchestrator.includes('const backgroundPrompt = mixedLegalFactNeed') &&
    orchestrator.includes('investigateLexaraBackgroundQuestion(backgroundPrompt') &&
    orchestrator.includes('new Promise<null>(resolve => setTimeout(() => resolve(null), 0))') &&
    !orchestrator.includes('new Promise<null>(resolve => setTimeout(() => resolve(null), 60))') &&
    orchestrator.includes('formatLexaraBackgroundResearchForSystem(backgroundInvestigation)'),
  'LEXARA identifies the subject before targeted Pantheon research, scopes the requested record categories, and permits dynamic source discovery without silently running a full report',
);

}
must(
  lexaraConversationOrchestrator.includes('planLexaraSequence(cleanPrompt, previousUserTurns)') &&
    lexaraConversationOrchestrator.includes("const backgroundResearchRequested = researchDecision.intent === 'factual' || mixedLegalFactNeed") &&
    lexaraConversationOrchestrator.includes('const researchRouteSelected = sequencePlan.useLegalResearch || researchDecision.needed') &&
    lexaraConversationOrchestrator.includes('callClaudeStreaming') &&
    lexaraConversationOrchestrator.includes('callClaude('),
  'factual/mixed turns add Lexara-native background research while preserving the direct Claude legal-reasoning path',
);

// Lexara reasoning and evidence correction share the same direct Claude authority.
must(
  !orchestrator.includes("import { generateOpenRouterText }") &&
    !orchestrator.includes('independent gateway recovered live legal turn') &&
    orchestrator.includes('callClaudeStreaming') &&
    orchestrator.includes('callClaude(') &&
    orchestrator.includes("providerPolicy: 'legalwhat'") &&
    orchestrator.includes('Evidence correction deadline exceeded') &&
    !orchestrator.includes('getConfiguredHarmonyProviders') &&
    !orchestrator.includes('AICollaborationOrchestrator'),
  'LEXARA reasoning and evidence correction use one direct Claude authority without excluded provider routes',
);


// CPU-only Lexara continuity guard: one reply uses one progressive session and
// the visual layer selects prepared states without becoming part of playback.
must(
  avatar.includes('cy: 0.317') &&
    avatar.includes('rx: 0.040') &&
    avatar.includes('ry: 0.0115') &&
    avatar.includes('traceLipBoundary') &&
    avatar.includes('PORTRAIT_BREATHING_ENABLED') &&
    avatar.includes('PREPARED_PORTRAIT_FACE_ENABLED') &&
    avatar.includes('LEXARA_MOUTH_ATLAS_SRC') &&
    avatar.includes('drawPreparedSpeechFace') &&
    avatar.includes("fallback: 'portrait-plus-throat'") &&
    avatar.includes('LEGACY_PORTRAIT_NON_MOUTH_OVERLAYS_ENABLED') &&
    avatar.includes('const TARGET_FPS = 60') &&
    avatar.includes("VITE_LEXARA_CLIP_MOTION_ENABLED ?? '1'") &&
    avatar.includes("if (frame.mode !== 'speaking') return;") &&
    avatar.includes("audioActive ? 'speaking' : requestedMode === 'speaking' ? 'idle' : requestedMode") &&
    avatar.includes("const LEXARA_MOUTH_ANCHOR = Object.freeze({ cx: 0.520, cy: 0.317 })") &&
    avatar.includes("cx: LEXARA_MOUTH_ANCHOR.cx") &&
    avatar.includes("cy: LEXARA_MOUTH_ANCHOR.cy") &&
    avatar.includes("const anchor = point(layout, LEXARA_MOUTH_ANCHOR.cx, LEXARA_MOUTH_ANCHOR.cy)") &&
    avatar.includes("const LEXARA_MOUTH_LANDMARKS = Object.freeze({") &&
    avatar.includes("leftCorner: { x: 0.480, y: 0.317 }") &&
    avatar.includes("rightCorner: { x: 0.560, y: 0.317 }") &&
    avatar.includes("upperCenter: { x: 0.520, y: 0.3055 }") &&
    avatar.includes("lowerCenter: { x: 0.520, y: 0.3285 }") &&
    avatar.includes("const cornerScale = Math.max(0.94, Math.min(1.06") &&
    avatar.includes("const baseHalfWidth = layout.width") &&
    avatar.includes("const shapedOpen = open * open * (3 - 2 * open)") &&
    avatar.includes("const upperDy = -gap * 0.13") &&
    avatar.includes("const lowerDy = gap * 0.72") &&
    avatar.includes("const traceAperture = () =>") &&
    !avatar.includes("ctx.fillStyle = 'rgba(142, 79, 83, 0.16)'") &&
    !avatar.includes("ctx.scale(scaleX, 1)") &&
    !avatar.includes("{ cx: LEXARA_MOUTH_ANCHOR.cx, cy: LEXARA_MOUTH_ANCHOR.cy, rx: 0.034, ry: 0.0125 }") &&
    avatar.includes("const destinationWidth = innerRx * 2.00") &&
    avatar.includes("const destinationHeight = innerRy * 2.00") &&
    avatar.includes("ctx.imageSmoothingQuality = 'high'") &&
    avatar.includes("const teethY = r.cy + Math.min(gap * 0.06, r.ry * 0.20)") &&
    !avatar.includes("drawAtlasPose(frame.mouthPreviousPoseIndex") &&
    !avatar.includes("{ dy: layout.height * 0.0065, alpha: 0.92 }") &&
    !avatar.includes("{ cx: 0.520, cy: 0.317, rx: 0.047, ry: 0.019 }") &&
    embodimentEngine.includes("input.mode === 'speaking' && audio.active") &&
    avatar.includes('preparedPoseCount: 120') &&
    avatar.includes('blendPreparedFacePose') &&
    avatar.includes('frame.mouthPreviousPoseIndex') &&
    embodimentEngine.includes('mouthPoseIndex') &&
    embodimentEngine.includes('mouthPoseBlend') &&
    embodimentEngine.includes('dtSec / 0.085') &&
    embodimentEngine.includes('this.currentVisemeIndex * 8 + (mouthStrengthLevel - 1)') &&
    embodimentEngine.includes('mouthStrengthLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8') &&
    embodimentEngine.includes('selectAudioViseme') &&
    preparedFacePoses.includes('LEXARA_PREPARED_FACE_POSES.length !== 120') &&
    preparedFacePoses.includes('visemeIndex * STRENGTHS.length + strengthIndex') &&
    avatar.includes("const LEXARA_MOUTH_ATLAS_SRC = '/images/lexara-mouth-atlas.webp") || avatar.includes("const LEXARA_MOUTH_ATLAS_SRC = '/images/lexara-mouth-atlas.webp?v="),
  '120 facial reference states constrain a continuous audio-driven rig while the resting lips are suppressed during speech and voice playback remains isolated',
);
must(
  synthesis.includes('Restore the proven low-latency first-audible sequence') &&
    synthesis.includes('firstSpeechChunk(text)') &&
    synthesis.includes('createStreamingAudioSession(firstUnit, stableTurnId)') &&
    synthesis.includes('remainingUnit') &&
    synthesis.includes('MAX_PLAYBACK_WATCHDOG_MS = 600_000') &&
    realtimeVoiceClient.includes("type: 'upstream_complete'") &&
    realtimeVoiceClient.includes('currentTurnPlaybackOffsetMs') &&
    realtimeVoiceClient.includes("'realtime-socket-close'") &&
    realtimeVoiceGateway.includes('closeCode: close?.code') &&
    realtimeVoiceGateway.includes('STT channel reconnecting without interrupting speech') &&
    realtimeVoiceGateway.includes('openSttChannel') &&
    voiceRoutes.includes("'realtime-fallback'") &&
    !synthesis.includes('splitLexaraSpeechChunks') &&
    !synthesis.includes('fetchPreparedSessionAudio') &&
    !synthesis.includes('preparedCurrent') &&
    speechClient.includes('lexaraPlaybackOffsetMs') &&
    voiceRoutes.includes('LEXARA_TTS_SESSION_MAX_CHARS = 50_000') &&
    voiceRoutes.includes('splitLexaraTTSInput') &&
    voiceRoutes.includes('openLexaraSpeechSequence') &&
    voiceRoutes.includes('synthesizeLexaraSpeechSequence') &&
    voiceRoutes.includes("res.setHeader('Content-Encoding', 'identity')"),
  'Lexara streams each successful response continuously without intermediary compression buffering and retains transport-fault recovery',
);
must(
  speechClient.includes('LexaraPlaybackOptions') &&
    speechClient.includes('currentTurnId') &&
    speechClient.includes("this.stop('superseded')") &&
    voiceRoutes.includes("'tts-session-ready'") &&
    voiceRoutes.includes('X-Lexara-Turn-Id') &&
    voiceRoutes.includes('res.flushHeaders()'),
  'playback telemetry carries one turn identity and the server flushes progressive audio headers immediately',
);
// Regression gates for the established document/voice working points.
must(
  conversation.includes("data?.validated !== true || String(data?.documentType || '') !== pendingDocument.title"),
  'document export must retain strict server validation/type identity',
);
must(
  consultationRoutes.includes("/api/lexara/documents/official-form") &&
    conversation.includes("/api/lexara/documents/official-form"),
  'mandatory verified official forms must continue from Lexara conversation into completion/download',
);
must(
  conversation.includes('lexaraDocumentSpeech(answer, documentIntentRequested || Boolean(priorPendingDocument))') &&
    conversation.includes('&& !pendingDocument') &&
    conversation.includes('const recoverySpeech =') &&
    conversation.includes(': spokenAnswer;') &&
    conversation.includes('await speakLexara(recoverySpeech, generation)') &&
    lexaraChatRoutes.includes('onSpeechChunk: documentIntent.requested') &&
    lexaraChatRoutes.includes('? undefined') &&
    lexaraChatRoutes.includes(": chunk => send('speech-chunk', { chunk })"),
  'document bodies must never be sent to realtime TTS',
);
must(
  lexaraLocation.includes('navigator.geolocation.getCurrentPosition') &&
    lexaraLocation.includes("navigator.permissions.query({ name: 'geolocation' })") &&
    conversation.includes('deviceLocation: readLexaraDeviceLocation()') &&
    lexaraChatRoutes.includes('resolveBestLocationEstimate') &&
    jurisdictionResolver.includes('browser-geolocation+dbip-local') &&
    jurisdictionResolver.includes('browserLocationConfidence'),
  'LEXARA fuses permitted device location with IP fallback instead of treating IP as sole location authority',
);
must(
  lexaraConversationOrchestrator.includes('backgroundLocationTrusted') &&
    lexaraConversationOrchestrator.includes('!explicitLocationCue && backgroundLocationTrusted ? backgroundStateJurisdiction : undefined') &&
    lexaraConversationOrchestrator.includes('If the user states a location, that statement controls immediately') &&
    lexaraConversationOrchestrator.includes('JURISDICTION CORRECTION TURN') &&
    lexaraConversationOrchestrator.includes('Do not explain competing location signals'),
  'user-stated jurisdiction silently overrides automatic estimates and correction turns stay conversational',
);
must(
  lexaraConversationOrchestrator.includes('LIVE_BACKGROUND_FACT_BUDGET_MS = 16_000') &&
    lexaraConversationOrchestrator.includes('lexara_live_background_budget_exhausted') &&
    lexaraBackgroundInvestigation.includes('LIVE_RESEARCH_BUDGET_MS = 15_000') &&
    lexaraBackgroundInvestigation.includes('LIVE_RECURSIVE_PASSES = 6') &&
    lexaraBackgroundInvestigation.includes('usefulCount >= 3') &&
    lexaraBackgroundInvestigation.includes('stagnantUsefulPasses >= 2'),
  'ordinary background fact turns have bounded live budgets and stop when useful evidence converges',
);
must(
  harmony.includes('task.failedProviders?.add(task.provider)') &&
    harmony.includes('A skipped route is not a new remote-provider failure') &&
    harmony.includes('!task.failedProviders?.has(provider)'),
  'quota-withheld and cooling Harmony routes are not selected again inside the same turn',
);
must(
  lexaraConversationOrchestrator.includes('derivedFact:') &&
    lexaraConversationOrchestrator.includes("researchDecision.requestedFact === 'age-dob'"),
  'live telemetry records the synthesized age fact or range when Lexara states one',
);
must(
  representationEngine.includes('export interface RepresentationMatterState') &&
    representationEngine.includes('Identify the COMPLETE current filing package for this exact proceeding and stage.') &&
    representationEngine.includes("requestedCompleteness === 'complete'") &&
    representationEngine.includes('research.hasPrimaryAuthority') &&
    representationEngine.includes('completeSourceLooksLikePacket') &&
    representationEngine.includes('sourceText.includes(proposedFormNumber.toLowerCase())') &&
    representationEngine.includes('sourceText.includes(proposedRevision.toLowerCase())') &&
    representationEngine.includes('representation-deadline-verification') &&
    representationEngine.includes("source.kind !== 'primary'") &&
    representationEngine.includes("if (tied.length > 1 && !best.exact) return null"),
  'LEXARA representation state verifies complete packets, form metadata, deadlines, and ambiguous matter references before treating them as authoritative',
);
must(
  lexaraChatRoutes.includes("accessState === 'paid'") &&
    lexaraChatRoutes.includes("'trial-ephemeral'") &&
    lexaraChatRoutes.includes('activeMatter: null') &&
    matterStorage.includes("const DEFAULT_SUPABASE_BUCKET = 'legalwhat-matters'") &&
    matterStorage.includes('public: false') &&
    fmiRoutes.includes('return matches.length === 1 ? matches[0] : null') &&
    conversation.includes('You have saved legal matters I can pull up if you want to continue where you left off. How may I help you?') &&
    landingPage.includes('Paid access includes persistent legal matter storage'),
  'paid users receive private persistent saved matters while trial users remain ephemeral and ambiguous evidence is never guessed into a case file',
);
must(
  consultationRoutes.includes('document-consistency') &&
    consultationRoutes.includes('Resolve document consistency issue') &&
    fmiRoutes.includes('supportsElements') &&
    fmiRoutes.includes('weakensDefenses') &&
    representationEngine.includes('evidenceMap') &&
    representationEngine.includes('proceduralRequirements'),
  'LEXARA keeps evidence, cross-document consistency, and filing/service/fee procedure inside the persistent matter record',
);

require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'test-lexara-location-fusion.cjs')], { stdio: 'inherit' });
require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'test-lexara-document-handoff.cjs')], { stdio: 'inherit' });
require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'verify-lexara-pantheon-disconnect.cjs')], { stdio: 'inherit' });
require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'test-lexara-native-factual-routing.cjs')], { stdio: 'inherit' });
require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'test-lexara-native-background-investigation.cjs')], { stdio: 'inherit' });
if (!process.exitCode) console.log('LEXARA realization verification passed.');
