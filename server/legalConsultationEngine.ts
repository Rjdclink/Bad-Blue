/**
 * Legal Consultation Engine - Mastermind Coordinator
 * Stage 1B Implementation: Multi-agent AI legal consultation system
 * 
 * This engine acts as the strategic controller and decision architect,
 * orchestrating all legal tools and AI models to provide comprehensive
 * legal consultation across 29 areas of law.
 */

import { generateUserText, TaskPriority, TaskComplexity, UsageContext } from './aiProvider';
import { getExpertSystemConfig } from './legalCounselExpertSystem';
import { checkFact, extractClaimsFromResponse } from './factCheckingEngine';
import type { LawType } from '../shared/legalCounselTypes';
import { createLogger } from './logger';

const log = createLogger('ConsultationEngine');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Party {
  name: string;
  role: 'plaintiff' | 'defendant' | 'witness' | 'third-party' | 'other';
  details?: string;
}

export interface Event {
  description: string;
  date?: Date | string;
  location?: string;
  participants?: string[];
}

export interface TimelineEntry {
  date: Date | string;
  event: string;
  significance: 'critical' | 'important' | 'relevant' | 'minor';
}

export interface DocumentReference {
  name: string;
  type: string;
  exists: boolean;
  needed?: boolean;
}

export interface Location {
  description: string;
  jurisdiction?: string;
  relevance: string;
}

export interface Element {
  name: string;
  description: string;
  required: boolean;
  satisfied: boolean | null; // null = uncertain
  supportingFacts: string[];
  missingEvidence: string[];
  notes?: string;
}

export interface CauseOfAction {
  name: string;
  description: string;
  statute?: string;
  elements: Element[];
  strength: 'strong' | 'moderate' | 'weak' | 'insufficient';
  viabilityScore: number; // 0-100
  notes: string;
  recommendations: string[];
}

export interface ProceduralPosture {
  stage: 'pre-litigation' | 'filing' | 'discovery' | 'motion-practice' | 'trial' | 'appeal' | 'post-judgment';
  jurisdiction: string;
  statueOfLimitationsDeadline?: Date | string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  nextFilingDeadline?: Date | string;
}

export interface StrengthAssessment {
  overall: 'strong' | 'moderate' | 'weak' | 'very-weak';
  viabilityScore: number; // 0-100
  confidenceLevel: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
}

export interface NextStep {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  deadline?: Date | string;
  reason: string;
  dependencies?: string[];
  estimatedTime?: string;
}

export interface MissingElement {
  causeOfAction: string;
  element: string;
  impact: 'case-fatal' | 'significantly-weakens' | 'moderately-weakens' | 'minor';
  suggestedEvidence: string[];
  questions: string[];
}

export interface ConsultationFacts {
  parties: Party[];
  events: Event[];
  timeline: TimelineEntry[];
  documents: DocumentReference[];
  locations: Location[];
  keyFacts: string[];
}

export interface ConsultationAnalysis {
  causesOfAction: CauseOfAction[];
  missingElements: MissingElement[];
  proceduralPosture: ProceduralPosture;
  strengthAssessment: StrengthAssessment;
  legalPrinciples: string[];
  applicableStatutes: string[];
}

