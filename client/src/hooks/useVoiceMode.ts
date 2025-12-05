/**
 * useVoiceMode Hook
 * Stage 14: Conversational Interaction and Voice Mode Functionality
 * 
 * Provides microphone capture, voice activity detection, turn-taking logic
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
  transcript: string;
  interimTranscript: string;
  enable: () => Promise<void>;
  disable: () => void;
  startListening: () => void;
  stopListening: () => void;
  error: Error | null;
  hasPermission: boolean | null;
}

/**
 * Hook for voice mode with speech recognition
 */
export function useVoiceMode(options: VoiceModeOptions = {}): VoiceModeResult {
  const { toast } = useToast();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const recognitionRef = useRef<any>(null);
  const optionsRef = useRef<VoiceModeOptions>(options);

  // Update options ref
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  /**
   * Check browser support for speech recognition
   */
  const isSpeechRecognitionSupported = useCallback(() => {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }, []);

  /**
   * Initialize speech recognition
   */
  const initializeSpeechRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      throw new Error('Speech recognition not supported in this browser');
    }

    // Type assertion for Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = options.continuous ?? true;
    recognition.interimResults = options.interimResults ?? true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    // Event handlers
    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      optionsRef.current.onVoiceStart?.();
    };

    recognition.onend = () => {
      setIsListening(false);
      optionsRef.current.onVoiceEnd?.();
      
      // Restart if still enabled and continuous
      if (isEnabled && options.continuous) {
        try {
          recognition.start();
        } catch (err) {
          // Ignore errors from restarting
        }
      }
    };

    recognition.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      if (finalText) {
        setTranscript(prev => (prev + ' ' + finalText).trim());
        optionsRef.current.onTranscript?.(finalText, true);
      }

      if (interimText) {
        setInterimTranscript(interimText);
        optionsRef.current.onTranscript?.(interimText, false);
      }
    };

    recognition.onerror = (event: any) => {
      const err = new Error(`Speech recognition error: ${event.error}`);
      setError(err);
      setIsListening(false);
      optionsRef.current.onError?.(err);

      // Handle specific errors
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setHasPermission(false);
        toast({
          title: 'Microphone Permission Denied',
          description: 'Please enable microphone access to use voice mode.',
          variant: 'destructive',
        });
      } else if (event.error === 'no-speech') {
        // No speech detected, this is normal
        setError(null);
      }
    };

    recognition.onnomatch = () => {
      // No match found, continue listening
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [isSpeechRecognitionSupported, isEnabled, options, toast]);

  /**
   * Request microphone permission
   */
  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
      setHasPermission(true);
      return true;
    } catch (err) {
      setHasPermission(false);
      throw new Error('Microphone permission denied');
    }
  }, []);

  /**
   * Enable voice mode
   */
  const enable = useCallback(async () => {
    try {
      setError(null);

      // Check browser support
      if (!isSpeechRecognitionSupported()) {
        throw new Error('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.');
      }

      // Request microphone permission
      await requestMicrophonePermission();

      // Initialize speech recognition if not already done
      if (!recognitionRef.current) {
        initializeSpeechRecognition();
      }

      setIsEnabled(true);

      toast({
        title: 'Voice Mode Enabled',
        description: 'LEXARA is now listening. You can speak your questions.',
      });

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to enable voice mode');
      setError(error);
      setIsEnabled(false);
      setHasPermission(false);

      toast({
        title: 'Voice Mode Error',
        description: error.message,
        variant: 'destructive',
      });

      throw error;
    }
  }, [isSpeechRecognitionSupported, requestMicrophonePermission, initializeSpeechRecognition, toast]);

  /**
   * Disable voice mode
   */
  const disable = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        // Ignore errors when stopping
      }
      recognitionRef.current = null;
    }

    setIsEnabled(false);
    setIsListening(false);
    setTranscript('');
    setInterimTranscript('');
    setError(null);

    toast({
      title: 'Voice Mode Disabled',
      description: 'Switched back to text-only mode.',
    });
  }, [toast]);

  /**
   * Start listening
   */
  const startListening = useCallback(() => {
    if (!isEnabled) {
      toast({
        title: 'Voice Mode Disabled',
        description: 'Please enable voice mode first.',
        variant: 'destructive',
      });
      return;
    }

    if (!recognitionRef.current) {
      initializeSpeechRecognition();
    }

    try {
      recognitionRef.current?.start();
    } catch (err) {
      // Already started, ignore
    }
  }, [isEnabled, initializeSpeechRecognition, toast]);

  /**
   * Stop listening
   */
  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch (err) {
      // Ignore errors
    }
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    isEnabled,
    isListening,
    transcript,
    interimTranscript,
    enable,
    disable,
    startListening,
    stopListening,
    error,
    hasPermission,
  };
}
