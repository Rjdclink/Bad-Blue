import { createLogger } from '../logger';

const log = createLogger('LexaraTTSMesh');

export type LexaraTTSProviderId =
  | 'mistral'
  | 'gemini'
  | 'deepgram'
  | 'xai'
  | 'groq'
  | 'openrouter'
  | 'azure'
  | 'elevenlabs';

export type LexaraTTSFailureClass =
  | 'rate_limited'
  | 'capacity_exhausted'
  | 'billing_blocked'
  | 'auth_blocked'
  | 'permission_blocked'
  | 'model_unavailable'
  | 'transport_failed'
  | 'invalid_response';

export interface LexaraTTSAudio {
  provider: LexaraTTSProviderId;
  audioData: Buffer;
  mimeType: string;
  voiceId: string | null;
  model: string;
  latencyMs: number;
}

interface ProviderRuntimeState {
  cooldownUntil: number;
  blockedUntil: number;
  failures: number;
  successes: number;
  ewmaLatencyMs: number;
  lastFailure?: LexaraTTSFailureClass;
}

const runtime = new Map<LexaraTTSProviderId, ProviderRuntimeState>();

function stateFor(provider: LexaraTTSProviderId): ProviderRuntimeState {
  const existing = runtime.get(provider);
  if (existing) return existing;
  const created: ProviderRuntimeState = {
    cooldownUntil: 0,
    blockedUntil: 0,
    failures: 0,
    successes: 0,
    ewmaLatencyMs: 0,
  };
  runtime.set(provider, created);
  return created;
}

function configured(provider: LexaraTTSProviderId): boolean {
  switch (provider) {
    case 'mistral':
      return !!process.env.MISTRAL_API_KEY?.trim();
    case 'gemini':
      return !!(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
    case 'deepgram':
      return !!process.env.DEEPGRAM_API_KEY?.trim();
    case 'xai':
      return !!process.env.XAI_API_KEY?.trim();
    case 'groq':
      return !!process.env.GROQ_API_KEY?.trim();
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY?.trim();
    case 'azure':
      return !!(process.env.AZURE_SPEECH_KEY?.trim() && process.env.AZURE_SPEECH_REGION?.trim());
    case 'elevenlabs':
      return !!(process.env.ELEVENLABS_API_KEY?.trim() && process.env.ELEVENLABS_VOICE_ID?.trim());
  }
}

const BASE_ORDER: LexaraTTSProviderId[] = [
  'mistral',
  'gemini',
  'deepgram',
  'xai',
  'groq',
  'openrouter',
  'azure',
  'elevenlabs',
];

export function getConfiguredLexaraTTSProviders(): LexaraTTSProviderId[] {
  return BASE_ORDER.filter(configured);
}

function available(provider: LexaraTTSProviderId): boolean {
  const state = stateFor(provider);
  const now = Date.now();
  return configured(provider) && state.cooldownUntil <= now && state.blockedUntil <= now;
}

function providerScore(provider: LexaraTTSProviderId): number {
  const state = stateFor(provider);
  const base = 1_000 - BASE_ORDER.indexOf(provider) * 10;
  const samples = state.successes + state.failures;
  const failureRate = samples ? state.failures / samples : 0;
  const latencyPenalty = state.ewmaLatencyMs > 0 ? Math.min(300, state.ewmaLatencyMs / 20) : 0;
  return base - failureRate * 250 - latencyPenalty;
}

function orderedCandidates(text: string): LexaraTTSProviderId[] {
  return getConfiguredLexaraTTSProviders()
    .filter(provider => available(provider))
    .filter(provider => provider !== 'groq' || text.length <= 200)
    .sort((a, b) => providerScore(b) - providerScore(a));
}

function classifyFailure(status: number, detail: string): LexaraTTSFailureClass {
  const lower = detail.toLowerCase();
  if (status === 402 || /payment required|billing|credits? (?:remaining|depleted|required)|insufficient credit/i.test(lower)) {
    return 'billing_blocked';
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(lower)) return 'rate_limited';
  if (/quota_exceeded|quota exceeded|capacity exhausted/i.test(lower)) return 'capacity_exhausted';
  if (status === 401 || /invalid api key|authentication/i.test(lower)) return 'auth_blocked';
  if (status === 403 || /permission|not allowed|blocked/i.test(lower)) return 'permission_blocked';
  if (status === 404 || /model.*(?:not found|unavailable|retired|deprecated)/i.test(lower)) return 'model_unavailable';
  if (status >= 500) return 'transport_failed';
  return 'invalid_response';
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function markFailure(provider: LexaraTTSProviderId, failure: LexaraTTSFailureClass, retryMs = 0): void {
  const state = stateFor(provider);
  state.failures += 1;
  state.lastFailure = failure;
  const now = Date.now();
  if (failure === 'billing_blocked' || failure === 'auth_blocked' || failure === 'permission_blocked') {
    state.blockedUntil = now + 30 * 60_000;
  } else if (failure === 'rate_limited' || failure === 'capacity_exhausted') {
    state.cooldownUntil = now + Math.max(retryMs, 60_000);
  } else if (failure === 'model_unavailable') {
    state.cooldownUntil = now + 10 * 60_000;
  } else {
    state.cooldownUntil = now + 10_000;
  }
}

function markSuccess(provider: LexaraTTSProviderId, latencyMs: number): void {
  const state = stateFor(provider);
  state.successes += 1;
  state.lastFailure = undefined;
  state.cooldownUntil = 0;
  state.blockedUntil = 0;
  state.ewmaLatencyMs = state.ewmaLatencyMs <= 0
    ? latencyMs
    : state.ewmaLatencyMs * 0.75 + latencyMs * 0.25;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pcm16MonoToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function requireAudioResponse(
  provider: LexaraTTSProviderId,
  response: Response,
  voiceId: string | null,
  model: string,
  startedAt: number,
): Promise<LexaraTTSAudio> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    const failure = classifyFailure(response.status, detail);
    markFailure(provider, failure, retryAfterMs(response));
    throw new Error(`${provider} TTS ${failure} (${response.status}): ${detail}`);
  }
  const audioData = Buffer.from(await response.arrayBuffer());
  if (!audioData.length) {
    markFailure(provider, 'invalid_response');
    throw new Error(`${provider} TTS returned empty audio`);
  }
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs);
  return {
    provider,
    audioData,
    mimeType: response.headers.get('content-type') || 'audio/mpeg',
    voiceId,
    model,
    latencyMs,
  };
}

