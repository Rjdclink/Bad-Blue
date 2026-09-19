/**
 * LEXARA VOICE PIPELINE
 *
 * Compatibility pipeline for historical callers. Runtime provider authority
 * lives exclusively in LexaraTTSMesh.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import {
  getLexaraTTSReadiness,
  refreshLexaraTTSReadiness,
  synthesizeLexaraSpeechWithFailover,
  type LexaraTTSProviderId,
} from './LexaraTTSMesh';

const log = createLogger('LexaraVoicePipeline');

export interface LexaraVoiceProfile {
  name: string;
  age: '18-20';
  gender: 'female';
  characteristics: {
    pitch: number;
    pitchVariation: number;
    rate: number;
    stability: number;
    clarity: number;
    warmth: number;
    authority: number;
  };
  prosody: {
    pauseAfterPeriod: number;
    pauseAfterComma: number;
    pauseBeforeLegalTerm: number;
    emphasisOnLegalTerms: boolean;
    measuredCadence: boolean;
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
    pitch: 220,
    pitchVariation: 35,
    rate: 150,
    stability: 0.72,
    clarity: 0.90,
    warmth: 0.68,
    authority: 0.85,
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

export type VoiceProvider = LexaraTTSProviderId;
export type EmotionalContext = 'neutral' | 'empathetic' | 'authoritative' | 'reassuring' | 'serious';

export interface VoiceSynthesisRequest {
  text: string;
  traceId?: string;
  context?: EmotionalContext;
  settings?: Partial<VoiceSynthesisSettings>;
  persist?: boolean;
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
  audioId: string;
  traceId: string;
  audioRef: string;
  audioData?: Buffer;
  mimeType: string;
  durationMs: number;
  provider: VoiceProvider;
  persisted: boolean;
  generatedAt: number;
  latencyMs: number;
  qualityScore: number;
  text: string;
  ssml?: string;
}

export interface ProviderStatus {
  name: VoiceProvider;
  available: boolean;
  latencyMs?: number;
  lastError?: string;
  lastCheck: number;
}

class AudioPersistence {
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || process.env.LEXARA_AUDIO_DIR || '/tmp/lexara-audio';
    try {
      if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
    } catch (error) {
      log.warn('[LexaraVoicePipeline] Could not create audio storage directory', { error });
    }
  }

  async persist(audioId: string, audioData: Buffer, mimeType: string): Promise<string> {
    const extension = mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mpeg') || mimeType.includes('mp3')
        ? 'mp3'
        : 'audio';
    const filepath = path.join(this.storageDir, `${audioId}.${extension}`);
    await fs.promises.writeFile(filepath, audioData);
    return filepath;
  }

  getPlayableRef(audioId: string, mimeType: string): string {
    const extension = mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mpeg') || mimeType.includes('mp3')
        ? 'mp3'
        : 'audio';
    return `/api/lexara/audio/${audioId}.${extension}`;
  }
}

function inferContext(text: string, speechContext?: string): EmotionalContext {
  if (speechContext === 'reassurance') return 'reassuring';
  if (speechContext === 'serious' || speechContext === 'legal') return 'authoritative';
  if (speechContext === 'explanation' || speechContext === 'guidance') return 'empathetic';
  if (speechContext === 'greeting' || speechContext === 'casual') return 'neutral';

  const lower = text.toLowerCase();
  if (/(court|judge|statute|liability|damages|jurisdiction|verdict|evidence)/.test(lower)) return 'authoritative';
  if (/(worried|scared|afraid|anxious|nervous|urgent)/.test(lower)) return 'reassuring';
  if (/(deadline|critical|immediately|required)/.test(lower)) return 'serious';
  return 'neutral';
}

function estimateDurationMs(text: string, context: EmotionalContext): number {
  const rate = LEXARA_VOICE_PROFILE.emotionalRange[context].rate;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(500, Math.round((words / rate) * 60_000));
}

function generateSSML(text: string, context: EmotionalContext): string {
  const emotional = LEXARA_VOICE_PROFILE.emotionalRange[context];
  const rate = `${Math.round((emotional.rate / 150) * 100)}%`;
  const pitch = `${emotional.pitch > 220 ? '+' : ''}${Math.round((emotional.pitch - 220) / 2)}%`;
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<speak version="1.1"><prosody rate="${rate}" pitch="${pitch}">${escaped}</prosody></speak>`;
}

export class LexaraVoicePipeline extends EventEmitter {
  private persistence: AudioPersistence;
  private initialized = false;
  private synthesisCount = 0;
  private totalLatencyMs = 0;
  private errorCount = 0;

  constructor(config?: { storageDir?: string }) {
    super();
    this.persistence = new AudioPersistence(config?.storageDir);
  }

  async initialize(): Promise<void> {
    const readiness = await refreshLexaraTTSReadiness(false);
    this.initialized = true;
    this.emit('initialized', readiness);
    log.info('[LexaraVoicePipeline] Canonical adaptive voice mesh initialized', {
      configuredProviders: readiness.configuredProviders,
      healthyProviders: readiness.healthyProviders,
    });
  }

  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    if (!this.initialized) await this.initialize();

    const text = String(request.text || '').trim();
    if (!text) throw new Error('Text is required for LEXARA voice synthesis');

    const startedAt = Date.now();
    const audioId = randomUUID();
    const traceId = request.traceId || randomUUID();
    const context = request.context || inferContext(text, request.speechContext);

    try {
      const result = await synthesizeLexaraSpeechWithFailover(text);
      const durationMs = estimateDurationMs(text, context);
      let audioRef = `data:${result.mimeType};base64,${result.audioData.toString('base64')}`;
      let persisted = false;

      if (request.persist !== false) {
        try {
          await this.persistence.persist(audioId, result.audioData, result.mimeType);
          audioRef = this.persistence.getPlayableRef(audioId, result.mimeType);
          persisted = true;
        } catch (error) {
          log.warn('[LexaraVoicePipeline] Audio persistence failed; using inline audio', { error });
        }
      }

      const latencyMs = Date.now() - startedAt;
      this.synthesisCount += 1;
      this.totalLatencyMs += latencyMs;

      const response: VoiceSynthesisResult = {
        audioId,
        traceId,
        audioRef,
        audioData: request.persist === false ? result.audioData : undefined,
        mimeType: result.mimeType,
        durationMs,
        provider: result.provider,
        persisted,
        generatedAt: Date.now(),
        latencyMs,
        qualityScore: 0.95,
        text,
        ssml: generateSSML(text, context),
      };

      this.emit('synthesis-complete', response);
      return response;
    } catch (error) {
      this.errorCount += 1;
      log.error('[LexaraVoicePipeline] Canonical mesh synthesis failed', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getProviderStatuses(): Record<string, ProviderStatus> {
    const readiness = getLexaraTTSReadiness();
    return Object.fromEntries(
      readiness.providers.map(provider => [
        provider.provider,
        {
          name: provider.provider,
          available: provider.healthy,
          latencyMs: provider.ewmaLatencyMs || undefined,
          lastError: provider.lastFailure || undefined,
          lastCheck: provider.verifiedAt || 0,
        },
      ]),
    );
  }

  getStats(): {
    synthesisCount: number;
    avgLatencyMs: number;
    errorCount: number;
    errorRate: number;
    preferredProvider: VoiceProvider | null;
  } {
    const readiness = getLexaraTTSReadiness();
    return {
      synthesisCount: this.synthesisCount,
      avgLatencyMs: this.synthesisCount > 0 ? this.totalLatencyMs / this.synthesisCount : 0,
      errorCount: this.errorCount,
      errorRate: this.synthesisCount + this.errorCount > 0
        ? this.errorCount / (this.synthesisCount + this.errorCount)
        : 0,
      preferredProvider: readiness.healthyProviders[0] || null,
    };
  }

  async refreshProviders(): Promise<void> {
    const readiness = await refreshLexaraTTSReadiness(true);
    this.emit('providers-refreshed', readiness);
  }
}

let pipelineInstance: LexaraVoicePipeline | null = null;

export function getLexaraVoicePipeline(config?: { storageDir?: string }): LexaraVoicePipeline {
  if (!pipelineInstance) pipelineInstance = new LexaraVoicePipeline(config);
  return pipelineInstance;
}

export default LexaraVoicePipeline;
