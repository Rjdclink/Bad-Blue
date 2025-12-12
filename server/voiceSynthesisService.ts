/**
 * Voice Synthesis Service
 * Stage 13: Neural Voice Synthesis and Delivery Layer
 * 
 * Integrates with Lexara voice synthesis providers:
 * - ElevenLabs (premium)
 * - Amazon Polly Neural
 * - Microsoft Azure Neural Voice
 * - Google Cloud WaveNet/Neural2
 * 
 * Note: Browser TTS is disabled to enforce Lexara voice profile consistency.
 */

import { 
  ALEXERA_VOICE_PERSONA, 
  DEFAULT_VOICE_CONFIG,
  type VoiceSynthesisConfig,
  type SpeechContext,
  getPersonaForContext 
} from '@shared/alexeraVoicePersona';
import { 
  SpeechFlowEngine,
  type SpeechFlowOutput 
} from '@shared/speechFlowEngine';
import { createLogger } from './logger';

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
 * Voice Provider Interface
 */
interface VoiceProvider {
  name: string;
  synthesize(request: VoiceSynthesisRequest, ssml: string): Promise<VoiceSynthesisResponse>;
  isAvailable(): Promise<boolean>;
}

/**
 * ElevenLabs Provider (Premium Neural Voice)
 */
class ElevenLabsProvider implements VoiceProvider {
  name = 'elevenlabs';
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async synthesize(
    request: VoiceSynthesisRequest,
    ssml: string
  ): Promise<VoiceSynthesisResponse> {
    // Use voiceId from persona config, env var, or default
    const voiceId = request.persona?.voiceId 
      || process.env.ELEVENLABS_VOICE_ID 
      || 'EXAVITQu4vr4xnSDxMaL'; // Professional female voice (default)
    const model = request.persona?.model || 'eleven_multilingual_v2';

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: model,
          voice_settings: {
            stability: request.persona?.stability ?? 0.7,
            similarity_boost: request.persona?.similarityBoost ?? 0.8,
            style: request.persona?.style ?? 0.3,
            use_speaker_boost: request.persona?.useSpeakerBoost ?? true,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    const audioData = Buffer.from(await response.arrayBuffer());

    return {
      audioData,
      mimeType: 'audio/mpeg',
      duration: 0, // Would need to parse audio to get duration
      text: request.text,
      ssml,
      segments: [],
      provider: 'elevenlabs',
    };
  }
}

/**
 * Amazon Polly Provider
 */
class PollyProvider implements VoiceProvider {
  name = 'polly';
  
  async isAvailable(): Promise<boolean> {
    // Check if AWS SDK is configured
    return process.env.AWS_ACCESS_KEY_ID !== undefined;
  }

  async synthesize(
    request: VoiceSynthesisRequest,
    ssml: string
  ): Promise<VoiceSynthesisResponse> {
    throw new Error('Amazon Polly integration requires AWS SDK setup. Install @aws-sdk/client-polly and configure AWS credentials to use this provider.');
  }
}

/**
 * Azure Neural Voice Provider
 */
class AzureVoiceProvider implements VoiceProvider {
  name = 'azure';
  
  async isAvailable(): Promise<boolean> {
    return process.env.AZURE_SPEECH_KEY !== undefined;
  }

  async synthesize(
    request: VoiceSynthesisRequest,
    ssml: string
  ): Promise<VoiceSynthesisResponse> {
    throw new Error('Azure Neural Voice integration requires Speech SDK setup. Install microsoft-cognitiveservices-speech-sdk and configure AZURE_SPEECH_KEY to use this provider.');
  }
}

/**
 * Google Cloud TTS Provider
 */
class GoogleTTSProvider implements VoiceProvider {
  name = 'google';
  
  async isAvailable(): Promise<boolean> {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined;
  }

  async synthesize(
    request: VoiceSynthesisRequest,
    ssml: string
  ): Promise<VoiceSynthesisResponse> {
    throw new Error('Google Cloud TTS integration requires Cloud SDK setup. Install @google-cloud/text-to-speech and configure GOOGLE_APPLICATION_CREDENTIALS to use this provider.');
  }
}

/**
 * Voice Synthesis Service
 * Main service that coordinates between providers
 */
export class VoiceSynthesisService {
  private speechFlow: SpeechFlowEngine;
  private providers: Map<string, VoiceProvider>;
  private defaultProvider: string;

  constructor() {
    this.speechFlow = new SpeechFlowEngine({
      enablePauses: true,
      enableProsody: true,
      enableEmphasis: true,
      optimizeForLegal: true,
      targetProvider: 'ssml',
    });

    // Initialize providers (Lexara voice providers only - browser TTS disabled)
    this.providers = new Map();
    
    // Add premium Lexara-compatible providers if API keys are available
    if (process.env.ELEVENLABS_API_KEY) {
      this.providers.set('elevenlabs', new ElevenLabsProvider(process.env.ELEVENLABS_API_KEY));
    }
    
    if (process.env.AWS_ACCESS_KEY_ID) {
      this.providers.set('polly', new PollyProvider());
    }
    
    if (process.env.AZURE_SPEECH_KEY) {
      this.providers.set('azure', new AzureVoiceProvider());
    }
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      this.providers.set('google', new GoogleTTSProvider());
    }

    // Set default provider based on availability (no browser TTS fallback)
    this.defaultProvider = '';
    this.selectDefaultProvider();
  }

  private async selectDefaultProvider(): Promise<void> {
    // Prefer ElevenLabs for Lexara voice quality, fall back to other neural providers
    // Browser TTS is excluded to enforce Lexara voice profile
    const preferenceOrder = ['elevenlabs', 'azure', 'google', 'polly'];
    
    for (const providerName of preferenceOrder) {
      const provider = this.providers.get(providerName);
      if (provider && await provider.isAvailable()) {
        this.defaultProvider = providerName;
        log.info(`Selected Lexara voice provider: ${providerName}`);
        return;
      }
    }
    
    // No providers available - voice synthesis will be unavailable
    log.warn('No Lexara voice providers available. Voice synthesis will be unavailable.');
  }

  /**
   * Main synthesis method
   * Uses only Lexara voice providers (no browser TTS fallback)
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    try {
      // Check if any Lexara voice provider is available
      if (!this.defaultProvider) {
        throw new Error('No Lexara voice providers configured. Please configure ElevenLabs, Azure, Google, or Polly.');
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

      // Step 3: Get the appropriate voice provider
      const providerName = request.persona?.provider || this.defaultProvider;
      const provider = this.providers.get(providerName);

      if (!provider) {
        throw new Error(`Lexara voice provider '${providerName}' not available`);
      }

      // Step 4: Synthesize with the provider
      const result = await provider.synthesize(
        { ...request, text },
        speechFlow.ssml
      );

      // Step 5: Add speechFlow metadata to result
      return {
        ...result,
        duration: result.duration || speechFlow.estimatedDuration,
        segments: speechFlow.segments,
      };

    } catch (error) {
      log.error('Voice synthesis failed', error);
      
      // No browser TTS fallback - throw error to inform client
      throw new Error('Lexara voice synthesis unavailable. Please try again later.');
    }
  }

  /**
   * Get available providers
   */
  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];
    
    for (const [name, provider] of this.providers.entries()) {
      if (await provider.isAvailable()) {
        available.push(name);
      }
    }
    
    return available;
  }

  /**
   * Check if a specific provider is available
   */
  async isProviderAvailable(name: string): Promise<boolean> {
    const provider = this.providers.get(name);
    return provider ? provider.isAvailable() : false;
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
