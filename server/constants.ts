/**
 * Shared Constants
 * Centralized constants for use across the application
 */

// ==================== US STATES ====================
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
] as const;

export type USState = typeof US_STATES[number];

export const US_STATE_NAMES: Record<USState, string> = {
  'AL': 'Alabama',
  'AK': 'Alaska',
  'AZ': 'Arizona',
  'AR': 'Arkansas',
  'CA': 'California',
  'CO': 'Colorado',
  'CT': 'Connecticut',
  'DE': 'Delaware',
  'FL': 'Florida',
  'GA': 'Georgia',
  'HI': 'Hawaii',
  'ID': 'Idaho',
  'IL': 'Illinois',
  'IN': 'Indiana',
  'IA': 'Iowa',
  'KS': 'Kansas',
  'KY': 'Kentucky',
  'LA': 'Louisiana',
  'ME': 'Maine',
  'MD': 'Maryland',
  'MA': 'Massachusetts',
  'MI': 'Michigan',
  'MN': 'Minnesota',
  'MS': 'Mississippi',
  'MO': 'Missouri',
  'MT': 'Montana',
  'NE': 'Nebraska',
  'NV': 'Nevada',
  'NH': 'New Hampshire',
  'NJ': 'New Jersey',
  'NM': 'New Mexico',
  'NY': 'New York',
  'NC': 'North Carolina',
  'ND': 'North Dakota',
  'OH': 'Ohio',
  'OK': 'Oklahoma',
  'OR': 'Oregon',
  'PA': 'Pennsylvania',
  'RI': 'Rhode Island',
  'SC': 'South Carolina',
  'SD': 'South Dakota',
  'TN': 'Tennessee',
  'TX': 'Texas',
  'UT': 'Utah',
  'VT': 'Vermont',
  'VA': 'Virginia',
  'WA': 'Washington',
  'WV': 'West Virginia',
  'WI': 'Wisconsin',
  'WY': 'Wyoming'
};

// ==================== AI PROVIDERS ====================
// Supported AI providers for legal consultation and document generation
// Updated December 2025 with valid providers and models
export const AI_PROVIDERS = {
  GEMINI: 'gemini',
  GROQ: 'groq',
  MISTRAL: 'mistral',
  ANTHROPIC: 'anthropic',
  OPENROUTER: 'openrouter',
  DEEPSEEK: 'deepseek',
  COHERE: 'cohere',
  TOGETHER: 'together',
  PERPLEXITY: 'perplexity',
  FIREWORKS: 'fireworks',
  CEREBRAS: 'cerebras',
  SAMBANOVA: 'sambanova',
  HUGGINGFACE: 'huggingface'
} as const;

export type AIProvider = typeof AI_PROVIDERS[keyof typeof AI_PROVIDERS];

// OpenRouter models (Updated December 2025 - Best model from each provider via OpenRouter)
export const OPENROUTER_MODELS = {
  // Best model from each provider via OpenRouter
  GROQ_LLAMA: 'groq/llama-3.3-70b-versatile',           // Groq - Best: Llama 3.3 70B
  GOOGLE_GEMINI: 'google/gemini-2.0-flash-exp:free',    // Google AI Studio - Best: Gemini 2.0 Flash
  NVIDIA_NEMOTRON: 'nvidia/llama-3.1-nemotron-70b-instruct:free', // NVIDIA - Best: Nemotron 70B
  OPENAI_GPT4O: 'openai/gpt-4o-mini',                   // OpenAI - Best: GPT-4o Mini (cost-effective)
  MISTRAL_LARGE: 'mistralai/mistral-large-2411',        // Mistral - Best: Mistral Large
  DEEPSEEK_R1: 'deepseek/deepseek-r1-0528:free',        // DeepSeek - Best: DeepSeek R1
  ANTHROPIC_CLAUDE: 'anthropic/claude-3.5-sonnet',      // Anthropic - Best: Claude 3.5 Sonnet
  PERPLEXITY_SONAR: 'perplexity/sonar-pro',             // Perplexity - Best: Sonar Pro (web-grounded)
  QWEN_72B: 'qwen/qwen-2.5-72b-instruct:free',          // Qwen (via OpenRouter) - Best: Qwen 2.5 72B
  CLOUDFLARE_LLAMA: 'cloudflare/llama-3.1-70b-instruct', // Cloudflare - Best: Llama 3.1 70B
  SAMBANOVA_LLAMA: 'sambanova/llama-3.1-405b-instruct', // SambaNova - Best: Llama 3.1 405B
  GOOGLE_GEMMA: 'google/gemma-2-27b-it:free',           // Google Vertex - Best: Gemma 2 27B
} as const;

// ==================== LAW TYPES ====================
export const LAW_TYPES = {
  LAW_ENFORCEMENT: 'law-enforcement',
  EMPLOYMENT: 'employment',
  HOUSING: 'housing',
  FAMILY: 'family',
  CONSUMER: 'consumer',
  IMMIGRATION: 'immigration',
  CRIMINAL_DEFENSE: 'criminal-defense',
  PERSONAL_INJURY: 'personal-injury',
  SMALL_CLAIMS: 'small-claims'
} as const;

export type LawType = typeof LAW_TYPES[keyof typeof LAW_TYPES];

// ==================== SESSION TYPES ====================
export const SESSION_TYPES = {
  CONSULTATION: 'consultation',
  DOCUMENT_CREATOR: 'document-creator',
  LEGAL_RESEARCH: 'legal-research'
} as const;

export type SessionType = typeof SESSION_TYPES[keyof typeof SESSION_TYPES];

// ==================== DOCUMENT TYPES ====================
export const DOCUMENT_TYPES = {
  DEMAND_LETTER: 'demand-letter',
  COMPLAINT: 'complaint',
  PETITION: 'petition',
  MOTION: 'motion',
  BRIEF: 'brief',
  AFFIDAVIT: 'affidavit',
  CONTRACT: 'contract',
  AGREEMENT: 'agreement'
} as const;

export type DocumentType = typeof DOCUMENT_TYPES[keyof typeof DOCUMENT_TYPES];

// ==================== VALIDATION CONSTANTS ====================
export const VALIDATION = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 50,
  MAX_FILE_SIZE_MB: 10,
  MAX_DOCUMENT_LENGTH: 50000,
  AUTOSAVE_DEBOUNCE_MS: 3000,
  SESSION_TIMEOUT_MINUTES: 30
} as const;

// ==================== HTTP STATUS CODES ====================
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

// ==================== RATE LIMITING ====================
export const RATE_LIMITS = {
  API_REQUESTS_PER_MINUTE: 60,
  AI_REQUESTS_PER_HOUR: 100,
  AUTOSAVE_PER_MINUTE: 20,
  LOGIN_ATTEMPTS_PER_HOUR: 5
} as const;
