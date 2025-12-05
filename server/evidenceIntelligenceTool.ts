/**
 * Smart Evidence Intelligence Tool
 * Stage 3B Implementation: Multi-format evidence processing and analysis
 * 
 * Processes all file types (documents, images, videos, audio) and extracts:
 * - Factual information and timeline construction
 * - Legal significance classification
 * - Conflict and inconsistency detection
 * - Evidence strength assessment
 */

import { generateUserText, TaskPriority, TaskComplexity, UsageContext } from './aiProvider';
import { getExpertSystemConfig } from './legalCounselExpertSystem';
import type { LawType } from '../shared/legalCounselTypes';
import type { ConsultationFacts, Event, TimelineEntry, Party } from './legalConsultationEngine';
import { createLogger } from './logger';

const log = createLogger('EvidenceIntelligence');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface EvidenceFile {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  uploadDate: Date;
  url?: string;
  metadata?: Record<string, any>;
}

export interface ExtractedEvidence {
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

export interface EvidenceClassification {
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

export interface ConflictDetection {
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

export interface EvidenceStrength {
  overall: 'compelling' | 'strong' | 'moderate' | 'weak' | 'insufficient';
  credibility: number; // 0-100
  reliability: number; // 0-100
  corroboration: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  gaps: string[];
  recommendations: string[];
}

export interface EvidenceAnalysisResult {
  file: EvidenceFile;
  extracted: ExtractedEvidence;
  classification: EvidenceClassification;
  legalSignificance: {
    relevantTo: string[];
    supportsElements: string[];
    weakensDefenses: string[];
    raisesIssues: string[];
  };
  strength: EvidenceStrength;
  summary: string;
  keyFindings: string[];
  nextSteps: string[];
}

export interface ComprehensiveEvidenceReport {
  totalFiles: number;
  filesAnalyzed: number;
  masterTimeline: TimelineEntry[];
  allFacts: string[];
  conflicts: ConflictDetection;
  overallStrength: EvidenceStrength;
  evidenceGaps: string[];
  recommendations: string[];
  individualAnalyses: EvidenceAnalysisResult[];
}

// ============================================================================
// FILE TYPE DETECTION AND PROCESSING
// ============================================================================

/**
 * Determine file category based on MIME type
 */
function categorizeFileType(mimeType: string): 'document' | 'image' | 'video' | 'audio' | 'unknown' {
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
 * Extract text content from various file types
 * Note: In production, this would use actual file processing libraries
 * For now, we'll simulate with metadata/description
 */
async function extractTextFromFile(file: EvidenceFile): Promise<string> {
  // In a real implementation, this would:
  // - Use pdf-parse for PDFs
  // - Use mammoth for DOCX
  // - Use OCR for images (tesseract.js)
  // - Use speech-to-text for audio/video
  // For now, return placeholder that can be overridden with actual content
  
  const fileCategory = categorizeFileType(file.type);
  
  if (file.metadata?.description) {
    return file.metadata.description;
  }
  
  return `[${fileCategory.toUpperCase()} FILE: ${file.name}]\nContent extraction pending. Please provide description or text content in metadata.`;
}

// ============================================================================
// EVIDENCE EXTRACTION ENGINE
// ============================================================================

/**
 * Extract structured evidence from file content
 */
export async function extractEvidenceFromFile(
  file: EvidenceFile,
  lawType: LawType,
  state: string,
  context?: string
): Promise<ExtractedEvidence> {
  log.info('Extracting evidence from file', { fileName: file.name, fileType: file.type });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    const textContent = await extractTextFromFile(file);
    
    const prompt = `As a ${expertConfig.profile.specialty} expert analyzing evidence for a ${lawType.replace(/-/g, ' ')} case in ${state}, extract all relevant information from this evidence file:

FILE: ${file.name}
TYPE: ${file.type}
CONTENT:
${textContent}

${context ? `CASE CONTEXT: ${context}` : ''}

Extract and structure:
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
      {
        taskType: 'evidence-extraction',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Extract evidence from ${file.name}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.1,
        maxTokens: 2500,
        useJSON: true
      }
    );

    const extracted = JSON.parse(response.content);
    
    log.info('Evidence extraction completed', { 
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
    log.error('Failed to extract evidence', { error, fileName: file.name });
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

// ============================================================================
// EVIDENCE CLASSIFICATION
// ============================================================================

/**
 * Classify evidence and assess admissibility
 */
export async function classifyEvidence(
  file: EvidenceFile,
  extracted: ExtractedEvidence,
  lawType: LawType,
  state: string
): Promise<EvidenceClassification> {
  log.info('Classifying evidence', { fileName: file.name });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    const prompt = `As a ${expertConfig.profile.specialty} expert in ${state}, classify this evidence and assess admissibility:

FILE: ${file.name} (${file.type})
EXTRACTED INFORMATION:
${JSON.stringify(extracted, null, 2)}

Classify according to ${state} rules of evidence and Federal Rules of Evidence where applicable.

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
  "rulesApplicable": ["FRE 401", "FRE 803(6)", etc.]
}`;

    const response = await generateUserText(
      {
        taskType: 'evidence-classification',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Classify evidence ${file.name}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 1000,
        useJSON: true
      }
    );

    return JSON.parse(response.content);
    
  } catch (error) {
    log.error('Failed to classify evidence', { error, fileName: file.name });
    return {
      category: 'documentary',
      subType: 'unknown',
      relevance: 'circumstantial',
      admissibility: 'questionable',
      hearsayIssues: false,
      authenticationRequired: true,
      chainOfCustodyNeeded: false,
      expertWitnessRequired: false,
      rulesApplicable: []
    };
  }
}

// ============================================================================
// LEGAL SIGNIFICANCE ASSESSMENT
// ============================================================================

/**
 * Assess legal significance of evidence
 */
export async function assessLegalSignificance(
  file: EvidenceFile,
  extracted: ExtractedEvidence,
  classification: EvidenceClassification,
  lawType: LawType,
  state: string,
  caseContext?: string
): Promise<EvidenceAnalysisResult['legalSignificance']> {
  log.info('Assessing legal significance', { fileName: file.name });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    const prompt = `As a ${expertConfig.profile.specialty} expert, assess the legal significance of this evidence:

FILE: ${file.name}
CLASSIFICATION: ${JSON.stringify(classification)}
EXTRACTED INFO: ${JSON.stringify(extracted, null, 2)}
${caseContext ? `CASE CONTEXT: ${caseContext}` : ''}

Analyze:
1. What legal issues is this evidence relevant to?
2. Which elements of claims/defenses does it support?
3. What opposing defenses does it weaken?
4. What new legal issues does it raise?

Return ONLY valid JSON:
{
  "relevantTo": ["issue1", "issue2"],
  "supportsElements": ["element1", "element2"],
  "weakensDefenses": ["defense1", "defense2"],
  "raisesIssues": ["issue1", "issue2"]
}`;

    const response = await generateUserText(
      {
        taskType: 'legal-significance',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Assess significance of ${file.name}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 1000,
        useJSON: true
      }
    );

    return JSON.parse(response.content);
    
  } catch (error) {
    log.error('Failed to assess legal significance', { error, fileName: file.name });
    return {
      relevantTo: [],
      supportsElements: [],
      weakensDefenses: [],
      raisesIssues: []
    };
  }
}

// ============================================================================
// EVIDENCE STRENGTH ASSESSMENT
// ============================================================================

/**
 * Assess strength and credibility of evidence
 */
export async function assessEvidenceStrength(
  file: EvidenceFile,
  extracted: ExtractedEvidence,
  classification: EvidenceClassification,
  lawType: LawType,
  state: string
): Promise<EvidenceStrength> {
  log.info('Assessing evidence strength', { fileName: file.name });
  
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    const prompt = `As a ${expertConfig.profile.specialty} expert, assess the strength of this evidence:

FILE: ${file.name}
CLASSIFICATION: ${JSON.stringify(classification)}
EXTRACTED: ${JSON.stringify(extracted, null, 2)}

Evaluate:
1. Overall strength (compelling/strong/moderate/weak/insufficient)
2. Credibility score (0-100)
3. Reliability score (0-100)
4. Corroboration score (0-100)
5. Specific strengths
6. Specific weaknesses
7. Evidence gaps
8. Recommendations for strengthening

Return ONLY valid JSON:
{
  "overall": "compelling|strong|moderate|weak|insufficient",
  "credibility": 75,
  "reliability": 80,
  "corroboration": 60,
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "gaps": ["gap1", "gap2"],
  "recommendations": ["rec1", "rec2"]
}`;

    const response = await generateUserText(
      {
        taskType: 'evidence-strength',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Assess strength of ${file.name}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 1500,
        useJSON: true
      }
    );

    return JSON.parse(response.content);
    
  } catch (error) {
    log.error('Failed to assess evidence strength', { error, fileName: file.name });
    return {
      overall: 'moderate',
      credibility: 50,
      reliability: 50,
      corroboration: 50,
      strengths: [],
      weaknesses: [],
      gaps: [],
      recommendations: []
    };
  }
}

// ============================================================================
// COMPREHENSIVE EVIDENCE ANALYSIS
// ============================================================================

/**
 * Perform complete analysis of a single evidence file
 */
export async function analyzeEvidence(
  file: EvidenceFile,
  lawType: LawType,
  state: string,
  caseContext?: string
): Promise<EvidenceAnalysisResult> {
  const startTime = Date.now();
  log.info('Starting comprehensive evidence analysis', { fileName: file.name, lawType, state });
  
  try {
    // Step 1: Extract evidence
    const extracted = await extractEvidenceFromFile(file, lawType, state, caseContext);
    
    // Step 2: Classify evidence
    const classification = await classifyEvidence(file, extracted, lawType, state);
    
    // Step 3: Assess legal significance
    const legalSignificance = await assessLegalSignificance(
      file, 
      extracted, 
      classification, 
      lawType, 
      state, 
      caseContext
    );
    
    // Step 4: Assess strength
    const strength = await assessEvidenceStrength(file, extracted, classification, lawType, state);
    
    // Step 5: Generate summary
    const summary = await generateEvidenceSummary(
      file,
      extracted,
      classification,
      legalSignificance,
      strength,
      lawType,
      state
    );
    
    // Step 6: Generate key findings and next steps
    const keyFindings = generateKeyFindings(extracted, classification, legalSignificance, strength);
    const nextSteps = generateEvidenceNextSteps(classification, strength);
    
    const duration = Date.now() - startTime;
    log.info('Evidence analysis completed', { fileName: file.name, duration });
    
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
    
  } catch (error) {
    log.error('Evidence analysis failed', { error, fileName: file.name });
    throw error;
  }
}

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Detect conflicts and inconsistencies across multiple evidence files
 */
export async function detectConflicts(
  analyses: EvidenceAnalysisResult[],
  lawType: LawType,
  state: string
): Promise<ConflictDetection> {
  log.info('Detecting conflicts across evidence', { analysesCount: analyses.length });
  
  if (analyses.length < 2) {
    return {
      hasConflicts: false,
      conflicts: [],
      inconsistencies: []
    };
  }
  
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    // Compile all evidence summaries
    const evidenceSummaries = analyses.map(a => ({
      file: a.file.name,
      facts: a.extracted.facts,
      timeline: a.extracted.timeline,
      quotes: a.extracted.quotes
    }));
    
    const prompt = `As a ${expertConfig.profile.specialty} expert, analyze these evidence files for conflicts and inconsistencies:

EVIDENCE FILES:
${JSON.stringify(evidenceSummaries, null, 2)}

Identify:
1. Factual conflicts (contradictory statements)
2. Temporal conflicts (timeline inconsistencies)
3. Logical conflicts (internally inconsistent)
4. Testimonial conflicts (witness disagreements)

For each conflict, assess severity and suggest resolution.

Return ONLY valid JSON:
{
  "hasConflicts": boolean,
  "conflicts": [
    {
      "type": "factual|temporal|logical|testimonial",
      "severity": "critical|significant|minor",
      "description": "what conflicts",
      "evidence1": "file1",
      "evidence2": "file2",
      "resolution": "how to resolve"
    }
  ],
  "inconsistencies": [
    {
      "description": "what's inconsistent",
      "impact": "major|moderate|minor",
      "explanation": "why it matters"
    }
  ]
}`;

    const response = await generateUserText(
      {
        taskType: 'conflict-detection',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.HIGH,
        description: 'Detect conflicts across evidence'
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 2000,
        useJSON: true
      }
    );

    return JSON.parse(response.content);
    
  } catch (error) {
    log.error('Failed to detect conflicts', { error });
    return {
      hasConflicts: false,
      conflicts: [],
      inconsistencies: []
    };
  }
}

// ============================================================================
// COMPREHENSIVE EVIDENCE REPORT
// ============================================================================

/**
 * Generate comprehensive report analyzing all evidence files
 */
export async function generateComprehensiveEvidenceReport(
  files: EvidenceFile[],
  lawType: LawType,
  state: string,
  caseContext?: string
): Promise<ComprehensiveEvidenceReport> {
  const startTime = Date.now();
  log.info('Generating comprehensive evidence report', { filesCount: files.length, lawType, state });
  
  try {
    // Analyze each file
    const individualAnalyses: EvidenceAnalysisResult[] = [];
    for (const file of files) {
      const analysis = await analyzeEvidence(file, lawType, state, caseContext);
      individualAnalyses.push(analysis);
    }
    
    // Build master timeline
    const masterTimeline = buildMasterTimeline(individualAnalyses);
    
    // Collect all facts
    const allFacts = individualAnalyses.flatMap(a => a.extracted.facts);
    
    // Detect conflicts
    const conflicts = await detectConflicts(individualAnalyses, lawType, state);
    
    // Assess overall evidence strength
    const overallStrength = assessOverallStrength(individualAnalyses);
    
    // Identify evidence gaps
    const evidenceGaps = identifyEvidenceGaps(individualAnalyses, lawType);
    
    // Generate recommendations
    const recommendations = generateOverallRecommendations(
      individualAnalyses,
      conflicts,
      overallStrength,
      evidenceGaps
    );
    
    const duration = Date.now() - startTime;
    log.info('Comprehensive evidence report completed', { 
      filesCount: files.length, 
      duration,
      totalFacts: allFacts.length
    });
    
    return {
      totalFiles: files.length,
      filesAnalyzed: individualAnalyses.length,
      masterTimeline,
      allFacts,
      conflicts,
      overallStrength,
      evidenceGaps,
      recommendations,
      individualAnalyses
    };
    
  } catch (error) {
    log.error('Failed to generate comprehensive evidence report', { error });
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function generateEvidenceSummary(
  file: EvidenceFile,
  extracted: ExtractedEvidence,
  classification: EvidenceClassification,
  legalSignificance: EvidenceAnalysisResult['legalSignificance'],
  strength: EvidenceStrength,
  lawType: LawType,
  state: string
): Promise<string> {
  try {
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    const prompt = `As a ${expertConfig.profile.specialty} expert, provide a concise summary of this evidence:

FILE: ${file.name}
CLASSIFICATION: ${classification.category} - ${classification.subType}
ADMISSIBILITY: ${classification.admissibility}
STRENGTH: ${strength.overall}

KEY FACTS: ${extracted.facts.slice(0, 5).join('; ')}
LEGAL SIGNIFICANCE: ${legalSignificance.relevantTo.join(', ')}

Write a 2-3 sentence professional summary of this evidence's importance and role in the case.`;

    const response = await generateUserText(
      {
        taskType: 'evidence-summary',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.MEDIUM_USER,
        complexity: TaskComplexity.LOW,
        description: 'Generate evidence summary'
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.3,
        maxTokens: 300
      }
    );

    return response.content;
  } catch (error) {
    return `Evidence file: ${file.name}. Classification: ${classification.category}. Admissibility: ${classification.admissibility}.`;
  }
}

function generateKeyFindings(
  extracted: ExtractedEvidence,
  classification: EvidenceClassification,
  legalSignificance: EvidenceAnalysisResult['legalSignificance'],
  strength: EvidenceStrength
): string[] {
  const findings: string[] = [];
  
  if (classification.admissibility === 'admissible') {
    findings.push('Evidence appears admissible under applicable rules');
  } else if (classification.admissibility === 'inadmissible') {
    findings.push('⚠️ Evidence may be inadmissible - authentication/foundation issues');
  }
  
  if (extracted.facts.length > 0) {
    findings.push(`Extracted ${extracted.facts.length} factual assertions`);
  }
  
  if (legalSignificance.supportsElements.length > 0) {
    findings.push(`Supports ${legalSignificance.supportsElements.length} case elements`);
  }
  
  if (strength.overall === 'compelling' || strength.overall === 'strong') {
    findings.push('✓ Strong evidentiary value for the case');
  }
  
  return findings;
}

function generateEvidenceNextSteps(
  classification: EvidenceClassification,
  strength: EvidenceStrength
): string[] {
  const steps: string[] = [];
  
  if (classification.authenticationRequired) {
    steps.push('Prepare authentication witness or affidavit');
  }
  
  if (classification.chainOfCustodyNeeded) {
    steps.push('Document chain of custody');
  }
  
  if (classification.expertWitnessRequired) {
    steps.push('Retain expert witness for testimony');
  }
  
  if (strength.weaknesses.length > 0) {
    steps.push('Address identified weaknesses through additional evidence');
  }
  
  return steps.concat(strength.recommendations.slice(0, 2));
}

function buildMasterTimeline(analyses: EvidenceAnalysisResult[]): TimelineEntry[] {
  const allEntries: TimelineEntry[] = analyses.flatMap(a => a.extracted.timeline);
  
  // Sort by date
  const sorted = allEntries.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA.getTime() - dateB.getTime();
  });
  
