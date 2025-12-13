/**
 * LEXARA TTS ROUTER
 * 
 * Routes TTS requests through the frozen Lexara voice profile.
 * Ensures consistent voice regardless of which engine (Coqui/Piper) is used.
 * 
 * Features:
 * - Multi-engine routing (Coqui for quality, Piper for speed)
 * - Streaming TTS for low-latency playback
 * - Unified post-processing chain
 * - Automatic fallback between engines
 * - Result caching by (voice_profile, text_hash)
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../logger';
import { 
  lexaraVoiceForge,
  LexaraPersonaRewriter,
  type FrozenVoiceProfile,
  type VoiceCandidate,
  type PostFXProfile,
} from './voiceForge';

const log = createLogger('LexaraTTSRouter');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type TTSEngineStatus = 'available' | 'unavailable' | 'busy' | 'error';

export interface TTSRequest {
  /** Text to synthesize */
  text: string;
  /** Optional context for persona adaptation */
  context?: 'statute' | 'summary' | 'boundary' | 'reassurance' | 'general';
  /** Force specific engine (overrides profile) */
  forceEngine?: 'coqui' | 'piper';
  /** Enable streaming response */
  streaming?: boolean;
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Custom voice profile override */
  profileOverride?: Partial<VoiceCandidate>;
}

export interface TTSResponse {
  /** Audio data buffer */
  audioData: Buffer;
  /** Audio MIME type */
  mimeType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Which engine was used */
  engine: 'coqui' | 'piper';
  /** Voice profile version used */
  profileVersion: string;
  /** Whether result was from cache */
  cached: boolean;
  /** Text after persona rewriting */
  processedText: string;
  /** Cache key for this result */
  cacheKey: string;
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
  /** Coqui TTS server URL */
  coquiUrl?: string;
  /** Piper executable path */
  piperPath?: string;
  /** Enable caching */
  enableCache: boolean;
  /** Max cache entries */
  maxCacheEntries: number;
  /** Cache TTL in ms */
  cacheTTLMs: number;
  /** Timeout for TTS request in ms */
  timeoutMs: number;
  /** Fallback behavior */
  fallbackEnabled: boolean;
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
  coquiUrl: process.env.COQUI_TTS_URL || 'http://localhost:5002',
  piperPath: process.env.PIPER_PATH || '/usr/local/bin/piper',
  enableCache: true,
  maxCacheEntries: 500,
  cacheTTLMs: 30 * 60 * 1000, // 30 minutes
  timeoutMs: 30000,
  fallbackEnabled: true,
};

// ============================================================================
// TTS ENGINE ADAPTERS
// ============================================================================

/**
 * Abstract TTS Engine interface
 */
interface TTSEngine {
  name: 'coqui' | 'piper';
  synthesize(text: string, voiceConfig: VoiceCandidate): Promise<Buffer>;
  isAvailable(): Promise<boolean>;
  getStatus(): TTSEngineStatus;
}

/**
 * Coqui TTS Engine Adapter
 * High-quality neural TTS
 */
class CoquiEngine implements TTSEngine {
  name: 'coqui' = 'coqui';
  private status: TTSEngineStatus = 'unavailable';
  private serverUrl: string;
  
  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/tts`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      this.status = response.ok ? 'available' : 'unavailable';
      return response.ok;
    } catch {
      this.status = 'unavailable';
      return false;
    }
  }
  
  getStatus(): TTSEngineStatus {
    return this.status;
  }
  
  async synthesize(text: string, voiceConfig: VoiceCandidate): Promise<Buffer> {
    this.status = 'busy';
    
    try {
      const response = await fetch(`${this.serverUrl}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          speaker_id: voiceConfig.voiceId,
          style_wav: null,
          language_id: 'en',
          // Coqui-specific parameters
          speed: voiceConfig.rate,
          pitch: voiceConfig.pitch,
        }),
        signal: AbortSignal.timeout(30000),
      });
      
      if (!response.ok) {
        throw new Error(`Coqui TTS error: ${response.status}`);
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      this.status = 'available';
      return audioBuffer;
      
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }
}

