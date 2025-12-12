/**
 * LEXARA API Routes (Consolidated)
 * 
 * All Lexara endpoints in a single router:
 * - /api/lexara/health - Health check
 * - /api/lexara/status - System status
 * - /api/lexara/chat - Chat endpoint
 * - /api/lexara/analyze-signals - Signal analysis
 * - /api/lexara/stream - WebRTC streaming
 * - /api/lexara/stream/signal - WebRTC signaling
 * - /api/lexara/stream/status - Stream session status
 * - /api/lexara/stream/config - WebRTC config
 */

import express, { Request, Response } from 'express';
import { logger, createLogger } from '../logger';
import { callAIWithFallback } from '../aiSubAgent';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';

const router = express.Router();
const log = createLogger('LEXARARoutes');

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

interface LexaraResponsePayload {
  success: boolean;
  response?: string;
  error?: string;
  model?: string;
  _diagnostic?: boolean;
}

/**
 * Validate Lexara AI response and return safe fallback if invalid
 */
function validateLexaraResponse(aiResponse: any): LexaraResponsePayload {
  // Check if response exists and has required fields
  if (!aiResponse) {
    log.warn('[LEXARA] AI response is null/undefined');
    return {
      success: false,
      error: 'Lexara encountered an internal error processing this request.',
      _diagnostic: true,
    };
  }

  if (!aiResponse.success) {
    log.warn('[LEXARA] AI response indicates failure', { error: aiResponse.error });
    return {
      success: false,
      error: aiResponse.error || 'Lexara encountered an internal error processing this request.',
      _diagnostic: true,
    };
  }

  if (!aiResponse.content || typeof aiResponse.content !== 'string') {
    log.warn('[LEXARA] AI response missing valid content', { aiResponse });
    return {
      success: false,
      error: 'Lexara encountered an internal error processing this request.',
      _diagnostic: true,
    };
  }

  // Valid response
  return {
    success: true,
    response: aiResponse.content,
    model: aiResponse.model,
  };
}

// Store active stream sessions
const activeSessions = new Map<string, {
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'initializing' | 'active' | 'paused' | 'ended';
}>();

// ============================================================================
// HEALTH & STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/lexara/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    source: 'lexara-router',
    timestamp: new Date().toISOString(),
  });
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

// ============================================================================
// CHAT ENDPOINTS
// ============================================================================

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
    
    // Get system prompt
    const finalSystemPrompt = systemPrompt || LEXARA_PERSONA.systemPrompt;
    
    // Add previous messages for context
    let conversationContext = '';
    if (context?.previousMessages && Array.isArray(context.previousMessages)) {
      for (const msg of context.previousMessages.slice(-6)) {
        const role = msg.role === 'lexara' ? 'LEXARA' : 'User';
        conversationContext += `${role}: ${msg.content}\n\n`;
      }
    }
    
    // Build the full prompt with context
    const fullPrompt = conversationContext 
      ? `Previous conversation:\n${conversationContext}\nUser: ${prompt}`
      : prompt;
    
    // Call AI with fallback support
    const aiResponse = await callAIWithFallback(fullPrompt, {
      systemPrompt: finalSystemPrompt,
      temperature: 0.7,
      maxTokens: 1000,
    });
    
    // Validate response and return safe fallback if invalid
    const validatedResponse = validateLexaraResponse(aiResponse);
    
    if (!validatedResponse.success) {
      return res.status(500).json(validatedResponse);
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
 * POST /api/lexara/analyze-signals
 * Analyze user signals for adaptive behavior
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

// ============================================================================
// STREAMING ENDPOINTS (WebRTC)
// ============================================================================

/**
 * GET /api/lexara/stream
 * Initialize a streaming session for LEXARA communication
 * Returns Server-Sent Events (SSE) stream
 */
router.get('/stream', (req: Request, res: Response) => {
  const sessionId = `lexara-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  
  logger.info('[LEXARA] Stream session initiated', { sessionId });
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Track the session
  activeSessions.set(sessionId, {
    sessionId,
    createdAt: new Date(),
    lastActivity: new Date(),
    status: 'active',
  });
  
  // Send initial connection event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    sessionId,
    status: 'connected',
    message: 'LEXARA stream initialized',
    capabilities: ['text', 'audio', 'video'],
    webrtcSupported: true,
  })}\n\n`);
  
  // Send periodic heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({
        sessionId,
        timestamp: new Date().toISOString(),
        status: 'alive',
      })}\n\n`);
    }
  }, 30000); // Every 30 seconds
  
  // Send ready event after brief initialization
  setTimeout(() => {
    res.write(`event: ready\n`);
    res.write(`data: ${JSON.stringify({
      sessionId,
      status: 'ready',
      message: 'LEXARA is ready for communication',
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })}\n\n`);
  }, 500);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    activeSessions.delete(sessionId);
    logger.info('[LEXARA] Stream session ended', { sessionId });
  });
});

/**
 * POST /api/lexara/stream/signal
 * Handle WebRTC signaling messages
 */
router.post('/stream/signal', express.json(), (req: Request, res: Response) => {
  const { sessionId, type, payload } = req.body;
  
  if (!sessionId || !type) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and type are required',
    });
  }
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found',
    });
  }
  
  logger.info('[LEXARA] Signal received', { sessionId, type });
  
  // Handle different signal types
  switch (type) {
    case 'offer':
      // In production, this would negotiate with a media server
      return res.json({
        success: true,
        type: 'answer',
        payload: {
          sdp: 'placeholder-sdp-answer',
          message: 'WebRTC answer placeholder - connect to media server for full functionality',
        },
      });
      
    case 'ice-candidate':
      // Acknowledge ICE candidate
      return res.json({
        success: true,
        type: 'ice-ack',
        message: 'ICE candidate received',
      });
      
    case 'close':
      activeSessions.delete(sessionId);
      return res.json({
        success: true,
        message: 'Session closed',
      });
      
    default:
      return res.json({
        success: true,
        message: `Signal type '${type}' acknowledged`,
      });
  }
});

/**
 * GET /api/lexara/stream/status
 * Get status of a streaming session
 */
router.get('/stream/status', (req: Request, res: Response) => {
  const { sessionId } = req.query;
  
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'sessionId query parameter required',
    });
  }
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.json({
      success: true,
      exists: false,
      message: 'Session not found or expired',
    });
  }
  
  return res.json({
    success: true,
    exists: true,
    session: {
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      uptime: Date.now() - session.createdAt.getTime(),
    },
  });
});

/**
 * GET /api/lexara/stream/config
 * Get WebRTC configuration for client
 */
router.get('/stream/config', (req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    },
    capabilities: {
      audio: true,
      video: true,
      dataChannel: true,
    },
    constraints: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    },
  });
});

export default router;
