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
import { createLogger } from '../logger';
import { isAuthenticated } from '../auth';
import { getLexaraTTSReadiness, getLexaraVoiceProfileBindings, openLexaraSpeechStream, refreshLexaraTTSReadiness, synthesizeLexaraSpeechWithFailover, warmLexaraTTSMesh } from '../lexara/LexaraTTSMesh';
import { issueLexaraRealtimeVoiceTicket } from '../lexara/LexaraRealtimeVoiceGateway';

const log = createLogger('VoiceRoutes');

interface LexaraTTSStreamSession {
  text: string;
  createdAt: number;
  attempts: number;
  turnId: string | null;
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
   * POST /api/lexara/realtime-ticket
   * Mint a short-lived, one-use ticket for the same-origin duplex WebSocket.
   * Browser code never receives the Deepgram credential.
   */
  app.post('/api/lexara/realtime-ticket', isAuthenticated, (req: Request, res: Response) => {
    const deepgramConfigured = !!(process.env.DEEPGRAM_API_KEY?.trim() || process.env.DEEPGRAM?.trim());
    if (!deepgramConfigured) {
      return res.status(503).json({
        success: false,
        error: 'LEXARA realtime voice is not configured',
      });
    }

    const subject = typeof (req.user as any)?.id === 'string'
      ? String((req.user as any).id)
      : typeof (req.user as any)?.claims?.sub === 'string'
        ? String((req.user as any).claims.sub)
        : null;
    const ticket = issueLexaraRealtimeVoiceTicket(subject);
    return res.json({
      success: true,
      ...ticket,
      endpoint: '/api/lexara/realtime',
      provider: 'deepgram-flux',
    });
  });

  /**
   * POST /api/lexara/voice/playback-event
   * Browser playback telemetry for diagnosing mobile buffer starvation and
   * distinguishing intentional barge-in from media stalls.
   */
  app.post('/api/lexara/voice/playback-event', (req: Request, res: Response) => {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim().slice(0, 32) : '';
    const allowed = new Set([
      'play',
      'playing',
      'waiting',
      'stalled',
      'ended',
      'error',
      'interrupted',
      'realtime-first-audio',
      'realtime-playing',
      'realtime-interrupted',
      'realtime-ended',
      'avatar-renderer-ready',
      'avatar-motion-started',
      'avatar-renderer-error',
      'tts-session-ready',
    ]);
    if (!allowed.has(event)) return res.status(204).end();

    log.info('[LEXARA Audio] playback event', {
      event,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 32) : null,
      currentTime: Number.isFinite(Number(req.body?.currentTime)) ? Number(req.body.currentTime) : null,
      readyState: Number.isFinite(Number(req.body?.readyState)) ? Number(req.body.readyState) : null,
      networkState: Number.isFinite(Number(req.body?.networkState)) ? Number(req.body.networkState) : null,
      paused: typeof req.body?.paused === 'boolean' ? req.body.paused : null,
      source: req.body?.source === 'buffered'
        ? 'buffered'
        : req.body?.source === 'realtime'
          ? 'realtime'
          : 'streaming',
      provider: typeof req.body?.provider === 'string' ? req.body.provider.slice(0, 80) : null,
      turnId: typeof req.body?.turnId === 'string' ? req.body.turnId.slice(0, 120) : null,
      startupMs: Number.isFinite(Number(req.body?.startupMs)) ? Number(req.body.startupMs) : null,
      totalMs: Number.isFinite(Number(req.body?.totalMs)) ? Number(req.body.totalMs) : null,
      playbackOffsetMs: Number.isFinite(Number(req.body?.playbackOffsetMs)) ? Number(req.body.playbackOffsetMs) : null,
      renderedFrames: Number.isFinite(Number(req.body?.renderedFrames)) ? Number(req.body.renderedFrames) : null,
      renderer: typeof req.body?.renderer === 'string' ? req.body.renderer.slice(0, 64) : null,
      reducedMotion: typeof req.body?.reducedMotion === 'boolean' ? req.body.reducedMotion : null,
      mode: typeof req.body?.mode === 'string' ? req.body.mode.slice(0, 24) : null,
      mouthOpen: Number.isFinite(Number(req.body?.mouthOpen)) ? Number(req.body.mouthOpen) : null,
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
      const turnId = typeof req.body?.turnId === 'string'
        ? req.body.turnId.trim().slice(0, 120) || null
        : null;
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
      lexaraTTSStreamSessions.set(id, { text, createdAt: Date.now(), attempts: 0, turnId });
      return res.json({
        success: true,
        audioUrl: `/api/lexara/tts/session/${id}`,
        provider: readiness.streamingProviders[0] || readiness.healthyProviders[0] || 'adaptive-tts-mesh',
        providers: readiness.healthyProviders,
        streamingProviders: readiness.streamingProviders,
        independentDomains: readiness.independentDomains,
        redundancyVerified: readiness.redundancyVerified,
        voiceStatus: readiness.voiceStatus,
        voiceId: null,
        model: 'adaptive',
        turnId,
      });
    }),
  );

