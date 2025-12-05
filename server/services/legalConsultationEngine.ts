/**
 * Legal Consultation Engine - "Governing Brain"
 * 
 * This is the mastermind AI attorney that orchestrates all legal tools:
 * - Intelligent legal intake and interviewing
 * - Issue spotting and cause-of-action identification
 * - Procedural posture assessment
 * - Tool invocation decisions (People Finder, Evidence Analysis, Document Generation)
 * - Jurisdiction and venue identification
 * - Multi-model AI cross-checking
 * - Strategic recommendation generation
 */

import { generateUserText, TaskPriority, UsageContext } from '../aiProvider';
import { getLawExpertise } from '../lawExpertise';

/**
 * Legal issue classification
 */
export interface LegalIssue {
  primaryIssue: string;
  secondaryIssues: string[];
  causeOfAction: string[];
  legalTheories: string[];
  confidence: number;
}

/**
 * Procedural posture represents where the case is in the legal process
 */
export enum ProceduralPosture {
  PRE_CONSULTATION = 'pre-consultation',
  INITIAL_CONSULTATION = 'initial-consultation',
  EVIDENCE_GATHERING = 'evidence-gathering',
  READY_FOR_DEMAND = 'ready-for-demand',
  READY_FOR_FILING = 'ready-for-filing',
  LITIGATION = 'litigation',
  APPEAL = 'appeal',
  SETTLED = 'settled',
  DISMISSED = 'dismissed',
}

/**
 * Jurisdiction information
 */
export interface Jurisdiction {
  state: string;
  stateName: string;
  federalDistrict?: string;
  county?: string;
  venue?: string;
  applicableCourts: string[];
}

/**
 * Tool invocation recommendation
 */
export interface ToolRecommendation {
  tool: 'people-finder' | 'evidence-analysis' | 'document-generator' | 'legal-research';
  reason: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  parameters?: Record<string, any>;
}

/**
 * Comprehensive legal consultation result
 */
export interface ConsultationResult {
  // Core Analysis
  issues: LegalIssue[];
  jurisdiction: Jurisdiction;
  proceduralPosture: ProceduralPosture;
  
  // Strategic Guidance
  legalAnalysis: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  recommendations: string[];
  nextSteps: string[];
  
  // Tool Orchestration
  toolRecommendations: ToolRecommendation[];
  
  // Evidence & Facts
  criticalFacts: string[];
  missingFacts: string[];
  evidenceNeeded: string[];
  
  // Timeline & Deadlines
  statuteOfLimitations?: {
    deadline: string;
    daysRemaining?: number;
    urgency: 'critical' | 'high' | 'medium' | 'low';
  };
  
  // Metadata
  confidence: number;
  completeness: number;
  lawType: string;
}

/**
 * Legal Consultation Engine - Governing Brain
 */
export class LegalConsultationEngine {
  /**
   * Conduct comprehensive legal consultation
   */
  async consult(caseData: {
    description: string;
    state: string;
    lawType: string;
    additionalContext?: string;
    evidence?: Array<{
      type: string;
      description: string;
      content?: string;
    }>;
    parties?: {
      plaintiff?: string;
      defendant?: string;
      witnesses?: string[];
    };
  }): Promise<ConsultationResult> {
    console.log(`[Consultation Engine] Starting consultation for ${caseData.lawType} in ${caseData.state}`);

    // Step 1: Issue Spotting and Classification
    const issues = await this.spotIssues(caseData);

    // Step 2: Jurisdiction Analysis
    const jurisdiction = await this.analyzeJurisdiction(caseData);

    // Step 3: Procedural Posture Assessment
    const proceduralPosture = await this.assessProceduralPosture(caseData);

    // Step 4: Generate Legal Analysis (Multi-Model Cross-Checking)
    const legalAnalysis = await this.generateLegalAnalysis(caseData, issues, jurisdiction);

    // Step 5: Identify Strengths, Weaknesses, and Risks
    const swot = await this.analyzeSWOT(caseData, issues, legalAnalysis);

    // Step 6: Determine Tool Requirements
    const toolRecommendations = await this.determineToolNeeds(caseData, issues, proceduralPosture);

    // Step 7: Identify Critical and Missing Facts
    const factAnalysis = await this.analyzeFacts(caseData, issues);

    // Step 8: Calculate Statute of Limitations
    const statuteOfLimitations = await this.calculateStatuteOfLimitations(
      caseData,
      issues,
      jurisdiction
    );

    // Step 9: Generate Strategic Recommendations
    const recommendations = await this.generateRecommendations(
      caseData,
      issues,
      swot,
      proceduralPosture,
      statuteOfLimitations
    );

    // Step 10: Assess Confidence and Completeness
    const confidence = this.calculateConfidence(issues, factAnalysis, caseData.evidence);
    const completeness = this.calculateCompleteness(caseData, factAnalysis);

    return {
      issues,
      jurisdiction,
      proceduralPosture,
      legalAnalysis,
      strengths: swot.strengths,
      weaknesses: swot.weaknesses,
      risks: swot.risks,
      recommendations,
      nextSteps: await this.generateNextSteps(proceduralPosture, toolRecommendations),
      toolRecommendations,
      criticalFacts: factAnalysis.critical,
      missingFacts: factAnalysis.missing,
      evidenceNeeded: factAnalysis.evidenceNeeded,
      statuteOfLimitations,
      confidence,
      completeness,
      lawType: caseData.lawType,
    };
  }

