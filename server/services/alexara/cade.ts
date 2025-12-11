/**
 * C.A.D.E. - Case Adaptive Drafting Entity
 * 
 * LEXARA's internal legal document drafting engine.
 * This is NOT a standalone tool - it is a subsystem controlled by LEXARA.
 * 
 * Responsibilities:
 * - Generate legal text outputs (filings, letters, motions, petitions, declarations, notices)
 * - Adapt to jurisdiction, case stage, facts/evidence, user goals & tone
 * - Produce full draft documents with proper structure
 * - Provide filing/next-step guidance
 * 
 * Storage Rules:
 * - May store pointers to drafts in Supabase
 * - NEVER stores legal knowledge in Supabase
 * - All law/embeddings live in External Legal Knowledge Layer
 */

import { EventEmitter } from 'events';
import type { EvidenceAnalysisResult } from './fmi';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type DocumentDraftType = 
  | 'demand_letter'
  | 'cease_and_desist'
  | 'response_letter'
  | 'complaint'
  | 'answer'
  | 'motion'
  | 'motion_to_dismiss'
  | 'motion_for_summary_judgment'
  | 'declaration'
  | 'affidavit'
  | 'notice'
  | 'notice_of_appeal'
  | 'petition'
  | 'brief'
  | 'memorandum'
  | 'settlement_proposal'
  | 'release_agreement'
  | 'subpoena_response'
  | 'discovery_request'
  | 'discovery_response'
  | 'stipulation'
  | 'order_proposed'
  | 'foia_request'
  | 'administrative_appeal'
  | 'general_correspondence';

export type TonePreference = 'firm' | 'balanced' | 'diplomatic' | 'aggressive' | 'conciliatory';

export type ProceduralStage = 
  | 'pre_litigation'
  | 'initial_filing'
  | 'responsive_pleading'
  | 'discovery'
  | 'pre_trial'
  | 'trial'
  | 'post_trial'
  | 'appeal'
  | 'settlement_negotiation'
  | 'enforcement';

export interface LawSnippet {
  citation: string;
  text: string;
  relevance: number;
  source: string;
}

export interface DraftSection {
  heading: string;
  content: string;
  order: number;
}

export interface FilingGuidance {
  whereToFileGuess?: string;
  courtOrAgency?: string;
  filingFee?: string;
  timingNotes?: string;
  serviceConsiderations?: string;
  additionalRequirements?: string[];
}

/**
 * Request for document drafting
 */
export interface DraftRequest {
  /** Target jurisdiction (state, federal, etc.) */
  jurisdiction: string;
  /** Type of legal matter */
  matterType: string;
  /** Current procedural stage */
  proceduralStage: ProceduralStage;
  /** User's goal for the document */
  userGoal: string;
  /** Summary of relevant facts */
  factsSummary: string;
  /** Evidence analysis results from F.M.I. */
  evidenceAnalysis?: EvidenceAnalysisResult[];
  /** Law snippets from Legal Knowledge Layer */
  lawSnippets?: LawSnippet[];
  /** Tone preference */
  tonePreference: TonePreference;
  /** Length constraint (words) */
  lengthConstraint?: number;
  /** Document type to generate */
  documentType: DocumentDraftType;
  /** Optional: specific opposing party */
  opposingParty?: string;
  /** Optional: case number */
  caseNumber?: string;
  /** Optional: court name */
  courtName?: string;
  /** Optional: user's name (for signature) */
  userName?: string;
  /** Session ID for tracking */
  sessionId?: string;
}

/**
 * Result from document drafting
 */
export interface DraftResult {
  /** Unique draft ID */
  draftId: string;
  /** Success status */
  success: boolean;
  /** Processing timestamp */
  timestamp: Date;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Full draft text */
  draftText: string;
  /** Document structure */
  structure: {
    title?: string;
    caption?: string;
    headings: string[];
    sections: DraftSection[];
  };
  /** Filing guidance */
  optionalFilingGuidance?: FilingGuidance;
  /** Citations used in draft */
  citationsUsed: string[];
  /** Confidence in draft quality (0-1) */
  confidence: number;
  /** Warnings or notes */
  warnings?: string[];
  /** Errors */
  errors?: string[];
  /** Word count */
  wordCount: number;
}

