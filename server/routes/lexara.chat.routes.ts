/**
 * LEXARA API Routes
 * Conversational legal analysis + voice/persona endpoints.
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';
import { LEXARA_KERNEL, mergePersonaWithKernel } from '../lexara/personaKernel';
import {
  generateLexaraConversationResponse,
  getLexaraImmediateAcknowledgement,
  type LexaraConversationMessage,
} from '../lexara/LexaraConversationOrchestrator';
import { MASTER_USER_ID } from '../masterPassword';
import { isAuthenticated } from '../auth';
import { getConfiguredHarmonyParticipants } from '../aiHarmonyModelRegistry';
import { isBlankLegalDocumentRequest, resolveLegalDocumentType } from '../lexara/legalDocumentRegistry';

const router = express.Router();
router.use(isAuthenticated);
const log = createLogger('LEXARARoutes');

const MAX_CHAT_PROMPT_CHARACTERS = 8_000;
const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_MESSAGE_CHARACTERS = 2_500;
const MAX_CONTEXT_FIELD_CHARACTERS = 128;

function cleanOptionalString(value: unknown, maxLength = MAX_CONTEXT_FIELD_CHARACTERS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function detectDocumentIntent(prompt: string, previousMessages: LexaraConversationMessage[] = []): {
  requested: boolean;
  explicit: boolean;
  documentType: string;
  templateMode: boolean;
} {
  const p = prompt.toLowerCase();
  const explicit = /\b(draft|prepare|create|generate|write|download|downloadable|export|pdf|docx|word document)\b/.test(p);
  const currentType = resolveLegalDocumentType(prompt);
  const currentAction = /\b(need|want|make|give|provide|prepare|draft|create|generate|write|download|export|file|filing|submit|serve|send)\b/.test(p);
  const referentialFollowup = /\b(it|that|one|document|form|template|blank|pdf|docx)\b/.test(p);

  // Current-turn document language is authoritative. If the user refers back
  // to "that demand/document/one", resolve the referent from the complete
  // conversational history, including a document LEXARA itself just offered.
  let historyType = null as ReturnType<typeof resolveLegalDocumentType>;
  if (!currentType) {
    for (const message of [...previousMessages].reverse()) {
      historyType = resolveLegalDocumentType(message.content);
      if (historyType) break;
    }
  }

  const requested = explicit
    || Boolean(currentType && currentAction)
    || Boolean(!currentType && historyType && referentialFollowup);

  return {
    requested,
    explicit,
    documentType: currentType || historyType || 'Custom Document',
    templateMode: isBlankLegalDocumentRequest(prompt),
  };
}

function sanitizePreviousMessages(value: unknown): LexaraConversationMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-MAX_HISTORY_MESSAGES)
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const role = (item as any).role;
      const content = (item as any).content;
      if (role !== 'user' && role !== 'lexara' && role !== 'assistant') return [];
      if (typeof content !== 'string' || !content.trim()) return [];
      return [{
        role,
        content: content.trim().slice(0, MAX_HISTORY_MESSAGE_CHARACTERS),
      } satisfies LexaraConversationMessage];
    });
}

/**
 * POST /api/lexara/acknowledge
 * Sub-LLM conversational lane. Returns immediately so LEXARA can speak a
 * context-aware acknowledgement while deeper legal/Harmony analysis runs.
 */
router.post('/acknowledge', express.json(), (req: Request, res: Response) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }
  if (prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
    return res.status(400).json({
      success: false,
      error: `Prompt must be ${MAX_CHAT_PROMPT_CHARACTERS} characters or fewer`,
    });
  }

  const analysisActive = req.body?.context?.analysisActive === true;
  const pendingAction = cleanOptionalString(req.body?.context?.pendingAction, 160);
  const acknowledgement = getLexaraImmediateAcknowledgement(prompt, { analysisActive, pendingAction });
  return res.json({
    success: true,
    acknowledgement: acknowledgement.text,
    terminal: acknowledgement.terminal,
    kind: acknowledgement.kind,
  });
});

