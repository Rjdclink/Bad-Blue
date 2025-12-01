/**
 * Legal Document Creator Module
 * 
 * Provides AI-powered legal document generation with:
 * - Questionnaire-based document type and jurisdiction inference
 * - Multi-provider AI orchestration (Gemini/Mistral/Claude/Groq)
 * - Stripe payment integration ($5.99 per document)
 * - Email delivery of final documents
 */

import crypto from 'crypto';
import Stripe from 'stripe';
import { 
  generateUserText, 
  TaskPriority,
  TaskComplexity, 
  AIProvider,
  recordUsage 
} from './aiProvider';
import { safeJsonParse } from './jsonParser';
import { sendUserEmail } from './emailService';
import { getBaseURL } from './platformConfig';
import { LEGAL_DOCUMENT_CREATOR_PRICING_CENTS } from '@shared/schema';

// ============================================
// Stripe Configuration
// ============================================

const STRIPE_API_VERSION = '2024-06-20';

// Lazy-initialized Stripe client
let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION as any,
    });
  }
  return stripeClient;
}

// ============================================
// Types and Interfaces
// ============================================

export interface LegalSession {
  id: string;
  userId?: string;
  status: 'questionnaire' | 'drafting' | 'preview' | 'paid' | 'delivered';
  documentType: string | null;
  jurisdiction: string | null;
  answers: Record<string, string>;
  questions: QuestionnaireQuestion[];
  currentQuestionIndex: number;
  draftDocument: string | null;
  finalDocument: string | null;
  stripeSessionId: string | null;
  userEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionnaireQuestion {
  id: string;
  question: string;
  type: 'text' | 'select' | 'multiline';
  options?: string[];
  required: boolean;
  helpText?: string;
}

export interface ContinueSessionResult {
  nextQuestions: QuestionnaireQuestion[];
  readyToDraft: boolean;
  inferredDocumentType?: string;
  inferredJurisdiction?: string;
  message?: string;
}

export interface GenerateDraftResult {
  success: boolean;
  previewId: string;
  documentPreview: string;
  documentType: string;
  jurisdiction: string;
  message: string;
}

// ============================================
// In-Memory Session Store (replaceable with DB later)
// ============================================

const sessions = new Map<string, LegalSession>();

// Clean up old sessions every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt.getTime() > maxAge) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

// ============================================
// Document Types and Initial Questions
// ============================================

const DOCUMENT_TYPES = [
  'demand_letter',
  'cease_and_desist',
  'settlement_agreement',
  'power_of_attorney',
  'affidavit',
  'complaint_letter',
  'notice_of_intent',
  'declaration',
  'will_simple',
  'lease_agreement',
] as const;

const INITIAL_QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: 'document_purpose',
    question: 'What is the purpose of the legal document you need?',
    type: 'multiline',
    required: true,
    helpText: 'Describe what you want to accomplish with this document (e.g., demand payment, stop harassment, settle a dispute)',
  },
  {
    id: 'parties_involved',
    question: 'Who are the parties involved?',
    type: 'multiline',
    required: true,
    helpText: 'List the names and roles of all parties (e.g., "John Smith (creditor), Jane Doe (debtor)")',
  },
  {
    id: 'state',
    question: 'In which U.S. state will this document be used?',
    type: 'select',
    options: [
      'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
      'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
      'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
      'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
      'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
      'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
      'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
      'Wisconsin', 'Wyoming',
    ],
    required: true,
    helpText: 'Select the state where this document will be enforced or used',
  },
  {
    id: 'key_facts',
    question: 'What are the key facts or circumstances?',
    type: 'multiline',
    required: true,
    helpText: 'Provide relevant dates, amounts, events, or other important details',
  },
  {
    id: 'desired_outcome',
    question: 'What outcome do you want from this document?',
    type: 'multiline',
    required: true,
    helpText: 'Describe what action you want the other party to take or what you want to accomplish',
  },
];

// ============================================
// Core Functions
// ============================================

/**
 * Initialize a new legal document session
 */
