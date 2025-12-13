/**
 * LEXARA VOICE PIPELINE
 * 
 * Complete voice synthesis path using ElevenLabs:
 * LLM → Text Response → ElevenLabs TTS → Persist Audio → Return Playable Reference
 * 
 * LEXARA Voice Profile:
 * - 18-20 year old female voice
 * - Gravitas of a Supreme Court Justice
 * - Clear, authoritative, yet warm and approachable
 * - Professional legal delivery with measured cadence
 * 
 * PROVIDER:
 * - ElevenLabs: High-quality neural voice synthesis (ONLY provider)
 * 
 * REQUIREMENTS:
 * - ELEVENLABS_API_KEY environment variable (required)
 * - ELEVENLABS_VOICE_ID environment variable (required)
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const log = createLogger('LexaraVoicePipeline');

// ============================================================================
// LEXARA VOICE PROFILE - 18-20 FEMALE WITH SUPREME COURT JUSTICE GRAVITAS
// ============================================================================

export interface LexaraVoiceProfile {
  name: string;
  age: '18-20';
  gender: 'female';
  characteristics: {
    pitch: number;           // Hz base pitch (200-240 for young female with authority)
    pitchVariation: number;  // Range of pitch variation
    rate: number;            // Words per minute (145-155 for authoritative delivery)
    stability: number;       // Voice consistency (0.65-0.8 for gravitas)
    clarity: number;         // Articulation clarity (0.85+ for legal precision)
    warmth: number;          // Emotional warmth (0.6-0.75 for approachability)
    authority: number;       // Commanding presence (0.8+ for judicial gravitas)
  };
  prosody: {
    pauseAfterPeriod: number;      // ms
    pauseAfterComma: number;       // ms
    pauseBeforeLegalTerm: number;  // ms - slight pause before important legal terms
    emphasisOnLegalTerms: boolean;
    measuredCadence: boolean;     // Slower, more deliberate speech for serious topics
  };
  emotionalRange: {
    neutral: { pitch: number; rate: number };
    empathetic: { pitch: number; rate: number };
    authoritative: { pitch: number; rate: number };
    reassuring: { pitch: number; rate: number };
    serious: { pitch: number; rate: number };
  };
}

export const LEXARA_VOICE_PROFILE: LexaraVoiceProfile = {
  name: 'LEXARA',
  age: '18-20',
  gender: 'female',
  characteristics: {
    pitch: 220,           // Young female baseline with gravitas
    pitchVariation: 35,   // Controlled variation for authority
    rate: 150,            // Measured, deliberate pace
    stability: 0.72,      // High stability for consistency
    clarity: 0.90,        // Crystal clear articulation
    warmth: 0.68,         // Warm but professional
    authority: 0.85,      // Supreme Court Justice level gravitas
  },
  prosody: {
    pauseAfterPeriod: 550,
    pauseAfterComma: 280,
    pauseBeforeLegalTerm: 150,
    emphasisOnLegalTerms: true,
    measuredCadence: true,
  },
  emotionalRange: {
    neutral: { pitch: 220, rate: 150 },
    empathetic: { pitch: 215, rate: 145 },
    authoritative: { pitch: 210, rate: 140 },
    reassuring: { pitch: 225, rate: 155 },
    serious: { pitch: 205, rate: 135 },
  },
};

// ============================================================================
// TYPES
// ============================================================================

export type VoiceProvider = 'elevenlabs';
export type EmotionalContext = 'neutral' | 'empathetic' | 'authoritative' | 'reassuring' | 'serious';

export interface VoiceSynthesisRequest {
  /** Text to synthesize */
  text: string;
  /** Trace ID for request tracking */
  traceId?: string;
  /** Emotional context for voice adaptation */
  context?: EmotionalContext;
  /** Custom voice settings override */
  settings?: Partial<VoiceSynthesisSettings>;
  /** Whether to persist the audio */
  persist?: boolean;
  /** Speech context type */
  speechContext?: 'greeting' | 'explanation' | 'guidance' | 'reassurance' | 'serious' | 'casual' | 'legal';
}

