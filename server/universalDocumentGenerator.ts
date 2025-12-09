/**
 * Universal Legal Document Generator
 * Stage 2B Implementation: Multi-agent document generation for all legal instruments
 * 
 * Generates filing-ready legal documents across all 29 areas of law with:
 * - Court rules compliance
 * - Proper formatting and structure
 * - Fact and authority embedding
 * - Area-specific templates and requirements
 */

import { generateUserText, TaskPriority } from './aiProvider';
import { getExpertSystemConfig } from './legalCounselExpertSystem';
import { checkFact } from './factCheckingEngine';
import type { LawType } from '../shared/legalCounselTypes';
import { createLogger } from './logger';

const log = createLogger('DocumentGenerator');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_CITATIONS_FOR_VERIFICATION = 5; // Limit verification to most important citations
const VERIFICATION_SCORE_MULTIPLIER = 100; // Convert ratio to percentage
const VERIFICATION_PASS_THRESHOLD = 70; // 70% verification score required

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type DocumentType =
  | 'complaint'
  | 'petition'
  | 'motion'
  | 'brief'
  | 'affidavit'
  | 'contract'
  | 'agreement'
  | 'letter'
  | 'notice'
  | 'discovery-request'
  | 'discovery-response'
  | 'memorandum'
  | 'order'
  | 'pleading'
  | 'application'
  | 'answer'
  | 'counterclaim'
  | 'cross-claim'
  | 'summons'
  | 'subpoena';

export type CourtLevel = 'federal-district' | 'federal-circuit' | 'federal-supreme' | 'state-trial' | 'state-appellate' | 'state-supreme' | 'administrative';

export interface DocumentGenerationRequest {
  documentType: DocumentType;
  lawType: LawType;
  state: string;
  courtLevel?: CourtLevel;
  courtName?: string;
  
  // Parties
  plaintiff?: string;
  defendant?: string;
  parties?: Array<{ name: string; role: string }>;
  
  // Case information
  caseNumber?: string;
  caseName?: string;
  judge?: string;
  
  // Content
  facts: string;
  legalBasis: string;
  relief?: string;
  
  // Formatting preferences
  includeTableOfContents?: boolean;
  includeTableOfAuthorities?: boolean;
  citationStyle?: 'bluebook' | 'alwd' | 'local';
  pageLimit?: number;
  
  // Additional options
  urgency?: 'emergency' | 'expedited' | 'standard';
  tone?: 'aggressive' | 'balanced' | 'conciliatory';
  verifyAll?: boolean;
}

export interface GeneratedDocument {
  title: string;
  documentType: DocumentType;
  content: string;
  metadata: {
    lawType: LawType;
    state: string;
    court?: string;
    generatedAt: Date;
    wordCount: number;
    pageEstimate: number;
  };
  formatting: {
    hasCaption: boolean;
    hasSignatureBlock: boolean;
    hasCertification: boolean;
    hasTableOfContents: boolean;
    hasTableOfAuthorities: boolean;
  };
  citations: Array<{
    statute: string;
    caselaw?: string;
    regulation?: string;
  }>;
  verified: boolean;
  verificationScore?: number;
  warnings?: string[];
  suggestions?: string[];
}

// ============================================================================
// DOCUMENT STRUCTURE TEMPLATES
// ============================================================================

/**
 * Get document structure template based on type and jurisdiction
 */
