import { createLogger } from '../logger';

const log = createLogger('LexaraTTSMesh');

export type LexaraTTSProviderId =
  | 'mistral'
  | 'gemini'
  | 'deepgram'
  | 'xai'
  | 'groq'
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

export interface LexaraTTSStream {
  provider: LexaraTTSProviderId;
  body: ReadableStream<Uint8Array>;
  mimeType: string;
  voiceId: string | null;
  model: string;
  firstByteLatencyMs: number;
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
  lastModel?: string;
  lastVoiceId?: string | null;
}

interface MistralVoice {
  id?: string;
  name?: string;
  slug?: string;
  gender?: string | null;
  languages?: string[];
}

const runtime = new Map<LexaraTTSProviderId, ProviderRuntimeState>();
const probeInFlight = new Map<LexaraTTSProviderId, Promise<boolean>>();
const LEXARA_TTS_READY_TTL_MS = 5 * 60_000;
const LEXARA_TTS_RECOVERY_PROBE_MS = 5 * 60_000;
const LEXARA_TTS_TRANSIENT_COOLDOWN_MS = 15_000;
const LEXARA_TTS_PROBE_TIMEOUT_MS = 4_000;
const LEXARA_TTS_REQUEST_TIMEOUT_MS = 8_000;
const MISTRAL_VOICE_CACHE_TTL_MS = 30 * 60_000;
let mistralVoiceCache: { id: string; expiresAt: number } | null = null;
let warmStandbyTimerStarted = false;

function deepgramApiKey(): string {
  return process.env.DEEPGRAM_API_KEY?.trim()
    || process.env.DEEPGRAM?.trim()
    || '';
}

const LEXARA_FEMALE_VOICE = {
  deepgram: process.env.DEEPGRAM_TTS_MODEL?.trim() || 'flux-haley-en',
  gemini: process.env.GEMINI_TTS_VOICE?.trim() || 'Kore',
  groq: process.env.GROQ_TTS_VOICE?.trim() || 'hannah',
  azure: process.env.AZURE_TTS_VOICE?.trim() || 'en-US-JennyNeural',
  xai: process.env.XAI_TTS_VOICE_ID?.trim() || 'eve',
} as const;

export function getLexaraVoiceProfileBindings() {
  return {
    name: 'LEXARA',
    gender: 'female' as const,
    bindings: {
      deepgram: LEXARA_FEMALE_VOICE.deepgram,
      gemini: LEXARA_FEMALE_VOICE.gemini,
      groq: LEXARA_FEMALE_VOICE.groq,
      azure: LEXARA_FEMALE_VOICE.azure,
      xai: LEXARA_FEMALE_VOICE.xai,
    },
  };
}

function providerIndependenceDomain(provider: LexaraTTSProviderId): string {
  return provider;
}

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
      return !!deepgramApiKey();
    case 'xai':
      return !!process.env.XAI_API_KEY?.trim();
    case 'groq':
      return !!process.env.GROQ_API_KEY?.trim();
    case 'azure':
      return !!(process.env.AZURE_SPEECH_KEY?.trim() && process.env.AZURE_SPEECH_REGION?.trim());
    case 'elevenlabs':
      return !!(process.env.ELEVENLABS_API_KEY?.trim() && process.env.ELEVENLABS_VOICE_ID?.trim());
  }
}

const BASE_ORDER: LexaraTTSProviderId[] = [
  'deepgram',
  'gemini',
  'mistral',
  'groq',
  'azure',
  'xai',
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
  const conversationalPrimaryBonus = provider === 'deepgram'
    ? 140
    : provider === 'gemini'
      ? 40
      : 0;
  const quotaPenalty = typeof state.quotaRemaining === 'number' && state.quotaRemaining < 100 ? 100 : 0;
  return base + readinessBonus + conversationalPrimaryBonus - failureRate * 250 - latencyPenalty - slowRoutePenalty - quotaPenalty;
}