export interface CADEConfig {
  enabled: boolean;
  maxDraftLengthWords: number;
  defaultTone: TonePreference;
  includeFilingGuidance: boolean;
}

export interface CADEStatus {
  isReady: boolean;
  totalDrafts: number;
  successfulDrafts: number;
  failedDrafts: number;
  averageProcessingTimeMs: number;
}

// ============================================================================
// DOCUMENT TEMPLATES
// ============================================================================

const DOCUMENT_TEMPLATES: Record<DocumentDraftType, { title: string; sections: string[] }> = {
  demand_letter: {
    title: 'DEMAND LETTER',
    sections: ['Introduction', 'Statement of Facts', 'Legal Basis', 'Demand', 'Deadline and Consequences'],
  },
  cease_and_desist: {
    title: 'CEASE AND DESIST LETTER',
    sections: ['Introduction', 'Offending Conduct', 'Legal Violations', 'Demand to Cease', 'Consequences of Non-Compliance'],
  },
  response_letter: {
    title: 'RESPONSE LETTER',
    sections: ['Introduction', 'Response to Allegations', 'Our Position', 'Proposed Resolution'],
  },
  complaint: {
    title: 'COMPLAINT',
    sections: ['Caption', 'Parties', 'Jurisdiction and Venue', 'Statement of Facts', 'Causes of Action', 'Prayer for Relief'],
  },
  answer: {
    title: 'ANSWER TO COMPLAINT',
    sections: ['Caption', 'Introduction', 'Responses to Allegations', 'Affirmative Defenses', 'Prayer'],
  },
  motion: {
    title: 'MOTION',
    sections: ['Caption', 'Introduction', 'Statement of Facts', 'Argument', 'Conclusion', 'Prayer for Relief'],
  },
  motion_to_dismiss: {
    title: 'MOTION TO DISMISS',
    sections: ['Caption', 'Introduction', 'Procedural Background', 'Statement of Facts', 'Legal Standard', 'Argument', 'Conclusion'],
  },
  motion_for_summary_judgment: {
    title: 'MOTION FOR SUMMARY JUDGMENT',
    sections: ['Caption', 'Introduction', 'Statement of Undisputed Facts', 'Legal Standard', 'Argument', 'Conclusion'],
  },
  declaration: {
    title: 'DECLARATION',
    sections: ['Caption', 'Introduction', 'Declarant Information', 'Statement of Facts', 'Conclusion', 'Signature Block'],
  },
  affidavit: {
    title: 'AFFIDAVIT',
    sections: ['Caption', 'Affiant Information', 'Sworn Statement', 'Conclusion', 'Jurat'],
  },
  notice: {
    title: 'NOTICE',
    sections: ['Caption', 'Notice Statement', 'Supporting Information', 'Conclusion'],
  },
  notice_of_appeal: {
    title: 'NOTICE OF APPEAL',
    sections: ['Caption', 'Notice', 'Judgment Appealed From', 'Relief Sought'],
  },
  petition: {
    title: 'PETITION',
    sections: ['Caption', 'Introduction', 'Petitioner Information', 'Grounds for Petition', 'Prayer for Relief'],
  },
  brief: {
    title: 'BRIEF',
    sections: ['Caption', 'Table of Contents', 'Statement of Issues', 'Statement of Facts', 'Argument', 'Conclusion'],
  },
  memorandum: {
    title: 'MEMORANDUM OF LAW',
    sections: ['Caption', 'Introduction', 'Statement of Facts', 'Legal Analysis', 'Conclusion'],
  },
  settlement_proposal: {
    title: 'SETTLEMENT PROPOSAL',
    sections: ['Introduction', 'Background', 'Settlement Terms', 'Conditions', 'Acceptance Deadline'],
  },
  release_agreement: {
    title: 'RELEASE AND SETTLEMENT AGREEMENT',
    sections: ['Parties', 'Recitals', 'Release Terms', 'Consideration', 'General Provisions', 'Signatures'],
  },
  subpoena_response: {
    title: 'RESPONSE TO SUBPOENA',
    sections: ['Caption', 'Introduction', 'Objections', 'Responsive Documents', 'Conclusion'],
  },
  discovery_request: {
    title: 'DISCOVERY REQUEST',
    sections: ['Caption', 'Definitions', 'Instructions', 'Interrogatories/Requests'],
  },
  discovery_response: {
    title: 'DISCOVERY RESPONSE',
    sections: ['Caption', 'General Objections', 'Responses', 'Document Production'],
  },
  stipulation: {
    title: 'STIPULATION',
    sections: ['Caption', 'Parties Agreement', 'Terms', 'Signatures'],
  },
  order_proposed: {
    title: 'PROPOSED ORDER',
    sections: ['Caption', 'Order Language', 'Signature Block'],
  },
  foia_request: {
    title: 'FREEDOM OF INFORMATION ACT REQUEST',
    sections: ['Introduction', 'Records Requested', 'Fee Waiver Request', 'Contact Information'],
  },
  administrative_appeal: {
    title: 'ADMINISTRATIVE APPEAL',
    sections: ['Introduction', 'Decision Appealed', 'Grounds for Appeal', 'Relief Requested'],
  },
  general_correspondence: {
    title: 'CORRESPONDENCE',
    sections: ['Salutation', 'Body', 'Closing'],
  },
};

