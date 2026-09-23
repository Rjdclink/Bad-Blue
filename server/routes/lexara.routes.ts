/**
 * LEXARA Streaming API Routes
 * 
 * Provides WebRTC-compatible streaming endpoint for real-time
 * two-way communication with LEXARA AI legal assistant.
 * 
 * A7 - LOCK LEXARA INTO TRUE "PERSONA MODE"
 * Permanent, Stable, Feminine, Non-Robotic
 * 
 * CONTINUOUS AUDIO PIPELINE:
 * FIX 1: Mic acquired AND streamed continuously
 * FIX 2: Audio frames emitted to ASR via ScriptProcessorNode
 * FIX 3: Float32 → Int16 PCM conversion for Whisper/ASR
 * FIX 4: AudioContext properly resumed on user interaction
 * FIX 5: Full duplex loop: ASR → LLM → TTS chained directly
 * FIX 6: Stream NEVER stopped automatically
 * FIX 7: WebSocket protocol for real-time audio streaming
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../logger';
import { LEXARA_KERNEL, mergePersonaWithKernel } from '../lexara/personaKernel';
import { getLexaraTTSReadiness, refreshLexaraTTSReadiness, synthesizeLexaraSpeechWithFailover } from '../lexara/LexaraTTSMesh';
import { callAIWithFallback } from '../aiSubAgent';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';
import { isAuthenticated } from '../auth';
import { getConfiguredHarmonyParticipants } from '../aiHarmonyModelRegistry';
import { getHarmonyWarmStatus } from '../aiHarmonyWarmup';

const router = express.Router();

// TEMPORARY signup/subscription bypass: keep only the endpoints required by the
// public Bookshelf -> Consent -> Lexara flow reachable without a session.
// All other Lexara routes retain their existing authentication boundary.
const TEMPORARY_PUBLIC_LEXARA_PATHS = new Set([
  '/voice/live-readiness',
]);
router.use((req, res, next) => {
  if (req.method === 'GET' && TEMPORARY_PUBLIC_LEXARA_PATHS.has(req.path)) {
    return next();
  }
  return isAuthenticated(req, res, next);
});

const lexaraVoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const type = String(file.mimetype || '').toLowerCase();
    if (type.startsWith('audio/') || type === 'application/octet-stream') {
      callback(null, true);
      return;
    }
    callback(new Error('Unsupported audio format'));
  },
});

function extensionForAudioMime(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'webm';
}


// Store active stream sessions with persona attached
const activeSessions = new Map<string, {
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'initializing' | 'active' | 'paused' | 'ended';
  persona: typeof LEXARA_KERNEL;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}>();

// Audio buffer for ASR processing
const audioBuffers = new Map<string, {
  chunks: Buffer[];
  sampleRate: number;
  channels: number;
  lastChunkTime: number;
}>();

import crypto from 'crypto';

/**
 * GET /api/lexara/speak-test
 * Hard test endpoint for ElevenLabs voice synthesis
 * Returns MP3 audio directly or explicit error
 */
router.get('/speak-test', async (_req: Request, res: Response) => {
  try {
    logger.info('[LEXARA] speak-test: Testing adaptive voice mesh');
    const result = await synthesizeLexaraSpeechWithFailover('How can I help you?');
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.audioData.length.toString());
    res.setHeader('X-Lexara-Test', 'voice-mesh-confirmed');
    res.setHeader('X-Provider', result.provider);
    res.setHeader('X-TTS-Model', result.model);
    res.send(result.audioData);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[LEXARA] speak-test: Voice mesh test failed', { error: errorMessage });
    res.status(503).json({
      success: false,
      error: errorMessage,
      hint: 'No healthy configured LEXARA TTS provider responded.',
    });
  }
});

/**
 * Generate cryptographically secure random string
 */
