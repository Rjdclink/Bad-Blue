/**
 * LUXARA API Routes
 * Backend endpoints for Luxara conversational AI
 */

import express, { Request, Response } from 'express';
import { createLogger } from '../logger';
import { callAIWithFallback } from '../aiSubAgent';
import { LUXARA_PERSONA } from '../../shared/luxaraVoicePersona';

const router = express.Router();
const log = createLogger('LuxaraRoutes');

/**
 * POST /api/luxara/chat
 * Main chat endpoint for Luxara conversational AI
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
    
    log.info('[LUXARA] Chat request received', {
      promptLength: prompt.length,
      hasPreviousMessages: !!context?.previousMessages?.length,
      behaviorMode: context?.behaviorMode,
    });
    
    // Build conversation history for context
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    // Add system prompt
    const finalSystemPrompt = systemPrompt || LUXARA_PERSONA.systemPrompt;
    messages.push({
      role: 'system',
      content: finalSystemPrompt,
    });
    
    // Add previous messages for context
    if (context?.previousMessages && Array.isArray(context.previousMessages)) {
      for (const msg of context.previousMessages.slice(-6)) {
        messages.push({
          role: msg.role === 'luxara' ? 'assistant' : 'user',
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
      log.error('[LUXARA] AI call failed', { error: aiResponse.error });
      return res.status(500).json({
        success: false,
        error: 'Failed to generate response',
      });
    }
    
    log.info('[LUXARA] Chat response generated', {
      responseLength: aiResponse.content.length,
      model: aiResponse.model,
    });
    
    return res.json({
      success: true,
      response: aiResponse.content,
      model: aiResponse.model,
    });
    
  } catch (error) {
    log.error('[LUXARA] Chat endpoint error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/luxara/status
 * Get Luxara system status
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'active',
    persona: {
      name: LUXARA_PERSONA.identity.name,
      role: LUXARA_PERSONA.identity.role,
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
 * POST /api/luxara/analyze-signals
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
    const { analyzeUserSignals } = require('../../shared/luxaraVoicePersona');
    const analysis = analyzeUserSignals(text, voiceMetrics, bodyLanguage);
    
    return res.json({
      success: true,
      analysis,
    });
    
  } catch (error) {
    log.error('[LUXARA] Signal analysis error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
