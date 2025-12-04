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
   * POST /api/legal-consultation
   * Analyze a legal issue with AI-powered consultation
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
