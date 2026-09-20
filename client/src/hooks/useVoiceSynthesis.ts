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
const NEXT_CHUNK_PREFETCH_TIMEOUT_MS = 20_000;
const MIN_PLAYBACK_WATCHDOG_MS = 10_000;
const FIRST_SPEECH_CHUNK_MAX_CHARS = 72;
const SPEECH_CHUNK_MAX_CHARS = 300;
const MAX_PLAYBACK_WATCHDOG_MS = 240_000;

function requiresMediaElementSpeechOutput(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Production telemetry on Android Chrome proved the progressive HTMLMediaElement
  // route reaches playing/ended while the AudioWorklet realtime route can render
  // PCM frames without producing audible speaker output. Keep realtime connected
  // for low-latency STT/barge-in, but use the proven media output sink on Android.
  return /Android/i.test(navigator.userAgent);
}

function splitOversizedSpeechUnit(value: string, maxChars: number): string[] {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const clauses = clean
    .split(/(?<=[,;:])\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let current = '';

  const pushWords = (chunk: string) => {
    const words = chunk.split(/\s+/).filter(Boolean);
    let wordBuffer = '';
    for (const word of words) {
      const candidate = wordBuffer ? `${wordBuffer} ${word}` : word;
      if (candidate.length > maxChars && wordBuffer) {
        parts.push(wordBuffer);
        wordBuffer = word;
      } else {
        wordBuffer = candidate;
      }
    }
    if (wordBuffer) parts.push(wordBuffer);
  };

  for (const clause of clauses.length ? clauses : [clean]) {
    const candidate = current ? `${current} ${clause}` : clause;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      parts.push(current);
      current = '';
    }
    if (clause.length <= maxChars) {
      current = clause;
    } else {
      pushWords(clause);
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitLexaraSpeechChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(part => part.trim()).filter(Boolean) || [clean];
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  for (const sentence of sentences) {
    const maxChars = chunks.length === 0 ? FIRST_SPEECH_CHUNK_MAX_CHARS : SPEECH_CHUNK_MAX_CHARS;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    flush();
    const unitLimit = chunks.length === 0 ? FIRST_SPEECH_CHUNK_MAX_CHARS : SPEECH_CHUNK_MAX_CHARS;
    const pieces = splitOversizedSpeechUnit(sentence, unitLimit);
    for (const piece of pieces) {
      if (piece.length >= unitLimit) {
        chunks.push(piece);
      } else if (!current) {
        current = piece;
      } else {
        const combined = `${current} ${piece}`;
        if (combined.length <= SPEECH_CHUNK_MAX_CHARS) current = combined;
        else {
          flush();
          current = piece;
        }
      }
      if (chunks.length === 0 && current.length >= FIRST_SPEECH_CHUNK_MAX_CHARS * 0.72) flush();
    }
  }

  flush();
  return chunks.length ? chunks : [clean];
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

  const stop = useCallback(() => {
    activeTurnRef.current += 1;
    clearPlaybackWatchdog();
    interruptActiveWait();
    lexaraRealtimeVoiceClient.interrupt();
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
    const timeout = window.setTimeout(() => controller.abort(), 4_000);

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
        provider: typeof payload?.provider === 'string' ? payload.provider : 'adaptive-tts-mesh',
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const fetchPreparedSessionAudio = useCallback(async (audioUrl: string): Promise<ServerAudio> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), NEXT_CHUNK_PREFETCH_TIMEOUT_MS);
    try {
      const response = await fetch(audioUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`LEXARA prepared playback failed (${response.status})`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('LEXARA prepared playback returned empty audio');
      const parsedDuration = Number(response.headers.get('X-Audio-Duration'));
      return {
        blob,
        voiceId: response.headers.get('X-Voice-Id'),
        durationMs: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
        provider: response.headers.get('X-Provider'),
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
    const chunks = splitLexaraSpeechChunks(text);
    if (!chunks.length) return;

    let selectedProvider: string | null = null;
    let startedPlayback = false;
    let preparedCurrent: Promise<ServerAudio | null> | null = null;
    const interruption = makeInterruptionPromise();

    const prepareChunk = async (chunk: string): Promise<ServerAudio | null> => {
      try {
        const session = await createStreamingAudioSession(chunk);
        if (turnId !== activeTurnRef.current) return null;
        const audio = await fetchPreparedSessionAudio(session.audioUrl);
        return {
          ...audio,
          provider: audio.provider || session.provider,
          voiceId: audio.voiceId || session.voiceId,
        };
      } catch {
        return null;
      }
    };

    for (let index = 0; index < chunks.length; index += 1) {
      if (turnId !== activeTurnRef.current) return;

      const chunk = chunks[index];
      let playback: Promise<PlaybackOutcome>;
      let expectedDuration = Math.max(4_000, chunk.length * 70);

      try {
        if (index === 0) {
          // Never hold the first spoken sentence behind a full-answer mobile
          // buffer. A short first chunk begins server synthesis immediately and
          // is handed directly to the already-unlocked persistent media element.
          const sessionStartedAt = performance.now();
          const session = await createStreamingAudioSession(chunk);
          if (turnId !== activeTurnRef.current) return;
          selectedProvider = session.provider;
          void fetch('/api/lexara/voice/playback-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'tts-session-ready',
              source: 'streaming',
              provider: session.provider,
              turnId,
              startupMs: Math.round(performance.now() - sessionStartedAt),
            }),
            keepalive: true,
          }).catch(() => undefined);
          playback = LexaraServerTTS.play({ audioUrl: session.audioUrl })
            .then<PlaybackOutcome>(() => 'ended')
            .catch<PlaybackOutcome>(() => 'failed');
        } else {
          const prepared = preparedCurrent ? await preparedCurrent : await prepareChunk(chunk);
          preparedCurrent = null;
          if (turnId !== activeTurnRef.current) return;

          if (prepared?.blob?.size) {
            selectedProvider = prepared.provider || selectedProvider;
            expectedDuration = prepared.durationMs || expectedDuration;
            playback = LexaraServerTTS.play(prepared.blob).then<PlaybackOutcome>(() => 'ended').catch<PlaybackOutcome>(() => 'failed');
          } else {
            const audio = await fetchServerAudio(chunk);
            if (turnId !== activeTurnRef.current) return;
            selectedProvider = audio.provider || selectedProvider;
            expectedDuration = audio.durationMs || expectedDuration;
            playback = LexaraServerTTS.play(audio.blob).then<PlaybackOutcome>(() => 'ended').catch<PlaybackOutcome>(() => 'failed');
          }
        }
      } catch {
        // Chunk-local recovery keeps the current conversational turn alive.
        const audio = await fetchServerAudio(chunk);
        if (turnId !== activeTurnRef.current) return;
        selectedProvider = audio.provider || selectedProvider;
        expectedDuration = audio.durationMs || expectedDuration;
        playback = LexaraServerTTS.play(audio.blob).then<PlaybackOutcome>(() => 'ended').catch<PlaybackOutcome>(() => 'failed');
      }

      if (!startedPlayback) {
        startedPlayback = true;
        if (voiceFailureToastIdRef.current) {
          dismiss(voiceFailureToastIdRef.current);
          voiceFailureToastIdRef.current = null;
        }
        setProvider(selectedProvider || 'adaptive-tts-mesh');
        setIsLoading(false);
        setIsSpeaking(true);
        options.onStart?.();
      }

      // Prepare exactly one chunk ahead while the current chunk is playing.
      // This hides provider synthesis latency without creating an unbounded
      // fan-out or making interruption wait for future audio.
      if (index + 1 < chunks.length && !preparedCurrent) {
        preparedCurrent = prepareChunk(chunks[index + 1]);
      }

      const outcome = await Promise.race([
        playback,
        interruption,
        makePlaybackWatchdog(expectedDuration + 8_000),
      ]);

      clearPlaybackWatchdog();

      if (turnId !== activeTurnRef.current || outcome === 'interrupted') {
        LexaraServerTTS.stop();
        return;
      }

      if (outcome === 'failed') {
        // A progressive media stream can still fail after HTTP headers have
        // already reached the browser. Recover the chunk through the canonical
        // buffered mesh before declaring voice unavailable.
        LexaraServerTTS.stop();
        const recovery = await fetchServerAudio(chunk);
        if (turnId !== activeTurnRef.current) return;
        selectedProvider = recovery.provider || selectedProvider;
        expectedDuration = recovery.durationMs || expectedDuration;
        const recoveryOutcome = await Promise.race([
          LexaraServerTTS.play(recovery.blob)
            .then<PlaybackOutcome>(() => 'ended')
            .catch<PlaybackOutcome>(() => 'failed'),
          interruption,
          makePlaybackWatchdog(expectedDuration + 8_000),
        ]);
        clearPlaybackWatchdog();

        if (turnId !== activeTurnRef.current || recoveryOutcome === 'interrupted') {
          LexaraServerTTS.stop();
          return;
        }
        if (recoveryOutcome === 'failed' || recoveryOutcome === 'timeout') {
          LexaraServerTTS.stop();
          throw new Error('LEXARA voice playback failed after route-local recovery');
        }
      }

      if (outcome === 'timeout') {
        LexaraServerTTS.stop();
        throw new Error('LEXARA voice playback timed out');
      }
    }

    interruptionResolverRef.current = null;
    setIsSpeaking(false);
    options.onEnd?.();
  }, [
    clearPlaybackWatchdog,
    createStreamingAudioSession,
    dismiss,
    fetchPreparedSessionAudio,
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

    stop();
    const turnId = activeTurnRef.current;
    setIsLoading(true);
    setError(null);

    try {
      let realtimeStarted = false;
      if (lexaraRealtimeVoiceClient.isReady() && !requiresMediaElementSpeechOutput()) {
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
