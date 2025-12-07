/**
 * PANTHEON CORE INFRASTRUCTURE (Part 1/4)
 * 
 * Core types and interfaces for the PANTHEON crawler ecosystem.
 * Provides foundational abstractions for entropy harvesting and 
 * adaptive reconnaissance across multiple crawler species.
 */

/**
 * Crawler species identification
 */
export enum CrawlerType {
  WRAITH = 'wraith',   // Ghost layer timing/async harvesting
  HYDRA = 'hydra',     // Adaptive multi-head explorer
  ICE = 'ice',         // Image coordinate extraction (Part 3)
  SPHINX = 'sphinx'    // Knowledge guardian (Part 4)
}

/**
 * Entropy signature - atomic unit of harvested intelligence
 */
export interface EntropySignature {
  id: string;
  type: string;
  source: CrawlerType;
  timestamp: Date;
  entropy: number;        // 0-1 (higher = more valuable)
  metadata: Record<string, any>;
  confidence: number;     // 0-1 (higher = more reliable)
}

/**
 * Crawler task definition
 */
export interface CrawlerTask {
  id: string;
  target: string;         // URL or target identifier
  priority: number;       // 1-10 (higher = more urgent)
  depth?: number;         // Recursion depth limit
  timeout?: number;       // Max execution time (ms)
  metadata?: Record<string, any>;
}

/**
 * Crawler execution result
 */
export interface CrawlerResult {
  taskId: string;
  crawlerType: CrawlerType;
  signatures: EntropySignature[];
  executionTime: number;  // milliseconds
  success: boolean;
  error?: string;
}

/**
 * Timing jitter measurement result
 */
export interface TimingJitterResult {
  avg: number;
  variance: number;
  jitter: number;
  samples: number;
  stability: number;
}

/**
 * Async echo detection result
 */
export interface AsyncEchoResult {
  asyncDetected: boolean;
  serverSignature: string;
  hasAsyncHeader: boolean;
  statusCode: number;
  responseTime: string | null;
  error?: boolean;
}

/**
 * Hydra head exploration result
 */
export interface ExplorationResult {
  target: string;
  richness: number;
  links?: string[];
  nextTarget: string;
  statusCode?: number;
  contentLength?: number;
  error?: boolean;
  errorType?: string;
}
