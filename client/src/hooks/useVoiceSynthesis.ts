/**
 * useVoiceSynthesis Hook
 * Stage 13-14: Frontend voice synthesis and playback
 * 
 * Provides interface for Lexara server-side voice synthesis.
 * Browser TTS is disabled to enforce consistent Lexara voice profile.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';
import type { SpeechContext } from '@shared/alexeraVoicePersona';

export interface VoiceSynthesisOptions {
  context?: SpeechContext;
  autoPlay?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
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

/**
 * Hook for Lexara voice synthesis (server-side only)
 * Browser TTS is disabled to enforce consistent Lexara voice profile.
 */
export function useVoiceSynthesis(): VoiceSynthesisResult {
  const { toast } = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentOptionsRef = useRef<VoiceSynthesisOptions>({});

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  /**
   * Stop current speech (server-side audio only)
   */
  const stop = useCallback(() => {
    // Stop audio element from server-side synthesis
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
  }, []);

  /**
   * Pause current speech (server-side audio only)
   */
  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPaused(true);
    }
  }, []);

  /**
   * Resume paused speech (server-side audio only)
   */
  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      setIsPaused(false);
    }
  }, []);

  /**
   * Speak using server-side Lexara voice synthesis
   */
  const speakWithServer = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions
  ) => {
    try {
      const response = await fetch('/api/alexera/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          context: options.context || 'explanation',
          optimizeForAuditory: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Lexara voice synthesis failed: ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type');

      // Check if we got audio data from Lexara voice provider
      if (contentType?.includes('audio/')) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio element
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onloadeddata = () => {
          setIsLoading(false);
          if (options.autoPlay !== false) {
            audio.play();
          }
        };

        audio.onplay = () => {
          setIsSpeaking(true);
          options.onStart?.();
        };

        audio.onended = () => {
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          options.onEnd?.();
        };

        audio.onerror = () => {
          const err = new Error('Audio playback failed');
          setError(err);
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          options.onError?.(err);
        };

        const providerName = response.headers.get('X-Provider') || 'lexara';
        setProvider(providerName);

      } else {
        // No audio data received - Lexara voice synthesis unavailable
        throw new Error('Lexara voice synthesis did not return audio. Voice synthesis is temporarily unavailable.');
      }

    } catch (err) {
      throw err;
    }
  }, []);

  /**
   * Main speak function
   * Uses only server-side Lexara voice synthesis (browser TTS disabled)
   */
  const speak = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions = {}
  ) => {
    try {
      // Stop any ongoing speech
      stop();

      // Store options
      currentOptionsRef.current = options;

      setIsLoading(true);
      setError(null);

      // Use only server-side Lexara voice synthesis (no browser TTS fallback)
      await speakWithServer(text, options);

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Lexara voice synthesis unavailable');
      setError(error);
      setIsLoading(false);
      setIsSpeaking(false);
      
      options.onError?.(error);
      
      toast({
        title: 'Lexara Voice Unavailable',
        description: 'Voice synthesis is temporarily unavailable. Please try again later.',
        variant: 'destructive',
      });
    }
  }, [stop, speakWithServer, toast]);

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