function orderedCandidates(): LexaraTTSProviderId[] {
  return getConfiguredLexaraTTSProviders()
    .filter(provider => ready(provider))
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

function markSuccess(
  provider: LexaraTTSProviderId,
  latencyMs: number,
  model?: string,
  voiceId?: string | null,
): void {
  const state = stateFor(provider);
  state.successes += 1;
  state.lastFailure = undefined;
  state.lastError = undefined;
  state.cooldownUntil = 0;
  state.blockedUntil = 0;
  state.verifiedAt = Date.now();
  state.state = 'ready';
  if (model) state.lastModel = model;
  if (voiceId !== undefined) state.lastVoiceId = voiceId;
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
  const parentSignal = init.signal;
  const relayAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener('abort', relayAbort, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`TTS request timed out after ${timeoutMs}ms without audio progress`)), timeoutMs);
  };
  const cleanup = () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relayAbort);
  };
  armTimeout();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.body) { cleanup(); return response; }
    const reader = response.body.getReader();
    let finished = false;
    let onAbort: () => void;
    const finish = () => {
      finished = true;
      cleanup();
      controller.signal.removeEventListener('abort', onAbort);
    };
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        onAbort = () => {
          if (finished) return;
          finish();
          stream.error(controller.signal.reason);
          void reader.cancel(controller.signal.reason).catch(() => undefined);
        };
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      },
      async pull(stream) {
        try {
          const part = await reader.read();
          if (finished) return;
          if (part.done) { finish(); stream.close(); return; }
          if (part.value.length) armTimeout();
          stream.enqueue(part.value);
        } catch (error) {
          if (!finished) { finish(); stream.error(error); }
        }
      },
      async cancel(reason) { finish(); await reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    cleanup();
    throw error;
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
  markSuccess(provider, latencyMs, model, voiceId);
  return {
    provider,
    audioData,
    mimeType: response.headers.get('content-type') || 'audio/mpeg',
    voiceId,
    model,
    latencyMs,
  };
}