// ============================================================================
// CADE ENGINE
// ============================================================================

/**
 * C.A.D.E. - Case Adaptive Drafting Entity
 * Internal subsystem of LEXARA for legal document drafting
 */
export class CADE extends EventEmitter {
  private static instance: CADE | null = null;
  private config: CADEConfig;
  private status: CADEStatus;
  private draftCount = 0;
  private totalProcessingTime = 0;

  private constructor(config?: Partial<CADEConfig>) {
    super();
    
    this.config = {
      enabled: true,
      maxDraftLengthWords: 10000,
      defaultTone: 'balanced',
      includeFilingGuidance: true,
      ...config,
    };

    this.status = {
      isReady: true,
      totalDrafts: 0,
      successfulDrafts: 0,
      failedDrafts: 0,
      averageProcessingTimeMs: 0,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<CADEConfig>): CADE {
    if (!CADE.instance) {
      CADE.instance = new CADE(config);
    }
    return CADE.instance;
  }

  /**
   * Draft document - main entry point
   * Called internally by LEXARA, not exposed to users
   */
  async draftDocument(request: DraftRequest): Promise<DraftResult> {
    const startTime = Date.now();
    const draftId = `cade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.status.totalDrafts++;
    this.emit('draft:started', { draftId, documentType: request.documentType });

    try {
      // Validate request
      this.validateRequest(request);

      // Get template
      const template = DOCUMENT_TEMPLATES[request.documentType] || DOCUMENT_TEMPLATES.general_correspondence;

      // Generate draft
      const { draftText, sections, citationsUsed } = await this.generateDraft(request, template);

      // Generate filing guidance if applicable
      const filingGuidance = this.config.includeFilingGuidance 
        ? this.generateFilingGuidance(request)
        : undefined;

      const processingTimeMs = Date.now() - startTime;
      this.totalProcessingTime += processingTimeMs;
      this.draftCount++;
      this.status.successfulDrafts++;
      this.updateAverageProcessingTime();

      const result: DraftResult = {
        draftId,
        success: true,
        timestamp: new Date(),
        processingTimeMs,
        draftText,
        structure: {
          title: template.title,
          caption: this.generateCaption(request),
          headings: template.sections,
          sections,
        },
        optionalFilingGuidance: filingGuidance,
        citationsUsed,
        confidence: this.calculateConfidence(request),
        wordCount: draftText.split(/\s+/).length,
      };

      this.emit('draft:completed', { draftId, processingTimeMs });
      return result;

    } catch (error) {
      this.status.failedDrafts++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.emit('draft:failed', { draftId, error: errorMessage });

      return {
        draftId,
        success: false,
        timestamp: new Date(),
        processingTimeMs: Date.now() - startTime,
        draftText: '',
        structure: {
          headings: [],
          sections: [],
        },
        citationsUsed: [],
        confidence: 0,
        wordCount: 0,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Validate draft request
   */
  private validateRequest(request: DraftRequest): void {
    if (!request.jurisdiction) {
      throw new Error('Jurisdiction is required');
    }
    if (!request.userGoal) {
      throw new Error('User goal is required');
    }
    if (!request.factsSummary) {
      throw new Error('Facts summary is required');
    }
  }

  /**
   * Generate draft text
   */
  private async generateDraft(
    request: DraftRequest,
    template: { title: string; sections: string[] }
  ): Promise<{ draftText: string; sections: DraftSection[]; citationsUsed: string[] }> {
    const sections: DraftSection[] = [];
    const citationsUsed: string[] = [];
    let fullDraft = '';

    // Add title/header
    fullDraft += `${template.title}\n\n`;

    // Add caption if it's a court document
    if (this.isCourtDocument(request.documentType)) {
      const caption = this.generateCaption(request);
      if (caption) {
        fullDraft += `${caption}\n\n`;
      }
    }

    // Generate each section
    for (let i = 0; i < template.sections.length; i++) {
      const sectionName = template.sections[i];
      const sectionContent = this.generateSection(request, sectionName, i);
      
      sections.push({
        heading: sectionName,
        content: sectionContent,
        order: i,
      });

      fullDraft += `${sectionName.toUpperCase()}\n\n${sectionContent}\n\n`;
    }

    // Add relevant citations from law snippets
    if (request.lawSnippets && request.lawSnippets.length > 0) {
      for (const snippet of request.lawSnippets) {
        if (snippet.relevance > 0.5) {
          citationsUsed.push(snippet.citation);
        }
      }
    }

    // Add signature block
    fullDraft += this.generateSignatureBlock(request);

    return { draftText: fullDraft.trim(), sections, citationsUsed };
  }

  /**
   * Check if document type is a court filing
   */
  private isCourtDocument(docType: DocumentDraftType): boolean {
    return [
      'complaint', 'answer', 'motion', 'motion_to_dismiss', 'motion_for_summary_judgment',
      'declaration', 'affidavit', 'notice', 'notice_of_appeal', 'petition', 'brief',
      'memorandum', 'discovery_request', 'discovery_response', 'stipulation', 'order_proposed'
    ].includes(docType);
  }

  /**
   * Generate caption for court documents
   */
  private generateCaption(request: DraftRequest): string {
    if (!this.isCourtDocument(request.documentType)) return '';

    const court = request.courtName || `[Court Name]`;
    const caseNo = request.caseNumber || `Case No. [_______]`;
    const opposing = request.opposingParty || '[Opposing Party]';
    const user = request.userName || '[Your Name]';

    return `
${court}

${user},
    Plaintiff/Petitioner,

vs.                                    ${caseNo}

${opposing},
    Defendant/Respondent.
_______________________________________
`.trim();
  }

  /**
   * Generate section content based on request
   */
  private generateSection(request: DraftRequest, sectionName: string, _order: number): string {
    const tone = this.getToneModifier(request.tonePreference);
    const lowerSection = sectionName.toLowerCase();

    // Introduction sections
    if (lowerSection.includes('introduction') || lowerSection === 'salutation') {
      return this.generateIntroduction(request, tone);
    }

    // Facts sections
    if (lowerSection.includes('fact') || lowerSection === 'background') {
      return this.generateFactsSection(request);
    }

    // Legal basis / argument sections
    if (lowerSection.includes('argument') || lowerSection.includes('legal') || lowerSection.includes('cause')) {
      return this.generateLegalSection(request);
    }

    // Demand / Relief sections
    if (lowerSection.includes('demand') || lowerSection.includes('relief') || lowerSection.includes('prayer')) {
      return this.generateReliefSection(request, tone);
    }

    // Conclusion sections
    if (lowerSection.includes('conclusion') || lowerSection === 'closing') {
      return this.generateConclusion(request, tone);
    }

    // Response sections
    if (lowerSection.includes('response') || lowerSection.includes('objection')) {
      return this.generateResponseSection(request);
    }

    // Default: placeholder
    return `[${sectionName} content to be drafted based on case specifics]`;
  }

  /**
   * Get tone modifier text
   */
  private getToneModifier(tone: TonePreference): { strength: string; closing: string } {
    switch (tone) {
      case 'aggressive':
        return { strength: 'demands', closing: 'Govern yourself accordingly.' };
      case 'firm':
        return { strength: 'firmly requests', closing: 'Your prompt attention to this matter is required.' };
      case 'balanced':
        return { strength: 'requests', closing: 'We look forward to your response.' };
      case 'diplomatic':
        return { strength: 'respectfully requests', closing: 'We appreciate your consideration of this matter.' };
      case 'conciliatory':
        return { strength: 'kindly requests', closing: 'We hope to resolve this matter amicably.' };
      default:
        return { strength: 'requests', closing: 'Please respond at your earliest convenience.' };
    }
  }

  /**
   * Generate introduction section
   */
  private generateIntroduction(request: DraftRequest, tone: { strength: string; closing: string }): string {
    const userName = request.userName || '[Client Name]';
    
    let intro = '';
    
    switch (request.documentType) {
      case 'demand_letter':
        intro = `This letter constitutes a formal demand on behalf of ${userName}. ${userName} ${tone.strength} that you address the following matter immediately.`;
        break;
      case 'complaint':
        intro = `COMES NOW, ${userName}, Plaintiff herein, and for their Complaint against Defendant, states and alleges as follows:`;
        break;
      case 'answer':
        intro = `COMES NOW, ${userName}, Defendant herein, and in response to Plaintiff's Complaint, answers as follows:`;
        break;
      case 'motion':
      case 'motion_to_dismiss':
      case 'motion_for_summary_judgment':
        intro = `COMES NOW, ${userName}, and hereby moves this Honorable Court for the following relief, and in support thereof, states:`;
        break;
      default:
        intro = `This document is submitted on behalf of ${userName} regarding ${request.matterType || 'the matter at hand'}.`;
    }

    return intro;
  }

