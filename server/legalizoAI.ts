// LegalWhat AI Systems Coordinator
// Eight parallel AI systems working in coordinated conjunction

import { analyzeLegalIssue, researchRelevantStatutes } from "./legalAI";

/**
 * AI System 1: Law Type Classification
 * Analyzes user input to determine the appropriate legal category
 */
export async function classifyLawType(userInput: string): Promise<{
  lawType: string;
  confidence: number;
  reasoning: string;
}> {
  try {
    const analysis = await analyzeLegalIssue(userInput, "general");
    
    // Extract law type from analysis
    const lawTypePatterns = {
      'Family Law': /family|divorce|custody|child support|alimony|adoption/i,
      'Criminal Law': /criminal|felony|misdemeanor|arrest|prosecution|defense/i,
      'Employment Law': /employment|workplace|discrimination|wage|labor|fired|wrongful termination/i,
      'Real Estate Law': /property|real estate|landlord|tenant|lease|mortgage|foreclosure/i,
      'Personal Injury': /injury|accident|negligence|malpractice|compensation/i,
      'Contract Law': /contract|agreement|breach|obligation|warranty/i,
      'Intellectual Property': /patent|trademark|copyright|intellectual property|IP/i,
    };

    let bestMatch = { lawType: 'General Law', confidence: 0.3 };
    
    for (const [lawType, pattern] of Object.entries(lawTypePatterns)) {
      if (pattern.test(userInput) || (typeof analysis === 'string' && pattern.test(analysis))) {
        bestMatch = { lawType, confidence: 0.8 };
        break;
      }
    }

    return {
      ...bestMatch,
      reasoning: `Based on keywords and context analysis`,
    };
  } catch (error) {
    console.error("Law type classification error:", error);
    return {
      lawType: 'General Law',
      confidence: 0.5,
      reasoning: 'Unable to determine specific category',
    };
  }
}

/**
 * AI System 2: Document Drafting Suggestions
 * Provides intelligent suggestions for document content
 */
export async function generateDraftingSuggestions(
  lawType: string,
  context: any
): Promise<string[]> {
  const suggestions: string[] = [];
  
  // Law-type specific suggestions
  const suggestionsByType: Record<string, string[]> = {
    'Family Law': [
      'Include specific dates of incidents',
      'List all parties involved with full legal names',
      'Document any existing court orders or agreements',
      'Specify desired outcomes clearly',
    ],
    'Employment Law': [
      'Detail employment dates and position',
      'Include documentation of incidents (dates, witnesses)',
      'Reference employment contract or handbook violations',
      'Specify damages sought',
    ],
    'Contract Law': [
      'Reference specific contract clauses',
      'Document communication regarding the breach',
      'Calculate financial damages precisely',
      'Include timeline of events',
    ],
  };

  suggestions.push(...(suggestionsByType[lawType] || [
    'Provide clear factual statements',
    'Include relevant dates and documentation',
    'Specify relief sought',
    'List all parties involved',
  ]));

  return suggestions;
}

/**
 * AI System 3: Legal Language Optimization
 * Optimizes text for legal precision and effectiveness
 */
export function optimizeLegalLanguage(text: string): string {
  let optimized = text;

  // Replace informal language with formal legal terms
  const replacements: Record<string, string> = {
    'I think': 'It is asserted that',
    'maybe': 'potentially',
    'kind of': 'approximately',
    'got': 'received',
    'gonna': 'going to',
    'wanna': 'wish to',
  };

  for (const [informal, formal] of Object.entries(replacements)) {
    const regex = new RegExp(`\\b${informal}\\b`, 'gi');
    optimized = optimized.replace(regex, formal);
  }

  // Ensure proper capitalization of legal terms
  const legalTerms = ['plaintiff', 'defendant', 'court', 'statute', 'jurisdiction'];
  legalTerms.forEach(term => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    optimized = optimized.replace(regex, term.charAt(0).toUpperCase() + term.slice(1));
  });

  return optimized;
}

/**
 * AI System 4: Consultation Question Generation
 * Generates relevant follow-up questions for thorough consultation
 */
export function generateConsultationQuestions(
  lawType: string,
  currentInfo: any
): string[] {
  const baseQuestions = [
    'What is the current status of your matter?',
    'What is your desired outcome?',
    'Are there any deadlines or time constraints?',
  ];

  const typeSpecificQuestions: Record<string, string[]> = {
    'Family Law': [
      'Are there minor children involved?',
      'What custody arrangement do you seek?',
      'Is there a history of domestic issues?',
    ],
    'Employment Law': [
      'How long were you employed?',
      'Did you file a complaint with HR or EEOC?',
      'Do you have written documentation?',
    ],
    'Personal Injury': [
      'What were the extent of your injuries?',
      'Did you receive medical treatment?',
      'Was a police report filed?',
    ],
  };

  return [
    ...baseQuestions,
    ...(typeSpecificQuestions[lawType] || []),
  ];
}

/**
 * AI System 5: Input Validation
 * Validates user input for completeness and accuracy
 */