function getDocumentStructure(
  documentType: DocumentType,
  lawType: LawType,
  state: string,
  courtLevel?: CourtLevel
): string {
  // Define common structures
  const structures: Record<DocumentType, string> = {
    'complaint': `
1. CAPTION (Court, parties, case number)
2. INTRODUCTION
3. JURISDICTION AND VENUE
4. PARTIES
5. STATEMENT OF FACTS
6. CAUSES OF ACTION (numbered counts)
   - Elements of each claim
   - Facts supporting each element
   - Legal authority
7. PRAYER FOR RELIEF
8. JURY DEMAND (if applicable)
9. VERIFICATION (if required)
10. SIGNATURE BLOCK
11. CERTIFICATE OF SERVICE`,

    'petition': `
1. CAPTION
2. TITLE OF PETITION
3. INTRODUCTION
4. JURISDICTION AND VENUE
5. PARTIES
6. STATEMENT OF FACTS
7. LEGAL BASIS AND GROUNDS
8. RELIEF REQUESTED
9. VERIFICATION
10. SIGNATURE BLOCK
11. CERTIFICATE OF SERVICE`,

    'motion': `
1. CAPTION
2. NOTICE OF MOTION
3. MEMORANDUM OF POINTS AND AUTHORITIES
   - Introduction
   - Statement of Facts
   - Legal Standard
   - Argument
   - Conclusion
4. PROPOSED ORDER
5. SIGNATURE BLOCK
6. CERTIFICATE OF SERVICE`,

    'brief': `
1. CAPTION
2. TABLE OF CONTENTS
3. TABLE OF AUTHORITIES
4. STATEMENT OF JURISDICTION
5. STATEMENT OF ISSUES
6. STATEMENT OF THE CASE
7. STATEMENT OF FACTS
8. SUMMARY OF ARGUMENT
9. ARGUMENT
   - Headings and subheadings
   - Legal standards
   - Analysis with citations
10. CONCLUSION
11. SIGNATURE BLOCK
12. CERTIFICATE OF SERVICE
13. CERTIFICATE OF COMPLIANCE`,

    'affidavit': `
1. CAPTION
2. AFFIDAVIT TITLE
3. INTRODUCTION (affiant identification)
4. NUMBERED PARAGRAPHS OF FACTS
   - Personal knowledge statement
   - Specific facts
   - Exhibit references
5. CONCLUSION
6. VERIFICATION/JURAT
7. NOTARY SECTION
8. SIGNATURE BLOCK`,

    'contract': `
1. TITLE
2. DATE
3. PARTIES
4. RECITALS (WHEREAS clauses)
5. DEFINITIONS
6. SUBSTANTIVE PROVISIONS
   - Rights and obligations
   - Performance terms
   - Payment terms
7. TERM AND TERMINATION
8. REPRESENTATIONS AND WARRANTIES
9. INDEMNIFICATION
10. DISPUTE RESOLUTION
11. GENERAL PROVISIONS
12. SIGNATURE BLOCKS`,

    'letter': `
1. LETTERHEAD (if applicable)
2. DATE
3. RECIPIENT ADDRESS
4. RE: Line
5. SALUTATION
6. OPENING PARAGRAPH (purpose)
7. BODY PARAGRAPHS
   - Facts
   - Analysis
   - Request/Demand
8. CLOSING PARAGRAPH
9. SIGNATURE BLOCK
10. ENCLOSURES (if any)`,

    'notice': `
1. CAPTION (if court filing)
2. TITLE OF NOTICE
3. TO: (Recipient)
4. NOTICE IS HEREBY GIVEN:
5. BODY (specific information)
6. EFFECTIVE DATE
7. SIGNATURE BLOCK
8. CERTIFICATE OF SERVICE (if applicable)`,

    'discovery-request': `
1. CAPTION
2. TITLE (Interrogatories/Requests for Production/Requests for Admission)
3. INSTRUCTIONS
4. DEFINITIONS
5. NUMBERED REQUESTS
   - Clear and specific
   - One topic per request
6. SIGNATURE BLOCK
7. CERTIFICATE OF SERVICE`,

    'discovery-response': `
1. CAPTION
2. TITLE (Responses to...)
3. GENERAL OBJECTIONS (if any)
4. NUMBERED RESPONSES
   - Restate request
   - Specific objections (if any)
   - Response
5. VERIFICATION
6. SIGNATURE BLOCK
7. CERTIFICATE OF SERVICE`,

    'memorandum': `
1. MEMORANDUM HEADING
   - TO:
   - FROM:
   - DATE:
   - RE:
2. QUESTION PRESENTED
3. SHORT ANSWER
4. STATEMENT OF FACTS
5. DISCUSSION/ANALYSIS
   - Issue headings
   - Legal rules
   - Application
   - Counterarguments
6. CONCLUSION`,

    'order': `
1. CAPTION
2. TITLE OF ORDER
3. RECITALS (Court's findings)
4. IT IS HEREBY ORDERED:
5. NUMBERED PROVISIONS
6. EFFECTIVE DATE
7. JUDGE'S SIGNATURE LINE
8. DATE LINE`,

    'pleading': `
1. CAPTION
2. TITLE
3. NUMBERED ALLEGATIONS
   - Jurisdictional facts
   - Factual allegations
   - Legal claims
4. WHEREFORE CLAUSE
5. SIGNATURE BLOCK
6. CERTIFICATE OF SERVICE`,

    'application': `
1. CAPTION
2. TITLE OF APPLICATION
3. INTRODUCTION
4. FACTUAL BACKGROUND
5. LEGAL BASIS
6. ARGUMENT
7. RELIEF REQUESTED
8. SIGNATURE BLOCK
9. CERTIFICATE OF SERVICE`,

    'answer': `
1. CAPTION
2. ANSWER TITLE
3. NUMBERED RESPONSES
   - Admit/Deny/Lack knowledge
   - Affirmative defenses
4. COUNTERCLAIMS (if applicable)
5. PRAYER FOR RELIEF
6. SIGNATURE BLOCK
7. CERTIFICATE OF SERVICE`,

    'counterclaim': `
1. CAPTION (Plaintiff becomes Defendant)
2. COUNTERCLAIM TITLE
3. PARTIES (reversed roles)
4. STATEMENT OF FACTS
5. COUNTS
6. PRAYER FOR RELIEF
7. SIGNATURE BLOCK
8. CERTIFICATE OF SERVICE`,

    'cross-claim': `
1. CAPTION
2. CROSS-CLAIM TITLE
3. PARTIES
4. STATEMENT OF FACTS
5. LEGAL BASIS
6. COUNTS
7. PRAYER FOR RELIEF
8. SIGNATURE BLOCK
9. CERTIFICATE OF SERVICE`,

    'summons': `
1. COURT INFORMATION
2. CASE INFORMATION
3. TO: (Defendant)
4. YOU ARE SUMMONED
5. TIME TO RESPOND
6. CONSEQUENCES OF FAILURE TO RESPOND
7. CLERK'S SIGNATURE
8. DATE ISSUED`,

    'subpoena': `
1. CAPTION
2. SUBPOENA TYPE (Testimony/Documents)
3. TO: (Person/Entity)
4. YOU ARE COMMANDED TO:
5. LOCATION AND TIME
6. DOCUMENTS/TESTIMONY REQUIRED
7. RIGHTS AND OBLIGATIONS
8. ISSUING AUTHORITY
9. SIGNATURE`,

    'agreement': `
1. TITLE
2. DATE
3. PARTIES
4. RECITALS (WHEREAS clauses)
5. DEFINITIONS
6. AGREEMENT TERMS
   - Subject matter
   - Rights and obligations
   - Performance requirements
7. REPRESENTATIONS AND WARRANTIES
8. COVENANTS
9. CONDITIONS
10. TERM AND TERMINATION
11. DISPUTE RESOLUTION
12. GENERAL PROVISIONS
13. SIGNATURE BLOCKS`,
  };

  return structures[documentType] || structures['pleading'];
}

