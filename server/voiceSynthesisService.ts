/**
 * Voice Synthesis Service
 * Stage 13: Neural Voice Synthesis and Delivery Layer
 * 
 * Integrates with voice synthesis providers:
 * - ElevenLabs (premium)
 * - Amazon Polly Neural
 * - Microsoft Azure Neural Voice
 * - Google Cloud WaveNet/Neural2
 * - Browser Web Speech API (fallback)
 */

import { 
  LEXARA_VOICE_PERSONA, 
  DEFAULT_VOICE_CONFIG,
  type VoiceSynthesisConfig,
  type SpeechContext,
  getPersonaForContext 
} from '../../shared/lexaraVoicePersona';
import { 
  SpeechFlowEngine,
  type SpeechFlowOutput 
} from '../../shared/speechFlowEngine';
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
 * Browser TTS Provider (Fallback)
 * Generates SSML that can be used with browser SpeechSynthesis API
 */
class BrowserTTSProvider implements VoiceProvider {
  name = 'browser';

  async isAvailable(): Promise<boolean> {
    return true; // Always available as fallback
  }

  async synthesize(
    request: VoiceSynthesisRequest,
    ssml: string
  ): Promise<VoiceSynthesisResponse> {
    log.info('Using browser TTS (client-side synthesis)');
    
    // Return SSML for client-side synthesis
    return {
      mimeType: 'text/plain',
      duration: 0, // Will be determined client-side
      text: request.text,
      ssml,
      segments: [],
      provider: 'browser',
    };
  }
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
    const voiceId = request.persona?.voiceId || 'EXAVITQu4vr4xnSDxMaL'; // Professional female voice
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
    // Note: Would require @aws-sdk/client-polly
    // For now, return placeholder
    throw new Error('Amazon Polly integration requires AWS SDK setup');
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
    // Note: Would require microsoft-cognitiveservices-speech-sdk
    throw new Error('Azure Neural Voice integration requires Speech SDK setup');
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
    // Note: Would require @google-cloud/text-to-speech
    throw new Error('Google Cloud TTS integration requires Cloud SDK setup');
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

    // Initialize providers
    this.providers = new Map();
    
    // Add browser fallback
    this.providers.set('browser', new BrowserTTSProvider());
    
    // Add premium providers if API keys are available
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

    // Set default provider based on availability
    this.defaultProvider = 'browser';
    this.selectDefaultProvider();
  }

  private async selectDefaultProvider(): Promise<void> {
    // Prefer ElevenLabs for quality, fall back to others
    const preferenceOrder = ['elevenlabs', 'azure', 'google', 'polly', 'browser'];
    
    for (const providerName of preferenceOrder) {
      const provider = this.providers.get(providerName);
      if (provider && await provider.isAvailable()) {
        this.defaultProvider = providerName;
        log.info(`Selected voice provider: ${providerName}`);
        break;
      }
    }
  }

  /**
   * Main synthesis method
   */
  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResponse> {
    try {
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
        throw new Error(`Voice provider '${providerName}' not available`);
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
      
      // Fallback to browser TTS on error
      if (this.defaultProvider !== 'browser') {
        log.info('Falling back to browser TTS');
        const browserProvider = this.providers.get('browser')!;
        const speechFlow = this.speechFlow.transformToSpeech(request.text, request.context || 'explanation');
        return browserProvider.synthesize(request, speechFlow.ssml);
      }
      
      throw error;
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