export function initLegalSession(userId?: string): { 
  sessionId: string; 
  questions: QuestionnaireQuestion[];
  message: string;
} {
  const sessionId = crypto.randomBytes(16).toString('hex');
  
  const session: LegalSession = {
    id: sessionId,
    userId,
    status: 'questionnaire',
    documentType: null,
    jurisdiction: null,
    answers: {},
    questions: [...INITIAL_QUESTIONS],
    currentQuestionIndex: 0,
    draftDocument: null,
    finalDocument: null,
    stripeSessionId: null,
    userEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  sessions.set(sessionId, session);
  
  console.log(`[Legal Document Creator] New session created: ${sessionId}`);
  
  return {
    sessionId,
    questions: INITIAL_QUESTIONS,
    message: 'Please answer the following questions to help us create your legal document.',
  };
}

/**
 * Continue a legal session with user answers
 */
export async function continueLegalSession(
  sessionId: string,
  answers: Record<string, string>
): Promise<ContinueSessionResult> {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new Error('Session not found');
  }
  
  if (session.status !== 'questionnaire') {
    throw new Error('Session is not in questionnaire state');
  }
  
  // Store the answers
  session.answers = { ...session.answers, ...answers };
  session.updatedAt = new Date();
  
  // Check if we have all required initial answers
  const requiredQuestions = INITIAL_QUESTIONS.filter(q => q.required);
  const hasAllRequired = requiredQuestions.every(q => session.answers[q.id]?.trim());
  
  if (!hasAllRequired) {
    // Return remaining required questions
    const unanswered = requiredQuestions.filter(q => !session.answers[q.id]?.trim());
    return {
      nextQuestions: unanswered,
      readyToDraft: false,
      message: 'Please answer all required questions to proceed.',
    };
  }
  
  // Use AI to infer document type and check if we need follow-up questions
  try {
    const inferenceResult = await inferDocumentTypeAndQuestions(session);
    
    session.documentType = inferenceResult.documentType;
    session.jurisdiction = session.answers.state || null;
    
    if (inferenceResult.followUpQuestions.length > 0) {
      // Add follow-up questions
      session.questions = [...session.questions, ...inferenceResult.followUpQuestions];
      
      // Check if follow-up questions are answered
      const unansweredFollowUps = inferenceResult.followUpQuestions.filter(
        q => q.required && !session.answers[q.id]?.trim()
      );
      
      if (unansweredFollowUps.length > 0) {
        return {
          nextQuestions: unansweredFollowUps,
          readyToDraft: false,
          inferredDocumentType: inferenceResult.documentType,
          inferredJurisdiction: session.jurisdiction || undefined,
          message: `Based on your answers, we'll create a ${formatDocumentType(inferenceResult.documentType)}. Please answer these follow-up questions.`,
        };
      }
    }
    
    // Ready to draft
    return {
      nextQuestions: [],
      readyToDraft: true,
      inferredDocumentType: inferenceResult.documentType,
      inferredJurisdiction: session.jurisdiction || undefined,
      message: `Ready to generate your ${formatDocumentType(inferenceResult.documentType)} for ${session.jurisdiction || 'your jurisdiction'}.`,
    };
  } catch (error) {
    console.error('[Legal Document Creator] Error inferring document type:', error);
    
    // Default to demand letter if inference fails
    session.documentType = 'demand_letter';
    session.jurisdiction = session.answers.state || null;
    
    return {
      nextQuestions: [],
      readyToDraft: true,
      inferredDocumentType: 'demand_letter',
      inferredJurisdiction: session.jurisdiction || undefined,
      message: 'Ready to generate your legal document.',
    };
  }
}

/**
 * Generate the draft document using AI
 */
