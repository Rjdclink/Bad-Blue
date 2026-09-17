/**
 * useVoiceMode Hook
 *
 * Provides browser speech recognition with explicit turn-taking control.
 * Voice never auto-enables; callers must explicitly call enableVoice().
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';

export interface VoiceModeOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
  continuous?: boolean;
  interimResults?: boolean;
}

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
}

const BASE_RESTART_DELAY_MS = 120;
const MAX_NETWORK_RESTART_DELAY_MS = 5_000;

export function useVoiceMode(options: VoiceModeOptions = {}): VoiceModeResult {
  const { toast } = useToast();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const recognitionRef = useRef<any>(null);
  const optionsRef = useRef<VoiceModeOptions>(options);
  const enabledRef = useRef(false);
  const desiredListeningRef = useRef(false);
  const suspendedRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const restartDelayRef = useRef(BASE_RESTART_DELAY_MS);
  const networkFailureCountRef = useRef(0);

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

  const shouldBeListening = useCallback(() => {
    return enabledRef.current && desiredListeningRef.current && !suspendedRef.current;
  }, []);

  const initializeSpeechRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      throw new Error('Speech recognition is not supported in this browser');
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
      optionsRef.current.onVoiceStart?.();
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;
      setIsListening(false);
      optionsRef.current.onVoiceEnd?.();

      clearRestartTimer();
      const continuous = optionsRef.current.continuous ?? true;
      if (!continuous || !shouldBeListening()) return;

      const restartDelay = restartDelayRef.current;
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!shouldBeListening() || recognitionActiveRef.current) return;
        try {
          recognition.start();
        } catch {
          // A concurrent browser state transition can make start() invalid.
        }
      }, restartDelay);
    };

    recognition.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) finalText += text;
        else interimText += text;
      }

      if (finalText.trim() || interimText.trim()) {
        resetTransientRecovery();
      }

      if (finalText.trim()) {
        const finalValue = finalText.trim();
        setTranscript(prev => (prev ? `${prev} ${finalValue}` : finalValue));
        // Preserve any still-evolving words for display, but do not emit a
        // second interim callback in the same browser event. Emitting it after
        // the final callback would cancel the caller's quiet-turn timer and can
        // strand an otherwise complete spoken turn.
        setInterimTranscript(interimText.trim());
        optionsRef.current.onTranscript?.(finalValue, true);
      } else {
        setInterimTranscript(interimText.trim());
        if (interimText.trim()) {
          optionsRef.current.onTranscript?.(interimText.trim(), false);
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
        restartDelayRef.current = Math.min(
          MAX_NETWORK_RESTART_DELAY_MS,
          BASE_RESTART_DELAY_MS * (2 ** Math.min(networkFailureCountRef.current, 6)),
        );
        setError(null);
        return;
      }

      if (code === 'aborted' || code === 'no-speech') {
        // Aborts are intentional during turn changes. No-speech is ordinary
        // endpointing; neither should create an error or a hot retry loop.
        if (code === 'no-speech') {
          restartDelayRef.current = Math.max(restartDelayRef.current, 300);
        }
        setError(null);
        return;
      }

      setError(err);
      optionsRef.current.onError?.(err);
    };

    recognition.onnomatch = () => {
      // Keep listening; a no-match is not a terminal error.
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [clearRestartTimer, isSpeechRecognitionSupported, resetTransientRecovery, shouldBeListening]);

  const enableVoice = useCallback(async () => {
    try {
      setError(null);

      if (!isSpeechRecognitionSupported()) {
        throw new Error('Speech recognition is not supported in this browser. Please use a compatible browser or text mode.');
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        stream.getTracks().forEach(track => track.stop());
        setHasPermission(true);
      } catch {
        setHasPermission(false);
        throw new Error('Microphone permission not granted. Please enable live voice through the consent dialog.');
      }

      initializeSpeechRecognition();
      resetTransientRecovery();
      enabledRef.current = true;
      setIsEnabled(true);
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error('Failed to enable voice mode');
      enabledRef.current = false;
      desiredListeningRef.current = false;
      setError(nextError);
      setIsEnabled(false);
      throw nextError;
    }
  }, [initializeSpeechRecognition, isSpeechRecognitionSupported, resetTransientRecovery]);

  const startListening = useCallback(() => {
    desiredListeningRef.current = true;
    suspendedRef.current = false;
    setIsSuspended(false);

    if (!enabledRef.current) return;

    const recognition = recognitionRef.current || initializeSpeechRecognition();
    clearRestartTimer();

    if (recognitionActiveRef.current) return;
    try {
      recognition.start();
    } catch {
      // Already starting/started. Browser callbacks will reconcile state.
    }
  }, [clearRestartTimer, initializeSpeechRecognition]);

  const stopListening = useCallback(() => {
    desiredListeningRef.current = false;
    suspendedRef.current = false;
    setIsSuspended(false);
    setInterimTranscript('');
    clearRestartTimer();
    resetTransientRecovery();

    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore invalid-state errors while already stopped.
    }
  }, [clearRestartTimer, resetTransientRecovery]);

  const suspendListening = useCallback(() => {
    if (!enabledRef.current) return;

    suspendedRef.current = true;
    setIsSuspended(true);
    setInterimTranscript('');
    clearRestartTimer();

    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped/suspended.
    }
  }, [clearRestartTimer]);

  const resumeListening = useCallback(() => {
    if (!enabledRef.current) return;

    desiredListeningRef.current = true;
    suspendedRef.current = false;
    setIsSuspended(false);
    clearRestartTimer();

    const recognition = recognitionRef.current || initializeSpeechRecognition();
    if (recognitionActiveRef.current) return;

    try {
      recognition.start();
    } catch {
      // Already transitioning. onend/start callbacks will reconcile state.
    }
  }, [clearRestartTimer, initializeSpeechRecognition]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    desiredListeningRef.current = false;
    suspendedRef.current = false;
    recognitionActiveRef.current = false;
    clearRestartTimer();
    resetTransientRecovery();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore invalid-state errors.
      }
      recognitionRef.current = null;
    }

    setIsEnabled(false);
    setIsListening(false);
    setIsSuspended(false);
    setTranscript('');
    setInterimTranscript('');
    setError(null);

    toast({
      title: 'Voice Mode Disabled',
      description: 'Switched back to text-only mode.',
    });
  }, [clearRestartTimer, resetTransientRecovery, toast]);

  useEffect(() => {
    return () => {
      enabledRef.current = false;
      desiredListeningRef.current = false;
      suspendedRef.current = true;
      clearRestartTimer();
      resetTransientRecovery();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors.
        }
      }
      recognitionRef.current = null;
    };
  }, [clearRestartTimer, resetTransientRecovery]);

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
  };
}