  /**
   * Generate facts section
   */
  private generateFactsSection(request: DraftRequest): string {
    let facts = request.factsSummary;

    // Incorporate evidence analysis
    if (request.evidenceAnalysis && request.evidenceAnalysis.length > 0) {
      facts += '\n\nSupporting evidence indicates:\n';
      for (const evidence of request.evidenceAnalysis) {
        if (evidence.success) {
          facts += `- ${evidence.summary}\n`;
          if (evidence.keyFacts.length > 0) {
            const keyFactsStr = evidence.keyFacts.slice(0, 3).map(f => f.value).join(', ');
            facts += `  Key facts: ${keyFactsStr}\n`;
          }
        }
      }
    }

    return facts;
  }

  /**
   * Generate legal basis section
   */
  private generateLegalSection(request: DraftRequest): string {
    let legal = '';

    if (request.lawSnippets && request.lawSnippets.length > 0) {
      legal = 'The following legal authorities support this position:\n\n';
      for (const snippet of request.lawSnippets.slice(0, 5)) {
        legal += `${snippet.citation}\n"${snippet.text.substring(0, 200)}${snippet.text.length > 200 ? '...' : ''}"\n\n`;
      }
    } else {
      legal = `[Legal analysis and applicable statutes/case law for ${request.jurisdiction} to be inserted here based on the specific facts and claims of this matter.]`;
    }

    return legal;
  }

