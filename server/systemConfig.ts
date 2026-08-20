/**
 * Centralized System Configuration
 * 
 * Master configuration file for all core engines, providers, and subsystems.
 * Enables easy provider swapping without rewriting application code.
 * 
 * Configuration Categories:
 * - Voice/TTS Providers
 * - Geo/GPS Services
 * - OSINT/Crawler Systems
 * - AI Model Selection
 * - Inmate Search Providers
 * - Cache Configuration
 */

// ═══════════════════════════════════════════════════════
// VOICE / TTS PROVIDER CONFIGURATION
// ═══════════════════════════════════════════════════════

export interface VoiceProviderConfig {
  provider: 'elevenlabs' | 'azure' | 'google' | 'amazon' | 'browser';
  apiKey?: string;
  voiceId?: string;
  model?: string;
  settings: {
    pitch: number; // -20 to 20
    rate: number; // 0.25 to 4.0
    stability: number; // 0 to 1
    similarityBoost: number; // 0 to 1
  };
}

export const VOICE_PROVIDERS: Record<string, VoiceProviderConfig> = {
  // Primary: ElevenLabs for premium quality
  elevenlabs: {
    provider: 'elevenlabs',
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL', // Rachel
    model: 'eleven_turbo_v2',
    settings: {
      pitch: 0,
      rate: 1.0,
      stability: 0.5,
      similarityBoost: 0.8,
    },
  },
  // Fallback: Browser TTS
  browser: {
    provider: 'browser',
    settings: {
      pitch: 1.1,
      rate: 1.0,
      stability: 1.0,
      similarityBoost: 1.0,
    },
  },
};

export const DEFAULT_VOICE_PROVIDER = process.env.VOICE_PROVIDER || 'browser';

// ═══════════════════════════════════════════════════════
// LEXARA PERSONA CONFIGURATION
// ═══════════════════════════════════════════════════════

export const LEXARA_VOICE_CONFIG = {
  // Voice characteristics
  persona: {
    name: 'Lexara',
    age: 18,
    gender: 'female',
    style: 'youthful, warm, expressive',
  },
  // Voice synthesis settings
  synthesis: {
    timbre: 'female-youth',
    texture: 'breathy-soft',
    pacing: 'natural',
    emotionalRange: 'high',
  },
  // Adjustable parameters
  tuning: {
    pitchShift: 0, // semitones
    formantShift: 0, // cents
    breathiness: 0.3, // 0-1
    warmth: 0.7, // 0-1
  },
};

// ═══════════════════════════════════════════════════════
// GEO / GPS / MAPPING CONFIGURATION
// ═══════════════════════════════════════════════════════

export interface GeoProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  rateLimitPerMinute?: number;
  enabled: boolean;
}

export const GEO_PROVIDERS: Record<string, GeoProviderConfig> = {
  // Tile providers
  openstreetmap: {
    provider: 'openstreetmap',
    baseUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    rateLimitPerMinute: 1000,
    enabled: true,
  },
  // Satellite imagery
  esri: {
    provider: 'esri',
    baseUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    rateLimitPerMinute: 1000,
    enabled: true,
  },
  // Geocoding
  nominatim: {
    provider: 'nominatim',
    baseUrl: 'https://nominatim.openstreetmap.org',
    rateLimitPerMinute: 60, // Free tier limit
    enabled: true,
  },
};

export const GEO_CONFIG = {
  // Default map settings
  defaultCenter: { lat: 39.8283, lng: -98.5795 }, // US center
  defaultZoom: 4,
  maxZoom: 19,
  minZoom: 2,
  
  // Heatmap settings
  heatmap: {
    radius: 25,
    blur: 15,
    maxZoom: 17,
    max: 1.0,
    gradient: {
      0.4: 'blue',
      0.6: 'cyan',
      0.7: 'lime',
      0.8: 'yellow',
      1.0: 'red',
    },
  },
  
  // Monte Carlo path interpolation
  monteCarlo: {
    simulations: 1000,
    timeStepMinutes: 5,
    maxSpeedMph: 80,
    confidenceThreshold: 0.7,
  },
  
  // Input fusion weights
  fusion: {
    gps: 1.0,
    wifi: 0.6,
    cell: 0.4,
    ip: 0.2,
  },
};