async function synthesizeMistral(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'mistral';
  const startedAt = Date.now();
  const model = process.env.MISTRAL_TTS_MODEL?.trim() || 'voxtral-mini-tts-2603';
  const voiceId = process.env.MISTRAL_TTS_VOICE_ID?.trim() || null;
  const response = await fetchWithTimeout('https://api.mistral.ai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      ...(voiceId ? { voice_id: voiceId } : {}),
      response_format: 'mp3',
      stream: false,
    }),
  });
  if (!response.ok) return requireAudioResponse(provider, response, voiceId, model, startedAt);
  const payload = await response.json() as { audio_data?: string };
  const audioData = Buffer.from(String(payload.audio_data || ''), 'base64');
  if (!audioData.length) {
    markFailure(provider, 'invalid_response');
    throw new Error('mistral TTS returned no audio_data');
  }
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs);
  return { provider, audioData, mimeType: 'audio/mpeg', voiceId, model, latencyMs };
}

async function synthesizeGemini(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'gemini';
  const startedAt = Date.now();
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)!.trim();
  const model = process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.1-flash-tts-preview';
  const voiceId = process.env.GEMINI_TTS_VOICE?.trim() || 'Kore';
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
          },
        },
      }),
    },
  );
  if (!response.ok) return requireAudioResponse(provider, response, voiceId, model, startedAt);
  const payload = await response.json() as any;
  const encoded = payload?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  const pcm = Buffer.from(String(encoded || ''), 'base64');
  if (!pcm.length) {
    markFailure(provider, 'invalid_response');
    throw new Error('gemini TTS returned no inline audio');
  }
  const audioData = pcm16MonoToWav(pcm, 24_000);
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs);
  return { provider, audioData, mimeType: 'audio/wav', voiceId, model, latencyMs };
}