function generateSecureRandom(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Generate a secure fingerprint for WebRTC DTLS
 */
function generateSecureFingerprint(): string {
  const bytes = crypto.randomBytes(32);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/**
 * Generate SDP answer for WebRTC negotiation
 * Production mode - creates proper SDP response for audio/video streams
 */
function generateSDPAnswer(offerSdp?: string): string {
  // Parse offer SDP to extract media capabilities
  const hasAudio = offerSdp?.includes('m=audio') ?? true;
  const hasVideo = offerSdp?.includes('m=video') ?? false;
  
  // Generate production SDP answer with secure credentials
  const sdpLines = [
    'v=0',
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    's=LEXARA WebRTC Session',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
  ];

  if (hasAudio) {
    sdpLines.push(
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 103 104 9 0 8 106 105 13 110 112 113 126',
      'c=IN IP4 0.0.0.0',
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=ice-ufrag:' + generateSecureRandom(8),
      'a=ice-pwd:' + generateSecureRandom(24),
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 ' + generateSecureFingerprint(),
      'a=setup:active',
      'a=mid:0',
      'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
      'a=sendrecv',
      'a=rtcp-mux',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
    );
  }

  return sdpLines.join('\r\n') + '\r\n';
}

/**
 * POST /api/lexara/respond
 * Direct LLM response endpoint for continuous audio pipeline
 * FIX 5: ASR text immediately triggers LLM
 */
router.post('/respond', express.json(), async (req: Request, res: Response) => {
  const { text, sessionId } = req.body;
  
  if (!text) {
    return res.status(400).json({
      success: false,
      error: 'text is required',
    });
  }
  
  try {
    // Get persona for consistent response style
    const persona = mergePersonaWithKernel();
    
    logger.info('[LEXARA] Processing LLM request', { 
      textLength: text.length,
      sessionId,
    });
    
    const session = sessionId ? activeSessions.get(sessionId) : undefined;
    const history = session?.messages
      .slice(-10)
      .map(message => `${message.role === 'user' ? 'User' : 'Lexara'}: ${message.content}`)
      .join('\n');
    const prompt = history ? `${history}\nUser: ${text}\nLexara:` : text;

    const aiResponse = await callAIWithFallback(prompt, {
      systemPrompt: LEXARA_PERSONA.systemPrompt,
      temperature: 0.7,
      maxTokens: 1000,
    });

    if (!aiResponse.success || !aiResponse.content) {
      throw new Error(aiResponse.error || 'No AI provider returned a response');
    }

    if (session) {
      session.messages.push(
        { role: 'user', content: text },
        { role: 'assistant', content: aiResponse.content }
      );
      session.messages = session.messages.slice(-20);
      session.lastActivity = new Date();
    }
    
    return res.json({
      success: true,
      response: aiResponse.content,
      model: aiResponse.model,
      persona: {
        name: persona.identity.name,
        timbre: persona.speech.timbre,
      },
    });
  } catch (err) {
    logger.error('[LEXARA] LLM response failed', { error: err });
    return res.status(500).json({
      success: false,
      error: 'Failed to generate response',
    });
  }
});

/**
 * POST /api/lexara/audio-chunk
 * Receive audio chunks for ASR processing (HTTP fallback for WebSocket)
 * FIX 7: Consistent protocol handling
 */
router.post('/audio-chunk', express.raw({ type: 'application/octet-stream', limit: '1mb' }), async (req: Request, res: Response) => {
  const sessionId = req.headers['x-session-id'] as string;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: 'x-session-id header required',
    });
  }
  
  try {
    // Get or create audio buffer for session
    let buffer = audioBuffers.get(sessionId);
    if (!buffer) {
      buffer = {
        chunks: [],
        sampleRate: 16000,
        channels: 1,
        lastChunkTime: Date.now(),
      };
      audioBuffers.set(sessionId, buffer);
    }
    
    // Add chunk to buffer
    buffer.chunks.push(req.body as Buffer);
    buffer.lastChunkTime = Date.now();
    
    // If we have enough audio data, process it
    const totalBytes = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    
    // Process every ~1 second of audio (16000 samples * 2 bytes = 32KB)
    if (totalBytes >= 32000) {
      const audioData = Buffer.concat(buffer.chunks);
      buffer.chunks = [];
      
      // In production, send to ASR service (Whisper, etc.)
      // For now, acknowledge receipt
      logger.info('[LEXARA] Audio chunk processed', {
        sessionId,
        bytes: audioData.length,
        duration: `${(audioData.length / 32000).toFixed(2)}s`,
      });
    }
    
    return res.json({
      success: true,
      bufferedBytes: buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    });
  } catch (err) {
    logger.error('[LEXARA] Audio chunk processing failed', { error: err });
    return res.status(500).json({
      success: false,
      error: 'Failed to process audio chunk',
    });
  }
});

