/**
 * Legal Consultation Coordinator
 * 
 * Orchestrates the Legal Consultation Engine to coordinate between:
 * - Legal consultation AI
 * - People Finder
 * - Document Generator  
 * - Evidence Upload/Analysis
 * 
 * This acts as the "mastermind brain" that determines which tools to invoke
 * based on the consultation context.
 */

import { generateUserText, TaskPriority } from './aiProvider';

export interface ConsultationContext {
  lawType: string;
  state: string;
  situation: string;
  parties?: string[]; // Names of people involved
  evidenceUploaded?: boolean;
  documentsNeeded?: string[];
}

export interface ConsultationRecommendation {
  analysis: string;
  suggestedActions: {
    type: 'people-finder' | 'document-generator' | 'evidence-upload' | 'next-step';
    description: string;
    priority: 'high' | 'medium' | 'low';
    params?: any;
  }[];
  identifiedParties: string[];
  documentsToGenerate: string[];
  nextSteps: string[];
}

/**
 * Master consultation function that analyzes the situation
 * and recommends appropriate tools and actions
 */
export async function conductMasterConsultation(
  context: ConsultationContext
): Promise<ConsultationRecommendation> {
  const systemPrompt = `You are a master legal consultation AI - the governing brain of a sophisticated legal assistance platform.

Your role is to:
1. Analyze the legal situation thoroughly
2. Identify all parties involved (people, entities, organizations)
3. Determine what documents need to be generated
4. Recommend specific actions using available tools
5. Provide clear next steps

Available tools you can recommend:
- People Finder: To locate and research individuals (witnesses, parties, experts)
- Document Generator: To create legal documents (complaints, motions, contracts, etc.)
- Evidence Upload: To analyze and process evidence (photos, videos, documents)
- Next Steps: Procedural guidance

Be strategic and comprehensive. Think like a senior attorney coordinating a legal team.`;

  const prompt = `Analyze this legal situation and provide strategic recommendations:

LAW TYPE: ${context.lawType}
STATE: ${context.state}
SITUATION: ${context.situation}
${context.parties ? `KNOWN PARTIES: ${context.parties.join(', ')}` : ''}
${context.evidenceUploaded ? 'EVIDENCE: Already uploaded' : 'EVIDENCE: Not yet uploaded'}

Please provide:
1. LEGAL ANALYSIS - Comprehensive analysis of the situation
2. IDENTIFIED PARTIES - List all people/entities who should be researched (for People Finder)
3. RECOMMENDED DOCUMENTS - Specific documents to generate
4. SUGGESTED ACTIONS - Prioritized list of actions with tool recommendations
5. NEXT STEPS - Clear procedural guidance

Format your response as JSON:
{
  "analysis": "comprehensive legal analysis",
  "identifiedParties": ["person 1", "person 2"],
  "documentsToGenerate": ["document type 1", "document type 2"],
  "suggestedActions": [
    {
      "type": "people-finder|document-generator|evidence-upload|next-step",
      "description": "what to do",
      "priority": "high|medium|low",
      "params": {}
    }
  ],
  "nextSteps": ["step 1", "step 2"]
}`;

  try {
    const response = await generateUserText(
      'legal-consultation-coordinator',
      prompt,
      {
        systemPrompt,
        temperature: 0.3,
        useJSON: true,
      },
      TaskPriority.CRITICAL_USER
    );

    // Parse the JSON response
    const parsed = JSON.parse(response.content);
    
    return {
      analysis: parsed.analysis || 'Analysis pending',
      identifiedParties: parsed.identifiedParties || [],
      documentsToGenerate: parsed.documentsToGenerate || [],
      suggestedActions: parsed.suggestedActions || [],
      nextSteps: parsed.nextSteps || [],
    };
  } catch (error) {
    console.error('[Consultation Coordinator] Error:', error);
    
    // Fallback to basic analysis
    return {
      analysis: 'Unable to complete full strategic analysis. Please provide more details.',
      identifiedParties: [],
      documentsToGenerate: [],
      suggestedActions: [
        {
          type: 'next-step',
          description: 'Provide more details about your situation',
          priority: 'high',
        }
      ],
      nextSteps: ['Gather all relevant documents', 'List all parties involved', 'Document timeline of events'],
    };
  }
}

/**
 * Simplified consultation that determines if People Finder should be invoked
 */
export async function shouldInvokePeopleFinder(
  situation: string
): Promise<{ shouldInvoke: boolean; searchQueries: string[] }> {
  const systemPrompt = `You are an AI assistant that identifies when people research is needed.
Analyze the text and extract names of individuals who should be researched.`;

  const prompt = `Analyze this situation and identify if we need to research any individuals:

SITUATION: ${situation}

Return JSON:
{
  "shouldInvoke": true/false,
  "searchQueries": ["name1", "name2"]
}`;

  try {
    const response = await generateUserText(
      'people-finder-detection',
      prompt,
      {
        systemPrompt,
        temperature: 0.2,
        useJSON: true,
      },
      TaskPriority.NORMAL_USER
    );

    const parsed = JSON.parse(response.content);
    return {
      shouldInvoke: parsed.shouldInvoke || false,
      searchQueries: parsed.searchQueries || [],
    };
  } catch (error) {
    console.error('[People Finder Detection] Error:', error);
    return { shouldInvoke: false, searchQueries: [] };
  }
}

/**
 * Determine what documents should be generated
 */
export async function determineDocuments(
  lawType: string,
  situation: string
): Promise<string[]> {
  const systemPrompt = `You are a legal document specialist. Identify what documents are needed for a case.`;

  const prompt = `For this ${lawType} case, what documents should be generated?

SITUATION: ${situation}

Return JSON array of document types:
["document type 1", "document type 2"]`;

  try {
    const response = await generateUserText(
      'document-determination',
      prompt,
      {
        systemPrompt,
        temperature: 0.3,
        useJSON: true,
      },
      TaskPriority.NORMAL_USER
    );

    return JSON.parse(response.content);
  } catch (error) {
    console.error('[Document Determination] Error:', error);
    return [];
  }
}
