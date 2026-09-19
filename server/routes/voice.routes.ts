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
import { asyncHandler } from '../errorHandler';
import { createLogger } from '../logger';
import { isAuthenticated } from '../auth';
import { getLexaraTTSReadiness, refreshLexaraTTSReadiness, synthesizeLexaraSpeechWithFailover, warmLexaraTTSMesh } from '../lexara/LexaraTTSMesh';

const log = createLogger('VoiceRoutes');

interface LexaraTTSStreamSession {
  text: string;
  createdAt: number;
  attempts: number;
}

const lexaraTTSStreamSessions = new Map<string, LexaraTTSStreamSession>();
const LEXARA_TTS_STREAM_SESSION_TTL_MS = 60_000;

function pruneLexaraTTSSessions(): void {
  const cutoff = Date.now() - LEXARA_TTS_STREAM_SESSION_TTL_MS;
  for (const [id, session] of lexaraTTSStreamSessions) {
    if (session.createdAt < cutoff) lexaraTTSStreamSessions.delete(id);
  }
}

function boundedVoiceSetting(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function setupVoiceRoutes(app: Express): void {
  /**
   * POST /api/lexara/voice/playback-event
   * Browser playback telemetry for diagnosing mobile buffer starvation and
   * distinguishing intentional barge-in from media stalls.
   */
  app.post('/api/lexara/voice/playback-event', (req: Request, res: Response) => {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim().slice(0, 32) : '';
    const allowed = new Set(['play', 'playing', 'waiting', 'stalled', 'ended', 'error', 'interrupted']);
    if (!allowed.has(event)) return res.status(204).end();

    log.info('[LEXARA Audio] playback event', {
      event,
      currentTime: Number.isFinite(Number(req.body?.currentTime)) ? Number(req.body.currentTime) : null,
      readyState: Number.isFinite(Number(req.body?.readyState)) ? Number(req.body.readyState) : null,
      networkState: Number.isFinite(Number(req.body?.networkState)) ? Number(req.body.networkState) : null,
      paused: typeof req.body?.paused === 'boolean' ? req.body.paused : null,
      source: req.body?.source === 'buffered' ? 'buffered' : 'streaming',
      client: typeof req.body?.userAgent === 'string' ? req.body.userAgent.slice(0, 220) : null,
    });
    return res.status(204).end();
  });

  /**
   * POST /api/lexara/tts/session
   * Create a one-use playback URL. The subsequent GET is a normal media URL,
   * allowing HTMLAudioElement to begin playback while ElevenLabs is still
   * streaming audio instead of waiting for a complete Blob.
   */
  app.post(
    '/api/lexara/tts/session',
    isAuthenticated,
    asyncHandler(async (req: Request, res: Response) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ error: 'Text is required for TTS synthesis' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text too long. Maximum 5000 characters.' });

      let readiness = getLexaraTTSReadiness();
      if (!readiness.available) {
        readiness = await refreshLexaraTTSReadiness(false);
      }
      if (!readiness.available) {
        return res.status(503).json({
          error: 'LEXARA voice has no verified healthy synthesis route',
          configuredProviders: readiness.configuredProviders,
          providerStates: readiness.providers,
        });
      }

      pruneLexaraTTSSessions();
      const id = crypto.randomUUID();
      lexaraTTSStreamSessions.set(id, { text, createdAt: Date.now(), attempts: 0 });
      return res.json({
        success: true,
        audioUrl: `/api/lexara/tts/session/${id}`,
        provider: 'adaptive-tts-mesh',
        providers: readiness.healthyProviders,
        voiceId: null,
        model: 'adaptive',
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
      if (!session) return res.status(404).json({ error: 'TTS session expired or unavailable' });
      if (session.attempts >= 2) {
        lexaraTTSStreamSessions.delete(id);
        return res.status(410).json({ error: 'TTS session retry limit reached' });
      }
      session.attempts += 1;

      try {
        const result = await synthesizeLexaraSpeechWithFailover(session.text);
        lexaraTTSStreamSessions.delete(id);
        res.status(200);
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', result.audioData.length);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Provider', result.provider);
        res.setHeader('X-Voice-Id', result.voiceId || 'adaptive');
        res.setHeader('X-TTS-Model', result.model);
        res.setHeader('X-TTS-Latency-Ms', String(result.latencyMs));
        return res.send(result.audioData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[VoiceRoutes] All LEXARA TTS session routes failed', { error: message });
        return res.status(502).json({ error: 'LEXARA voice synthesis failed across all compatible routes' });
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
    isAuthenticated,
    asyncHandler(async (req: Request, res: Response) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ error: 'Text is required for speech synthesis' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text too long. Maximum 5000 characters.' });

      try {
        const result = await synthesizeLexaraSpeechWithFailover(text);
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', result.audioData.length);
        res.setHeader('X-Provider', result.provider);
        res.setHeader('X-Voice-Id', result.voiceId || 'adaptive');
        res.setHeader('X-TTS-Model', result.model);
        return res.send(result.audioData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[VoiceRoutes] Speech synthesis mesh exhausted', { error: message });
        return res.status(503).json({
          error: 'Speech synthesis unavailable',
          message: 'All compatible LEXARA voice routes are temporarily unavailable.',
        });
      }
    }),
  );

  /**
   * POST /api/lexara/tts/stream
   * Stream TTS audio directly using ElevenLabs
   * 
   * Returns audio/mpeg stream for direct playback
   */
  app.post(
    '/api/lexara/tts/stream',
    isAuthenticated,
    asyncHandler(async (req: Request, res: Response) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ error: 'Text is required for TTS synthesis' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text too long. Maximum 5000 characters.' });

      try {
        const result = await synthesizeLexaraSpeechWithFailover(text);
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', result.audioData.length);
        res.setHeader('X-Provider', result.provider);
        res.setHeader('X-Voice-Id', result.voiceId || 'adaptive');
        res.setHeader('X-TTS-Model', result.model);
        res.setHeader('X-Audio-Duration', '0');
        return res.send(result.audioData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[VoiceRoutes] TTS mesh exhausted', { error: message });
        return res.status(503).json({
          error: 'TTS synthesis failed',
          message: 'All compatible LEXARA voice routes are temporarily unavailable.',
        });
      }
    }),
  );

  /**
   * GET /api/lexara/voice/profile
   * Validate the configured ElevenLabs voice and expose non-secret lifecycle
   * metadata so the production voice can be verified before use/training work.
   */
  app.get(
    '/api/lexara/voice/profile',
    asyncHandler(async (_req: Request, res: Response) => {
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
      if (!apiKey || !voiceId) {
        return res.status(503).json({
          available: false,
          provider: 'elevenlabs',
          reason: 'not_configured',
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
          {
            method: 'GET',
            headers: { 'xi-api-key': apiKey },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 400);
          log.warn('[VoiceRoutes] Configured ElevenLabs voice validation failed', {
            voiceId,
            status: response.status,
            detail,
          });
          return res.status(response.status === 404 ? 404 : 502).json({
            available: false,
            provider: 'elevenlabs',
            voiceId,
            reason: 'voice_validation_failed',
            status: response.status,
          });
        }

        const voice = await response.json() as {
          name?: string;
          category?: string;
          is_owner?: boolean;
          fine_tuning?: {
            state?: Record<string, string> | string;
            verification_failures?: string[];
          };
          labels?: Record<string, string>;
          settings?: {
            stability?: number;
            similarity_boost?: number;
            style?: number;
            use_speaker_boost?: boolean;
          };
        };

        return res.json({
          available: true,
          provider: 'elevenlabs',
          voiceId,
          name: voice.name || null,
          category: voice.category || null,
          isOwner: voice.is_owner ?? null,
          fineTuning: voice.fine_tuning?.state ?? null,
          verificationFailures: voice.fine_tuning?.verification_failures?.length || 0,
          labels: voice.labels || {},
          settings: voice.settings || null,
          productionModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',
          professionalClone:
            String(voice.category || '').toLowerCase().includes('professional')
            || String(voice.category || '').toLowerCase().includes('cloned'),
        });
      } catch (error) {
        log.warn('[VoiceRoutes] ElevenLabs voice validation request failed', {
          voiceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(502).json({
          available: false,
          provider: 'elevenlabs',
          voiceId,
          reason: 'voice_validation_unreachable',
        });
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  /**
   * GET /api/lexara/voice/providers
   * Get available voice synthesis providers (ElevenLabs only)
   */
  app.get(
    '/api/lexara/voice/providers',
    asyncHandler(async (_req: Request, res: Response) => {
      const readiness = getLexaraTTSReadiness();
      return res.json({
        providers: readiness.providers,
        configuredProviders: readiness.configuredProviders,
        healthyProviders: readiness.healthyProviders,
        default: readiness.healthyProviders[0] || null,
        available: readiness.available,
      });
    }),
  );

  /**
   * GET /api/lexara/voice/status
   * Get voice synthesis system status
   */
  app.get(
    '/api/lexara/voice/status',
    asyncHandler(async (_req: Request, res: Response) => {
      const readiness = getLexaraTTSReadiness();
      return res.json({
        available: readiness.available,
        provider: readiness.healthyProviders[0] || null,
        configuredProviders: readiness.configuredProviders,
        healthyProviders: readiness.healthyProviders,
        providers: readiness.providers,
        features: {
          adaptiveRouting: true,
          routeLocalFailover: true,
          quotaAwareCooldown: true,
          multipleAcousticRoutes: true,
        },
      });
    }),
  );

  warmLexaraTTSMesh();
  log.info('[VoiceRoutes] Voice synthesis routes configured with verified adaptive multi-provider TTS mesh');
}
