/**
 * PatternLearner - Step 6: Pattern Learning and Caching
 * 
 * ARCHITECTURE: Implements pattern learning for extraction strategies:
 * 
 * 1. PATTERN RECORDING:
 *    - Records successful strategies per domain/field
 *    - Tracks confidence and quality metrics
 *    - Stores selector/API/parsing recipes that worked
 * 
 * 2. CACHE-FIRST ROUTING:
 *    - Consult cache before expensive tiers
 *    - Apply learned patterns in cheap tiers when safe
 *    - Avoid Playwright on repeat runs
 * 
 * 3. PRIVACY-SAFE:
 *    - No PII persistence by default
 *    - TTL-based expiration
 *    - Domain/field scoped to prevent leakage
 */

import type { RequiredField } from '../router/CapabilityRouter';

// ============================================
// PATTERN TYPES
// ============================================

/**
 * A learned extraction pattern
 */
export interface ExtractionPattern {
  /** Unique pattern ID */
  patternId: string;
  
  /** Domain this pattern applies to */
  domain: string;
  
  /** Field this pattern extracts */
  field: RequiredField;
  
  /** Type of extraction strategy */
  strategyType: 'selector' | 'api' | 'regex' | 'xpath' | 'json_path';
  
  /** The actual strategy (CSS selector, API endpoint, regex, etc.) */
  strategy: string;
  
  /** Additional strategy options */
  options?: Record<string, any>;
  
  /** Quality metrics */
  quality: PatternQuality;
  
  /** When pattern was first learned */
  learnedAt: Date;
  
  /** When pattern was last successfully used */
  lastUsedAt: Date;
  
  /** How many times pattern has been used */
  useCount: number;
  
  /** How many times pattern succeeded */
  successCount: number;
  
  /** TTL for this pattern in milliseconds */
  ttlMs: number;
}

/**
 * Quality metrics for a pattern
 */
export interface PatternQuality {
  /** Average confidence when using this pattern */
  avgConfidence: number;
  
  /** Success rate (successCount / useCount) */
  successRate: number;
  
  /** How consistent the results are (low variance = high consistency) */
  consistency: number;
  
  /** Source tier where pattern was learned */
  sourceTier: string;
}

/**
 * Cache key for pattern lookup
 */
export interface PatternCacheKey {
  domain: string;
  field: RequiredField;
}

/**
 * Result of pattern lookup
 */
export interface PatternLookupResult {
  found: boolean;
  pattern: ExtractionPattern | null;
  reason: string;
  cacheHit: boolean;
}

/**
 * Result of applying a pattern
 */
export interface PatternApplicationResult {
  success: boolean;
  value: any;
  confidence: number;
  pattern: ExtractionPattern;
  error?: string;
}

// ============================================
// PATTERN LEARNER CONFIGURATION
// ============================================

export interface PatternLearnerConfig {
  /** Maximum number of patterns to store */
  maxPatterns: number;
  
  /** Default TTL for patterns in milliseconds */
  defaultTtlMs: number;
  
  /** Minimum confidence to store a pattern */
  minConfidenceToStore: number;
  
  /** Minimum success rate to use a pattern */
  minSuccessRateToUse: number;
  
  /** Whether to store patterns (can disable for privacy) */
  enabled: boolean;
  
  /** Whether to persist patterns to disk */
  persistToDisk: boolean;
  
  /** Path for disk persistence */
  persistPath?: string;
}

export const DEFAULT_PATTERN_LEARNER_CONFIG: PatternLearnerConfig = {
  maxPatterns: 1000,
  defaultTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  minConfidenceToStore: 0.6,
  minSuccessRateToUse: 0.7,
  enabled: true,
  persistToDisk: false,
};

// ============================================
// PATTERN LEARNER CLASS
// ============================================

/**
 * PatternLearner - Learns and caches extraction patterns
 * 
 * Key design principles:
 * - No PII stored (only extraction strategies)
 * - Domain/field scoped to prevent cross-site leakage
 * - TTL-based expiration
 * - Quality-based pattern selection
 */
export class PatternLearner {
  private config: PatternLearnerConfig;
  private patterns: Map<string, ExtractionPattern> = new Map();
  private metrics = {
    lookups: 0,
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    applications: 0,
    applicationSuccesses: 0,
  };
  
  constructor(config?: Partial<PatternLearnerConfig>) {
    this.config = {
      ...DEFAULT_PATTERN_LEARNER_CONFIG,
      ...config,
    };
  }
  
  /**
   * Generate cache key from domain and field
   */
  private generateKey(domain: string, field: RequiredField): string {
    return `${domain}::${field}`;
  }
  
