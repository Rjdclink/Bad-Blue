/**
 * Evidence Intelligence Routes
 * Stage 3B: API endpoints for evidence processing and analysis
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { 
  analyzeEvidence, 
  generateComprehensiveEvidenceReport,
  type EvidenceFile 
} from '../evidenceIntelligenceTool';
import { LAW_TYPES, type LawType } from '../../shared/legalCounselTypes';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('EvidenceRoutes');

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
const analyzeEvidenceSchema = z.object({
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

const comprehensiveReportSchema = z.object({
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number(),
    uploadDate: z.string().or(z.date()),
    url: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })),
  lawType: z.enum(LAW_TYPES),
  state: z.enum(US_STATE_CODES),
  caseContext: z.string().optional()
});

/**
 * POST /api/evidence/analyze
 * Analyze a single evidence file
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = analyzeEvidenceSchema.parse(req.body);
    
    log.info('Evidence analysis requested', {
      userId,
      fileName: validatedData.file.name,
      lawType: validatedData.lawType,
      state: validatedData.state
    });

    // Convert uploadDate to Date if it's a string
    const file: EvidenceFile = {
      ...validatedData.file,
      uploadDate: typeof validatedData.file.uploadDate === 'string' 
        ? new Date(validatedData.file.uploadDate)
        : validatedData.file.uploadDate
    };

    const analysis = await analyzeEvidence(
      file,
      validatedData.lawType,
      validatedData.state,
      validatedData.caseContext
    );

    log.info('Evidence analysis completed', {
      userId,
      fileName: validatedData.file.name,
      strength: analysis.strength.overall
    });

    res.json(analysis);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data', 
        details: error.errors 
      });
    }
    log.error('[Evidence] Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze evidence' });
  }
});

/**
 * POST /api/evidence/comprehensive-report
 * Generate comprehensive report for multiple evidence files
 */
router.post('/comprehensive-report', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = comprehensiveReportSchema.parse(req.body);
    
    log.info('Comprehensive evidence report requested', {
      userId,
      filesCount: validatedData.files.length,
      lawType: validatedData.lawType,
      state: validatedData.state
    });

    // Convert uploadDates to Date objects
    const files: EvidenceFile[] = validatedData.files.map(f => ({
      ...f,
      uploadDate: typeof f.uploadDate === 'string' ? new Date(f.uploadDate) : f.uploadDate
    }));

    const report = await generateComprehensiveEvidenceReport(
      files,
      validatedData.lawType,
      validatedData.state,
      validatedData.caseContext
    );

    log.info('Comprehensive evidence report completed', {
      userId,
      filesAnalyzed: report.filesAnalyzed,
      overallStrength: report.overallStrength.overall,
      hasConflicts: report.conflicts.hasConflicts
    });

    res.json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data', 
        details: error.errors 
      });
    }
    log.error('[Evidence] Comprehensive report error:', error);
    res.status(500).json({ error: 'Failed to generate comprehensive report' });
  }
});

/**
 * GET /api/evidence/supported-types
 * Get list of supported evidence file types
 */
router.get('/supported-types', async (req: Request, res: Response) => {
  try {
    const supportedTypes = [
      {
        category: 'Documents',
        types: [
          { mime: 'application/pdf', extension: '.pdf', name: 'PDF Document' },
          { mime: 'application/msword', extension: '.doc', name: 'Word Document' },
          { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx', name: 'Word Document (Modern)' },
          { mime: 'text/plain', extension: '.txt', name: 'Text File' }
        ]
      },
      {
        category: 'Images',
        types: [
          { mime: 'image/jpeg', extension: '.jpg', name: 'JPEG Image' },
          { mime: 'image/png', extension: '.png', name: 'PNG Image' },
          { mime: 'image/gif', extension: '.gif', name: 'GIF Image' }
        ]
      },
      {
        category: 'Video',
        types: [
          { mime: 'video/mp4', extension: '.mp4', name: 'MP4 Video' },
          { mime: 'video/quicktime', extension: '.mov', name: 'QuickTime Video' }
        ]
      },
      {
        category: 'Audio',
        types: [
          { mime: 'audio/mpeg', extension: '.mp3', name: 'MP3 Audio' },
          { mime: 'audio/wav', extension: '.wav', name: 'WAV Audio' }
        ]
      }
    ];

    res.json(supportedTypes);
  } catch (error) {
    log.error('[Evidence] Get supported types error:', error);
    res.status(500).json({ error: 'Failed to retrieve supported types' });
  }
});

export default router;
