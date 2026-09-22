/**
 * LEXARA Speech Client
 *
 * Server-side TTS integration for Lexara voice synthesis using ElevenLabs.
 * Handles audio playback with proper audio unlock for browsers.
 */

export interface UserSentiment {
  positive: boolean;
  stress: boolean;
  confusion: boolean;
}

export interface PersonaKernelSpeech {
  timbre: string;
  texture: string;
  pacing: string;
  intonation: string;
  pitch?: 'bright' | 'lower-soft' | 'normal';
}

export interface VoiceResponse {
  success: boolean;
  text: string;
  audio?: Blob;
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  durationMs?: number;
  voiceConfig: PersonaKernelSpeech;
  emotionalState: string;
}

interface PlaybackState {
  isPlaying: boolean;
  currentAudio: HTMLAudioElement | null;
  currentObjectUrl: string | null;
  currentResolve: (() => void) | null;
  currentTurnId: string | null;
  queue: Array<{ text: string; audio?: Blob }>;
  audioUnlocked: boolean;
}

const playbackState: PlaybackState = {
  isPlaying: false,
  currentAudio: null,
  currentObjectUrl: null,
  currentResolve: null,
  currentTurnId: null,
  queue: [],
  audioUnlocked: false,
};

let audioContext: AudioContext | null = null;
let playbackAudioElement: HTMLAudioElement | null = null;

function getLexaraPlaybackAudioElement(): HTMLAudioElement {
  if (!playbackAudioElement) {
    playbackAudioElement = new Audio();
    playbackAudioElement.preload = 'auto';
  }
  return playbackAudioElement;
}

/**
 * Read-only presentation clock for visual subscribers such as the live avatar.
 * This never starts, pauses, buffers, or otherwise participates in speech playback.
 */
export function getLexaraServerPlaybackClock(): {
  active: boolean;
  currentTimeSec: number;
  durationSec: number | null;
  turnId: string | null;
} {
  const audio = playbackState.currentAudio;
  const currentTimeSec = audio && Number.isFinite(audio.currentTime)
    ? Math.max(0, audio.currentTime)
    : 0;
  const durationSec = audio && Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : null;

  return {
    active: Boolean(playbackState.isPlaying && audio && !audio.paused && !audio.ended),
    currentTimeSec,
    durationSec,
    turnId: playbackState.currentTurnId,
  };
}

const SILENT_AUDIO_BASE64 = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function reportLexaraPlaybackEvent(
  event: string,
  audio?: HTMLAudioElement | null,
  details: { turnId?: string | null; reason?: string } = {},
): void {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({
    event,
    turnId: details.turnId ?? playbackState.currentTurnId,
    reason: details.reason ?? null,
    currentTime: audio && Number.isFinite(audio.currentTime) ? Number(audio.currentTime.toFixed(3)) : null,
    readyState: audio?.readyState ?? null,
    networkState: audio?.networkState ?? null,
    paused: audio?.paused ?? null,
    source: audio?.src?.startsWith('blob:') ? 'buffered' : 'streaming',
    userAgent: navigator.userAgent.slice(0, 220),
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/lexara/voice/playback-event',
        new Blob([payload], { type: 'application/json' }),
      );
      return;
    }
  } catch {
    // Best-effort telemetry must never affect playback.
  }

  void fetch('/api/lexara/voice/playback-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export async function getLexaraSharedAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === 'closed') {
    const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
    try {
      audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
    } catch {
      // Older WebKit variants can reject constructor options. Preserve the
      // proven compatibility path rather than making low-latency tuning mandatory.
      audioContext = new AudioContextConstructor();
    }
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext;
}

export async function unlockAudio(): Promise<boolean> {
  if (playbackState.audioUnlocked) return true;

  try {
    await getLexaraSharedAudioContext();

    // Unlock the same media element that will later play LEXARA. Mobile
    // autoplay permission is tied to user activation and cannot be assumed to
    // carry from a disposable silent element to a newly-created Audio object.
    const playbackAudio = getLexaraPlaybackAudioElement();
    playbackAudio.src = SILENT_AUDIO_BASE64;
    playbackAudio.volume = 0.001;
    await playbackAudio.play();
    playbackAudio.pause();
    playbackAudio.currentTime = 0;
    playbackAudio.volume = 1;

    playbackState.audioUnlocked = true;
    return true;
  } catch (error) {
    console.warn('[LexaraServerTTS] Failed to unlock audio:', error);
    return false;
  }
}

export function applyEmotionalModulation(
  personaKernel: { speech: PersonaKernelSpeech },
  userSentiment: UserSentiment,
): PersonaKernelSpeech {
  const speech = { ...personaKernel.speech };

  if (userSentiment.positive) speech.pitch = 'bright';
  if (userSentiment.stress) speech.pitch = 'lower-soft';
  if (userSentiment.confusion) speech.pacing = 'slower';

  return speech;
}

