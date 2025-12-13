/**
 * Voice Synthesis Service
 * Stage 13: Neural Voice Synthesis and Delivery Layer
 * 
 * Integrates with Lexara voice synthesis using ElevenLabs ONLY.
 * Other providers (Coqui, OpenAI) have been removed to enforce
 * consistent Lexara voice profile.
 * 
 * REQUIREMENTS:
 * - ELEVENLABS_API_KEY environment variable (required)
 * - ELEVENLABS_VOICE_ID environment variable (required)
 */

import { 
  LEXARA_VOICE_PERSONA, 
  DEFAULT_VOICE_CONFIG,
  type VoiceSynthesisConfig,
  type SpeechContext,
  getPersonaForContext 
} from '@shared/lexaraVoicePersona';
import { 
  SpeechFlowEngine,
  type SpeechFlowOutput 
} from '@shared/speechFlowEngine';
import { createLogger } from './logger';
import { getLexaraVoicePipeline, type VoiceSynthesisResult } from './lexara/LexaraVoicePipeline';

const log = createLogger('VoiceSynthesis');

/**
 * Voice Synthesis Request
 */
export interface VoiceSynthesisRequest {
  text: string;
  context?: SpeechContext;
  persona?: Partial<VoiceSynthesisConfig>;
  tonalDirective?: string;
  emotionalState?: 'neutral' | 'empathetic' | 'authoritative' | 'reassuring';
  optimizeForAuditory?: boolean;
}

/**
 * Voice Synthesis Response
 */
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

/**
 * Voice Synthesis Service
 * Uses ElevenLabs via Lexara Voice Pipeline exclusively
 */
export class VoiceSynthesisService {
  private speechFlow: SpeechFlowEngine;
  private pipeline = getLexaraVoicePipeline();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.speechFlow = new SpeechFlowEngine({
      enablePauses: true,
      enableProsody: true,
      enableEmphasis: true,
      optimizeForLegal: true,
      targetProvider: 'ssml',
    });

    // Initialize pipeline asynchronously - errors are handled gracefully
    this.initPromise = this.initializePipeline();
  }

  private async initializePipeline(): Promise<void> {
    try {
      await this.pipeline.initialize();
      const statuses = this.pipeline.getProviderStatuses();
      
      if (statuses.elevenlabs.available) {
        log.info('[VoiceSynthesis] ElevenLabs voice provider initialized', {
          provider: 'elevenlabs',
          voiceId: process.env.ELEVENLABS_VOICE_ID || 'not set',
        });
      } else {
        log.warn('[VoiceSynthesis] ElevenLabs not available. Voice synthesis will be unavailable.', {
          error: statuses.elevenlabs.lastError,
        });
      }
      this.initialized = true;
    } catch (error) {
      log.error('[VoiceSynthesis] Failed to initialize voice pipeline', error);
    }
  }

  /**
   * Main synthesis method
   * Uses ElevenLabs exclusively
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    try {
      // Ensure initialization is complete before synthesis
      if (this.initPromise) {
        await this.initPromise;
      }
      
      // Check if ElevenLabs is available
      const statuses = this.pipeline.getProviderStatuses();
      if (!statuses.elevenlabs.available) {
        throw new Error(
          'ElevenLabs voice synthesis is not available. ' +
          'Please set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables.'
        );
      }

      log.info('[VoiceSynthesis] Voice synthesis request', {
        context: request.context,
        textLength: request.text.length,
        provider: 'elevenlabs',
      });

      // Step 1: Optimize text for auditory comprehension if requested
      let text = request.text;
      if (request.optimizeForAuditory) {
        text = this.speechFlow.optimizeForAuditory(text);
      }

      // Step 2: Transform text to speech segments with SpeechFlow
      const context = request.context || 'explanation';
      const speechFlow = this.speechFlow.transformToSpeech(text, context);

      // Step 3: Map emotional state to pipeline context
      const pipelineContext = this.mapEmotionalState(request.emotionalState);

      // Step 4: Synthesize with Lexara Voice Pipeline (ElevenLabs)
      const result: VoiceSynthesisResult = await this.pipeline.synthesize({
        text,
        context: pipelineContext,
        speechContext: context as any,
        persist: true,
      });

      // Step 5: Return response
      return {
        audioUrl: result.audioRef,
        audioData: result.audioData,
        mimeType: result.mimeType,
        duration: result.durationMs,
        text: result.text,
        ssml: result.ssml || speechFlow.ssml,
        segments: speechFlow.segments,
        provider: result.provider,
      };

    } catch (error) {
      log.error('[VoiceSynthesis] Voice synthesis failed', error);
      throw new Error('Lexara voice synthesis unavailable. Please check ElevenLabs configuration.');
    }
  }

  private mapEmotionalState(state?: string): 'neutral' | 'empathetic' | 'authoritative' | 'reassuring' | 'serious' {
    switch (state) {
      case 'empathetic': return 'empathetic';
      case 'authoritative': return 'authoritative';
      case 'reassuring': return 'reassuring';
      default: return 'neutral';
    }
  }

  /**
   * Get available providers (ElevenLabs only)
   */
  async getAvailableProviders(): Promise<string[]> {
    const statuses = this.pipeline.getProviderStatuses();
    const available: string[] = [];
    
    if (statuses.elevenlabs.available) available.push('elevenlabs');
    
    return available;
  }

  /**
   * Check if ElevenLabs provider is available
   */
  async isProviderAvailable(name: string): Promise<boolean> {
    const statuses = this.pipeline.getProviderStatuses();
    if (name === 'elevenlabs') return statuses.elevenlabs.available;
    return false;
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return this.pipeline.getStats();
  }
}

// Singleton instance
let voiceSynthesisService: VoiceSynthesisService | null = null;

/**
 * Get voice synthesis service instance
 */
export function getVoiceSynthesisService(): VoiceSynthesisService {
  if (!voiceSynthesisService) {
    voiceSynthesisService = new VoiceSynthesisService();
  }
  return voiceSynthesisService;
}
