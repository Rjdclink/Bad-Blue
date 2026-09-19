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
  | 'configuration_blocked'
  | 'rate_limited'
  | 'capacity_exhausted'
  | 'billing_blocked'
  | 'auth_blocked'
  | 'permission_blocked'
  | 'model_unavailable'
  | 'transport_failed'
  | 'invalid_response';

export type LexaraTTSOperationalState =
  | 'unconfigured'
  | 'probing'
  | 'ready'
  | 'degraded'
  | 'rate_limited'
  | 'capacity_exhausted'
  | 'billing_blocked'
  | 'auth_blocked'
  | 'permission_blocked'
  | 'configuration_blocked'
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
  verifiedAt: number;
  state: LexaraTTSOperationalState;
  lastFailure?: LexaraTTSFailureClass;
  lastError?: string;
  quotaRemaining?: number;
  quotaResetAt?: number;
}

interface MistralVoice {
  id?: string;
  name?: string;
  slug?: string;
  gender?: string | null;
  languages?: string[];
}

interface OpenRouterSpeechModel {
  id?: string;
}

const runtime = new Map<LexaraTTSProviderId, ProviderRuntimeState>();
const probeInFlight = new Map<LexaraTTSProviderId, Promise<boolean>>();
const LEXARA_TTS_READY_TTL_MS = 5 * 60_000;
const LEXARA_TTS_RECOVERY_PROBE_MS = 5 * 60_000;
const LEXARA_TTS_TRANSIENT_COOLDOWN_MS = 15_000;
const LEXARA_TTS_PROBE_TIMEOUT_MS = 4_000;
const LEXARA_TTS_REQUEST_TIMEOUT_MS = 8_000;
const MISTRAL_VOICE_CACHE_TTL_MS = 30 * 60_000;
const OPENROUTER_CATALOG_TTL_MS = 10 * 60_000;
let mistralVoiceCache: { id: string; expiresAt: number } | null = null;
let openRouterCatalogCache: { ids: Set<string>; expiresAt: number } | null = null;

function stateFor(provider: LexaraTTSProviderId): ProviderRuntimeState {
  const existing = runtime.get(provider);
  if (existing) return existing;
  const created: ProviderRuntimeState = {
    cooldownUntil: 0,
    blockedUntil: 0,
    failures: 0,
    successes: 0,
    ewmaLatencyMs: 0,
    verifiedAt: 0,
    state: 'unconfigured',
  };
  runtime.set(provider, created);
  return created;
}

