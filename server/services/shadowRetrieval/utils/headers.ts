/**
 * PANTHEON Shadow Retrieval - HTTP Header Generation
 * Create realistic HTTP headers to avoid detection
 */

import type { RequestHeaders } from '../types';

/**
 * Generate Accept header based on request type
 */
export function generateAcceptHeader(type: 'html' | 'json' | 'image' | 'any' = 'html'): string {
  switch (type) {
    case 'html':
      return 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
    case 'json':
      return 'application/json, text/plain, */*';
    case 'image':
      return 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
    case 'any':
      return '*/*';
    default:
      return 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }
}

/**
 * Generate Accept-Language header with common variations
 */
export function generateAcceptLanguageHeader(): string {
  const languages = [
    'en-US,en;q=0.9',
    'en-GB,en;q=0.9',
    'en-US,en;q=0.9,es;q=0.8',
    'en-US,en;q=0.9,fr;q=0.8',
    'en-GB,en;q=0.9,de;q=0.8',
    'en-CA,en;q=0.9,fr-CA;q=0.8',
    'en-AU,en;q=0.9',
    'en-US,en;q=0.9,zh-CN;q=0.8',
  ];
  
  return languages[Math.floor(Math.random() * languages.length)];
}

/**
 * Generate Accept-Encoding header
 */
export function generateAcceptEncodingHeader(): string {
  const encodings = [
    'gzip, deflate, br',
    'gzip, deflate, br, zstd',
    'gzip, deflate',
  ];
  
  return encodings[Math.floor(Math.random() * encodings.length)];
}

/**
 * Generate Cache-Control header
 */
export function generateCacheControlHeader(): string {
  const cacheControls = [
    'max-age=0',
    'no-cache',
    'max-age=3600',
    undefined,
  ];
  
  return cacheControls[Math.floor(Math.random() * cacheControls.length)];
}

/**
 * Generate Sec-Fetch headers (Chrome/Edge)
 */
export function generateSecFetchHeaders(
  destination: 'document' | 'empty' | 'image' | 'script' | 'style' = 'document',
  mode: 'navigate' | 'cors' | 'no-cors' | 'same-origin' = 'navigate',
  site: 'none' | 'same-origin' | 'same-site' | 'cross-site' = 'none'
): Partial<RequestHeaders> {
  return {
    'Sec-Fetch-Dest': destination,
    'Sec-Fetch-Mode': mode,
    'Sec-Fetch-Site': site,
    'Sec-Fetch-User': '?1',
  };
}

/**
 * Generate realistic Referer based on target URL
 */
export function generateReferer(targetUrl: string, previousUrl?: string): string | undefined {
  if (previousUrl) {
    return previousUrl;
  }
  
  try {
    const url = new URL(targetUrl);
    
    // Common referrer patterns
    const patterns = [
      `https://www.google.com/search?q=${encodeURIComponent(url.hostname)}`,
      `https://www.bing.com/search?q=${encodeURIComponent(url.hostname)}`,
      `https://duckduckgo.com/?q=${encodeURIComponent(url.hostname)}`,
      `${url.protocol}//${url.hostname}/`,
      undefined, // Direct navigation (no referer)
    ];
    
    return patterns[Math.floor(Math.random() * patterns.length)];
  } catch {
    return undefined;
  }
}

/**
 * Generate complete request headers
 */
export function generateRequestHeaders(
  userAgent: string,
  targetUrl?: string,
  options: {
    includeReferer?: boolean;
    includeSecFetch?: boolean;
    acceptType?: 'html' | 'json' | 'image' | 'any';
    customHeaders?: Record<string, string>;
  } = {}
): RequestHeaders {
  const {
    includeReferer = true,
    includeSecFetch = true,
    acceptType = 'html',
    customHeaders = {},
  } = options;
  
  const headers: RequestHeaders = {
    'User-Agent': userAgent,
    'Accept': generateAcceptHeader(acceptType),
    'Accept-Language': generateAcceptLanguageHeader(),
    'Accept-Encoding': generateAcceptEncodingHeader(),
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };
  
  // Add DNT if needed
  if (Math.random() > 0.7) {
    headers['DNT'] = '1';
  }
  
  // Add Cache-Control if needed
  const cacheControl = generateCacheControlHeader();
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }
  
  // Add Referer if requested and URL provided
  if (includeReferer && targetUrl) {
    const referer = generateReferer(targetUrl);
    if (referer) {
      headers['Referer'] = referer;
    }
  }
  
  // Add Sec-Fetch headers if requested
  if (includeSecFetch) {
    Object.assign(headers, generateSecFetchHeaders());
  }
  
  // Merge custom headers (overrides defaults)
  Object.assign(headers, customHeaders);
  
  // Remove undefined values
  Object.keys(headers).forEach(key => {
    if (headers[key] === undefined) {
      delete headers[key];
    }
  });
  
  return headers;
}

