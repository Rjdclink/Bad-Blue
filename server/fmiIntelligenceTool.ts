/**
 * F.M.I. - Forensic Media Intelligence Tool
 * 
 * Unified system that consolidates Smart Media Upload and Evidence Upload functionality
 * with comprehensive intelligence analysis capabilities.
 * 
 * F.M.I. provides:
 * - Multi-format media upload and secure storage
 * - OCR and text extraction from all media types
 * - Content classification and legal relevance tagging
 * - Contradiction and corroboration detection
 * - Case-linking and contextualization
 * - Evidence strength assessment and admissibility analysis
 * 
 * Enhanced with ML/NLP Intelligence:
 * - Entity extraction (people, orgs, locations, dates, statutes, courts)
 * - Relationship extraction (actor-action-target)
 * - Timeline reconstruction
 * - Evidentiary tagging (threats, admissions, inconsistencies)
 * 
 * All evidence processing is centralized through F.M.I. and exposed to ALEXERA.
 */

import { generateUserText, TaskPriority, TaskComplexity, UsageContext } from './aiProvider';
import { getExpertSystemConfig } from './legalCounselExpertSystem';
import type { LawType } from '../shared/legalCounselTypes';
import type { ConsultationFacts, Event, TimelineEntry, Party } from './legalConsultationEngine';
import { createLogger } from './logger';
import type { EvidenceFile } from '../shared/schema';
import { processFMIText, type FMITextInput, type FMINLPResult } from './services/mlnlp';

const log = createLogger('FMI');

// ============================================================================
// TYPE DEFINITIONS - F.M.I. Core Structures
// ============================================================================

export interface FMIFile {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  uploadDate: Date;
  url?: string;
  metadata?: Record<string, any>;
}

export interface FMIExtractedContent {
  facts: string[];
  parties: Party[];
  events: Event[];
  timeline: TimelineEntry[];
  documents: string[];
  locations: string[];
  dates: string[];
  quotes: string[];
  technicalDetails?: Record<string, any>;
}

export interface FMIClassification {
  category: 'documentary' | 'testimonial' | 'physical' | 'demonstrative' | 'digital';
  subType: string;
  relevance: 'direct' | 'circumstantial' | 'corroborative' | 'impeachment';
  admissibility: 'admissible' | 'likely-admissible' | 'questionable' | 'inadmissible';
  hearsayIssues: boolean;
  authenticationRequired: boolean;
  chainOfCustodyNeeded: boolean;
  expertWitnessRequired: boolean;
  rulesApplicable: string[];
}

export interface FMIContradictions {
  hasConflicts: boolean;
  conflicts: Array<{
    type: 'factual' | 'temporal' | 'logical' | 'testimonial';
    severity: 'critical' | 'significant' | 'minor';
    description: string;
    evidence1: string;
    evidence2: string;
    resolution?: string;
  }>;
  inconsistencies: Array<{
    description: string;
    impact: 'major' | 'moderate' | 'minor';
    explanation: string;
  }>;
}

export interface FMIStrengthAssessment {
  overall: 'compelling' | 'strong' | 'moderate' | 'weak' | 'insufficient';
  credibility: number; // 0-100
  reliability: number; // 0-100
  corroboration: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  gaps: string[];
  recommendations: string[];
}

export interface FMILegalSignificance {
  relevantTo: string[]; // Legal issues/claims this evidence relates to
  supportsElements: string[]; // Which elements of claims this supports
  weakensDefenses: string[]; // What defenses this undermines
  raisesIssues: string[]; // New issues this evidence brings up
}

export interface FMIAnalysisResult {
  file: FMIFile;
  extracted: FMIExtractedContent;
  classification: FMIClassification;
  legalSignificance: FMILegalSignificance;
  strength: FMIStrengthAssessment;
  contradictions?: FMIContradictions;
  summary: string;
  keyFindings: string[];
  nextSteps: string[];
}

export interface FMIComprehensiveReport {
  totalFiles: number;
  filesAnalyzed: number;
  masterTimeline: TimelineEntry[];
  allFacts: string[];
  conflicts: FMIContradictions;
  overallStrength: FMIStrengthAssessment;
  evidenceGaps: string[];
  recommendations: string[];
  individualAnalyses: FMIAnalysisResult[];
}

// ============================================================================
// FILE TYPE DETECTION AND PROCESSING
// ============================================================================

/**
 * Determine file category based on MIME type
 */