  // Deduplicate similar entries
  const unique: TimelineEntry[] = [];
  for (const entry of sorted) {
    if (!unique.some(u => u.event === entry.event && u.date === entry.date)) {
      unique.push(entry);
    }
  }
  
  return unique;
}

function assessOverallStrength(analyses: EvidenceAnalysisResult[]): EvidenceStrength {
  const strengths = analyses.map(a => a.strength);
  
  const avgCredibility = strengths.reduce((sum, s) => sum + s.credibility, 0) / strengths.length;
  const avgReliability = strengths.reduce((sum, s) => sum + s.reliability, 0) / strengths.length;
  const avgCorroboration = strengths.reduce((sum, s) => sum + s.corroboration, 0) / strengths.length;
  
  let overall: EvidenceStrength['overall'] = 'moderate';
  const avgScore = (avgCredibility + avgReliability + avgCorroboration) / 3;
  
  if (avgScore >= 85) overall = 'compelling';
  else if (avgScore >= 70) overall = 'strong';
  else if (avgScore >= 50) overall = 'moderate';
  else if (avgScore >= 30) overall = 'weak';
  else overall = 'insufficient';
  
  return {
    overall,
    credibility: Math.round(avgCredibility),
    reliability: Math.round(avgReliability),
    corroboration: Math.round(avgCorroboration),
    strengths: strengths.flatMap(s => s.strengths).slice(0, 5),
    weaknesses: strengths.flatMap(s => s.weaknesses).slice(0, 5),
    gaps: strengths.flatMap(s => s.gaps).slice(0, 5),
    recommendations: strengths.flatMap(s => s.recommendations).slice(0, 5)
  };
}

