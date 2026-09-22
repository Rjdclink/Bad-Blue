/**
 * useVoiceSynthesis Hook
 *
 * LEXARA uses one acoustic persona across an adaptive server-side TTS mesh.
 * Streaming media playback is preferred; buffered playback is the recovery path.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';
import type { SpeechContext } from '@shared/lexaraVoicePersona';
import {
  LexaraServerTTS,
  Lexara,
} from '@/lib/lexaraSpeechClient';
import { lexaraRealtimeVoiceClient } from '@/lib/lexaraRealtimeVoiceClient';

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

type PlaybackOutcome = 'ended' | 'interrupted' | 'timeout' | 'failed';

interface ServerAudio {
  blob: Blob;
  voiceId: string | null;
  durationMs: number | null;
  provider: string | null;
}

interface StreamingAudioSession {
  audioUrl: string;
  voiceId: string | null;
  provider: string | null;
}

const SERVER_TTS_FETCH_TIMEOUT_MS = 20_000;
const MIN_PLAYBACK_WATCHDOG_MS = 10_000;
const MAX_PLAYBACK_WATCHDOG_MS = 600_000;

function remainingSpeechText(text: string, playbackOffsetMs: number, expectedDurationMs: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (playbackOffsetMs <= 0 || !clean) return clean;

  // The media element reports time, not word timings. A proportional word boundary
  // is therefore the safest CPU-only recovery point: it avoids replaying the
  // already spoken portion without introducing a second live synthesis channel.
  const words = clean.split(' ').filter(Boolean);
  if (words.length < 2) return '';
  const progress = Math.max(0, Math.min(0.999, playbackOffsetMs / Math.max(1, expectedDurationMs)));
  const consumedWords = Math.min(words.length - 1, Math.max(1, Math.floor(words.length * progress)));
  return words.slice(consumedWords).join(' ');
}

function playbackOffsetFromError(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const offset = Number((error as { lexaraPlaybackOffsetMs?: unknown }).lexaraPlaybackOffsetMs);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

export function useVoiceSynthesis(): VoiceSynthesisResult {
  const { toast, dismiss } = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<string | null>(null);


  const interruptionResolverRef = useRef<(() => void) | null>(null);
  const playbackWatchdogRef = useRef<number | null>(null);
  const voiceFailureToastIdRef = useRef<string | null>(null);
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

  const stop = useCallback((reason = 'manual') => {
    activeTurnRef.current += 1;
    clearPlaybackWatchdog();
    interruptActiveWait();
    lexaraRealtimeVoiceClient.interrupt();
    LexaraServerTTS.stop(reason);

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

  const createStreamingAudioSession = useCallback(async (text: string, turnId: string): Promise<StreamingAudioSession> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);

    try {
      const response = await fetch('/api/lexara/tts/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, turnId }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.audioUrl !== 'string') {
        throw new Error(payload?.error || 'LEXARA streaming voice session could not start');
      }
      return {
        audioUrl: payload.audioUrl,
        voiceId: typeof payload?.voiceId === 'string' ? payload.voiceId : null,
        provider: typeof payload?.provider === 'string' ? payload.provider : 'adaptive-tts-mesh',
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
        provider: response.headers.get('X-Provider'),
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
    // One reply owns one progressive media stream. Do not split a response into
    // separately downloaded blobs: that was the source of the audible gaps.
    const stableTurnId = `lexara-turn-${turnId}`;
    const interruption = makeInterruptionPromise();
    let selectedProvider: string | null = null;
    let expectedDuration = Math.max(10_000, text.length * 70);
    let playbackStarted = false;

    const markPlaybackStarted = () => {
      if (playbackStarted) return;
      playbackStarted = true;
      if (voiceFailureToastIdRef.current) {
        dismiss(voiceFailureToastIdRef.current);
        voiceFailureToastIdRef.current = null;
      }
      setProvider(selectedProvider || 'adaptive-tts-mesh');
      setIsLoading(false);
      setIsSpeaking(true);
      options.onStart?.();
    };

    const waitForPlayback = async (
      playback: Promise<void>,
      captureFailure: (error: unknown) => void,
      durationMs: number,
    ): Promise<PlaybackOutcome> => {
      const outcome = await Promise.race([
        playback.then<PlaybackOutcome>(() => 'ended').catch<PlaybackOutcome>(error => {
          captureFailure(error);
          return 'failed';
        }),
        interruption,
        makePlaybackWatchdog(durationMs + 8_000),
      ]);
      clearPlaybackWatchdog();
      return outcome;
    };

    const playBufferedRecovery = async (recoveryText: string): Promise<PlaybackOutcome> => {
      const recovery = await fetchServerAudio(recoveryText);
      if (turnId !== activeTurnRef.current) return 'interrupted';
      selectedProvider = recovery.provider || selectedProvider;
      expectedDuration = recovery.durationMs || Math.max(10_000, recoveryText.length * 70);

      let recoveryFailure: unknown = null;
      return waitForPlayback(
        LexaraServerTTS.play(recovery.blob, {
          turnId: stableTurnId,
          onStart: markPlaybackStarted,
        }),
        error => { recoveryFailure = error; },
        expectedDuration,
      ).then(outcome => {
        // Keep the captured failure in scope for debugger inspection without
        // changing the public PlaybackOutcome contract.
        void recoveryFailure;
        return outcome;
      });
    };

    try {
      let session: StreamingAudioSession;
      try {
        const sessionStartedAt = performance.now();
        session = await createStreamingAudioSession(text, stableTurnId);
        if (turnId !== activeTurnRef.current) return;

        selectedProvider = session.provider;
        void fetch('/api/lexara/voice/playback-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'tts-session-ready',
            source: 'streaming',
            provider: session.provider,
            turnId: stableTurnId,
            startupMs: Math.round(performance.now() - sessionStartedAt),
          }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // A readiness/session POST failure occurs before any media reaches the
        // user. Preserve the established buffered mesh as the immediate fallback.
        const outcome = await playBufferedRecovery(text);
        if (turnId !== activeTurnRef.current || outcome === 'interrupted') {
          LexaraServerTTS.stop('interrupted');
          return;
        }
        if (outcome === 'failed' || outcome === 'timeout') {
          LexaraServerTTS.stop(outcome === 'timeout' ? 'timeout' : 'failed');
          throw new Error('LEXARA voice playback failed after route-local recovery');
        }
        interruptionResolverRef.current = null;
        setIsSpeaking(false);
        options.onEnd?.();
        return;
      }

      let streamFailure: unknown = null;
      let outcome = await waitForPlayback(
        LexaraServerTTS.play(
          { audioUrl: session.audioUrl },
          {
            turnId: stableTurnId,
            onStart: markPlaybackStarted,
          },
        ),
        error => { streamFailure = error; },
        expectedDuration,
      );

      if (turnId !== activeTurnRef.current || outcome === 'interrupted') {
        LexaraServerTTS.stop('interrupted');
        return;
      }

      if (outcome === 'failed') {
        // A late transport error must never replay the answer from the beginning.
        // The media element supplies the spoken offset; recover only the estimated
        // unspoken word boundary through the existing buffered route.
        const playbackOffsetMs = playbackOffsetFromError(streamFailure);
        const recoveryText = remainingSpeechText(text, playbackOffsetMs, expectedDuration);
        if (!recoveryText) {
          interruptionResolverRef.current = null;
          setIsSpeaking(false);
          options.onEnd?.();
          return;
        }

        LexaraServerTTS.stop('recovery');
        outcome = await playBufferedRecovery(recoveryText);
      }

      if (turnId !== activeTurnRef.current || outcome === 'interrupted') {
        LexaraServerTTS.stop('interrupted');
        return;
      }
      if (outcome === 'failed' || outcome === 'timeout') {
        LexaraServerTTS.stop(outcome === 'timeout' ? 'timeout' : 'failed');
        throw new Error('LEXARA voice playback failed after route-local recovery');
      }

      interruptionResolverRef.current = null;
      setIsSpeaking(false);
      options.onEnd?.();
    } catch (error) {
      clearPlaybackWatchdog();
      throw error;
    }
  }, [
    clearPlaybackWatchdog,
    createStreamingAudioSession,
    dismiss,
    fetchServerAudio,
    makeInterruptionPromise,
    makePlaybackWatchdog,
  ]);

  const speak = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions = {},
  ) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    stop('superseded');
    const turnId = activeTurnRef.current;
    setIsLoading(true);
    setError(null);

    try {
      let realtimeStarted = false;
      const realtimeOutputReady = lexaraRealtimeVoiceClient.isReady()
        ? await lexaraRealtimeVoiceClient.ensureSpeechOutputReady()
        : false;
      if (turnId !== activeTurnRef.current) return;
      if (realtimeOutputReady) {
        try {
          setProvider('deepgram-flux');
          await lexaraRealtimeVoiceClient.speak(
            cleanText,
            `lexara-turn-${turnId}`,
            {
              onStart: () => {
                realtimeStarted = true;
                setIsLoading(false);
                setIsSpeaking(true);
                options.onStart?.();
              },
            },
          );
          if (turnId !== activeTurnRef.current) return;
          setIsSpeaking(false);
          setIsLoading(false);
          options.onEnd?.();
          return;
        } catch {
          // Persistent realtime speech is the latency-first route, not a new
          // mandatory dependency. A socket/provider failure stays local and the
          // already-proven adaptive HTTP mesh immediately recovers the turn.
          lexaraRealtimeVoiceClient.interrupt();
          if (turnId !== activeTurnRef.current) return;
        }
      }

      const fallbackOptions = realtimeStarted
        ? { ...options, onStart: undefined }
        : options;
      // One persona, multiple provider routes. The server mesh keeps failures
      // route-local and only surfaces an error after compatible TTS routes fail.
      await speakWithServer(cleanText, fallbackOptions, turnId);
    } catch (err) {
      clearPlaybackWatchdog();
      interruptionResolverRef.current = null;
      if (turnId !== activeTurnRef.current) return;

      const nextError = err instanceof Error ? err : new Error('LEXARA voice synthesis failed');
      setError(nextError);
      setProvider('tts-mesh-unavailable');
      setIsLoading(false);
      setIsSpeaking(false);
      options.onError?.(nextError);

      const failureToast = toast({
        title: `${options.assistantName || 'LEXARA'} Voice Temporarily Unavailable`,
        description: 'All verified voice routes failed. LEXARA will keep retrying while the consultation continues in text.',
        variant: 'destructive',
      });
      voiceFailureToastIdRef.current = failureToast.id;
      window.setTimeout(() => {
        if (voiceFailureToastIdRef.current === failureToast.id) {
          dismiss(failureToast.id);
          voiceFailureToastIdRef.current = null;
        }
      }, 6_000);
    }
  }, [clearPlaybackWatchdog, dismiss, speakWithServer, stop, toast]);

  useEffect(() => {
    return () => {
      stop('unmount');
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