// ============================================================================
// COURT RULES AND FORMATTING
// ============================================================================

/**
 * Get court-specific formatting rules
 */
function getCourtRules(state: string, courtLevel?: CourtLevel): {
  margins: string;
  fontFamily: string;
  fontSize: string;
  lineSpacing: string;
  pageNumbering: string;
  captionFormat: string;
  specialRules: string[];
} {
  // Default federal rules
  const federalRules = {
    margins: '1 inch all sides',
    fontFamily: 'Times New Roman or similar serif',
    fontSize: '12 point',
    lineSpacing: 'Double-spaced (body text)',
    pageNumbering: 'Bottom center',
    captionFormat: 'Standard caption with centered vs., case number top right',
    specialRules: [
      'Line numbering on left margin (if required)',
      'Maximum page limits per court rules',
      'ECF filing requirements',
      'Certificate of interested parties (if appellate)'
    ]
  };

  // State-specific variations
  const stateRules: Record<string, Partial<typeof federalRules>> = {
    'CA': {
      lineSpacing: 'Double-spaced, 28 lines per page',
      specialRules: [
        'California Rules of Court apply',
        'Judicial Council forms preferred when available',
        'Blue backing for filed documents',
        'Proof of service mandatory'
      ]
    },
    'NY': {
      fontFamily: 'Courier or Times New Roman',
      lineSpacing: 'Double-spaced',
      specialRules: [
        'NYSCEF for electronic filing',
        'CPLR procedural rules',
        'Specific affirmation/affidavit requirements'
      ]
    },
    'TX': {
      specialRules: [
        'Texas Rules of Civil Procedure',
        'Texas Rules of Evidence',
        'TexasOnline filing system'
      ]
    }
  };

  return {
    ...federalRules,
    ...stateRules[state]
  };
}