function identifyEvidenceGaps(
  analyses: EvidenceAnalysisResult[],
  lawType: LawType
): string[] {
  const gaps: Set<string> = new Set();
  
  analyses.forEach(a => {
    a.strength.gaps.forEach(gap => gaps.add(gap));
  });
  
  // Add common gaps based on law type
  if (lawType === 'criminal-law') {
    if (!analyses.some(a => a.extracted.quotes.length > 0)) {
      gaps.add('Missing witness statements or testimonial evidence');
    }
  }
  
  return Array.from(gaps);
}

function generateOverallRecommendations(
  analyses: EvidenceAnalysisResult[],
  conflicts: ConflictDetection,
  overallStrength: EvidenceStrength,
  evidenceGaps: string[]
): string[] {
  const recommendations: string[] = [];
  
  if (conflicts.hasConflicts) {
    recommendations.push('Address conflicts and inconsistencies in evidence before trial');
  }
  
  if (overallStrength.overall === 'weak' || overallStrength.overall === 'insufficient') {
    recommendations.push('Strengthen case with additional corroborating evidence');
  }
  
  if (evidenceGaps.length > 0) {
    recommendations.push(`Close ${evidenceGaps.length} identified evidence gap(s)`);
  }
  
  const inadmissible = analyses.filter(a => a.classification.admissibility === 'inadmissible');
  if (inadmissible.length > 0) {
    recommendations.push(`Resolve admissibility issues for ${inadmissible.length} evidence file(s)`);
  }
  
  return recommendations;
}