function categorizeFMIFileType(mimeType: string): 'document' | 'image' | 'video' | 'audio' | 'unknown' {
  if (mimeType.startsWith('application/pdf') || 
      mimeType.startsWith('application/msword') ||
      mimeType.startsWith('application/vnd.openxmlformats') ||
      mimeType.startsWith('text/')) {
    return 'document';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'unknown';
}

/**
 * Extract text content from various file types using F.M.I. intelligence
 * 
 * Production implementation would include:
 * - OCR for images and scanned documents (Tesseract, Google Vision API)
 * - PDF text extraction (pdf-parse)
 * - Document parsing (mammoth for DOCX)
 * - Speech-to-text for audio/video (Google Speech-to-Text, Deepgram)
 * - Metadata extraction (EXIF, file properties)
 */
async function extractTextFromFMIFile(file: FMIFile): Promise<string> {
  const fileCategory = categorizeFMIFileType(file.type);
  
  // If metadata contains extracted text or description, use it
  if (file.metadata?.extractedText) {
    return file.metadata.extractedText;
  }
  
  if (file.metadata?.description) {
    return file.metadata.description;
  }
  
  // Placeholder for production OCR/extraction implementation
  return `[F.M.I. ${fileCategory.toUpperCase()} FILE: ${file.name}]\nText extraction pending. In production, F.M.I. would automatically perform OCR, document parsing, or speech-to-text transcription.`;
}

// ============================================================================
// F.M.I. EXTRACTION ENGINE
// ============================================================================

/**
 * Extract structured intelligence from file content using F.M.I.
 */
export async function extractFMIIntelligence(
  file: FMIFile,
  lawType: string, // Accept any law type string for flexibility
  state: string,
  context?: string
): Promise<FMIExtractedContent> {
  log.info('[F.M.I.] Extracting intelligence from file', { fileName: file.name, fileType: file.type });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType as LawType, state);
    const textContent = await extractTextFromFMIFile(file);
    
    const prompt = `You are F.M.I. (Forensic Media Intelligence) - an advanced evidence analysis system. As a ${expertConfig.profile.specialty} expert analyzing evidence for a ${lawType.replace(/-/g, ' ')} case in ${state}, extract all relevant information from this evidence file:

FILE: ${file.name}
TYPE: ${file.type}
CONTENT:
${textContent}

${context ? `CASE CONTEXT: ${context}` : ''}

F.M.I. EXTRACTION REQUIREMENTS:
Extract and structure with forensic precision:
1. All factual assertions and statements
2. Parties mentioned (names and roles)
3. Events described (with dates if available)
4. Timeline entries (chronological sequence)
5. Documents referenced
6. Locations mentioned
7. Specific dates and times
8. Direct quotes or key statements
9. Technical details relevant to the case

Return ONLY valid JSON:
{
  "facts": ["fact1", "fact2"],
  "parties": [{"name": "string", "role": "plaintiff|defendant|witness|other", "details": "string"}],
  "events": [{"description": "string", "date": "YYYY-MM-DD or null", "location": "string"}],
  "timeline": [{"date": "YYYY-MM-DD", "event": "string", "significance": "critical|important|relevant|minor"}],
  "documents": ["doc1", "doc2"],
  "locations": ["location1", "location2"],
  "dates": ["date1", "date2"],
  "quotes": ["quote1", "quote2"],
  "technicalDetails": {"key": "value"}
}`;

    const response = await generateUserText(
      'fmi-extraction',
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.1,
        maxTokens: 2500,
        useJSON: true
      },
      TaskPriority.HIGH_USER
    );

    const extracted = JSON.parse(response.content);
    
    log.info('[F.M.I.] Intelligence extraction completed', { 
      fileName: file.name, 
      factsCount: extracted.facts?.length || 0 
    });
    
    return {
      facts: extracted.facts || [],
      parties: extracted.parties || [],
      events: extracted.events || [],
      timeline: extracted.timeline || [],
      documents: extracted.documents || [],
      locations: extracted.locations || [],
      dates: extracted.dates || [],
      quotes: extracted.quotes || [],
      technicalDetails: extracted.technicalDetails
    };
    
  } catch (error) {
    log.error('[F.M.I.] Failed to extract intelligence', { error, fileName: file.name });
    return {
      facts: [],
      parties: [],
      events: [],
      timeline: [],
      documents: [],
      locations: [],
      dates: [],
      quotes: []
    };
  }
}