// ============================================================================
// DOCUMENT GENERATION ENGINE
// ============================================================================

/**
 * Generate legal document with full professional formatting
 */
export async function generateLegalDocument(
  request: DocumentGenerationRequest
): Promise<GeneratedDocument> {
  const startTime = Date.now();
  
  log.info('Starting document generation', {
    documentType: request.documentType,
    lawType: request.lawType,
    state: request.state
  });

  try {
    // Get expert configuration
    const expertConfig = getExpertSystemConfig(request.lawType, request.state);
    
    // Get document structure
    const structure = getDocumentStructure(
      request.documentType,
      request.lawType,
      request.state,
      request.courtLevel
    );
    
    // Get court rules
    const courtRules = getCourtRules(request.state, request.courtLevel);
    
    // Generate caption (if applicable)
    const caption = await generateCaption(request);
    
    // Generate main content
    const content = await generateDocumentContent(
      request,
      structure,
      courtRules,
      expertConfig,
      caption
    );
    
    // Generate signature block
    const signatureBlock = generateSignatureBlock(request);
    
    // Generate certificate of service (if applicable)
    const certificateOfService = generateCertificateOfService(request);
    
    // Combine all parts
    const fullContent = combineDocumentParts(
      caption,
      content,
      signatureBlock,
      certificateOfService,
      request
    );
    
    // Extract citations
    const citations = extractCitations(fullContent);
    
    // Verify if requested
    let verified = false;
    let verificationScore: number | undefined;
    
    if (request.verifyAll) {
      const verificationResult = await verifyDocument(fullContent, request);
      verified = verificationResult.verified;
      verificationScore = verificationResult.score;
    }
    
    // Calculate metadata
    const wordCount = fullContent.split(/\s+/).length;
    const pageEstimate = Math.ceil(wordCount / 250); // ~250 words per page
    
    const duration = Date.now() - startTime;
    log.info('Document generation completed', {
      documentType: request.documentType,
      lawType: request.lawType,
      duration,
      wordCount,
      pageEstimate
    });
    
    return {
      title: generateDocumentTitle(request),
      documentType: request.documentType,
      content: fullContent,
      metadata: {
        lawType: request.lawType,
        state: request.state,
        court: request.courtName,
        generatedAt: new Date(),
        wordCount,
        pageEstimate
      },
      formatting: {
        hasCaption: !!caption,
        hasSignatureBlock: !!signatureBlock,
        hasCertification: !!certificateOfService,
        hasTableOfContents: request.includeTableOfContents || false,
        hasTableOfAuthorities: request.includeTableOfAuthorities || false
      },
      citations,
      verified,
      verificationScore,
      warnings: generateWarnings(request, pageEstimate),
      suggestions: generateSuggestions(request, content)
    };
    
  } catch (error) {
    log.error('Document generation failed', { error, request });
    throw new Error(`Document generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate document caption
 */
async function generateCaption(request: DocumentGenerationRequest): Promise<string> {
  if (!['complaint', 'motion', 'brief', 'pleading', 'answer'].includes(request.documentType)) {
    return '';
  }
  
  const plaintiff = request.plaintiff || request.parties?.find(p => p.role === 'plaintiff')?.name || '[Plaintiff Name]';
  const defendant = request.defendant || request.parties?.find(p => p.role === 'defendant')?.name || '[Defendant Name]';
  
  return `
${request.courtName || `${request.state.toUpperCase()} ${request.courtLevel === 'federal-district' ? 'FEDERAL DISTRICT COURT' : 'SUPERIOR COURT'}`}

${plaintiff},                      ) ${request.caseNumber ? `Case No. ${request.caseNumber}` : '[Case Number]'}
    Plaintiff,                     )
                                   )
v.                                 ) ${generateDocumentTitle(request)}
                                   )
${defendant},                      )
    Defendant.                     )