export function analyzeUserSentiment(text: string): UserSentiment {
  const lowercaseText = text.toLowerCase();

  const positiveWords = [
    'great', 'awesome', 'wonderful', 'happy', 'love', 'excellent',
    'thank', 'thanks', 'perfect', 'amazing', 'good', 'nice', 'yes',
  ];
  const positive = positiveWords.some(word => lowercaseText.includes(word));

  const stressWords = [
    'worried', 'scared', 'afraid', 'nervous', 'anxious', 'urgent',
    'emergency', 'help', 'panic', 'desperate', 'stressed', 'overwhelmed',
  ];
  const stress = stressWords.some(word => lowercaseText.includes(word));

  const confusionWords = [
    'confused', "don't understand", 'unclear', 'what do you mean',
    'explain', 'clarify', 'lost', 'huh', 'what', 'how does',
  ];
  const confusion = confusionWords.some(word => lowercaseText.includes(word));

  return { positive, stress, confusion };
}

function revokeCurrentObjectUrl(): void {
  if (!playbackState.currentObjectUrl) return;
  URL.revokeObjectURL(playbackState.currentObjectUrl);
  playbackState.currentObjectUrl = null;
}

function clearCurrentAudioHandlers(): void {
  const audio = playbackState.currentAudio;
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.onplay = null;
  audio.onplaying = null;
  audio.onwaiting = null;
  audio.onstalled = null;
}


function playbackFailure(error: unknown, audio: HTMLAudioElement): Error {
  const message = error instanceof Error ? error.message : 'Audio playback failed';
  const failure = new Error(message) as Error & {
    lexaraPlaybackOffsetMs?: number;
    lexaraPlaybackStarted?: boolean;
  };
  failure.lexaraPlaybackOffsetMs = Number.isFinite(audio.currentTime)
    ? Math.max(0, Math.round(audio.currentTime * 1_000))
    : 0;
  failure.lexaraPlaybackStarted = playbackState.isPlaying;
  return failure;
}

export interface LexaraPlaybackOptions {
  turnId?: string;
}

