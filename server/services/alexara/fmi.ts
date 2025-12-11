/**
 * F.M.I. - Forensic Media Intelligence
 * 
 * LEXARA's internal evidence and media analysis engine.
 * This is NOT a standalone tool - it is a subsystem controlled by LEXARA.
 * 
 * Responsibilities:
 * - Ingest uploaded files (PDF, DOC/DOCX, images, screenshots, video, audio)
 * - Camera-captured document analysis ("hold it up to webcam" mode)
 * - OCR and text extraction
 * - Document structure detection (notice, order, demand, contract, etc.)
 * - Key facts extraction (dates, parties, amounts, threats, deadlines)
 * - Risk/urgency tagging
 * - Produce structured evidence analysis for LEXARA
 * 
 * Storage Rules:
 * - May store raw file references (URLs, IDs) in Supabase
 * - NEVER stores legal knowledge in Supabase
 * - All law/embeddings live in External Legal Knowledge Layer
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type DocumentTypeGuess = 
  | 'notice'
  | 'order'
  | 'demand_letter'
  | 'contract'
  | 'complaint'
  | 'motion'
  | 'declaration'
  | 'subpoena'
  | 'summons'
  | 'judgment'
  | 'settlement'
  | 'pleading'
  | 'correspondence'
  | 'invoice'
  | 'receipt'
  | 'identification'
  | 'medical_record'
  | 'police_report'
  | 'evidence_photo'
  | 'screenshot'
  | 'video_evidence'
  | 'audio_evidence'
  | 'unknown';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export type UrgencyFlag = 
  | 'deadline_imminent'
  | 'response_required'
  | 'court_date_set'
  | 'default_risk'
  | 'statute_expiring'
  | 'time_sensitive'
  | 'immediate_action';

export interface KeyFact {
  type: 'date' | 'party' | 'amount' | 'threat' | 'deadline' | 'location' | 'claim' | 'evidence';
  value: string;
  confidence: number;
  context?: string;
  pageNumber?: number;
}

export interface PartyInfo {
  name: string;
  role: 'plaintiff' | 'defendant' | 'petitioner' | 'respondent' | 'witness' | 'attorney' | 'judge' | 'other';
  confidence: number;
  contactInfo?: string;
}

export interface KeyDate {
  type: 'filing' | 'deadline' | 'hearing' | 'incident' | 'service' | 'expiration' | 'other';
  date: string;
  description: string;
  isPast: boolean;
  daysUntil?: number;
  urgency: RiskLevel;
}

export interface MonetaryValue {
  amount: number;
  currency: string;
  type: 'damages' | 'settlement' | 'fee' | 'fine' | 'debt' | 'claim' | 'other';
  context: string;
}

export interface NextStepCandidate {
  action: string;
  priority: 'immediate' | 'soon' | 'when_possible';
  deadline?: string;
  rationale: string;
}

/**
 * Input for evidence analysis
 */
export interface EvidenceInput {
  /** File upload data (base64 or URL) */
  fileData?: string;
  /** File type/MIME */
  fileType?: string;
  /** Original filename */
  fileName?: string;
  /** Camera capture frames (base64 images) */
  cameraCapture?: string[];
  /** User-provided context about the document */
  context?: string;
  /** Jurisdiction for legal context */
  jurisdiction?: string;
  /** Matter type for relevance scoring */
  matterType?: string;
  /** Session ID for tracking */
  sessionId?: string;
}

/**
 * Result from evidence analysis
 */
export interface EvidenceAnalysisResult {
  /** Unique analysis ID */
  analysisId: string;
  /** Success status */
  success: boolean;
  /** Processing timestamp */
  timestamp: Date;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Raw text excerpt (truncated for efficiency) */
  rawTextExcerpt: string;
  /** AI-generated summary */
  summary: string;
  /** Document type classification */
  documentTypeGuess: DocumentTypeGuess;
  /** Confidence in document type (0-1) */
  documentTypeConfidence: number;
  /** Extracted key facts */
  keyFacts: KeyFact[];
  /** Identified parties */
  parties: PartyInfo[];
  /** Important dates */
  keyDates: KeyDate[];
  /** Monetary values mentioned */
  monetaryValues: MonetaryValue[];
  /** Urgency flags */
  urgencyFlags: UrgencyFlag[];
  /** Overall risk level */
  riskLevel: RiskLevel;
  /** Recommended next steps (candidates for LEXARA to evaluate) */
  recommendedNextStepsCandidates: NextStepCandidate[];
  /** Metadata */
  metadata: {
    pageCount?: number;
    wordCount?: number;
    hasSignatures?: boolean;
    hasStamps?: boolean;
    imageCount?: number;
    language?: string;
    ocrConfidence?: number;
  };
  /** Errors encountered during processing */
  errors?: string[];
}

