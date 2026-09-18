/**
 * useVoiceSynthesis Hook
 *
 * ElevenLabs is LEXARA's single acoustic identity. Streaming media playback is
 * preferred; the buffered endpoint remains a route-local recovery path.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';
import type { SpeechContext } from '@shared/lexaraVoicePersona';
import {
  LexaraServerTTS,
  Lexara,
  analyzeUserSentiment,
  applyEmotionalModulation,
  type UserSentiment,
  type PersonaKernelSpeech,
} from '@/lib/lexaraSpeechClient';

export interface VoiceSynthesisOptions {
  context?: SpeechContext;
  autoPlay?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  userInput?: string;
  assistantName?: string;
}

export interface VoiceSynthesisResult {
  speak: (text: string, options?: VoiceSynthesisOptions) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  isLoading: boolean;
  error: Error | null;
  provider: string | null;
}

type PlaybackOutcome = 'ended' | 'interrupted' | 'timeout';

interface ServerAudio {
  blob: Blob;
  voiceId: string | null;
  durationMs: number | null;
}

interface StreamingAudioSession {
  audioUrl: string;
  voiceId: string | null;
}

const FEMALE_VOICE_HINTS = [
  'female', 'woman', 'samantha', 'karen', 'fiona', 'tessa', 'moira',
  'victoria', 'alex', 'allison', 'ava', 'susan', 'zira', 'hazel',
  'jenny', 'aria', 'sara', 'joanna', 'amy', 'emma', 'ivy', 'kendra',
  'kimberly', 'salli', 'nicole', 'veena', 'aditi', 'raveena',
  'google uk english female', 'google us english female',
];

const LEXARA_VOICE_STORAGE_KEY = 'lexara-voice-profile';
const SERVER_TTS_FETCH_TIMEOUT_MS = 20_000;
const MIN_PLAYBACK_WATCHDOG_MS = 10_000;
const MAX_PLAYBACK_WATCHDOG_MS = 240_000;

export function useVoiceSynthesis(): VoiceSynthesisResult {
  const { toast } = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<string | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const emotionalStateRef = useRef<PersonaKernelSpeech | null>(null);
  const interruptionResolverRef = useRef<(() => void) | null>(null);
  const playbackWatchdogRef = useRef<number | null>(null);
  const activeTurnRef = useRef(0);

  const clearPlaybackWatchdog = useCallback(() => {
    if (playbackWatchdogRef.current !== null) {
      window.clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }
  }, []);

  const interruptActiveWait = useCallback(() => {
    const resolve = interruptionResolverRef.current;
    interruptionResolverRef.current = null;
    resolve?.();
  }, []);

  const stop = useCallback(() => {
    activeTurnRef.current += 1;
    clearPlaybackWatchdog();
    interruptActiveWait();
    LexaraServerTTS.stop();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;

    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
    Lexara.notify(Lexara.events.SPEAKING_END);
  }, [clearPlaybackWatchdog, interruptActiveWait]);

  const pause = useCallback(() => {
    if (utteranceRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (utteranceRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const selectFemaleVoice = useCallback((voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    if (!voices.length) return null;

    for (const voice of voices) {
      const name = voice.name.toLowerCase();
      if (FEMALE_VOICE_HINTS.some(hint => name.includes(hint))) {
        return voice;
      }
    }

    return voices.find(voice => voice.lang.toLowerCase().startsWith('en')) || voices[0] || null;
  }, []);

  const waitForVoices = useCallback(async (timeoutMs = 900): Promise<SpeechSynthesisVoice[]> => {
    if (!('speechSynthesis' in window)) return [];

    const existing = window.speechSynthesis.getVoices();
    if (existing.length) return existing;

    return new Promise(resolve => {
      let settled = false;
      let timer: number | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) window.clearTimeout(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged as any);
        resolve(window.speechSynthesis.getVoices());
      };
      const onVoicesChanged = () => {
        if (window.speechSynthesis.getVoices().length) finish();
      };

      timer = window.setTimeout(finish, timeoutMs);
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged as any);
    });
  }, []);

  const getLexaraVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    try {
      const cachedVoiceId = localStorage.getItem(LEXARA_VOICE_STORAGE_KEY);
      if (cachedVoiceId) {
        const cached = voices.find(voice => voice.voiceURI === cachedVoiceId);
        if (cached) return cached;
      }
    } catch {
      // localStorage is optional.
    }

    const selected = selectFemaleVoice(voices);
    if (selected) {
      try {
        localStorage.setItem(LEXARA_VOICE_STORAGE_KEY, selected.voiceURI);
      } catch {
        // localStorage is optional.
      }
    }
    return selected;
  }, [selectFemaleVoice]);

  const getModulatedVoiceSettings = useCallback((userSentiment: UserSentiment) => {
    const personaKernel = {
      speech: {
        timbre: 'female-youth',
        texture: 'breathy-soft with slight sparkle',
        pacing: 'natural human cadence',
        intonation: 'emotional, expressive, non-robotic',
      },
    };

    const modulated = applyEmotionalModulation(personaKernel, userSentiment);
    emotionalStateRef.current = modulated;

    let pitch = 1.2;
    let rate = 0.95;
    if (modulated.pitch === 'bright') pitch = 1.3;
    if (modulated.pitch === 'lower-soft') pitch = 1.1;
    if (modulated.pacing === 'slower') rate = 0.85;
    return { pitch, rate };
  }, []);

  const makeInterruptionPromise = useCallback((): Promise<PlaybackOutcome> => {
    return new Promise(resolve => {
      interruptionResolverRef.current = () => resolve('interrupted');
    });
  }, []);

  const makePlaybackWatchdog = useCallback((timeoutMs: number): Promise<PlaybackOutcome> => {
    clearPlaybackWatchdog();
    const boundedTimeout = Math.max(
      MIN_PLAYBACK_WATCHDOG_MS,
      Math.min(MAX_PLAYBACK_WATCHDOG_MS, timeoutMs),
    );

    return new Promise(resolve => {
      playbackWatchdogRef.current = window.setTimeout(() => {
        playbackWatchdogRef.current = null;
        resolve('timeout');
      }, boundedTimeout);
    });
  }, [clearPlaybackWatchdog]);

  const createStreamingAudioSession = useCallback(async (text: string): Promise<StreamingAudioSession> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch('/api/lexara/tts/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.audioUrl !== 'string') {
        throw new Error(payload?.error || 'LEXARA streaming voice session could not start');
      }
      return {
        audioUrl: payload.audioUrl,
        voiceId: typeof payload?.voiceId === 'string' ? payload.voiceId : null,
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const fetchServerAudio = useCallback(async (text: string): Promise<ServerAudio> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SERVER_TTS_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch('/api/lexara/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server speech synthesis failed: ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type');
      if (!contentType?.includes('audio/')) {
        throw new Error('Server did not return audio data');
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error('Received empty audio from server');

      const parsedDuration = Number(response.headers.get('X-Audio-Duration'));
      return {
        blob,
        voiceId: response.headers.get('X-Voice-Id'),
        durationMs: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Server speech synthesis timed out');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const speakWithServer = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions,
    turnId: number,
  ): Promise<void> => {
    let playback: Promise<PlaybackOutcome>;
    let expectedDuration = Math.max(5_000, text.length * 70);

    try {
      const session = await createStreamingAudioSession(text);
      if (turnId !== activeTurnRef.current) return;
      playback = LexaraServerTTS.play({ audioUrl: session.audioUrl }).then<PlaybackOutcome>(() => 'ended');
    } catch {
      // Route-local recovery: retain the proven buffered endpoint if streaming
      // session creation is unavailable, without switching acoustic identity.
      const audio = await fetchServerAudio(text);
      if (turnId !== activeTurnRef.current) return;
      expectedDuration = audio.durationMs || expectedDuration;
      playback = LexaraServerTTS.play(audio.blob).then<PlaybackOutcome>(() => 'ended');
    }

    setProvider('elevenlabs');
    setIsLoading(false);
    setIsSpeaking(true);
    options.onStart?.();
    const outcome = await Promise.race([
      playback,
      makeInterruptionPromise(),
      makePlaybackWatchdog(expectedDuration + 8_000),
    ]);

    clearPlaybackWatchdog();
    interruptionResolverRef.current = null;

    if (turnId !== activeTurnRef.current || outcome === 'interrupted') return;
    if (outcome === 'timeout') {
      LexaraServerTTS.stop();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(false);
    options.onEnd?.();
  }, [clearPlaybackWatchdog, createStreamingAudioSession, fetchServerAudio, makeInterruptionPromise, makePlaybackWatchdog]);

  const speakWithBrowser = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions,
    turnId: number,
  ): Promise<void> => {
    if (!('speechSynthesis' in window)) {
      throw new Error('Browser speech synthesis is not supported');
    }

    window.speechSynthesis.cancel();
    await waitForVoices();
    if (turnId !== activeTurnRef.current) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;

    const voice = getLexaraVoice();
    if (voice) utterance.voice = voice;

    const sentiment = options.userInput
      ? analyzeUserSentiment(options.userInput)
      : { positive: false, stress: false, confusion: false };
    const { pitch, rate } = getModulatedVoiceSettings(sentiment);
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = 1;

    const playback = new Promise<PlaybackOutcome>((resolve, reject) => {
      utterance.onstart = () => {
        if (turnId !== activeTurnRef.current) return;
        setProvider('browser-lexara');
        setIsLoading(false);
        setIsSpeaking(true);
        Lexara.notify(Lexara.events.SPEAKING_START);
        options.onStart?.();
      };

      utterance.onend = () => {
        utteranceRef.current = null;
        resolve('ended');
      };

      utterance.onerror = event => {
        utteranceRef.current = null;
        if (event.error === 'canceled' || event.error === 'interrupted') {
          resolve('interrupted');
          return;
        }
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };

      window.speechSynthesis.speak(utterance);
    });

    const estimatedDuration = Math.max(8_000, text.length * 85);
    const outcome = await Promise.race([
      playback,
      makeInterruptionPromise(),
      makePlaybackWatchdog(estimatedDuration + 12_000),
    ]);

    clearPlaybackWatchdog();
    interruptionResolverRef.current = null;

    if (turnId !== activeTurnRef.current || outcome === 'interrupted') return;
    if (outcome === 'timeout') {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(false);
    Lexara.notify(Lexara.events.SPEAKING_END);
    options.onEnd?.();
  }, [clearPlaybackWatchdog, getLexaraVoice, getModulatedVoiceSettings, makeInterruptionPromise, makePlaybackWatchdog, waitForVoices]);

  const speak = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions = {},
  ) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    stop();
    const turnId = activeTurnRef.current;
    setIsLoading(true);
    setError(null);

    try {
      // One persona means one acoustic identity. LEXARA never silently changes
      // to a browser/system voice if ElevenLabs is slow or temporarily down.
      await speakWithServer(cleanText, options, turnId);
    } catch (err) {
      clearPlaybackWatchdog();
      interruptionResolverRef.current = null;
      if (turnId !== activeTurnRef.current) return;

      const nextError = err instanceof Error ? err : new Error('LEXARA voice synthesis failed');
      setError(nextError);
      setProvider('elevenlabs-unavailable');
      setIsLoading(false);
      setIsSpeaking(false);
      options.onError?.(nextError);

      toast({
        title: `${options.assistantName || 'LEXARA'} Voice Temporarily Unavailable`,
        description: 'The consultation will continue in text without switching to a different voice.',
        variant: 'destructive',
      });
    }
  }, [clearPlaybackWatchdog, speakWithServer, stop, toast]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    isPaused,
    isLoading,
    error,
    provider,
  };
}