export const LexaraServerTTS = {
  async play(
    audioOrResponse:
      | Blob
      | VoiceResponse
      | { audio: Blob }
      | { audioBase64: string; mimeType: string }
      | { audioUrl: string },
    options: LexaraPlaybackOptions = {},
  ): Promise<void> {
    // New playback always owns the channel. Resolve any previous play promise so
    // callers do not remain suspended after an intentional interruption.
    this.stop('superseded');

    if (!playbackState.audioUnlocked) {
      const unlocked = await unlockAudio();
      if (!unlocked) {
        throw new Error('LEXARA audio playback requires a user interaction');
      }
    }

    let audioUrl: string;
    let shouldRevokeUrl = false;

    if (audioOrResponse instanceof Blob) {
      audioUrl = URL.createObjectURL(audioOrResponse);
      shouldRevokeUrl = true;
    } else if ('audioBase64' in audioOrResponse && audioOrResponse.audioBase64) {
      const mimeType = audioOrResponse.mimeType || 'audio/mpeg';
      const byteCharacters = atob(audioOrResponse.audioBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
      audioUrl = URL.createObjectURL(blob);
      shouldRevokeUrl = true;
    } else if ('audioUrl' in audioOrResponse && audioOrResponse.audioUrl) {
      audioUrl = audioOrResponse.audioUrl;
    } else if ('audio' in audioOrResponse && audioOrResponse.audio) {
      audioUrl = URL.createObjectURL(audioOrResponse.audio);
      shouldRevokeUrl = true;
    } else {
      return;
    }

    const audio = getLexaraPlaybackAudioElement();
    audio.src = audioUrl;
    audio.volume = 1;
    // Assigning src already starts the media resource selection algorithm.
    // Do not call load() here: on Android it resets the element and can discard
    // already-arriving streamed bytes before playback begins.
    playbackState.currentAudio = audio;
    playbackState.currentTurnId = options.turnId || null;
    playbackState.currentObjectUrl = shouldRevokeUrl ? audioUrl : null;
    playbackState.isPlaying = false;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (outcome: 'resolve' | 'reject', error?: unknown) => {
        if (settled) return;
        settled = true;

        if (playbackState.currentAudio === audio) {
          clearCurrentAudioHandlers();
          playbackState.currentAudio = null;
          playbackState.currentResolve = null;
          playbackState.currentTurnId = null;
          playbackState.isPlaying = false;
          revokeCurrentObjectUrl();
        } else if (shouldRevokeUrl) {
          URL.revokeObjectURL(audioUrl);
        }

        Lexara.notify(Lexara.events.SPEAKING_END);

        if (outcome === 'resolve') {
          resolve();
        } else {
          reject(error instanceof Error ? error : new Error('Audio playback failed'));
        }
      };

      playbackState.currentResolve = () => finish('resolve');

      const playbackStartedAt = performance.now();
      audio.onplay = () => {
        if (playbackState.currentAudio !== audio) return;
        playbackState.isPlaying = true;
        reportLexaraPlaybackEvent('play', audio);
        Lexara.notify(Lexara.events.SPEAKING_START);
      };
      audio.onplaying = () => {
        if (playbackState.currentAudio !== audio) return;
        reportLexaraPlaybackEvent('playing', audio);
        console.debug('[LEXARA Audio] playing', {
          startupMs: Math.round(performance.now() - playbackStartedAt),
        });
      };
      audio.onwaiting = () => {
        if (playbackState.currentAudio !== audio) return;
        reportLexaraPlaybackEvent('waiting', audio);
        console.warn('[LEXARA Audio] waiting for buffered audio');
      };
      audio.onstalled = () => {
        if (playbackState.currentAudio !== audio) return;
        reportLexaraPlaybackEvent('stalled', audio);
        console.warn('[LEXARA Audio] media stream stalled');
      };

      audio.onended = () => {
        reportLexaraPlaybackEvent('ended', audio);
        finish('resolve');
      };
      audio.onerror = error => {
        reportLexaraPlaybackEvent('error', audio);
        finish('reject', playbackFailure(error, audio));
      };

      audio.play().catch(error => finish('reject', playbackFailure(error, audio)));
    });
  },

  pause(): void {
    const audio = playbackState.currentAudio;
    if (!audio || audio.paused) return;
    try {
      audio.pause();
    } catch {
      // Media element may be transitioning during interruption.
    }
  },

  async resume(): Promise<void> {
    const audio = playbackState.currentAudio;
    if (!audio || !audio.paused) return;
    await audio.play();
  },

  stop(reason = 'manual'): void {
    const audio = playbackState.currentAudio;
    const resolveCurrent = playbackState.currentResolve;

    // Clear handlers before pause/reset so browser-specific media events cannot
    // race with the intentional interruption cleanup below.
    clearCurrentAudioHandlers();

    if (audio) {
      try {
        if (!audio.paused) reportLexaraPlaybackEvent('interrupted', audio, { reason });
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // The media element may already be detached or ended.
      }
    }

    playbackState.currentAudio = null;
    playbackState.currentResolve = null;
    playbackState.currentTurnId = null;
    playbackState.isPlaying = false;
    playbackState.queue = [];
    revokeCurrentObjectUrl();

    // Resolve the outstanding play() promise on an intentional stop. This is a
    // normal turn-taking event, not a synthesis failure.
    resolveCurrent?.();
    Lexara.notify(Lexara.events.SPEAKING_END);
  },

  isPlaying(): boolean {
    return playbackState.isPlaying;
  },

  isAudioUnlocked(): boolean {
    return playbackState.audioUnlocked;
  },

  async synthesizeAndPlay(text: string, _emotionalState?: string): Promise<void> {
    try {
      const response = await fetch('/api/lexara/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `TTS request failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      if (audioBlob.size === 0) throw new Error('Received empty audio from server');

      await this.play(audioBlob);
    } catch (error) {
      console.error('[LexaraServerTTS] Synthesis error:', error);
      throw error;
    }
  },

  async synthesize(text: string, emotionalState?: string): Promise<VoiceResponse> {
    try {
      const response = await fetch('/api/lexara/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          emotionalState: emotionalState || 'neutral',
        }),
      });

      if (!response.ok) {
        throw new Error(`Voice synthesis failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[LexaraServerTTS] Synthesis error:', error);
      throw error;
    }
  },

  async speak(text: string, userInput?: string): Promise<void> {
    const sentiment = userInput
      ? analyzeUserSentiment(userInput)
      : { positive: false, stress: false, confusion: false };

    const emotionalState = sentiment.stress
      ? 'empathetic'
      : sentiment.confusion
        ? 'explanatory'
        : sentiment.positive
          ? 'cheerful'
          : 'neutral';

    try {
      await this.synthesizeAndPlay(text, emotionalState);
    } catch (error) {
      console.error('[LexaraServerTTS] Speak error:', error);
      throw error;
    }
  },
};

export const Lexara = {
  notify(event: string, data?: unknown): void {
    console.log(`[Lexara] Event: ${event}`, data || '');

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lexara-event', {
        detail: { event, data, timestamp: Date.now() },
      }));
    }
  },

  events: {
    AVATAR_READY: 'avatar_ready',
    USER_FOCUS: 'user_focus',
    USER_MOVEMENT: 'user_movement',
    SPEAKING_START: 'speaking_start',
    SPEAKING_END: 'speaking_end',
    LISTENING_START: 'listening_start',
    LISTENING_END: 'listening_end',
    AUDIO_UNLOCKED: 'audio_unlocked',
  } as const,
};

export function setupAudioUnlock(): void {
  if (typeof window === 'undefined') return;

  const unlockHandler = async () => {
    if (!playbackState.audioUnlocked) {
      const unlocked = await unlockAudio();
      if (unlocked) {
        Lexara.notify(Lexara.events.AUDIO_UNLOCKED);
        document.removeEventListener('click', unlockHandler);
        document.removeEventListener('touchstart', unlockHandler);
        document.removeEventListener('keydown', unlockHandler);
      }
    }
  };

  document.addEventListener('click', unlockHandler, { once: false });
  document.addEventListener('touchstart', unlockHandler, { once: false });
  document.addEventListener('keydown', unlockHandler, { once: false });
}

export default LexaraServerTTS;