export interface InterviewQuestion {
  question: string;
  purpose: string;
  followUps?: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ConsultationResponse {
  summary: string;
  analysis: ConsultationAnalysis;
  recommendations: string[];
  nextSteps: NextStep[];
  questions: InterviewQuestion[];
  verified: boolean;
  verificationDetails?: {
    claimsChecked: number;
    claimsVerified: number;
    confidence: number;
  };
}

// ============================================================================
// INTERVIEW ORCHESTRATOR
// ============================================================================

/**
 * Generate adaptive interview questions based on law type and current facts
 */
export async function generateInterviewQuestions(
  lawType: LawType,
  state: string,
  existingFacts: Partial<ConsultationFacts>,
  context?: string
): Promise<InterviewQuestion[]> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert with ${expertConfig.profile.yearsExperience} years of experience, generate 5-7 targeted interview questions to gather essential facts for this ${lawType.replace(/-/g, ' ')} consultation.

Current Facts Known:
${JSON.stringify(existingFacts, null, 2)}

${context ? `Additional Context: ${context}` : ''}

Generate questions that:
1. Fill critical gaps in the fact pattern
2. Identify potential causes of action
3. Uncover missing elements needed to prove the case
4. Clarify timeline and sequence of events
5. Identify key parties and witnesses
6. Determine jurisdiction and procedural posture

Return ONLY a JSON array of questions in this format:
[
  {
    "question": "The actual question text",
    "purpose": "Why this question is important",
    "followUps": ["Potential follow-up question if needed"],
    "priority": "critical|high|medium|low"
  }
]`;

  try {
    const response = await generateUserText(
      {
        taskType: 'legal-consultation',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Generate interview questions for ${lawType}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.3,
        maxTokens: 1500,
        useJSON: true
      }
    );

    const questions = JSON.parse(response.content);
    return Array.isArray(questions) ? questions : [];
  } catch (error) {
    log.error('Failed to generate interview questions', { error, lawType, state });
    return [];
  }
}

// ============================================================================
// FACT EXTRACTION ENGINE
// ============================================================================

/**
 * Extract structured facts from unstructured client narrative
 */
export async function extractFacts(
  narrative: string,
  lawType: LawType,
  state: string
): Promise<ConsultationFacts> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert, extract and structure all relevant facts from this client narrative:

"${narrative}"

Identify and extract:
1. All parties involved (names, roles: plaintiff/defendant/witness/third-party)
2. Key events (descriptions, dates, locations)
3. Timeline of events (chronological order)
4. Documents mentioned (existing or needed)
5. Locations (with jurisdictional relevance)
6. Key factual assertions

Return ONLY valid JSON in this exact format:
{
  "parties": [{"name": "string", "role": "plaintiff|defendant|witness|third-party|other", "details": "string"}],
  "events": [{"description": "string", "date": "YYYY-MM-DD or null", "location": "string", "participants": ["names"]}],
  "timeline": [{"date": "YYYY-MM-DD", "event": "string", "significance": "critical|important|relevant|minor"}],
  "documents": [{"name": "string", "type": "string", "exists": boolean, "needed": boolean}],
  "locations": [{"description": "string", "jurisdiction": "string", "relevance": "string"}],
  "keyFacts": ["fact1", "fact2", "fact3"]
}`;