  /**
   * Generate relief/demand section
   */
  private generateReliefSection(request: DraftRequest, tone: { strength: string; closing: string }): string {
    const userName = request.userName || '[Client Name]';
    
    let relief = `WHEREFORE, ${userName} ${tone.strength}:\n\n`;
    relief += `1. ${request.userGoal}\n`;
    relief += `2. Such other and further relief as this Court deems just and proper.\n`;

    // Add specific relief based on evidence
    if (request.evidenceAnalysis && request.evidenceAnalysis.length > 0) {
      const monetaryDamages = request.evidenceAnalysis
        .flatMap(e => e.monetaryValues || [])
        .filter(m => m.type === 'damages' || m.type === 'claim');
      
      if (monetaryDamages.length > 0) {
        const totalAmount = monetaryDamages.reduce((sum, m) => sum + m.amount, 0);
        relief += `3. Monetary damages in the amount of $${totalAmount.toLocaleString()} or as determined at trial.\n`;
      }
    }

    return relief;
  }

  /**
   * Generate conclusion section
   */
  private generateConclusion(request: DraftRequest, tone: { strength: string; closing: string }): string {
    return `For the foregoing reasons, the relief requested herein should be granted.\n\n${tone.closing}`;
  }

  /**
   * Generate response section
   */
  private generateResponseSection(request: DraftRequest): string {
    return `In response to the allegations set forth, ${request.userName || '[Respondent]'} states:\n\n` +
           `[Specific responses to each allegation to be drafted based on case review]\n\n` +
           `Any allegations not specifically admitted herein are hereby denied.`;
  }