/**
 * POST /api/lexara/chat/stream
 * Server-Sent Events transport for progressive Pantheon research.
 */
router.post('/chat/stream', express.json(), async (req: Request, res: Response) => {
  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
    return res.status(400).json({ success: false, error: 'Valid prompt is required' });
  }
  const rawContext = body.context && typeof body.context === 'object' ? body.context : {};
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, 15_000);
  req.once('aborted', () => controller.abort());
  res.once('close', () => controller.abort());
  try {
    send('started', { status: 'researching' });
    const previousMessages = sanitizePreviousMessages((rawContext as any).previousMessages);
    const documentIntent = detectDocumentIntent(prompt, previousMessages);
    const result = await generateLexaraConversationResponse(prompt, {
      previousMessages,
      lawType: cleanOptionalString((rawContext as any).lawType),
      lawTypeName: cleanOptionalString((rawContext as any).lawTypeName, 160),
      jurisdiction: cleanOptionalString((rawContext as any).jurisdiction, 80),
      behaviorMode: (rawContext as any).behaviorMode === 'personable' ? 'personable' : 'professional',
      sessionId: cleanOptionalString((rawContext as any).sessionId, 128),
      signal: controller.signal,
      onResearchProgress: event => send('research', event),
    });
    const reasoningDocumentIntent = detectDocumentIntent(result.text, [
      ...previousMessages,
      { role: 'user', content: prompt },
    ]);
    if (!documentIntent.requested && reasoningDocumentIntent.requested) {
      documentIntent.requested = true;
      if (documentIntent.documentType === 'Custom Document') {
        documentIntent.documentType = reasoningDocumentIntent.documentType;
      }
    }
    send('complete', {
      success: true,
      response: result.text,
      jurisdiction: result.jurisdiction,
      mappedLawType: result.mappedLawType,
      documentIntent,
    });
  } catch (error) {
    if (!controller.signal.aborted) send('error', { error: error instanceof Error ? error.message : 'LEXARA research failed' });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

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
    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const rawContext = body.context && typeof body.context === 'object' ? body.context : {};
    const includeAudio = typeof body.includeAudio === 'boolean' ? body.includeAudio : true;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }

    if (prompt.length > MAX_CHAT_PROMPT_CHARACTERS) {
      return res.status(400).json({
        success: false,
        error: `Prompt must be ${MAX_CHAT_PROMPT_CHARACTERS} characters or fewer`,
      });
    }

    const previousMessages = sanitizePreviousMessages((rawContext as any).previousMessages);
    const lawType = cleanOptionalString((rawContext as any).lawType);
    const lawTypeName = cleanOptionalString((rawContext as any).lawTypeName, 160);
    const jurisdiction = cleanOptionalString((rawContext as any).jurisdiction, 80);
    const behaviorMode = (rawContext as any).behaviorMode === 'personable' ? 'personable' : 'professional';
    const sessionId = cleanOptionalString((rawContext as any).sessionId, 128);
    const documentIntent = detectDocumentIntent(prompt, previousMessages);

    log.info('[LEXARA] Conversational legal turn received', {
      promptLength: prompt.length,
      previousMessages: previousMessages.length,
      lawType,
      jurisdiction,
      includeAudio,
    });

    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    const abortIfDisconnected = () => {
      if (!res.writableEnded) requestController.abort();
    };
    req.once('aborted', abortRequest);
    res.once('close', abortIfDisconnected);

    let conversationResult: Awaited<ReturnType<typeof generateLexaraConversationResponse>>;
    try {
      conversationResult = await generateLexaraConversationResponse(prompt, {
        previousMessages,
        lawType,
        lawTypeName,
        jurisdiction,
        behaviorMode,
        sessionId,
        signal: requestController.signal,
      });
    } finally {
      req.off('aborted', abortRequest);
      res.off('close', abortIfDisconnected);
    }

    const responseText = conversationResult.text;
    const model = 'lexara-legal-orchestrator';

    // Preserve the deterministic explicit-request fast path, but let LEXARA's
    // completed legal reasoning bridge an implicit document need into the
    // existing document workflow. This does not add another model call.
    const reasoningDocumentIntent = detectDocumentIntent(responseText, [
      ...previousMessages,
      { role: 'user', content: prompt },
    ]);
    if (!documentIntent.requested && reasoningDocumentIntent.requested) {
      documentIntent.requested = true;
      if (documentIntent.documentType === 'Custom Document') {
        documentIntent.documentType = reasoningDocumentIntent.documentType;
      }
    }

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
      provider?: string;
      model?: string;
      voiceId?: string | null;
    } | null = null;

    // Backward-compatible path for callers that still request bundled audio.
    // LEXARA Live sends includeAudio:false and starts TTS immediately after text
    // arrives, which avoids serializing legal reasoning behind audio generation.
    if (includeAudio) {
      try {
        const { synthesizeLexaraSpeechWithFailover } = await import('../lexara/LexaraTTSMesh');
        const ttsResult = await synthesizeLexaraSpeechWithFailover(responseText);

        audioData = {
          audioBase64: ttsResult.audioData.toString('base64'),
          mimeType: ttsResult.mimeType,
          provider: ttsResult.provider,
          model: ttsResult.model,
          voiceId: ttsResult.voiceId,
        };
      } catch (ttsError) {
        log.warn('[LEXARA] Bundled adaptive TTS unavailable; returning text', {
          error: ttsError instanceof Error ? ttsError.message : 'Unknown error',
        });
      }
    }

    const requestUserId = (req as any).user?.id || (req as any).user?.claims?.sub;
    const isMaster = Boolean((req as any).user?.isMasterBypass) || requestUserId === MASTER_USER_ID;

    // Master consultations are intentionally ephemeral. They are never written
    // to conversation storage, so login/relogin and law-area changes cannot
    // resurrect an earlier master matter from server-side history.
    if (!isMaster) {
      // Persistence is audit/recovery work, not conversational-path authority.
      // Return the legal turn immediately and persist asynchronously so a slow
      // database can never add dead air to LEXARA Live.
      void (async () => {
        try {
          const { storage } = await import('../storage');
          await storage.createLexaraConversation({
            userId: requestUserId,
            sessionId,
            userPrompt: prompt,
            lexaraResponse: responseText,
            audioGenerated: !!audioData,
            audioBase64: audioData?.audioBase64 || undefined,
            audioDurationMs: audioData?.durationMs || undefined,
            model,
            context: {
              lawType: lawType || null,
              jurisdiction: conversationResult.jurisdiction || jurisdiction || null,
              mappedLawType: conversationResult.mappedLawType || null,
              behaviorMode,
            },
          });
        } catch (dbError) {
          log.error('[LEXARA] Failed to persist conversation asynchronously', { error: dbError });
        }
      })();
    }

    return res.json({
      success: true,
      response: responseText,
      model,
      audio: audioData,
      jurisdiction: conversationResult.jurisdiction,
      mappedLawType: conversationResult.mappedLawType,
      conversationId: null,
      persistenceSuccess: null,
      persistenceStatus: isMaster ? 'master-ephemeral' : 'queued',
      jobCompleted: true,
      jobStatus: 'completed',
      documentIntent,
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
  const configuredHarmonyParticipants = getConfiguredHarmonyParticipants().length;
  res.json({
    success: true,
    status: 'active',
    harmony: {
      configuredParticipants: configuredHarmonyParticipants,
      expectedParticipants: 17,
      fullHarmonyConfigured: configuredHarmonyParticipants === 17,
      routing: 'capability-first',
    },
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
