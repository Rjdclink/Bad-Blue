/**
 * LEXARA Speech Module
 * 
 * @deprecated Browser TTS is disabled to enforce Lexara voice profile.
 * Use the server-side voice synthesis via useVoiceSynthesis hook instead.
 * 
 * This module is preserved for backward compatibility but speech() will return
 * an error indicating that browser TTS is disabled.
 * 
 * For voice synthesis, use:
 * - useVoiceSynthesis hook (client/src/hooks/useVoiceSynthesis.ts)
 * - Server-side /api/alexera/speak endpoint
 */

import { getLexaraStateManager, type LexaraTone, type LexaraEmotionState } from './LexaraState';

// ============================================================================
// TYPES
// ============================================================================

export type LexaraVoiceEmotion = 'soft' | 'steady' | 'excited' | 'serious';

export interface LexaraSpeechConfig {
  pitch: number;        // 0.1 to 2.0, default 1.0
  rate: number;         // 0.1 to 10.0, default 1.0
  volume: number;       // 0 to 1, default 1.0
  breathiness: number;  // Custom: affects pause frequency (0-1)
  inflection: number;   // Custom: affects pitch variation (0-1)
}

export interface SpeechStyleTag {
  emotion: LexaraVoiceEmotion;
  urgency: 'low' | 'medium' | 'high';
  warmth: 'cool' | 'neutral' | 'warm';
}

export interface LexaraSpeechOptions {
  text: string;
  style?: Partial<SpeechStyleTag>;
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onError?: (error: Error) => void;
  onBoundary?: (event: SpeechSynthesisEvent) => void;
}

export interface LexaraSpeechResult {
  success: boolean;
  utterance?: SpeechSynthesisUtterance;
  error?: Error;
}

// ============================================================================
// VOICE CONFIGURATION
// ============================================================================

/**
 * Base configuration for LEXARA's feminine voice
 * Designed for a high-fidelity feminine voice with natural cadence
 */
const BASE_VOICE_CONFIG: LexaraSpeechConfig = {
  pitch: 1.15,       // Slightly higher for feminine quality
  rate: 0.92,        // Slightly slower for natural, breathy delivery
  volume: 0.95,      // Near full volume
  breathiness: 0.4,  // Light breathy timbre
  inflection: 0.35,  // Slight upward inflection
};

/**
 * Emotion-based voice adjustments
 */
const EMOTION_CONFIGS: Record<LexaraVoiceEmotion, Partial<LexaraSpeechConfig>> = {
  soft: {
    pitch: 1.1,
    rate: 0.88,
    volume: 0.85,
    breathiness: 0.6,
    inflection: 0.2,
  },
  steady: {
    pitch: 1.12,
    rate: 0.95,
    volume: 0.95,
    breathiness: 0.3,
    inflection: 0.25,
  },
  excited: {
    pitch: 1.25,
    rate: 1.05,
    volume: 1.0,
    breathiness: 0.2,
    inflection: 0.5,
  },
  serious: {
    pitch: 1.05,
    rate: 0.85,
    volume: 0.92,
    breathiness: 0.25,
    inflection: 0.15,
  },
};

/**
 * Preferred feminine voice hints for voice selection
 */
const FEMININE_VOICE_HINTS = [
  'female', 'woman', 'samantha', 'karen', 'fiona', 'tessa', 'moira',
  'victoria', 'alex', 'allison', 'ava', 'susan', 'zira', 'hazel',
  'jenny', 'aria', 'sara', 'joanna', 'amy', 'emma', 'ivy', 'kendra',
  'kimberly', 'salli', 'nicole', 'veena', 'aditi', 'raveena',
  'google uk english female', 'google us english female', 'microsoft zira'
];

// ============================================================================
// LEXARA SPEECH CLASS
// ============================================================================

