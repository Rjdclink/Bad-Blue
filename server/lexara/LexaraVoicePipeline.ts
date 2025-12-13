/**
 * LEXARA VOICE PIPELINE
 * 
 * Complete voice synthesis path:
 * LLM → Text Response → Voice Path Selection (Coqui/OpenAI) → Generate Audio → Persist Audio → Return Playable Reference
 * 
 * LEXARA Voice Profile:
 * - 18-20 year old female voice
 * - Gravitas of a Supreme Court Justice
 * - Clear, authoritative, yet warm and approachable
 * - Professional legal delivery with measured cadence
 * 
 * PROVIDERS (ONLY):
 * - Coqui TTS: High-quality neural voice synthesis (primary)
 * - OpenAI TTS: Premium API-based synthesis (fallback/premium)
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

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

export type VoiceProvider = 'coqui' | 'openai';
export type EmotionalContext = 'neutral' | 'empathetic' | 'authoritative' | 'reassuring' | 'serious';

export interface VoiceSynthesisRequest {
  /** Text to synthesize */
  text: string;
  /** Trace ID for request tracking */
  traceId?: string;
  /** Emotional context for voice adaptation */
  context?: EmotionalContext;
  /** Force specific provider */
  provider?: VoiceProvider;
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
// COQUI TTS PROVIDER
// ============================================================================