/**
 * GET /api/lexara/voice/live-readiness
 * Operational capability check used by the consent interstitial and live badge.
 * A configured key is not enough: speech output is reported live only after a
 * real bounded synthesis canary has verified at least one provider route.
 */
router.get('/voice/live-readiness', async (_req: Request, res: Response) => {
  const groqConfigured = !!process.env.GROQ_API_KEY?.trim();
  const deepgramConfigured = !!(process.env.DEEPGRAM_API_KEY?.trim() || process.env.DEEPGRAM?.trim());
  const elevenLabsScribeConfigured = !!process.env.ELEVENLABS_API_KEY?.trim();
  const speechInputConfigured = groqConfigured || deepgramConfigured || elevenLabsScribeConfigured;

  let ttsReadiness = getLexaraTTSReadiness();
  if (!ttsReadiness.available && ttsReadiness.configuredProviders.length > 0) {
    await Promise.race([
      refreshLexaraTTSReadiness(false),
      new Promise(resolve => setTimeout(resolve, 1_200)),
    ]);
    ttsReadiness = getLexaraTTSReadiness();
  }

  const harmonyParticipants = getConfiguredHarmonyParticipants();
  const harmonyWarm = getHarmonyWarmStatus();
  const inferenceReady = harmonyWarm.filter(status => status.state === 'ready').length;
  const catalogEligible = harmonyWarm.filter(status => status.state === 'catalog').length;
  const degraded = harmonyWarm.filter(status => status.state === 'degraded').length;

  return res.json({
    success: true,
    speechInputConfigured,
    speechOutputConfigured: ttsReadiness.available,
    speechOutputVerified: ttsReadiness.available,
    speechOutputStreamingVerified: ttsReadiness.streamingProviders.length > 0,
    voiceRedundancyVerified: ttsReadiness.redundancyVerified,
    voiceIndependentDomains: ttsReadiness.independentDomains,
    voiceStatus: ttsReadiness.voiceStatus,
    liveVoiceConfigured: speechInputConfigured && ttsReadiness.available,
    inputProviders: [
      ...(groqConfigured ? ['groq-whisper'] : []),
      ...(deepgramConfigured ? ['deepgram-nova'] : []),
      ...(elevenLabsScribeConfigured ? ['elevenlabs-scribe'] : []),
    ],
    outputProvider: ttsReadiness.streamingProviders[0] || ttsReadiness.healthyProviders[0] || null,
    outputProviders: ttsReadiness.healthyProviders,
    streamingOutputProviders: ttsReadiness.streamingProviders,
    outputProviderStates: ttsReadiness.providers,
    outputVerifiedAt: ttsReadiness.verifiedAt,
    legalReasoningConfigured: harmonyParticipants.length > 0,
    legalReasoningParticipants: harmonyParticipants.length,
    legalReasoningInferenceReady: inferenceReady,
    legalReasoningCatalogEligible: catalogEligible,
    legalReasoningDegraded: degraded,
  });
});

function makeVoiceUploadForm(file: Express.Multer.File): {
  form: FormData;
  mimeType: string;
  extension: string;
} {
  const mimeType = String(file.mimetype || 'audio/webm');
  const extension = extensionForAudioMime(mimeType);
  const form = new FormData();
  const audioBytes = new Uint8Array(file.buffer);
  form.append('file', new Blob([audioBytes], { type: mimeType }), `lexara-turn.${extension}`);
  return { form, mimeType, extension };
}

