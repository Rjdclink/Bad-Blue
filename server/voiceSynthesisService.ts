/**
 * Voice Synthesis Service
 * Stage 13: Neural Voice Synthesis and Delivery Layer
 * 
 * Integrates with Lexara voice synthesis providers:
 * - Coqui TTS (primary - high quality neural voice)
 * - OpenAI TTS (premium API-based synthesis)
 * 
 * Other providers have been removed to enforce Lexara voice profile consistency.
 * Browser TTS is disabled.
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
 * Main service using Lexara Voice Pipeline with Coqui and OpenAI only
 */
export class VoiceSynthesisService {
  private speechFlow: SpeechFlowEngine;
  private pipeline = getLexaraVoicePipeline();
  private defaultProvider: 'coqui' | 'openai' | '' = '';
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
      
      if (statuses.coqui.available) {
        this.defaultProvider = 'coqui';
        log.info('Using Coqui TTS as primary Lexara voice provider');
      } else if (statuses.openai.available) {
        this.defaultProvider = 'openai';
        log.info('Using OpenAI TTS as primary Lexara voice provider');
      } else {
        log.warn('No Lexara voice providers available (Coqui or OpenAI). Voice synthesis will be unavailable.');
      }
      this.initialized = true;
    } catch (error) {
      log.error('Failed to initialize Lexara voice pipeline', error);
    }
  }

  /**
   * Main synthesis method
   * Uses only Coqui TTS and OpenAI TTS providers
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    try {
      // Ensure initialization is complete before synthesis
      if (this.initPromise) {
        await this.initPromise;
      }
      
      // Check if any Lexara voice provider is available
      if (!this.defaultProvider) {
        throw new Error(
          'No Lexara voice providers configured. ' +
          'Set one of the following environment variables to enable a provider: ' +
          'COQUI_TTS_URL (for Coqui TTS), or ' +
          'OPENAI_API_KEY (for OpenAI TTS).'
        );
      }

      log.info('Voice synthesis request', {
        context: request.context,
        textLength: request.text.length,
        provider: this.defaultProvider,
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

      // Step 4: Synthesize with Lexara Voice Pipeline
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
      log.error('Voice synthesis failed', error);
      throw new Error('Lexara voice synthesis unavailable. Please try again later.');
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
   * Get available providers (Coqui and OpenAI only)
   */
  async getAvailableProviders(): Promise<string[]> {
    const statuses = this.pipeline.getProviderStatuses();
    const available: string[] = [];
    
    if (statuses.coqui.available) available.push('coqui');
    if (statuses.openai.available) available.push('openai');
    
    return available;
  }

  /**
   * Check if a specific provider is available
   */
  async isProviderAvailable(name: string): Promise<boolean> {
    const statuses = this.pipeline.getProviderStatuses();
    if (name === 'coqui') return statuses.coqui.available;
    if (name === 'openai') return statuses.openai.available;
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
