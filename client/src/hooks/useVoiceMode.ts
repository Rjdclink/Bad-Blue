/**
 * useVoiceMode Hook
 *
 * Cross-device voice input for LEXARA. Native browser SpeechRecognition is
 * used when it is reliable; a MediaRecorder + server Whisper path is the
 * compatibility fallback for browsers/devices that do not expose it.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';
import { getLexaraSharedAudioContext } from '@/lib/lexaraSpeechClient';

export interface VoiceTranscriptMeta {
  engine: LexaraVoiceEngine;
  provider?: string;
  confidence?: number;
  speechDurationMs?: number;
}

export interface VoiceModeOptions {
  onTranscript?: (text: string, isFinal: boolean, meta: VoiceTranscriptMeta) => void;
  onError?: (error: Error) => void;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
  continuous?: boolean;
  interimResults?: boolean;
}

export type LexaraVoiceEngine = 'browser' | 'server';

export interface VoiceModeResult {
  isEnabled: boolean;
  isListening: boolean;
  isSuspended: boolean;
  transcript: string;
  interimTranscript: string;
  enableVoice: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => void;
  startListening: () => void;
  stopListening: () => void;
  suspendListening: () => void;
  resumeListening: () => void;
  error: Error | null;
  hasPermission: boolean | null;
  engine: LexaraVoiceEngine | null;
}

const BASE_RESTART_DELAY_MS = 120;
const MAX_NETWORK_RESTART_DELAY_MS = 5_000;
const SERVER_VAD_MIN_THRESHOLD = 0.014;
const SERVER_VAD_MAX_THRESHOLD = 0.075;
const SERVER_VAD_NOISE_MULTIPLIER = 2.8;
const SERVER_VAD_SILENCE_MS = 900;
const SERVER_MIN_SPEECH_MS = 220;
const SERVER_VOICE_CONFIRM_MS = 140;
const SERVER_VOICE_RECENCY_MS = 90;
const SERVER_MAX_UTTERANCE_MS = 45_000;
const SERVER_TRANSCRIBE_TIMEOUT_MS = 18_000;

function preferredMicrophoneConstraints(): MediaTrackConstraints {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const constraints: MediaTrackConstraints = {};

  if (supported.echoCancellation) constraints.echoCancellation = true;
  if (supported.noiseSuppression) constraints.noiseSuppression = true;
  if (supported.autoGainControl) constraints.autoGainControl = true;
  if (supported.channelCount) constraints.channelCount = { ideal: 1 };

  return constraints;
}

function preferredRecordingMimeType(): string | undefined {
  if (!('MediaRecorder' in window)) return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type));
}

export function useVoiceMode(options: VoiceModeOptions = {}): VoiceModeResult {
  const { toast } = useToast();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<LexaraVoiceEngine | null>(null);

  const recognitionRef = useRef<any>(null);
  const optionsRef = useRef<VoiceModeOptions>(options);
  const enabledRef = useRef(false);
  const desiredListeningRef = useRef(false);
  const suspendedRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const restartDelayRef = useRef(BASE_RESTART_DELAY_MS);
  const networkFailureCountRef = useRef(0);
  const engineRef = useRef<LexaraVoiceEngine | null>(null);

  const serverStreamRef = useRef<MediaStream | null>(null);
  const serverAudioContextRef = useRef<AudioContext | null>(null);
  const serverAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const serverAnalyserRef = useRef<AnalyserNode | null>(null);
  const serverVadFrameRef = useRef<number | null>(null);
  const serverRecorderRef = useRef<MediaRecorder | null>(null);
  const serverRecorderChunksRef = useRef<Blob[]>([]);
  const serverSpeechStartedAtRef = useRef<number | null>(null);
  const serverSilenceStartedAtRef = useRef<number | null>(null);
  const serverSpeechActiveRef = useRef(false);
  const serverVoiceStartNotifiedRef = useRef(false);
  const serverLastSpeechDurationMsRef = useRef(0);
  const serverNoiseFloorRef = useRef(0.006);
  const serverLastAboveThresholdAtRef = useRef(0);
  const discardServerRecordingRef = useRef(false);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const serverTranscriptionQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const resetTransientRecovery = useCallback(() => {
    restartDelayRef.current = BASE_RESTART_DELAY_MS;
    networkFailureCountRef.current = 0;
  }, []);

  const isSpeechRecognitionSupported = useCallback(() => {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }, []);

  const isServerRecognitionSupported = useCallback(() => {
    return !!navigator.mediaDevices?.getUserMedia
      && 'MediaRecorder' in window
      && !!((window as any).AudioContext || (window as any).webkitAudioContext);
  }, []);

  const shouldBeListening = useCallback(() => {
    return enabledRef.current && desiredListeningRef.current && !suspendedRef.current;
  }, []);

  const stopServerVad = useCallback(() => {
    if (serverVadFrameRef.current !== null) {
      window.cancelAnimationFrame(serverVadFrameRef.current);
      serverVadFrameRef.current = null;
    }
    setIsListening(false);
  }, []);

  const transcribeServerBlob = useCallback(async (blob: Blob, speechDurationMs: number) => {
    if (!blob.size || !enabledRef.current) return;

    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), SERVER_TRANSCRIBE_TIMEOUT_MS);

    try {
      const form = new FormData();
      const mimeType = blob.type || preferredRecordingMimeType() || 'audio/webm';
      const extension = mimeType.includes('mp4') ? 'm4a'
        : mimeType.includes('ogg') ? 'ogg'
          : mimeType.includes('wav') ? 'wav'
            : 'webm';

      form.append('audio', blob, `lexara-turn.${extension}`);
      form.append('speechDurationMs', String(Math.max(0, Math.round(speechDurationMs))));
      const response = await fetch('/api/lexara/transcribe-file', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || 'Speech transcription is temporarily unavailable');
      }

      const value = String(payload?.transcript || '').trim();
      if (!value || !enabledRef.current) return;

      resetTransientRecovery();
      setTranscript(prev => (prev ? `${prev} ${value}` : value));
      setInterimTranscript('');
      optionsRef.current.onTranscript?.(value, true, {
        engine: 'server',
        provider: typeof payload?.provider === 'string' ? payload.provider : undefined,
        speechDurationMs,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      const nextError = err instanceof Error ? err : new Error('Speech transcription failed');
      setError(nextError);
      optionsRef.current.onError?.(nextError);
    } finally {
      window.clearTimeout(timer);
      if (transcriptionAbortRef.current === controller) {
        transcriptionAbortRef.current = null;
      }
    }
  }, [resetTransientRecovery]);

  const queueServerTranscription = useCallback((blob: Blob, speechDurationMs: number) => {
    serverTranscriptionQueueRef.current = serverTranscriptionQueueRef.current
      .catch(() => undefined)
      .then(() => transcribeServerBlob(blob, speechDurationMs));
  }, [transcribeServerBlob]);

  const finishServerUtterance = useCallback((discard = false) => {
    const recorder = serverRecorderRef.current;
    const hadSpeech = serverSpeechActiveRef.current;
    const speechStartedAt = serverSpeechStartedAtRef.current;
    if (hadSpeech && speechStartedAt !== null) {
      serverLastSpeechDurationMsRef.current = Math.max(0, performance.now() - speechStartedAt);
    }
    discardServerRecordingRef.current = discard;
    serverSpeechActiveRef.current = false;
    serverSpeechStartedAtRef.current = null;
    serverSilenceStartedAtRef.current = null;
    serverLastAboveThresholdAtRef.current = 0;

    if (hadSpeech && serverVoiceStartNotifiedRef.current) {
      optionsRef.current.onVoiceEnd?.();
    }
    serverVoiceStartNotifiedRef.current = false;

    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        serverRecorderRef.current = null;
        serverRecorderChunksRef.current = [];
      }
    }
  }, []);

  const beginServerUtterance = useCallback(() => {
    const stream = serverStreamRef.current;
    if (!stream || serverSpeechActiveRef.current || !shouldBeListening()) return;

    const mimeType = preferredRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 48_000 });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    serverRecorderChunksRef.current = [];
    discardServerRecordingRef.current = false;
    serverRecorderRef.current = recorder;
    serverSpeechActiveRef.current = true;
    serverSpeechStartedAtRef.current = performance.now();
    serverSilenceStartedAtRef.current = null;

    recorder.ondataavailable = event => {
      if (event.data?.size) serverRecorderChunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      finishServerUtterance(true);
    };

    recorder.onstop = () => {
      const chunks = serverRecorderChunksRef.current;
      serverRecorderChunksRef.current = [];
      serverRecorderRef.current = null;

      if (discardServerRecordingRef.current || chunks.length === 0) {
        discardServerRecordingRef.current = false;
        return;
      }

      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      discardServerRecordingRef.current = false;
      if (blob.size > 600) {
        queueServerTranscription(blob, serverLastSpeechDurationMsRef.current);
      }
    };

    try {
      recorder.start(250);
      // A short confirmation window prevents incidental clicks/noise from
      // cutting LEXARA off, while still making barge-in feel immediate.
      window.setTimeout(() => {
        const now = performance.now();
        if (
          serverSpeechActiveRef.current
          && !serverVoiceStartNotifiedRef.current
          && serverSpeechStartedAtRef.current !== null
          && now - serverSpeechStartedAtRef.current >= SERVER_VOICE_CONFIRM_MS
          && now - serverLastAboveThresholdAtRef.current <= SERVER_VOICE_RECENCY_MS
        ) {
          serverVoiceStartNotifiedRef.current = true;
          // Candidate acoustic activity is intentionally not surfaced as an
          // interruption. Only a transcript can prove this is user speech.
        }
      }, SERVER_VOICE_CONFIRM_MS + 10);
    } catch (err) {
      serverRecorderRef.current = null;
      serverSpeechActiveRef.current = false;
      serverSpeechStartedAtRef.current = null;
      const nextError = err instanceof Error ? err : new Error('Microphone recording could not start');
      setError(nextError);
      optionsRef.current.onError?.(nextError);
    }
  }, [finishServerUtterance, queueServerTranscription, shouldBeListening]);

  const startServerVad = useCallback(() => {
    const analyser = serverAnalyserRef.current;
    if (!analyser || serverVadFrameRef.current !== null || !shouldBeListening()) return;

    const samples = new Uint8Array(analyser.fftSize);
    setIsListening(true);
    setError(null);

    const frame = () => {
      if (!shouldBeListening() || !serverAnalyserRef.current) {
        serverVadFrameRef.current = null;
        setIsListening(false);
        return;
      }

      const activeAnalyser = serverAnalyserRef.current;
      activeAnalyser.getByteTimeDomainData(samples);

      let energy = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = (samples[i] - 128) / 128;
        energy += sample * sample;
      }
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();

      // Calibrate to the current microphone/environment while idle instead of
      // assuming one fixed level works across phones, tablets, headsets and PCs.
      if (!serverSpeechActiveRef.current) {
        const boundedSample = Math.min(rms, 0.03);
        serverNoiseFloorRef.current =
          (serverNoiseFloorRef.current * 0.96) + (boundedSample * 0.04);
      }
      const adaptiveThreshold = Math.max(
        SERVER_VAD_MIN_THRESHOLD,
        Math.min(
          SERVER_VAD_MAX_THRESHOLD,
          serverNoiseFloorRef.current * SERVER_VAD_NOISE_MULTIPLIER,
        ),
      );

      if (rms >= adaptiveThreshold) {
        serverLastAboveThresholdAtRef.current = now;
        if (!serverSpeechActiveRef.current) {
          beginServerUtterance();
        }
        serverSilenceStartedAtRef.current = null;
      } else if (serverSpeechActiveRef.current) {
        if (serverSilenceStartedAtRef.current === null) {
          serverSilenceStartedAtRef.current = now;
        }

        const speechStartedAt = serverSpeechStartedAtRef.current || now;
        const speechMs = now - speechStartedAt;
        const silenceMs = now - serverSilenceStartedAtRef.current;

        if (speechMs >= SERVER_MIN_SPEECH_MS && silenceMs >= SERVER_VAD_SILENCE_MS) {
          finishServerUtterance(false);
        }
      }

      if (
        serverSpeechActiveRef.current
        && serverSpeechStartedAtRef.current !== null
        && now - serverSpeechStartedAtRef.current >= SERVER_MAX_UTTERANCE_MS
      ) {
        finishServerUtterance(false);
      }

      serverVadFrameRef.current = window.requestAnimationFrame(frame);
    };

    serverVadFrameRef.current = window.requestAnimationFrame(frame);
  }, [beginServerUtterance, finishServerUtterance, shouldBeListening]);

  const initializeServerRecognition = useCallback(async (stream: MediaStream) => {
    serverStreamRef.current = stream;

    // Reuse the AudioContext that the consent page unlocked from the user's
    // gesture. This avoids an iOS/Safari second-tap requirement after SPA
    // navigation into the consultation.
    const audioContext = await getLexaraSharedAudioContext();
    serverAudioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    serverAudioSourceRef.current = source;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    serverAnalyserRef.current = analyser;

    if (audioContext.state !== 'running') {
      throw new Error('Tap the microphone button once to start live voice on this browser.');
    }
  }, []);

  const cleanupServerRecognition = useCallback((stopTracks = true) => {
    stopServerVad();
    finishServerUtterance(true);
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;

    try {
      serverAudioSourceRef.current?.disconnect();
    } catch {
      // The source may already be detached from the shared audio graph.
    }
    serverAudioSourceRef.current = null;
    serverAudioContextRef.current = null;
    serverAnalyserRef.current = null;

    if (stopTracks) {
      serverStreamRef.current?.getTracks().forEach(track => track.stop());
      serverStreamRef.current = null;
    }
  }, [finishServerUtterance, stopServerVad]);

  const switchToServerRecognition = useCallback(async (): Promise<boolean> => {
    if (!isServerRecognitionSupported()) return false;

    const previousEngine = engineRef.current;
    engineRef.current = 'server';
    clearRestartTimer();

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Browser recognizer may already be stopped.
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: preferredMicrophoneConstraints(),
        video: false,
      });

      await initializeServerRecognition(stream);
      recognitionActiveRef.current = false;
      setEngine('server');
      setError(null);
      resetTransientRecovery();

      if (shouldBeListening()) startServerVad();
      return true;
    } catch {
      cleanupServerRecognition(true);
      engineRef.current = previousEngine;
      setEngine(previousEngine);
      return false;
    }
  }, [
    cleanupServerRecognition,
    clearRestartTimer,
    initializeServerRecognition,
    isServerRecognitionSupported,
    resetTransientRecovery,
    shouldBeListening,
    startServerVad,
  ]);

  const initializeSpeechRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      throw new Error('Browser speech recognition is unavailable');
    }

    if (recognitionRef.current) return recognitionRef.current;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    const currentOptions = optionsRef.current;

    recognition.continuous = currentOptions.continuous ?? true;
    recognition.interimResults = currentOptions.interimResults ?? true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
      setIsListening(true);
      setError(null);
    };

    recognition.onspeechstart = () => {
      optionsRef.current.onVoiceStart?.();
    };

    recognition.onspeechend = () => {
      optionsRef.current.onVoiceEnd?.();
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;
      setIsListening(false);

      clearRestartTimer();
      const continuous = optionsRef.current.continuous ?? true;
      if (!continuous || !shouldBeListening() || engineRef.current !== 'browser') return;

      const restartDelay = restartDelayRef.current;
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!shouldBeListening() || recognitionActiveRef.current || engineRef.current !== 'browser') return;
        try {
          recognition.start();
        } catch {
          // Browser state callbacks reconcile overlapping start transitions.
        }
      }, restartDelay);
    };

    recognition.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) finalText += text;
        else interimText += text;
      }

      if (finalText.trim() || interimText.trim()) resetTransientRecovery();

      if (finalText.trim()) {
        const finalValue = finalText.trim();
        const confidence = Number(event.results?.[event.resultIndex]?.[0]?.confidence);
        setTranscript(prev => (prev ? `${prev} ${finalValue}` : finalValue));
        setInterimTranscript(interimText.trim());
        optionsRef.current.onTranscript?.(finalValue, true, {
          engine: 'browser',
          confidence: Number.isFinite(confidence) ? confidence : undefined,
        });
      } else {
        setInterimTranscript(interimText.trim());
        if (interimText.trim()) {
          optionsRef.current.onTranscript?.(interimText.trim(), false, { engine: 'browser' });
        }
      }
    };

    recognition.onerror = (event: any) => {
      recognitionActiveRef.current = false;
      setIsListening(false);

      const code = String(event?.error || 'unknown');
      const err = new Error(`Speech recognition error: ${code}`);

      if (code === 'not-allowed' || code === 'permission-denied' || code === 'audio-capture') {
        enabledRef.current = false;
        desiredListeningRef.current = false;
        suspendedRef.current = false;
        clearRestartTimer();
        resetTransientRecovery();
        setIsEnabled(false);
        setIsSuspended(false);
        setHasPermission(code === 'audio-capture' ? null : false);
        setError(err);
        optionsRef.current.onError?.(err);
        return;
      }

      if (code === 'network') {
        networkFailureCountRef.current += 1;

        // Browser speech services can be unavailable even when microphone
        // capture works. After two transport failures, move the conversation
        // to the device-neutral server transcription path automatically.
        if (networkFailureCountRef.current >= 2 && isServerRecognitionSupported()) {
          void switchToServerRecognition().then(switched => {
            if (!switched) {
              engineRef.current = 'browser';
              setEngine('browser');
            }
          });
          setError(null);
          return;
        }

        restartDelayRef.current = Math.min(
          MAX_NETWORK_RESTART_DELAY_MS,
          BASE_RESTART_DELAY_MS * (2 ** Math.min(networkFailureCountRef.current, 6)),
        );
        setError(null);
        return;
      }

      if (code === 'aborted' || code === 'no-speech') {
        if (code === 'no-speech') restartDelayRef.current = Math.max(restartDelayRef.current, 300);
        setError(null);
        return;
      }

      setError(err);
      optionsRef.current.onError?.(err);
    };

    recognition.onnomatch = () => undefined;

    recognitionRef.current = recognition;
    return recognition;
  }, [
    clearRestartTimer,
    isServerRecognitionSupported,
    isSpeechRecognitionSupported,
    resetTransientRecovery,
    shouldBeListening,
    switchToServerRecognition,
  ]);

  const enableVoice = useCallback(async () => {
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot access a microphone. Text mode remains available.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: preferredMicrophoneConstraints(),
        video: false,
      });
      setHasPermission(true);

      // Preserve the proven native speech path wherever the browser exposes
      // it. Standards-based MediaRecorder/server STT remains a route-local
      // fallback for browsers whose speech service is absent or repeatedly fails.
      if (isSpeechRecognitionSupported()) {
        stream.getTracks().forEach(track => track.stop());
        initializeSpeechRecognition();
        engineRef.current = 'browser';
        setEngine('browser');
      } else if (isServerRecognitionSupported()) {
        await initializeServerRecognition(stream);
        engineRef.current = 'server';
        setEngine('server');
      } else {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Live speech input is unavailable on this browser. Text mode remains available.');
      }

      resetTransientRecovery();
      enabledRef.current = true;
      setIsEnabled(true);
      setIsSuspended(false);
    } catch (err) {
      cleanupServerRecognition(true);
      const nextError = err instanceof Error ? err : new Error('Failed to enable voice mode');
      enabledRef.current = false;
      desiredListeningRef.current = false;
      engineRef.current = null;
      setEngine(null);
      setError(nextError);
      setIsEnabled(false);
      if (/permission|denied|not allowed/i.test(nextError.message)) setHasPermission(false);
      throw nextError;
    }
  }, [
    cleanupServerRecognition,
    initializeServerRecognition,
    initializeSpeechRecognition,
    isServerRecognitionSupported,
    isSpeechRecognitionSupported,
    resetTransientRecovery,
  ]);

  const startListening = useCallback(() => {
    desiredListeningRef.current = true;
    suspendedRef.current = false;
    setIsSuspended(false);

    if (!enabledRef.current) return;

    if (engineRef.current === 'server') {
      startServerVad();
      return;
    }

    const recognition = recognitionRef.current || initializeSpeechRecognition();
    clearRestartTimer();

    if (recognitionActiveRef.current) return;
    try {
      recognition.start();
    } catch {
      // Browser callbacks reconcile overlapping start transitions.
    }
  }, [clearRestartTimer, initializeSpeechRecognition, startServerVad]);

  const stopListening = useCallback(() => {
    desiredListeningRef.current = false;
    suspendedRef.current = false;
    setIsSuspended(false);
    setInterimTranscript('');
    clearRestartTimer();
    resetTransientRecovery();

    if (engineRef.current === 'server') {
      stopServerVad();
      finishServerUtterance(false);
      return;
    }

    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore invalid-state errors while already stopped.
    }
  }, [clearRestartTimer, finishServerUtterance, resetTransientRecovery, stopServerVad]);

  const suspendListening = useCallback(() => {
    if (!enabledRef.current) return;

    suspendedRef.current = true;
    setIsSuspended(true);
    setInterimTranscript('');
    clearRestartTimer();

    if (engineRef.current === 'server') {
      stopServerVad();
      finishServerUtterance(true);
      return;
    }

    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped/suspended.
    }
  }, [clearRestartTimer, finishServerUtterance, stopServerVad]);

  const resumeListening = useCallback(() => {
    if (!enabledRef.current) return;

    desiredListeningRef.current = true;
    suspendedRef.current = false;
    setIsSuspended(false);
    clearRestartTimer();

    if (engineRef.current === 'server') {
      startServerVad();
      return;
    }

    const recognition = recognitionRef.current || initializeSpeechRecognition();
    if (recognitionActiveRef.current) return;

    try {
      recognition.start();
    } catch {
      // Already transitioning. Browser callbacks reconcile state.
    }
  }, [clearRestartTimer, initializeSpeechRecognition, startServerVad]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    desiredListeningRef.current = false;
    suspendedRef.current = false;
    recognitionActiveRef.current = false;
    clearRestartTimer();
    resetTransientRecovery();
    cleanupServerRecognition(true);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore invalid-state errors.
      }
      recognitionRef.current = null;
    }

    engineRef.current = null;
    setEngine(null);
    setIsEnabled(false);
    setIsListening(false);
    setIsSuspended(false);
    setTranscript('');
    setInterimTranscript('');
    setError(null);

    toast({
      title: 'Voice Mode Disabled',
      description: 'You can keep using LEXARA by typing.',
    });
  }, [cleanupServerRecognition, clearRestartTimer, resetTransientRecovery, toast]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!enabledRef.current || engineRef.current !== 'server') return;

      if (document.visibilityState === 'hidden') {
        stopServerVad();
        finishServerUtterance(false);
        return;
      }

      void (async () => {
        const context = serverAudioContextRef.current;
        if (context?.state === 'suspended') {
          try {
            await context.resume();
          } catch {
            // A later explicit user gesture can resume audio on stricter UAs.
          }
        }
        if (shouldBeListening()) startServerVad();
      })();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [finishServerUtterance, shouldBeListening, startServerVad, stopServerVad]);

  useEffect(() => {
    return () => {
      enabledRef.current = false;
      desiredListeningRef.current = false;
      suspendedRef.current = true;
      clearRestartTimer();
      resetTransientRecovery();
      cleanupServerRecognition(true);

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors.
        }
      }
      recognitionRef.current = null;
    };
  }, [cleanupServerRecognition, clearRestartTimer, resetTransientRecovery]);

  return {
    isEnabled,
    isListening,
    isSuspended,
    transcript,
    interimTranscript,
    enableVoice,
    enable: enableVoice,
    disable,
    startListening,
    stopListening,
    suspendListening,
    resumeListening,
    error,
    hasPermission,
    engine,
  };
}
