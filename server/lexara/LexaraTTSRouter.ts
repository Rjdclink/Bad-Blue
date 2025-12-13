/**
 * LEXARA TTS ROUTER
 * 
 * Routes TTS requests through ElevenLabs for Lexara voice synthesis.
 * This is the ONLY TTS provider - no fallbacks to other services.
 * 
 * Features:
 * - ElevenLabs-only voice synthesis
 * - Streaming TTS for low-latency playback
 * - Result caching by (voice_id, text_hash)
 * - Comprehensive logging for debugging
 * 
 * REQUIREMENTS:
 * - ELEVENLABS_API_KEY environment variable (required)
 * - ELEVENLABS_VOICE_ID environment variable (required)
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../logger';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const log = createLogger('LexaraTTSRouter');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Average speaking rate in words per minute (used for duration estimation) */
const AVERAGE_SPEAKING_RATE_WPM = 150;

/** ElevenLabs style parameter valid range */
const STYLE_MIN = 0.0;
const STYLE_MAX = 1.0;

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

/**
 * Validate that required ElevenLabs environment variables are set
 * Throws a clear error if missing
 */
function validateElevenLabsEnv(): { apiKey: string; voiceId: string } {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'ELEVENLABS_API_KEY environment variable is not set. ' +
      'Please set ELEVENLABS_API_KEY to your ElevenLabs API key. ' +
      'Get your API key from: https://elevenlabs.io/app/settings/api-keys'
    );
  }
  
  if (!voiceId || voiceId.trim() === '') {
    throw new Error(
      'ELEVENLABS_VOICE_ID environment variable is not set. ' +
      'Please set ELEVENLABS_VOICE_ID to your desired voice ID. ' +
      'Get voice IDs from: https://elevenlabs.io/app/voice-library'
    );
  }
  
  return { apiKey: apiKey.trim(), voiceId: voiceId.trim() };
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type TTSEngineStatus = 'available' | 'unavailable' | 'busy' | 'error';

export interface TTSRequest {
  /** Text to synthesize */
  text: string;
  /** Optional context for persona adaptation */
  context?: 'statute' | 'summary' | 'boundary' | 'reassurance' | 'general';
  /** Enable streaming response */
  streaming?: boolean;
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Voice stability (0.0-1.0) */
  stability?: number;
  /** Voice similarity boost (0.0-1.0) */
  similarityBoost?: number;
  /** Voice style (0.0-1.0) - for v2 models */
  style?: number;
}

export interface TTSResponse {
  /** Audio data buffer */
  audioData: Buffer;
  /** Audio MIME type */
  mimeType: string;
  /** Duration in milliseconds (estimated) */
  durationMs: number;
  /** Provider used */
  provider: 'elevenlabs';
  /** Voice ID used */
  voiceId: string;
  /** Whether result was from cache */
  cached: boolean;
  /** Original text */
  text: string;
  /** Cache key for this result */
  cacheKey: string;
  /** Audio byte length */
  audioByteLength: number;
}

export interface TTSStreamChunk {
  /** Chunk index */
  index: number;
  /** Audio chunk data */
  audioData: Buffer;
  /** Is this the final chunk */
  isFinal: boolean;
  /** Cumulative duration so far */
  cumulativeDurationMs: number;
}

export interface TTSEngineConfig {
  /** Enable caching */
  enableCache: boolean;
  /** Max cache entries */
  maxCacheEntries: number;
  /** Cache TTL in ms */
  cacheTTLMs: number;
  /** Timeout for TTS request in ms */
  timeoutMs: number;
  /** ElevenLabs model ID */
  modelId?: string;
}

