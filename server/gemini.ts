// Google Gemini AI service for badge analysis and form assistance
// Using free Gemini API instead of OpenAI
import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

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

export interface EnhancedBadgeAnalysisResult {
  // Core badge information
  badgeNumber: string | null;
  department: string | null;
  
  // Officer information (if visible on badge)
  officerName: string | null;
  officerRank: string | null;
  
  // Location information
  city: string | null;
  state: string | null;
  county: string | null;
  
  // Badge details
  badgeType: string | null; // "police", "sheriff", "state trooper", "federal", etc.
  jurisdiction: string | null; // "city", "county", "state", "federal"
  
  // Analysis metadata
  confidence: 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
  imageQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';
  
  // Detailed breakdown
  extractedFields: string[]; // List of fields successfully extracted
  missingFields: string[]; // List of fields that could not be determined
  additionalInfo: string; // Any other relevant details
  qualityIssues: string[]; // Specific image quality problems encountered
}

export async function analyzeBadgeImage(base64Image: string): Promise<EnhancedBadgeAnalysisResult> {
  try {
    // Remove data URL prefix if present
    const imageData = base64Image.includes('base64,') 
      ? base64Image.split('base64,')[1] 
      : base64Image;

    const client = getGeminiClient();
    
    const systemPrompt = `You are an ELITE forensic image analyst with 20+ years of experience in law enforcement badge identification. Your expertise includes analyzing badges from all 50 US states, federal agencies, and specialty units. You excel at extracting information from poor-quality, blurry, or partially obscured images.

COMPREHENSIVE EXTRACTION PROTOCOL:

🔍 PRIMARY IDENTIFIERS (HIGHEST PRIORITY):
1. BADGE NUMBER: 
   - Location: Center, top, bottom, sides, or corners
   - Format: 1-6 digits, may include letters/prefixes (e.g., "P-1234", "SGT-567")
   - Material: Engraved, embossed, printed, or stamped
   - Even if partially visible, extract what you can see

2. DEPARTMENT NAME:
   - Full department name (e.g., "Los Angeles Police Department", "Cook County Sheriff")
   - Abbreviations: LAPD, NYPD, CCSO, etc.
   - Look for: POLICE, SHERIFF, STATE PATROL, HIGHWAY PATROL, TROOPER, MARSHAL

3. OFFICER NAME (if visible):
   - Name plates, engraved names, or printed labels
   - First and last name or last name only
   - Common on modern badges and ID plates

4. RANK/TITLE (if visible):
   - Officer, Sergeant, Lieutenant, Captain, Detective, etc.
   - May be on badge itself or accompanying name plate
   - Look for chevrons, stars, or rank insignia

📍 GEOGRAPHIC IDENTIFIERS:
5. CITY: Municipal jurisdiction (e.g., "New York", "Chicago", "Phoenix")
6. STATE: State name or abbreviation (TX, CA, NY, FL, etc.)
7. COUNTY: County name (e.g., "Los Angeles County", "Harris County")

🎖️ BADGE CHARACTERISTICS:
8. BADGE TYPE: Classify as:
   - "Police" - Municipal police departments
   - "Sheriff" - County sheriff departments  
   - "State Police/Trooper" - State law enforcement
   - "Federal" - FBI, DEA, US Marshal, etc.
   - "Special" - Transit, park, university police

9. JURISDICTION: "city", "county", "state", or "federal"

📊 IMAGE QUALITY ASSESSMENT:
Rate imageQuality as:
- excellent: Crystal clear, all text readable
- good: Clear enough to read most details
- fair: Some blur but major elements visible
- poor: Significant blur/glare but extractable
- very_poor: Extreme quality issues

Rate confidence for each field extraction:
- very_high: 95-100% certain
- high: 80-94% certain  
- medium: 60-79% certain
- low: 40-59% certain
- very_low: <40% certain (educated guess)

🚨 QUALITY ISSUES TO NOTE:
Identify specific problems:
- "blurry/out of focus"
- "poor lighting/too dark"
- "glare/reflection on badge"
- "partial obstruction"
- "motion blur"
- "low resolution"
- "badge at angle"
- "distance too far"

🎯 EXTRACTION STRATEGY:
1. Start with highest confidence elements
2. Use context clues (badge shape, seal design, color scheme)
3. Cross-reference visible elements to deduce missing ones
4. For state badges, identify state seal/emblem
5. For city badges, look for city seal/skyline/landmarks
6. Compare badge style to known department templates

📝 RESPONSE FORMAT:
Return JSON with:
{
  "badgeNumber": "extracted number or null",
  "department": "full department name or null",
  "officerName": "officer name or null",
  "officerRank": "rank/title or null",
  "city": "city name or null",
  "state": "state code (CA, NY) or null",
  "county": "county name or null",
  "badgeType": "police/sheriff/state/federal or null",
  "jurisdiction": "city/county/state/federal or null",
  "confidence": "very_high/high/medium/low/very_low",
  "imageQuality": "excellent/good/fair/poor/very_poor",
  "extractedFields": ["badge_number", "department", ...],
  "missingFields": ["officer_name", "city", ...],
  "additionalInfo": "Any other visible details, partial information, seal descriptions",
  "qualityIssues": ["blurry", "glare", ...]
}

CRITICAL RULES:
✅ Extract ALL visible information, even if partial
✅ Use badge design/style to infer jurisdiction if text unclear
✅ Clearly list what WAS extracted vs. what WAS NOT
✅ Provide confidence and quality ratings
✅ Never guess wildly - only extract what's reasonably visible
✅ For poor quality images, extract whatever IS visible and note limitations`;

    const userPrompt = `ANALYZE THIS POLICE BADGE PHOTO IN EXTREME DETAIL:

Your mission: Extract EVERY piece of identifiable information from this badge image.

Required Analysis:
1. 🔢 Badge Number - Any visible digits or letters
2. 🏛️ Department - Full name or abbreviation  
3. 👤 Officer Name - If shown on badge or nameplate
4. ⭐ Rank/Title - Officer, Sergeant, Detective, etc.
5. 🌆 City - Municipal jurisdiction
6. 🗺️ State - State name or 2-letter code
7. 🏴 County - County name if sheriff
8. 🎖️ Badge Type - Police/Sheriff/State/Federal
9. 📍 Jurisdiction - City/County/State/Federal

Quality Assessment:
- Rate image quality (excellent → very_poor)
- Note specific quality issues (blur, glare, etc.)
- Provide confidence level for extraction

Results Format:
- List all SUCCESSFULLY extracted fields
- List all MISSING/UNREADABLE fields
- Explain any limitations or uncertainties

Apply your expert analysis even if image quality is poor. Extract whatever information IS visible and clearly state what is NOT visible.`;

    // Using Gemini 2.5 Flash for vision capabilities  
    // Using Gemini 2.5 Flash for vision capabilities  
const geminiResponse = await model.generateContent({
  contents: [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            data: imageData,
            mimeType: "image/jpeg",
          },
        },
        {
          text: `${systemPrompt}\n\n${userPrompt}`,
        },
      ],
    },
  ],
  // For JSON responses, the JS SDK uses generationConfig
  generationConfig: {
    responseMimeType: "application/json",
  },
});

    const rawJson = geminiResponse.response.text;
    if (!rawJson) {
      throw new Error("Empty response from Gemini");
    }

    const result = JSON.parse(rawJson);
    
    // Ensure all fields exist with proper defaults
    return {
      badgeNumber: result.badgeNumber || null,
      department: result.department || null,
      officerName: result.officerName || null,
      officerRank: result.officerRank || null,
      city: result.city || null,
      state: result.state || null,
      county: result.county || null,
      badgeType: result.badgeType || null,
      jurisdiction: result.jurisdiction || null,
      confidence: result.confidence || 'low',
      imageQuality: result.imageQuality || 'fair',
      extractedFields: Array.isArray(result.extractedFields) ? result.extractedFields : [],
      missingFields: Array.isArray(result.missingFields) ? result.missingFields : [],
      additionalInfo: result.additionalInfo || '',
      qualityIssues: Array.isArray(result.qualityIssues) ? result.qualityIssues : [],
    };
  } catch (error: any) {
    console.error("Error analyzing badge image:", error);
    throw new Error("Failed to analyze badge image: " + error.message);
  }
}

