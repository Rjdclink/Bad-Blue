/**
 * Legal Document Creator AI System
 * 
 * Implements conversational AI for custom legal document generation.
 * Uses existing 5 AI provider, 8 model parallel system for:
 * - Conversational information gathering
 * - Document type detection
 * - Jurisdiction extraction
 * - Legal research and form retrieval
 * - Document generation and revision
 */

import { 
  generateUserText,
  TaskPriority
} from './aiProvider';
import { 
  searchLawsuitFormsAndRules,
  researchRelevantStatutes,
  analyzeCaseLaw
} from './legalAI';
import { safeJsonParse } from './jsonParser';

/**
 * Conversation phases for document creation
 */
export enum ConversationPhase {
  INITIAL = 'initial',
  GATHERING_INFO = 'gathering_info',
  CONFIRMING_DETAILS = 'confirming_details',
  RESEARCHING = 'researching',
  GENERATING_DOCUMENT = 'generating_document',
  DOCUMENT_READY = 'document_ready',
  REVISING = 'revising'
}

/**
 * Conversation message structure
 */
export interface ConversationMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: Date;
}

/**
 * Document creator session state
 */
export interface DocumentCreatorState {
  phase: ConversationPhase;
  messages: ConversationMessage[];
  extractedInfo: {
    documentType?: string;
    jurisdiction?: {
      state?: string;
      county?: string;
      city?: string;
    };
    parties?: {
      plaintiff?: string;
      defendant?: string;
      [key: string]: string | undefined;
    };
    facts?: string;
    claims?: string[];
    reliefSought?: string;
    [key: string]: any;
  };
}

/**
 * Generate conversational AI response for document creation
 * Handles the conversational flow and extracts needed information
 */
export async function generateDocumentCreatorResponse(
  state: DocumentCreatorState,
  userMessage: string
): Promise<{
  response: string;
  updatedState: DocumentCreatorState;
}> {
  // Add user message to conversation history
  const messages: ConversationMessage[] = [
    ...state.messages,
    {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }
  ];

  // Build conversation context
  const conversationHistory = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const systemPrompt = `You are a friendly, professional legal document assistant. Your role is to help users create custom legal documents through natural conversation.

GUIDELINES:
- Ask clear, simple questions in plain language
- One question at a time when gathering information
- Be encouraging and supportive
- Explain legal terms when you use them
- Extract key information (document type, jurisdiction, parties, facts) from responses
- When you have enough information, confirm details before generating the document
- This is not legal advice - recommend consulting an attorney for complex matters

CONVERSATION PHASES:
1. INITIAL: Greet and ask what type of document they need
2. GATHERING_INFO: Ask specific questions to get all required information
3. CONFIRMING_DETAILS: Summarize and confirm all details
4. RESEARCHING: Inform user you're researching jurisdiction requirements
5. GENERATING_DOCUMENT: Generate the document
6. DOCUMENT_READY: Present the document and offer revision options

Current phase: ${state.phase}
Extracted info so far: ${JSON.stringify(state.extractedInfo, null, 2)}`;

  const userPrompt = `Based on this conversation history and the user's latest message, provide your next response.

CONVERSATION HISTORY:
${conversationHistory}

USER'S LATEST MESSAGE: ${userMessage}

Your response should:
1. Address the user's message directly
2. Extract any new information (document type, jurisdiction, names, facts, etc.)
3. Ask the next logical question OR confirm details if you have enough information
4. Be conversational and friendly

Respond in JSON format:
{
  "response": "Your conversational response to the user",
  "extractedInfo": {
    "documentType": "type if identified",
    "jurisdiction": {"state": "XX", "county": "Name", "city": "Name"},
    "parties": {"plaintiff": "Name", "defendant": "Name"},
    "facts": "Summary of facts provided",
    "claims": ["claim1", "claim2"],
    "reliefSought": "What user wants",
    "additionalFields": "any other relevant info"
  },
  "phase": "next_phase",
  "readyToGenerate": false
}`;

  try {
    const aiResponse = await generateUserText(
      'document-creator-conversation',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.7,
        useJSON: true
      },
      TaskPriority.CRITICAL_USER
    );

    let parsed: any;
    try {
      parsed = safeJsonParse(aiResponse.content, 'document-creator-conversation');
    } catch (error) {
      console.error('[Document Creator] Failed to parse AI response:', error);
      // Fallback to default response
      parsed = {
        response: "I understand you'd like help with a legal document. Could you tell me what type of document you need? For example, a complaint, motion, contract, demand letter, or something else?",
        extractedInfo: {},
        phase: state.phase,
        readyToGenerate: false
      };
    }

    // Merge extracted information
    const updatedExtractedInfo = {
      ...state.extractedInfo,
      ...parsed.extractedInfo
    };

    // Determine next phase
    let nextPhase = state.phase;
    if (parsed.readyToGenerate) {
      nextPhase = ConversationPhase.CONFIRMING_DETAILS;
    } else if (parsed.phase) {
      nextPhase = parsed.phase as ConversationPhase;
    }

    // Add assistant response to messages
    const updatedMessages: ConversationMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: parsed.response,
        timestamp: new Date()
      }
    ];

    return {
      response: parsed.response,
      updatedState: {
        phase: nextPhase,
        messages: updatedMessages,
        extractedInfo: updatedExtractedInfo
      }
    };
  } catch (error) {
    console.error('[Document Creator] Error generating response:', error);
    
    // Fallback response
    const fallbackResponse = state.phase === ConversationPhase.INITIAL
      ? "I'm here to help you create a legal document. What type of document do you need?"
      : "Could you provide more details about your situation?";
    
    return {
      response: fallbackResponse,
      updatedState: {
        ...state,
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: fallbackResponse,
            timestamp: new Date()
          }
        ]
      }
    };
  }
}

