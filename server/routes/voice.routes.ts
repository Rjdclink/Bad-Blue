/**
 * Voice Synthesis Routes
 * Stage 13: Neural Voice Synthesis API Endpoints
 * 
 * Provides REST API for LEXARA voice synthesis
 */

import { type Express, type Request, type Response } from 'express';
import { asyncHandler } from '../errorHandler';
import { 
  getVoiceSynthesisService,
  type VoiceSynthesisRequest 
} from '../voiceSynthesisService';
import { createLogger } from '../logger';
import type { SpeechContext } from '@shared/alexeraVoicePersona';

const log = createLogger('VoiceRoutes');

export function setupVoiceRoutes(app: Express): void {
  
  /**
   * POST /api/lexara/speak
   * Synthesize speech from text with LEXARA's voice persona
   * 
   * Body:
   * - text: Text to synthesize (required)
   * - context: Speech context (optional: 'evaluation', 'guidance', etc.)
   * - persona: Voice persona parameters (optional)
   * - tonalDirective: Specific tonal instruction (optional)
   * - emotionalState: Emotional state directive (optional)
   * - optimizeForAuditory: Optimize text for listening (optional, default: true)
   * 
   * Response:
   * - For browser provider: Returns SSML and metadata for client-side synthesis
   * - For server providers: Returns audio stream or URL
   */
  app.post(
    '/api/lexara/speak',
    asyncHandler(async (req: Request, res: Response) => {
      const {
        text,
        context,
        persona,
        tonalDirective,
        emotionalState,
        optimizeForAuditory = true,
      } = req.body;

      // Validation
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Text is required for speech synthesis' 
        });
      }

      if (text.length > 5000) {
        return res.status(400).json({
          error: 'Text too long. Maximum 5000 characters.',
        });
      }

      try {
        log.info('Speech synthesis request', {
          context,
          textLength: text.length,
          hasPersona: !!persona,
        });

        const synthesisRequest: VoiceSynthesisRequest = {
          text,
          context: context as SpeechContext,
          persona,
          tonalDirective,
          emotionalState,
          optimizeForAuditory,
        };

        const voiceService = getVoiceSynthesisService();
        const result = await voiceService.synthesize(synthesisRequest);

        // If audio data is present, stream it
        if (result.audioData) {
          res.setHeader('Content-Type', result.mimeType);
          res.setHeader('Content-Length', result.audioData.length);
          res.setHeader('X-Audio-Duration', result.duration.toString());
          return res.send(result.audioData);
        }

        // If audio URL is present, return it
        if (result.audioUrl) {
          return res.json({
            audioUrl: result.audioUrl,
            mimeType: result.mimeType,
            duration: result.duration,
            provider: result.provider,
          });
        }

        // For browser synthesis, return SSML and metadata
        return res.json({
          ssml: result.ssml,
          text: result.text,
          segments: result.segments,
          duration: result.duration,
          mimeType: result.mimeType,
          provider: result.provider,
        });

      } catch (error) {
        log.error('Speech synthesis failed', error);
        return res.status(500).json({
          error: 'Speech synthesis failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  /**
   * GET /api/lexara/voice/providers
   * Get available voice synthesis providers
   */
  app.get(
    '/api/lexara/voice/providers',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const voiceService = getVoiceSynthesisService();
        const providers = await voiceService.getAvailableProviders();
        
        return res.json({
          providers,
          default: providers[0] || 'browser',
        });
      } catch (error) {
        log.error('Failed to get voice providers', error);
        return res.status(500).json({
          error: 'Failed to retrieve voice providers',
        });
      }
    })
  );

  /**
   * GET /api/lexara/voice/status
   * Get voice synthesis system status
   */
  app.get(
    '/api/lexara/voice/status',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const voiceService = getVoiceSynthesisService();
        const providers = await voiceService.getAvailableProviders();
        
        return res.json({
          available: true,
          providers,
          features: {
            speechFlow: true,
            prosody: true,
            emphasis: true,
            pauses: true,
            contextualTones: true,
          },
        });
      } catch (error) {
        log.error('Failed to get voice status', error);
        return res.status(500).json({
          available: false,
          error: 'Voice synthesis system unavailable',
        });
      }
    })
  );

  log.info('Voice synthesis routes configured');
}
