/**
 * 10 RAZORS Type Definitions
 * Fast, specialized crawlers for targeted data extraction
 */

export enum RazorType {
  IDENTITY = 'identity',     // Name/identity extraction
  CONTACT = 'contact',       // Phone/email extraction
  ADDRESS = 'address',       // Location/address extraction
  SOCIAL = 'social',         // Social media profiles
  RECORD = 'record',         // Public records
  ASSET = 'asset',           // Property/asset data
  COURT = 'court',           // Court/legal records
  BUSINESS = 'business',     // Business/corporate data
  RELATION = 'relation',     // Relationships/associates
  MEDIA = 'media',           // News/media mentions
}

export interface RazorResult {
  razorType: RazorType;
  success: boolean;
  data: Record<string, unknown>;
  confidence: number;        // 0-1
  extractionTimeMs: number;
  source?: string;
}

export interface RazorTask {
  id: string;
  target: string;
  razorTypes: RazorType[];   // Which razors to deploy
  timeout: number;           // Max time per razor (ms)
  minConfidence: number;     // Minimum confidence threshold
}

export interface StageResult {
  stage: 1 | 2;
  results: RazorResult[];
  totalTimeMs: number;
  successCount: number;
  promoted: boolean;         // Did we need stage 2?
}