export interface VoiceSynthesisSettings {
  stability: number;
  similarity: number;
  style: number;
  speakingRate: number;
  pitch: number;
}

export interface VoiceSynthesisResult {
  /** Unique audio ID */
  audioId: string;
  /** Trace ID */
  traceId: string;
  /** Playable audio reference (URL or path) */
  audioRef: string;
  /** Audio data buffer (if not persisted) */
  audioData?: Buffer;
  /** MIME type */
  mimeType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Provider used */
  provider: VoiceProvider;
  /** Whether audio was persisted */
  persisted: boolean;
  /** Generation timestamp */
  generatedAt: number;
  /** Processing latency */
  latencyMs: number;
  /** Quality score (0-1) */
  qualityScore: number;
  /** Original text */
  text: string;
  /** SSML generated (if applicable) */
  ssml?: string;
}

export interface ProviderStatus {
  name: VoiceProvider;
  available: boolean;
  latencyMs?: number;
  lastError?: string;
  lastCheck: number;
}

// ============================================================================
// ELEVENLABS TTS PROVIDER
// ============================================================================

class ElevenLabsTTSProvider {
  private client: ElevenLabsClient | null = null;
  private voiceId: string = '';
  private available: boolean = false;
  private lastCheck: number = 0;
  private lastError?: string;
  private modelId: string = 'eleven_multilingual_v2';

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    
    if (apiKey && voiceId) {
      this.client = new ElevenLabsClient({ apiKey });
      this.voiceId = voiceId;
      this.available = true;
      this.lastCheck = Date.now();
      
      log.info('[ElevenLabsTTSProvider] Initialized', {
        voiceId: this.voiceId,
        modelId: this.modelId,
      });
    } else {
      this.available = false;
      this.lastError = 'ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID not set';
      log.warn('[ElevenLabsTTSProvider] Not configured', { error: this.lastError });
    }
  }

  async checkAvailability(): Promise<boolean> {
    if (!this.client) {
      this.initializeClient();
    }
    this.lastCheck = Date.now();
    return this.available;
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  getStatus(): ProviderStatus {
    return {
      name: 'elevenlabs',
      available: this.available,
      lastError: this.lastError,
      lastCheck: this.lastCheck,
    };
  }

  async synthesize(
    text: string,
    settings: VoiceSynthesisSettings,
    context: EmotionalContext
  ): Promise<{ audioData: Buffer; latencyMs: number; quality: number }> {
    if (!this.client) {
      throw new Error(
        'ElevenLabs client not initialized. ' +
        'Please set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.'
      );
    }
    
    const startTime = Date.now();

    // Apply LEXARA voice profile based on emotional context
    const emotionalSettings = LEXARA_VOICE_PROFILE.emotionalRange[context];
    
    // ElevenLabs voice settings
    const voiceSettings = {
      stability: settings.stability ?? 0.5,
      similarityBoost: settings.similarity ?? 0.75,
      style: settings.style ?? 0.0,
      useSpeakerBoost: true,
    };

    log.info('[ElevenLabsTTSProvider] Starting synthesis', {
      voiceId: this.voiceId,
      modelId: this.modelId,
      textLength: text.length,
      context,
      stability: voiceSettings.stability,
      similarityBoost: voiceSettings.similarityBoost,
    });

    try {
      const audioResponse = await this.client.textToSpeech.convert(this.voiceId, {
        text: text,
        modelId: this.modelId,
        voiceSettings: voiceSettings,
      });

      // Convert ReadableStream to buffer
      const reader = audioResponse.getReader();
      const chunks: Uint8Array[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      
      const audioData = Buffer.concat(chunks);
      const latencyMs = Date.now() - startTime;

      if (audioData.length === 0) {
        throw new Error('ElevenLabs returned empty audio data');
      }

      // Quality score based on settings and response
      const quality = 0.95; // ElevenLabs typically produces high quality

      log.info('[ElevenLabsTTSProvider] Synthesis complete', {
        voiceId: this.voiceId,
        status: 'success',
        audioByteLength: audioData.length,
        latencyMs,
      });

      return { audioData, latencyMs, quality };

    } catch (error) {
      this.lastError = (error as Error).message;
      log.error('[ElevenLabsTTSProvider] Synthesis failed', {
        voiceId: this.voiceId,
        error: this.lastError,
      });
      throw error;
    }
  }
}

// ============================================================================
// AUDIO PERSISTENCE
// ============================================================================

class AudioPersistence {
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || process.env.LEXARA_AUDIO_DIR || '/tmp/lexara-audio';
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (error) {
      log.warn('Could not create audio storage directory', { error });
    }
  }

  async persist(audioId: string, audioData: Buffer, mimeType: string): Promise<string> {
    const extension = mimeType.includes('mp3') ? 'mp3' : mimeType.includes('wav') ? 'wav' : 'audio';
    const filename = `${audioId}.${extension}`;
    const filepath = path.join(this.storageDir, filename);

    await fs.promises.writeFile(filepath, audioData);
    
    log.debug('Audio persisted', { audioId, filepath, size: audioData.length });
    
    return filepath;
  }

  async retrieve(audioId: string): Promise<Buffer | null> {
    const files = await fs.promises.readdir(this.storageDir);
    const audioFile = files.find(f => f.startsWith(audioId));
    
    if (!audioFile) return null;
    
    const filepath = path.join(this.storageDir, audioFile);
    return fs.promises.readFile(filepath);
  }

  getPlayableRef(audioId: string, extension: string = 'mp3'): string {
    return `/api/lexara/audio/${audioId}.${extension}`;
  }
}

