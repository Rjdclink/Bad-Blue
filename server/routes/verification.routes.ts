/**
 * Verification Routes
 * 
 * Endpoints to verify job completion and retrieve persisted data
 * for Pantheon, Inmate Search, People Search, and Lexara
 */

import express, { Request, Response } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';

const router = express.Router();

// ============================================
// PANTHEON / PEOPLE SEARCH VERIFICATION
// ============================================

/**
 * GET /api/verify/people-search/:reportId
 * Get a specific people search report by ID
 */
router.get('/people-search/:reportId', async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    
    const report = await storage.getPeopleSearchReport(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }
    
    return res.json({
      success: true,
      report,
      jobCompleted: report.status === 'completed' || report.status === 'failed',
      jobStatus: report.status,
    });
  } catch (error) {
    logger.error('[Verify] People search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve report',
    });
  }
});

/**
 * GET /api/verify/people-search/user/:userId
 * Get all people search reports for a user
 */
router.get('/people-search/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const requestedLimit = parseInt(req.query.limit as string) || 50;
    // Prevent DoS attacks with extremely large limits
    const limit = Math.min(requestedLimit, 1000);
    
    const reports = await storage.getUserPeopleSearchReports(userId, limit);
    
    return res.json({
      success: true,
      reports,
      count: reports.length,
    });
  } catch (error) {
    logger.error('[Verify] User people search history error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve reports',
    });
  }
});

// ============================================
// INMATE SEARCH VERIFICATION
// ============================================

/**
 * GET /api/verify/inmate-search/:reportId
 * Get a specific inmate search report by ID
 */
router.get('/inmate-search/:reportId', async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    
    const report = await storage.getInmateSearchReport(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }
    
    return res.json({
      success: true,
      report,
      jobCompleted: report.status === 'completed' || report.status === 'failed',
      jobStatus: report.status,
    });
  } catch (error) {
    logger.error('[Verify] Inmate search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve report',
    });
  }
});

/**
 * GET /api/verify/inmate-search/user/:userId
 * Get all inmate search reports for a user
 */
router.get('/inmate-search/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const requestedLimit = parseInt(req.query.limit as string) || 50;
    // Prevent DoS attacks with extremely large limits
    const limit = Math.min(requestedLimit, 1000);
    
    const reports = await storage.getUserInmateSearchReports(userId, limit);
    
    return res.json({
      success: true,
      reports,
      count: reports.length,
    });
  } catch (error) {
    logger.error('[Verify] User inmate search history error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve reports',
    });
  }
});

// ============================================
// LEXARA CONVERSATION VERIFICATION
// ============================================

/**
 * GET /api/verify/lexara/:conversationId
 * Get a specific Lexara conversation by ID
 */
router.get('/lexara/:conversationId', async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await storage.getLexaraConversation(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }
    
    return res.json({
      success: true,
      conversation,
      jobCompleted: true,
      jobStatus: 'completed',
    });
  } catch (error) {
    logger.error('[Verify] Lexara conversation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversation',
    });
  }
});

/**
 * GET /api/verify/lexara/user/:userId
 * Get all Lexara conversations for a user
 */
router.get('/lexara/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const requestedLimit = parseInt(req.query.limit as string) || 50;
    // Prevent DoS attacks with extremely large limits
    const limit = Math.min(requestedLimit, 1000);
    
    const conversations = await storage.getUserLexaraConversations(userId, limit);
    
    return res.json({
      success: true,
      conversations,
      count: conversations.length,
    });
  } catch (error) {
    logger.error('[Verify] User Lexara history error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversations',
    });
  }
});

/**
 * GET /api/verify/lexara/session/:sessionId
 * Get all Lexara conversations in a session
 */
router.get('/lexara/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const requestedLimit = parseInt(req.query.limit as string) || 100;
    // Prevent DoS attacks with extremely large limits
    const limit = Math.min(requestedLimit, 1000);
    
    const conversations = await storage.getLexaraConversationsBySession(sessionId, limit);
    
    return res.json({
      success: true,
      conversations,
      count: conversations.length,
    });
  } catch (error) {
    logger.error('[Verify] Session Lexara history error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversations',
    });
  }
});

// ============================================
// SYSTEM-WIDE HEALTH CHECK
// ============================================

/**
 * GET /api/verify/health
 * Check database connectivity and system health
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Try to query database
    const userCount = await storage.getTotalUserCount();
    
    return res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      userCount,
    });
  } catch (error) {
    logger.error('[Verify] Health check failed:', error);
    return res.status(500).json({
      success: false,
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
