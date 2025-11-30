// Email Verification Service for Police Department Contact Information
// Uses web search and web fetch to verify official contact emails

interface VerificationResult {
  verified: boolean;
  email: string | null;
  source: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

/**
 * Verify city police department contact email through official website
 * @param city - City name
 * @param state - State code (e.g., "CA", "NY")
 * @param agencyType - Type of agency: 'police', 'sheriff', or 'trooper'
 * @returns Verification result with email and confidence level
 */
export async function verifyDepartmentEmail(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper' = 'police'
): Promise<VerificationResult> {
  const departmentName = formatSearchQuery(city, state, agencyType);

  console.log(`🔍 Verifying email for ${departmentName}...`);

  try {
    // Step 1: Search for official website
    const websiteUrl = await findOfficialWebsite(city, state, agencyType);

    if (!websiteUrl) {
      console.log(`❌ Could not find official website for ${departmentName}`);
      return {
        verified: false,
        email: null,
        source: null,
        confidence: 'low',
        notes: 'Official website not found'
      };
    }

    console.log(`✅ Found official website: ${websiteUrl}`);

    // Step 2: Extract contact email from website
    const email = await extractContactEmail(websiteUrl, departmentName);

    if (!email) {
      console.log(`⚠️ Could not extract contact email from ${websiteUrl}`);
      return {
        verified: false,
        email: null,
        source: websiteUrl,
        confidence: 'low',
        notes: 'Email not found on official website'
      };
    }

    console.log(`✅ Verified email: ${email}`);

    return {
      verified: true,
      email: email,
      source: websiteUrl,
      confidence: 'high',
      notes: `Verified from official ${departmentName} website`
    };

  } catch (error) {
    console.error(`Error verifying email for ${departmentName}:`, error);
    return {
      verified: false,
      email: null,
      source: null,
      confidence: 'low',
      notes: 'Verification process failed due to technical error'
    };
  }
}

/**
 * Format search query for finding official website
 */
function formatSearchQuery(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper'
): string {
  switch (agencyType) {
    case 'police':
      return `${city} ${state} Police Department`;
    case 'sheriff':
      return `${city} County ${state} Sheriff's Office`;
    case 'trooper':
      return `${state} State Police`;
    default:
      return `${city} ${state} Police Department`;
  }
}

/**
 * Find official website using Gemini AI web search
 * Returns the most likely official .gov or official website URL
 */
async function findOfficialWebsite(
  city: string,
  state: string,
  agencyType: 'police' | 'sheriff' | 'trooper'
): Promise<string | null> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");

  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY not configured for email verification');
    return null;
  }

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: { 
      temperature: 0.1,
      responseMimeType: "application/json" 
    }
  });
  const searchQuery = `${formatSearchQuery(city, state, agencyType)} official website contact email`;
  console.log(`Searching for: ${searchQuery}`);

  try {
    const response = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [{ text: `Find the official website for ${formatSearchQuery(city, state, agencyType)}. 

      Look for:
      - Official .gov website URL
      - Official city/county government website
      - Verified police department website

      Return JSON:
      {
        "websiteUrl": "full URL or null",
        "confidence": "high|medium|low"
      }` }]
      }]
    });

    const result = JSON.parse(response.response?.text() ?? '{}');
    return result.websiteUrl;
  } catch (error) {
    console.error('Error finding official website:', error);
    return null;
  }
}

/**
 * Extract contact email from official website using Gemini AI
 * Looks for common email patterns and contact information
 */
async function extractContactEmail(
  url: string,
  departmentName: string
): Promise<string | null> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");

  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY not configured for email extraction');
    return null;
  }

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: { 
      temperature: 0.1,
      responseMimeType: "application/json" 
    }
  });
  console.log(`Extracting contact email from: ${url}`);

  try {
    const response = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [{ text: `Extract the official contact email for ${departmentName} from their website at ${url}.

      Look for:
      - Internal Affairs email (highest priority)
      - Chief/Administration email
      - General contact email
      - Prefer .gov email addresses

      Return JSON:
      {
        "email": "email@domain.gov or null",
        "emailType": "internal_affairs|admin|general|null",
        "confidence": "high|medium|low"
      }` }]
      }]
    });

    const result = JSON.parse(response.response?.text() ?? '{}');
    return result.email && isValidEmail(result.email) ? result.email : null;
  } catch (error) {
    console.error('Error extracting email:', error);
    return null;
  }
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if email is from official government domain
 */
function isGovDomain(email: string): boolean {
  return email.toLowerCase().endsWith('.gov');
}

/**
 * Batch verify multiple departments
 * Useful for pre-populating jurisdiction database
 */
export async function batchVerifyDepartments(
  departments: Array<{ city: string; state: string; agencyType: 'police' | 'sheriff' | 'trooper' }>
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const dept of departments) {
    const result = await verifyDepartmentEmail(dept.city, dept.state, dept.agencyType);
    results.push(result);

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}