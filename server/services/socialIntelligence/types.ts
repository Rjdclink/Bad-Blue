/**
 * PANTHEON Social Intelligence - Type Definitions
 * Types for Sherlock-based username search across 120+ platforms
 */

export interface SherlockSite {
  url: string;
  errorType: 'status_code' | 'message' | 'response_url';
  errorMsg?: string[];
  regexCheck?: string;
  urlProbe?: string;
  requestMethod?: 'GET' | 'POST';
  requestPayload?: Record<string, any>;
  isNSFW?: boolean;
  urlMain?: string;
}

export interface SherlockDatabase {
  version: string;
  source: string;
  lastUpdated: string;
  totalSites: number;
  sites: Record<string, SherlockSite>;
}

export interface SherlockResult {
  platform: string;
  username: string;
  url: string;
  exists: boolean;
  profileData?: {
    displayName?: string;
    bio?: string;
    followers?: number;
    verified?: boolean;
    imageUrl?: string;
  };
  retrievedAt: Date;
  confidence: 'high' | 'medium' | 'low';
  method?: string;
  error?: string;
}

export interface SherlockSearchOptions {
  concurrency?: number; // Default 10
  timeout?: number; // Per-site timeout in ms
  includeProfileData?: boolean; // Extract extra data
  platforms?: string[]; // Specific platforms only
  stealth?: boolean; // Use shadow retrieval (default true)
  retries?: number; // Number of retries per platform
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitized?: string;
}

export interface PlatformRules {
  minLength: number;
  maxLength: number;
  allowedChars: string;
  regex: RegExp;
}

export interface ProfileExtractionRules {
  platform: string;
  selectors: {
    displayName?: string;
    bio?: string;
    followers?: string;
    verified?: string;
    image?: string;
  };
  jsonPath?: string;
}