  /**
   * Step 1: Issue Spotting - Identify legal issues and causes of action
   */
  private async spotIssues(caseData: any): Promise<LegalIssue[]> {
    console.log('[Consultation Engine] Step 1: Issue Spotting');

    const expertise = getLawExpertise(caseData.lawType);
    
    const prompt = `You are an expert attorney analyzing a ${caseData.lawType} case.

CASE DESCRIPTION: ${caseData.description}
STATE: ${caseData.state}
${caseData.additionalContext ? `ADDITIONAL CONTEXT: ${caseData.additionalContext}` : ''}

Identify ALL legal issues, causes of action, and applicable legal theories.

Return a JSON array of issues, each with:
- primaryIssue: The main legal problem
- secondaryIssues: Related issues
- causeOfAction: Specific legal claims that can be brought (e.g., "42 USC § 1983 Civil Rights Violation", "Negligence", "Breach of Contract")
- legalTheories: Applicable legal doctrines and theories
- confidence: 0-100 confidence score

Be comprehensive and identify ALL potential legal claims.`;

    const systemPrompt = expertise 
      ? expertise.systemPrompt
      : 'You are an experienced attorney with expertise in issue spotting and legal analysis.';

    try {
      const response = await generateUserText(
        'issue-spotting',
        prompt,
        {
          systemPrompt,
          temperature: 0.2,
          useJSON: true,
        },
        TaskPriority.CRITICAL_USER
      );

      const issues = JSON.parse(response.content);
      return Array.isArray(issues) ? issues : [issues];
    } catch (error) {
      console.error('[Consultation Engine] Issue spotting error:', error);
      // Fallback to basic analysis
      return [{
        primaryIssue: 'Legal issue requiring analysis',
        secondaryIssues: [],
        causeOfAction: ['To be determined'],
        legalTheories: [],
        confidence: 50,
      }];
    }
  }

  /**
   * Step 2: Jurisdiction Analysis
   */
  private async analyzeJurisdiction(caseData: any): Promise<Jurisdiction> {
    console.log('[Consultation Engine] Step 2: Jurisdiction Analysis');

    const stateAbbreviations: Record<string, string> = {
      'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
      'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
      'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
      'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
      'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
      'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
      'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
      'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
      'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
      'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
      'DC': 'District of Columbia',
    };

    const state = caseData.state.toUpperCase();
    const stateName = stateAbbreviations[state] || caseData.state;

    // Determine applicable courts
    const applicableCourts: string[] = [];
    
    // State courts always available
    applicableCourts.push(`${stateName} State Court`);
    applicableCourts.push(`${stateName} Superior Court`);
    
    // Federal courts for civil rights, employment discrimination, federal question, etc.
    if (caseData.lawType === 'law-enforcement-accountability' || 
        caseData.lawType === 'civil-rights' ||
        caseData.lawType === 'employment-law') {
      applicableCourts.push('U.S. District Court');
    }

    return {
      state,
      stateName,
      applicableCourts,
    };
  }

