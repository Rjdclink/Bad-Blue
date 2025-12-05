/**
 * PANTHEON Shadow Retrieval Engine - Type Definitions
 * Comprehensive type system for ghost-level data retrieval
 */

// ═══════════════════════════════════════════════════════
// ANTI-DETECTION TYPES
// ═══════════════════════════════════════════════════════

export interface AntiDetectionConfig {
  rotateUserAgent: boolean;
  randomizeFingerprint: boolean;
  humanTiming: boolean;
  persistCookies: boolean;
  proxyRotation?: boolean;
}

export interface BrowserProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  platform: string;
  languages: string[];
  timezone: string;
  webgl: string;
  canvas: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    pixelDepth: number;
  };
  hardwareConcurrency: number;
  deviceMemory?: number;
  doNotTrack?: string;
}

export interface RequestHeaders {
  'User-Agent': string;
  'Accept': string;
  'Accept-Language': string;
  'Accept-Encoding': string;
  'Referer'?: string;
  'DNT'?: string;
  'Connection': string;
  'Upgrade-Insecure-Requests'?: string;
  'Sec-Fetch-Dest'?: string;
  'Sec-Fetch-Mode'?: string;
  'Sec-Fetch-Site'?: string;
  'Cache-Control'?: string;
  [key: string]: string | undefined;
}

// ═══════════════════════════════════════════════════════
// REQUEST ORCHESTRATION TYPES
// ═══════════════════════════════════════════════════════

export type RetrievalMethod = 'fetch' | 'puppeteer' | 'firecrawl' | 'external';

export interface RetrievalStrategy {
  method: RetrievalMethod;
  priority: number;
  successRate: number;
  lastUsed: Date;
  avgResponseTime: number;
}

