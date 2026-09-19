/**
 * Voice Synthesis Service
 *
 * Compatibility service for older callers. Provider authority lives in the
 * canonical LexaraTTSMesh; this service only performs speech-flow shaping and
 * delegates synthesis.
 */

import {
  LEXARA_VOICE_PERSONA,
  DEFAULT_VOICE_CONFIG,
  type VoiceSynthesisConfig,
  type SpeechContext,
  getPersonaForContext,
} from '@shared/lexaraVoicePersona';
import {
  SpeechFlowEngine,
} from '@shared/speechFlowEngine';
import { createLogger } from './logger';
import {
  getLexaraTTSReadiness,
  refreshLexaraTTSReadiness,
  synthesizeLexaraSpeechWithFailover,
} from './lexara/LexaraTTSMesh';

const log = createLogger('VoiceSynthesis');

export interface VoiceSynthesisRequest {
  text: string;
  context?: SpeechContext;
  persona?: Partial<VoiceSynthesisConfig>;
  tonalDirective?: string;
  emotionalState?: 'neutral' | 'empathetic' | 'authoritative' | 'reassuring';
  optimizeForAuditory?: boolean;
}

export interface VoiceSynthesisResponse {
  audioUrl?: string;
  audioData?: Buffer;
  mimeType: string;
  duration: number;
  text: string;
  ssml: string;
  segments: any[];
  provider: string;
}

function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(500, Math.round((words / 150) * 60_000));
}

export class VoiceSynthesisService {
  private speechFlow: SpeechFlowEngine;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private synthesisCount = 0;
  private errorCount = 0;
  private totalLatencyMs = 0;

  constructor() {
    this.speechFlow = new SpeechFlowEngine({
      enablePauses: true,
      enableProsody: true,
      enableEmphasis: true,
      optimizeForLegal: true,
      targetProvider: 'ssml',
    });
    this.initPromise = this.initializePipeline();
  }

  private async initializePipeline(): Promise<void> {
    try {
      const readiness = await refreshLexaraTTSReadiness(false);
      log.info('[VoiceSynthesis] Adaptive LEXARA voice mesh initialized', {
        healthyProviders: readiness.healthyProviders,
        configuredProviders: readiness.configuredProviders,
      });
    } catch (error) {
      log.warn('[VoiceSynthesis] Adaptive voice warmup did not complete', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.initialized = true;
    }
  }

  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    if (this.initPromise) await this.initPromise;

    const startedAt = Date.now();
    try {
      let text = String(request.text || '').trim();
      if (!text) throw new Error('Text is required for voice synthesis');

      if (request.optimizeForAuditory !== false) {
        const contextPersona = getPersonaForContext(request.context || 'explanation');
        const persona = {
          ...LEXARA_VOICE_PERSONA,
          ...DEFAULT_VOICE_CONFIG,
          ...contextPersona,
          ...request.persona,
        };
        void persona;
      }

      const context = request.context || 'explanation';
      const speechFlow = this.speechFlow.transformToSpeech(text, context);
      const result = await synthesizeLexaraSpeechWithFailover(text);

      const latencyMs = Date.now() - startedAt;
      this.synthesisCount += 1;
      this.totalLatencyMs += latencyMs;

      return {
        audioData: result.audioData,
        mimeType: result.mimeType,
        duration: estimateDurationMs(text),
        text,
        ssml: speechFlow.ssml,
        segments: speechFlow.segments,
        provider: result.provider,
      };
    } catch (error) {
      this.errorCount += 1;
      log.error('[VoiceSynthesis] Adaptive voice synthesis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getAvailableProviders(): Promise<string[]> {
    let readiness = getLexaraTTSReadiness();
    if (!readiness.available && readiness.configuredProviders.length) {
      readiness = await refreshLexaraTTSReadiness(false);
    }
    return readiness.healthyProviders;
  }

  async isProviderAvailable(name: string): Promise<boolean> {
    const providers = await this.getAvailableProviders();
    return providers.includes(name);
  }

  getStats() {
    return {
      synthesisCount: this.synthesisCount,
      avgLatencyMs: this.synthesisCount > 0 ? this.totalLatencyMs / this.synthesisCount : 0,
      errorCount: this.errorCount,
      errorRate: this.synthesisCount + this.errorCount > 0
        ? this.errorCount / (this.synthesisCount + this.errorCount)
        : 0,
      initialized: this.initialized,
    };
  }
}

let voiceSynthesisService: VoiceSynthesisService | null = null;

export function getVoiceSynthesisService(): VoiceSynthesisService {
  if (!voiceSynthesisService) voiceSynthesisService = new VoiceSynthesisService();
  return voiceSynthesisService;
}