  /**
   * GET /api/lexara/tts/session/:id
   * Proxy a verified provider's progressive audio response directly to the browser.
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
        const progressive = await openLexaraSpeechStream(session.text);
        if (progressive) {
          lexaraTTSStreamSessions.delete(id);
          res.status(200);
          res.setHeader('Content-Type', progressive.mimeType);
          res.setHeader('Cache-Control', 'no-store, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('X-Provider', progressive.provider);
          res.setHeader('X-Voice-Id', progressive.voiceId || 'adaptive');
          res.setHeader('X-TTS-Model', progressive.model);
          res.setHeader('X-TTS-First-Byte-Ms', String(progressive.firstByteLatencyMs));
          if (session.turnId) res.setHeader('X-Lexara-Turn-Id', session.turnId);
          // Make the progressive response visible before provider bytes arrive.
          // This preserves the direct pipe and gives the mobile media element
          // its earliest possible chance to begin buffering.
          res.flushHeaders();

          const nodeStream = Readable.fromWeb(progressive.body as any);
          const close = () => {
            if (!nodeStream.destroyed) nodeStream.destroy();
          };
          req.once('close', close);
          nodeStream.once('error', error => {
            log.warn('[VoiceRoutes] Progressive TTS stream ended with transport error', {
              provider: progressive.provider,
              model: progressive.model,
              error: error instanceof Error ? error.message : String(error),
            });
            if (!res.headersSent) {
              res.status(502).end();
            } else if (!res.writableEnded) {
              res.end();
            }
          });
          nodeStream.once('end', () => {
            req.off('close', close);
          });
          nodeStream.pipe(res);
          return;
        }

        // No verified progressive route was available. Fall back locally to the
        // canonical buffered mesh rather than surfacing an outage to the user.
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
        if (session.turnId) res.setHeader('X-Lexara-Turn-Id', session.turnId);
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
   * Canonical non-secret LEXARA voice profile plus optional ElevenLabs metadata.
   * ElevenLabs is one reserve route, never the profile authority.
   */
  app.get(
    '/api/lexara/voice/profile',
    asyncHandler(async (_req: Request, res: Response) => {
      const readiness = getLexaraTTSReadiness();
      const canonicalProfile = getLexaraVoiceProfileBindings();
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

      let elevenLabs: Record<string, unknown> = {
        configured: Boolean(apiKey && voiceId),
        available: readiness.healthyProviders.includes('elevenlabs'),
        voiceId: voiceId || null,
      };

      if (apiKey && voiceId) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4_000);
        try {
          const response = await fetch(
            `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
            {
              method: 'GET',
              headers: { 'xi-api-key': apiKey },
              signal: controller.signal,
            },
          );

          if (response.ok) {
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
            elevenLabs = {
              ...elevenLabs,
              reachable: true,
              name: voice.name || null,
              category: voice.category || null,
              isOwner: voice.is_owner ?? null,
              fineTuning: voice.fine_tuning?.state ?? null,
              verificationFailures: voice.fine_tuning?.verification_failures?.length || 0,
              labels: voice.labels || {},
              settings: voice.settings || null,
              productionModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',
            };
          } else {
            elevenLabs = {
              ...elevenLabs,
              reachable: false,
              validationStatus: response.status,
            };
          }
        } catch {
          elevenLabs = { ...elevenLabs, reachable: false };
        } finally {
          clearTimeout(timer);
        }
      }

      return res.json({
        available: readiness.available,
        voiceStatus: readiness.voiceStatus,
        redundancyVerified: readiness.redundancyVerified,
        independentDomains: readiness.independentDomains,
        profile: canonicalProfile,
        healthyProviders: readiness.healthyProviders,
        providers: readiness.providers,
        elevenLabs,
      });
    }),
  );

  /**
   * GET /api/lexara/voice/providers
   * Get available voice synthesis providers from the canonical adaptive mesh
   */
  app.get(
    '/api/lexara/voice/providers',
    asyncHandler(async (_req: Request, res: Response) => {
      const readiness = getLexaraTTSReadiness();
      return res.json({
        providers: readiness.providers,
        configuredProviders: readiness.configuredProviders,
        healthyProviders: readiness.healthyProviders,
        streamingProviders: readiness.streamingProviders,
        independentDomains: readiness.independentDomains,
        redundancyVerified: readiness.redundancyVerified,
        voiceStatus: readiness.voiceStatus,
        default: readiness.streamingProviders[0] || readiness.healthyProviders[0] || null,
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
        degraded: readiness.degraded,
        redundancyVerified: readiness.redundancyVerified,
        voiceStatus: readiness.voiceStatus,
        provider: readiness.streamingProviders[0] || readiness.healthyProviders[0] || null,
        configuredProviders: readiness.configuredProviders,
        healthyProviders: readiness.healthyProviders,
        streamingProviders: readiness.streamingProviders,
        independentDomains: readiness.independentDomains,
        providers: readiness.providers,
        features: {
          adaptiveRouting: true,
          routeLocalFailover: true,
          quotaAwareCooldown: true,
          multipleAcousticRoutes: true,
          progressiveStreaming: true,
          verifiedHotBackup: readiness.redundancyVerified,
        },
      });
    }),
  );

  warmLexaraTTSMesh();
  log.info('[VoiceRoutes] Voice synthesis routes configured with verified adaptive multi-provider TTS mesh');
}