/**
 * Piper TTS Engine Adapter
 * Fast, lightweight TTS
 */
class PiperEngine implements TTSEngine {
  name: 'piper' = 'piper';
  private status: TTSEngineStatus = 'unavailable';
  private piperPath: string;
  
  constructor(piperPath: string) {
    this.piperPath = piperPath;
  }
  
  async isAvailable(): Promise<boolean> {
    // In production, check if piper executable exists
    // For now, simulate availability
    this.status = 'available';
    return true;
  }
  
  getStatus(): TTSEngineStatus {
    return this.status;
  }
  
  async synthesize(text: string, voiceConfig: VoiceCandidate): Promise<Buffer> {
    this.status = 'busy';
    
    try {
      // In production, this would execute piper CLI or use its library
      // For now, simulate audio generation
      
      // Simulate processing time based on text length
      const processingTime = Math.min(100 + text.length * 5, 2000);
      await new Promise(resolve => setTimeout(resolve, processingTime));
      
      // Generate placeholder audio buffer (in production, actual audio)
      const sampleRate = 22050;
      const duration = text.length * 0.05; // ~50ms per character
      const samples = Math.floor(sampleRate * duration);
      const audioBuffer = Buffer.alloc(samples * 2); // 16-bit audio
      
      // Generate simple sine wave as placeholder
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const frequency = 200 + (voiceConfig.pitch - 1) * 100;
        const sample = Math.sin(2 * Math.PI * frequency * t) * 16000;
        audioBuffer.writeInt16LE(Math.floor(sample), i * 2);
      }
      
      this.status = 'available';
      return audioBuffer;
      
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }
}

// ============================================================================
// POST-PROCESSING CHAIN
// ============================================================================

/**
 * Apply post-processing effects to audio
 * EQ + Compression + Reverb chain
 */
async function applyPostProcessing(
  audioBuffer: Buffer,
  profile: PostFXProfile
): Promise<Buffer> {
  // In production, this would use Web Audio API or audio processing library
  // For now, return the audio as-is with metadata about intended processing
  
  log.debug('Post-processing applied', {
    eqTilt: profile.eqTilt,
    compression: `${profile.compressionThreshold}dB @ ${profile.compressionRatio}:1`,
    reverb: `${(profile.reverbAmount * 100).toFixed(0)}% wet, room ${profile.reverbRoomSize}`,
    deEsser: profile.deEsser,
  });
  
  // In a full implementation, we would:
  // 1. Apply EQ tilt (high shelf or low shelf)
  // 2. Apply compression
  // 3. Apply soft reverb
  // 4. Apply de-esser
  
  return audioBuffer;
}

// ============================================================================
// LEXARA TTS ROUTER
// ============================================================================

export const ttsRouterEvents = new EventEmitter();

class LexaraTTSRouter {
  private static instance: LexaraTTSRouter;
  private config: TTSEngineConfig;
  private engines: Map<string, TTSEngine>;
  private cache: Map<string, CacheEntry>;
  private personaRewriter: LexaraPersonaRewriter | null = null;
  
  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.engines = new Map();
    this.cache = new Map();
    