export function validateUserInput(input: any, lawType: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!input.description || input.description.length < 50) {
    errors.push('Description must be at least 50 characters');
  }

  if (!input.jurisdiction || !input.state) {
    errors.push('Jurisdiction information is required');
  }

  // Check for dates
  if (input.incidentDate) {
    const date = new Date(input.incidentDate);
    if (date > new Date()) {
      errors.push('Incident date cannot be in the future');
    }
  } else {
    warnings.push('Consider adding specific dates for incidents');
  }

  // Law type specific validation
  if (lawType === 'Personal Injury' && !input.injuryDetails) {
    warnings.push('Detailed injury information would strengthen your case');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * AI System 6: Outcome Prediction
 * Analyzes case details to predict potential outcomes
 */
export async function predictOutcome(
  lawType: string,
  caseDetails: any
): Promise<{
  likelihood: 'high' | 'medium' | 'low';
  factors: string[];
  recommendations: string[];
}> {
  const factors: string[] = [];
  const recommendations: string[] = [];
  let likelihood: 'high' | 'medium' | 'low' = 'medium';

  // Analyze strength indicators
  if (caseDetails.hasEvidence) {
    factors.push('Strong documentation available');
    likelihood = 'high';
  } else {
    factors.push('Limited documentation');
    recommendations.push('Gather additional evidence to strengthen case');
  }

  if (caseDetails.hasWitnesses) {
    factors.push('Witness testimony available');
  } else {
    recommendations.push('Identify potential witnesses');
  }

  if (caseDetails.jurisdictionFavorable) {
    factors.push('Favorable jurisdiction for this type of case');
  }

  return { likelihood, factors, recommendations };
}

/**
 * AI System 7: Auto-fill Legal Data
 * Automatically populates repetitive legal fields
 */
export function autoFillLegalData(
  templateData: any,
  userProfile: any
): any {
  const filled = { ...templateData };

  // Auto-fill from user profile
  if (userProfile.firstName && userProfile.lastName) {
    filled.plaintiffName = `${userProfile.firstName} ${userProfile.lastName}`;
  }

  if (userProfile.address) {
    filled.plaintiffAddress = userProfile.address;
  }

  if (userProfile.email) {
    filled.contactEmail = userProfile.email;
  }

  // Auto-fill common legal boilerplate
  filled.verificationStatement = 
    `I, ${filled.plaintiffName}, declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct.`;

  filled.executionDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return filled;
}

/**
 * AI System 8: Consultation Summarization
 * Synthesizes consultation data for document creation
 */
export function summarizeConsultation(consultationData: any): {
  keyFacts: string[];
  legalIssues: string[];
  requestedRelief: string[];
  timeline: Array<{ date: string; event: string }>;
} {
  const summary = {
    keyFacts: [] as string[],
    legalIssues: [] as string[],
    requestedRelief: [] as string[],
    timeline: [] as Array<{ date: string; event: string }>,
  };

  // Extract key facts
  if (consultationData.description) {
    const sentences = consultationData.description
      .split('.')
      .filter((s: string) => s.trim().length > 20)
      .map((s: string) => s.trim());
    summary.keyFacts = sentences.slice(0, 5);
  }

  // Extract legal issues
  if (consultationData.allegations) {
    summary.legalIssues = Array.isArray(consultationData.allegations)
      ? consultationData.allegations
      : [consultationData.allegations];
  }

  // Extract requested relief
  if (consultationData.desiredOutcome) {
    summary.requestedRelief = [consultationData.desiredOutcome];
  }

  // Build timeline
  if (consultationData.incidentDate) {
    summary.timeline.push({
      date: consultationData.incidentDate,
      event: 'Primary incident occurred',
    });
  }

  return summary;
}

/**
 * Master Coordinator
 * Orchestrates all eight AI systems for comprehensive legal assistance
 */
export async function coordinateAISystems(
  input: {
    userQuery: string;
    lawType?: string;
    consultationData?: any;
    userProfile?: any;
  }
): Promise<{
  classification: Awaited<ReturnType<typeof classifyLawType>>;
  validation: ReturnType<typeof validateUserInput>;
  suggestions: Awaited<ReturnType<typeof generateDraftingSuggestions>>;
  questions: string[];
  optimizedText?: string;
  prediction?: Awaited<ReturnType<typeof predictOutcome>>;
  autoFilledData?: any;
  summary?: ReturnType<typeof summarizeConsultation>;
}> {
  // AI System 1: Classify law type if not provided
  const classification = input.lawType
    ? { lawType: input.lawType, confidence: 1.0, reasoning: 'User-specified' }
    : await classifyLawType(input.userQuery);

  // AI System 5: Validate input
  const validation = validateUserInput(
    input.consultationData || { description: input.userQuery },
    classification.lawType
  );

  // AI System 2: Generate suggestions
  const suggestions = await generateDraftingSuggestions(
    classification.lawType,
    input.consultationData
  );

  // AI System 4: Generate follow-up questions
  const questions = generateConsultationQuestions(
    classification.lawType,
    input.consultationData
  );

  // AI System 3: Optimize text if available
  const optimizedText = input.userQuery
    ? optimizeLegalLanguage(input.userQuery)
    : undefined;

  // AI System 6: Predict outcome if enough data
  const prediction = input.consultationData
    ? await predictOutcome(classification.lawType, input.consultationData)
    : undefined;

  // AI System 7: Auto-fill data if user profile available
  const autoFilledData = input.userProfile
    ? autoFillLegalData(input.consultationData || {}, input.userProfile)
    : undefined;

  // AI System 8: Summarize consultation if data available
  const summary = input.consultationData
    ? summarizeConsultation(input.consultationData)
    : undefined;

  return {
    classification,
    validation,
    suggestions,
    questions,
    optimizedText,
    prediction,
    autoFilledData,
    summary,
  };
}
