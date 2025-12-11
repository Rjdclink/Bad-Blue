/**
 * Stage 3: Legal Consultation Routes
 * Handles AI-powered legal consultations with law-specific expertise
 * Enhanced Stage 1B: Integrated with comprehensive consultation engine
 */

import { type Express, type Request, type Response } from 'express';
import { isAuthenticated } from '../auth';
import { asyncHandler } from '../errorHandler';
import { analyzeLegalIssue } from '../legalAI';
import { conductMasterConsultation, shouldInvokePeopleFinder } from '../consultationCoordinator';
import { performConsultation } from '../legalConsultationEngine';
import { createLogger } from '../logger';
import type { LawType } from '../../shared/legalCounselTypes';

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

        // Use comprehensive consultation engine if lawType is provided (Stage 1B enhancement)
        // Otherwise fall back to original analysis (backward compatibility)
        if (lawType) {
          const consultationResult = await performConsultation(
            situation,
            lawType as LawType,
            state,
            {
              includeQuestions: true,
              verifyAll: false, // Set to true for full verification (more expensive)
              detailLevel: 'detailed'
            }
          );

          log.info('Comprehensive consultation completed', {
            state,
            lawType,
            causesIdentified: consultationResult.analysis.causesOfAction.length,
            nextSteps: consultationResult.nextSteps.length,
          });

          res.json({
            analysis: consultationResult.summary,
            lawType,
            state,
            // Enhanced Stage 1B data
            fullAnalysis: consultationResult.analysis,
            recommendations: consultationResult.recommendations,
            nextSteps: consultationResult.nextSteps,
            questions: consultationResult.questions,
            verified: consultationResult.verified,
            verificationDetails: consultationResult.verificationDetails
          });
        } else {
          // Backward compatibility: use original analysis method
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
        }
      } catch (error) {
        log.error('Legal consultation failed', { error, state, lawType });
        throw error;
      }
    })
  );

  /**
   * POST /api/enhanced-consultation
   * Enhanced consultation with tool coordination
   * 
   * Body:
   * - state: State where the issue occurred (required)
   * - situation: Description of the legal situation (required)
   * - lawType: Law type for specialized expertise (required)
   * - parties: Array of known party names (optional)
   * - evidenceUploaded: Boolean indicating if evidence is uploaded (optional)
   * 
   * Response:
   * - analysis: AI-generated legal guidance
   * - recommendations: Tool-specific recommendations
   * - identifiedParties: People to research
   * - documentsToGenerate: Documents to create
   * - suggestedActions: Prioritized action list
   * - nextSteps: Procedural guidance
   */
  app.post(
    '/api/enhanced-consultation',
    asyncHandler(async (req: Request, res: Response) => {
      const { state, situation, lawType, parties, evidenceUploaded } = req.body;

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
        log.info('Enhanced consultation requested', {
          state,
          lawType,
          situationLength: situation.length,
          hasParties: !!parties,
        });

        // Use master consultation coordinator
        const recommendations = await conductMasterConsultation({
          lawType,
          state,
          situation,
          parties: parties || [],
          evidenceUploaded: evidenceUploaded || false,
        });

        log.info('Enhanced consultation completed', {
          state,
          lawType,
          actionsCount: recommendations.suggestedActions.length,
          partiesIdentified: recommendations.identifiedParties.length,
        });

        res.json({
          analysis: recommendations.analysis,
          recommendations: recommendations.suggestedActions,
          identifiedParties: recommendations.identifiedParties,
          documentsToGenerate: recommendations.documentsToGenerate,
          nextSteps: recommendations.nextSteps,
          lawType,
          state,
        });
      } catch (error) {
        log.error('Enhanced consultation failed', { error, state, lawType });
        throw error;
      }
    })
  );

  log.info('Consultation routes registered');
}
