/**
 * useVoiceSynthesis Hook
 * Stage 13-14: Frontend voice synthesis and playback
 * 
 * A7 - LOCK LEXARA INTO TRUE "PERSONA MODE"
 * Provides interface for LEXARA voice synthesis with server TTS priority
 * Permanent, Stable, Feminine, Non-Robotic
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from './use-toast';
import type { SpeechContext } from '@shared/alexeraVoicePersona';
import { 
  LexaraServerTTS, 
  Lexara, 
  analyzeUserSentiment, 
  applyEmotionalModulation,
  type UserSentiment,
  type PersonaKernelSpeech
} from '@/lib/lexaraSpeechClient';

export interface VoiceSynthesisOptions {
  context?: SpeechContext;
  autoPlay?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  userInput?: string; // For sentiment analysis and emotional modulation
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
 * Hook for LEXARA voice synthesis
 * Prioritizes server TTS to ensure permanent feminine, non-robotic voice
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
  
  // Store current emotional modulation state
  const emotionalStateRef = useRef<PersonaKernelSpeech | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  /**
   * Stop current speech - use LexaraServerTTS.stop() to ensure no robot fallback
   */
  const stop = useCallback(() => {
    // Stop LexaraServerTTS first
    LexaraServerTTS.stop();
    
    // Stop audio element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    // Stop speech synthesis (fallback only)
    if (utteranceRef.current) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    }

    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
    
    // Notify Lexara of speaking end
    Lexara.notify(Lexara.events.SPEAKING_END);
  }, []);

  /**
   * Pause current speech
   */
  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPaused(true);
    } else if (utteranceRef.current && 'speechSynthesis' in window) {
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
    } else if (utteranceRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  // ============================================================================
  // LEXARA VOICE CONFIGURATION - Female voice profile (Permanent, Non-Robotic)
  // ============================================================================
  
  const LEXARA_VOICE_CONFIG = {
    preferredGender: 'female' as const,
    targetPitch: 1.2,
    targetRate: 0.95,
    persona: 'ethereal-spectral-legal-counsel',
    // A7: Extensive list to ensure female voice selection
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
   * A7: This ensures the robot fallback never triggers again
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
    if (!('speechSynthesis' in window)) return null;
    
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
   * Apply emotional modulation to voice settings
   * A7: Makes Lexara feel alive, reactive, and human
   */
  const getModulatedVoiceSettings = useCallback((userSentiment: UserSentiment) => {
    const personaKernel = {
      speech: {
        timbre: 'female-youth',
        texture: 'breathy-soft with slight sparkle',
        pacing: 'natural human cadence',
        intonation: 'emotional, expressive, non-robotic',
      }
    };
    
    const modulated = applyEmotionalModulation(personaKernel, userSentiment);
    emotionalStateRef.current = modulated;
    
    // Map emotional modulation to browser TTS settings
    let pitch = LEXARA_VOICE_CONFIG.targetPitch;
    let rate = LEXARA_VOICE_CONFIG.targetRate;
    
    if (modulated.pitch === 'bright') {
      pitch = 1.3; // Brighter, more cheerful
    } else if (modulated.pitch === 'lower-soft') {
      pitch = 1.1; // Lower, more comforting
    }
    
    if (modulated.pacing === 'slower') {
      rate = 0.85; // Slower for clarity when user is confused
    }
    
    return { pitch, rate };
  }, []);

  /**
   * Speak using browser Web Speech API with LEXARA feminine voice
   * A7: This is only used as fallback - server TTS is preferred
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

    // Create utterance - A7: Replace new SpeechSynthesisUtterance with controlled instance
    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;

    // Get LEXARA female voice (with caching) - ensures non-robotic voice
    const lexaraVoice = getLexaraVoice();
    if (lexaraVoice) {
      utterance.voice = lexaraVoice;
    }

    // Apply emotional modulation based on user sentiment
    const userSentiment = options.userInput 
      ? analyzeUserSentiment(options.userInput)
      : { positive: false, stress: false, confusion: false };
    
    const { pitch, rate } = getModulatedVoiceSettings(userSentiment);
    
    // Configure utterance based on LEXARA female persona with emotional modulation
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1.0;

    // Set up event handlers
    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsLoading(false);
      Lexara.notify(Lexara.events.SPEAKING_START);
      options.onStart?.();
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
      Lexara.notify(Lexara.events.SPEAKING_END);
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
    setProvider('browser-lexara');
  }, [getLexaraVoice, getModulatedVoiceSettings]);

  /**
   * Speak using server-side synthesis with LexaraServerTTS
   * A7: Primary method - ensures permanent feminine voice
   */
  const speakWithServer = useCallback(async (
    text: string,
    options: VoiceSynthesisOptions
  ) => {
    try {
      // Try Lexara voice endpoint first
      const response = await fetch('/api/lexara/voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          context: options.context || 'explanation',
          emotionalState: options.userInput 
            ? (analyzeUserSentiment(options.userInput).stress ? 'empathetic' : 'neutral')
            : 'neutral',
        }),
      });

      if (!response.ok) {
        // Fallback to lexara endpoint
        const lexaraResponse = await fetch('/api/lexara/speak', {
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
        
        if (!lexaraResponse.ok) {
          throw new Error(`Server speech synthesis failed: ${lexaraResponse.status}`);
        }
        
        // Handle lexara response
        const lexaraContentType = lexaraResponse.headers.get('Content-Type');
        if (lexaraContentType?.includes('audio/')) {
          const audioBlob = await lexaraResponse.blob();
          await LexaraServerTTS.play(audioBlob);
          setProvider('lexara-server');
        } else {
          const data = await lexaraResponse.json();
          setProvider(data.provider || 'browser');
          await speakWithBrowser(data.text || text, '', options);
        }
        return;
      }

      const contentType = response.headers.get('Content-Type');

      // Check if we got audio data
      if (contentType?.includes('audio/')) {
        const audioBlob = await response.blob();
        
        // Use LexaraServerTTS to play - A7: replaces browser defaults
        await LexaraServerTTS.play(audioBlob);
        setProvider('lexara-server');
        
      } else {
        // Got voice config for browser synthesis
        const data = await response.json();
        setProvider(data.provider || 'lexara-browser');
        
        // Apply emotional modulation from server config
        if (data.voiceConfig) {
          emotionalStateRef.current = data.voiceConfig;
        }
        
        await speakWithBrowser(data.text || text, '', options);
      }

    } catch (err) {
      throw err;
    }
  }, [speakWithBrowser]);

  /**
   * Main speak function
   * A7: Prioritizes server TTS to ensure permanent feminine voice
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
      
      // Notify Lexara
      Lexara.notify(Lexara.events.SPEAKING_START, { text: text.substring(0, 50) });

      // Try server-side synthesis first (preferred for consistent feminine voice)
      try {
        await speakWithServer(text, options);
        options.onStart?.();
        setIsSpeaking(true);
        setIsLoading(false);
        
        // Wait for audio to finish
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (!LexaraServerTTS.isPlaying()) {
              clearInterval(checkInterval);
              setIsSpeaking(false);
              options.onEnd?.();
              resolve();
            }
          }, 100);
        });
        
      } catch (serverError) {
        // Fallback to browser synthesis with LEXARA feminine voice
        console.warn('Server synthesis failed, using browser TTS with LEXARA voice:', serverError);
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
