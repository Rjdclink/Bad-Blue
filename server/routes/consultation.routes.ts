/**
 * Stage 3: Legal Consultation Routes
 * Handles AI-powered legal consultations with law-specific expertise
 */

import { type Express, type Request, type Response } from 'express';
import { isAuthenticated } from '../auth';
import { asyncHandler } from '../errorHandler';
import { analyzeLegalIssue } from '../legalAI';
import { createLogger } from '../logger';

const log = createLogger('ConsultationRoutes');

export function setupConsultationRoutes(app: Express): void {
  
  /**
   * POST /api/legal-consultation/enhanced
   * Enhanced consultation with Governing Brain orchestration
   * 
   * Body:
   * - state: State where the issue occurred (required)
   * - situation: Description of the legal situation (required)  
   * - lawType: Law type for specialized expertise (required)
   * - additionalContext: Additional context (optional)
   * - evidence: Array of evidence objects (optional)
   * - parties: Plaintiff, defendant, witnesses (optional)
   * 
   * Response:
   * - Comprehensive consultation result with tool recommendations
   */
  app.post(
    '/api/legal-consultation/enhanced',
    asyncHandler(async (req: Request, res: Response) => {
      const { state, situation, lawType, additionalContext, evidence, parties } = req.body;

      // Validation
      if (!state || typeof state !== 'string') {
        return res.status(400).json({ error: 'State is required' });
      }

      if (!situation || typeof situation !== 'string' || situation.trim().length === 0) {
        return res.status(400).json({ error: 'Situation description is required' });
      }

      if (!lawType || typeof lawType !== 'string') {
        return res.status(400).json({ error: 'Law type is required' });
      }

      try {
        log.info('Enhanced legal consultation requested', {
          state,
          lawType,
          situationLength: situation.length,
          hasEvidence: !!evidence,
          hasParties: !!parties,
        });

        const { legalConsultationEngine } = await import('../services/legalConsultationEngine');

        const result = await legalConsultationEngine.consult({
          description: situation,
          state,
          lawType,
          additionalContext,
          evidence,
          parties,
        });

        log.info('Enhanced legal consultation completed', {
          state,
          lawType,
          confidence: result.confidence,
          completeness: result.completeness,
          issuesFound: result.issues.length,
          toolsRecommended: result.toolRecommendations.length,
        });

        res.json(result);
      } catch (error) {
        log.error('Enhanced legal consultation failed', { error, state, lawType });
        throw error;
      }
    })
  );

  /**
   * POST /api/legal-consultation
   * Standard AI-powered legal consultation (legacy)
   * 
   * Body:
   * - state: State where the issue occurred (required)
   * - situation: Description of the legal situation (required)
   * - lawType: Law type for specialized expertise (optional, Stage 3)
   * 
   * Response:
   * - analysis: AI-generated legal guidance
   */
  app.post(
    '/api/legal-consultation',
    asyncHandler(async (req: Request, res: Response) => {
      const { state, situation, lawType } = req.body;

      // Validation
      if (!state || typeof state !== 'string') {
        return res.status(400).json({ error: 'State is required' });
      }

      if (!situation || typeof situation !== 'string' || situation.trim().length === 0) {
        return res.status(400).json({ error: 'Situation description is required' });
      }

      try {
        log.info('Legal consultation requested', {
          state,
          lawType: lawType || 'general',
          situationLength: situation.length,
        });

        // Call AI analysis with law-specific expertise (Stage 3)
        const analysis = await analyzeLegalIssue(
          situation,
          state,
          undefined, // additionalContext
          lawType // Stage 3: law-specific expertise
        );

        log.info('Legal consultation completed', {
          state,
          lawType: lawType || 'general',
          responseLength: analysis.length,
        });

        res.json({
          analysis,
          lawType: lawType || null,
          state,
        });
      } catch (error) {
        log.error('Legal consultation failed', { error, state, lawType });
        throw error;
      }
    })
  );

  log.info('Consultation routes registered');
}
