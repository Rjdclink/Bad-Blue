/**
 * LEXARA API Routes
 * Backend endpoints for LEXARA conversational AI
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { callAIWithFallback } from '../aiSubAgent';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';

const router = express.Router();
const log = createLogger('LEXARARoutes');

/**
 * POST /api/lexara/chat
 * Main chat endpoint for LEXARA conversational AI
 */
router.post('/chat', express.json(), async (req: Request, res: Response) => {
  try {
    const { prompt, context, systemPrompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }
    
    log.info('[LEXARA] Chat request received', {
      promptLength: prompt.length,
      hasPreviousMessages: !!context?.previousMessages?.length,
      behaviorMode: context?.behaviorMode,
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
    
    // Call AI with fallback support
    const aiResponse = await callAIWithFallback({
      messages,
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
    
    return res.json({
      success: true,
      response: aiResponse.content,
      model: aiResponse.model,
    });
    
  } catch (error) {
    log.error('[LEXARA] Chat endpoint error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/lexara/status
 * Get LEXARA system status
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'active',
    persona: {
      name: LEXARA_PERSONA.name,
      traits: LEXARA_PERSONA.traits,
    },
    capabilities: {
      voice: true,
      video: true,
      adaptiveBehavior: true,
      modes: ['personable', 'professional'],
    },
  });
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