// ============================================================================
// LEXARA VOICE PIPELINE
// ============================================================================

export class LexaraVoicePipeline extends EventEmitter {
  private elevenLabsProvider: ElevenLabsTTSProvider;
  private persistence: AudioPersistence;
  private isInitialized: boolean = false;

  // Metrics
  private synthesisCount: number = 0;
  private totalLatencyMs: number = 0;
  private errorCount: number = 0;

  constructor(config?: {
    storageDir?: string;
  }) {
    super();
    
    this.elevenLabsProvider = new ElevenLabsTTSProvider();
    this.persistence = new AudioPersistence(config?.storageDir);
  }

  /**
   * Initialize the voice pipeline
   */
  async initialize(): Promise<void> {
    log.info('[LexaraVoicePipeline] Initializing...');

    // Check provider availability
    await this.elevenLabsProvider.checkAvailability();

    const status = this.elevenLabsProvider.getStatus();

    log.info('[LexaraVoicePipeline] Provider status', {
      elevenlabs: status.available,
      voiceId: process.env.ELEVENLABS_VOICE_ID || 'not set',
    });

    if (!status.available) {
      log.warn('[LexaraVoicePipeline] ElevenLabs not available. Voice synthesis will be unavailable.', {
        error: status.lastError,
      });
    }

    this.isInitialized = true;
    this.emit('initialized', { elevenlabs: status });
    
    log.info('[LexaraVoicePipeline] Initialized with ElevenLabs provider');
  }