async function fetchMistralVoiceDetails(voiceId: string, signal?: AbortSignal): Promise<MistralVoice | null> {
  const response = await fetchWithTimeout(
    `https://api.mistral.ai/v1/audio/voices/${encodeURIComponent(voiceId)}`,
    { headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY!.trim()}`, Accept: 'application/json' }, signal },
    2_500,
  );
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const failure = classifyFailure(response.status, detail);
    const message = `mistral voice details ${failure} (${response.status}): ${detail}`;
    markFailure('mistral', failure, message, retryAfterMs(response));
    throw new Error(message);
  }
  const detail = await response.json() as MistralVoice;
  return detail?.id === voiceId ? detail : null;
}

async function resolveMistralVoiceId(force = false, signal?: AbortSignal): Promise<string> {
  if (!force && mistralVoiceCache && mistralVoiceCache.expiresAt > Date.now()) {
    return mistralVoiceCache.id;
  }

  const speaksEnglish = (voice: MistralVoice) =>
    !voice.languages?.length || voice.languages.some(language => /^en(?:-|$)/i.test(language));
  const isFemale = (voice: MistralVoice) => String(voice.gender || '').toLowerCase() === 'female';
  const isKnownFemalePreset = (voice: MistralVoice) => {
    const identity = [voice.name, voice.slug].filter(Boolean).join(' ').toLowerCase();
    return /(?:^|[_ -])lexara(?:[_ -]|$)|(?:^|[_ -])jane(?:[_ -]|$)|(?:^|[_ -])marie(?:[_ -]|$)|female/.test(identity);
  };
  const isVerifiedFemaleEnglish = (voice: MistralVoice) =>
    speaksEnglish(voice) && (isFemale(voice) || (!voice.gender && isKnownFemalePreset(voice)));

  const explicit = process.env.MISTRAL_TTS_VOICE_ID?.trim();
  if (explicit) {
    const detail = await fetchMistralVoiceDetails(explicit, signal);
    if (detail && isVerifiedFemaleEnglish(detail)) {
      mistralVoiceCache = { id: explicit, expiresAt: Date.now() + MISTRAL_VOICE_CACHE_TTL_MS };
      return explicit;
    }
    const message = 'configured Mistral TTS voice is not a verified female English voice';
    markFailure('mistral', 'configuration_blocked', message);
    throw new Error(message);
  }

  const response = await fetchWithTimeout(
    'https://api.mistral.ai/v1/audio/voices?type=all&limit=100',
    {
      signal,
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

  // Full catalog metadata can already establish the voice. Lightweight entries
  // need details, but their names must survive sparse/null detail fields.
  const orderedVoices = preferredName
    ? [...voices.filter(matchesName), ...voices.filter(voice => !matchesName(voice))]
    : voices;
  const catalogVerified = orderedVoices.find(voice =>
    isFemale(voice) && !!voice.languages?.length && speaksEnglish(voice));
  if (catalogVerified?.id) {
    mistralVoiceCache = { id: catalogVerified.id, expiresAt: Date.now() + MISTRAL_VOICE_CACHE_TTL_MS };
    return catalogVerified.id;
  }
  const selection: { voice: MistralVoice | null } = { voice: null };
  let cursor = 0;
  const lookupErrors: unknown[] = [];
  const workerCount = Math.min(8, orderedVoices.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!selection.voice && !lookupErrors.length) {
      const candidate = orderedVoices[cursor++];
      if (!candidate) return;
      try {
        const detail = await fetchMistralVoiceDetails(String(candidate.id), signal);
        if (!detail) continue;
        const merged = { ...candidate, ...Object.fromEntries(Object.entries(detail).filter(([, value]) => value != null)) };
        if (isVerifiedFemaleEnglish(merged)) { selection.voice = merged; return; }
      } catch (error) { lookupErrors.push(error); }
    }
  }));
  if (lookupErrors.length) throw lookupErrors[0];
  if (!selection.voice?.id) {
    const message = 'mistral voice catalog contains no LEXARA-compatible female English voice';
    markFailure('mistral', 'configuration_blocked', message);
    throw new Error(message);
  }

  const id = String(selection.voice.id);
  mistralVoiceCache = { id, expiresAt: Date.now() + MISTRAL_VOICE_CACHE_TTL_MS };
  return id;
}

async function synthesizeMistral(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'mistral';
  const startedAt = Date.now();
  const model = process.env.MISTRAL_TTS_MODEL?.trim() || 'voxtral-mini-tts-2603';
  const voiceId = await resolveMistralVoiceId(false, signal);
  const response = await fetchWithTimeout('https://api.mistral.ai/v1/audio/speech', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice_id: voiceId,
      response_format: 'mp3',
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

  const audioData = raw;
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs, model, voiceId);
  return { provider, audioData, mimeType: 'audio/mpeg', voiceId, model, latencyMs };
}

async function synthesizeGemini(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'gemini';
  const startedAt = Date.now();
  const key = process.env.GEMINI_API_KEY!.trim();
  const model = process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.1-flash-tts-preview';
  const voiceId = LEXARA_FEMALE_VOICE.gemini;
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
    signal,
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
  markSuccess(provider, latencyMs, model, voiceId);
  return { provider, audioData, mimeType: 'audio/wav', voiceId, model, latencyMs };
}

async function synthesizeDeepgram(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'deepgram';
  const startedAt = Date.now();
  const model = LEXARA_FEMALE_VOICE.deepgram;
  const voiceId = model;
  const flux = model.startsWith('flux-');
  const endpoint = flux ? '/v2/speak' : '/v1/speak';
  const query = flux
    ? `model=${encodeURIComponent(model)}&encoding=mp3`
    : `model=${encodeURIComponent(model)}`;
  const response = await fetchWithTimeout(
    `https://api.deepgram.com${endpoint}?${query}`,
    {
      method: 'POST',
    signal,
      headers: {
        Authorization: `Token ${deepgramApiKey()}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text }),
    },
    probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS,
  );
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

async function synthesizeXai(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'xai';
  const startedAt = Date.now();
  const model = process.env.XAI_TTS_MODEL?.trim() || 'grok-voice-tts-1.0';
  const voiceId = LEXARA_FEMALE_VOICE.xai;
  const response = await fetchWithTimeout('https://api.x.ai/v1/tts', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice_id: voiceId, language: 'en' }),
  }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);
  return requireAudioResponse(provider, response, voiceId, model, startedAt);
}

function splitGroqSpeech(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 200) {
    let end = remaining.lastIndexOf(' ', 199) + 1;
    if (end < 80) end = 200;
    // Never split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function joinGroqWav(chunks: Buffer[]): Buffer {
  let format: Buffer | undefined;
  const data: Buffer[] = [];
  for (const audio of chunks) {
    if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Groq returned an invalid WAV format');
    }
    let currentFormat: Buffer | undefined;
    const currentData: Buffer[] = [];
    for (let offset = 12; offset + 8 <= audio.length;) {
      const id = audio.toString('ascii', offset, offset + 4);
      const size = audio.readUInt32LE(offset + 4);
      const end = offset + 8 + size;
      if (end > audio.length) throw new Error('Groq returned a truncated WAV chunk');
      if (id === 'fmt ') currentFormat = audio.subarray(offset + 8, end);
      if (id === 'data') currentData.push(audio.subarray(offset + 8, end));
      offset = end + (size % 2);
    }
    if (!currentFormat || currentFormat.length < 16 || currentFormat.readUInt16LE(0) !== 1 || !currentData.some(part => part.length > 0)) {
      throw new Error('Groq returned an unsupported or empty PCM WAV format');
    }
    if (format && !format.equals(currentFormat)) throw new Error('Groq returned incompatible WAV formats');
    const blockAlign = currentFormat.readUInt16LE(12);
    if (!blockAlign || currentData.some(part => part.length % blockAlign)) throw new Error('Groq returned incomplete WAV samples');
    format = currentFormat;
    data.push(...currentData);
  }
  if (!format || !data.length) throw new Error('Groq returned no WAV audio');
  if (chunks.length === 1) return chunks[0];
  const samples = Buffer.concat(data);
  const fmtHeader = Buffer.alloc(8); fmtHeader.write('fmt '); fmtHeader.writeUInt32LE(format.length, 4);
  const dataHeader = Buffer.alloc(8); dataHeader.write('data'); dataHeader.writeUInt32LE(samples.length, 4);
  const content = Buffer.concat([Buffer.from('WAVE'), fmtHeader, format, Buffer.alloc(format.length % 2), dataHeader, samples, Buffer.alloc(samples.length % 2)]);
  const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(content.length, 4);
  return Buffer.concat([header, content]);
}

async function synthesizeGroq(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'groq';
  const startedAt = Date.now();
  const model = process.env.GROQ_TTS_MODEL?.trim() || 'canopylabs/orpheus-v1-english';
  const voiceId = LEXARA_FEMALE_VOICE.groq;
  const chunks: Buffer[] = [];
  for (const input of splitGroqSpeech(text)) {
    signal?.throwIfAborted();
    const response = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, voice: voiceId, response_format: 'wav' }),
    }, probe ? LEXARA_TTS_PROBE_TIMEOUT_MS : LEXARA_TTS_REQUEST_TIMEOUT_MS);
    if (!response.ok) return requireAudioResponse(provider, response, voiceId, model, startedAt);
    chunks.push(Buffer.from(await response.arrayBuffer()));
  }
  const audioData = joinGroqWav(chunks);
  const latencyMs = Date.now() - startedAt;
  markSuccess(provider, latencyMs, model, voiceId);
  return { provider, audioData, mimeType: 'audio/wav', voiceId, model, latencyMs };
}

async function firstAudioBody(body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  let first = await reader.read();
  while (!first.done && !first.value.length) first = await reader.read();
  if (first.done) throw new Error('TTS returned empty audio');
  return new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(first.value!); },
    async pull(stream) {
      try { const next = await reader.read(); if (next.done) stream.close(); else stream.enqueue(next.value); }
      catch (error) { stream.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

async function openDeepgramSpeechStream(text: string, signal?: AbortSignal): Promise<LexaraTTSStream | null> {
  const provider: LexaraTTSProviderId = 'deepgram';
  if (!ready(provider)) return null;

  const model = LEXARA_FEMALE_VOICE.deepgram;
  const flux = model.startsWith('flux-');
  const endpoint = flux ? '/v2/speak' : '/v1/speak';
  const query = flux
    ? `model=${encodeURIComponent(model)}&encoding=mp3`
    : `model=${encodeURIComponent(model)}&encoding=mp3`;
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      `https://api.deepgram.com${endpoint}?${query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${deepgramApiKey()}`,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text }),
        signal,
      },
      LEXARA_TTS_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 700);
      const failure = classifyFailure(response.status, detail);
      const message = `deepgram streaming TTS ${failure} (${response.status}): ${detail}`;
      markFailure(provider, failure, message, retryAfterMs(response));
      return null;
    }
    const body = await firstAudioBody(response.body);
    const firstByteLatencyMs = Date.now() - startedAt;
    markSuccess(provider, firstByteLatencyMs, model, model);
    log.info('[LEXARA TTS] progressive stream opened', {
      provider,
      model,
      firstByteLatencyMs,
    });
    return {
      provider,
      body,
      mimeType: response.headers.get('content-type') || 'audio/mpeg',
      voiceId: model,
      model,
      firstByteLatencyMs,
    };
  } catch (error) {
    if (signal?.aborted) return null;
    const message = error instanceof Error ? error.message : String(error);
    markFailure(provider, 'transport_failed', message);
    return null;
  }
}

