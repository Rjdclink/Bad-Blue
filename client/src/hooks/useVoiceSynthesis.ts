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

const SERVER_TTS_FETCH_TIMEOUT_MS = 20_000;
const MOBILE_SESSION_BUFFER_TIMEOUT_MS = 12_000;
const MIN_PLAYBACK_WATCHDOG_MS = 10_000;

function shouldBufferLexaraPlaybackOnThisDevice(textLength: number): boolean {
  return typeof navigator !== 'undefined'
    && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    && textLength > 420;
}
const MAX_PLAYBACK_WATCHDOG_MS = 240_000;

export function useVoiceSynthesis(): VoiceSynthesisResult {
  const { toast } = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<string | null>(null);


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

    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
    Lexara.notify(Lexara.events.SPEAKING_END);
  }, [clearPlaybackWatchdog, interruptActiveWait]);

  const pause = useCallback(() => {
    LexaraServerTTS.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    void LexaraServerTTS.resume()
      .then(() => setIsPaused(false))
      .catch(() => setIsPaused(false));
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

  const bufferStreamingSessionForMobile = useCallback(async (audioUrl: string): Promise<Blob> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MOBILE_SESSION_BUFFER_TIMEOUT_MS);
    try {
      const response = await fetch(audioUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`LEXARA buffered playback failed (${response.status})`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('LEXARA buffered playback returned empty audio');
      return blob;
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

      if (shouldBufferLexaraPlaybackOnThisDevice(text.length)) {
        // The observed production stream finishes in well under a second, so on
        // mobile it is better to absorb that tiny delay once and play from a
        // complete local Blob than risk repeated media-buffer starvation while
        // microphone capture and echo cancellation are active.
        const blob = await bufferStreamingSessionForMobile(session.audioUrl);
        if (turnId !== activeTurnRef.current) return;
        playback = LexaraServerTTS.play(blob).then<PlaybackOutcome>(() => 'ended');
      } else {
        playback = LexaraServerTTS.play({ audioUrl: session.audioUrl }).then<PlaybackOutcome>(() => 'ended');
      }
    } catch {
      // Route-local recovery: retain the proven buffered endpoint if streaming
      // session creation/buffering is unavailable, without switching acoustic identity.
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
  }, [bufferStreamingSessionForMobile, clearPlaybackWatchdog, createStreamingAudioSession, fetchServerAudio, makeInterruptionPromise, makePlaybackWatchdog]);

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