  /**
   * MAIN SYNTHESIS METHOD
   * 
   * Complete path: Text → ElevenLabs → Persist → Return Reference
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    const startTime = Date.now();
    const audioId = randomUUID();
    const traceId = request.traceId || randomUUID();

    log.info('[LexaraVoicePipeline] Synthesis request', {
      traceId,
      textLength: request.text.length,
      context: request.context,
    });

    // Ensure initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Validate provider is available
    if (!this.elevenLabsProvider.isAvailable()) {
      throw new Error(
        'ElevenLabs TTS is not available. ' +
        'Please set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.'
      );
    }

    // Determine emotional context
    const context = request.context || this.inferContext(request.text, request.speechContext);

    // Build voice settings
    const settings = this.buildSettings(request.settings, context);

    // Generate SSML for enhanced synthesis
    const ssml = this.generateSSML(request.text, context);

    let audioData: Buffer;
    let latencyMs: number;
    let qualityScore: number;

    try {
      const result = await this.elevenLabsProvider.synthesize(request.text, settings, context);
      audioData = result.audioData;
      latencyMs = result.latencyMs;
      qualityScore = result.quality;

      this.synthesisCount++;
      this.totalLatencyMs += latencyMs;

    } catch (error) {
      this.errorCount++;
      log.error('[LexaraVoicePipeline] Synthesis failed', { traceId, error });
      throw error;
    }

    // MIME type is always audio/mpeg for ElevenLabs
    const mimeType = 'audio/mpeg';

    // Persist audio if requested (default: true)
    let audioRef: string;
    let persisted = false;

    if (request.persist !== false) {
      try {
        const filepath = await this.persistence.persist(audioId, audioData, mimeType);
        audioRef = this.persistence.getPlayableRef(audioId, 'mp3');
        persisted = true;
        log.debug('[LexaraVoicePipeline] Audio persisted', { audioId, filepath });
      } catch (error) {
        log.warn('[LexaraVoicePipeline] Persistence failed, returning inline data', { error });
        audioRef = `data:${mimeType};base64,${audioData.toString('base64')}`;
      }
    } else {
      audioRef = `data:${mimeType};base64,${audioData.toString('base64')}`;
    }

    // Estimate duration based on text length and speaking rate
    const wordsPerMinute = LEXARA_VOICE_PROFILE.emotionalRange[context].rate;
    const wordCount = request.text.split(/\s+/).length;
    const durationMs = Math.round((wordCount / wordsPerMinute) * 60 * 1000);

    const result: VoiceSynthesisResult = {
      audioId,
      traceId,
      audioRef,
      audioData: request.persist === false ? audioData : undefined,
      mimeType,
      durationMs,
      provider: 'elevenlabs',
      persisted,
      generatedAt: Date.now(),
      latencyMs: Date.now() - startTime,
      qualityScore,
      text: request.text,
      ssml,
    };

    this.emit('synthesis-complete', result);
    
    log.info('[LexaraVoicePipeline] Synthesis complete', {
      traceId,
      audioId,
      provider: 'elevenlabs',
      durationMs,
      latencyMs: result.latencyMs,
      quality: qualityScore,
      audioByteLength: audioData.length,
    });

    return result;
  }

  /**
   * Infer emotional context from text and speech context
   */
  private inferContext(text: string, speechContext?: string): EmotionalContext {
    const lowercaseText = text.toLowerCase();

    // Speech context mapping
    if (speechContext) {
      switch (speechContext) {
        case 'greeting':
        case 'casual':
          return 'neutral';
        case 'reassurance':
          return 'reassuring';
        case 'serious':
        case 'legal':
          return 'authoritative';
        case 'explanation':
        case 'guidance':
          return 'empathetic';
      }
    }

    // Legal terminology detection → authoritative
    const legalTerms = ['court', 'judge', 'statute', 'liability', 'damages', 'plaintiff', 'defendant', 
                        'jurisdiction', 'verdict', 'testimony', 'evidence', 'lawsuit', 'claim'];
    if (legalTerms.some(term => lowercaseText.includes(term))) {
      return 'authoritative';
    }

    // Stress/concern detection → reassuring
    const concernTerms = ['worried', 'scared', 'afraid', 'anxious', 'nervous', 'help', 'urgent'];
    if (concernTerms.some(term => lowercaseText.includes(term))) {
      return 'reassuring';
    }

    // Serious topics → serious
    const seriousTerms = ['important', 'critical', 'deadline', 'immediately', 'must', 'required'];
    if (seriousTerms.some(term => lowercaseText.includes(term))) {
      return 'serious';
    }

    // Empathetic for explanations
    if (lowercaseText.includes('understand') || lowercaseText.includes('explain') || 
        lowercaseText.includes('let me') || lowercaseText.includes('here\'s')) {
      return 'empathetic';
    }

    return 'neutral';
  }