async function openElevenLabsSpeechStream(text: string, signal?: AbortSignal): Promise<LexaraTTSStream | null> {
  const provider: LexaraTTSProviderId = 'elevenlabs';
  if (!ready(provider)) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID!.trim();
  const model = process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5';
  const outputFormat = process.env.ELEVENLABS_TTS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128';
  const startedAt = Date.now();

  try {
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
        signal,
      },
      LEXARA_TTS_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 700);
      const failure = classifyFailure(response.status, detail);
      const message = `elevenlabs streaming TTS ${failure} (${response.status}): ${detail}`;
      markFailure(provider, failure, message, retryAfterMs(response));
      return null;
    }

    const body = await firstAudioBody(response.body);
    const firstByteLatencyMs = Date.now() - startedAt;
    markSuccess(provider, firstByteLatencyMs, model, voiceId);
    return {
      provider,
      body,
      mimeType: response.headers.get('content-type') || 'audio/mpeg',
      voiceId,
      model,
      firstByteLatencyMs,
    };
  } catch (error) {
    if (signal?.aborted) return null;
    const message = error instanceof Error ? error.message : String(error);
    markFailure(provider, 'transport_failed', message);
    return null;
  }
}

const LEXARA_TTS_HEDGE_DELAY_MS = 650;

async function openProgressiveProvider(
  provider: LexaraTTSProviderId,
  text: string,
  signal?: AbortSignal,
): Promise<LexaraTTSStream | null> {
  if (provider === 'deepgram') return openDeepgramSpeechStream(text, signal);
  if (provider === 'elevenlabs') return openElevenLabsSpeechStream(text, signal);
  // MP3 buffer adapters may rescue the same playback pipe. WAV routes remain
  // buffered-only because multi-part speech concatenates MP3, not WAV headers.
  const audio = await synthesizeWith(provider, text, false, signal);
  return { provider, body: new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(audio.audioData); stream.close(); } }),
    mimeType: audio.mimeType, voiceId: audio.voiceId, model: audio.model, firstByteLatencyMs: audio.latencyMs };
}

