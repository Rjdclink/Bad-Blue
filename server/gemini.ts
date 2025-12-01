// Google Gemini AI service for form assistance
// Using free Gemini API instead of OpenAI
import { GoogleGenerativeAI } from "@google/generative-ai";

// Lazy initialization to avoid startup errors when API key is not configured
let gemini: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!gemini) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return gemini;
}

/**
 * AI Form Assistant - Helps users fill out complaint/lawsuit forms through conversation
 */
interface FormAssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface FormAssistantResponse {
  message: string;
  suggestedFields?: Record<string, any>;
  needsMoreInfo?: string[];
  readyToSubmit?: boolean;
}

export async function chatWithFormAssistant(
  formType: 'complaint' | 'lawsuit',
  state: string | null,
  complaintType: string | null,
  lawsuitType: string | null,
  currentFormData: Record<string, any>,
  conversationHistory: FormAssistantMessage[],
  userMessage: string
): Promise<FormAssistantResponse> {
  try {
    const client = getGeminiClient();
    
    // Build system prompt based on form type and context
    const systemPrompt = `You are an expert legal assistant helping citizens file ${formType === 'complaint' ? 'police complaints' : 'civil rights lawsuits'}. Your role is to:

1. Ask clear, conversational questions to gather necessary information
2. Provide guidance on ${state || 'state'}-specific requirements and procedures
3. Help users understand what documentation they need
4. Suggest form field values based on the conversation
5. Be empathetic and professional - users may be describing traumatic experiences

CURRENT CONTEXT:
- Form Type: ${formType}
- State: ${state || 'Not yet specified'}
${formType === 'complaint' ? `- Complaint Type: ${complaintType || 'Not yet specified'}` : ''}
${formType === 'lawsuit' ? `- Lawsuit Type: ${lawsuitType || 'Not yet specified'}` : ''}

CURRENT FORM DATA:
${JSON.stringify(currentFormData, null, 2)}

INSTRUCTIONS:
- Ask ONE focused question at a time
- If state is not specified, ask for it first (it affects procedures)
- Guide users through the process step by step
- When you have enough information for a field, suggest it in your response
- Be concise but helpful
- If the user describes an incident, ask follow-up questions about: date, time, location, witnesses, evidence

RESPONSE FORMAT:
Respond with a JSON object containing:
{
  "message": "Your conversational response/question",
  "suggestedFields": { "fieldName": "value" }, // Only include if you can infer field values from conversation
  "needsMoreInfo": ["field1", "field2"], // Fields still missing
  "readyToSubmit": false // true only when ALL required fields are populated
}`;

    // Build conversation context for Gemini
    const conversationText = conversationHistory
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const fullPrompt = conversationHistory.length > 0 
      ? `${conversationText}\n\nUser: ${userMessage}`
      : `User: ${userMessage}`;

    // Using Gemini 1.5 Flash for fast conversational responses
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${systemPrompt}\n\n${fullPrompt}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const content = response.response.text();
    if (!content) {
      throw new Error('No response from Gemini');
    }

    const parsed = JSON.parse(content);
    return parsed as FormAssistantResponse;
    
  } catch (error) {
    console.error('AI form assistant error:', error);
    throw error;
  }
}