// ═══════════════════════════════════════════════════════
// OSINT / CRAWLER CONFIGURATION
// ═══════════════════════════════════════════════════════

export interface CrawlerConfig {
  enabled: boolean;
  rateLimitPerMinute: number;
  maxConcurrent: number;
  retryAttempts: number;
  timeoutMs: number;
  respectRobotsTxt: boolean;
}

export const CRAWLER_CONFIGS: Record<string, CrawlerConfig> = {
  pantheon: {
    enabled: true,
    rateLimitPerMinute: 30,
    maxConcurrent: 3,
    retryAttempts: 3,
    timeoutMs: 30000,
    respectRobotsTxt: true,
  },
  inmateFinder: {
    enabled: true,
    rateLimitPerMinute: 20,
    maxConcurrent: 2,
    retryAttempts: 3,
    timeoutMs: 45000,
    respectRobotsTxt: true,
  },
  trinityOsint: {
    enabled: true,
    rateLimitPerMinute: 15,
    maxConcurrent: 2,
    retryAttempts: 2,
    timeoutMs: 60000,
    respectRobotsTxt: true,
  },
  socialMedia: {
    enabled: false, // Disabled by default
    rateLimitPerMinute: 10,
    maxConcurrent: 1,
    retryAttempts: 2,
    timeoutMs: 30000,
    respectRobotsTxt: true,
  },
};

// ═══════════════════════════════════════════════════════
// INMATE SEARCH PROVIDERS
// ═══════════════════════════════════════════════════════

export interface InmateSearchProvider {
  name: string;
  type: 'federal' | 'state' | 'county' | 'private';
  baseUrl: string;
  enabled: boolean;
  priority: number; // Lower = higher priority
}

export const INMATE_SEARCH_PROVIDERS: InmateSearchProvider[] = [
  // Federal
  {
    name: 'BOP Inmate Locator',
    type: 'federal',
    baseUrl: 'https://www.bop.gov/inmateloc/',
    enabled: true,
    priority: 1,
  },
  {
    name: 'ICE Detainee Locator',
    type: 'federal',
    baseUrl: 'https://locator.ice.gov/odls/',
    enabled: true,
    priority: 2,
  },
  // State aggregators
  {
    name: 'VINELink',
    type: 'state',
    baseUrl: 'https://www.vinelink.com/',
    enabled: true,
    priority: 3,
  },
];

// ═══════════════════════════════════════════════════════
// AI MODEL CONFIGURATION
// ═══════════════════════════════════════════════════════

export interface AIModelConfig {
  provider: string;
  model: string;
  contextLength: number;
  costPer1kTokens: number;
  capabilities: string[];
  rateLimit?: number;
}

export const AI_MODELS: Record<string, AIModelConfig> = {
  // Primary models for user interactions
  'gemini-pro': {
    provider: 'google',
    model: 'gemini-2.5-pro',
    contextLength: 1000000,
    costPer1kTokens: 0.00125,
    capabilities: ['chat', 'analysis', 'coding', 'vision'],
  },
  'groq-llama': {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    contextLength: 128000,
    costPer1kTokens: 0.0,
    capabilities: ['chat', 'analysis', 'fast'],
    rateLimit: 100, // RPD
  },
  // Autonomous/background models
  'mistral-large': {
    provider: 'mistral',
    model: 'mistral-large-latest',
    contextLength: 128000,
    costPer1kTokens: 0.002,
    capabilities: ['chat', 'analysis', 'coding'],
  },
  // OpenRouter fallbacks
  'deepseek-r1': {
    provider: 'openrouter',
    model: 'tng/deepseek-r1t2-chimera:free',
    contextLength: 164000,
    costPer1kTokens: 0,
    capabilities: ['chat', 'reasoning'],
    rateLimit: 50, // RPD
  },
};

