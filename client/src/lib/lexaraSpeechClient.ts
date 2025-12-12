/**
 * LEXARA Speech Client
 * 
 * Server-side TTS integration for Lexara voice synthesis.
 * Replaces browser speechSynthesis defaults with server-rendered audio.
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
}

const playbackState: PlaybackState = {
  isPlaying: false,
  currentAudio: null,
  queue: [],
};

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
 * LexaraServerTTS - Server-side TTS client
 * Replaces browser speechSynthesis with server-rendered audio
 */
export const LexaraServerTTS = {
  /**
   * Play audio from server response
   * This replaces: new SpeechSynthesisUtterance() and window.speechSynthesis.speak()
   */
  async play(audioOrResponse: Blob | VoiceResponse | { audio: Blob }): Promise<void> {
    let audioBlob: Blob;

    if (audioOrResponse instanceof Blob) {
      audioBlob = audioOrResponse;
    } else if ('audio' in audioOrResponse && audioOrResponse.audio) {
      audioBlob = audioOrResponse.audio;
    } else {
      console.warn('[LexaraServerTTS] No audio data provided');
      return;
    }

    // Create audio URL and play
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    playbackState.currentAudio = audio;
    playbackState.isPlaying = true;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        playbackState.isPlaying = false;
        playbackState.currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = (error) => {
        playbackState.isPlaying = false;
        playbackState.currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        reject(error);
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
  },

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return playbackState.isPlaying;
  },

  /**
   * Fetch voice synthesis from server
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
      const response = await this.synthesize(text, emotionalState);
      
      if (response.audio) {
        await this.play(response);
      } else {
        // Fallback: Server returned voice config but no audio
        // Client should use browser TTS with the provided config
        console.log('[LexaraServerTTS] Using voice config for client-side synthesis:', response.voiceConfig);
      }
    } catch (error) {
      console.error('[LexaraServerTTS] Speak error:', error);
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
  } as const,
};

export default LexaraServerTTS;
