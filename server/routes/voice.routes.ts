/**
 * Voice Synthesis Routes
 * Stage 13: Neural Voice Synthesis API Endpoints
 * 
 * Provides REST API for LEXARA voice synthesis using ElevenLabs
 * 
 * REQUIREMENTS:
 * - ELEVENLABS_API_KEY environment variable
 * - ELEVENLABS_VOICE_ID environment variable
 */

import { type Express, type Request, type Response } from 'express';
import { asyncHandler } from '../errorHandler';
import { 
  getVoiceSynthesisService,
  type VoiceSynthesisRequest 
} from '../voiceSynthesisService';
import { createLogger } from '../logger';
import type { SpeechContext } from '@shared/lexaraVoicePersona';

const log = createLogger('VoiceRoutes');

export function setupVoiceRoutes(app: Express): void {
  
  /**
   * POST /api/lexara/speak
   * Synthesize speech from text with LEXARA's voice using ElevenLabs
   * 
   * Body:
   * - text: Text to synthesize (required)
   * - context: Speech context (optional: 'evaluation', 'guidance', etc.)
   * - emotionalState: Emotional state directive (optional)
   * - optimizeForAuditory: Optimize text for listening (optional, default: true)
   * 
   * Response:
   * - Returns audio stream with Content-Type: audio/mpeg
   * - Headers include X-Audio-Duration, X-Provider, X-Voice-Id
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
        log.info('[VoiceRoutes] Speech synthesis request', {
          provider: 'elevenlabs',
          context,
          textLength: text.length,
          emotionalState,
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

        // Log success
        log.info('[VoiceRoutes] Speech synthesis complete', {
          provider: result.provider,
          mimeType: result.mimeType,
          duration: result.duration,
          audioSize: result.audioData?.length || 0,
        });

        // If audio data is present, stream it directly
        if (result.audioData) {
          res.setHeader('Content-Type', result.mimeType);
          res.setHeader('Content-Length', result.audioData.length);
          res.setHeader('X-Audio-Duration', result.duration.toString());
          res.setHeader('X-Provider', result.provider);
          res.setHeader('X-Voice-Id', process.env.ELEVENLABS_VOICE_ID || 'unknown');
          return res.send(result.audioData);
        }

        // If audio URL is present, return it as JSON
        if (result.audioUrl) {
          return res.json({
            audioUrl: result.audioUrl,
            mimeType: result.mimeType,
            duration: result.duration,
            provider: result.provider,
          });
        }

        // Should not reach here with ElevenLabs - always returns audio
        throw new Error('No audio data returned from synthesis');

      } catch (error) {
        log.error('[VoiceRoutes] Speech synthesis failed', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          provider: 'elevenlabs',
        });
        return res.status(500).json({
          error: 'Speech synthesis failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  /**
   * POST /api/lexara/tts/stream
   * Stream TTS audio directly using ElevenLabs
   * 
   * Returns audio/mpeg stream for direct playback
   */
  app.post(
    '/api/lexara/tts/stream',
    asyncHandler(async (req: Request, res: Response) => {
      const { text, stability, similarityBoost, style } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Text is required for TTS synthesis' 
        });
      }

      if (text.length > 5000) {
        return res.status(400).json({
          error: 'Text too long. Maximum 5000 characters.',
        });
      }

      try {
        // Import TTS router directly for streaming
        const { synthesizeLexaraSpeech } = await import('../lexara/LexaraTTSRouter');
        
        log.info('[VoiceRoutes] TTS stream request', {
          provider: 'elevenlabs',
          textLength: text.length,
          stability,
          similarityBoost,
        });

        const result = await synthesizeLexaraSpeech({
          text: text.trim(),
          stability,
          similarityBoost,
          style,
        });

        log.info('[VoiceRoutes] TTS stream complete', {
          provider: 'elevenlabs',
          voiceId: result.voiceId,
          audioByteLength: result.audioByteLength,
          durationMs: result.durationMs,
        });

        // Stream audio directly
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', result.audioByteLength);
        res.setHeader('X-Audio-Duration', result.durationMs.toString());
        res.setHeader('X-Provider', 'elevenlabs');
        res.setHeader('X-Voice-Id', result.voiceId);
        
        return res.send(result.audioData);

      } catch (error) {
        log.error('[VoiceRoutes] TTS stream failed', { 
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return res.status(500).json({
          error: 'TTS synthesis failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  /**
   * GET /api/lexara/voice/providers
   * Get available voice synthesis providers (ElevenLabs only)
   */
  app.get(
    '/api/lexara/voice/providers',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const voiceService = getVoiceSynthesisService();
        const providers = await voiceService.getAvailableProviders();
        
        return res.json({
          providers,
          default: providers.includes('elevenlabs') ? 'elevenlabs' : null,
          configured: {
            elevenlabs: !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID,
          },
        });
      } catch (error) {
        log.error('[VoiceRoutes] Failed to get voice providers', error);
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
        const stats = voiceService.getStats();
        
        return res.json({
          available: providers.includes('elevenlabs'),
          provider: 'elevenlabs',
          voiceId: process.env.ELEVENLABS_VOICE_ID || 'not configured',
          stats: {
            synthesisCount: stats.synthesisCount,
            avgLatencyMs: Math.round(stats.avgLatencyMs),
            errorCount: stats.errorCount,
            errorRate: (stats.errorRate * 100).toFixed(2) + '%',
          },
          configuration: {
            apiKeySet: !!process.env.ELEVENLABS_API_KEY,
            voiceIdSet: !!process.env.ELEVENLABS_VOICE_ID,
          },
          features: {
            streaming: true,
            caching: true,
            emotionalContext: true,
          },
        });
      } catch (error) {
        log.error('[VoiceRoutes] Failed to get voice status', error);
        return res.status(500).json({
          available: false,
          error: 'Voice synthesis system unavailable',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  log.info('[VoiceRoutes] Voice synthesis routes configured with ElevenLabs provider');
}