export interface FMIConfig {
  enabled: boolean;
  maxFileSizeMB: number;
  supportedFileTypes: string[];
  ocrEnabled: boolean;
  maxCameraFrames: number;
  processingTimeoutMs: number;
}

export interface FMIStatus {
  isReady: boolean;
  totalAnalyses: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  averageProcessingTimeMs: number;
}

// ============================================================================
// FMI ENGINE
// ============================================================================

/**
 * F.M.I. - Forensic Media Intelligence
 * Internal subsystem of LEXARA for evidence analysis
 */
export class FMI extends EventEmitter {
  private static instance: FMI | null = null;
  private config: FMIConfig;
  private status: FMIStatus;
  private analysisCount = 0;
  private totalProcessingTime = 0;

  private constructor(config?: Partial<FMIConfig>) {
    super();
    
    this.config = {
      enabled: true,
      maxFileSizeMB: 50,
      supportedFileTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/heic',
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'audio/mpeg',
        'audio/wav',
        'audio/webm',
        'text/plain',
      ],
      ocrEnabled: true,
      maxCameraFrames: 10,
      processingTimeoutMs: 60000,
      ...config,
    };

    this.status = {
      isReady: true,
      totalAnalyses: 0,
      successfulAnalyses: 0,
      failedAnalyses: 0,
      averageProcessingTimeMs: 0,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<FMIConfig>): FMI {
    if (!FMI.instance) {
      FMI.instance = new FMI(config);
    }
    return FMI.instance;
  }

