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
import crypto from 'crypto';
import { Readable } from 'stream';
import { asyncHandler } from '../errorHandler';
import { 
  getVoiceSynthesisService,
  type VoiceSynthesisRequest 
} from '../voiceSynthesisService';
import { createLogger } from '../logger';
import { synthesizeLexaraSpeech } from '../lexara/LexaraTTSRouter';
import type { SpeechContext } from '@shared/lexaraVoicePersona';

const log = createLogger('VoiceRoutes');

interface LexaraTTSStreamSession {
  text: string;
  createdAt: number;
}

const lexaraTTSStreamSessions = new Map<string, LexaraTTSStreamSession>();
const LEXARA_TTS_STREAM_SESSION_TTL_MS = 60_000;

function pruneLexaraTTSSessions(): void {
  const cutoff = Date.now() - LEXARA_TTS_STREAM_SESSION_TTL_MS;
  for (const [id, session] of lexaraTTSStreamSessions) {
    if (session.createdAt < cutoff) lexaraTTSStreamSessions.delete(id);
  }
}

export function setupVoiceRoutes(app: Express): void {
  /**
   * POST /api/lexara/tts/session
   * Create a one-use playback URL. The subsequent GET is a normal media URL,
   * allowing HTMLAudioElement to begin playback while ElevenLabs is still
   * streaming audio instead of waiting for a complete Blob.
   */
  app.post(
    '/api/lexara/tts/session',
    asyncHandler(async (req: Request, res: Response) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ error: 'Text is required for TTS synthesis' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text too long. Maximum 5000 characters.' });
      if (!process.env.ELEVENLABS_API_KEY?.trim() || !process.env.ELEVENLABS_VOICE_ID?.trim()) {
        return res.status(503).json({ error: 'LEXARA voice is not configured' });
      }

      pruneLexaraTTSSessions();
      const id = crypto.randomUUID();
      lexaraTTSStreamSessions.set(id, { text, createdAt: Date.now() });
      return res.json({
        success: true,
        audioUrl: `/api/lexara/tts/session/${id}`,
        provider: 'elevenlabs',
        voiceId: process.env.ELEVENLABS_VOICE_ID,
        model: process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',
      });
    }),
  );

  /**
   * GET /api/lexara/tts/session/:id
   * Proxy ElevenLabs' real streaming TTS response directly to the browser.
   */
  app.get(
    '/api/lexara/tts/session/:id',
    asyncHandler(async (req: Request, res: Response) => {
      pruneLexaraTTSSessions();
      const id = String(req.params.id || '');
      const session = lexaraTTSStreamSessions.get(id);
      lexaraTTSStreamSessions.delete(id);
      if (!session) return res.status(404).json({ error: 'TTS session expired or unavailable' });

      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
      const modelId = process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5';
      if (!apiKey || !voiceId) return res.status(503).json({ error: 'LEXARA voice is not configured' });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      req.once('close', () => controller.abort());

      try {
        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            body: JSON.stringify({
              text: session.text,
              model_id: modelId,
              voice_settings: {
                stability: Number(process.env.ELEVENLABS_VOICE_STABILITY || 0.5),
                similarity_boost: Number(process.env.ELEVENLABS_VOICE_SIMILARITY || 0.8),
                style: Number(process.env.ELEVENLABS_VOICE_STYLE || 0.15),
                use_speaker_boost: true,
              },
            }),
            signal: controller.signal,
          },
        );

        if (!upstream.ok || !upstream.body) {
          const detail = (await upstream.text()).slice(0, 500);
          log.warn('[VoiceRoutes] ElevenLabs streaming TTS failed', {
            status: upstream.status,
            detail,
          });
          return res.status(502).json({ error: 'LEXARA voice streaming failed' });
        }

        res.status(200);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Provider', 'elevenlabs');
        res.setHeader('X-Voice-Id', voiceId);
        res.setHeader('X-TTS-Model', modelId);

        const readable = Readable.fromWeb(upstream.body as any);
        readable.on('error', error => {
          log.warn('[VoiceRoutes] Streaming TTS pipe error', {
            error: error instanceof Error ? error.message : String(error),
          });
          if (!res.headersSent) res.status(502).end();
          else res.end();
        });
        readable.pipe(res);
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  
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