export interface RetrievalRequest {
  url: string;
  options: RequestOptions;
  retryCount: number;
  maxRetries: number;
  fallbackStrategies: RetrievalStrategy[];
  timeout?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Record<string, any>;
  cookies?: Record<string, string>;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  validateSSL?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export interface CircuitBreakerState {
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  state: 'closed' | 'open' | 'half-open';
  openUntil?: Date;
}

// ═══════════════════════════════════════════════════════
// CONTENT EXTRACTION TYPES
// ═══════════════════════════════════════════════════════

export interface ExtractionResult {
  success: boolean;
  data: ExtractedData;
  extractionMethod: string;
  timestamp: Date;
  processingTime: number;
  error?: string;
}

export interface ExtractedData {
  text?: string;
  html?: string;
  structured?: StructuredData;
  links?: ExtractedLink[];
  images?: ExtractedImage[];
  metadata?: PageMetadata;
  hiddenAPIs?: APIEndpoint[];
  tables?: ExtractedTable[];
  forms?: ExtractedForm[];
}

export interface StructuredData {
  jsonLd?: any[];
  microdata?: any[];
  rdfa?: any[];
  openGraph?: Record<string, string>;
  twitterCards?: Record<string, string>;
  schema?: any;
}

export interface ExtractedLink {
  url: string;
  text: string;
  title?: string;
  rel?: string;
  type?: 'internal' | 'external';
  context?: string;
}

export interface ExtractedImage {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  type?: string;
  context?: string;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  publishedDate?: string;
  modifiedDate?: string;
  canonical?: string;
  language?: string;
  charset?: string;
  viewport?: string;
  robots?: string;
}

export interface APIEndpoint {
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload?: any;
  response?: any;
  timestamp: Date;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  context?: string;
}

export interface ExtractedForm {
  action?: string;
  method?: string;
  fields: FormField[];
  context?: string;
}

export interface FormField {
  name: string;
  type: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

// ═══════════════════════════════════════════════════════
// DOMAIN INTELLIGENCE TYPES
// ═══════════════════════════════════════════════════════

export type DefenseType = 'cloudflare' | 'akamai' | 'recaptcha' | 'rate-limit' | 'imperva' | 'datadome' | 'none';

export interface DomainProfile {
  domain: string;
  defenseType?: DefenseType;
  defenseSignatures: string[];
  successfulStrategies: RetrievalStrategy[];
  failedStrategies: RetrievalStrategy[];
  averageResponseTime: number;
  lastSuccessful: Date | null;
  lastAttempt: Date | null;
  blockRate: number;
  totalAttempts: number;
  successfulAttempts: number;
  circuitBreaker: CircuitBreakerState;
  notes: string;
  customConfig?: Record<string, any>;
}

export interface DomainMetrics {
  domain: string;
  requestCount: number;
  successRate: number;
  avgResponseTime: number;
  errorRate: number;
  lastUpdated: Date;
}

// ═══════════════════════════════════════════════════════
// FIRECRAWL INTEGRATION TYPES
// ═══════════════════════════════════════════════════════

export interface FirecrawlConfig {
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
}

export interface FirecrawlOptions {
  formats?: ('markdown' | 'html' | 'rawHtml' | 'screenshot' | 'links')[];
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  headers?: Record<string, string>;
  screenshot?: boolean;
  fullPageScreenshot?: boolean;
}

export interface FirecrawlResult {
  success: boolean;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  screenshot?: string;
  links?: string[];
  metadata?: PageMetadata;
  error?: string;
}

// ═══════════════════════════════════════════════════════
// PUPPETEER INTEGRATION TYPES
// ═══════════════════════════════════════════════════════

export interface PuppeteerConfig {
  headless?: boolean | 'new';
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  args?: string[];
}

export interface PuppeteerOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  waitFor?: number;
  scrollToBottom?: boolean;
  screenshot?: boolean;
  interceptRequests?: boolean;
  executeScript?: string;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
}

export interface PuppeteerResult {
  success: boolean;
  html?: string;
  text?: string;
  screenshot?: Buffer;
  interceptedRequests?: APIEndpoint[];
  cookies?: Array<{ name: string; value: string; domain: string }>;
  error?: string;
}

// ═══════════════════════════════════════════════════════
// MAIN ENGINE TYPES
// ═══════════════════════════════════════════════════════

export interface RetrievalOptions {
  method?: RetrievalMethod;
  preferredMethods?: RetrievalMethod[];
  antiDetection?: Partial<AntiDetectionConfig>;
  retry?: Partial<RetryConfig>;
  extraction?: {
    includeLinks?: boolean;
    includeImages?: boolean;
    includeMetadata?: boolean;
    includeTables?: boolean;
    includeForms?: boolean;
    includeStructuredData?: boolean;
  };
  timeout?: number;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  proxy?: string;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

export interface RetrievalResult {
  success: boolean;
  url: string;
  finalUrl?: string;
  statusCode?: number;
  method: RetrievalMethod;
  data?: ExtractedData;
  error?: string;
  metadata: {
    startTime: Date;
    endTime: Date;
    duration: number;
    retries: number;
    fallbacksUsed: RetrievalMethod[];
  };
  domainProfile?: DomainProfile;
}

export interface BatchRetrievalOptions extends RetrievalOptions {
  maxConcurrent?: number;
  delayBetweenRequests?: number;
  stopOnError?: boolean;
}

export interface BatchRetrievalResult {
  results: RetrievalResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
    avgDuration: number;
  };
}

// ═══════════════════════════════════════════════════════
// UTILITY TYPES
// ═══════════════════════════════════════════════════════

export interface TimingConfig {
  minDelayMs: number;
  maxDelayMs: number;
  distribution: 'uniform' | 'normal' | 'exponential';
}

export interface CookieJar {
  cookies: Map<string, Cookie>;
  setCookie(cookie: Cookie): void;
  getCookies(domain: string): Cookie[];
  clearCookies(domain?: string): void;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ProxyConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  auth?: {
    username: string;
    password: string;
  };
}

// ═══════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════

export class ShadowRetrievalError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ShadowRetrievalError';
  }
}

export class RateLimitError extends ShadowRetrievalError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 'RATE_LIMIT');
  }
}

export class BlockedError extends ShadowRetrievalError {
  constructor(message: string, public defenseType?: DefenseType) {
    super(message, 'BLOCKED');
  }
}

export class TimeoutError extends ShadowRetrievalError {
  constructor(message: string, public timeoutMs?: number) {
    super(message, 'TIMEOUT');
  }
}