async function synthesizeDeepgram(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'deepgram';
  const startedAt = Date.now();
  const model = process.env.DEEPGRAM_TTS_MODEL?.trim() || 'aura-2-thalia-en';
  const voiceId = model;
  const response = await fetchWithTimeout(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    },
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeXai(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'xai';
  const startedAt = Date.now();
  const model = 'grok-voice-tts-1.0';
  const voiceId = process.env.XAI_TTS_VOICE_ID?.trim() || 'eve';
  const response = await fetchWithTimeout('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice_id: voiceId, language: 'en' }),
  });
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeGroq(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'groq';
  const startedAt = Date.now();
  const model = process.env.GROQ_TTS_MODEL?.trim() || 'canopylabs/orpheus-v1-english';
  const voiceId = process.env.GROQ_TTS_VOICE?.trim() || 'autumn';
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text, voice: voiceId, response_format: 'wav' }),
  });
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeOpenRouter(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'openrouter';
  const startedAt = Date.now();
  const model = process.env.OPENROUTER_TTS_MODEL?.trim() || 'x-ai/grok-voice-tts-1.0';
  const voiceId = process.env.OPENROUTER_TTS_VOICE?.trim() || 'eve';
  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_BASE_URL?.trim() || 'https://legalwhat.com',
      'X-Title': 'Legal What LEXARA',
    },
    body: JSON.stringify({ model, input: text, voice: voiceId, response_format: 'mp3' }),
  });
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[character] || character));
}

async function synthesizeAzure(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'azure';
  const startedAt = Date.now();
  const region = process.env.AZURE_SPEECH_REGION!.trim();
  const voiceId = process.env.AZURE_TTS_VOICE?.trim() || 'en-US-JennyNeural';
  const model = 'azure-neural-tts';
  const response = await fetchWithTimeout(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY!.trim(),
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'LegalWhat-LEXARA',
      },
      body: `<speak version="1.0" xml:lang="en-US"><voice name="${escapeXml(voiceId)}">${escapeXml(text)}</voice></speak>`,
    },
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeElevenLabs(text: string): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'elevenlabs';
  const startedAt = Date.now();
  const voiceId = process.env.ELEVENLABS_VOICE_ID!.trim();
  const model = process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5';
  const outputFormat = process.env.ELEVENLABS_TTS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128';
  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!.trim(),
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: model }),
    },
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeWith(provider: LexaraTTSProviderId, text: string): Promise<LexaraTTSAudio> {
  switch (provider) {
    case 'mistral': return synthesizeMistral(text);
    case 'gemini': return synthesizeGemini(text);
    case 'deepgram': return synthesizeDeepgram(text);
    case 'xai': return synthesizeXai(text);
    case 'groq': return synthesizeGroq(text);
    case 'openrouter': return synthesizeOpenRouter(text);
    case 'azure': return synthesizeAzure(text);
    case 'elevenlabs': return synthesizeElevenLabs(text);
  }
}

export async function synthesizeLexaraSpeechWithFailover(text: string): Promise<LexaraTTSAudio> {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Text is required for LEXARA TTS');
  const candidates = orderedCandidates(clean);
  if (!candidates.length) {
    throw new Error('No healthy LEXARA TTS provider is currently available');
  }

  const errors: string[] = [];
  for (const provider of candidates) {
    try {
      const result = await synthesizeWith(provider, clean);
      log.info('[LEXARA TTS] synthesis succeeded', {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        bytes: result.audioData.length,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      log.warn('[LEXARA TTS] provider failed locally; trying next route', { provider, error: message });
    }
  }

  throw new Error(`All compatible LEXARA TTS routes failed: ${errors.join(' | ').slice(0, 1800)}`);
}

export function getLexaraTTSReadiness() {
  const configuredProviders = getConfiguredLexaraTTSProviders();
  const healthyProviders = configuredProviders.filter(available);
  return {
    available: healthyProviders.length > 0,
    configuredProviders,
    healthyProviders,
    providers: configuredProviders.map(provider => {
      const state = stateFor(provider);
      return {
        provider,
        healthy: available(provider),
        cooldownUntil: state.cooldownUntil || null,
        blockedUntil: state.blockedUntil || null,
        lastFailure: state.lastFailure || null,
        successes: state.successes,
        failures: state.failures,
        ewmaLatencyMs: state.ewmaLatencyMs ? Math.round(state.ewmaLatencyMs) : null,
      };
    }),
  };
}