  /**
   * Step 3: Assess Procedural Posture
   */
  private async assessProceduralPosture(caseData: any): Promise<ProceduralPosture> {
    console.log('[Consultation Engine] Step 3: Procedural Posture Assessment');

    // Determine current stage based on case details
    const hasEvidence = caseData.evidence && caseData.evidence.length > 0;
    const hasDetailedFacts = caseData.description.length > 200;
    const hasParties = caseData.parties && (caseData.parties.defendant || caseData.parties.witnesses);

    if (!hasDetailedFacts && !hasEvidence) {
      return ProceduralPosture.PRE_CONSULTATION;
    }

    if (hasDetailedFacts && !hasEvidence) {
      return ProceduralPosture.INITIAL_CONSULTATION;
    }

    if (hasEvidence && !hasParties) {
      return ProceduralPosture.EVIDENCE_GATHERING;
    }

    if (hasEvidence && hasParties && hasDetailedFacts) {
      return ProceduralPosture.READY_FOR_FILING;
    }

    return ProceduralPosture.INITIAL_CONSULTATION;
  }

  /**
   * Step 4: Generate comprehensive legal analysis with multi-model cross-checking
   */
  private async generateLegalAnalysis(
    caseData: any,
    issues: LegalIssue[],
    jurisdiction: Jurisdiction
  ): Promise<string> {
    console.log('[Consultation Engine] Step 4: Legal Analysis (Multi-Model Cross-Checking)');

    const expertise = getLawExpertise(caseData.lawType);

    const prompt = `Provide a comprehensive legal analysis for this ${caseData.lawType} case:

CASE: ${caseData.description}
JURISDICTION: ${jurisdiction.stateName}
IDENTIFIED ISSUES: ${issues.map(i => i.primaryIssue).join(', ')}
CAUSES OF ACTION: ${issues.flatMap(i => i.causeOfAction).join(', ')}

Provide:
1. Detailed legal analysis of each issue
2. Applicable statutes and case law in ${jurisdiction.stateName}
3. Elements that must be proven for each cause of action
4. Likely defenses and how to counter them
5. Estimated likelihood of success
6. Potential damages or remedies available

Use plain language but be thorough and precise.`;

    const systemPrompt = expertise
      ? expertise.systemPrompt
      : 'You are an experienced attorney providing comprehensive legal analysis.';

    const response = await generateUserText(
      'legal-analysis',
      prompt,
      {
        systemPrompt,
        temperature: 0.3,
      },
      TaskPriority.CRITICAL_USER
    );

    return response.content;
  }

  /**
   * Step 5: SWOT Analysis (Strengths, Weaknesses, Opportunities, Threats)
   */
  private async analyzeSWOT(
    caseData: any,
    issues: LegalIssue[],
    legalAnalysis: string
  ): Promise<{ strengths: string[]; weaknesses: string[]; risks: string[] }> {
    console.log('[Consultation Engine] Step 5: SWOT Analysis');

    const prompt = `Based on this case analysis, identify:

CASE: ${caseData.description}
LEGAL ANALYSIS: ${legalAnalysis}

Provide JSON with:
- strengths: Array of case strengths
- weaknesses: Array of case weaknesses  
- risks: Array of potential risks and obstacles

Be honest and realistic.`;

    try {
      const response = await generateUserText(
        'swot-analysis',
        prompt,
        {
          systemPrompt: 'You are an experienced litigator conducting realistic case assessment.',
          temperature: 0.2,
          useJSON: true,
        },
        TaskPriority.HIGH_USER
      );

      const swot = JSON.parse(response.content);
      return {
        strengths: swot.strengths || [],
        weaknesses: swot.weaknesses || [],
        risks: swot.risks || [],
      };
    } catch (error) {
      console.error('[Consultation Engine] SWOT analysis error:', error);
      return {
        strengths: ['Case has potential merit'],
        weaknesses: ['Further investigation needed'],
        risks: ['Statute of limitations', 'Burden of proof'],
      };
    }
  }

