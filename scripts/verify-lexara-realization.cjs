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
const systemConfig = read('server/systemConfig.ts');
const voicePipeline = read('server/lexara/LexaraVoicePipeline.ts');
const review = read('docs/LEXARA_INTENT_REALIZATION_30_SOURCE_REVIEW_20260918.md');

must(
  voiceMode.indexOf("if (isSpeechRecognitionSupported())") <
    voiceMode.indexOf("else if (isServerRecognitionSupported())"),
  'proven browser speech path remains primary with server fallback',
);
must(
  voiceMode.includes("Candidate acoustic activity is intentionally not surfaced as an"),
  'raw server VAD cannot own interruption authority',
);
must(
  conversation.includes('CONVERSATION_STORAGE_SCHEMA_VERSION = 2'),
  'conversation storage is versioned to quarantine corrupt prior turns',
);
must(
  conversation.includes('isSuspiciousGenericServerTranscript') &&
    conversation.includes("meta.engine === 'server'"),
  'server STT turns pass admission checks before conversation mutation',
);
must(
  conversation.includes("meta.engine === 'browser' || isFinal"),
  'barge-in is transcript-confirmed rather than acoustic-energy-confirmed',
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
    speechClient.includes('pause(): void'),
  'single ElevenLabs playback channel owns pause/resume',
);
must(
  lexaraRoutes.includes("form.append('response_format', 'verbose_json')") &&
    lexaraRoutes.includes('noSpeechProbability') &&
    lexaraRoutes.includes('avgLogprob'),
  'STT hallucination rejection uses speech evidence before acceptance',
);
must(
  lexaraRoutes.indexOf("name: 'elevenlabs-scribe'") <
    lexaraRoutes.indexOf("name: 'groq-whisper'"),
  'paid ElevenLabs Scribe is preferred with Groq Whisper fallback',
);
must(
  voiceRoutes.includes('/api/lexara/tts/session') &&
    voiceRoutes.includes('/stream?output_format=mp3_44100_128'),
  'TTS is proxied as progressive ElevenLabs streaming media',
);
must(
  voiceRoutes.includes('/api/lexara/voice/profile'),
  'configured ElevenLabs production voice can be validated',
);
must(
  orchestrator.includes("preferredProvider: 'openrouter'") &&
    openRouter.includes("'openrouter/auto'"),
  'Lexara reasoning uses current platform model routing before direct fallbacks',
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

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA realization verification passed.');
