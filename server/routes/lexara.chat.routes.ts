/**
 * LEXARA API Routes
 * Conversational legal analysis + voice/persona endpoints.
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';
import { LEXARA_KERNEL, mergePersonaWithKernel } from '../lexara/personaKernel';
import { generateLexaraConversationResponse } from '../lexara/LexaraConversationOrchestrator';

const router = express.Router();
const log = createLogger('LEXARARoutes');

/**
 * POST /api/lexara/chat
 * Canonical conversational endpoint for LEXARA Live.
 *
 * The server owns the legal/system prompt. Client-provided system prompts are
 * intentionally ignored so an untrusted browser cannot replace legal accuracy,
 * citation, or persona constraints.
 */
router.post('/chat', express.json(), async (req: Request, res: Response) => {
  try {
    const { prompt, context = {}, includeAudio = true } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }

    log.info('[LEXARA] Conversational legal turn received', {
      promptLength: prompt.length,
      previousMessages: Array.isArray(context?.previousMessages) ? context.previousMessages.length : 0,
      lawType: context?.lawType,
      jurisdiction: context?.jurisdiction,
      includeAudio,
    });

    const conversationResult = await generateLexaraConversationResponse(prompt, {
      previousMessages: Array.isArray(context?.previousMessages) ? context.previousMessages : [],
      lawType: typeof context?.lawType === 'string' ? context.lawType : undefined,
      lawTypeName: typeof context?.lawTypeName === 'string' ? context.lawTypeName : undefined,
      jurisdiction: typeof context?.jurisdiction === 'string' ? context.jurisdiction : undefined,
      behaviorMode: context?.behaviorMode === 'personable' ? 'personable' : 'professional',
    });

    const responseText = conversationResult.text;
    const model = 'lexara-legal-orchestrator';

    log.info('[LEXARA] Conversational legal response generated', {
      responseLength: responseText.length,
      jurisdiction: conversationResult.jurisdiction,
      mappedLawType: conversationResult.mappedLawType,
    });

    let audioData: {
      audioUrl?: string;
      audioBase64?: string;
      mimeType?: string;
      durationMs?: number;
    } | null = null;

    // Backward-compatible path for callers that still request bundled audio.
    // LEXARA Live sends includeAudio:false and starts TTS immediately after text
    // arrives, which avoids serializing legal reasoning behind audio generation.
    if (includeAudio) {
      try {
        const { synthesizeLexaraSpeech } = await import('../lexara/LexaraTTSRouter');
        const ttsResult = await synthesizeLexaraSpeech({
          text: responseText,
          context: 'general',
        });

        audioData = {
          audioBase64: ttsResult.audioData.toString('base64'),
          mimeType: ttsResult.mimeType,
          durationMs: ttsResult.durationMs,
        };
      } catch (ttsError) {
        log.warn('[LEXARA] Bundled TTS unavailable; returning text', {
          error: ttsError instanceof Error ? ttsError.message : 'Unknown error',
        });
      }
    }

    const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
    const sessionId = context?.sessionId || null;
    let conversationId: string | null = null;
    let persistenceSuccess = true;

    try {
      const { storage } = await import('../storage');
      const conversation = await storage.createLexaraConversation({
        userId,
        sessionId,
        userPrompt: prompt,
        lexaraResponse: responseText,
        audioGenerated: !!audioData,
        audioBase64: audioData?.audioBase64 || undefined,
        audioDurationMs: audioData?.durationMs || undefined,
        model,
        context: {
          ...context,
          jurisdiction: conversationResult.jurisdiction || context?.jurisdiction || null,
          mappedLawType: conversationResult.mappedLawType || null,
        },
      });
      conversationId = conversation.id;
    } catch (dbError) {
      persistenceSuccess = false;
      log.error('[LEXARA] Failed to persist conversation', { error: dbError });
    }

    return res.json({
      success: true,
      response: responseText,
      model,
      audio: audioData,
      jurisdiction: conversationResult.jurisdiction,
      mappedLawType: conversationResult.mappedLawType,
      conversationId,
      persistenceSuccess,
      jobCompleted: true,
      jobStatus: 'completed',
    });
  } catch (error) {
    log.error('[LEXARA] Chat endpoint error', { error });
    return res.status(500).json({
      success: false,
      error: 'LEXARA could not complete the legal analysis for this turn',
      jobCompleted: true,
      jobStatus: 'failed',
    });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'active',
    kernel: {
      name: LEXARA_KERNEL.identity.name,
      age: LEXARA_KERNEL.identity.age,
      style: LEXARA_KERNEL.identity.style,
      speech: LEXARA_KERNEL.speech,
    },
    persona: {
      name: LEXARA_PERSONA.name,
      traits: LEXARA_PERSONA.traits,
    },
    capabilities: {
      voice: true,
      video: true,
      adaptiveBehavior: true,
      conversationalLegalOrchestrator: true,
      modes: ['personable', 'professional'],
      personaLocked: true,
    },
  });
});

router.post('/voice', express.json(), async (req: Request, res: Response) => {
  try {
    const { text, context, emotionalState } = req.body;
    req.body.persona = mergePersonaWithKernel(req.body.persona);

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required for voice synthesis',
      });
    }

    log.info('[LEXARA] Voice synthesis request', {
      textLength: text.length,
      context,
      emotionalState,
      personaTimbre: LEXARA_KERNEL.speech.timbre,
    });

    return res.json({
      success: true,
      text,
      voiceConfig: {
        timbre: LEXARA_KERNEL.speech.timbre,
        texture: LEXARA_KERNEL.speech.texture,
        pacing: LEXARA_KERNEL.speech.pacing,
        intonation: LEXARA_KERNEL.speech.intonation,
      },
      persona: LEXARA_KERNEL,
      emotionalState: emotionalState || 'neutral',
    });
  } catch (error) {
    log.error('[LEXARA] Voice synthesis error', { error });
    return res.status(500).json({
      success: false,
      error: 'Voice synthesis failed',
    });
  }
});

router.post('/analyze-signals', express.json(), async (req: Request, res: Response) => {
  try {
    const { text, voiceMetrics, bodyLanguage } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required',
      });
    }

    const { analyzeUserSignals } = await import('../../shared/lexaraVoicePersona');
    const analysis = analyzeUserSignals(text, voiceMetrics, bodyLanguage);

    return res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    log.error('[LEXARA] Signal analysis error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