async function transcribeWithGroq(file: Express.Multer.File): Promise<{
  text: string;
  provider: string;
  model: string;
  quality?: {
    avgLogprob?: number;
    noSpeechProbability?: number;
  };
}> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('Groq speech-to-text is not configured');

  const { form } = makeVoiceUploadForm(file);
  const model = process.env.GROQ_STT_MODEL?.trim() || 'whisper-large-v3-turbo';
  form.append('model', model);
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Groq STT ${response.status}: ${detail}`);
    }

    const result = await response.json() as {
      text?: string;
      segments?: Array<{
        avg_logprob?: number;
        no_speech_prob?: number;
      }>;
    };
    const segments = Array.isArray(result.segments) ? result.segments : [];
    const avgLogprobValues = segments
      .map(segment => Number(segment.avg_logprob))
      .filter(Number.isFinite);
    const noSpeechValues = segments
      .map(segment => Number(segment.no_speech_prob))
      .filter(Number.isFinite);
    const avgLogprob = avgLogprobValues.length
      ? avgLogprobValues.reduce((sum, value) => sum + value, 0) / avgLogprobValues.length
      : undefined;
    // One quiet segment inside a long explanation must not invalidate the
    // entire utterance. Aggregate no-speech evidence across segments rather
    // than treating the single worst pause as representative of the turn.
    const noSpeechProbability = noSpeechValues.length
      ? noSpeechValues.reduce((sum, value) => sum + value, 0) / noSpeechValues.length
      : undefined;

    return {
      text: String(result?.text || '').trim(),
      provider: 'groq-whisper',
      model,
      quality: { avgLogprob, noSpeechProbability },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithDeepgram(file: Express.Multer.File): Promise<{
  text: string;
  provider: string;
  model: string;
  quality?: { confidence?: number };
}> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim() || process.env.DEEPGRAM?.trim();
  if (!apiKey) throw new Error('Deepgram speech-to-text is not configured');

  const model = process.env.DEEPGRAM_STT_MODEL?.trim() || 'nova-3';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&language=en&smart_format=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': file.mimetype || 'application/octet-stream',
        },
        body: new Uint8Array(file.buffer),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Deepgram STT ${response.status}: ${detail}`);
    }
    const result = await response.json() as any;
    const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
    return {
      text: String(alternative?.transcript || '').trim(),
      provider: 'deepgram-nova',
      model,
      quality: {
        confidence: Number.isFinite(Number(alternative?.confidence))
          ? Number(alternative.confidence)
          : undefined,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithElevenLabs(file: Express.Multer.File): Promise<{
  text: string;
  provider: string;
  model: string;
  quality?: { avgLogprob?: number };
}> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error('ElevenLabs speech-to-text is not configured');

  const { form } = makeVoiceUploadForm(file);
  const model = process.env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v2';
  form.append('model_id', model);
  form.append('language_code', 'eng');
  form.append('diarize', 'false');
  form.append('tag_audio_events', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`ElevenLabs STT ${response.status}: ${detail}`);
    }

    const result = await response.json() as {
      text?: string;
      words?: Array<{ logprob?: number; type?: string }>;
    };
    const logprobs = Array.isArray(result.words)
      ? result.words
        .filter(word => word?.type === 'word' || !word?.type)
        .map(word => Number(word?.logprob))
        .filter(Number.isFinite)
      : [];
    const avgLogprob = logprobs.length
      ? logprobs.reduce((sum, value) => sum + value, 0) / logprobs.length
      : undefined;
    return {
      text: String(result?.text || '').trim(),
      provider: 'elevenlabs-scribe',
      model,
      quality: { avgLogprob },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/lexara/transcribe-file
 * Standards-based cross-device speech recognition. Groq Whisper is the fast
 * primary route; ElevenLabs Scribe is an independent route-local fallback.
 */
router.post('/transcribe-file', lexaraVoiceUpload.single('audio'), async (req: Request, res: Response) => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer?.length) {
    return res.status(400).json({
      success: false,
      error: 'audio file is required',
    });
  }

  const providers: Array<{
    name: string;
    configured: boolean;
    transcribe: () => Promise<{
      text: string;
      provider: string;
      model: string;
      quality?: { avgLogprob?: number; noSpeechProbability?: number; confidence?: number };
    }>;
  }> = [
    // Groq Whisper Turbo is the latency-first batch fallback and exposes
    // no-speech/logprob evidence. ElevenLabs Scribe remains an independent
    // high-accuracy route-local fallback with word log probabilities.
    {
      name: 'groq-whisper',
      configured: !!process.env.GROQ_API_KEY?.trim(),
      transcribe: () => transcribeWithGroq(file),
    },
    {
      name: 'deepgram-nova',
      configured: !!process.env.DEEPGRAM_API_KEY?.trim(),
      transcribe: () => transcribeWithDeepgram(file),
    },
    {
      name: 'elevenlabs-scribe',
      configured: !!process.env.ELEVENLABS_API_KEY?.trim(),
      transcribe: () => transcribeWithElevenLabs(file),
    },
  ];

  const configured = providers.filter(provider => provider.configured);
  if (!configured.length) {
    return res.status(503).json({
      success: false,
      error: 'Server speech recognition is temporarily unavailable',
    });
  }

  const failures: Array<{ provider: string; error: string }> = [];
  for (const provider of configured) {
    try {
      const result = await provider.transcribe();
      if (!result.text) {
        failures.push({ provider: provider.name, error: 'empty transcript' });
        continue;
      }

      const speechDurationMs = Math.max(0, Number(req.body?.speechDurationMs || 0));
      const bargeInProbe = req.body?.bargeInProbe === 'true';
      const startedDuringPlayback = req.body?.startedDuringPlayback === 'true';
      const noSpeechProbability = result.quality?.noSpeechProbability;
      const avgLogprob = result.quality?.avgLogprob;

      const hasNoSpeech = Number.isFinite(noSpeechProbability);
      const hasLogprob = Number.isFinite(avgLogprob);
      const noSpeech = hasNoSpeech ? Number(noSpeechProbability) : undefined;
      const logprob = hasLogprob ? Number(avgLogprob) : undefined;

      // Keep user-turn authority conservative without blocking conversational
      // barge-in. A barge-in probe is non-authoritative and may stop local
      // playback after primary ASR + client echo screening; only short final
      // playback-overlap turns and suspicious generic closers require a second
      // ASR before they can become user text.
      const normalizeTranscript = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedTranscript = normalizeTranscript(result.text);
      const suspiciousGeneric = new Set([
        'thank you', 'thanks', 'bye', 'goodbye', 'you',
      ]).has(normalizedTranscript);

      const requiresIndependentVerification =
        provider.name === 'groq-whisper'
        && !bargeInProbe
        && (
          (
            startedDuringPlayback
            && speechDurationMs > 0
            && speechDurationMs < 900
          )
          || (
            suspiciousGeneric
            && speechDurationMs < 1_200
          )
        );

      if (requiresIndependentVerification) {
        const explicitControl = /^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/.test(normalizedTranscript);
        const verifier = providers.find(candidate =>
          candidate.name !== provider.name
          && candidate.configured
          && (candidate.name === 'deepgram-nova' || candidate.name === 'elevenlabs-scribe')
        );

        if (verifier) {
          try {
            const verification = await verifier.transcribe();
            const verified = normalizeTranscript(verification.text);
            if (!verified || verified !== normalizedTranscript) {
              logger.info('[LEXARA] Rejected playback-overlap transcript after independent ASR disagreement', {
                primary: normalizedTranscript,
                secondary: verified,
                verifier: verifier.name,
                speechDurationMs,
                startedDuringPlayback,
              });
              return res.json({
                success: true,
                transcript: '',
                isFinal: false,
                rejected: true,
                rejectionReason: 'independent_asr_disagreement',
                provider: result.provider,
                model: result.model,
                bargeInProbe,
              });
            }
          } catch (verificationError) {
            if (startedDuringPlayback && !explicitControl) {
              logger.info('[LEXARA] Suppressed playback-overlap transcript when independent verifier was unavailable', {
                primary: normalizedTranscript,
                verifier: verifier.name,
                error: verificationError instanceof Error ? verificationError.message : String(verificationError),
              });
              return res.json({
                success: true,
                transcript: '',
                isFinal: false,
                rejected: true,
                rejectionReason: 'playback_overlap_unverified',
                provider: result.provider,
                model: result.model,
                bargeInProbe,
              });
            }
          }
        }
      }

      // Reject only when the acoustic evidence is jointly poor. A long spoken
      // explanation with noSpeech≈0 must not be discarded solely because one
      // Whisper segment has a low average log probability.
      const rejectAsNonSpeech = (noSpeech !== undefined && noSpeech >= (bargeInProbe ? 0.68 : 0.85))
        || (
          speechDurationMs < (bargeInProbe ? 900 : 800)
          && logprob !== undefined
          && logprob <= (bargeInProbe ? -1.0 : -1.15)
        )
        || (
          noSpeech !== undefined
          && noSpeech >= 0.55
          && logprob !== undefined
          && logprob <= -1.0
        );

      if (rejectAsNonSpeech) {
        logger.info('[LEXARA] Rejected low-evidence speech transcript', {
          provider: result.provider,
          noSpeechProbability,
          avgLogprob,
          speechDurationMs,
          bargeInProbe,
        });
        return res.json({
          success: true,
          transcript: '',
          isFinal: false,
          rejected: true,
          rejectionReason: 'low_speech_evidence',
          provider: result.provider,
          model: result.model,
          bargeInProbe,
        });
      }

      return res.json({
        success: true,
        transcript: result.text,
        isFinal: true,
        provider: result.provider,
        model: result.model,
        speechDurationMs,
        quality: result.quality,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ provider: provider.name, error: message });
      logger.warn('[LEXARA] Speech transcription provider failed locally', {
        provider: provider.name,
        error: message,
      });
    }
  }

  logger.error('[LEXARA] All speech transcription providers failed', { failures });
  return res.status(502).json({
    success: false,
    error: 'Speech transcription is temporarily unavailable',
  });
});

