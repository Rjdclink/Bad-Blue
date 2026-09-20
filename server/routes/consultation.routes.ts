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
import PDFDocument from 'pdfkit';
import archiver from 'archiver';

const log = createLogger('ConsultationRoutes');
const MAX_FMI_CONTEXT_CHARACTERS = 8_000;

function serializeFmiContext(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;

  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const trimmed = serialized.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, MAX_FMI_CONTEXT_CHARACTERS);
  } catch {
    return undefined;
  }
}

function withFmiEvidenceContext(situation: string, fmiContext: unknown): string {
  const serialized = serializeFmiContext(fmiContext);
  if (!serialized) return situation;

  return `${situation}\n\nF.M.I. EVIDENCE ANALYSIS PROVIDED BY THE PLATFORM:\n${serialized}\n\nTreat the F.M.I. material as extracted/advisory evidence context only. Do not treat it as controlling legal authority, do not assume an extraction is correct merely because F.M.I. produced it, and distinguish it from facts independently supplied by the user.`;
}

const LEGAL_DOCUMENT_TYPES = [
  'Motion', 'Supporting Brief', 'Memorandum of Law', 'Complaint', 'Answer', 'Counterclaim',
  'Interrogatories', 'Request for Production', 'Request for Admission', 'Discovery Response',
  'Affidavit', 'Declaration', 'Demand Letter', 'Cease and Desist Letter', 'Settlement Proposal',
  'Settlement Agreement', 'Motion to Suppress', 'Motion to Dismiss', 'Motion to Compel',
  'Motion for Continuance', 'Bond or Bail Motion', 'Sentencing Memorandum',
  'Post-Conviction Motion', 'Notice of Appeal', 'Appellate Brief', 'Habeas Petition',
  'FOIA or Public Records Request', 'Contract or Agreement', 'Release or Waiver',
  'Legal Research Memorandum', 'Case Chronology', 'Witness Summary', 'Deposition Outline',
  'Witness List', 'Exhibit List', 'Proposed Jury Instructions', 'Motion in Limine',
  'Trial Brief', 'Proposed Order', 'Client Letter', 'Administrative Appeal',
  'Landlord-Tenant Notice', 'Family-Law Pleading', 'Probate or Estate Document',
  'Business Governance Document', 'Immigration Support Letter', 'Custom Document',
] as const;

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function setupConsultationRoutes(app: Express): void {
  
  app.get('/api/lexara/documents/types', isAuthenticated, (_req, res) => {
    res.json({ types: LEGAL_DOCUMENT_TYPES });
  });

  app.post('/api/lexara/documents/generate', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';
    const facts = typeof req.body?.facts === 'string' ? req.body.facts.trim() : '';
    const requestedType = typeof req.body?.documentType === 'string' ? req.body.documentType.trim() : '';
    const customInstructions = typeof req.body?.instructions === 'string' ? req.body.instructions.trim() : '';
    if (!state || !facts || !requestedType) return res.status(400).json({ error: 'Jurisdiction, case facts, and document type are required' });
    if (facts.length > 30_000 || customInstructions.length > 8_000) return res.status(413).json({ error: 'Document request is too large' });

    const draftingPrompt = [
      `Prepare a professional ${requestedType} for a matter in ${state}.`,
      'Use ONLY facts supplied below. Never invent names, dates, courts, case numbers, quotations, authorities, procedural posture, or requested relief.',
      'Where a required fact is unknown, insert a conspicuous bracketed placeholder such as [COURT NAME NEEDED].',
      'Use conventional legal-document structure appropriate to the requested document, with a caption placeholder when court filing format is applicable.',
      'Do not claim the document is ready to file; local court rules, citations, deadlines, signatures, service, and filing requirements require human verification.',
      customInstructions ? `Additional user instructions: ${customInstructions}` : '',
      `CASE FACTS:\n${facts}`,
    ].filter(Boolean).join('\n\n');

    const document = await analyzeLegalIssue(draftingPrompt, state, undefined, req.body?.lawType);
    return res.json({
      title: requestedType,
      document,
      jurisdiction: state,
      reviewRequired: true,
      notice: 'Draft generated from supplied facts. Verify facts, authorities, local rules, deadlines, signatures, service, and filing requirements before use.',
    });
  }));

  app.post('/api/lexara/documents/export', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const title = String(req.body?.title || 'Lexara Legal Document').trim().slice(0, 160);
    const content = String(req.body?.content || '').trim();
    const format = String(req.body?.format || '').toLowerCase();
    if (!content) return res.status(400).json({ error: 'Document content is required' });
    if (content.length > 200_000) return res.status(413).json({ error: 'Document is too large to export' });
    const safeBase = (title || 'lexara-document').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'lexara-document';

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.pdf"`);
      const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 }, info: { Title: title } });
      pdf.pipe(res);
      pdf.font('Times-Roman').fontSize(12).text(content, { lineGap: 4, align: 'left' });
      pdf.end();
      return;
    }
    if (format === 'docx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.docx"`);
      const zip = archiver('zip', { zlib: { level: 9 } });
      zip.on('error', err => { throw err; });
      zip.pipe(res);
      const paragraphs = content.split(/\n/).map(line => `<w:p><w:pPr><w:spacing w:after="120" w:line="480" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r></w:p>`).join('');
      zip.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`, { name: '[Content_Types].xml' });
      zip.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`, { name: '_rels/.rels' });
      zip.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`, { name: 'word/document.xml' });
      await zip.finalize();
      return;
    }
    return res.status(400).json({ error: 'Export format must be pdf or docx' });
  }));

  /**
   * POST /api/legal-consultation
   * Analyze a legal issue with AI-powered consultation
   * 
   * Body:
   * - state: State where the issue occurred (required)
   * - situation: Description of the legal situation (required)
   * - lawType: Law type for specialized expertise (optional, Stage 3)
   * - fmiContext: Optional structured F.M.I. evidence analysis
   * 
   * Response:
   * - analysis: AI-generated legal guidance
   */
  app.post(
    '/api/legal-consultation',
    isAuthenticated,
    asyncHandler(async (req: Request, res: Response) => {
      const { state, situation, lawType, fmiContext } = req.body;

      // Validation
      if (!state || typeof state !== 'string') {
        return res.status(400).json({ error: 'State is required' });
      }

      if (!situation || typeof situation !== 'string' || situation.trim().length === 0) {
        return res.status(400).json({ error: 'Situation description is required' });
      }

      const consultationSituation = withFmiEvidenceContext(situation.trim(), fmiContext);

      try {
        log.info('Legal consultation requested', {
          state,
          lawType: lawType || 'general',
          situationLength: situation.length,
          hasFmiContext: !!serializeFmiContext(fmiContext),
        });

        // Use comprehensive consultation engine if lawType is provided (Stage 1B enhancement)
        // Otherwise fall back to original analysis (backward compatibility)
        if (lawType) {
          const consultationResult = await performConsultation(
            consultationSituation,
            lawType as LawType,
            state,
            {
              includeQuestions: true,
              verifyAll: false, // Model consensus is not primary-authority verification.
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
            consultationSituation,
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
    isAuthenticated,
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