__________________________________ )
`;
}

/**
 * Generate main document content using AI
 */
async function generateDocumentContent(
  request: DocumentGenerationRequest,
  structure: string,
  courtRules: ReturnType<typeof getCourtRules>,
  expertConfig: ReturnType<typeof getExpertSystemConfig>,
  caption: string
): Promise<string> {
  const toneGuidance = {
    'aggressive': 'assertive and forceful, emphasizing strong legal positions',
    'balanced': 'professional and measured, presenting facts objectively',
    'conciliatory': 'cooperative and solution-oriented, seeking resolution'
  };
  
  const tone = request.tone || 'balanced';
  
  const prompt = `As a ${expertConfig.profile.specialty} attorney with ${expertConfig.profile.yearsExperience} years of experience in ${request.state}, draft a professional ${request.documentType} following this structure:

${structure}

REQUIREMENTS:
1. Follow ${request.state} court rules and procedures
2. Use proper legal citations (${request.citationStyle || 'Bluebook'} format)
3. Tone: ${toneGuidance[tone]}
4. Include specific legal authorities
5. Formatting: ${courtRules.margins}, ${courtRules.fontSize}, ${courtRules.lineSpacing}

CASE INFORMATION:
${caption ? 'Caption already generated separately.' : ''}
Facts: ${request.facts}
Legal Basis: ${request.legalBasis}
${request.relief ? `Relief Sought: ${request.relief}` : ''}
${request.caseNumber ? `Case Number: ${request.caseNumber}` : ''}

SPECIFIC INSTRUCTIONS:
${request.urgency === 'emergency' ? '- This is an EMERGENCY filing requiring immediate attention' : ''}
${request.urgency === 'expedited' ? '- This is an expedited matter requiring prompt consideration' : ''}
${request.pageLimit ? `- Page limit: ${request.pageLimit} pages` : ''}
${request.includeTableOfContents ? '- Include Table of Contents' : ''}
${request.includeTableOfAuthorities ? '- Include Table of Authorities' : ''}

Draft the complete document with professional legal writing, proper headings, and full legal analysis. Use actual ${request.state} statutes and case law where applicable.

DO NOT include the caption, signature block, or certificate of service - those will be added separately.`;

  try {
    const taskPriority = request.urgency === 'emergency' ? TaskPriority.CRITICAL_USER : TaskPriority.HIGH_USER;
    const response = await generateUserText(
      `document-generation-${request.documentType}`,
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.3,
        maxTokens: 4000
      },
      taskPriority
    );

    return response.content;
  } catch (error) {
    log.error('Failed to generate document content', { error, request });
    throw error;
  }
}

/**
 * Generate signature block
 */
function generateSignatureBlock(request: DocumentGenerationRequest): string {
  return `

Respectfully submitted,

Dated: ${new Date().toLocaleDateString()}

_________________________________
[Attorney Name]
[Bar Number]
[Law Firm]
[Address]
[Phone]
[Email]

Attorney for ${request.plaintiff || '[Party]'}
`;
}

/**
 * Generate certificate of service
 */
function generateCertificateOfService(request: DocumentGenerationRequest): string {
  if (!['complaint', 'motion', 'brief', 'pleading', 'discovery-request'].includes(request.documentType)) {
    return '';
  }
  
  return `

CERTIFICATE OF SERVICE

I hereby certify that on ${new Date().toLocaleDateString()}, I served a true and correct copy of the foregoing ${request.documentType.toUpperCase()} upon all parties via electronic filing and/or mail to the addresses on record.