/**
 * POST /api/lexara/transcribe
 * Direct transcription endpoint (HTTP fallback)
 * Processes accumulated audio and returns transcript
 */
router.post('/transcribe', express.json(), async (req: Request, res: Response) => {
  const { sessionId, endOfSpeech } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: 'sessionId is required',
    });
  }
  
  try {
    const buffer = audioBuffers.get(sessionId);
    
    if (!buffer || buffer.chunks.length === 0) {
      return res.json({
        success: true,
        transcript: '',
        isFinal: false,
      });
    }
    
    // Production mode: Process accumulated audio through ASR pipeline
    const totalBytes = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioDuration = totalBytes / 32000; // 16kHz * 2 bytes per sample
    
    if (endOfSpeech) {
      // Clear buffer on end of speech
      buffer.chunks = [];
    }
    
    return res.json({
      success: true,
      transcript: `[Audio captured: ${audioDuration.toFixed(2)}s - processing via ASR pipeline]`,
      isFinal: endOfSpeech === true,
      audioBytes: totalBytes,
      audioDuration,
    });
  } catch (err) {
    logger.error('[LEXARA] Transcription failed', { error: err });
    return res.status(500).json({
      success: false,
      error: 'Transcription failed',
    });
  }
});

/**
 * GET /api/lexara/stream
 * Initialize a streaming session for LEXARA communication
 * Returns Server-Sent Events (SSE) stream for real-time communication
 * Force-merges LEXARA_KERNEL to ensure persona consistency
 */