// Model selection priority
export const AI_MODEL_PRIORITY = {
  user: ['gemini-pro', 'groq-llama', 'mistral-large'],
  autonomous: ['groq-llama', 'mistral-large', 'deepseek-r1'],
  legal: ['gemini-pro', 'mistral-large'],
  analysis: ['gemini-pro', 'groq-llama'],
};

// ═══════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ═══════════════════════════════════════════════════════

export const CACHE_CONFIG = {
  // Redis configuration
  redis: {
    url: process.env.REDIS_URL,
    keyPrefix: 'badblue:',
    defaultTTL: 3600, // 1 hour
  },
  // In-memory LRU cache
  memory: {
    maxSize: 100 * 1024 * 1024, // 100MB
    maxEntries: 10000,
    defaultTTL: 1800, // 30 minutes
  },
  // Cache strategies by data type
  strategies: {
    searchResults: { ttl: 900, maxEntries: 500 },
    aiResponses: { ttl: 3600, maxEntries: 200 },
    crawlerData: { ttl: 86400, maxEntries: 1000 },
    geoData: { ttl: 604800, maxEntries: 5000 }, // 7 days
  },
};

// ═══════════════════════════════════════════════════════
// RATE LIMITING CONFIGURATION
// ═══════════════════════════════════════════════════════

export const RATE_LIMIT_CONFIG = {
  // Global API limits
  global: {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
  },
  // AI service limits
  ai: {
    groq: { rpm: 30, rpd: 14400 },
    gemini: { rpm: 60, rpd: 1500 },
    mistral: { rpm: 120, rpd: Infinity },
    openrouter: { rpm: 20, rpd: 50 },
  },
  // Crawler limits
  crawler: {
    maxConcurrent: 5,
    requestDelay: 1000, // ms between requests
    respectCrawlDelay: true,
  },
};

// ═══════════════════════════════════════════════════════
// SYSTEM VERSION INFO
// ═══════════════════════════════════════════════════════

export const SYSTEM_VERSION = {
  app: '1.0.0',
  engines: {
    voice: 'v2.0.0-elevenlabs',
    geo: 'v1.5.0-hybrid',
    crawler: 'v3.0.0-trinity',
    lexara: 'v2.1.0-persona',
    maintenance: 'v1.0.0',
  },
  /** Build/deployment timestamp - set at module load time */
  buildTimestamp: new Date().toISOString(),
};

/**
 * Get current runtime timestamp (for logging/reports)
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

/**
 * Get active voice provider configuration
 */
export function getActiveVoiceProvider(): VoiceProviderConfig {
  return VOICE_PROVIDERS[DEFAULT_VOICE_PROVIDER] || VOICE_PROVIDERS.browser;
}

/**
 * Get AI model by use case
 */
export function getAIModel(useCase: keyof typeof AI_MODEL_PRIORITY): AIModelConfig | null {
  const priority = AI_MODEL_PRIORITY[useCase];
  for (const modelKey of priority) {
    const model = AI_MODELS[modelKey];
    if (model) return model;
  }
  return null;
}

/**
 * Get crawler config by name
 */
export function getCrawlerConfig(name: keyof typeof CRAWLER_CONFIGS): CrawlerConfig {
  return CRAWLER_CONFIGS[name] || CRAWLER_CONFIGS.pantheon;
}

/**
 * Check if a provider is enabled
 */
export function isProviderEnabled(provider: string): boolean {
  const geo = GEO_PROVIDERS[provider];
  if (geo) return geo.enabled;
  
  const crawler = CRAWLER_CONFIGS[provider as keyof typeof CRAWLER_CONFIGS];
  if (crawler) return crawler.enabled;
  
  return false;
}

export default {
  VOICE_PROVIDERS,
  LEXARA_VOICE_CONFIG,
  GEO_PROVIDERS,
  GEO_CONFIG,
  CRAWLER_CONFIGS,
  INMATE_SEARCH_PROVIDERS,
  AI_MODELS,
  AI_MODEL_PRIORITY,
  CACHE_CONFIG,
  RATE_LIMIT_CONFIG,
  SYSTEM_VERSION,
  getActiveVoiceProvider,
  getAIModel,
  getCrawlerConfig,
  isProviderEnabled,
};