interface CacheEntry {
  response: TTSResponse;
  createdAt: number;
  accessCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: TTSEngineConfig = {
  enableCache: true,
  maxCacheEntries: 500,
  cacheTTLMs: 30 * 60 * 1000, // 30 minutes
  timeoutMs: 60000,
  modelId: 'eleven_multilingual_v2', // High quality model
};

// ============================================================================
// ELEVENLABS TTS ROUTER
// ============================================================================

export const ttsRouterEvents = new EventEmitter();

class LexaraTTSRouter {
  private static instance: LexaraTTSRouter;
  private config: TTSEngineConfig;
  private cache: Map<string, CacheEntry>;
  private client: ElevenLabsClient | null = null;
  private voiceId: string = '';
  private status: TTSEngineStatus = 'unavailable';
  private lastError: string | undefined;
  
  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.cache = new Map();
    
    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), 60000);
    
    // Try to initialize on construction
    this.initializeClient();
  }
  
  /**
   * Initialize the ElevenLabs client
   */
  private initializeClient(): void {
    try {
      const { apiKey, voiceId } = validateElevenLabsEnv();
      this.voiceId = voiceId;
      this.client = new ElevenLabsClient({ apiKey });
      this.status = 'available';
      
      log.info('[LexaraTTSRouter] ElevenLabs client initialized', {
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        modelId: this.config.modelId,
      });
    } catch (error) {
      this.status = 'unavailable';
      this.lastError = (error as Error).message;
      log.warn('[LexaraTTSRouter] ElevenLabs not configured', { error: this.lastError });
    }
  }
  
  static getInstance(): LexaraTTSRouter {
    if (!LexaraTTSRouter.instance) {
      LexaraTTSRouter.instance = new LexaraTTSRouter();
    }
    return LexaraTTSRouter.instance;
  }
  
  /**
   * Configure the TTS router
   */
  configure(config: Partial<TTSEngineConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('[LexaraTTSRouter] Configuration updated', this.config);
  }
  
  /**
   * Synthesize speech using ElevenLabs
   * This is the ONLY TTS method - no fallbacks
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    
    // Validate environment and client
    if (!this.client) {
      // Try to re-initialize in case env vars were set after startup
      this.initializeClient();
      
      if (!this.client) {
        throw new Error(
          'ElevenLabs TTS is not available. ' + 
          (this.lastError || 'Please set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.')
        );
      }
    }
    
    // Validate text input
    if (!request.text || request.text.trim() === '') {
      throw new Error('Text to synthesize cannot be empty');
    }
    
    const text = request.text.trim();
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(text, this.voiceId, request);
    
    // Check cache
    if (this.config.enableCache && !request.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt < this.config.cacheTTLMs) {
        cached.accessCount++;
        
        log.info('[LexaraTTSRouter] Cache hit', {
          provider: 'elevenlabs',
          voiceId: this.voiceId,
          cacheKey,
          accessCount: cached.accessCount,
          audioByteLength: cached.response.audioByteLength,
        });
        
        ttsRouterEvents.emit('synthesis-complete', {
          cached: true,
          durationMs: Date.now() - startTime,
          provider: 'elevenlabs',
          voiceId: this.voiceId,
        });
        
        return { ...cached.response, cached: true };
      }
    }
    
    // Log synthesis start
    log.info('[LexaraTTSRouter] Starting ElevenLabs synthesis', {
      provider: 'elevenlabs',
      voiceId: this.voiceId,
      modelId: this.config.modelId,
      textLength: text.length,
      context: request.context || 'general',
    });
    
    this.status = 'busy';
    
    try {
      // Validate and clamp style parameter to ElevenLabs API range
      const clampedStyle = Math.max(STYLE_MIN, Math.min(STYLE_MAX, request.style ?? 0.0));
      
      // Call ElevenLabs API with voice settings
      const voiceSettings = {
        stability: request.stability ?? 0.5,
        similarityBoost: request.similarityBoost ?? 0.75,
        style: clampedStyle,
        useSpeakerBoost: true,
      };
      
      // Generate audio using ElevenLabs
      const audioResponse = await this.client.textToSpeech.convert(this.voiceId, {
        text: text,
        modelId: this.config.modelId || 'eleven_multilingual_v2',
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
      
      // Validate we got audio data
      if (audioData.length === 0) {
        throw new Error('ElevenLabs returned empty audio data');
      }
      
      // Estimate duration based on text length and average speaking rate
      const wordCount = text.split(/\s+/).length;
      const estimatedDurationMs = Math.round((wordCount / AVERAGE_SPEAKING_RATE_WPM) * 60 * 1000);
      
      // Log success
      log.info('[LexaraTTSRouter] ElevenLabs synthesis complete', {
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        status: 'success',
        audioByteLength: audioData.length,
        latencyMs,
        estimatedDurationMs,
        textLength: text.length,
      });
      
      const response: TTSResponse = {
        audioData,
        mimeType: 'audio/mpeg',
        durationMs: estimatedDurationMs,
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        cached: false,
        text,
        cacheKey,
        audioByteLength: audioData.length,
      };
      
      // Store in cache
      if (this.config.enableCache) {
        this.cache.set(cacheKey, {
          response,
          createdAt: Date.now(),
          accessCount: 1,
        });
      }
      
      this.status = 'available';
      
      ttsRouterEvents.emit('synthesis-complete', {
        cached: false,
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        durationMs: latencyMs,
        audioSizeBytes: audioData.length,
      });
      
      return response;
      
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.status = 'error';
      this.lastError = (error as Error).message;
      
      // Log detailed error for debugging
      log.error('[LexaraTTSRouter] ElevenLabs synthesis failed', {
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        status: 'error',
        error: this.lastError,
        latencyMs,
        textLength: text.length,
      });
      
      // Throw with clear error message
      throw new Error(
        `ElevenLabs TTS synthesis failed: ${this.lastError}. ` +
        'Please check your ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.'
      );
    }
  }
  
  /**
   * Stream synthesis for low-latency playback
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<TTSStreamChunk> {
    // Validate environment and client
    if (!this.client) {
      this.initializeClient();
      if (!this.client) {
        throw new Error(
          'ElevenLabs TTS is not available. ' + 
          (this.lastError || 'Please set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.')
        );
      }
    }
    
    const text = request.text.trim();
    if (!text) {
      throw new Error('Text to synthesize cannot be empty');
    }
    
    log.info('[LexaraTTSRouter] Starting ElevenLabs streaming synthesis', {
      provider: 'elevenlabs',
      voiceId: this.voiceId,
      textLength: text.length,
    });
    
    // Validate and clamp style parameter to ElevenLabs API range
    const clampedStyle = Math.max(STYLE_MIN, Math.min(STYLE_MAX, request.style ?? 0.0));
    
    const voiceSettings = {
      stability: request.stability ?? 0.5,
      similarityBoost: request.similarityBoost ?? 0.75,
      style: clampedStyle,
      useSpeakerBoost: true,
    };
    
    try {
      // Use streaming API
      const audioStream = await this.client.textToSpeech.stream(this.voiceId, {
        text: text,
        modelId: this.config.modelId || 'eleven_multilingual_v2',
        voiceSettings: voiceSettings,
      });
      
      let index = 0;
      let totalBytes = 0;
      const wordCount = text.split(/\s+/).length;
      const estimatedTotalDurationMs = Math.round((wordCount / AVERAGE_SPEAKING_RATE_WPM) * 60 * 1000);
      
      // Read from the stream
      const reader = audioStream.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        if (value) {
          const chunkBuffer = Buffer.from(value);
          totalBytes += chunkBuffer.length;
          
          yield {
            index,
            audioData: chunkBuffer,
            isFinal: false, // Will be updated by consumer checking stream end
            cumulativeDurationMs: Math.floor((totalBytes / (totalBytes + 1000)) * estimatedTotalDurationMs),
          };
          
          index++;
        }
      }
      
      log.info('[LexaraTTSRouter] ElevenLabs streaming complete', {
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        totalChunks: index,
        totalBytes,
      });
      
    } catch (error) {
      log.error('[LexaraTTSRouter] ElevenLabs streaming failed', {
        provider: 'elevenlabs',
        voiceId: this.voiceId,
        error: (error as Error).message,
      });
      throw error;
    }
  }
  
  /**
   * Generate cache key
   */
  private generateCacheKey(
    text: string,
    voiceId: string,
    request: TTSRequest
  ): string {
    const hash = crypto.createHash('sha256');
    hash.update(text);
    hash.update(voiceId);
    hash.update(request.context || 'general');
    hash.update(String(request.stability ?? 0.5));
    hash.update(String(request.similarityBoost ?? 0.75));
    return hash.digest('hex').substring(0, 16);
  }
  
  /**
   * Cleanup expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.config.cacheTTLMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    // Also enforce max entries
    if (this.cache.size > this.config.maxCacheEntries) {
      // Remove least accessed entries
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].accessCount - b[1].accessCount);
      
      const toRemove = entries.slice(0, this.cache.size - this.config.maxCacheEntries);
      for (const [key] of toRemove) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      log.debug(`[LexaraTTSRouter] Cache cleanup: removed ${cleaned} entries, ${this.cache.size} remaining`);
    }
  }
  
  /**
   * Get engine status
   */
  async getEngineStatus(): Promise<TTSEngineStatus> {
    // Re-check availability
    if (!this.client) {
      try {
        this.initializeClient();
      } catch {
        return 'unavailable';
      }
    }
    return this.status;
  }
  
  /**
   * Get engine statuses (for compatibility with existing code)
   */
  async getEngineStatuses(): Promise<Record<string, TTSEngineStatus>> {
    const status = await this.getEngineStatus();
    return {
      elevenlabs: status,
    };
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number; totalAccesses: number } {
    let totalAccesses = 0;
    for (const entry of this.cache.values()) {
      totalAccesses += entry.accessCount;
    }
    
    return {
      size: this.cache.size,
      hitRate: this.cache.size > 0 ? totalAccesses / this.cache.size : 0,
      totalAccesses,
    };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    log.info('[LexaraTTSRouter] Cache cleared');
  }
  
  /**
   * Get voice ID
   */
  getVoiceId(): string {
    return this.voiceId;
  }
  
  /**
   * Check if the router is available
   */
  isAvailable(): boolean {
    return this.client !== null && this.status !== 'unavailable';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const lexaraTTSRouter = LexaraTTSRouter.getInstance();

export async function synthesizeLexaraSpeech(request: TTSRequest): Promise<TTSResponse> {
  return lexaraTTSRouter.synthesize(request);
}

export function synthesizeLexaraSpeechStream(request: TTSRequest): AsyncGenerator<TTSStreamChunk> {
  return lexaraTTSRouter.synthesizeStream(request);
}

export function configureTTSRouter(config: Partial<TTSEngineConfig>): void {
  lexaraTTSRouter.configure(config);
}

export async function getTTSEngineStatuses(): Promise<Record<string, TTSEngineStatus>> {
  return lexaraTTSRouter.getEngineStatuses();
}

export function getTTSCacheStats(): { size: number; hitRate: number; totalAccesses: number } {
  return lexaraTTSRouter.getCacheStats();
}

export default lexaraTTSRouter;