  try {
    const response = await generateUserText(
      {
        taskType: 'fact-extraction',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Extract facts from ${lawType} narrative`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.1,
        maxTokens: 2000,
        useJSON: true
      }
    );

    const facts = JSON.parse(response.content);
    return {
      parties: facts.parties || [],
      events: facts.events || [],
      timeline: facts.timeline || [],
      documents: facts.documents || [],
      locations: facts.locations || [],
      keyFacts: facts.keyFacts || []
    };
  } catch (error) {
    log.error('Failed to extract facts', { error, lawType, state });
    return {
      parties: [],
      events: [],
      timeline: [],
      documents: [],
      locations: [],
      keyFacts: []
    };
  }
}

// ============================================================================
// LEGAL ISSUE IDENTIFIER
// ============================================================================

/**
 * Identify potential causes of action and legal issues
 */
export async function identifyLegalIssues(
  facts: ConsultationFacts,
  lawType: LawType,
  state: string
): Promise<CauseOfAction[]> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert practicing in ${state}, analyze these facts and identify all potential causes of action:

Facts:
${JSON.stringify(facts, null, 2)}

For each potential cause of action:
1. Identify the legal claim (with statute reference if applicable)
2. List all required elements
3. Assess which elements are satisfied by current facts
4. Determine strength of claim (strong/moderate/weak/insufficient)
5. Calculate viability score (0-100)
6. Provide analysis notes and recommendations

Focus on ${state}-specific law and cite relevant statutes.

Return ONLY valid JSON array in this exact format:
[
  {
    "name": "Cause of action name",
    "description": "Brief description",
    "statute": "${state} statute citation or null",
    "elements": [
      {
        "name": "Element name",
        "description": "Element description",
        "required": true,
        "satisfied": true|false|null,
        "supportingFacts": ["fact1", "fact2"],
        "missingEvidence": ["evidence needed"],
        "notes": "analysis notes"
      }
    ],
    "strength": "strong|moderate|weak|insufficient",
    "viabilityScore": 75,
    "notes": "Overall analysis",
    "recommendations": ["recommendation1", "recommendation2"]
  }
]`;

  try {
    const response = await generateUserText(
      {
        taskType: 'legal-analysis',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.CRITICAL_USER,
        complexity: TaskComplexity.HIGH,
        description: `Identify causes of action for ${lawType}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 3000,
        useJSON: true
      }
    );

    const causes = JSON.parse(response.content);
    return Array.isArray(causes) ? causes : [];
  } catch (error) {
    log.error('Failed to identify legal issues', { error, lawType, state });
    return [];
  }
}

// ============================================================================
// GAP ANALYSIS ENGINE
// ============================================================================

/**
 * Analyze gaps in facts and evidence for each cause of action
 */
export async function analyzeGaps(
  causesOfAction: CauseOfAction[],
  facts: ConsultationFacts,
  lawType: LawType,
  state: string
): Promise<MissingElement[]> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert, perform gap analysis for these causes of action:

Causes of Action:
${JSON.stringify(causesOfAction, null, 2)}

Current Facts:
${JSON.stringify(facts, null, 2)}

For each unsatisfied or uncertain element:
1. Assess the impact on the case (case-fatal, significantly-weakens, moderately-weakens, minor)
2. Suggest specific evidence needed
3. Generate targeted questions to elicit missing information

Return ONLY valid JSON array:
[
  {
    "causeOfAction": "Name of cause",
    "element": "Element that's missing/uncertain",
    "impact": "case-fatal|significantly-weakens|moderately-weakens|minor",
    "suggestedEvidence": ["evidence1", "evidence2"],
    "questions": ["question1", "question2"]
  }
]`;

  try {
    const response = await generateUserText(
      {
        taskType: 'gap-analysis',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Gap analysis for ${lawType}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 2000,
        useJSON: true
      }
    );

    const gaps = JSON.parse(response.content);
    return Array.isArray(gaps) ? gaps : [];
  } catch (error) {
    log.error('Failed to analyze gaps', { error, lawType, state });
    return [];
  }
}

// ============================================================================
// PROCEDURAL STRATEGY GENERATOR
// ============================================================================

/**
 * Generate procedural strategy and determine posture
 */
export async function generateProceduralStrategy(
  analysis: Partial<ConsultationAnalysis>,
  facts: ConsultationFacts,
  lawType: LawType,
  state: string
): Promise<{ posture: ProceduralPosture; nextSteps: NextStep[] }> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert in ${state}, determine procedural posture and strategy:

Analysis:
${JSON.stringify(analysis, null, 2)}

Facts:
${JSON.stringify(facts, null, 2)}

Determine:
1. Current procedural stage
2. Jurisdiction (state/federal, venue)
3. Statute of limitations deadline (calculate if possible)
4. Urgency level
5. Next filing deadlines
6. Prioritized next steps with deadlines and reasoning

Return ONLY valid JSON:
{
  "posture": {
    "stage": "pre-litigation|filing|discovery|motion-practice|trial|appeal|post-judgment",
    "jurisdiction": "${state} or Federal",
    "statueOfLimitationsDeadline": "YYYY-MM-DD or null",
    "urgency": "critical|high|medium|low",
    "nextFilingDeadline": "YYYY-MM-DD or null"
  },
  "nextSteps": [
    {
      "action": "Specific action to take",
      "priority": "critical|high|medium|low",
      "deadline": "YYYY-MM-DD or null",
      "reason": "Why this step is necessary",
      "dependencies": ["prerequisite steps"],
      "estimatedTime": "time estimate"
    }
  ]
}`;

  try {
    const response = await generateUserText(
      {
        taskType: 'procedural-strategy',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Generate procedural strategy for ${lawType}`
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.2,
        maxTokens: 2000,
        useJSON: true
      }
    );

    const result = JSON.parse(response.content);
    return {
      posture: result.posture || {
        stage: 'pre-litigation',
        jurisdiction: state,
        urgency: 'medium'
      },
      nextSteps: result.nextSteps || []
    };
  } catch (error) {
    log.error('Failed to generate procedural strategy', { error, lawType, state });
    return {
      posture: {
        stage: 'pre-litigation',
        jurisdiction: state,
        urgency: 'medium'
      },
      nextSteps: []
    };
  }
}

// ============================================================================
// STRENGTH ASSESSMENT
// ============================================================================

/**
 * Assess overall case strength
 */
export async function assessStrength(
  analysis: Partial<ConsultationAnalysis>,
  facts: ConsultationFacts,
  lawType: LawType,
  state: string
): Promise<StrengthAssessment> {
  const expertConfig = getExpertSystemConfig(lawType, state);
  
  const prompt = `As a ${expertConfig.profile.specialty} expert, provide comprehensive strength assessment:

Analysis:
${JSON.stringify(analysis, null, 2)}

Facts:
${JSON.stringify(facts, null, 2)}

Assess:
1. Overall strength (strong/moderate/weak/very-weak)
2. Viability score (0-100)
3. Confidence level in assessment (0-100)
4. Key strengths
5. Key weaknesses
6. Risks and challenges
7. Opportunities and leverage points

Be realistic and professional. Consider likelihood of success at trial or settlement.

Return ONLY valid JSON:
{
  "overall": "strong|moderate|weak|very-weak",
  "viabilityScore": 75,
  "confidenceLevel": 85,
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "risks": ["risk1", "risk2"],
  "opportunities": ["opportunity1", "opportunity2"]
}`;

  try {
    const response = await generateUserText(
      {
        taskType: 'strength-assessment',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: `Assess case strength for ${lawType}`
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
    log.error('Failed to assess strength', { error, lawType, state });
    return {
      overall: 'moderate',
      viabilityScore: 50,
      confidenceLevel: 50,
      strengths: [],
      weaknesses: [],
      risks: [],
      opportunities: []
    };
  }
}

// ============================================================================
// MAIN CONSULTATION ENGINE
// ============================================================================

/**
 * Comprehensive legal consultation - the mastermind coordinator
 * This is the main entry point that orchestrates all components
 */
export async function performConsultation(
  situation: string,
  lawType: LawType,
  state: string,
  options: {
    includeQuestions?: boolean;
    verifyAll?: boolean;
    detailLevel?: 'summary' | 'detailed' | 'comprehensive';
  } = {}
): Promise<ConsultationResponse> {
  const startTime = Date.now();
  
  log.info('Starting comprehensive consultation', { lawType, state, situationLength: situation.length });

  try {
    // Get expert configuration
    const expertConfig = getExpertSystemConfig(lawType, state);
    
    // STEP 1: Extract Facts
    log.info('Extracting facts from narrative');
    const facts = await extractFacts(situation, lawType, state);
    
    // STEP 2: Identify Legal Issues / Causes of Action
    log.info('Identifying legal issues and causes of action');
    const causesOfAction = await identifyLegalIssues(facts, lawType, state);
    
    // STEP 3: Gap Analysis
    log.info('Performing gap analysis');
    const missingElements = await analyzeGaps(causesOfAction, facts, lawType, state);
    
    // STEP 4: Procedural Strategy
    log.info('Generating procedural strategy');
    const { posture, nextSteps } = await generateProceduralStrategy(
      { causesOfAction, missingElements },
      facts,
      lawType,
      state
    );
    
    // STEP 5: Strength Assessment
    log.info('Assessing case strength');
    const strengthAssessment = await assessStrength(
      { causesOfAction, missingElements, proceduralPosture: posture },
      facts,
      lawType,
      state
    );
    
    // STEP 6: Generate Summary
    log.info('Generating consultation summary');
    const summary = await generateConsultationSummary(
      {
        causesOfAction,
        missingElements,
        proceduralPosture: posture,
        strengthAssessment,
        legalPrinciples: [],
        applicableStatutes: causesOfAction.map(c => c.statute).filter(Boolean) as string[]
      },
      facts,
      nextSteps,
      expertConfig,
      options.detailLevel || 'detailed'
    );
    
    // STEP 7: Generate Follow-up Questions (if requested)
    let questions: InterviewQuestion[] = [];
    if (options.includeQuestions !== false) {
      log.info('Generating interview questions');
      questions = await generateInterviewQuestions(lawType, state, facts, situation);
    }
    
    // STEP 8: Fact-Check (if requested)
    let verified = false;
    let verificationDetails: ConsultationResponse['verificationDetails'];
    
    if (options.verifyAll) {
      log.info('Performing fact-checking verification');
      const claims = extractClaimsFromResponse(summary);
      let verifiedCount = 0;
      let totalConfidence = 0;
      
      for (const claim of claims.slice(0, 5)) { // Limit to 5 most important claims
        try {
          const result = await checkFact({
            claim,
            context: { lawType, state }
          });
          if (result.verified) verifiedCount++;
          totalConfidence += result.confidence;
        } catch (error) {
          log.warn('Fact-check failed for claim', { claim, error });
        }
      }
      
      verified = verifiedCount >= Math.ceil(claims.length * 0.7); // 70% threshold
      verificationDetails = {
        claimsChecked: claims.length,
        claimsVerified: verifiedCount,
        confidence: claims.length > 0 ? totalConfidence / claims.length : 0
      };
    }
    
    const duration = Date.now() - startTime;
    log.info('Consultation completed', { 
      lawType, 
      state, 
      duration, 
      causesIdentified: causesOfAction.length,
      nextStepsGenerated: nextSteps.length
    });
    
    return {
      summary,
      analysis: {
        causesOfAction,
        missingElements,
        proceduralPosture: posture,
        strengthAssessment,
        legalPrinciples: [],
        applicableStatutes: causesOfAction.map(c => c.statute).filter(Boolean) as string[]
      },
      recommendations: generateRecommendations(causesOfAction, strengthAssessment, missingElements),
      nextSteps,
      questions,
      verified,
      verificationDetails
    };
    
  } catch (error) {
    log.error('Consultation failed', { error, lawType, state });
    throw new Error(`Consultation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate human-readable consultation summary
 */
async function generateConsultationSummary(
  analysis: ConsultationAnalysis,
  facts: ConsultationFacts,
  nextSteps: NextStep[],
  expertConfig: ReturnType<typeof getExpertSystemConfig>,
  detailLevel: 'summary' | 'detailed' | 'comprehensive'
): Promise<string> {
  const prompt = `As a ${expertConfig.profile.specialty} expert, create a professional consultation summary:

Analysis:
${JSON.stringify(analysis, null, 2)}

Facts:
${JSON.stringify(facts, null, 2)}

Next Steps:
${JSON.stringify(nextSteps, null, 2)}

Create a ${detailLevel} consultation summary that:
1. Opens with key findings and overall assessment
2. Explains identified causes of action and their viability
3. Discusses strengths and weaknesses professionally
4. Outlines procedural considerations
5. Recommends immediate actions
6. Sets realistic expectations
7. Includes appropriate legal disclaimers

Style: ${expertConfig.profile.tone}, Professional, Clear
Detail Level: ${detailLevel === 'summary' ? '2-3 paragraphs' : detailLevel === 'detailed' ? '4-6 paragraphs' : '8-10 paragraphs'}

Write in narrative form, not JSON.`;

  try {
    const response = await generateUserText(
      {
        taskType: 'consultation-summary',
        context: UsageContext.USER_INITIATED,
        priority: TaskPriority.HIGH_USER,
        complexity: TaskComplexity.MEDIUM,
        description: 'Generate consultation summary'
      },
      prompt,
      {
        systemPrompt: expertConfig.systemPrompt,
        temperature: 0.4,
        maxTokens: detailLevel === 'comprehensive' ? 4000 : detailLevel === 'detailed' ? 2500 : 1500
      }
    );

    return response.content;
  } catch (error) {
    log.error('Failed to generate summary', { error });
    return 'Unable to generate consultation summary at this time. Please consult with a licensed attorney.';
  }
}

/**
 * Generate actionable recommendations based on analysis
 */
function generateRecommendations(
  causesOfAction: CauseOfAction[],
  strengthAssessment: StrengthAssessment,
  missingElements: MissingElement[]
): string[] {
  const recommendations: string[] = [];
  
  // Based on strength
  if (strengthAssessment.overall === 'strong') {
    recommendations.push('Your case appears to have strong merit. Consider proceeding with formal legal action.');
  } else if (strengthAssessment.overall === 'moderate') {
    recommendations.push('Your case has moderate viability. Gather additional evidence before deciding on litigation.');
  } else if (strengthAssessment.overall === 'weak') {
    recommendations.push('Your case faces significant challenges. Carefully weigh litigation costs against potential outcomes.');
  } else {
    recommendations.push('Based on current facts, this case may be very difficult to pursue. Consider alternative dispute resolution.');
  }
  
  // Based on missing elements
  const caseFatalGaps = missingElements.filter(m => m.impact === 'case-fatal');
  if (caseFatalGaps.length > 0) {
    recommendations.push(`Critical: Obtain evidence for ${caseFatalGaps.length} essential element(s) before proceeding.`);
  }
  
  // Based on causes of action
  const strongClaims = causesOfAction.filter(c => c.strength === 'strong');
  if (strongClaims.length > 0) {
    recommendations.push(`Focus initial efforts on your strongest claim(s): ${strongClaims.map(c => c.name).join(', ')}`);
  }
  
  // General recommendation
  recommendations.push('Consult with a licensed attorney in your jurisdiction for specific legal advice tailored to your situation.');
  
  return recommendations;
}