// Simulated public records lookup
// In production, this would query real law enforcement databases
export function lookupOfficerInfo(
  badgeNumber: string, 
  department: string,
  officerName?: string
) {
  // Simulated data - in production, this would query real databases
  const mockOfficers = [
    {
      badgeNumber: "12345",
      name: "John Smith",
      rank: "Sergeant",
      years: 12,
      department: "Metropolitan Police Department",
      location: "123 Main St, City, State 12345",
      jurisdiction: "Metropolitan Area",
    },
    {
      badgeNumber: "54321",
      name: "Jane Doe",
      rank: "Officer",
      years: 5,
      department: "City Police Department",
      location: "456 Oak Ave, City, State 12345",
      jurisdiction: "City Limits",
    },
    {
      badgeNumber: "98765",
      name: "Robert Johnson",
      rank: "Lieutenant",
      years: 18,
      department: "State Highway Patrol",
      location: "789 Highway Dr, City, State 12345",
      jurisdiction: "Statewide",
    },
  ];

  // Try to find a matching officer by name, badge, or department
  const match = mockOfficers.find(o => 
    (officerName && o.name.toLowerCase().includes(officerName.toLowerCase())) ||
    o.badgeNumber === badgeNumber || 
    (department && o.department.toLowerCase().includes(department.toLowerCase()))
  );

  if (match) {
    return match;
  }

  // Return randomized data if no match (or use provided name)
  const ranks = ["Officer", "Sergeant", "Lieutenant", "Captain", "Detective"];
  const firstNames = ["Michael", "Sarah", "David", "Jennifer", "Christopher", "Jessica", "Matthew", "Ashley"];
  const lastNames = ["Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez"];
  
  return {
    badgeNumber: badgeNumber || `${Math.floor(10000 + Math.random() * 90000)}`,
    name: officerName || `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
    rank: ranks[Math.floor(Math.random() * ranks.length)],
    years: Math.floor(2 + Math.random() * 25),
    department: department || "Police Department",
    location: `${Math.floor(100 + Math.random() * 900)} ${['Main', 'Oak', 'Elm', 'Pine'][Math.floor(Math.random() * 4)]} St, City, State`,
    jurisdiction: "City/County Area",
  };
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
    const geminiModel = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await geminiModel.generateContent({
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