export async function generateDraft(sessionId: string): Promise<GenerateDraftResult> {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new Error('Session not found');
  }
  
  if (session.status !== 'questionnaire') {
    throw new Error('Session is not ready for drafting');
  }
  
  session.status = 'drafting';
  session.updatedAt = new Date();
  
  const startTime = Date.now();
  
  try {
    console.log(`[Legal Document Creator] Generating draft for session ${sessionId}`);
    console.log(`[Legal Document Creator] Document type: ${session.documentType}`);
    console.log(`[Legal Document Creator] Jurisdiction: ${session.jurisdiction}`);
    
    // First, fetch jurisdictional standards if needed
    const jurisdictionInfo = session.jurisdiction 
      ? await fetchJurisdictionalStandards(session.jurisdiction, session.documentType || 'general')
      : null;
    
    // Generate the document using comprehensive AI task
    const document = await generateLegalDocumentDraft(session, jurisdictionInfo);
    
    session.draftDocument = document;
    session.status = 'preview';
    session.updatedAt = new Date();
    
    // Record AI usage
    const latency = Date.now() - startTime;
    await recordUsage(
      'legal_document_creator_draft',
      AIProvider.GEMINI,
      estimateTokens(document),
      latency,
      true,
      'detailed',
      TaskPriority.HIGH_USER
    );
    
    console.log(`[Legal Document Creator] Draft generated successfully (${latency}ms)`);
    
    return {
      success: true,
      previewId: sessionId,
      documentPreview: document,
      documentType: session.documentType || 'legal_document',
      jurisdiction: session.jurisdiction || 'Unknown',
      message: 'Your document draft is ready for review. Payment is required to receive the final document.',
    };
  } catch (error: any) {
    console.error('[Legal Document Creator] Error generating draft:', error);
    
    session.status = 'questionnaire';
    session.updatedAt = new Date();
    
    // Record failure
    await recordUsage(
      'legal_document_creator_draft',
      AIProvider.GEMINI,
      0,
      Date.now() - startTime,
      false,
      'detailed',
      TaskPriority.HIGH_USER
    );
    
    throw new Error(`Failed to generate document: ${error.message}`);
  }
}

/**
 * Finalize draft and prepare for payment
 */
export function finalizeDraft(sessionId: string): { previewId: string; status: string } {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new Error('Session not found');
  }
  
  if (session.status !== 'preview') {
    throw new Error('Session is not in preview state');
  }
  
  // Copy draft to final
  session.finalDocument = session.draftDocument;
  session.updatedAt = new Date();
  
  return {
    previewId: sessionId,
    status: 'ready_for_payment',
  };
}

/**
 * Request an edit to the draft document
 */
export async function requestDraftEdit(
  sessionId: string, 
  editRequest: string
): Promise<GenerateDraftResult> {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new Error('Session not found');
  }
  
  if (session.status !== 'preview') {
    throw new Error('Session is not in preview state');
  }
  
  if (!session.draftDocument) {
    throw new Error('No draft document to edit');
  }
  
  const startTime = Date.now();
  
  try {
    console.log(`[Legal Document Creator] Processing edit request for session ${sessionId}`);
    
    const systemPrompt = `You are an expert legal document editor. You will receive a draft legal document and an edit request from the user. Your task is to modify the document according to the user's request while maintaining legal validity and proper formatting.

RULES:
1. Only make changes that are requested
2. Maintain the document's legal structure and formatting
3. Keep all jurisdiction-specific language and requirements intact
4. Ensure any changes are legally sound
5. Do not remove required elements like dates, signatures, or notarization sections`;

    const userPrompt = `CURRENT DRAFT DOCUMENT:
${session.draftDocument}

USER'S EDIT REQUEST:
${editRequest}

Please modify the document according to the user's request and return the complete updated document.`;

    const response = await generateUserText(
      'legal-document-edit',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.3,
      },
      TaskPriority.HIGH_USER
    );
    
    if (!response.content?.trim()) {
      throw new Error('Empty response from AI');
    }
    
    session.draftDocument = response.content;
    session.updatedAt = new Date();
    
    // Record AI usage
    const latency = Date.now() - startTime;
    await recordUsage(
      'legal_document_creator_edit',
      AIProvider.GEMINI,
      estimateTokens(response.content),
      latency,
      true,
      'standard',
      TaskPriority.HIGH_USER
    );
    
    return {
      success: true,
      previewId: sessionId,
      documentPreview: response.content,
      documentType: session.documentType || 'legal_document',
      jurisdiction: session.jurisdiction || 'Unknown',
      message: 'Your document has been updated. Please review the changes.',
    };
  } catch (error: any) {
    console.error('[Legal Document Creator] Error processing edit:', error);
    throw new Error(`Failed to process edit: ${error.message}`);
  }
}