  /**
   * Generate unique pattern ID
   */
  private generatePatternId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `pat_${timestamp}_${random}`;
  }
  
  /**
   * Check if a pattern is expired
   */
  private isExpired(pattern: ExtractionPattern): boolean {
    const age = Date.now() - pattern.learnedAt.getTime();
    return age > pattern.ttlMs;
  }
  
  /**
   * Check if a pattern meets quality thresholds for use
   */
  private meetsQualityThreshold(pattern: ExtractionPattern): boolean {
    return pattern.quality.successRate >= this.config.minSuccessRateToUse;
  }
  
  /**
   * Look up a pattern for domain/field
   */
  lookup(key: PatternCacheKey): PatternLookupResult {
    this.metrics.lookups++;
    
    if (!this.config.enabled) {
      return {
        found: false,
        pattern: null,
        reason: 'Pattern learner disabled',
        cacheHit: false,
      };
    }
    
    const cacheKey = this.generateKey(key.domain, key.field);
    const pattern = this.patterns.get(cacheKey);
    
    if (!pattern) {
      this.metrics.misses++;
      return {
        found: false,
        pattern: null,
        reason: `No pattern found for ${key.domain}::${key.field}`,
        cacheHit: false,
      };
    }
    
    // Check expiration
    if (this.isExpired(pattern)) {
      this.patterns.delete(cacheKey);
      this.metrics.evictions++;
      this.metrics.misses++;
      return {
        found: false,
        pattern: null,
        reason: `Pattern expired for ${key.domain}::${key.field}`,
        cacheHit: false,
      };
    }
    
    // Check quality threshold
    if (!this.meetsQualityThreshold(pattern)) {
      this.metrics.misses++;
      return {
        found: false,
        pattern: null,
        reason: `Pattern quality below threshold (${pattern.quality.successRate.toFixed(2)} < ${this.config.minSuccessRateToUse})`,
        cacheHit: false,
      };
    }
    
    this.metrics.hits++;
    return {
      found: true,
      pattern,
      reason: `Cache hit for ${key.domain}::${key.field}`,
      cacheHit: true,
    };
  }
  
  /**
   * Store a learned pattern
   */
  store(pattern: Omit<ExtractionPattern, 'patternId' | 'learnedAt' | 'lastUsedAt' | 'useCount' | 'successCount' | 'ttlMs'>): ExtractionPattern | null {
    if (!this.config.enabled) {
      return null;
    }
    
    // Check minimum confidence
    if (pattern.quality.avgConfidence < this.config.minConfidenceToStore) {
      return null;
    }
    
    // Evict if at capacity
    if (this.patterns.size >= this.config.maxPatterns) {
      this.evictLeastUsed();
    }
    
    const now = new Date();
    const fullPattern: ExtractionPattern = {
      ...pattern,
      patternId: this.generatePatternId(),
      learnedAt: now,
      lastUsedAt: now,
      useCount: 1,
      successCount: 1,
      ttlMs: this.config.defaultTtlMs,
    };
    
    const cacheKey = this.generateKey(pattern.domain, pattern.field);
    this.patterns.set(cacheKey, fullPattern);
    this.metrics.stores++;
    
    return fullPattern;
  }
  
  /**
   * Update pattern after use
   */
  recordUse(key: PatternCacheKey, success: boolean, confidence?: number): void {
    const cacheKey = this.generateKey(key.domain, key.field);
    const pattern = this.patterns.get(cacheKey);
    
    if (!pattern) return;
    
    pattern.useCount++;
    if (success) {
      pattern.successCount++;
    }
    pattern.lastUsedAt = new Date();
    
    // Update quality metrics
    pattern.quality.successRate = pattern.successCount / pattern.useCount;
    if (confidence !== undefined) {
      // Running average of confidence
      const alpha = 0.2; // Smoothing factor
      pattern.quality.avgConfidence = alpha * confidence + (1 - alpha) * pattern.quality.avgConfidence;
    }
    
    this.metrics.applications++;
    if (success) {
      this.metrics.applicationSuccesses++;
    }
  }
  
  /**
   * Evict the least recently used pattern
   */
  private evictLeastUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, pattern] of this.patterns.entries()) {
      if (pattern.lastUsedAt.getTime() < oldestTime) {
        oldestTime = pattern.lastUsedAt.getTime();
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.patterns.delete(oldestKey);
      this.metrics.evictions++;
    }
  }
  
  /**
   * Learn a pattern from successful extraction
   */
  learnFromSuccess(
    domain: string,
    field: RequiredField,
    strategyType: ExtractionPattern['strategyType'],
    strategy: string,
    confidence: number,
    sourceTier: string,
    options?: Record<string, any>
  ): ExtractionPattern | null {
    return this.store({
      domain,
      field,
      strategyType,
      strategy,
      options,
      quality: {
        avgConfidence: confidence,
        successRate: 1.0, // Initial success rate
        consistency: 1.0, // Initial consistency
        sourceTier,
      },
    });
  }
  
  /**
   * Get all patterns for a domain
   */
  getPatternsForDomain(domain: string): ExtractionPattern[] {
    const patterns: ExtractionPattern[] = [];
    
    for (const pattern of this.patterns.values()) {
      if (pattern.domain === domain && !this.isExpired(pattern)) {
        patterns.push(pattern);
      }
    }
    
    return patterns;
  }
  
  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      patternCount: this.patterns.size,
      hitRate: this.metrics.lookups > 0 
        ? this.metrics.hits / this.metrics.lookups 
        : 0,
      applicationSuccessRate: this.metrics.applications > 0
        ? this.metrics.applicationSuccesses / this.metrics.applications
        : 0,
    };
  }
  
  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
  }
  
  /**
   * Export patterns for persistence
   */
  export(): ExtractionPattern[] {
    return Array.from(this.patterns.values()).filter(p => !this.isExpired(p));
  }
  
  /**
   * Import patterns from persistence
   */
  import(patterns: ExtractionPattern[]): void {
    for (const pattern of patterns) {
      if (!this.isExpired(pattern)) {
        const key = this.generateKey(pattern.domain, pattern.field);
        this.patterns.set(key, pattern);
      }
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

/** Global pattern learner instance */
export const patternLearner = new PatternLearner();

/** Factory function */
export function createPatternLearner(config?: Partial<PatternLearnerConfig>): PatternLearner {
  return new PatternLearner(config);
}