_________________________________
[Attorney Name]
`;
}

/**
 * Combine all document parts
 */
function combineDocumentParts(
  caption: string,
  content: string,
  signatureBlock: string,
  certificateOfService: string,
  request: DocumentGenerationRequest
): string {
  let fullDocument = '';
  
  if (caption) {
    fullDocument += caption + '\n\n';
  }
  
  fullDocument += content;
  
  if (signatureBlock) {
    fullDocument += '\n\n' + signatureBlock;
  }
  
  if (certificateOfService) {
    fullDocument += '\n\n' + certificateOfService;
  }
  
  return fullDocument;
}

/**
 * Generate document title
 */
function generateDocumentTitle(request: DocumentGenerationRequest): string {
  const typeNames: Record<DocumentType, string> = {
    'complaint': 'COMPLAINT',
    'petition': 'PETITION',
    'motion': 'MOTION',
    'brief': 'BRIEF',
    'affidavit': 'AFFIDAVIT',
    'contract': 'CONTRACT',
    'agreement': 'AGREEMENT',
    'letter': 'LETTER',
    'notice': 'NOTICE',
    'discovery-request': 'DISCOVERY REQUEST',
    'discovery-response': 'DISCOVERY RESPONSE',
    'memorandum': 'MEMORANDUM',
    'order': 'ORDER',
    'pleading': 'PLEADING',
    'application': 'APPLICATION',
    'answer': 'ANSWER',
    'counterclaim': 'COUNTERCLAIM',
    'cross-claim': 'CROSS-CLAIM',
    'summons': 'SUMMONS',
    'subpoena': 'SUBPOENA'
  };
  
  return typeNames[request.documentType];
}

/**
 * Extract legal citations from document
 */
function extractCitations(content: string): Array<{ statute: string; caselaw?: string; regulation?: string }> {
  const citations: Array<{ statute: string; caselaw?: string; regulation?: string }> = [];
  const seenStatutes = new Set<string>(); // Use Set for O(1) lookups
  
  // Extract statute citations (e.g., "42 U.S.C. § 1983", "Cal. Penal Code § 484")
  const statutePattern = /\b\d+\s+U\.S\.C\.\s+§\s+\d+|\b[A-Z][a-z]+\.\s+[A-Za-z]+\s+Code\s+§\s+\d+/g;
  const statutes = content.match(statutePattern) || [];
  
  statutes.forEach(statute => {
    if (!seenStatutes.has(statute)) {
      seenStatutes.add(statute);
      citations.push({ statute });
    }
  });
  
  // Extract case law citations (e.g., "Smith v. Jones, 123 U.S. 456")
  const caselawPattern = /\b[A-Z][a-z]+\s+v\.\s+[A-Z][a-z]+,\s+\d+\s+[A-Z][a-z\.]+\s+\d+/g;
  const cases = content.match(caselawPattern) || [];
  
  cases.forEach(caselaw => {
    citations.push({ statute: '', caselaw });
  });
  
  return citations;
}

/**
 * Verify document legal claims
 */
async function verifyDocument(
  content: string,
  request: DocumentGenerationRequest
): Promise<{ verified: boolean; score: number }> {
  try {
    const citations = extractCitations(content);
    let verifiedCount = 0;
    
    for (const citation of citations.slice(0, MAX_CITATIONS_FOR_VERIFICATION)) {
      try {
        const result = await checkFact({
          claim: citation.statute || citation.caselaw || '',
          context: {
            lawType: request.lawType,
            state: request.state
          }
        });
        
        if (result.verified) verifiedCount++;
      } catch (error) {
        log.warn('Citation verification failed', { citation, error });
      }
    }
    
    const score = citations.length > 0 
      ? (verifiedCount / Math.min(citations.length, MAX_CITATIONS_FOR_VERIFICATION)) * VERIFICATION_SCORE_MULTIPLIER 
      : VERIFICATION_SCORE_MULTIPLIER;
      
    return {
      verified: score >= VERIFICATION_PASS_THRESHOLD,
      score
    };
  } catch (error) {
    log.error('Document verification failed', { error });
    return { verified: false, score: 0 };
  }
}

/**
 * Generate warnings for document
 */
function generateWarnings(request: DocumentGenerationRequest, pageEstimate: number): string[] {
  const warnings: string[] = [];
  
  if (request.pageLimit && pageEstimate > request.pageLimit) {
    warnings.push(`Document exceeds page limit: ${pageEstimate} pages (limit: ${request.pageLimit})`);
  }
  
  if (!request.caseNumber) {
    warnings.push('Case number not provided - add before filing');
  }
  
  if (!request.plaintiff || !request.defendant) {
    warnings.push('Complete party information required before filing');
  }
  
  warnings.push('Review all citations for accuracy before filing');
  warnings.push('Verify compliance with local court rules');
  warnings.push('Have a licensed attorney review before filing');
  
  return warnings;
}

/**
 * Generate suggestions for document improvement
 */
function generateSuggestions(request: DocumentGenerationRequest, content: string): string[] {
  const suggestions: string[] = [];
  
  if (!content.includes('WHEREAS')) {
    suggestions.push('Consider adding recitals or background section');
  }
  
  if (!content.includes('exhibit') && !content.includes('Exhibit')) {
    suggestions.push('Consider whether exhibits should be attached');
  }
  
  suggestions.push('Proofread for typos and formatting consistency');
  suggestions.push('Ensure all party names and dates are correct');
  suggestions.push('Verify all statutory citations are current');
  
  return suggestions;
}