function raceVoiceRoutes<T>(
  providers: LexaraTTSProviderId[],
  attempt: (provider: LexaraTTSProviderId, signal: AbortSignal) => Promise<T | null>,
  discard: (value: T) => void = () => undefined,
): Promise<T | null> {
  if (!providers.length) return Promise.resolve(null);
  return new Promise(resolve => {
    const controllers = new Map<LexaraTTSProviderId, AbortController>();
    let cursor = 0;
    let active = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const startNext = () => {
      if (settled || cursor >= providers.length) return;
      const provider = providers[cursor++];
      const controller = new AbortController();
      controllers.set(provider, controller);
      active += 1;
      void attempt(provider, controller.signal).then(value => {
        if (!value) return;
        if (settled) { discard(value); return; }
        settled = true;
        clearTimeout(hedgeTimer);
        for (const [other, pending] of controllers) if (other !== provider) pending.abort('tts-hedge-loser');
        resolve(value);
      }).catch(() => undefined).finally(() => {
        active -= 1;
        if (settled) return;
        if (cursor < providers.length) startNext();
        else if (!active) { settled = true; clearTimeout(hedgeTimer); resolve(null); }
      });
    };
    startNext();
    if (providers.length > 1) hedgeTimer = setTimeout(startNext, LEXARA_TTS_HEDGE_DELAY_MS);
  });
}