/**
 * Generate headers for API requests (JSON)
 */
export function generateAPIHeaders(
  userAgent: string,
  apiUrl: string,
  customHeaders: Record<string, string> = {}
): RequestHeaders {
  return generateRequestHeaders(userAgent, apiUrl, {
    includeReferer: true,
    includeSecFetch: true,
    acceptType: 'json',
    customHeaders: {
      'Content-Type': 'application/json',
      ...customHeaders,
    },
  });
}

/**
 * Generate headers for form submissions
 */
export function generateFormHeaders(
  userAgent: string,
  formUrl: string,
  customHeaders: Record<string, string> = {}
): RequestHeaders {
  return generateRequestHeaders(userAgent, formUrl, {
    includeReferer: true,
    includeSecFetch: true,
    acceptType: 'html',
    customHeaders: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': new URL(formUrl).origin,
      ...customHeaders,
    },
  });
}

/**
 * Generate headers for AJAX requests
 */
export function generateAJAXHeaders(
  userAgent: string,
  ajaxUrl: string,
  customHeaders: Record<string, string> = {}
): RequestHeaders {
  return generateRequestHeaders(userAgent, ajaxUrl, {
    includeReferer: true,
    includeSecFetch: true,
    acceptType: 'json',
    customHeaders: {
      'X-Requested-With': 'XMLHttpRequest',
      ...customHeaders,
    },
  });
}

/**
 * Randomize header order (some fingerprinting detects consistent order)
 */
export function randomizeHeaderOrder(headers: RequestHeaders): Record<string, string> {
  const entries = Object.entries(headers);
  
  // Fisher-Yates shuffle
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  
  return Object.fromEntries(entries);
}

/**
 * Get browser-specific header patterns
 */
export function getBrowserHeaderPattern(browser: 'chrome' | 'firefox' | 'safari' | 'edge'): {
  includeSecFetch: boolean;
  includeDNT: boolean;
  connectionType: string;
} {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return {
        includeSecFetch: true,
        includeDNT: true,
        connectionType: 'keep-alive',
      };
    case 'firefox':
      return {
        includeSecFetch: false,
        includeDNT: true,
        connectionType: 'keep-alive',
      };
    case 'safari':
      return {
        includeSecFetch: false,
        includeDNT: false,
        connectionType: 'keep-alive',
      };
    default:
      return {
        includeSecFetch: true,
        includeDNT: true,
        connectionType: 'keep-alive',
      };
  }
}

/**
 * Add common optional headers based on context
 */
export function addContextualHeaders(
  headers: RequestHeaders,
  context: {
    isFirstRequest?: boolean;
    isAjax?: boolean;
    isAPI?: boolean;
    hasAuth?: boolean;
    authToken?: string;
  }
): RequestHeaders {
  const newHeaders = { ...headers };
  
  if (context.isFirstRequest) {
    newHeaders['Cache-Control'] = 'max-age=0';
  }
  
  if (context.isAjax) {
    newHeaders['X-Requested-With'] = 'XMLHttpRequest';
  }
  
  if (context.isAPI) {
    newHeaders['Accept'] = 'application/json, text/plain, */*';
  }
  
  if (context.hasAuth && context.authToken) {
    newHeaders['Authorization'] = `Bearer ${context.authToken}`;
  }
  
  return newHeaders;
}

/**
 * Validate headers look realistic
 */
export function validateHeaders(headers: RequestHeaders): boolean {
  // Must have User-Agent
  if (!headers['User-Agent']) {
    return false;
  }
  
  // Must have Accept
  if (!headers['Accept']) {
    return false;
  }
  
  // Accept-Language should be present
  if (!headers['Accept-Language']) {
    return false;
  }
  
  // Accept-Encoding should be present
  if (!headers['Accept-Encoding']) {
    return false;
  }
  
  return true;
}
