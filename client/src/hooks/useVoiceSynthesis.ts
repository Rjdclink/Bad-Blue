/**
 * useVoiceSynthesis Hook
 * Stage 13-14: Frontend voice synthesis and playback
 * 
 * Provides interface for ALEXERA voice synthesis with browser fallback
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
 * Hook for ALEXERA voice synthesis
 */
export function useVoiceSynthesis(): VoiceSynthesisResult {
  const { toast } = useToast();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentOptionsRef = useRef<VoiceSynthesisOptions>({});

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  /**
   * Stop current speech
   */
  const stop = useCallback(() => {
    // Stop audio element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    // Stop speech synthesis
    if (utteranceRef.current) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }

    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
  }, []);

  /**
   * Pause current speech
   */
  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPaused(true);
    } else if (utteranceRef.current) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  /**
   * Resume paused speech
   */
  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      setIsPaused(false);
    } else if (utteranceRef.current) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  // ============================================================================
  // LEXARA VOICE CONFIGURATION - Female voice profile
  // ============================================================================
  
  const LEXARA_VOICE_CONFIG = {
    preferredGender: 'female' as const,
    targetPitch: 1.2,
    targetRate: 0.95,
    persona: 'ethereal-spectral-legal-counsel',
    femaleVoiceHints: [
      'female', 'woman', 'samantha', 'karen', 'fiona', 'tessa', 'moira',
      'victoria', 'alex', 'allison', 'ava', 'susan', 'zira', 'hazel',
      'jenny', 'aria', 'sara', 'joanna', 'amy', 'emma', 'ivy', 'kendra',
      'kimberly', 'salli', 'nicole', 'veena', 'aditi', 'raveena',
      'google uk english female', 'google us english female'
    ],
  };

  const LEXARA_VOICE_STORAGE_KEY = 'lexara-voice-profile';

  /**
   * Select a female voice from available voices
   */
  const selectFemaleVoice = useCallback((voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    if (!voices.length) return null;
    
    // First, try to find explicitly female voices
    for (const voice of voices) {
      const nameLower = voice.name.toLowerCase();
      const langLower = voice.lang.toLowerCase();
      
      for (const hint of LEXARA_VOICE_CONFIG.femaleVoiceHints) {
        if (nameLower.includes(hint) || langLower.includes(hint)) {
          return voice;
        }
      }
    }
    
    // Prefer English voices as fallback
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) return englishVoice;
    
    return voices[0];
  }, []);

  /**
   * Get or select the LEXARA voice profile
   */
  const getLexaraVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    
    // Try to load cached voice
    try {
      const cachedVoiceId = localStorage.getItem(LEXARA_VOICE_STORAGE_KEY);
      if (cachedVoiceId) {
        const cachedVoice = voices.find(v => v.voiceURI === cachedVoiceId);
        if (cachedVoice) return cachedVoice;
      }
    } catch (e) {
      // localStorage may not be available
    }
    
    // Select a female voice and cache it
    const selectedVoice = selectFemaleVoice(voices);
    if (selectedVoice) {
      try {
        localStorage.setItem(LEXARA_VOICE_STORAGE_KEY, selectedVoice.voiceURI);
      } catch (e) {
        // localStorage may not be available
      }
    }
    
    return selectedVoice;
  }, [selectFemaleVoice]);

  /**
   * Speak using browser Web Speech API
   */
  const speakWithBrowser = useCallback(async (
    text: string,
    ssml: string,
    options: VoiceSynthesisOptions
  ) => {
    if (!('speechSynthesis' in window)) {
      throw new Error('Browser speech synthesis not supported');
    }

    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    // Create utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;

    // Get LEXARA female voice (with caching)
    const lexaraVoice = getLexaraVoice();
    if (lexaraVoice) {
      utterance.voice = lexaraVoice;
    }

    // Configure utterance based on LEXARA female persona
    utterance.rate = LEXARA_VOICE_CONFIG.targetRate;  // 0.95 - soft, clear, articulate
    utterance.pitch = LEXARA_VOICE_CONFIG.targetPitch; // 1.2 - slightly higher for feminine voice
    utterance.volume = 1.0;

    // Set up event handlers
    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsLoading(false);
      options.onStart?.();
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
      options.onEnd?.();
    };

    utterance.onerror = (event) => {
      const err = new Error(`Speech synthesis error: ${event.error}`);
      setError(err);
      setIsSpeaking(false);
      utteranceRef.current = null;
      options.onError?.(err);
    };

    // Speak
    window.speechSynthesis.speak(utterance);
    setProvider('browser');
  }, [getLexaraVoice]);

  /**
   * Speak using server-side synthesis
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
        throw new Error(`Server speech synthesis failed: ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type');

      // Check if we got audio data
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

        const providerName = response.headers.get('X-Provider') || 'server';
        setProvider(providerName);

      } else {
        // Got SSML/metadata for browser synthesis
        const data = await response.json();
        setProvider(data.provider || 'browser');
        await speakWithBrowser(data.text, data.ssml, options);
      }

    } catch (err) {
      throw err;
    }
  }, [speakWithBrowser]);

  /**
   * Main speak function
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

      // Try server-side synthesis first
      try {
        await speakWithServer(text, options);
      } catch (serverError) {
        // Fallback to browser synthesis
        console.warn('Server synthesis failed, using browser TTS:', serverError);
        await speakWithBrowser(text, '', options);
      }

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Speech synthesis failed');
      setError(error);
      setIsLoading(false);
      setIsSpeaking(false);
      
      options.onError?.(error);
      
      toast({
        title: 'Voice Synthesis Error',
        description: 'Unable to play audio. Please check your audio settings.',
        variant: 'destructive',
      });
    }
  }, [stop, speakWithServer, speakWithBrowser, toast]);

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