export async function openLexaraSpeechStream(text: string): Promise<LexaraTTSStream | null> {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const candidates = orderedCandidates().filter(provider => provider !== 'gemini' && provider !== 'groq');
  return raceVoiceRoutes(candidates, (provider, signal) => openProgressiveProvider(provider, clean, signal),
    stream => { void stream.body.cancel('tts-hedge-loser').catch(() => undefined); });
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

async function synthesizeAzure(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
  const provider: LexaraTTSProviderId = 'azure';
  const startedAt = Date.now();
  const region = process.env.AZURE_SPEECH_REGION!.trim();
  const voiceId = LEXARA_FEMALE_VOICE.azure;
  const model = 'azure-neural-tts';
  const response = await fetchWithTimeout(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
    signal,
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

async function synthesizeElevenLabs(text: string, probe = false, signal?: AbortSignal): Promise<LexaraTTSAudio> {
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
    signal,
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
  signal?: AbortSignal,
): Promise<LexaraTTSAudio> {
  const failuresBefore = stateFor(provider).failures;
  try {
    signal?.throwIfAborted();
    switch (provider) {
      case 'mistral': return await synthesizeMistral(text, probe, signal);
      case 'gemini': return await synthesizeGemini(text, probe, signal);
      case 'deepgram': return await synthesizeDeepgram(text, probe, signal);
      case 'xai': return await synthesizeXai(text, probe, signal);
      case 'groq': return await synthesizeGroq(text, probe, signal);
      case 'azure': return await synthesizeAzure(text, probe, signal);
      case 'elevenlabs': return await synthesizeElevenLabs(text, probe, signal);
    }
  } catch (error) {
    if (!signal?.aborted && stateFor(provider).failures === failuresBefore) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = error instanceof SyntaxError || /WAV|empty audio|no audio/i.test(message) ? 'invalid_response' : 'transport_failed';
      markFailure(provider, failure, message);
    }
    throw error;
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
      const result = await synthesizeWith(provider, 'Ready.', true);
      log.info('[LEXARA TTS] readiness probe verified', {
        provider,
        model: result.model,
        voiceId: result.voiceId,
        latencyMs: result.latencyMs,
      });
      return true;
    } catch {
      log.warn('[LEXARA TTS] provider readiness probe degraded locally; mesh fallback remains authoritative', { provider, failure: state.lastFailure });
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
  const refresh = () => {
    void refreshLexaraTTSReadiness(false)
      .then(readiness => {
        log.info('[LEXARA TTS] warm readiness snapshot', {
          healthyProviders: readiness.healthyProviders,
          streamingProviders: readiness.streamingProviders,
          independentDomains: readiness.independentDomains,
          voiceStatus: readiness.voiceStatus,
        });
      })
      .catch(error => {
        log.warn('[LEXARA TTS] background warmup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  refresh();
  if (warmStandbyTimerStarted) return;
  warmStandbyTimerStarted = true;

  const timer = setInterval(refresh, 90_000);
  if (typeof timer.unref === 'function') timer.unref();
}

export async function synthesizeLexaraSpeechWithFailover(text: string): Promise<LexaraTTSAudio> {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Text is required for LEXARA TTS');

  let candidates = orderedCandidates();
  if (!candidates.length) {
    await refreshLexaraTTSReadiness(false);
    candidates = orderedCandidates();
  }
  if (!candidates.length) {
    throw new Error('No verified healthy LEXARA TTS provider is currently available');
  }

  const errors: string[] = [];
  const result = await raceVoiceRoutes(candidates, async (provider, signal) => {
    try { return await synthesizeWith(provider, clean, false, signal); }
    catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        log.warn('[LEXARA TTS] provider failed locally; trying next verified route', { provider, failure: stateFor(provider).lastFailure });
      }
      return null;
    }
  });
  if (!result) throw new Error(`All verified compatible LEXARA TTS routes failed: ${errors.join(' | ').slice(0, 1_800)}`);
  log.info('[LEXARA TTS] synthesis succeeded', { provider: result.provider, model: result.model, latencyMs: result.latencyMs, bytes: result.audioData.length });
  return result;
}

export function getLexaraTTSReadiness() {
  const configuredProviders = getConfiguredLexaraTTSProviders();
  const healthyProviders = configuredProviders
    .filter(ready)
    .sort((a, b) => providerScore(b) - providerScore(a));

  const streamingProviders = healthyProviders.filter(provider =>
    provider === 'deepgram' || provider === 'elevenlabs'
  );
  const independentDomains = [...new Set(healthyProviders.map(providerIndependenceDomain))];
  const redundancyVerified = independentDomains.length >= 2;

  return {
    available: healthyProviders.length > 0,
    degraded: !redundancyVerified,
    redundancyVerified,
    independentDomains,
    configuredProviders,
    healthyProviders,
    streamingProviders,
    voiceStatus: redundancyVerified
      ? 'live'
      : healthyProviders.length > 0
        ? 'degraded'
        : 'reconnecting',
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
        model: state.lastModel || null,
        voiceId: state.lastVoiceId ?? null,
        independenceDomain: providerIndependenceDomain(provider),
        successes: state.successes,
        failures: state.failures,
        ewmaLatencyMs: state.ewmaLatencyMs ? Math.round(state.ewmaLatencyMs) : null,
      };
    }),
  };
}
