/**
 * Legal Counsel API Routes
 * REST endpoints for intelligent legal consultation system
 * Phase 1A: Backend infrastructure
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  createSession,
  getSession,
  getUserSessions,
  updateSessionContext,
  mergeSessionContext,
  addMessage,
  getSessionMessages,
  updateMessageVerification,
  addSuggestion,
  getSessionSuggestions,
  updateSuggestionStatus,
  getFullSession,
  deleteSession,
  getSessionStats
} from '../services/legalCounselSessionManager';
import { factCheckClaim, quickFactCheck } from '../services/factCheckEngine';
import { getExpertProfile, generateExpertPrompt } from '../services/legalExpertSystem';
import { LAW_TYPES } from '../../shared/legalCounselTypes';

const router = Router();

// Valid US state codes
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
] as const;

// Validation schemas
const createSessionSchema = z.object({
  lawType: z.enum(LAW_TYPES),
  state: z.enum(US_STATE_CODES),
  initialContext: z.record(z.any()).optional()
});

const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  verified: z.boolean().optional(),
  verificationScore: z.number().min(0).max(100).optional(),
  citations: z.array(z.any()).optional()
});

const updateContextSchema = z.object({
  context: z.record(z.any())
});

const addSuggestionSchema = z.object({
  type: z.enum(['document', 'people-search', 'evidence-upload', 'next-step']),
  priority: z.enum(['high', 'medium', 'low']),
  data: z.record(z.any())
});

const factCheckSchema = z.object({
  claim: z.string().min(1),
  context: z.object({
    lawType: z.string(),
    state: z.enum(US_STATE_CODES),
    jurisdiction: z.string().optional()
  })
});

/**
 * POST /api/legal-counsel/sessions
 * Create a new legal counsel session
 */