function configured(provider: LexaraTTSProviderId): boolean {
  switch (provider) {
    case 'mistral':
      return !!process.env.MISTRAL_API_KEY?.trim();
    case 'gemini':
      // Do not fall back to GOOGLE_API_KEY. Gemini rejected standard Google keys
      // in September 2026; this route requires the dedicated current Gemini key.
      return !!process.env.GEMINI_API_KEY?.trim();
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
  'openrouter',
  'gemini',
  'deepgram',
  'xai',
  'groq',
  'azure',
  'elevenlabs',
];

export function getConfiguredLexaraTTSProviders(): LexaraTTSProviderId[] {
  return BASE_ORDER.filter(configured);
}

function ready(provider: LexaraTTSProviderId): boolean {
  if (!configured(provider)) return false;
  const state = stateFor(provider);
  const now = Date.now();
  return state.state === 'ready'
    && state.verifiedAt > 0
    && now - state.verifiedAt <= LEXARA_TTS_READY_TTL_MS
    && state.cooldownUntil <= now
    && state.blockedUntil <= now;
}

function eligibleForProbe(provider: LexaraTTSProviderId): boolean {
  if (!configured(provider)) return false;
  const state = stateFor(provider);
  const now = Date.now();
  return state.cooldownUntil <= now && state.blockedUntil <= now;
}

function providerScore(provider: LexaraTTSProviderId): number {
  const state = stateFor(provider);
  const base = 1_000 - BASE_ORDER.indexOf(provider) * 10;
  const samples = state.successes + state.failures;
  const failureRate = samples ? state.failures / samples : 0;
  // Conversational speech must heavily penalize routes whose measured first
  // audio is slow. The previous 300-point cap let a 13-second gateway remain
  // competitive with a ~1-second direct route.
  const latencyPenalty = state.ewmaLatencyMs > 0 ? Math.min(700, state.ewmaLatencyMs / 10) : 0;
  const slowRoutePenalty = state.ewmaLatencyMs > 4_500 ? 250 : 0;
  const readinessBonus = ready(provider) ? 300 : 0;
  const quotaPenalty = typeof state.quotaRemaining === 'number' && state.quotaRemaining < 100 ? 100 : 0;
  return base + readinessBonus - failureRate * 250 - latencyPenalty - slowRoutePenalty - quotaPenalty;
}

function orderedCandidates(text: string): LexaraTTSProviderId[] {
  return getConfiguredLexaraTTSProviders()
    .filter(provider => ready(provider))
    .filter(provider => provider !== 'groq' || text.length <= 200)
    .sort((a, b) => providerScore(b) - providerScore(a));
}

function classifyFailure(status: number, detail: string): LexaraTTSFailureClass {
  const lower = detail.toLowerCase();
  if (
    /api key not valid|invalid api key|unauthorized|authentication|invalid_api_key/.test(lower)
    || status === 401 && !/quota_exceeded|quota exceeded/.test(lower)
  ) {
    return 'auth_blocked';
  }
  if (
    /model_terms_required|terms acceptance|not allowed|allowed-providers|permission|provider policy/.test(lower)
    || status === 403
  ) {
    return 'permission_blocked';
  }
  if (
    /either ref_audio or voice must be provided|voice(?:_id)? .*required|missing voice|configuration/.test(lower)
  ) {
    return 'configuration_blocked';
  }
  if (/quota_exceeded|quota exceeded|capacity exhausted/.test(lower)) return 'capacity_exhausted';
  if (
    status === 402
    || /payment required|billing|credits? (?:remaining|depleted|required)|insufficient credit/.test(lower)
  ) {
    return 'billing_blocked';
  }
  if (status === 429 || /rate.?limit|too many requests/.test(lower)) return 'rate_limited';
  if (status === 404 || /model.*(?:not found|unavailable|retired|deprecated)|no endpoint/.test(lower)) {
    return 'model_unavailable';
  }
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

function stateFromFailure(failure: LexaraTTSFailureClass): LexaraTTSOperationalState {
  return failure;
}

function markFailure(
  provider: LexaraTTSProviderId,
  failure: LexaraTTSFailureClass,
  message: string,
  retryMs = 0,
): void {
  const state = stateFor(provider);
  state.failures += 1;
  state.lastFailure = failure;
  state.lastError = message.slice(0, 500);
  state.verifiedAt = 0;
  state.state = stateFromFailure(failure);
  const now = Date.now();

  if (
    failure === 'billing_blocked'
    || failure === 'auth_blocked'
    || failure === 'permission_blocked'
    || failure === 'configuration_blocked'
    || failure === 'model_unavailable'
  ) {
    state.blockedUntil = now + LEXARA_TTS_RECOVERY_PROBE_MS;
  } else if (failure === 'rate_limited' || failure === 'capacity_exhausted') {
    state.cooldownUntil = now + Math.max(retryMs, 60_000);
  } else {
    state.cooldownUntil = now + Math.max(retryMs, LEXARA_TTS_TRANSIENT_COOLDOWN_MS);
  }
}

function markSuccess(provider: LexaraTTSProviderId, latencyMs: number): void {
  const state = stateFor(provider);
  state.successes += 1;
  state.lastFailure = undefined;
  state.lastError = undefined;
  state.cooldownUntil = 0;
  state.blockedUntil = 0;
  state.verifiedAt = Date.now();
  state.state = 'ready';
  state.ewmaLatencyMs = state.ewmaLatencyMs <= 0
    ? latencyMs
    : state.ewmaLatencyMs * 0.75 + latencyMs * 0.25;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = LEXARA_TTS_REQUEST_TIMEOUT_MS,
): Promise<Response> {
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
    const detail = (await response.text()).slice(0, 800);
    const failure = classifyFailure(response.status, detail);
    const message = `${provider} TTS ${failure} (${response.status}): ${detail}`;
    markFailure(provider, failure, message, retryAfterMs(response));
    throw new Error(message);
  }

  const audioData = Buffer.from(await response.arrayBuffer());
  if (!audioData.length) {
    const message = `${provider} TTS returned empty audio`;
    markFailure(provider, 'invalid_response', message);
    throw new Error(message);
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

async function resolveMistralVoiceId(force = false): Promise<string> {
  const explicit = process.env.MISTRAL_TTS_VOICE_ID?.trim();
  if (explicit) return explicit;
  if (!force && mistralVoiceCache && mistralVoiceCache.expiresAt > Date.now()) {
    return mistralVoiceCache.id;
  }

  const response = await fetchWithTimeout(
    'https://api.mistral.ai/v1/audio/voices?type=preset&limit=100',
    {
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY!.trim()}`,
        Accept: 'application/json',
      },
    },
    LEXARA_TTS_PROBE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const failure = classifyFailure(response.status, detail);
    const message = `mistral voice catalog ${failure} (${response.status}): ${detail}`;
    markFailure('mistral', failure, message, retryAfterMs(response));
    throw new Error(message);
  }

  const payload = await response.json() as { items?: MistralVoice[] };
  const voices = Array.isArray(payload.items) ? payload.items.filter(voice => !!voice?.id) : [];
  if (!voices.length) {
    const message = 'mistral voice catalog returned no usable preset voices';
    markFailure('mistral', 'configuration_blocked', message);
    throw new Error(message);
  }

  const preferredName = process.env.MISTRAL_TTS_VOICE_NAME?.trim().toLowerCase();
  const matchesName = (voice: MistralVoice) => {
    if (!preferredName) return false;
    return [voice.name, voice.slug]
      .filter(Boolean)
      .some(value => String(value).toLowerCase() === preferredName);
  };
  const speaksEnglish = (voice: MistralVoice) =>
    !voice.languages?.length || voice.languages.some(language => /^en(?:-|$)/i.test(language));
  const isFemale = (voice: MistralVoice) => String(voice.gender || '').toLowerCase() === 'female';

  const isKnownFemalePreset = (voice: MistralVoice) => {
    const identity = [voice.name, voice.slug].filter(Boolean).join(' ').toLowerCase();
    return /(?:^|[_ -])jane(?:[_ -]|$)|(?:^|[_ -])marie(?:[_ -]|$)|female/.test(identity);
  };
  const selected =
    voices.find(voice => matchesName(voice) && (isFemale(voice) || isKnownFemalePreset(voice)))
    || voices.find(voice => speaksEnglish(voice) && isFemale(voice))
    || voices.find(voice => speaksEnglish(voice) && isKnownFemalePreset(voice));

  if (!selected?.id) {
    const message = 'mistral voice catalog returned no verified female English voice';
    markFailure('mistral', 'configuration_blocked', message);
    throw new Error(message);
  }

  const id = String(selected.id);
  mistralVoiceCache = { id, expiresAt: Date.now() + MISTRAL_VOICE_CACHE_TTL_MS };
  return id;
}

async function synthesizeMistral(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'mistral';
  const startedAt = Date.now();
  const model = process.env.MISTRAL_TTS_MODEL?.trim() || 'voxtral-mini-tts-2603';
  const voiceId = await resolveMistralVoiceId();
  const response = await fetchWithTimeout('https://api.mistral.ai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice_id: voiceId,
      response_format: probe ? 'pcm' : 'mp3',
      stream: false,
    }),
  }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    return requireAudioResponse(provider, response, voiceId, model, startedAt);
  }

  const payload = await response.json() as { audio_data?: string };
  const raw = Buffer.from(String(payload.audio_data || ''), 'base64');
  if (!raw.length) {
    const message = 'mistral TTS returned no audio_data';
    markFailure(provider, 'invalid_response', message);
    throw new Error(message);
  }

  const audioData = probe ? pcm16MonoToWav(raw, 24_000) : raw;
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs);
  return { provider, audioData, mimeType: probe ? 'audio/wav' : 'audio/mpeg', voiceId, model, latencyMs };
}

async function synthesizeGemini(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'gemini';
  const startedAt = Date.now();
  const key = process.env.GEMINI_API_KEY!.trim();
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
    probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    const failure = classifyFailure(response.status, detail);
    const message = `gemini TTS ${failure} (${response.status}): ${detail}`;
    markFailure(provider, failure, message, retryAfterMs(response));
    throw new Error(message);
  }

  const payload = await response.json() as any;
  const encoded = payload?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)?.inlineData?.data;
  const pcm = Buffer.from(String(encoded || ''), 'base64');
  if (!pcm.length) {
    const message = 'gemini TTS returned no inline audio';
    markFailure(provider, 'invalid_response', message);
    throw new Error(message);
  }

  const audioData = pcm16MonoToWav(pcm, 24_000);
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs);
  return { provider, audioData, mimeType: 'audio/wav', voiceId, model, latencyMs };
}

async function synthesizeDeepgram(text: string, probe = false): Promise<LexaraTTSAudio> {
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
    probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS,
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeXai(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'xai';
  const startedAt = Date.now();
  const model = process.env.XAI_TTS_MODEL?.trim() || 'grok-voice-tts-1.0';
  const voiceId = process.env.XAI_TTS_VOICE_ID?.trim() || 'eve';
  const response = await fetchWithTimeout('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice_id: voiceId, language: 'en' }),
  }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeGroq(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'groq';
  const startedAt = Date.now();
  const model = process.env.GROQ_TTS_MODEL?.trim() || 'canopylabs/orpheus-v1-english';
  const voiceId = process.env.GROQ_TTS_VOICE?.trim() || 'hannah';
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text.slice(0, 200), voice: voiceId, response_format: 'wav' }),
  }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function loadOpenRouterSpeechCatalog(force = false): Promise<Set<string>> {
  if (!force && openRouterCatalogCache && openRouterCatalogCache.expiresAt > Date.now()) {
    return openRouterCatalogCache.ids;
  }

  try {
    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/models?output_modalities=speech',
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
          Accept: 'application/json',
        },
      },
      LEXARA_TTS_PROBE_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`catalog status ${response.status}`);
    const payload = await response.json() as { data?: OpenRouterSpeechModel[] };
    const ids = new Set(
      (Array.isArray(payload.data) ? payload.data : [])
        .map(model => String(model?.id || '').trim())
        .filter(Boolean),
    );
    openRouterCatalogCache = { ids, expiresAt: Date.now() + OPENROUTER_CATALOG_TTL_MS };
    return ids;
  } catch {
    return new Set();
  }
}

function openRouterVoiceForModel(model: string): string {
  if (model === 'mistralai/voxtral-mini-tts-2603') {
    return process.env.OPENROUTER_MISTRAL_TTS_VOICE?.trim() || 'gb_jane_neutral';
  }
  if (model.startsWith('microsoft/mai-voice-2')) {
    return process.env.OPENROUTER_MICROSOFT_TTS_VOICE?.trim() || 'en-US-Harper:MAI-Voice-2';
  }
  if (model === 'x-ai/grok-voice-tts-1.0') {
    return process.env.OPENROUTER_GROK_TTS_VOICE?.trim() || 'eve';
  }
  return process.env.OPENROUTER_GEMINI_TTS_VOICE?.trim() || 'Kore';
}

async function openRouterTtsCandidates(): Promise<string[]> {
  const explicit = process.env.OPENROUTER_TTS_MODEL?.trim();
  const preferred = [
    explicit,
    'mistralai/voxtral-mini-tts-2603',
    'google/gemini-3.1-flash-tts-preview',
  ].filter((value): value is string => !!value);

  const catalog = await loadOpenRouterSpeechCatalog();
  const unique = [...new Set(preferred)];
  return catalog.size ? unique.filter(model => catalog.has(model)) : unique;
}

async function synthesizeOpenRouter(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'openrouter';
  const candidates = await openRouterTtsCandidates();
  const errors: string[] = [];

  for (const model of candidates) {
    const startedAt = Date.now();
    const voiceId = openRouterVoiceForModel(model);
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_BASE_URL?.trim() || 'https://legalwhat.com',
        'X-Title': 'Legal What LEXARA',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: voiceId,
        response_format: model.startsWith('google/') ? 'pcm' : 'mp3',
      }),
    }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);

    if (response.ok) {
      if (model.startsWith('google/')) {
        const pcm = Buffer.from(await response.arrayBuffer());
        if (!pcm.length) {
          const message = 'openrouter Gemini TTS returned empty PCM audio';
          markFailure(provider, 'invalid_response', message);
          throw new Error(message);
        }
        const latencyMs = Date.now() - startedAt;
        markSuccess(provider, latencyMs);
        return {
          provider,
          audioData: pcm16MonoToWav(pcm, 24_000),
          mimeType: 'audio/wav',
          voiceId,
          model,
          latencyMs,
        };
      }
      return requireAudioResponse(provider, response, voiceId, model, startedAt);
    }

    const detail = (await response.text()).slice(0, 700);
    errors.push(`${model}: ${response.status} ${detail}`);
    const failure = classifyFailure(response.status, detail);

    // Authentication, billing, and account-level throttling are transport-domain
    // failures. Model format/provider-policy incompatibility is route-local and
    // must not quarantine every otherwise-valid OpenRouter speech route.
    if (
      failure === 'auth_blocked'
      || failure === 'billing_blocked'
      || failure === 'capacity_exhausted'
      || failure === 'rate_limited'
    ) {
      const message = `openrouter TTS ${failure} (${response.status}): ${detail}`;
      markFailure(provider, failure, message, retryAfterMs(response));
      throw new Error(message);
    }
  }

  const detail = errors.join(' | ').slice(0, 1_200);
  const message = `openrouter TTS route-local failure: ${detail || 'no compatible speech model was available'}`;
  markFailure(provider, 'invalid_response', message, 5_000);
  throw new Error(message);
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

async function synthesizeAzure(text: string, probe = false): Promise<LexaraTTSAudio> {
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
    probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS,
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function refreshElevenLabsQuota(): Promise<void> {
  const provider: LexaraTTSProviderId = 'elevenlabs';
  const response = await fetchWithTimeout(
    'https://api.elevenlabs.io/v1/user/subscription',
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!.trim(),
        Accept: 'application/json',
      },
    },
    LEXARA_TTS_PROBE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const failure = classifyFailure(response.status, detail);
    const message = `elevenlabs subscription ${failure} (${response.status}): ${detail}`;
    markFailure(provider, failure, message, retryAfterMs(response));
    throw new Error(message);
  }

  const payload = await response.json() as {
    character_count?: number;
    character_limit?: number;
    next_character_count_reset_unix?: number | null;
    status?: string;
  };
  const used = Number(payload.character_count);
  const limit = Number(payload.character_limit);
  const remaining = Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : undefined;
  const state = stateFor(provider);
  state.quotaRemaining = remaining;
  state.quotaResetAt = Number.isFinite(Number(payload.next_character_count_reset_unix))
    ? Number(payload.next_character_count_reset_unix) * 1_000
    : undefined;

  if (typeof remaining === 'number' && remaining < 16) {
    const message = `elevenlabs quota unavailable: ${remaining} characters/credits remain`;
    markFailure(provider, 'capacity_exhausted', message, state.quotaResetAt ? Math.max(60_000, state.quotaResetAt - Date.now()) : 60_000);
    throw new Error(message);
  }
}

async function synthesizeElevenLabs(text: string, probe = false): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'elevenlabs';
  if (probe) await refreshElevenLabsQuota();

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
    probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS,
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeWith(
  provider: LexaraTTSProviderId,
  text: string,
  probe = false,
): Promise<LexaraTTSAudio> {
  switch (provider) {
    case 'mistral': return synthesizeMistral(text, probe);
    case 'gemini': return synthesizeGemini(text, probe);
    case 'deepgram': return synthesizeDeepgram(text, probe);
    case 'xai': return synthesizeXai(text, probe);
    case 'groq': return synthesizeGroq(text, probe);
    case 'openrouter': return synthesizeOpenRouter(text, probe);
    case 'azure': return synthesizeAzure(text, probe);
    case 'elevenlabs': return synthesizeElevenLabs(text, probe);
  }
}

async function verifyProvider(provider: LexaraTTSProviderId, force = false): Promise<boolean> {
  if (!configured(provider)) {
    const state = stateFor(provider);
    state.state = 'unconfigured';
    state.verifiedAt = 0;
    return false;
  }
  if (!force && ready(provider)) return true;
  if (!force && !eligibleForProbe(provider)) return false;

  const existing = probeInFlight.get(provider);
  if (existing) return existing;

  const state = stateFor(provider);
  state.state = 'probing';
  const probe = (async () => {
    try {
      await synthesizeWith(provider, 'Ready.', true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('[LEXARA TTS] readiness probe failed locally', { provider, error: message });
      return false;
    } finally {
      probeInFlight.delete(provider);
    }
  })();
  probeInFlight.set(provider, probe);
  return probe;
}

export async function refreshLexaraTTSReadiness(force = false): Promise<ReturnType<typeof getLexaraTTSReadiness>> {
  const configuredProviders = getConfiguredLexaraTTSProviders();
  await Promise.all(configuredProviders.map(provider => verifyProvider(provider, force)));
  return getLexaraTTSReadiness();
}

export function warmLexaraTTSMesh(): void {
  void refreshLexaraTTSReadiness(false).catch(error => {
    log.warn('[LEXARA TTS] background warmup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function synthesizeLexaraSpeechWithFailover(text: string): Promise<LexaraTTSAudio> {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Text is required for LEXARA TTS');

  let candidates = orderedCandidates(clean);
  if (!candidates.length) {
    await refreshLexaraTTSReadiness(false);
    candidates = orderedCandidates(clean);
  }
  if (!candidates.length) {
    throw new Error('No verified healthy LEXARA TTS provider is currently available');
  }

  const errors: string[] = [];
  for (const provider of candidates) {
    try {
      const result = await synthesizeWith(provider, clean, false);
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
      log.warn('[LEXARA TTS] provider failed locally; trying next verified route', { provider, error: message });
    }
  }

  throw new Error(`All verified compatible LEXARA TTS routes failed: ${errors.join(' | ').slice(0, 1_800)}`);
}

export function getLexaraTTSReadiness() {
  const configuredProviders = getConfiguredLexaraTTSProviders();
  const healthyProviders = configuredProviders
    .filter(ready)
    .sort((a, b) => providerScore(b) - providerScore(a));

  return {
    available: healthyProviders.length > 0,
    configuredProviders,
    healthyProviders,
    verifiedAt: healthyProviders.reduce(
      (latest, provider) => Math.max(latest, stateFor(provider).verifiedAt),
      0,
    ) || null,
    providers: BASE_ORDER.map(provider => {
      const state = stateFor(provider);
      return {
        provider,
        configured: configured(provider),
        healthy: ready(provider),
        state: configured(provider) ? state.state : 'unconfigured',
        verifiedAt: state.verifiedAt || null,
        cooldownUntil: state.cooldownUntil || null,
        blockedUntil: state.blockedUntil || null,
        lastFailure: state.lastFailure || null,
        quotaRemaining: state.quotaRemaining ?? null,
        quotaResetAt: state.quotaResetAt ?? null,
        successes: state.successes,
        failures: state.failures,
        ewmaLatencyMs: state.ewmaLatencyMs ? Math.round(state.ewmaLatencyMs) : null,
      };
    }),
  };
}