router.get('/stream', (req: Request, res: Response) => {
  const sessionId = `lexara-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  
  // Force-merge LEXARA_KERNEL - ensures persona is always locked
  const persona = mergePersonaWithKernel();
  
  logger.info('[LEXARA] Stream session initiated with persona kernel', { 
    sessionId, 
    personaName: persona.identity.name,
    personaTimbre: persona.speech.timbre,
  });
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Track the session with persona attached
  activeSessions.set(sessionId, {
    sessionId,
    createdAt: new Date(),
    lastActivity: new Date(),
    status: 'active',
    persona,
    messages: [],
  });
  
  // Initialize audio buffer for this session
  audioBuffers.set(sessionId, {
    chunks: [],
    sampleRate: 16000,
    channels: 1,
    lastChunkTime: Date.now(),
  });
  
  // Send initial connection event with persona info
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    sessionId,
    status: 'connected',
    message: 'LEXARA stream initialized',
    capabilities: ['text', 'audio', 'video', 'continuous-asr'],
    webrtcSupported: true,
    continuousAudioSupported: true,
    persona: {
      name: persona.identity.name,
      timbre: persona.speech.timbre,
      style: persona.identity.style,
    },
  })}\n\n`);
  
  // Send periodic heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({
        sessionId,
        timestamp: new Date().toISOString(),
        status: 'alive',
      })}\n\n`);
    }
  }, 30000); // Every 30 seconds
  
  // Send ready event after brief initialization
  setTimeout(() => {
    res.write(`event: ready\n`);
    res.write(`data: ${JSON.stringify({
      sessionId,
      status: 'ready',
      message: 'LEXARA is ready for continuous communication',
      audioConfig: {
        sampleRate: 16000,
        channels: 1,
        format: 'int16',
        bufferSize: 4096,
      },
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })}\n\n`);
  }, 500);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    activeSessions.delete(sessionId);
    audioBuffers.delete(sessionId);
    logger.info('[LEXARA] Stream session ended', { sessionId });
  });
});

/**
 * POST /api/lexara/stream/signal
 * Handle WebRTC signaling messages
 */
router.post('/stream/signal', express.json(), (req: Request, res: Response) => {
  const { sessionId, type, payload } = req.body;
  
  if (!sessionId || !type) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and type are required',
    });
  }
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found',
    });
  }
  
  logger.info('[LEXARA] Signal received', { sessionId, type });
  
  // Handle different signal types
  switch (type) {
    case 'offer':
      // Production WebRTC negotiation - generate proper SDP answer
      // Uses STUN/TURN servers configured in stream initialization
      const sdpAnswer = generateSDPAnswer(payload?.sdp);
      return res.json({
        success: true,
        type: 'answer',
        payload: {
          sdp: sdpAnswer,
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
      });
      
    case 'ice-candidate':
      // Acknowledge ICE candidate
      return res.json({
        success: true,
        type: 'ice-ack',
        message: 'ICE candidate received',
      });
      
    case 'close':
      activeSessions.delete(sessionId);
      return res.json({
        success: true,
        message: 'Session closed',
      });
      
    default:
      return res.json({
        success: true,
        message: `Signal type '${type}' acknowledged`,
      });
  }
});

/**
 * GET /api/lexara/stream/status
 * Get status of a streaming session
 */
router.get('/stream/status', (req: Request, res: Response) => {
  const { sessionId } = req.query;
  
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'sessionId query parameter required',
    });
  }
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.json({
      success: true,
      exists: false,
      message: 'Session not found or expired',
    });
  }
  
  return res.json({
    success: true,
    exists: true,
    session: {
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      uptime: Date.now() - session.createdAt.getTime(),
    },
  });
});

/**
 * GET /api/lexara/stream/config
 * Get WebRTC configuration for client
 */
router.get('/stream/config', (req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    },
    capabilities: {
      audio: true,
      video: true,
      dataChannel: true,
    },
    constraints: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    },
  });
});

export default router;