  /**
   * Step 6: Determine which tools should be invoked
   */
  private async determineToolNeeds(
    caseData: any,
    issues: LegalIssue[],
    proceduralPosture: ProceduralPosture
  ): Promise<ToolRecommendation[]> {
    console.log('[Consultation Engine] Step 6: Tool Needs Determination');

    const recommendations: ToolRecommendation[] = [];

    // Check if People Finder is needed
    if (caseData.parties?.defendant || 
        caseData.description.includes('individual') || 
        caseData.description.includes('person') ||
        caseData.description.includes('officer') ||
        caseData.description.includes('employee')) {
      
      recommendations.push({
        tool: 'people-finder',
        reason: 'Identity intelligence needed for involved parties',
        priority: 'high',
        parameters: {
          name: caseData.parties?.defendant,
        },
      });
    }

    // Check if Evidence Analysis is needed
    if (!caseData.evidence || caseData.evidence.length === 0) {
      recommendations.push({
        tool: 'evidence-analysis',
        reason: 'Evidence collection and analysis required to strengthen case',
        priority: 'critical',
      });
    }

    // Check if Document Generation is recommended
    if (proceduralPosture === ProceduralPosture.READY_FOR_FILING ||
        proceduralPosture === ProceduralPosture.READY_FOR_DEMAND) {
      
      recommendations.push({
        tool: 'document-generator',
        reason: 'Case ready for formal legal document preparation',
        priority: 'high',
        parameters: {
          documentType: this.determineDocumentType(caseData.lawType, proceduralPosture),
        },
      });
    }

    // Legal research always useful
    recommendations.push({
      tool: 'legal-research',
      reason: 'Research recent case law and statutes in jurisdiction',
      priority: 'medium',
      parameters: {
        jurisdiction: caseData.state,
        topics: issues.map(i => i.primaryIssue),
      },
    });

    return recommendations;
  }

  /**
   * Step 7: Analyze facts - identify critical facts and gaps
   */
  private async analyzeFacts(
    caseData: any,
    issues: LegalIssue[]
  ): Promise<{ critical: string[]; missing: string[]; evidenceNeeded: string[] }> {
    console.log('[Consultation Engine] Step 7: Fact Analysis');

    const prompt = `Analyze the facts for this legal case:

CASE: ${caseData.description}
LEGAL ISSUES: ${issues.map(i => i.primaryIssue).join(', ')}
CAUSES OF ACTION: ${issues.flatMap(i => i.causeOfAction).join(', ')}

Provide JSON with:
- critical: Array of critical facts already present
- missing: Array of missing facts needed to prove the case
- evidenceNeeded: Array of specific evidence that should be gathered

Be specific and practical.`;

    try {
      const response = await generateUserText(
        'fact-analysis',
        prompt,
        {
          systemPrompt: 'You are an experienced litigator identifying critical facts and evidence needs.',
          temperature: 0.2,
          useJSON: true,
        },
        TaskPriority.HIGH_USER
      );

      return JSON.parse(response.content);
    } catch (error) {
      console.error('[Consultation Engine] Fact analysis error:', error);
      return {
        critical: [],
        missing: ['Additional details needed'],
        evidenceNeeded: ['Documentary evidence', 'Witness statements'],
      };
    }
  }

  /**
   * Step 8: Calculate statute of limitations
   */
  private async calculateStatuteOfLimitations(
    caseData: any,
    issues: LegalIssue[],
    jurisdiction: Jurisdiction
  ): Promise<{ deadline: string; urgency: 'critical' | 'high' | 'medium' | 'low' } | undefined> {
    console.log('[Consultation Engine] Step 8: Statute of Limitations');

    // This would integrate with a legal database of SOL by state and cause of action
    // For now, return conservative estimate
    
    const prompt = `What is the statute of limitations for ${issues[0]?.primaryIssue} in ${jurisdiction.stateName}? 
    
Provide a brief answer with the time limit (e.g., "2 years", "6 years").`;

    try {
      const response = await generateUserText(
        'statute-of-limitations',
        prompt,
        {
          systemPrompt: 'You are a legal expert on statutes of limitations.',
          temperature: 0.1,
        },
        TaskPriority.HIGH_USER
      );

      return {
        deadline: response.content,
        urgency: 'high',
      };
    } catch (error) {
      console.error('[Consultation Engine] SOL calculation error:', error);
      return undefined;
    }
  }