  /**
   * Generate signature block
   */
  private generateSignatureBlock(request: DraftRequest): string {
    const userName = request.userName || '[Your Name]';
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    if (this.isCourtDocument(request.documentType)) {
      return `
Respectfully submitted,

Dated: ${date}

_________________________________
${userName}
[Address]
[City, State ZIP]
[Phone]
[Email]
Pro Se / Attorney for [Party]
`;
    }

    return `
Sincerely,

${userName}
[Contact Information]

Date: ${date}
`;
  }

  /**
   * Generate filing guidance
   */
  private generateFilingGuidance(request: DraftRequest): FilingGuidance {
    const guidance: FilingGuidance = {};

    // Determine where to file based on document type and jurisdiction
    if (request.documentType === 'complaint' || request.documentType === 'answer') {
      guidance.whereToFileGuess = `${request.jurisdiction} court with jurisdiction over the matter`;
      guidance.courtOrAgency = request.courtName || `[Appropriate ${request.jurisdiction} Court]`;
      guidance.filingFee = 'Filing fees vary by jurisdiction and case type. Check with the court clerk.';
    }

    // Timing notes
    if (request.documentType === 'answer') {
      guidance.timingNotes = 'Typically due within 20-30 days of service of the complaint. Check local rules.';
    } else if (request.documentType === 'motion') {
      guidance.timingNotes = 'Review local rules for motion filing deadlines and notice requirements.';
    } else if (request.documentType === 'notice_of_appeal') {
      guidance.timingNotes = 'Appeal deadlines are strict. Federal: 30 days from judgment. State: varies.';
    }

    // Service considerations
    if (this.isCourtDocument(request.documentType)) {
      guidance.serviceConsiderations = 'Serve all parties according to applicable rules. Retain proof of service.';
    }

    // Additional requirements
    guidance.additionalRequirements = [
      'Verify page/word limits per local rules',
      'Include certificate of service if required',
      'File original plus required copies',
      'Pay applicable filing fees',
    ];

    return guidance;
  }

  /**
   * Calculate confidence in draft quality
   */
  private calculateConfidence(request: DraftRequest): number {
    let confidence = 0.6; // Base confidence

    // Higher confidence with more information
    if (request.factsSummary && request.factsSummary.length > 100) confidence += 0.1;
    if (request.evidenceAnalysis && request.evidenceAnalysis.length > 0) confidence += 0.1;
    if (request.lawSnippets && request.lawSnippets.length > 0) confidence += 0.1;
    if (request.caseNumber) confidence += 0.05;
    if (request.courtName) confidence += 0.05;

    return Math.min(confidence, 0.95);
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(): void {
    if (this.draftCount > 0) {
      this.status.averageProcessingTimeMs = Math.round(this.totalProcessingTime / this.draftCount);
    }
  }

  /**
   * Get CADE status
   */
  getStatus(): CADEStatus {
    return { ...this.status };
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    CADE.instance = null;
  }
}

// Export singleton getter
export const getCADE = (config?: Partial<CADEConfig>): CADE => {
  return CADE.getInstance(config);
};

export default CADE;