/**
 * Generate the actual legal document based on collected information
 * Uses existing legal research functions and AI orchestration
 */
export async function generateDocument(
  state: DocumentCreatorState
): Promise<string> {
  const { extractedInfo } = state;
  
  if (!extractedInfo.documentType) {
    throw new Error('Document type not specified');
  }

  if (!extractedInfo.jurisdiction?.state) {
    throw new Error('Jurisdiction not specified');
  }

  // Research jurisdiction-specific requirements
  let formResearch = null;
  let statuteResearch = null;
  let caseLawResearch = null;

  try {
    // Search for jurisdiction-specific forms and rules
    if (extractedInfo.documentType.toLowerCase().includes('complaint') || 
        extractedInfo.documentType.toLowerCase().includes('lawsuit')) {
      formResearch = await searchLawsuitFormsAndRules(
        extractedInfo.jurisdiction.state,
        extractedInfo.jurisdiction.county || null,
        extractedInfo.jurisdiction.city || null,
        extractedInfo.documentType
      );
    }

    // Research relevant statutes
    if (extractedInfo.claims && extractedInfo.claims.length > 0) {
      statuteResearch = await researchRelevantStatutes(
        extractedInfo.jurisdiction.state,
        extractedInfo.claims.join(', '),
        extractedInfo.facts || 'Legal matter requiring statute research'
      );
    }

    // Analyze case law if available
    if (extractedInfo.claims && extractedInfo.claims.length > 0) {
      caseLawResearch = await analyzeCaseLaw(
        extractedInfo.jurisdiction.state,
        extractedInfo.claims.join(', '),
        extractedInfo.facts || 'Legal matter requiring case law analysis'
      );
    }
  } catch (error) {
    console.error('[Document Creator] Error during legal research:', error);
    // Continue with document generation even if research fails
  }

  // Generate the document using AI with all research context
  const systemPrompt = `You are an expert legal document drafter. Generate professional, court-ready legal documents based on:
1. User's specific requirements
2. Jurisdiction-specific forms and templates (PRESERVE FORMAT 100%)
3. Relevant statutes and case law
4. Local court rules and formatting requirements

CRITICAL: If official forms were found, preserve their exact format and structure.
Include proper legal citations and follow all jurisdiction-specific requirements.`;

  const userPrompt = `Generate a complete, professional ${extractedInfo.documentType} document.

USER INFORMATION:
${JSON.stringify(extractedInfo, null, 2)}

${formResearch ? `JURISDICTION-SPECIFIC FORMS AND RULES:
${JSON.stringify(formResearch, null, 2)}

IMPORTANT: Preserve the exact format and structure of any official forms found.` : ''}

${statuteResearch ? `RELEVANT STATUTES:
${JSON.stringify(statuteResearch, null, 2)}` : ''}

${caseLawResearch ? `RELEVANT CASE LAW:
${JSON.stringify(caseLawResearch, null, 2)}` : ''}

Generate a complete, court-ready document with:
1. Proper caption and heading
2. All required sections based on jurisdiction
3. Accurate legal citations
4. Professional formatting
5. Signature blocks
6. Certificate of service (if applicable)

Return the complete document text, properly formatted for printing and filing.`;

  try {
    const response = await generateUserText(
      'document-creator-generate',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.5
      },
      TaskPriority.CRITICAL_USER
    );

    return response.content;
  } catch (error) {
    console.error('[Document Creator] Error generating document:', error);
    throw new Error('Failed to generate document. Please try again.');
  }
}

/**
 * Revise a generated document based on user feedback
 */
export async function reviseDocument(
  originalDocument: string,
  revisionRequest: string,
  state: DocumentCreatorState
): Promise<string> {
  const systemPrompt = `You are an expert legal document editor. Revise legal documents based on user feedback while:
1. Maintaining professional legal language
2. Preserving jurisdiction-specific formatting
3. Following all applicable rules and requirements
4. Making only the requested changes`;

  const userPrompt = `Revise this legal document based on the user's feedback.

ORIGINAL DOCUMENT:
${originalDocument}

USER'S REVISION REQUEST:
${revisionRequest}

CONTEXT:
Document Type: ${state.extractedInfo.documentType}
Jurisdiction: ${state.extractedInfo.jurisdiction?.state}

Provide the complete revised document with the requested changes incorporated.`;

  try {
    const response = await generateUserText(
      'document-creator-revise',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.5
      },
      TaskPriority.CRITICAL_USER
    );

    return response.content;
  } catch (error) {
    console.error('[Document Creator] Error revising document:', error);
    throw new Error('Failed to revise document. Please try again.');
  }
}
