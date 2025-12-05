/**
 * Document Generation Routes
 * Stage 2B: Universal legal document generation endpoints
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { generateLegalDocument, type DocumentType } from '../universalDocumentGenerator';
import { LAW_TYPES, type LawType } from '../../shared/legalCounselTypes';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('DocumentRoutes');

// Valid US state codes
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
] as const;

const DOCUMENT_TYPES: DocumentType[] = [
  'complaint',
  'petition',
  'motion',
  'brief',
  'affidavit',
  'contract',
  'agreement',
  'letter',
  'notice',
  'discovery-request',
  'discovery-response',
  'memorandum',
  'order',
  'pleading',
  'application',
  'answer',
  'counterclaim',
  'cross-claim',
  'summons',
  'subpoena'
];

// Validation schema
const generateDocumentSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES as [DocumentType, ...DocumentType[]]),
  lawType: z.enum(LAW_TYPES),
  state: z.enum(US_STATE_CODES),
  courtLevel: z.enum(['federal-district', 'federal-circuit', 'federal-supreme', 'state-trial', 'state-appellate', 'state-supreme', 'administrative']).optional(),
  courtName: z.string().optional(),
  plaintiff: z.string().optional(),
  defendant: z.string().optional(),
  parties: z.array(z.object({
    name: z.string(),
    role: z.string()
  })).optional(),
  caseNumber: z.string().optional(),
  caseName: z.string().optional(),
  judge: z.string().optional(),
  facts: z.string().min(10),
  legalBasis: z.string().min(10),
  relief: z.string().optional(),
  includeTableOfContents: z.boolean().optional(),
  includeTableOfAuthorities: z.boolean().optional(),
  citationStyle: z.enum(['bluebook', 'alwd', 'local']).optional(),
  pageLimit: z.number().min(1).max(100).optional(),
  urgency: z.enum(['emergency', 'expedited', 'standard']).optional(),
  tone: z.enum(['aggressive', 'balanced', 'conciliatory']).optional(),
  verifyAll: z.boolean().optional()
});

/**
 * POST /api/documents/generate
 * Generate a legal document
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = generateDocumentSchema.parse(req.body);
    
    log.info('Document generation requested', {
      userId: req.user.id,
      documentType: validatedData.documentType,
      lawType: validatedData.lawType,
      state: validatedData.state
    });

    const document = await generateLegalDocument(validatedData);

    log.info('Document generation completed', {
      userId: req.user.id,
      documentType: validatedData.documentType,
      wordCount: document.metadata.wordCount,
      pageEstimate: document.metadata.pageEstimate
    });

    res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data', 
        details: error.errors 
      });
    }
    log.error('[DocumentGeneration] Generation error:', error);
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

/**
 * GET /api/documents/types
 * Get list of available document types
 */
router.get('/types', async (req: Request, res: Response) => {
  try {
    const documentTypes = DOCUMENT_TYPES.map(type => ({
      id: type,
      name: type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' '),
      category: categorizeDocumentType(type)
    }));

    res.json(documentTypes);
  } catch (error) {
    log.error('[DocumentGeneration] Get types error:', error);
    res.status(500).json({ error: 'Failed to retrieve document types' });
  }
});

/**
 * GET /api/documents/types/:lawType
 * Get recommended document types for a specific law area
 */
router.get('/types/:lawType', async (req: Request, res: Response) => {
  try {
    const lawType = req.params.lawType as LawType;
    
    if (!LAW_TYPES.includes(lawType)) {
      return res.status(400).json({ error: 'Invalid law type' });
    }

    const recommendedTypes = getRecommendedDocumentTypes(lawType);
    
    res.json(recommendedTypes);
  } catch (error) {
    log.error('[DocumentGeneration] Get recommended types error:', error);
    res.status(500).json({ error: 'Failed to retrieve recommended types' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Categorize document type
 */
function categorizeDocumentType(type: DocumentType): string {
  const categories: Record<string, DocumentType[]> = {
    'Pleadings': ['complaint', 'petition', 'answer', 'counterclaim', 'cross-claim', 'pleading'],
    'Motions & Briefs': ['motion', 'brief', 'memorandum'],
    'Discovery': ['discovery-request', 'discovery-response', 'subpoena'],
    'Evidence': ['affidavit'],
    'Contracts': ['contract', 'agreement'],
    'Correspondence': ['letter', 'notice'],
    'Court Orders': ['order', 'summons'],
    'Applications': ['application']
  };

  for (const [category, types] of Object.entries(categories)) {
    if (types.includes(type)) {
      return category;
    }
  }
  
  return 'Other';
}

/**
 * Get recommended document types for a law area
 */
function getRecommendedDocumentTypes(lawType: LawType): Array<{
  type: DocumentType;
  name: string;
  description: string;
  commonUse: string;
}> {
  const allRecommendations: Partial<Record<LawType, Array<{
    type: DocumentType;
    name: string;
    description: string;
    commonUse: string;
  }>>> = {
    'criminal-law': [
      {
        type: 'motion',
        name: 'Motion',
        description: 'Motion to suppress evidence, dismiss charges, etc.',
        commonUse: 'Pre-trial and trial motions'
      },
      {
        type: 'brief',
        name: 'Brief',
        description: 'Legal memorandum supporting motion or appeal',
        commonUse: 'Appellate briefs, trial briefs'
      },
      {
        type: 'affidavit',
        name: 'Affidavit',
        description: 'Sworn statement of facts',
        commonUse: 'Supporting motions, evidence'
      }
    ],
    'family-law': [
      {
        type: 'petition',
        name: 'Petition',
        description: 'Petition for divorce, custody, support',
        commonUse: 'Initiating family law cases'
      },
      {
        type: 'motion',
        name: 'Motion',
        description: 'Motion for temporary orders, enforcement',
        commonUse: 'Requesting court orders'
      },
      {
        type: 'affidavit',
        name: 'Affidavit',
        description: 'Declaration of income, custody facts',
        commonUse: 'Supporting petitions and motions'
      }
    ],
    'contract-law': [
      {
        type: 'contract',
        name: 'Contract',
        description: 'Legal agreement between parties',
        commonUse: 'Creating binding agreements'
      },
      {
        type: 'agreement',
        name: 'Agreement',
        description: 'Less formal arrangement',
        commonUse: 'Settlement, partnership agreements'
      },
      {
        type: 'letter',
        name: 'Demand Letter',
        description: 'Letter demanding performance or payment',
        commonUse: 'Pre-litigation dispute resolution'
      }
    ]
  };

  return allRecommendations[lawType] || [
    {
      type: 'complaint',
      name: 'Complaint',
      description: 'Initial pleading to start lawsuit',
      commonUse: 'Filing civil lawsuit'
    },
    {
      type: 'motion',
      name: 'Motion',
      description: 'Request for court order',
      commonUse: 'Various procedural requests'
    },
    {
      type: 'letter',
      name: 'Legal Letter',
      description: 'Professional correspondence',
      commonUse: 'Demands, notices, responses'
    }
  ];
}

export default router;