class CoquiTTSProvider {
  private serverUrl: string;
  private available: boolean = false;
  private lastCheck: number = 0;
  private lastError?: string;

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || process.env.COQUI_TTS_URL || 'http://localhost:5002';
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/tts`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      this.available = response.ok;
      this.lastCheck = Date.now();
      this.lastError = undefined;
      return this.available;
    } catch (error) {
      this.available = false;
      this.lastCheck = Date.now();
      this.lastError = (error as Error).message;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getStatus(): ProviderStatus {
    return {
      name: 'coqui',
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
    const startTime = Date.now();

    // Apply LEXARA voice profile based on emotional context
    const emotionalSettings = LEXARA_VOICE_PROFILE.emotionalRange[context];
    
    // Voice model selection:
    // - 'lexara_supreme_justice' is a custom model if available
    // - Falls back to Coqui's default young female voice if custom model not found
    const speakerId = process.env.COQUI_LEXARA_VOICE_ID || 'lexara_supreme_justice';
    
    const requestBody = {
      text,
      speaker_id: speakerId,
      language_id: 'en',
      speed: settings.speakingRate * (emotionalSettings.rate / 150),
      pitch: settings.pitch + (emotionalSettings.pitch - 220) / 100,
      // Coqui-specific LEXARA parameters
      style_wav: null,
      reference_audio: null,
      emotion: context,
      // Voice characteristics
      stability: settings.stability,
      clarity: LEXARA_VOICE_PROFILE.characteristics.clarity,
      warmth: LEXARA_VOICE_PROFILE.characteristics.warmth,
    };

    try {
      const response = await fetch(`${this.serverUrl}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Coqui TTS error: ${response.status} ${response.statusText}`);
      }

      const audioData = Buffer.from(await response.arrayBuffer());
      const latencyMs = Date.now() - startTime;

      // Quality score based on settings alignment and response time
      const quality = Math.min(1, 0.85 + (settings.stability * 0.1) - (latencyMs / 30000) * 0.1);

      return { audioData, latencyMs, quality };

    } catch (error) {
      this.lastError = (error as Error).message;
      throw error;
    }
  }
}

// ============================================================================
// OPENAI TTS PROVIDER
// ============================================================================

class OpenAITTSProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.openai.com/v1/audio/speech';
  private available: boolean = false;
  private lastCheck: number = 0;
  private lastError?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
  }

  async checkAvailability(): Promise<boolean> {
    this.available = !!this.apiKey && this.apiKey.length > 20;
    this.lastCheck = Date.now();
    return this.available;
  }

  isAvailable(): boolean {
    return this.available;
  }

  getStatus(): ProviderStatus {
    return {
      name: 'openai',
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
    const startTime = Date.now();

    // Select OpenAI voice that best matches LEXARA profile
    // "nova" - Young female, professional, clear
    // "shimmer" - Alternative young female option
    const voice = 'nova'; // Best match for 18-20 female with gravitas

    // Apply emotional context to speed
    const emotionalSettings = LEXARA_VOICE_PROFILE.emotionalRange[context];
    const speed = Math.max(0.25, Math.min(4.0, settings.speakingRate * (emotionalSettings.rate / 150)));

    const requestBody = {
      model: 'tts-1-hd', // High-definition model for quality
      input: text,
      voice: voice,
      response_format: 'mp3',
      speed: speed,
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI TTS error: ${response.status} - ${errorText}`);
      }

      const audioData = Buffer.from(await response.arrayBuffer());
      const latencyMs = Date.now() - startTime;

      // OpenAI typically produces very high quality
      const quality = 0.95;

      return { audioData, latencyMs, quality };

    } catch (error) {
      this.lastError = (error as Error).message;
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
  private coquiProvider: CoquiTTSProvider;
  private openaiProvider: OpenAITTSProvider;
  private persistence: AudioPersistence;
  private preferredProvider: VoiceProvider = 'coqui';
  private isInitialized: boolean = false;

  // Metrics
  private synthesisCount: number = 0;
  private totalLatencyMs: number = 0;
  private errorCount: number = 0;

  constructor(config?: {
    coquiUrl?: string;
    openaiApiKey?: string;
    storageDir?: string;
    preferredProvider?: VoiceProvider;
  }) {
    super();
    
    this.coquiProvider = new CoquiTTSProvider(config?.coquiUrl);
    this.openaiProvider = new OpenAITTSProvider(config?.openaiApiKey);
    this.persistence = new AudioPersistence(config?.storageDir);
    
    if (config?.preferredProvider) {
      this.preferredProvider = config.preferredProvider;
    }
  }

  /**
   * Initialize the voice pipeline
   */
  async initialize(): Promise<void> {
    log.info('[LexaraVoicePipeline] Initializing...');

    // Check provider availability
    await Promise.all([
      this.coquiProvider.checkAvailability(),
      this.openaiProvider.checkAvailability(),
    ]);

    const coquiStatus = this.coquiProvider.getStatus();
    const openaiStatus = this.openaiProvider.getStatus();

    log.info('[LexaraVoicePipeline] Provider status', {
      coqui: coquiStatus.available,
      openai: openaiStatus.available,
    });

    if (!coquiStatus.available && !openaiStatus.available) {
      log.warn('[LexaraVoicePipeline] No voice providers available. Voice synthesis will be unavailable.');
    }

    // Set preferred provider based on availability
    if (!this.coquiProvider.isAvailable() && this.openaiProvider.isAvailable()) {
      this.preferredProvider = 'openai';
    }

    this.isInitialized = true;
    this.emit('initialized', { coqui: coquiStatus, openai: openaiStatus });
    
    log.info('[LexaraVoicePipeline] Initialized with preferred provider:', this.preferredProvider);
  }

  /**
   * MAIN SYNTHESIS METHOD
   * 
   * Complete path: Text → Voice Selection → Generate → Persist → Return Reference
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    const startTime = Date.now();
    const audioId = randomUUID();
    const traceId = request.traceId || randomUUID();

    log.info('[LexaraVoicePipeline] Synthesis request', {
      traceId,
      textLength: request.text.length,
      context: request.context,
      provider: request.provider,
    });

    // Ensure initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Determine emotional context
    const context = request.context || this.inferContext(request.text, request.speechContext);

    // Build voice settings
    const settings = this.buildSettings(request.settings, context);

    // Select provider
    const provider = this.selectProvider(request.provider);

    if (!provider) {
      throw new Error('No voice providers available. Please configure COQUI_TTS_URL or OPENAI_API_KEY.');
    }

    // Generate SSML for enhanced synthesis
    const ssml = this.generateSSML(request.text, context);

    let audioData: Buffer;
    let latencyMs: number;
    let qualityScore: number;
    let usedProvider: VoiceProvider;

    try {
      // Attempt synthesis with selected provider
      if (provider === 'coqui' && this.coquiProvider.isAvailable()) {
        const result = await this.coquiProvider.synthesize(request.text, settings, context);
        audioData = result.audioData;
        latencyMs = result.latencyMs;
        qualityScore = result.quality;
        usedProvider = 'coqui';
      } else if (provider === 'openai' && this.openaiProvider.isAvailable()) {
        const result = await this.openaiProvider.synthesize(request.text, settings, context);
        audioData = result.audioData;
        latencyMs = result.latencyMs;
        qualityScore = result.quality;
        usedProvider = 'openai';
      } else {
        // Fallback to any available provider
        if (this.openaiProvider.isAvailable()) {
          const result = await this.openaiProvider.synthesize(request.text, settings, context);
          audioData = result.audioData;
          latencyMs = result.latencyMs;
          qualityScore = result.quality;
          usedProvider = 'openai';
        } else if (this.coquiProvider.isAvailable()) {
          const result = await this.coquiProvider.synthesize(request.text, settings, context);
          audioData = result.audioData;
          latencyMs = result.latencyMs;
          qualityScore = result.quality;
          usedProvider = 'coqui';
        } else {
          throw new Error('No voice providers available');
        }
      }

      this.synthesisCount++;
      this.totalLatencyMs += latencyMs;

    } catch (error) {
      this.errorCount++;
      log.error('[LexaraVoicePipeline] Synthesis failed', { traceId, error });
      throw error;
    }

    // Determine MIME type
    const mimeType = usedProvider === 'openai' ? 'audio/mpeg' : 'audio/wav';

    // Persist audio if requested (default: true)
    let audioRef: string;
    let persisted = false;

    if (request.persist !== false) {
      try {
        const filepath = await this.persistence.persist(audioId, audioData, mimeType);
        audioRef = this.persistence.getPlayableRef(audioId, mimeType.includes('mp3') ? 'mp3' : 'wav');
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
      provider: usedProvider,
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
      provider: usedProvider,
      durationMs,
      latencyMs: result.latencyMs,
      quality: qualityScore,
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
   * Select best available provider
   */
  private selectProvider(requested?: VoiceProvider): VoiceProvider | null {
    if (requested) {
      if (requested === 'coqui' && this.coquiProvider.isAvailable()) return 'coqui';
      if (requested === 'openai' && this.openaiProvider.isAvailable()) return 'openai';
    }

    // Use preferred provider if available
    if (this.preferredProvider === 'coqui' && this.coquiProvider.isAvailable()) return 'coqui';
    if (this.preferredProvider === 'openai' && this.openaiProvider.isAvailable()) return 'openai';

    // Fallback to any available
    if (this.coquiProvider.isAvailable()) return 'coqui';
    if (this.openaiProvider.isAvailable()) return 'openai';

    return null;
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
  getProviderStatuses(): { coqui: ProviderStatus; openai: ProviderStatus } {
    return {
      coqui: this.coquiProvider.getStatus(),
      openai: this.openaiProvider.getStatus(),
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
      preferredProvider: this.preferredProvider,
    };
  }

  /**
   * Set preferred provider
   */
  setPreferredProvider(provider: VoiceProvider): void {
    this.preferredProvider = provider;
    log.info('[LexaraVoicePipeline] Preferred provider set to:', provider);
  }

  /**
   * Refresh provider availability
   */
  async refreshProviders(): Promise<void> {
    await Promise.all([
      this.coquiProvider.checkAvailability(),
      this.openaiProvider.checkAvailability(),
    ]);
    
    this.emit('providers-refreshed', this.getProviderStatuses());
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let pipelineInstance: LexaraVoicePipeline | null = null;

export function getLexaraVoicePipeline(config?: {
  coquiUrl?: string;
  openaiApiKey?: string;
  storageDir?: string;
  preferredProvider?: VoiceProvider;
}): LexaraVoicePipeline {
  if (!pipelineInstance) {
    pipelineInstance = new LexaraVoicePipeline(config);
  }
  return pipelineInstance;
}

export default LexaraVoicePipeline;