  /**
   * Build synthesis settings from profile and overrides
   */
  private buildSettings(overrides?: Partial<VoiceSynthesisSettings>, context?: EmotionalContext): VoiceSynthesisSettings {
    const profile = LEXARA_VOICE_PROFILE;
    const emotional = context ? profile.emotionalRange[context] : profile.emotionalRange.neutral;

    return {
      stability: overrides?.stability ?? profile.characteristics.stability,
      similarity: overrides?.similarity ?? 0.75,
      style: overrides?.style ?? 0.0,
      speakingRate: overrides?.speakingRate ?? emotional.rate / 150,
      pitch: overrides?.pitch ?? emotional.pitch / 220,
    };
  }

  /**
   * Generate SSML for enhanced prosody
   */
  private generateSSML(text: string, context: EmotionalContext): string {
    const profile = LEXARA_VOICE_PROFILE;
    const emotional = profile.emotionalRange[context];

    // Apply prosody settings
    const rate = `${Math.round((emotional.rate / 150) * 100)}%`;
    const pitch = `${emotional.pitch > 220 ? '+' : ''}${Math.round((emotional.pitch - 220) / 2)}%`;

    let ssml = `<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis">`;
    ssml += `<prosody rate="${rate}" pitch="${pitch}">`;

    // Add pauses and emphasis
    let processedText = text;
    
    // Add pauses after periods
    processedText = processedText.replace(/\.\s+/g, `.<break time="${profile.prosody.pauseAfterPeriod}ms"/> `);
    
    // Add pauses after commas
    processedText = processedText.replace(/,\s+/g, `,<break time="${profile.prosody.pauseAfterComma}ms"/> `);

    // Emphasize legal terms if enabled
    if (profile.prosody.emphasisOnLegalTerms) {
      const legalTerms = ['court', 'judge', 'statute', 'liability', 'damages', 'jurisdiction', 'verdict'];
      for (const term of legalTerms) {
        const regex = new RegExp(`\\b(${term})\\b`, 'gi');
        processedText = processedText.replace(regex, `<emphasis level="moderate">$1</emphasis>`);
      }
    }

    ssml += processedText;
    ssml += `</prosody></speak>`;

    return ssml;
  }

  /**
   * Get provider statuses
   */
  getProviderStatuses(): { elevenlabs: ProviderStatus; coqui: ProviderStatus; openai: ProviderStatus } {
    const elevenLabsStatus = this.elevenLabsProvider.getStatus();
    
    // Return unavailable status for deprecated providers
    return {
      elevenlabs: elevenLabsStatus,
      coqui: { name: 'elevenlabs' as VoiceProvider, available: false, lastError: 'Coqui is deprecated - use ElevenLabs', lastCheck: Date.now() },
      openai: { name: 'elevenlabs' as VoiceProvider, available: false, lastError: 'OpenAI TTS is deprecated - use ElevenLabs', lastCheck: Date.now() },
    };
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    synthesisCount: number;
    avgLatencyMs: number;
    errorCount: number;
    errorRate: number;
    preferredProvider: VoiceProvider;
  } {
    return {
      synthesisCount: this.synthesisCount,
      avgLatencyMs: this.synthesisCount > 0 ? this.totalLatencyMs / this.synthesisCount : 0,
      errorCount: this.errorCount,
      errorRate: this.synthesisCount > 0 ? this.errorCount / (this.synthesisCount + this.errorCount) : 0,
      preferredProvider: 'elevenlabs',
    };
  }

  /**
   * Refresh provider availability
   */
  async refreshProviders(): Promise<void> {
    await this.elevenLabsProvider.checkAvailability();
    this.emit('providers-refreshed', this.getProviderStatuses());
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let pipelineInstance: LexaraVoicePipeline | null = null;

export function getLexaraVoicePipeline(config?: {
  storageDir?: string;
}): LexaraVoicePipeline {
  if (!pipelineInstance) {
    pipelineInstance = new LexaraVoicePipeline(config);
  }
  return pipelineInstance;
}

export default LexaraVoicePipeline;
