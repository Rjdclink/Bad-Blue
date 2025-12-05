/**
 * F.M.I. (Forensic Media Intelligence) API Routes
 * 
 * Unified endpoint for all F.M.I. operations:
 * - File upload and secure storage
 * - OCR and text extraction
 * - Content classification
 * - Legal relevance tagging
 * - Contradiction/corroboration detection
 * - Case-linking and contextualization
 * - Comprehensive evidence intelligence reports
 */

import { type Express, type Request, type Response, Router } from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { z } from 'zod';
import { pool } from '../db';
import { isAuthenticated } from '../auth';
import { asyncHandler } from '../errorHandler';
import { createLogger } from '../logger';
import { isValidLawType, LAW_TYPES, type LawType } from '@shared/lawTypes';
import { apiRateLimit } from '../rateLimit'; // Add rate limiting
import { 
  analyzeFMIEvidence,
  extractFMIIntelligence,
  classifyFMIEvidence,
  type FMIFile,
  type FMIAnalysisResult
} from '../fmiIntelligenceTool';

const log = createLogger('FMI-Routes');
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

// ============================================================================
// MULTER CONFIGURATION - F.M.I. File Upload
// ============================================================================

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'fmi');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `fmi-${uniqueSuffix}${ext}`);
  }
});

// F.M.I. accepts all supported media types
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
    // Videos
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm',
    // Audio
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    // Email
    'message/rfc822',
    'application/vnd.ms-outlook'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`F.M.I. does not support file type: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max - F.M.I. handles large media files
  },
});

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const fmiAnalyzeSchema = z.object({
  file: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number(),
    uploadDate: z.string().or(z.date()),
    url: z.string().optional(),
    metadata: z.record(z.any()).optional()
  }),
  lawType: z.enum(LAW_TYPES),
  state: z.enum(US_STATE_CODES),
  caseContext: z.string().optional()
});

// ============================================================================
// F.M.I. ROUTES
// ============================================================================

export function setupFMIRoutes(app: Express): void {
  
  /**
   * POST /api/fmi/upload
   * Upload file to F.M.I. for forensic intelligence analysis
   * Rate limited to prevent abuse
   * 
   * Body (multipart/form-data):
   * - file: The file to upload
   * - lawType: Law type ID (optional)
   * - associatedWith: 'consultation' | 'document' (optional)
   */
  app.post(
    '/api/fmi/upload',
    apiRateLimit, // Rate limiting for upload endpoint
    isAuthenticated,
    upload.single('file'),
    asyncHandler(async (req: any, res: Response) => {
      const file = req.file;
      const { lawType, associatedWith } = req.body;
      const userId = req.user?.id;

      if (!file) {
        return res.status(400).json({ error: 'F.M.I. requires a file to upload' });
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required for F.M.I. operations' });
      }

      // Validate law type if provided
      if (lawType && !isValidLawType(lawType)) {
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({ error: 'Invalid law type for F.M.I. analysis' });
      }

      // Validate associatedWith if provided
      const validAssociations = ['consultation', 'document'];
      if (associatedWith && !validAssociations.includes(associatedWith)) {
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({ error: 'Invalid association type for F.M.I.' });
      }

      log.info('[F.M.I.] File upload initiated', { 
        fileName: file.originalname, 
        fileSize: file.size,
        userId 
      });

      try {
        // Store file metadata in database with F.M.I. fields
        const result = await pool.query(
          `INSERT INTO evidence_files (
            user_id, file_name, file_type, file_size, storage_path, 
            law_type, associated_with, fmi_analysis_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') 
          RETURNING *`,
          [
            userId,
            file.originalname,
            file.mimetype,
            file.size,
            file.path,
            lawType || null,
            associatedWith || null,
          ]
        );

        const evidenceFile = result.rows[0];

        log.info('[F.M.I.] File stored successfully', { 
          fileId: evidenceFile.id,
          fileName: file.originalname 
        });

        res.json({
          success: true,
          message: 'File uploaded to F.M.I. successfully',
          file: {
            id: evidenceFile.id,
            name: evidenceFile.file_name,
            type: evidenceFile.file_type,
            size: evidenceFile.file_size,
            uploadedAt: evidenceFile.uploaded_at,
            fmiAnalysisStatus: evidenceFile.fmi_analysis_status,
          },
        });
      } catch (error) {
        log.error('[F.M.I.] Failed to store file', { error });
        // Clean up uploaded file on database error
        await fs.unlink(file.path).catch(() => {});
        throw error;
      }
    })
  );

  /**
   * POST /api/fmi/analyze
   * Analyze file using F.M.I. intelligence engine
   * Rate limited to prevent abuse
   */
  app.post(
    '/api/fmi/analyze',
    apiRateLimit, // Rate limiting for analysis endpoint
    isAuthenticated,
    asyncHandler(async (req: Request, res: Response) => {
      const validation = fmiAnalyzeSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          error: 'F.M.I. analysis validation failed', 
          details: validation.error 
        });
      }

      const { file, lawType, state, caseContext } = validation.data;

      log.info('[F.M.I.] Analysis requested', { 
        fileId: file.id, 
        fileName: file.name,
        lawType,
        state 
      });

      try {
        const fmiFile: FMIFile = {
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          uploadDate: new Date(file.uploadDate),
          url: file.url,
          metadata: file.metadata
        };

        const analysis = await analyzeFMIEvidence(
          fmiFile,
          lawType as LawType,
          state,
          caseContext
        );

        // Update database with F.M.I. analysis results
        await pool.query(
          `UPDATE evidence_files SET
            fmi_analysis_status = 'completed',
            fmi_analyzed_at = NOW(),
            extracted_text = $1,
            content_classification = $2,
            legal_relevance_tags = $3,
            legal_issues_identified = $4,
            evidence_strength = $5,
            admissibility_assessment = $6,
            key_findings = $7
          WHERE id = $8`,
          [
            analysis.extracted.facts.join('\n'),
            JSON.stringify(analysis.classification),
            analysis.extracted.facts.slice(0, 10), // Store top facts as tags
            analysis.legalSignificance.relevantTo,
            analysis.strength.overall,
            analysis.classification.admissibility,
            analysis.keyFindings,
            file.id
          ]
        );

        log.info('[F.M.I.] Analysis completed and stored', { 
          fileId: file.id,
          factsExtracted: analysis.extracted.facts.length 
        });

        res.json({
          success: true,
          message: 'F.M.I. analysis completed',
          analysis
        });
      } catch (error) {
        log.error('[F.M.I.] Analysis failed', { error, fileId: file.id });
        
        // Update status to failed
        await pool.query(
          `UPDATE evidence_files SET fmi_analysis_status = 'failed' WHERE id = $1`,
          [file.id]
        ).catch(() => {});
        
        throw error;
      }
    })
  );

  /**
   * GET /api/fmi/files
   * Get all F.M.I. files for authenticated user
   * Rate limited for data protection
   */
  app.get(
    '/api/fmi/files',
    apiRateLimit, // Rate limiting for file list
    isAuthenticated,
    asyncHandler(async (req: any, res: Response) => {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await pool.query(
        `SELECT 
          id, file_name, file_type, file_size, uploaded_at,
          law_type, associated_with, fmi_analysis_status, 
          fmi_analyzed_at, evidence_strength, admissibility_assessment,
          key_findings
        FROM evidence_files 
        WHERE user_id = $1 
        ORDER BY uploaded_at DESC`,
        [userId]
      );

      res.json({
        success: true,
        files: result.rows
      });
    })
  );

  /**
   * GET /api/fmi/files/:id
   * Get detailed F.M.I. analysis for a specific file
   * Rate limited for data protection
   */
  app.get(
    '/api/fmi/files/:id',
    apiRateLimit, // Rate limiting for file detail
    isAuthenticated,
    asyncHandler(async (req: any, res: Response) => {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await pool.query(
        `SELECT * FROM evidence_files WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'F.M.I. file not found' });
      }

      const file = result.rows[0];

      res.json({
        success: true,
        file: {
          id: file.id,
          name: file.file_name,
          type: file.file_type,
          size: file.file_size,
          uploadedAt: file.uploaded_at,
          lawType: file.law_type,
          associatedWith: file.associated_with,
          fmiAnalysisStatus: file.fmi_analysis_status,
          fmiAnalyzedAt: file.fmi_analyzed_at,
          extractedText: file.extracted_text,
          contentClassification: file.content_classification,
          legalRelevanceTags: file.legal_relevance_tags,
          legalIssuesIdentified: file.legal_issues_identified,
          contradictions: file.contradictions,
          corroboration: file.corroboration,
          caseLinkages: file.case_linkages,
          evidenceStrength: file.evidence_strength,
          admissibilityAssessment: file.admissibility_assessment,
          keyFindings: file.key_findings
        }
      });
    })
  );

  log.info('[F.M.I.] Routes initialized successfully');
}

// Backward compatibility exports
export { setupFMIRoutes as setupUploadRoutes };
export { setupFMIRoutes as setupEvidenceRoutes };