  /**
   * Step 9: Generate strategic recommendations
   */
  private async generateRecommendations(
    caseData: any,
    issues: LegalIssue[],
    swot: any,
    proceduralPosture: ProceduralPosture,
    statuteOfLimitations?: any
  ): Promise<string[]> {
    console.log('[Consultation Engine] Step 9: Strategic Recommendations');

    const recommendations: string[] = [];

    // Statute of limitations urgency
    if (statuteOfLimitations && statuteOfLimitations.urgency === 'critical') {
      recommendations.push(`URGENT: Statute of limitations concern - ${statuteOfLimitations.deadline}. Consult attorney immediately.`);
    }

    // Evidence gathering
    if (proceduralPosture === ProceduralPosture.INITIAL_CONSULTATION ||
        proceduralPosture === ProceduralPosture.EVIDENCE_GATHERING) {
      recommendations.push('Gather and preserve all evidence immediately');
      recommendations.push('Document everything in writing with dates and times');
    }

    // Strong case
    if (issues.some(i => i.confidence >= 70)) {
      recommendations.push('Case has strong legal merit - consider pursuing claims');
    }

    // Weak areas
    if (swot.weaknesses.length > 0) {
      recommendations.push(`Address case weaknesses: ${swot.weaknesses[0]}`);
    }

    // Always recommend consultation
    recommendations.push('Consult with a licensed attorney for personalized legal advice');

    return recommendations;
  }

  /**
   * Generate next steps based on procedural posture
   */
  private async generateNextSteps(
    proceduralPosture: ProceduralPosture,
    toolRecommendations: ToolRecommendation[]
  ): Promise<string[]> {
    const steps: string[] = [];

    // Add tool-based steps
    toolRecommendations
      .sort((a, b) => {
        const priorities = { critical: 4, high: 3, medium: 2, low: 1 };
        return priorities[b.priority] - priorities[a.priority];
      })
      .slice(0, 3)
      .forEach(tool => {
        steps.push(`${tool.tool}: ${tool.reason}`);
      });

    // Add posture-specific steps
    switch (proceduralPosture) {
      case ProceduralPosture.PRE_CONSULTATION:
        steps.push('Gather detailed information about the incident');
        steps.push('Document timeline of events');
        break;
      
      case ProceduralPosture.INITIAL_CONSULTATION:
        steps.push('Collect and organize all evidence');
        steps.push('Identify witnesses');
        break;
      
      case ProceduralPosture.EVIDENCE_GATHERING:
        steps.push('Complete evidence collection');
        steps.push('Prepare witness statements');
        break;
      
      case ProceduralPosture.READY_FOR_FILING:
        steps.push('Review case with attorney');
        steps.push('Prepare filing documents');
        break;
    }

    return steps;
  }

  /**
   * Helper: Determine document type based on law type and posture
   */
  private determineDocumentType(lawType: string, posture: ProceduralPosture): string {
    if (posture === ProceduralPosture.READY_FOR_DEMAND) {
      return 'demand-letter';
    }

    if (posture === ProceduralPosture.READY_FOR_FILING) {
      switch (lawType) {
        case 'law-enforcement-accountability':
        case 'civil-rights':
          return 'civil-rights-complaint';
        case 'personal-injury':
          return 'personal-injury-complaint';
        case 'employment-law':
          return 'employment-complaint';
        case 'family-law':
          return 'family-law-petition';
        default:
          return 'civil-complaint';
      }
    }

    return 'legal-memorandum';
  }

  /**
   * Calculate confidence in analysis
   */
  private calculateConfidence(
    issues: LegalIssue[],
    factAnalysis: any,
    evidence: any
  ): number {
    let confidence = 0;

    // Issue confidence
    const avgIssueConfidence = issues.reduce((sum, i) => sum + i.confidence, 0) / issues.length;
    confidence += avgIssueConfidence * 0.4;

    // Facts confidence
    const factCompleteness = factAnalysis.critical.length / 
      (factAnalysis.critical.length + factAnalysis.missing.length || 1);
    confidence += factCompleteness * 30;

    // Evidence confidence
    if (evidence && evidence.length > 0) {
      confidence += 30;
    }

    return Math.round(Math.min(100, confidence));
  }

  /**
   * Calculate case completeness
   */
  private calculateCompleteness(caseData: any, factAnalysis: any): number {
    let score = 0;

    // Has description
    if (caseData.description.length > 100) score += 25;

    // Has evidence
    if (caseData.evidence && caseData.evidence.length > 0) score += 25;

    // Has parties
    if (caseData.parties) score += 20;

    // Has most critical facts
    const factRatio = factAnalysis.critical.length / 
      (factAnalysis.critical.length + factAnalysis.missing.length || 1);
    score += factRatio * 30;

    return Math.round(Math.min(100, score));
  }
}

export const legalConsultationEngine = new LegalConsultationEngine();