  /**
   * Analyze evidence - main entry point
   * Called internally by LEXARA, not exposed to users
   */
  async analyzeEvidence(input: EvidenceInput): Promise<EvidenceAnalysisResult> {
    const startTime = Date.now();
    const analysisId = `fmi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.status.totalAnalyses++;
    this.emit('analysis:started', { analysisId, input: { ...input, fileData: '[REDACTED]' } });

    try {
      // Validate input
      this.validateInput(input);

      // Process based on input type
      let rawText = '';
      let metadata: EvidenceAnalysisResult['metadata'] = {};

      if (input.fileData) {
        const extracted = await this.extractFromFile(input);
        rawText = extracted.text;
        metadata = extracted.metadata;
      } else if (input.cameraCapture && input.cameraCapture.length > 0) {
        const extracted = await this.extractFromCamera(input.cameraCapture);
        rawText = extracted.text;
        metadata = extracted.metadata;
      }

      // Analyze extracted content
      const analysis = await this.performAnalysis(rawText, input.context, input.jurisdiction, input.matterType);

      const processingTimeMs = Date.now() - startTime;
      this.totalProcessingTime += processingTimeMs;
      this.analysisCount++;
      this.status.successfulAnalyses++;
      this.updateAverageProcessingTime();

      const result: EvidenceAnalysisResult = {
        analysisId,
        success: true,
        timestamp: new Date(),
        processingTimeMs,
        rawTextExcerpt: rawText.substring(0, 2000) + (rawText.length > 2000 ? '...' : ''),
        ...analysis,
        metadata,
      };

      this.emit('analysis:completed', { analysisId, processingTimeMs });
      return result;

    } catch (error) {
      this.status.failedAnalyses++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.emit('analysis:failed', { analysisId, error: errorMessage });

      return {
        analysisId,
        success: false,
        timestamp: new Date(),
        processingTimeMs: Date.now() - startTime,
        rawTextExcerpt: '',
        summary: 'Analysis failed',
        documentTypeGuess: 'unknown',
        documentTypeConfidence: 0,
        keyFacts: [],
        parties: [],
        keyDates: [],
        monetaryValues: [],
        urgencyFlags: [],
        riskLevel: 'informational',
        recommendedNextStepsCandidates: [],
        metadata: {},
        errors: [errorMessage],
      };
    }
  }

  /**
   * Validate input
   */
  private validateInput(input: EvidenceInput): void {
    if (!input.fileData && (!input.cameraCapture || input.cameraCapture.length === 0)) {
      throw new Error('No file data or camera capture provided');
    }

    if (input.cameraCapture && input.cameraCapture.length > this.config.maxCameraFrames) {
      throw new Error(`Too many camera frames (max: ${this.config.maxCameraFrames})`);
    }
  }

  /**
   * Extract text and metadata from file
   */
  private async extractFromFile(input: EvidenceInput): Promise<{ text: string; metadata: EvidenceAnalysisResult['metadata'] }> {
    // In production, this would:
    // 1. Decode base64 or fetch from URL
    // 2. Use appropriate parser (PDF.js, Tesseract OCR, etc.)
    // 3. Extract text and metadata
    
    const metadata: EvidenceAnalysisResult['metadata'] = {
      pageCount: 1,
      wordCount: 0,
      hasSignatures: false,
      hasStamps: false,
      imageCount: 0,
      language: 'en',
      ocrConfidence: 0.9,
    };

    // Simulate extraction based on file type
    let extractedText = '';
    
    if (input.fileType?.includes('pdf')) {
      extractedText = await this.extractFromPDF(input.fileData!);
      metadata.pageCount = Math.ceil(extractedText.length / 3000);
    } else if (input.fileType?.includes('image')) {
      extractedText = await this.performOCR(input.fileData!);
      metadata.imageCount = 1;
    } else if (input.fileType?.includes('video')) {
      extractedText = await this.extractFromVideo(input.fileData!);
    } else if (input.fileType?.includes('audio')) {
      extractedText = await this.transcribeAudio(input.fileData!);
    } else {
      extractedText = this.decodeTextContent(input.fileData!);
    }

    metadata.wordCount = extractedText.split(/\s+/).length;
    
    // Detect signatures and stamps
    metadata.hasSignatures = /sign(ed|ature)|\/s\/|x___/i.test(extractedText);
    metadata.hasStamps = /notary|seal|certified|official/i.test(extractedText);

    return { text: extractedText, metadata };
  }

  /**
   * Extract from camera capture frames
   */
  private async extractFromCamera(frames: string[]): Promise<{ text: string; metadata: EvidenceAnalysisResult['metadata'] }> {
    // In production, this would:
    // 1. Select best quality frame(s)
    // 2. Apply image preprocessing
    // 3. Run OCR
    
    const texts: string[] = [];
    
    for (const frame of frames.slice(0, this.config.maxCameraFrames)) {
      const text = await this.performOCR(frame);
      if (text.trim()) {
        texts.push(text);
      }
    }

    // Deduplicate and merge
    const mergedText = this.mergeOCRResults(texts);

    return {
      text: mergedText,
      metadata: {
        imageCount: frames.length,
        ocrConfidence: 0.85,
        wordCount: mergedText.split(/\s+/).length,
      },
    };
  }

  /**
   * Extract text from PDF
   */
  private async extractFromPDF(data: string): Promise<string> {
    // In production: use pdf-parse or PDF.js
    // For now, return context-based placeholder
    return `[PDF Content Extracted]\n${this.decodeTextContent(data)}`;
  }

  /**
   * Perform OCR on image
   */
  private async performOCR(imageData: string): Promise<string> {
    // In production: use Tesseract.js or cloud OCR API
    // For now, return placeholder
    return `[OCR Extracted Text]\nDocument content extracted via optical character recognition.`;
  }

  /**
   * Extract from video (keyframes + audio)
   */
  private async extractFromVideo(_data: string): Promise<string> {
    // In production: extract keyframes, run OCR, transcribe audio
    return `[Video Evidence Analyzed]\nVideo content analyzed for visual and audio evidence.`;
  }

  /**
   * Transcribe audio
   */
  private async transcribeAudio(_data: string): Promise<string> {
    // In production: use speech-to-text API
    return `[Audio Transcription]\nAudio content transcribed for analysis.`;
  }

  /**
   * Decode text content from base64
   */
  private decodeTextContent(data: string): string {
    try {
      if (data.startsWith('data:')) {
        const base64 = data.split(',')[1];
        return Buffer.from(base64, 'base64').toString('utf-8');
      }
      return data;
    } catch {
      return data;
    }
  }

  /**
   * Merge multiple OCR results
   */
  private mergeOCRResults(texts: string[]): string {
    if (texts.length === 0) return '';
    if (texts.length === 1) return texts[0];
    
    // Simple merge - in production, use more sophisticated deduplication
    return texts.join('\n\n---\n\n');
  }

  /**
   * Perform analysis on extracted text
   */
  private async performAnalysis(
    text: string,
    userContext?: string,
    jurisdiction?: string,
    matterType?: string
  ): Promise<Omit<EvidenceAnalysisResult, 'analysisId' | 'success' | 'timestamp' | 'processingTimeMs' | 'rawTextExcerpt' | 'metadata' | 'errors'>> {
    // Document type detection
    const { type: documentTypeGuess, confidence: documentTypeConfidence } = this.detectDocumentType(text);
    
    // Extract key facts
    const keyFacts = this.extractKeyFacts(text);
    
    // Extract parties
    const parties = this.extractParties(text);
    
    // Extract dates
    const keyDates = this.extractDates(text);
    
    // Extract monetary values
    const monetaryValues = this.extractMonetaryValues(text);
    
    // Determine urgency flags
    const urgencyFlags = this.determineUrgencyFlags(text, keyDates);
    
    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(urgencyFlags, keyDates, documentTypeGuess);
    
    // Generate summary
    const summary = this.generateSummary(text, documentTypeGuess, keyFacts, userContext);
    
    // Recommend next steps
    const recommendedNextStepsCandidates = this.recommendNextSteps(
      documentTypeGuess,
      riskLevel,
      urgencyFlags,
      keyDates,
      jurisdiction,
      matterType
    );

    return {
      summary,
      documentTypeGuess,
      documentTypeConfidence,
      keyFacts,
      parties,
      keyDates,
      monetaryValues,
      urgencyFlags,
      riskLevel,
      recommendedNextStepsCandidates,
    };
  }

  /**
   * Detect document type from content
   */
  private detectDocumentType(text: string): { type: DocumentTypeGuess; confidence: number } {
    const lowerText = text.toLowerCase();
    
    const patterns: Array<{ type: DocumentTypeGuess; keywords: string[]; weight: number }> = [
      { type: 'complaint', keywords: ['complaint', 'plaintiff', 'cause of action', 'wherefore'], weight: 0.9 },
      { type: 'motion', keywords: ['motion', 'moves the court', 'hereby moves', 'relief'], weight: 0.85 },
      { type: 'order', keywords: ['court order', 'it is ordered', 'hereby ordered', 'judgment'], weight: 0.9 },
      { type: 'summons', keywords: ['summons', 'you are hereby summoned', 'appear in court'], weight: 0.9 },
      { type: 'subpoena', keywords: ['subpoena', 'commanded to appear', 'testimony'], weight: 0.9 },
      { type: 'demand_letter', keywords: ['demand', 'demand letter', 'immediate payment', 'failure to respond'], weight: 0.85 },
      { type: 'contract', keywords: ['agreement', 'contract', 'parties agree', 'terms and conditions', 'hereby agree'], weight: 0.8 },
      { type: 'notice', keywords: ['notice', 'hereby notified', 'take notice', 'notification'], weight: 0.75 },
      { type: 'declaration', keywords: ['declaration', 'i declare', 'under penalty of perjury', 'sworn'], weight: 0.85 },
      { type: 'settlement', keywords: ['settlement', 'settle', 'release', 'compromise'], weight: 0.8 },
      { type: 'judgment', keywords: ['judgment', 'decree', 'adjudged', 'final judgment'], weight: 0.9 },
      { type: 'police_report', keywords: ['police report', 'incident report', 'officer', 'badge'], weight: 0.85 },
      { type: 'medical_record', keywords: ['medical', 'diagnosis', 'patient', 'treatment', 'physician'], weight: 0.8 },
      { type: 'invoice', keywords: ['invoice', 'amount due', 'payment due', 'bill'], weight: 0.75 },
    ];

    let bestMatch: { type: DocumentTypeGuess; confidence: number } = { type: 'unknown', confidence: 0.3 };

    for (const pattern of patterns) {
      const matches = pattern.keywords.filter(kw => lowerText.includes(kw)).length;
      const confidence = (matches / pattern.keywords.length) * pattern.weight;
      
      if (confidence > bestMatch.confidence) {
        bestMatch = { type: pattern.type, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * Extract key facts from text
   */
  private extractKeyFacts(text: string): KeyFact[] {
    const facts: KeyFact[] = [];
    
    // Date patterns
    const dateRegex = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})\b/g;
    let match;
    while ((match = dateRegex.exec(text)) !== null) {
      facts.push({
        type: 'date',
        value: match[1],
        confidence: 0.9,
        context: text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50),
      });
    }

    // Money patterns
    const moneyRegex = /\$[\d,]+\.?\d*/g;
    while ((match = moneyRegex.exec(text)) !== null) {
      facts.push({
        type: 'amount',
        value: match[0],
        confidence: 0.95,
        context: text.substring(Math.max(0, match.index - 30), match.index + match[0].length + 30),
      });
    }

    // Deadline patterns
    const deadlineRegex = /within\s+(\d+)\s+(days?|business days?|weeks?|months?)/gi;
    while ((match = deadlineRegex.exec(text)) !== null) {
      facts.push({
        type: 'deadline',
        value: match[0],
        confidence: 0.85,
        context: text.substring(Math.max(0, match.index - 30), match.index + match[0].length + 30),
      });
    }

    return facts.slice(0, 20); // Limit to 20 facts
  }

  /**
   * Extract party information
   */
  private extractParties(text: string): PartyInfo[] {
    const parties: PartyInfo[] = [];
    
    const rolePatterns: Array<{ role: PartyInfo['role']; patterns: RegExp[] }> = [
      { role: 'plaintiff', patterns: [/plaintiff[:\s]+([A-Z][a-zA-Z\s,]+)/gi, /([A-Z][a-zA-Z\s,]+),?\s+plaintiff/gi] },
      { role: 'defendant', patterns: [/defendant[:\s]+([A-Z][a-zA-Z\s,]+)/gi, /([A-Z][a-zA-Z\s,]+),?\s+defendant/gi] },
      { role: 'petitioner', patterns: [/petitioner[:\s]+([A-Z][a-zA-Z\s,]+)/gi] },
      { role: 'respondent', patterns: [/respondent[:\s]+([A-Z][a-zA-Z\s,]+)/gi] },
      { role: 'attorney', patterns: [/attorney[:\s]+([A-Z][a-zA-Z\s,]+)/gi, /counsel[:\s]+([A-Z][a-zA-Z\s,]+)/gi] },
    ];

    for (const { role, patterns } of rolePatterns) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const name = match[1].trim().replace(/,\s*$/, '');
          if (name.length > 2 && name.length < 100) {
            parties.push({
              name,
              role,
              confidence: 0.75,
            });
          }
        }
      }
    }

    return parties.slice(0, 10); // Limit to 10 parties
  }

  /**
   * Extract important dates
   */
  private extractDates(text: string): KeyDate[] {
    const dates: KeyDate[] = [];
    const today = new Date();
    
    const datePatterns: Array<{ type: KeyDate['type']; patterns: RegExp[] }> = [
      { type: 'deadline', patterns: [/respond\s+by\s+(\w+\s+\d{1,2},?\s+\d{4})/gi, /due\s+(?:on|by)\s+(\w+\s+\d{1,2},?\s+\d{4})/gi] },
      { type: 'hearing', patterns: [/hearing\s+(?:on|set for)\s+(\w+\s+\d{1,2},?\s+\d{4})/gi] },
      { type: 'filing', patterns: [/filed\s+(?:on)?\s*(\w+\s+\d{1,2},?\s+\d{4})/gi] },
    ];

    for (const { type, patterns } of datePatterns) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const dateStr = match[1];
          const parsedDate = new Date(dateStr);
          
          if (!isNaN(parsedDate.getTime())) {
            const daysUntil = Math.ceil((parsedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const isPast = daysUntil < 0;
            
            let urgency: RiskLevel = 'low';
            if (daysUntil < 0) urgency = 'informational';
            else if (daysUntil <= 3) urgency = 'critical';
            else if (daysUntil <= 7) urgency = 'high';
            else if (daysUntil <= 14) urgency = 'medium';

            dates.push({
              type,
              date: parsedDate.toISOString().split('T')[0],
              description: match[0],
              isPast,
              daysUntil: isPast ? undefined : daysUntil,
              urgency,
            });
          }
        }
      }
    }

    return dates.slice(0, 10); // Limit to 10 dates
  }

  /**
   * Extract monetary values
   */
  private extractMonetaryValues(text: string): MonetaryValue[] {
    const values: MonetaryValue[] = [];
    const regex = /\$\s*([\d,]+(?:\.\d{2})?)/g;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      const context = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
      
      // Determine type based on context
      let type: MonetaryValue['type'] = 'other';
      const lowerContext = context.toLowerCase();
      
      if (lowerContext.includes('damage') || lowerContext.includes('compensation')) type = 'damages';
      else if (lowerContext.includes('settle')) type = 'settlement';
      else if (lowerContext.includes('fee') || lowerContext.includes('cost')) type = 'fee';
      else if (lowerContext.includes('fine') || lowerContext.includes('penalty')) type = 'fine';
      else if (lowerContext.includes('debt') || lowerContext.includes('owe')) type = 'debt';
      else if (lowerContext.includes('claim')) type = 'claim';

      values.push({
        amount,
        currency: 'USD',
        type,
        context: context.trim(),
      });
    }

    return values.slice(0, 10); // Limit to 10 values
  }

  /**
   * Determine urgency flags
   */
  private determineUrgencyFlags(text: string, dates: KeyDate[]): UrgencyFlag[] {
    const flags: UrgencyFlag[] = [];
    const lowerText = text.toLowerCase();

    // Check for imminent deadlines
    const imminentDeadlines = dates.filter(d => d.type === 'deadline' && d.daysUntil !== undefined && d.daysUntil <= 7);
    if (imminentDeadlines.length > 0) {
      flags.push('deadline_imminent');
    }

    // Check for response required
    if (lowerText.includes('must respond') || lowerText.includes('failure to respond') || lowerText.includes('response required')) {
      flags.push('response_required');
    }

    // Check for court date
    const courtDates = dates.filter(d => d.type === 'hearing' && !d.isPast);
    if (courtDates.length > 0) {
      flags.push('court_date_set');
    }

    // Check for default risk
    if (lowerText.includes('default') && (lowerText.includes('judgment') || lowerText.includes('fail'))) {
      flags.push('default_risk');
    }

    // Check for time sensitive
    if (lowerText.includes('time sensitive') || lowerText.includes('urgent') || lowerText.includes('immediate')) {
      flags.push('time_sensitive');
    }

    return flags;
  }

  /**
   * Calculate overall risk level
   */
  private calculateRiskLevel(urgencyFlags: UrgencyFlag[], dates: KeyDate[], docType: DocumentTypeGuess): RiskLevel {
    let score = 0;

    // High-risk document types
    if (['summons', 'subpoena', 'complaint', 'order', 'judgment'].includes(docType)) {
      score += 3;
    }

    // Urgency flags
    if (urgencyFlags.includes('default_risk')) score += 4;
    if (urgencyFlags.includes('deadline_imminent')) score += 3;
    if (urgencyFlags.includes('court_date_set')) score += 2;
    if (urgencyFlags.includes('response_required')) score += 2;
    if (urgencyFlags.includes('immediate_action')) score += 3;

    // Critical dates
    const criticalDates = dates.filter(d => d.urgency === 'critical');
    score += criticalDates.length * 2;

    if (score >= 8) return 'critical';
    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    if (score >= 1) return 'low';
    return 'informational';
  }

  /**
   * Generate summary
   */
  private generateSummary(
    text: string,
    docType: DocumentTypeGuess,
    facts: KeyFact[],
    userContext?: string
  ): string {
    const typeDescriptions: Record<DocumentTypeGuess, string> = {
      notice: 'a legal notice',
      order: 'a court order',
      demand_letter: 'a demand letter',
      contract: 'a contractual document',
      complaint: 'a legal complaint/petition',
      motion: 'a court motion',
      declaration: 'a sworn declaration',
      subpoena: 'a subpoena',
      summons: 'a court summons',
      judgment: 'a court judgment',
      settlement: 'a settlement agreement',
      pleading: 'a legal pleading',
      correspondence: 'legal correspondence',
      invoice: 'a financial invoice',
      receipt: 'a receipt',
      identification: 'an identification document',
      medical_record: 'a medical record',
      police_report: 'a police/incident report',
      evidence_photo: 'photographic evidence',
      screenshot: 'a screenshot',
      video_evidence: 'video evidence',
      audio_evidence: 'audio evidence',
      unknown: 'a document',
    };

    const typeDesc = typeDescriptions[docType] || 'a document';
    const dateCount = facts.filter(f => f.type === 'date').length;
    const amountCount = facts.filter(f => f.type === 'amount').length;

    let summary = `This appears to be ${typeDesc}. `;
    
    if (dateCount > 0) {
      summary += `It contains ${dateCount} significant date(s). `;
    }
    
    if (amountCount > 0) {
      summary += `There are ${amountCount} monetary reference(s). `;
    }

    if (userContext) {
      summary += `User context: ${userContext.substring(0, 100)}${userContext.length > 100 ? '...' : ''}`;
    }

    return summary.trim();
  }

  /**
   * Recommend next steps (candidates for LEXARA to evaluate)
   */
  private recommendNextSteps(
    docType: DocumentTypeGuess,
    riskLevel: RiskLevel,
    urgencyFlags: UrgencyFlag[],
    dates: KeyDate[],
    jurisdiction?: string,
    _matterType?: string
  ): NextStepCandidate[] {
    const steps: NextStepCandidate[] = [];

    // Document-type specific recommendations
    if (docType === 'summons' || docType === 'complaint') {
      const deadline = dates.find(d => d.type === 'deadline' && !d.isPast);
      steps.push({
        action: 'Prepare and file a response/answer',
        priority: 'immediate',
        deadline: deadline?.date,
        rationale: 'Failure to respond may result in default judgment',
      });
    }

    if (docType === 'demand_letter') {
      steps.push({
        action: 'Review claims and consider response options',
        priority: 'soon',
        rationale: 'Early response may prevent escalation to litigation',
      });
    }

    if (docType === 'subpoena') {
      steps.push({
        action: 'Review subpoena requirements and compliance deadline',
        priority: 'immediate',
        rationale: 'Non-compliance may result in contempt of court',
      });
    }

    // Risk-level based recommendations
    if (riskLevel === 'critical' || riskLevel === 'high') {
      steps.push({
        action: 'Consult with an attorney immediately',
        priority: 'immediate',
        rationale: 'High-risk situation requires professional legal guidance',
      });
    }

    // Urgency-based recommendations
    if (urgencyFlags.includes('deadline_imminent')) {
      steps.push({
        action: 'Prioritize immediate deadlines',
        priority: 'immediate',
        rationale: 'Missing deadlines can have severe consequences',
      });
    }

    // Jurisdiction-specific
    if (jurisdiction) {
      steps.push({
        action: `Review ${jurisdiction} specific procedures and requirements`,
        priority: 'soon',
        rationale: 'Procedural requirements vary by jurisdiction',
      });
    }

    return steps.slice(0, 5); // Limit to 5 recommendations
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(): void {
    if (this.analysisCount > 0) {
      this.status.averageProcessingTimeMs = Math.round(this.totalProcessingTime / this.analysisCount);
    }
  }

  /**
   * Get FMI status
   */
  getStatus(): FMIStatus {
    return { ...this.status };
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    FMI.instance = null;
  }
}

// Export singleton getter
export const getFMI = (config?: Partial<FMIConfig>): FMI => {
  return FMI.getInstance(config);
};

export default FMI;