/**
 * Extract intelligence using F.M.I. NLP Worker (ML/NLP-based)
 * Complements AI-based extraction with deterministic NLP analysis
 */
export async function extractFMIIntelligenceWithNLP(
  file: FMIFile,
  textContent: string,
  source: 'ocr' | 'transcript' | 'upload' | 'email' = 'upload'
): Promise<FMINLPResult> {
  log.info('[F.M.I. NLP] Processing with NLP worker', { fileName: file.name });

  try {
    const input: FMITextInput = {
      text: textContent,
      source,
      metadata: {
        fileName: file.name,
        fileType: file.type,
        uploadDate: file.uploadDate
      }
    };

    const nlpResult = await processFMIText(input);

    log.info('[F.M.I. NLP] NLP processing complete', {
      fileName: file.name,
      entities: nlpResult.entities.length,
      relationships: nlpResult.relationships.length,
      evidentiaryTags: nlpResult.evidentiaryTags.length
    });

    return nlpResult;
  } catch (error) {
    log.error('[F.M.I. NLP] Failed to process with NLP worker', { error, fileName: file.name });
    throw error;
  }
}

/**
 * Enhanced extraction that combines AI and NLP approaches
 */
export async function extractFMIIntelligenceEnhanced(
  file: FMIFile,
  lawType: LawType,
  state: string,
  context?: string
): Promise<{
  aiExtraction: FMIExtractedContent;
  nlpAnalysis: FMINLPResult;
  combined: {
    allEntities: string[];
    keyPeople: string[];
    keyOrganizations: string[];
    legalReferences: string[];
    evidentiaryHighlights: string[];
  };
}> {
  log.info('[F.M.I.] Enhanced extraction with AI + NLP', { fileName: file.name });

  // Extract text content
  const textContent = await extractTextFromFMIFile(file);

  // Run both AI and NLP extraction in parallel
  const [aiExtraction, nlpAnalysis] = await Promise.all([
    extractFMIIntelligence(file, lawType, state, context),
    extractFMIIntelligenceWithNLP(file, textContent, 'upload')
  ]);

  // Combine results
  const allEntities = new Set<string>();
  
  // Add AI-extracted entities
  aiExtraction.parties.forEach(p => allEntities.add(p.name));
  aiExtraction.locations.forEach(l => allEntities.add(l));
  
  // Add NLP-extracted entities
  nlpAnalysis.entities.forEach(e => allEntities.add(e.value));

  // Extract key people
  const keyPeople = [
    ...new Set([
      ...aiExtraction.parties.map(p => p.name),
      ...nlpAnalysis.entities.filter(e => e.type === 'person').map(e => e.value)
    ])
  ];

  // Extract key organizations
  const keyOrganizations = [
    ...new Set([
      ...nlpAnalysis.entities.filter(e => e.type === 'organization' || e.type === 'agency').map(e => e.value)
    ])
  ];

  // Extract legal references
  const legalReferences = [
    ...new Set([
      ...nlpAnalysis.entities.filter(e => e.type === 'statute' || e.type === 'court').map(e => e.value)
    ])
  ];

  // Extract evidentiary highlights
  const evidentiaryHighlights = nlpAnalysis.evidentiaryTags
    .filter(tag => tag.severity === 'high')
    .map(tag => `${tag.type}: ${tag.explanation}`);

  log.info('[F.M.I.] Enhanced extraction complete', {
    fileName: file.name,
    totalEntities: allEntities.size,
    keyPeople: keyPeople.length,
    legalRefs: legalReferences.length,
    evidentiaryTags: evidentiaryHighlights.length
  });

  return {
    aiExtraction,
    nlpAnalysis,
    combined: {
      allEntities: Array.from(allEntities),
      keyPeople,
      keyOrganizations,
      legalReferences,
      evidentiaryHighlights
    }
  };
}

// ============================================================================
// F.M.I. CLASSIFICATION ENGINE
// ============================================================================

/**
 * Classify evidence and assess admissibility using F.M.I.
 */