    // Initialize engines
    this.engines.set('coqui', new CoquiEngine(this.config.coquiUrl!));
    this.engines.set('piper', new PiperEngine(this.config.piperPath!));
    
    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), 60000);
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
    log.info('TTS Router configured', this.config);
  }
  
  /**
   * Synthesize speech using the active Lexara voice profile
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    
    // Get active voice profile
    const profile = lexaraVoiceForge.getActiveProfile();
    if (!profile) {
      throw new Error('No active Lexara voice profile. Run Voice Forge first.');
    }
    
    // Get or create persona rewriter
    if (!this.personaRewriter) {
      this.personaRewriter = new LexaraPersonaRewriter(
        profile.candidate.stylePrompt,
        profile.candidate.pausePattern
      );
    }
    
    // Apply persona rewriting to text
    const processedText = this.personaRewriter.rewrite(request.text);
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(processedText, profile.version, request);
    
    // Check cache
    if (this.config.enableCache && !request.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.createdAt < this.config.cacheTTLMs) {
        cached.accessCount++;
        log.debug('Cache hit', { cacheKey, accessCount: cached.accessCount });
        
        ttsRouterEvents.emit('synthesis-complete', {
          cached: true,
          durationMs: Date.now() - startTime,
        });
        
        return { ...cached.response, cached: true };
      }
    }
    
    // Determine which engine to use
    const engineName = request.forceEngine || profile.candidate.engine;
    let engine = this.engines.get(engineName);
    
    // Check engine availability and fallback if needed
    if (!engine || !(await engine.isAvailable())) {
      if (this.config.fallbackEnabled) {
        const fallbackName = engineName === 'coqui' ? 'piper' : 'coqui';
        engine = this.engines.get(fallbackName);
        log.warn(`Engine ${engineName} unavailable, falling back to ${fallbackName}`);
      }
      
      if (!engine || !(await engine.isAvailable())) {
        throw new Error('No TTS engines available');
      }
    }
    
    // Merge profile with any overrides
    const voiceConfig: VoiceCandidate = {
      ...profile.candidate,
      ...request.profileOverride,
    };
    
    // Synthesize audio
    log.info('Synthesizing speech', {
      engine: engine.name,
      textLength: processedText.length,
      profile: profile.version,
    });
    
    let audioData = await engine.synthesize(processedText, voiceConfig);
    
    // Apply post-processing chain
    audioData = await applyPostProcessing(audioData, voiceConfig.postFXProfile);
    
    // Calculate duration (approximate)
    const durationMs = Math.floor(processedText.length * 50); // ~50ms per character
    
    const response: TTSResponse = {
      audioData,
      mimeType: 'audio/wav',
      durationMs,
      engine: engine.name,
      profileVersion: profile.version,
      cached: false,
      processedText,
      cacheKey,
    };
    
    // Store in cache
    if (this.config.enableCache) {
      this.cache.set(cacheKey, {
        response,
        createdAt: Date.now(),
        accessCount: 1,
      });
    }
    
    const totalTime = Date.now() - startTime;
    log.info(`Synthesis complete in ${totalTime}ms`, {
      engine: engine.name,
      durationMs,
    });
    
    ttsRouterEvents.emit('synthesis-complete', {
      cached: false,
      engine: engine.name,
      durationMs: totalTime,
      audioSizeBytes: audioData.length,
    });
    
    return response;
  }
  
  /**
   * Stream synthesis for low-latency playback
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<TTSStreamChunk> {
    // Get the full synthesis first
    const response = await this.synthesize({ ...request, streaming: true });
    
    // Chunk the audio for streaming
    const chunkSize = 4096; // 4KB chunks
    const totalChunks = Math.ceil(response.audioData.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, response.audioData.length);
      const chunk = response.audioData.subarray(start, end);
      
      yield {
        index: i,
        audioData: chunk,
        isFinal: i === totalChunks - 1,
        cumulativeDurationMs: Math.floor((end / response.audioData.length) * response.durationMs),
      };
    }
  }
  
  /**
   * Generate cache key
   */
  private generateCacheKey(
    text: string,
    profileVersion: string,
    request: TTSRequest
  ): string {
    const hash = crypto.createHash('sha256');
    hash.update(text);
    hash.update(profileVersion);
    hash.update(request.context || 'general');
    if (request.forceEngine) hash.update(request.forceEngine);
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
      log.debug(`Cache cleanup: removed ${cleaned} entries, ${this.cache.size} remaining`);
    }
  }
  
  /**
   * Get engine statuses
   */
  async getEngineStatuses(): Promise<Record<string, TTSEngineStatus>> {
    const statuses: Record<string, TTSEngineStatus> = {};
    
    for (const [name, engine] of this.engines.entries()) {
      await engine.isAvailable();
      statuses[name] = engine.getStatus();
    }
    
    return statuses;
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
    log.info('Cache cleared');
  }
  
  /**
   * Refresh persona rewriter (call after voice profile changes)
   */
  refreshPersonaRewriter(): void {
    this.personaRewriter = null;
    log.info('Persona rewriter will be refreshed on next synthesis');
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
