/**
 * LEXARA API Routes
 * Backend endpoints for LEXARA conversational AI
 * 
 * A7 - LOCK LEXARA INTO TRUE "PERSONA MODE"
 * Permanent, Stable, Feminine, Non-Robotic
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { callAIWithFallback } from '../aiSubAgent';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';
import { LEXARA_KERNEL, mergePersonaWithKernel } from '../lexara/personaKernel';

const router = express.Router();
const log = createLogger('LEXARARoutes');

/**
 * POST /api/lexara/chat
 * Main chat endpoint for LEXARA conversational AI
 * Force-merges LEXARA_KERNEL to ensure persona consistency
 * 
 * Returns:
 * - response: Lexara's text response
 * - audio: Audio data as base64 or audioUrl for playback
 * - If ElevenLabs TTS is unavailable, returns text only
 */
router.post('/chat', express.json(), async (req: Request, res: Response) => {
  try {
    const { prompt, context, systemPrompt, includeAudio = true } = req.body;
    
    // Force-merge LEXARA_KERNEL into persona - stops the "default robot" voice from ever appearing
    req.body.persona = mergePersonaWithKernel(req.body.persona);
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }
    
    log.info('[LEXARA] Chat request received with persona kernel', {
      promptLength: prompt.length,
      hasPreviousMessages: !!context?.previousMessages?.length,
      behaviorMode: context?.behaviorMode,
      personaName: LEXARA_KERNEL.identity.name,
      includeAudio,
    });
    
    // Build conversation history for context
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    // Add system prompt
    const finalSystemPrompt = systemPrompt || LEXARA_PERSONA.systemPrompt;
    messages.push({
      role: 'system',
      content: finalSystemPrompt,
    });
    
    // Add previous messages for context
    if (context?.previousMessages && Array.isArray(context.previousMessages)) {
      for (const msg of context.previousMessages.slice(-6)) {
        messages.push({
          role: msg.role === 'lexara' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }
    
    // Add current prompt
    messages.push({
      role: 'user',
      content: prompt,
    });
    
    // Build prompt string from messages for AI fallback
    const conversationPrompt = messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n\n');
    
    // Call AI with fallback support
    const aiResponse = await callAIWithFallback(conversationPrompt, {
      systemPrompt: finalSystemPrompt,
      temperature: 0.7,
      maxTokens: 1000,
    });
    
    if (!aiResponse.success || !aiResponse.content) {
      log.error('[LEXARA] AI call failed', { error: aiResponse.error });
      return res.status(500).json({
        success: false,
        error: 'Failed to generate response',
      });
    }
    
    log.info('[LEXARA] Chat response generated', {
      responseLength: aiResponse.content.length,
      model: aiResponse.model,
    });
    
    // Generate audio using ElevenLabs TTS if requested
    let audioData: { audioUrl?: string; audioBase64?: string; mimeType?: string; durationMs?: number } | null = null;
    
    if (includeAudio) {
      try {
        // Import the TTS router
        const { synthesizeLexaraSpeech } = await import('../lexara/LexaraTTSRouter');
        
        const ttsResult = await synthesizeLexaraSpeech({
          text: aiResponse.content,
          context: 'general',
        });
        
        // Return audio as base64 for client playback
        audioData = {
          audioBase64: ttsResult.audioData.toString('base64'),
          mimeType: ttsResult.mimeType,
          durationMs: ttsResult.durationMs,
        };
        
        log.info('[LEXARA] TTS synthesis complete', {
          provider: 'elevenlabs',
          voiceId: ttsResult.voiceId,
          audioByteLength: ttsResult.audioByteLength,
          durationMs: ttsResult.durationMs,
        });
        
      } catch (ttsError) {
        // Log the error but don't fail the request - return text without audio
        log.warn('[LEXARA] TTS synthesis failed, returning text only', { 
          error: ttsError instanceof Error ? ttsError.message : 'Unknown error' 
        });
      }
    }

    // Persist conversation to database
    const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
    const sessionId = context?.sessionId || null;
    let conversationId: string | null = null;

    try {
      const { storage } = await import('../storage');
      const conversation = await storage.createLexaraConversation({
        userId,
        sessionId,
        userPrompt: prompt,
        lexaraResponse: aiResponse.content,
        audioGenerated: !!audioData,
        audioBase64: audioData?.audioBase64 || undefined,
        audioDurationMs: audioData?.durationMs || undefined,
        model: aiResponse.model,
        context: context || null,
      });
      conversationId = conversation.id;

      log.info('[LEXARA] Conversation persisted', {
        conversationId,
        userId,
        sessionId,
      });
    } catch (dbError) {
      log.error('[LEXARA] Failed to persist conversation', { error: dbError });
      // Continue even if persistence fails - don't block the response
    }
    
    return res.json({
      success: true,
      response: aiResponse.content,
      model: aiResponse.model,
      audio: audioData,
      conversationId,
      jobCompleted: true,
      jobStatus: 'completed',
    });
    
  } catch (error) {
    log.error('[LEXARA] Chat endpoint error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      jobCompleted: true,
      jobStatus: 'failed',
    });
  }
});

/**
 * GET /api/lexara/status
 * Get LEXARA system status with persona kernel info
 */
router.get('/status', (req: Request, res: Response) => {
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
      modes: ['personable', 'professional'],
      personaLocked: true,
    },
  });
});

/**
 * POST /api/lexara/voice
 * Voice synthesis endpoint with persona kernel
 */
router.post('/voice', express.json(), async (req: Request, res: Response) => {
  try {
    const { text, context, emotionalState } = req.body;
    
    // Force-merge LEXARA_KERNEL into persona
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
    
    // Return voice configuration for client-side TTS
    // The client will use server TTS (LexaraServerTTS) when available
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

/**
 * POST /api/lexara/analyze-signals
 * Analyze user signals for adaptive behavior (optional server-side analysis)
 */
router.post('/analyze-signals', express.json(), (req: Request, res: Response) => {
  try {
    const { text, voiceMetrics, bodyLanguage } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required',
      });
    }
    
    // Import and use the signal analyzer
    // This mirrors the client-side analysis for consistency
    const { analyzeUserSignals } = require('../../shared/lexaraVoicePersona');
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