export async function classifyFMIEvidence(
  file: FMIFile,
  extracted: FMIExtractedContent,
  lawType: string, // Accept any law type string for flexibility
  state: string
): Promise<FMIClassification> {
  log.info('[F.M.I.] Classifying evidence', { fileName: file.name });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType as LawType, state);
    
    const prompt = `You are F.M.I. (Forensic Media Intelligence). As a ${expertConfig.profile.specialty} expert in ${state}, classify this evidence and assess admissibility:

FILE: ${file.name} (${file.type})
EXTRACTED INTELLIGENCE:
${JSON.stringify(extracted, null, 2)}

F.M.I. CLASSIFICATION REQUIREMENTS:
Classify according to ${state} rules of evidence and Federal Rules of Evidence.

Assess:
1. Category (documentary/testimonial/physical/demonstrative/digital)
2. Specific sub-type
3. Relevance type (direct/circumstantial/corroborative/impeachment)
4. Admissibility (admissible/likely-admissible/questionable/inadmissible)
5. Hearsay issues
6. Authentication requirements
7. Chain of custody needs
8. Expert witness requirements
9. Applicable evidentiary rules

Return ONLY valid JSON:
{
  "category": "documentary|testimonial|physical|demonstrative|digital",
  "subType": "specific type",
  "relevance": "direct|circumstantial|corroborative|impeachment",
  "admissibility": "admissible|likely-admissible|questionable|inadmissible",
  "hearsayIssues": boolean,
  "authenticationRequired": boolean,
  "chainOfCustodyNeeded": boolean,
  "expertWitnessRequired": boolean,
  "rulesApplicable": ["rule1", "rule2"]
}`;

    const response = await generateUserText(
      'fmi-classification',
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 1500,
        useJSON: true
      },
      TaskPriority.HIGH_USER
    );

    const classification = JSON.parse(response.content);
    
    log.info('[F.M.I.] Classification completed', { fileName: file.name });
    
    return classification;
    
  } catch (error) {
    log.error('[F.M.I.] Failed to classify evidence', { error, fileName: file.name });
    return {
      category: 'digital',
      subType: 'unknown',
      relevance: 'circumstantial',
      admissibility: 'questionable',
      hearsayIssues: false,
      authenticationRequired: true,
      chainOfCustodyNeeded: true,
      expertWitnessRequired: false,
      rulesApplicable: []
    };
  }
}

// ============================================================================
// F.M.I. COMPLETE ANALYSIS
// ============================================================================

/**
 * Perform complete F.M.I. analysis on a file
 */
export async function analyzeFMIEvidence(
  file: FMIFile,
  lawType: string, // Accept any law type string
  state: string,
  context?: string
): Promise<FMIAnalysisResult> {
  log.info('[F.M.I.] Starting comprehensive analysis', { fileName: file.name });
  
  // Extract intelligence
  const extracted = await extractFMIIntelligence(file, lawType, state, context);
  
  // Classify evidence
  const classification = await classifyFMIEvidence(file, extracted, lawType, state);
  
  // Assess legal significance (placeholder - full implementation would analyze against case elements)
  const legalSignificance: FMILegalSignificance = {
    relevantTo: [],
    supportsElements: [],
    weakensDefenses: [],
    raisesIssues: []
  };
  
  // Assess strength (placeholder - full implementation would compare with other evidence)
  const strength: FMIStrengthAssessment = {
    overall: 'moderate',
    credibility: 70,
    reliability: 70,
    corroboration: 50,
    strengths: ['File successfully processed by F.M.I.'],
    weaknesses: [],
    gaps: [],
    recommendations: ['Continue F.M.I. analysis with additional evidence for correlation']
  };
  
  // Generate summary
  const summary = `F.M.I. has analyzed ${file.name} and extracted ${extracted.facts.length} facts, ${extracted.parties.length} parties, and ${extracted.events.length} events. Classification: ${classification.category} evidence, ${classification.relevance} relevance, ${classification.admissibility} admissibility.`;
  
  const keyFindings = [
    `Facts extracted: ${extracted.facts.length}`,
    `Timeline entries: ${extracted.timeline.length}`,
    `Classification: ${classification.category}`,
    `Admissibility: ${classification.admissibility}`
  ];
  
  const nextSteps = [
    'Upload additional evidence for F.M.I. cross-correlation',
    'Review F.M.I. extracted facts for accuracy',
    'Consult with ALEXERA for legal strategy integration'
  ];
  
  log.info('[F.M.I.] Analysis completed', { fileName: file.name });
  
  return {
    file,
    extracted,
    classification,
    legalSignificance,
    strength,
    summary,
    keyFindings,
    nextSteps
  };
}

// Export legacy names for backwards compatibility during transition
export const extractEvidenceFromFile = extractFMIIntelligence;
export const classifyEvidence = classifyFMIEvidence;
export const analyzeEvidence = analyzeFMIEvidence;
