/**
 * LEXARA Speech Client
 * 
 * Server-side TTS integration for Lexara voice synthesis using ElevenLabs.
 * Handles audio playback with proper audio unlock for browsers.
 * 
 * A7 - LOCK LEXARA INTO TRUE "PERSONA MODE"
 * Permanent, Stable, Feminine, Non-Robotic
 */

/**
 * User sentiment types for emotional modulation
 */
export interface UserSentiment {
  positive: boolean;
  stress: boolean;
  confusion: boolean;
}

/**
 * Persona kernel speech configuration
 */
export interface PersonaKernelSpeech {
  timbre: string;
  texture: string;
  pacing: string;
  intonation: string;
  pitch?: 'bright' | 'lower-soft' | 'normal';
}

/**
 * Voice response from server
 */
export interface VoiceResponse {
  success: boolean;
  text: string;
  audio?: Blob;
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  durationMs?: number;
  voiceConfig: PersonaKernelSpeech;
  emotionalState: string;
}

/**
 * Audio playback state
 */
interface PlaybackState {
  isPlaying: boolean;
  currentAudio: HTMLAudioElement | null;
  queue: Array<{ text: string; audio?: Blob }>;
  audioUnlocked: boolean;
}

const playbackState: PlaybackState = {
  isPlaying: false,
  currentAudio: null,
  queue: [],
  audioUnlocked: false,
};

// AudioContext for unlocking audio on mobile/browsers
let audioContext: AudioContext | null = null;

/**
 * Unlock audio playback on user interaction
 * Must be called on first user click/tap
 */
export async function unlockAudio(): Promise<boolean> {
  if (playbackState.audioUnlocked) {
    return true;
  }

  try {
    // Create AudioContext if needed
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Resume AudioContext (required for iOS/Safari)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Play silent audio to unlock
    const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silentAudio.volume = 0.001;
    
    await silentAudio.play();
    silentAudio.pause();

    playbackState.audioUnlocked = true;
    console.log('[LexaraServerTTS] Audio unlocked successfully');
    return true;

  } catch (error) {
    console.warn('[LexaraServerTTS] Failed to unlock audio:', error);
    return false;
  }
}

/**
 * Apply emotional modulation to persona kernel speech
 * Makes Lexara feel alive, reactive, and human
 */
export function applyEmotionalModulation(
  personaKernel: { speech: PersonaKernelSpeech },
  userSentiment: UserSentiment
): PersonaKernelSpeech {
  const speech = { ...personaKernel.speech };

  if (userSentiment.positive) {
    speech.pitch = 'bright';
  }

  if (userSentiment.stress) {
    speech.pitch = 'lower-soft';
  }

  if (userSentiment.confusion) {
    speech.pacing = 'slower';
  }

  return speech;
}

/**
 * Analyze user input to detect sentiment
 */
export function analyzeUserSentiment(text: string): UserSentiment {
  const lowercaseText = text.toLowerCase();

  // Positive indicators
  const positiveWords = [
    'great', 'awesome', 'wonderful', 'happy', 'love', 'excellent',
    'thank', 'thanks', 'perfect', 'amazing', 'good', 'nice', 'yes'
  ];
  const positive = positiveWords.some(word => lowercaseText.includes(word));

  // Stress indicators
  const stressWords = [
    'worried', 'scared', 'afraid', 'nervous', 'anxious', 'urgent',
    'emergency', 'help', 'panic', 'desperate', 'stressed', 'overwhelmed'
  ];
  const stress = stressWords.some(word => lowercaseText.includes(word));

  // Confusion indicators
  const confusionWords = [
    'confused', 'don\'t understand', 'unclear', 'what do you mean',
    'explain', 'clarify', 'lost', 'huh', 'what', 'how does'
  ];
  const confusion = confusionWords.some(word => lowercaseText.includes(word));

  return { positive, stress, confusion };
}

/**
 * LexaraServerTTS - Server-side TTS client for ElevenLabs
 * Primary method for Lexara voice synthesis
 */
