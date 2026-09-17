/**
 * useVoiceSynthesis Hook
 *
 * Server TTS is preferred, with a zero-cost browser voice fallback. The promise
 * returned by speak() now represents the actual audible turn: it resolves when
 * playback ends or is intentionally interrupted, not merely when synthesis
 * finishes downloading.
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

type PlaybackOutcome = 'ended' | 'interrupted';

const FEMALE_VOICE_HINTS = [
  'female', 'woman', 'samantha', 'karen', 'fiona', 'tessa', 'moira',
  'victoria', 'alex', 'allison', 'ava', 'susan', 'zira', 'hazel',
  'jenny', 'aria', 'sara', 'joanna', 'amy', 'emma', 'ivy', 'kendra',
  'kimberly', 'salli', 'nicole', 'veena', 'aditi', 'raveena',
  'google uk english female', 'google us english female',
];

const LEXARA_VOICE_STORAGE_KEY = 'lexara-voice-profile';

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
  const activeTurnRef = useRef(0);

  const interruptActiveWait = useCallback(() => {
    const resolve = interruptionResolverRef.current;
    interruptionResolverRef.current = null;
    resolve?.();
  }, []);

  const stop = useCallback(() => {
    activeTurnRef.current += 1;
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
  }, [interruptActiveWait]);

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
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged as any);
        resolve(window.speechSynthesis.getVoices());
      };
      const onVoicesChanged = () => {
        if (window.speechSynthesis.getVoices().length) finish();
      };
      const timer = window.setTimeout(finish, timeoutMs);
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

  const fetchServerAudio = useCallback(async (text: string): Promise<{ blob: Blob; voiceId: string | null }> => {
    const response = await fetch('/api/lexara/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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

    return {
      blob,
      voiceId: response.headers.get('X-Voice-Id'),
    };
  }, []);

  const speakWithServer = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions,
    turnId: number,
  ): Promise<void> => {
    const audio = await fetchServerAudio(text);
    if (turnId !== activeTurnRef.current) return;

    setProvider('elevenlabs');
    setIsLoading(false);
    setIsSpeaking(true);
    options.onStart?.();

    const playback = LexaraServerTTS.play(audio.blob).then<PlaybackOutcome>(() => 'ended');
    const outcome = await Promise.race([playback, makeInterruptionPromise()]);
    interruptionResolverRef.current = null;

    if (turnId !== activeTurnRef.current || outcome === 'interrupted') return;

    setIsSpeaking(false);
    options.onEnd?.();
  }, [fetchServerAudio, makeInterruptionPromise]);

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

    const outcome = await Promise.race([playback, makeInterruptionPromise()]);
    interruptionResolverRef.current = null;

    if (turnId !== activeTurnRef.current || outcome === 'interrupted') return;

    setIsSpeaking(false);
    Lexara.notify(Lexara.events.SPEAKING_END);
    options.onEnd?.();
  }, [getLexaraVoice, getModulatedVoiceSettings, makeInterruptionPromise, waitForVoices]);

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
      try {
        await speakWithServer(cleanText, options, turnId);
        return;
      } catch (serverError) {
        if (turnId !== activeTurnRef.current) return;

        const message = serverError instanceof Error ? serverError.message.toLowerCase() : String(serverError).toLowerCase();
        const autoplayBlocked =
          message.includes('notallowed') ||
          message.includes('play()') ||
          message.includes('user gesture') ||
          message.includes('suspended');

        setIsSpeaking(false);
        if (autoplayBlocked) {
          setProvider('audio-blocked');
          setIsLoading(false);
          return;
        }

        await speakWithBrowser(cleanText, options, turnId);
      }
    } catch (err) {
      if (turnId !== activeTurnRef.current) return;

      const nextError = err instanceof Error ? err : new Error('Speech synthesis failed');
      setError(nextError);
      setIsLoading(false);
      setIsSpeaking(false);
      options.onError?.(nextError);

      toast({
        title: 'Voice Synthesis Error',
        description: nextError.message || 'Unable to play audio.',
        variant: 'destructive',
      });
    }
  }, [speakWithBrowser, speakWithServer, stop, toast]);

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
