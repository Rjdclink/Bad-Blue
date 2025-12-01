/**
 * Legal Document Service
 * Generates professional legal documents using 3-way AI (Claude + Gemini + Mistral)
 * Parallel execution for speed with professional formatting
 * 
 * Service price: $3
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Mistral } from '@mistralai/mistralai';

// Pricing for legal document service
export const LEGAL_DOCUMENT_PRICING_CENTS = 300; // $3.00

export interface LegalDocumentRequest {
  documentType: 'demand_letter' | 'cease_desist' | 'notice_of_intent' | 'formal_complaint' | 'settlement_proposal';
  recipientName: string;
  recipientAddress?: string;
  context: string;
  senderName: string;
  senderAddress?: string;
  incidentDate?: string;
  damagesAmount?: number;
  additionalDetails?: string;
}

export interface LegalDocumentResult {
  document: string;
  format: string;
  generatedAt: Date;
  aiContributions: {
    claude: boolean;
    gemini: boolean;
    mistral: boolean;
  };
  confidence: 'high' | 'medium' | 'low';
}

interface AIResult {
  content: string;
  success: boolean;
  error?: string;
}

/**
 * Generate using Claude AI
 */
async function generateWithClaude(request: LegalDocumentRequest): Promise<AIResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { content: '', success: false, error: 'Claude API not available' };
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    
    const prompt = createLegalDocumentPrompt(request, 'claude');
    
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return { content: '', success: false, error: 'Invalid response from Claude' };
    }

    return { content: content.text, success: true };
  } catch (error: any) {
    console.error('[Legal Document] Claude error:', error);
    return { content: '', success: false, error: error.message };
  }
}

/**
 * Generate using Gemini AI
 */
async function generateWithGemini(request: LegalDocumentRequest): Promise<AIResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { content: '', success: false, error: 'Gemini API not available' };
  }

  try {
    const client = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = createLegalDocumentPrompt(request, 'gemini');
    
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 }
    });

    const content = response.text();
    return { content, success: true };
  } catch (error: any) {
    console.error('[Legal Document] Gemini error:', error);
    return { content: '', success: false, error: error.message };
  }
}

/**
 * Generate using Mistral AI
 */
async function generateWithMistral(request: LegalDocumentRequest): Promise<AIResult> {
  if (!process.env.MISTRAL_API_KEY) {
    return { content: '', success: false, error: 'Mistral API not available' };
  }

  try {
    const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    
    const prompt = createLegalDocumentPrompt(request, 'mistral');
    
    const response = await client.chat.complete({
      model: 'mistral-small-2409', // Use specific version for stability
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return { content: '', success: false, error: 'Invalid response from Mistral' };
    }

    return { content, success: true };
  } catch (error: any) {
    console.error('[Legal Document] Mistral error:', error);
    return { content: '', success: false, error: error.message };
  }
}

/**
 * Create the prompt for legal document generation
 */
function createLegalDocumentPrompt(request: LegalDocumentRequest, provider: string): string {
  const documentTypeLabels: Record<string, string> = {
    'demand_letter': 'Demand Letter',
    'cease_desist': 'Cease and Desist Letter',
    'notice_of_intent': 'Notice of Intent to Sue',
    'formal_complaint': 'Formal Complaint Letter',
    'settlement_proposal': 'Settlement Proposal Letter'
  };

  const docType = documentTypeLabels[request.documentType] || 'Legal Letter';
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return `Generate a professional ${docType} with the following details:

FROM:
${request.senderName}
${request.senderAddress || '[ADDRESS TO BE ADDED]'}

TO:
${request.recipientName}
${request.recipientAddress || '[ADDRESS TO BE ADDED]'}

DATE: ${currentDate}

INCIDENT DATE: ${request.incidentDate || 'Recent'}

CONTEXT/SITUATION:
${request.context}

${request.damagesAmount ? `DAMAGES CLAIMED: $${(request.damagesAmount / 100).toLocaleString()}` : ''}

${request.additionalDetails ? `ADDITIONAL DETAILS:\n${request.additionalDetails}` : ''}

Requirements:
1. Use formal, professional legal language
2. Include proper legal document structure (header, body, closing)
3. Reference relevant legal principles (but DO NOT make up specific laws/statutes)
4. Include clear demands/requests with reasonable deadlines
5. End with appropriate signature block
6. Format for easy printing

Provider context: ${provider}

Generate the complete, ready-to-send legal document:`;
}

/**
 * Combine results from multiple AI providers
 */
function combineResults(
  claudeResult: AIResult,
  geminiResult: AIResult,
  mistralResult: AIResult
): { combined: string; confidence: 'high' | 'medium' | 'low' } {
  const results = [
    { result: claudeResult, weight: 40 },
    { result: geminiResult, weight: 35 },
    { result: mistralResult, weight: 25 }
  ].filter(r => r.result.success);

  if (results.length === 0) {
    return { combined: '', confidence: 'low' };
  }

  // If only one result, use it
  if (results.length === 1) {
    return { combined: results[0].result.content, confidence: 'medium' };
  }

  // Use the longest/most comprehensive response (usually indicates more detail)
  const best = results.reduce((a, b) => 
    a.result.content.length > b.result.content.length ? a : b
  );

  // High confidence if 2+ providers succeeded
  const confidence = results.length >= 2 ? 'high' : 'medium';

  return { combined: best.result.content, confidence };
}

/**
 * Main function to generate legal document using 3-way AI
 */
export async function generateLegalDocument(
  request: LegalDocumentRequest
): Promise<LegalDocumentResult> {
  console.log(`[Legal Document] Generating ${request.documentType} for ${request.recipientName}`);
  
  // Run all three AI providers in parallel
  const [claudeResult, geminiResult, mistralResult] = await Promise.all([
    generateWithClaude(request),
    generateWithGemini(request),
    generateWithMistral(request)
  ]);

  console.log(`[Legal Document] AI results - Claude: ${claudeResult.success}, Gemini: ${geminiResult.success}, Mistral: ${mistralResult.success}`);

  // Combine results
  const { combined, confidence } = combineResults(claudeResult, geminiResult, mistralResult);

  if (!combined) {
    throw new Error('All AI providers failed to generate document');
  }

  return {
    document: combined,
    format: 'text/plain',
    generatedAt: new Date(),
    aiContributions: {
      claude: claudeResult.success,
      gemini: geminiResult.success,
      mistral: mistralResult.success
    },
    confidence
  };
}

/**
 * Get document type description for display
 */
export function getDocumentTypeDescription(docType: string): string {
  const descriptions: Record<string, string> = {
    'demand_letter': 'A formal letter demanding specific action or payment',
    'cease_desist': 'A letter demanding the recipient stop specific behavior',
    'notice_of_intent': 'A formal notice that legal action may be taken',
    'formal_complaint': 'A detailed complaint documenting grievances',
    'settlement_proposal': 'A proposal for resolving a dispute without litigation'
  };
  return descriptions[docType] || 'Legal document';
}