router.post('/sessions', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = createSessionSchema.parse(req.body);
    
    const session = await createSession(
      req.user.id,
      validatedData.lawType,
      validatedData.state,
      validatedData.initialContext
    );

    res.status(201).json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /api/legal-counsel/sessions/:sessionId
 * Get session details
 */
router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = await getSession(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify ownership
    if (session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(session);
  } catch (error) {
    console.error('[LegalCounsel] Get session error:', error);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

/**
 * GET /api/legal-counsel/sessions/:sessionId/full
 * Get complete session with messages and suggestions
 */
router.get('/sessions/:sessionId/full', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const fullSession = await getFullSession(req.params.sessionId);
    
    if (!fullSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify ownership
    if (fullSession.session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(fullSession);
  } catch (error) {
    console.error('[LegalCounsel] Get full session error:', error);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

/**
 * GET /api/legal-counsel/sessions
 * Get all sessions for authenticated user
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const sessions = await getUserSessions(req.user.id, limit);

    res.json(sessions);
  } catch (error) {
    console.error('[LegalCounsel] Get user sessions error:', error);
    res.status(500).json({ error: 'Failed to retrieve sessions' });
  }
});

/**
 * PUT /api/legal-counsel/sessions/:sessionId/context
 * Update session context
 */
router.put('/sessions/:sessionId/context', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = updateContextSchema.parse(req.body);
    
    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const merge = req.query.merge === 'true';
    const updated = merge
      ? await mergeSessionContext(req.params.sessionId, validatedData.context)
      : await updateSessionContext(req.params.sessionId, validatedData.context);

    if (!updated) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Update context error:', error);
    res.status(500).json({ error: 'Failed to update context' });
  }
});

/**
 * POST /api/legal-counsel/sessions/:sessionId/messages
 * Add a message to session
 */
router.post('/sessions/:sessionId/messages', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = addMessageSchema.parse(req.body);
    
    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await addMessage(
      req.params.sessionId,
      validatedData.role,
      validatedData.content,
      {
        verified: validatedData.verified,
        verificationScore: validatedData.verificationScore,
        citations: validatedData.citations
      }
    );

    res.status(201).json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Add message error:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

/**
 * GET /api/legal-counsel/sessions/:sessionId/messages
 * Get session messages
 */
router.get('/sessions/:sessionId/messages', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const messages = await getSessionMessages(req.params.sessionId, limit);

    res.json(messages);
  } catch (error) {
    console.error('[LegalCounsel] Get messages error:', error);
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

/**
 * POST /api/legal-counsel/sessions/:sessionId/suggestions
 * Add a suggestion to session
 */
router.post('/sessions/:sessionId/suggestions', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = addSuggestionSchema.parse(req.body);
    
    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const suggestion = await addSuggestion(
      req.params.sessionId,
      validatedData.type,
      validatedData.priority,
      validatedData.data
    );

    res.status(201).json(suggestion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Add suggestion error:', error);
    res.status(500).json({ error: 'Failed to add suggestion' });
  }
});

/**
 * GET /api/legal-counsel/sessions/:sessionId/suggestions
 * Get session suggestions
 */
router.get('/sessions/:sessionId/suggestions', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = req.query.status as 'pending' | 'accepted' | 'dismissed' | undefined;
    const suggestions = await getSessionSuggestions(req.params.sessionId, status);

    res.json(suggestions);
  } catch (error) {
    console.error('[LegalCounsel] Get suggestions error:', error);
    res.status(500).json({ error: 'Failed to retrieve suggestions' });
  }
});

/**
 * PATCH /api/legal-counsel/suggestions/:suggestionId
 * Update suggestion status
 */
router.patch('/suggestions/:suggestionId', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { status } = req.body;
    if (!['pending', 'accepted', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = await updateSuggestionStatus(req.params.suggestionId, status);
    
    if (!updated) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('[LegalCounsel] Update suggestion error:', error);
    res.status(500).json({ error: 'Failed to update suggestion' });
  }
});

/**
 * DELETE /api/legal-counsel/sessions/:sessionId
 * Delete a session
 */
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await deleteSession(req.params.sessionId);
    res.status(204).send();
  } catch (error) {
    console.error('[LegalCounsel] Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

/**
 * GET /api/legal-counsel/sessions/:sessionId/stats
 * Get session statistics
 */
router.get('/sessions/:sessionId/stats', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify ownership
    const session = await getSession(req.params.sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await getSessionStats(req.params.sessionId);
    res.json(stats);
  } catch (error) {
    console.error('[LegalCounsel] Get stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

/**
 * POST /api/legal-counsel/fact-check
 * Fact-check a legal claim using multi-AI verification
 */
router.post('/fact-check', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = factCheckSchema.parse(req.body);
    const result = await factCheckClaim(validatedData);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Fact-check error:', error);
    res.status(500).json({ error: 'Failed to fact-check claim' });
  }
});

/**
 * POST /api/legal-counsel/quick-fact-check
 * Quick fact-check using single model (faster, lower confidence)
 */
router.post('/quick-fact-check', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = factCheckSchema.parse(req.body);
    const result = await quickFactCheck(validatedData);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('[LegalCounsel] Quick fact-check error:', error);
    res.status(500).json({ error: 'Failed to fact-check claim' });
  }
});

/**
 * GET /api/legal-counsel/expert-profile/:lawType
 * Get expert profile for a law type
 */
router.get('/expert-profile/:lawType', async (req: Request, res: Response) => {
  try {
    const profile = getExpertProfile(req.params.lawType);
    res.json(profile);
  } catch (error) {
    console.error('[LegalCounsel] Get expert profile error:', error);
    res.status(500).json({ error: 'Failed to retrieve expert profile' });
  }
});

/**
 * POST /api/legal-counsel/expert-prompt
 * Generate expert system prompt
 */
router.post('/expert-prompt', async (req: Request, res: Response) => {
  try {
    const { lawType, state, context } = req.body;
    
    if (!lawType || !state) {
      return res.status(400).json({ error: 'lawType and state are required' });
    }

    const prompt = generateExpertPrompt(lawType, state, context);
    res.json({ prompt });
  } catch (error) {
    console.error('[LegalCounsel] Generate prompt error:', error);
    res.status(500).json({ error: 'Failed to generate prompt' });
  }
});

export default router;
