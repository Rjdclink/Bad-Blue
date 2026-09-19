/**
 * Legacy-compatible LEXARA TTS facade.
 *
 * Runtime provider authority lives exclusively in LexaraTTSMesh. This module
 * preserves historical exports for callers without retaining an ElevenLabs-only
 * synthesis path.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
  getLexaraTTSReadiness,
  refreshLexaraTTSReadiness,
  synthesizeLexaraSpeechWithFailover,
  type LexaraTTSProviderId,
} from './LexaraTTSMesh';

const AVERAGE_SPEAKING_RATE_WPM = 150;

export type TTSEngineStatus = 'available' | 'unavailable' | 'busy' | 'error';

export interface TTSRequest {
  text: string;
  context?: 'statute' | 'summary' | 'boundary' | 'reassurance' | 'general';
  streaming?: boolean;
  skipCache?: boolean;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export interface TTSResponse {
  audioData: Buffer;
  mimeType: string;
  durationMs: number;
  provider: LexaraTTSProviderId;
  voiceId: string;
  cached: boolean;
  text: string;
  cacheKey: string;
  audioByteLength: number;
}

export interface TTSStreamChunk {
  index: number;
  audioData: Buffer;
  isFinal: boolean;
  cumulativeDurationMs: number;
}

export interface TTSEngineConfig {
  enableCache: boolean;
  maxCacheEntries: number;
  cacheTTLMs: number;
  timeoutMs: number;
  modelId?: string;
}

interface CacheEntry {
  response: TTSResponse;
  createdAt: number;
  accessCount: number;
}

const DEFAULT_CONFIG: TTSEngineConfig = {
  enableCache: true,
  maxCacheEntries: 200,
  cacheTTLMs: 10 * 60_000,
  timeoutMs: 20_000,
};

export const ttsRouterEvents = new EventEmitter();

function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(500, Math.round((words / AVERAGE_SPEAKING_RATE_WPM) * 60_000));
}

class LexaraTTSRouter {
  private static instance: LexaraTTSRouter;
  private config: TTSEngineConfig = { ...DEFAULT_CONFIG };
  private cache = new Map<string, CacheEntry>();
  private accesses = 0;
  private cacheHits = 0;

  static getInstance(): LexaraTTSRouter {
    if (!LexaraTTSRouter.instance) LexaraTTSRouter.instance = new LexaraTTSRouter();
    return LexaraTTSRouter.instance;
  }

  configure(config: Partial<TTSEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private cacheKey(text: string): string {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  private pruneCache(): void {
    const cutoff = Date.now() - this.config.cacheTTLMs;
    for (const [key, entry] of this.cache) {
      if (entry.createdAt < cutoff) this.cache.delete(key);
    }
    while (this.cache.size > this.config.maxCacheEntries) {
      const first = this.cache.keys().next().value;
      if (!first) break;
      this.cache.delete(first);
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const text = String(request.text || '').trim();
    if (!text) throw new Error('Text is required for LEXARA TTS');

    const cacheKey = this.cacheKey(text);
    this.accesses += 1;
    this.pruneCache();

    if (this.config.enableCache && !request.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        cached.accessCount += 1;
        this.cacheHits += 1;
        return { ...cached.response, cached: true };
      }
    }

    const result = await synthesizeLexaraSpeechWithFailover(text);
    const response: TTSResponse = {
      audioData: result.audioData,
      mimeType: result.mimeType,
      durationMs: estimateDurationMs(text),
      provider: result.provider,
      voiceId: result.voiceId || 'adaptive',
      cached: false,
      text,
      cacheKey,
      audioByteLength: result.audioData.length,
    };

    if (this.config.enableCache) {
      this.cache.set(cacheKey, { response, createdAt: Date.now(), accessCount: 1 });
      this.pruneCache();
    }

    ttsRouterEvents.emit('synthesis-complete', {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      audioByteLength: result.audioData.length,
    });
    return response;
  }

  async *synthesizeStream(request: TTSRequest): AsyncGenerator<TTSStreamChunk> {
    const response = await this.synthesize(request);
    yield {
      index: 0,
      audioData: response.audioData,
      isFinal: true,
      cumulativeDurationMs: response.durationMs,
    };
  }

  async getEngineStatuses(): Promise<Record<string, TTSEngineStatus>> {
    let readiness = getLexaraTTSReadiness();
    if (!readiness.available && readiness.configuredProviders.length) {
      readiness = await refreshLexaraTTSReadiness(false);
    }
    return Object.fromEntries(
      readiness.providers.map(provider => [
        provider.provider,
        provider.healthy
          ? 'available'
          : provider.configured
            ? provider.state === 'probing' ? 'busy' : 'error'
            : 'unavailable',
      ]),
    );
  }

  getCacheStats(): { size: number; hitRate: number; totalAccesses: number } {
    return {
      size: this.cache.size,
      hitRate: this.accesses ? this.cacheHits / this.accesses : 0,
      totalAccesses: this.accesses,
    };
  }
}

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

export async function lexaraSpeakTest(): Promise<Buffer> {
  const result = await synthesizeLexaraSpeechWithFailover('Lexara online. Voice system confirmed.');
  return result.audioData;
}

export default lexaraTTSRouter;