export class LexaraSpeech {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private voiceLoadPromise: Promise<void> | null = null;
  private isPaused: boolean = false;
  private isSpeaking: boolean = false;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.voiceLoadPromise = this.loadVoices();
    }
  }

  // ============================================================================
  // VOICE LOADING
  // ============================================================================

  private async loadVoices(): Promise<void> {
    if (!this.synth) return;

    // Voices may be loaded asynchronously
    return new Promise<void>((resolve) => {
      const tryLoadVoices = () => {
        const voices = this.synth!.getVoices();
        if (voices.length > 0) {
          this.selectedVoice = this.selectFeminineVoice(voices);
          resolve();
        }
      };

      // Try immediately
      tryLoadVoices();

      // Also listen for voiceschanged event
      if (this.synth) {
        this.synth.addEventListener('voiceschanged', tryLoadVoices, { once: true });
      }

      // Timeout fallback
      setTimeout(() => {
        if (!this.selectedVoice) {
          tryLoadVoices();
        }
        resolve();
      }, 1000);
    });
  }

  private selectFeminineVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (!voices.length) return null;

    // First, try to find explicitly feminine voices
    for (const voice of voices) {
      const nameLower = voice.name.toLowerCase();
      
      for (const hint of FEMININE_VOICE_HINTS) {
        if (nameLower.includes(hint)) {
          console.log(`[LexaraSpeech] Selected feminine voice: ${voice.name}`);
          return voice;
        }
      }
    }

    // Fallback to English voices
    const englishVoice = voices.find(v => 
      v.lang.startsWith('en') && v.name.toLowerCase().includes('female')
    ) || voices.find(v => v.lang.startsWith('en'));

    if (englishVoice) {
      console.log(`[LexaraSpeech] Fallback to English voice: ${englishVoice.name}`);
      return englishVoice;
    }

    // Last resort
    console.log(`[LexaraSpeech] Using default voice: ${voices[0]?.name}`);
    return voices[0] || null;
  }

  // ============================================================================
  // SPEECH SYNTHESIS
  // ============================================================================

  /**
   * Speak text with LEXARA's voice
   * @deprecated Browser TTS is disabled. Use useVoiceSynthesis hook or /api/alexera/speak endpoint.
   */
  async speak(options: LexaraSpeechOptions): Promise<LexaraSpeechResult> {
    // Browser TTS is disabled to enforce Lexara voice profile
    const error = new Error(
      'Browser TTS is disabled. Use the Lexara server-side voice synthesis via useVoiceSynthesis hook or /api/alexera/speak endpoint.'
    );
    options.onError?.(error);
    return { success: false, error };
  }

  /**
   * Stop current speech
   */
  stop(): void {
    if (this.synth) {
      this.synth.cancel();
    }
    this.currentUtterance = null;
    this.isSpeaking = false;
    this.isPaused = false;
  }

  /**
   * Pause current speech
   */
  pause(): void {
    if (this.synth && this.isSpeaking) {
      this.synth.pause();
    }
  }

  /**
   * Resume paused speech
   */
  resume(): void {
    if (this.synth && this.isPaused) {
      this.synth.resume();
    }
  }

  // ============================================================================
  // STATE QUERIES
  // ============================================================================

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  getIsPaused(): boolean {
    return this.isPaused;
  }

  getSelectedVoice(): SpeechSynthesisVoice | null {
    return this.selectedVoice;
  }

  // ============================================================================
  // VOICE CONFIGURATION
  // ============================================================================

  private mapToneToEmotion(tone: LexaraTone): LexaraVoiceEmotion {
    switch (tone) {
      case 'soft': return 'soft';
      case 'steady': return 'steady';
      case 'excited': return 'excited';
      case 'serious': return 'serious';
      default: return 'steady';
    }
  }

  private calculateVoiceConfig(style: SpeechStyleTag): LexaraSpeechConfig {
    // Start with base config
    const config = { ...BASE_VOICE_CONFIG };

    // Apply emotion adjustments
    const emotionConfig = EMOTION_CONFIGS[style.emotion];
    if (emotionConfig) {
      Object.assign(config, emotionConfig);
    }

    // Apply urgency adjustments
    if (style.urgency === 'high') {
      config.rate *= 1.1;
      config.pitch *= 1.05;
    } else if (style.urgency === 'low') {
      config.rate *= 0.9;
      config.breathiness *= 1.2;
    }

    // Apply warmth adjustments
    if (style.warmth === 'warm') {
      config.pitch *= 0.98;
      config.breathiness *= 1.1;
    } else if (style.warmth === 'cool') {
      config.pitch *= 1.02;
      config.breathiness *= 0.8;
    }

    // Clamp values to valid ranges
    config.pitch = Math.max(0.1, Math.min(2.0, config.pitch));
    config.rate = Math.max(0.1, Math.min(10.0, config.rate));
    config.volume = Math.max(0, Math.min(1.0, config.volume));
    config.breathiness = Math.max(0, Math.min(1.0, config.breathiness));
    config.inflection = Math.max(0, Math.min(1.0, config.inflection));

    return config;
  }

  /**
   * Process text to add natural speech patterns
   * Adds slight pauses and emphasis markers
   */
  private processTextForNaturalSpeech(text: string, config: LexaraSpeechConfig): string {
    // Add brief pauses after commas and periods for more natural rhythm
    let processed = text;

    // The Web Speech API doesn't support SSML, but we can use punctuation
    // to create natural pauses

    // Ensure sentences end with proper punctuation
    if (!/[.!?]$/.test(processed.trim())) {
      processed = processed.trim() + '.';
    }

    // Apply breathiness through subtle text modifications
    // (This is a workaround since we can't directly control breathiness)
    if (config.breathiness > 0.5) {
      // Add ellipsis for breathy pauses in longer sentences
      processed = processed.replace(/,\s+/g, ', ... ');
    }

    return processed;
  }

  // ============================================================================
  // STYLE TAG UTILITIES
  // ============================================================================

  /**
   * Create a style tag from LexaraState's current emotion
   */
  static createStyleFromEmotion(emotion: LexaraEmotionState): SpeechStyleTag {
    switch (emotion) {
      case 'curious':
        return { emotion: 'steady', urgency: 'medium', warmth: 'warm' };
      case 'focused':
        return { emotion: 'serious', urgency: 'medium', warmth: 'neutral' };
      case 'alert':
        return { emotion: 'excited', urgency: 'high', warmth: 'neutral' };
      case 'empathetic':
        return { emotion: 'soft', urgency: 'low', warmth: 'warm' };
      default:
        return { emotion: 'steady', urgency: 'medium', warmth: 'warm' };
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE - Lazy initialization on first use
// In browser environment, we delay creation until browser APIs are available
// ============================================================================

let speechInstance: LexaraSpeech | null = null;

export function getLexaraSpeech(): LexaraSpeech {
  // Lazy initialization to ensure browser APIs are available
  // Module-level initialization would fail in SSR environments
  if (!speechInstance) {
    speechInstance = new LexaraSpeech();
  }
  return speechInstance;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick speak function using default settings
 */
export async function lexaraSpeak(
  text: string, 
  options?: Partial<LexaraSpeechOptions>
): Promise<LexaraSpeechResult> {
  const speech = getLexaraSpeech();
  return speech.speak({ text, ...options });
}

/**
 * Stop LEXARA from speaking
 */
export function lexaraStop(): void {
  getLexaraSpeech().stop();
}