export const LexaraServerTTS = {
  /**
   * Play audio from server response
   * Supports: Blob, audioUrl, or audioBase64
   */
  async play(audioOrResponse: Blob | VoiceResponse | { audio: Blob } | { audioBase64: string; mimeType: string }): Promise<void> {
    // Ensure audio is unlocked
    if (!playbackState.audioUnlocked) {
      await unlockAudio();
    }

    let audioUrl: string;
    let shouldRevokeUrl = false;

    // Handle different input types
    if (audioOrResponse instanceof Blob) {
      audioUrl = URL.createObjectURL(audioOrResponse);
      shouldRevokeUrl = true;
    } else if ('audioBase64' in audioOrResponse && audioOrResponse.audioBase64) {
      // Convert base64 to blob and create URL
      const mimeType = audioOrResponse.mimeType || 'audio/mpeg';
      const byteCharacters = atob(audioOrResponse.audioBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      audioUrl = URL.createObjectURL(blob);
      shouldRevokeUrl = true;
    } else if ('audioUrl' in audioOrResponse && audioOrResponse.audioUrl) {
      audioUrl = audioOrResponse.audioUrl;
    } else if ('audio' in audioOrResponse && audioOrResponse.audio) {
      audioUrl = URL.createObjectURL(audioOrResponse.audio);
      shouldRevokeUrl = true;
    } else {
      console.warn('[LexaraServerTTS] No audio data provided');
      return;
    }

    // Create and play audio element
    const audio = new Audio(audioUrl);

    playbackState.currentAudio = audio;
    playbackState.isPlaying = true;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        playbackState.isPlaying = false;
        playbackState.currentAudio = null;
        if (shouldRevokeUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        Lexara.notify(Lexara.events.SPEAKING_END);
        resolve();
      };

      audio.onerror = (error) => {
        playbackState.isPlaying = false;
        playbackState.currentAudio = null;
        if (shouldRevokeUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        Lexara.notify(Lexara.events.SPEAKING_END);
        reject(error);
      };

      audio.onplay = () => {
        Lexara.notify(Lexara.events.SPEAKING_START);
      };

      audio.play().catch(reject);
    });
  },

  /**
   * Stop current playback
   */
  stop(): void {
    if (playbackState.currentAudio) {
      playbackState.currentAudio.pause();
      playbackState.currentAudio.currentTime = 0;
      playbackState.currentAudio = null;
    }
    playbackState.isPlaying = false;
    playbackState.queue = [];
    Lexara.notify(Lexara.events.SPEAKING_END);
  },

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return playbackState.isPlaying;
  },

  /**
   * Check if audio is unlocked
   */
  isAudioUnlocked(): boolean {
    return playbackState.audioUnlocked;
  },

  /**
   * Synthesize and play audio using ElevenLabs via server
   */
  async synthesizeAndPlay(text: string, emotionalState?: string): Promise<void> {
    try {
      // Use the TTS stream endpoint for direct audio
      const response = await fetch('/api/lexara/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `TTS request failed: ${response.status}`);
      }

      // Get audio blob from response
      const audioBlob = await response.blob();
      
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio from server');
      }

      // Play the audio
      await this.play(audioBlob);

    } catch (error) {
      console.error('[LexaraServerTTS] Synthesis error:', error);
      throw error;
    }
  },

  /**
   * Fetch voice synthesis from server (legacy endpoint)
   */
  async synthesize(text: string, emotionalState?: string): Promise<VoiceResponse> {
    try {
      const response = await fetch('/api/lexara/voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          emotionalState: emotionalState || 'neutral',
        }),
      });

      if (!response.ok) {
        throw new Error(`Voice synthesis failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[LexaraServerTTS] Synthesis error:', error);
      throw error;
    }
  },

  /**
   * Speak text with automatic sentiment analysis
   */
  async speak(text: string, userInput?: string): Promise<void> {
    const sentiment = userInput ? analyzeUserSentiment(userInput) : { positive: false, stress: false, confusion: false };
    
    const emotionalState = sentiment.stress ? 'empathetic' :
                          sentiment.confusion ? 'explanatory' :
                          sentiment.positive ? 'cheerful' : 'neutral';

    try {
      await this.synthesizeAndPlay(text, emotionalState);
    } catch (error) {
      console.error('[LexaraServerTTS] Speak error:', error);
      throw error;
    }
  },
};

/**
 * Lexara notification system for avatar awareness
 */
export const Lexara = {
  /**
   * Notify Lexara of events for awareness hooks
   */
  notify(event: string, data?: unknown): void {
    console.log(`[Lexara] Event: ${event}`, data || '');
    
    // Dispatch custom event for avatar controller
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lexara-event', {
        detail: { event, data, timestamp: Date.now() },
      }));
    }
  },

  /**
   * Event types for awareness
   */
  events: {
    AVATAR_READY: 'avatar_ready',
    USER_FOCUS: 'user_focus',
    USER_MOVEMENT: 'user_movement',
    SPEAKING_START: 'speaking_start',
    SPEAKING_END: 'speaking_end',
    LISTENING_START: 'listening_start',
    LISTENING_END: 'listening_end',
    AUDIO_UNLOCKED: 'audio_unlocked',
  } as const,
};

/**
 * Setup audio unlock on first user interaction
 * Call this in your app initialization
 */
export function setupAudioUnlock(): void {
  if (typeof window === 'undefined') return;

  const unlockHandler = async () => {
    if (!playbackState.audioUnlocked) {
      const unlocked = await unlockAudio();
      if (unlocked) {
        Lexara.notify(Lexara.events.AUDIO_UNLOCKED);
        // Remove listeners after successful unlock
        document.removeEventListener('click', unlockHandler);
        document.removeEventListener('touchstart', unlockHandler);
        document.removeEventListener('keydown', unlockHandler);
      }
    }
  };

  // Add listeners for user interaction
  document.addEventListener('click', unlockHandler, { once: false });
  document.addEventListener('touchstart', unlockHandler, { once: false });
  document.addEventListener('keydown', unlockHandler, { once: false });
}

export default LexaraServerTTS;