/**
 * Create Stripe Checkout session for payment
 */
export async function createCheckout(
  sessionId: string, 
  userEmail: string
): Promise<{ checkoutUrl: string; stripeSessionId: string }> {
  const session = sessions.get(sessionId);
  
  if (!session) {
    throw new Error('Session not found');
  }
  
  if (session.status !== 'preview') {
    throw new Error('Session is not ready for payment');
  }
  
  if (!session.draftDocument) {
    throw new Error('No document to purchase');
  }
  
  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    throw new Error('Invalid email address');
  }
  
  session.userEmail = userEmail;
  session.updatedAt = new Date();
  
  // Get shared Stripe client
  const stripe = getStripeClient();
  
  const baseUrl = getBaseURL();
  
  // Create Stripe Checkout Session
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: userEmail,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: LEGAL_DOCUMENT_CREATOR_PRICING_CENTS,
          product_data: {
            name: 'Legal Document',
            description: `${formatDocumentType(session.documentType || 'legal_document')} - ${session.jurisdiction || 'General'}`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/home?legal_doc_payment=success&session=${sessionId}`,
    cancel_url: `${baseUrl}/home?legal_doc_payment=cancelled&session=${sessionId}`,
    metadata: {
      sessionId,
      documentType: session.documentType || 'legal_document',
      jurisdiction: session.jurisdiction || 'general',
      type: 'legal_document_creator',
    },
  });
  
  session.stripeSessionId = checkoutSession.id;
  session.updatedAt = new Date();
  
  console.log(`[Legal Document Creator] Checkout session created: ${checkoutSession.id}`);
  
  return {
    checkoutUrl: checkoutSession.url!,
    stripeSessionId: checkoutSession.id,
  };
}

/**
 * Handle Stripe webhook for successful payment
 */
export async function handleStripeWebhook(
  payload: Buffer,
  signature: string
): Promise<{ success: boolean; message: string }> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook secret is not configured');
  }
  
  // Get shared Stripe client
  const stripe = getStripeClient();
  
  let event: Stripe.Event;
  
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error: any) {
    console.error('[Legal Document Creator] Webhook signature verification failed:', error.message);
    throw new Error('Invalid webhook signature');
  }
  
  if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    
    if (checkoutSession.metadata?.type !== 'legal_document_creator') {
      // Not our webhook, ignore
      return { success: true, message: 'Not a legal document creator payment' };
    }
    
    const sessionId = checkoutSession.metadata.sessionId;
    const session = sessions.get(sessionId);
    
    if (!session) {
      console.error(`[Legal Document Creator] Session not found for payment: ${sessionId}`);
      return { success: false, message: 'Session not found' };
    }
    
    // Mark session as paid
    session.status = 'paid';
    session.updatedAt = new Date();
    
    console.log(`[Legal Document Creator] Payment successful for session ${sessionId}`);
    
    // Send the document via email
    try {
      await sendDocumentEmail(session);
      session.status = 'delivered';
      session.updatedAt = new Date();
      
      console.log(`[Legal Document Creator] Document emailed for session ${sessionId}`);
      
      return { success: true, message: 'Payment processed and document delivered' };
    } catch (emailError) {
      console.error('[Legal Document Creator] Failed to send email:', emailError);
      return { success: true, message: 'Payment processed but email delivery failed' };
    }
  }
  
  return { success: true, message: 'Event processed' };
}

/**
 * Get session by ID (for status checks)
 */
export function getSession(sessionId: string): LegalSession | null {
  return sessions.get(sessionId) || null;
}

/**
 * Get draft preview (for display)
 */
export function getDraftPreview(sessionId: string): { document: string; canCopy: false } | null {
  const session = sessions.get(sessionId);
  
  if (!session || !session.draftDocument) {
    return null;
  }
  
  return {
    document: session.draftDocument,
    canCopy: false, // Client must enforce this
  };
}

// ============================================
// Helper Functions
// ============================================

async function inferDocumentTypeAndQuestions(session: LegalSession): Promise<{
  documentType: string;
  followUpQuestions: QuestionnaireQuestion[];
}> {
  const systemPrompt = `You are a legal document classification expert. Based on the user's description of their needs, you will:
1. Determine the most appropriate type of legal document
2. Identify any additional information needed to draft the document

DOCUMENT TYPES (choose one):
- demand_letter: For requesting payment or action from another party
- cease_and_desist: For ordering someone to stop an action
- settlement_agreement: For documenting resolution of a dispute
- power_of_attorney: For granting legal authority to another person
- affidavit: For sworn statements of fact
- complaint_letter: For formal complaints to organizations
- notice_of_intent: For formal notice of planned legal action
- declaration: For written statements under penalty of perjury
- will_simple: For basic estate planning
- lease_agreement: For rental/lease arrangements

Return your response as JSON with this structure:
{
  "documentType": "one of the types above",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "followUpQuestions": [
    {
      "id": "unique_id",
      "question": "the question text",
      "type": "text|select|multiline",
      "options": ["option1", "option2"] // only for select type
      "required": true/false,
      "helpText": "helpful context"
    }
  ]
}`;

  const userPrompt = `Based on these user answers, determine the document type and any follow-up questions needed:

PURPOSE: ${session.answers.document_purpose || 'Not provided'}
PARTIES: ${session.answers.parties_involved || 'Not provided'}
STATE: ${session.answers.state || 'Not provided'}
KEY FACTS: ${session.answers.key_facts || 'Not provided'}
DESIRED OUTCOME: ${session.answers.desired_outcome || 'Not provided'}

Analyze and return the appropriate document type and any follow-up questions.`;

  const response = await generateUserText(
    'legal-document-inference',
    userPrompt,
    {
      systemPrompt,
      temperature: 0.3,
      useJSON: true,
    },
    TaskPriority.HIGH_USER
  );
  
  const result = safeJsonParse<{
    documentType: string;
    confidence: number;
    reasoning: string;
    followUpQuestions: QuestionnaireQuestion[];
  }>(response.content, 'Document type inference failed');
  
  // Validate document type
  const validType = DOCUMENT_TYPES.includes(result.documentType as any)
    ? result.documentType
    : 'demand_letter';
  
  console.log(`[Legal Document Creator] Inferred document type: ${validType} (confidence: ${result.confidence})`);
  console.log(`[Legal Document Creator] Reasoning: ${result.reasoning}`);
  
  return {
    documentType: validType,
    followUpQuestions: result.followUpQuestions || [],
  };
}

async function fetchJurisdictionalStandards(
  state: string, 
  documentType: string
): Promise<string | null> {
  try {
    const systemPrompt = `You are a legal research specialist. Provide the key legal requirements and standards for drafting the specified document type in the specified U.S. state.`;

    const userPrompt = `What are the key legal requirements, formatting standards, and jurisdiction-specific rules for a ${formatDocumentType(documentType)} in ${state}?

Include:
1. Required elements or sections
2. Notarization or witness requirements
3. Service of process requirements (if applicable)
4. Filing or delivery requirements
5. Any state-specific statutes or rules

Be concise but comprehensive.`;

    const response = await generateUserText(
      'legal-jurisdiction-research',
      userPrompt,
      {
        systemPrompt,
        temperature: 0.2,
      },
      TaskPriority.MEDIUM_BACKGROUND
    );
    
    return response.content;
  } catch (error) {
    console.error('[Legal Document Creator] Error fetching jurisdiction standards:', error);
    return null;
  }
}

async function generateLegalDocumentDraft(
  session: LegalSession, 
  jurisdictionInfo: string | null
): Promise<string> {
  const documentType = session.documentType || 'legal_document';
  const state = session.jurisdiction || 'General';
  
  const systemPrompt = `You are an expert legal document drafter with decades of experience creating professional, legally sound documents. You will generate a complete, ready-to-use legal document based on the user's requirements.

CRITICAL REQUIREMENTS:
1. Use proper legal language and formatting
2. Include all required sections for this document type
3. Comply with ${state} state requirements and laws
4. Include placeholder brackets [LIKE THIS] only for specific data the user must fill in (dates, signatures)
5. Make the document professional and legally enforceable
6. Include any required notices, disclosures, or certifications
7. Use proper paragraph numbering and structure

FORMAT:
- Use proper document headers and titles
- Include date lines and signature blocks
- Add notarization section if required by law
- Include certificate of service if applicable`;

  let userPrompt = `Generate a complete ${formatDocumentType(documentType)} for use in ${state} based on the following information:

PURPOSE: ${session.answers.document_purpose || 'Not specified'}
PARTIES INVOLVED: ${session.answers.parties_involved || 'Not specified'}
KEY FACTS: ${session.answers.key_facts || 'Not specified'}
DESIRED OUTCOME: ${session.answers.desired_outcome || 'Not specified'}`;

  // Add any follow-up answers
  const additionalAnswers = Object.entries(session.answers)
    .filter(([key]) => !['document_purpose', 'parties_involved', 'state', 'key_facts', 'desired_outcome'].includes(key))
    .map(([key, value]) => `${key.replace(/_/g, ' ').toUpperCase()}: ${value}`)
    .join('\n');
  
  if (additionalAnswers) {
    userPrompt += `\n\nADDITIONAL DETAILS:\n${additionalAnswers}`;
  }
  
  if (jurisdictionInfo) {
    userPrompt += `\n\nJURISDICTION-SPECIFIC REQUIREMENTS:\n${jurisdictionInfo}`;
  }
  
  userPrompt += `\n\nGenerate the complete legal document now. Include all sections, proper formatting, and signature blocks.`;

  const response = await generateUserText(
    'legal-document-draft',
    userPrompt,
    {
      systemPrompt,
      temperature: 0.4,
    },
    TaskPriority.CRITICAL_USER
  );
  
  if (!response.content?.trim()) {
    throw new Error('Failed to generate document content');
  }
  
  return response.content;
}

async function sendDocumentEmail(session: LegalSession): Promise<void> {
  if (!session.userEmail) {
    throw new Error('No email address for session');
  }
  
  if (!session.finalDocument && !session.draftDocument) {
    throw new Error('No document to send');
  }
  
  const document = session.finalDocument || session.draftDocument!;
  const documentType = formatDocumentType(session.documentType || 'legal_document');
  
  const subject = `Your Legal Document: ${documentType}`;
  const message = `Dear Customer,

Thank you for your purchase from BadBlue Legal Document Creator.

Your ${documentType} for ${session.jurisdiction || 'your jurisdiction'} is included below.

IMPORTANT NOTES:
- Review the document carefully before use
- Fill in any bracketed [PLACEHOLDER] information with your specific details
- Consider having the document reviewed by a licensed attorney
- Follow all notarization and witness requirements for your state
- Keep a copy for your records

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR DOCUMENT:

${document}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DISCLAIMER: This document was generated using AI assistance and is provided for informational purposes. It does not constitute legal advice. We recommend consulting with a licensed attorney in your jurisdiction before using this document for legal matters.

If you have any questions or concerns, please contact our support team.

Thank you for using BadBlue.

Best regards,
BadBlue Team`;

  const success = await sendUserEmail(session.userEmail, subject, message);
  
  if (!success) {
    throw new Error('Failed to send email');
  }
}

function formatDocumentType(type: string): string {
  const typeNames: Record<string, string> = {
    demand_letter: 'Demand Letter',
    cease_and_desist: 'Cease and Desist Letter',
    settlement_agreement: 'Settlement Agreement',
    power_of_attorney: 'Power of Attorney',
    affidavit: 'Affidavit',
    complaint_letter: 'Complaint Letter',
    notice_of_intent: 'Notice of Intent',
    declaration: 'Declaration',
    will_simple: 'Simple Will',
    lease_agreement: 'Lease Agreement',
  };
  
  return typeNames[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// ============================================
// Exports for Testing
// ============================================

export const __testing = {
  inferDocumentTypeAndQuestions,
  fetchJurisdictionalStandards,
  generateLegalDocumentDraft,
  formatDocumentType,
  estimateTokens,
  sessions,
};
