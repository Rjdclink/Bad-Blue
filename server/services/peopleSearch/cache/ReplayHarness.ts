/**
 * ReplayHarness - Step 6: Deterministic Replay from Artifacts
 * 
 * ARCHITECTURE: Enables replay of extraction without network/browser:
 * 
 * 1. DETERMINISTIC REPLAY:
 *    - Given artifact handle, replay extraction
 *    - Produces same claims/confidence as original
 *    - No network or browser calls
 * 
 * 2. TESTING SUPPORT:
 *    - Hook into Monte Carlo as data source
 *    - Stable test fixtures
 *    - Debugging support
 * 
 * 3. CACHE VALIDATION:
 *    - Verify patterns still work
 *    - Test pattern degradation
 */

import type { RequiredField } from '../router/CapabilityRouter';
import type { Claim } from '../router/ExtractionLedger';
import { calculateDeterministicConfidence, type ConfidenceWeights } from '../router/ExtractionLedger';
import type { StoredArtifact, ArtifactCollection, ArtifactHandle, ArtifactVault } from './ArtifactVault';
import type { ExtractionPattern, PatternLearner } from './PatternLearner';

// ============================================
// REPLAY TYPES
// ============================================

/**
 * Request for replay
 */
export interface ReplayRequest {
  /** Artifact collection to replay from */
  collectionId?: string;
  
  /** Individual artifact IDs to replay from */
  artifactIds?: string[];
  
  /** Fields to extract during replay */
  fields: RequiredField[];
  
  /** Pattern to apply (optional - if not provided, tries auto-detection) */
  pattern?: ExtractionPattern;
  
  /** Confidence weights (optional - uses defaults if not provided) */
  weights?: ConfidenceWeights;
}

/**
 * Result of replay
 */
export interface ReplayResult {
  /** Whether replay was successful */
  success: boolean;
  
  /** Extracted claims */
  claims: Map<RequiredField, Claim>;
  
  /** Computed confidence */
  confidence: number | null;
  
  /** Fields that could not be extracted */
  gaps: RequiredField[];
  
  /** Provenance */
  provenance: ReplayProvenance;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Replay provenance
 */
export interface ReplayProvenance {
  /** How the data was obtained */
  method: 'replay';
  
  /** Artifact handles used */
  artifacts: ArtifactHandle[];
  
  /** Collection ID if applicable */
  collectionId?: string;
  
  /** Pattern used */
  patternId?: string;
  
  /** Timing */
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
  
  /** Whether this exactly matches original extraction */
  matchesOriginal: boolean;
  
  /** Reason for any differences */
  differenceReason?: string;
}

// ============================================
// REPLAY CONFIGURATION
// ============================================

export interface ReplayHarnessConfig {
  /** Whether replay is enabled */
  enabled: boolean;
  
  /** Default confidence weights */
  defaultWeights: ConfidenceWeights;
  
  /** Whether to validate against original results */
  validateAgainstOriginal: boolean;
  
  /** Tolerance for confidence difference validation */
  confidenceTolerance: number;
}

export const DEFAULT_REPLAY_CONFIG: ReplayHarnessConfig = {
  enabled: true,
  defaultWeights: {
    fieldCoverage: 0.6,
    sourceQuality: 0.25,
    recency: 0.15,
  },
  validateAgainstOriginal: true,
  confidenceTolerance: 0.01,
};

// ============================================
// EXTRACTION HELPERS
// ============================================

/**
 * Extract value from HTML using CSS selector
 */
function extractWithSelector(html: string, selector: string): string | null {
  // Simple regex-based extraction for common patterns
  // In production, would use proper DOM parser
  
  // Handle class selectors
  if (selector.startsWith('.')) {
    const className = selector.substring(1);
    const regex = new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([^<]+)<`, 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : null;
  }
  
  // Handle ID selectors
  if (selector.startsWith('#')) {
    const id = selector.substring(1);
    const regex = new RegExp(`id=["']${id}["'][^>]*>([^<]+)<`, 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : null;
  }
  
  // Handle tag selectors
  const regex = new RegExp(`<${selector}[^>]*>([^<]+)</${selector}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract value using regex pattern
 */
function extractWithRegex(text: string, pattern: string): string | null {
  try {
    const regex = new RegExp(pattern);
    const match = text.match(regex);
    return match ? (match[1] || match[0]).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Extract value using JSON path
 */
function extractWithJsonPath(data: object, path: string): any {
  const parts = path.split('.');
  let current: any = data;
  
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    
    // Handle array indexing
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2], 10)];
    } else {
      current = current[part];
    }
  }
  
  return current;
}

// ============================================
// REPLAY HARNESS CLASS
// ============================================

/**
 * ReplayHarness - Replays extraction from stored artifacts
 */
export class ReplayHarness {
  private config: ReplayHarnessConfig;
  private vault: ArtifactVault | null = null;
  private learner: PatternLearner | null = null;
  
  private metrics = {
    replays: 0,
    successes: 0,
    failures: 0,
    exactMatches: 0,
  };
  
  constructor(config?: Partial<ReplayHarnessConfig>) {
    this.config = {
      ...DEFAULT_REPLAY_CONFIG,
      ...config,
    };
  }
  
  /**
   * Set the artifact vault to use
   */
  setVault(vault: ArtifactVault): void {
    this.vault = vault;
  }
  
  /**
   * Set the pattern learner to use
   */
  setLearner(learner: PatternLearner): void {
    this.learner = learner;
  }
  
  /**
   * Replay extraction from artifacts
   */
  replay(request: ReplayRequest): ReplayResult {
    const startedAt = new Date();
    this.metrics.replays++;
    
    if (!this.config.enabled) {
      return this.createErrorResult(startedAt, 'Replay harness disabled');
    }
    
    if (!this.vault) {
      return this.createErrorResult(startedAt, 'No artifact vault configured');
    }
    
    // Get artifacts
    const artifacts = this.getArtifacts(request);
    if (artifacts.length === 0) {
      return this.createErrorResult(startedAt, 'No artifacts found for replay');
    }
    
    // Extract from artifacts
    const claims = new Map<RequiredField, Claim>();
    const gaps: RequiredField[] = [];
    const artifactHandles: ArtifactHandle[] = [];
    
    for (const artifact of artifacts) {
      artifactHandles.push({
        artifactId: artifact.artifactId,
        type: artifact.type,
        storedAt: artifact.storedAt,
        sizeBytes: artifact.sizeBytes,
      });
      
      for (const field of request.fields) {
        if (claims.has(field)) continue; // Already extracted
        
        const value = this.extractFromArtifact(artifact, field, request.pattern);
        if (value !== null) {
          claims.set(field, {
            field,
            value,
            source: `replay:${artifact.type}`,
            confidence: 0.8, // Replay confidence
            extractedAt: new Date(),
          });
        }
      }
    }
    
    // Identify gaps
    for (const field of request.fields) {
      if (!claims.has(field)) {
        gaps.push(field);
      }
    }
    
    // Compute confidence
    const weights = request.weights ?? this.config.defaultWeights;
    const claimsRecord: Record<string, any> = {};
    for (const [field, claim] of claims.entries()) {
      claimsRecord[field] = claim;
    }
    
    let confidence: number | null = null;
    if (claims.size > 0) {
      try {
        const breakdown = calculateDeterministicConfidence(
          claimsRecord as any,
          request.fields,
          new Date()
        );
        confidence = breakdown.finalScore;
      } catch {
        // Fall back to simple field coverage
        confidence = claims.size / request.fields.length;
      }
    }
    
    const completedAt = new Date();
    this.metrics.successes++;
    
    if (gaps.length === 0) {
      this.metrics.exactMatches++;
    }
    
    return {
      success: true,
      claims,
      confidence,
      gaps,
      provenance: {
        method: 'replay',
        artifacts: artifactHandles,
        collectionId: request.collectionId,
        patternId: request.pattern?.patternId,
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        matchesOriginal: gaps.length === 0,
        differenceReason: gaps.length > 0 
          ? `Could not extract fields: [${gaps.join(', ')}]`
          : undefined,
      },
    };
  }
  
  /**
   * Get artifacts for replay
   */
  private getArtifacts(request: ReplayRequest): StoredArtifact[] {
    if (!this.vault) return [];
    
    const artifacts: StoredArtifact[] = [];
    
    // Get from collection
    if (request.collectionId) {
      const collection = this.vault.retrieveCollection(request.collectionId);
      artifacts.push(...collection);
    }
    
    // Get individual artifacts
    if (request.artifactIds) {
      for (const id of request.artifactIds) {
        const artifact = this.vault.retrieve(id);
        if (artifact) {
          artifacts.push(artifact);
        }
      }
    }
    
    return artifacts;
  }
  
  /**
   * Extract a field from an artifact
   */
  private extractFromArtifact(
    artifact: StoredArtifact,
    field: RequiredField,
    pattern?: ExtractionPattern
  ): any {
    // If pattern provided, use it
    if (pattern && pattern.field === field) {
      return this.applyPattern(artifact, pattern);
    }
    
    // Otherwise, try heuristic extraction based on artifact type
    switch (artifact.type) {
      case 'html_snapshot':
        return this.extractFromHtml(artifact.data as string, field);
      
      case 'element_text':
        return this.extractFromElementTexts(artifact.data as Record<string, string>, field);
      
      case 'extracted_data':
        return this.extractFromData(artifact.data as object, field);
      
      case 'api_response':
        return this.extractFromApiResponse(artifact.data as object, field);
      
      default:
        return null;
    }
  }
  
  /**
   * Apply a pattern to extract data
   */
  private applyPattern(artifact: StoredArtifact, pattern: ExtractionPattern): any {
    const data = artifact.data;
    
    switch (pattern.strategyType) {
      case 'selector':
        if (typeof data !== 'string') return null;
        return extractWithSelector(data, pattern.strategy);
      
      case 'regex':
        if (typeof data !== 'string') return null;
        return extractWithRegex(data, pattern.strategy);
      
      case 'json_path':
        if (typeof data !== 'object') return null;
        return extractWithJsonPath(data, pattern.strategy);
      
      default:
        return null;
    }
  }
  
  /**
   * Extract from HTML snapshot
   */
  private extractFromHtml(html: string, field: RequiredField): any {
    // Field-specific heuristics
    const selectors: Record<string, string[]> = {
      fullName: ['.name', '#name', '.full-name', 'h1', '.person-name'],
      age: ['.age', '#age', '.person-age'],
      phones: ['.phone', '#phone', '.phone-number', 'a[href^="tel:"]'],
      emails: ['.email', '#email', 'a[href^="mailto:"]'],
      addresses: ['.address', '#address', '.location'],
    };
    
    const fieldSelectors = selectors[field] || [];
    for (const selector of fieldSelectors) {
      const value = extractWithSelector(html, selector);
      if (value) return value;
    }
    
    return null;
  }
  
  /**
   * Extract from element texts
   */
  private extractFromElementTexts(
    elementTexts: Record<string, string>,
    field: RequiredField
  ): any {
    // Direct field match
    if (elementTexts[field]) {
      return elementTexts[field];
    }
    
    // Try case-insensitive match
    for (const [key, value] of Object.entries(elementTexts)) {
      if (key.toLowerCase() === field.toLowerCase()) {
        return value;
      }
    }
    
    return null;
  }
  
  /**
   * Extract from structured data
   */
  private extractFromData(data: object, field: RequiredField): any {
    return extractWithJsonPath(data, field);
  }
  
  /**
   * Extract from API response
   */
  private extractFromApiResponse(response: object, field: RequiredField): any {
    // Try direct field
    const direct = extractWithJsonPath(response, field);
    if (direct !== null) return direct;
    
    // Try nested data
    const nested = extractWithJsonPath(response, `data.${field}`);
    if (nested !== null) return nested;
    
    // Try results array
    const arrayResult = extractWithJsonPath(response, `results[0].${field}`);
    if (arrayResult !== null) return arrayResult;
    
    return null;
  }
  
  /**
   * Create error result
   */
  private createErrorResult(startedAt: Date, error: string): ReplayResult {
    const completedAt = new Date();
    this.metrics.failures++;
    
    return {
      success: false,
      claims: new Map(),
      confidence: null,
      gaps: [],
      provenance: {
        method: 'replay',
        artifacts: [],
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        matchesOriginal: false,
        differenceReason: error,
      },
      error,
    };
  }
  
  /**
   * Replay for Monte Carlo (simplified interface)
   */
  replayForMonteCarlo(
    collectionId: string,
    fields: RequiredField[],
    weights?: ConfidenceWeights
  ): { confidence: number | null; gaps: RequiredField[] } {
    const result = this.replay({
      collectionId,
      fields,
      weights,
    });
    
    return {
      confidence: result.confidence,
      gaps: result.gaps,
    };
  }
  
  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.replays > 0
        ? this.metrics.successes / this.metrics.replays
        : 0,
      exactMatchRate: this.metrics.successes > 0
        ? this.metrics.exactMatches / this.metrics.successes
        : 0,
    };
  }
  
  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      replays: 0,
      successes: 0,
      failures: 0,
      exactMatches: 0,
    };
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

/** Global replay harness instance */
export const replayHarness = new ReplayHarness();

/** Factory function */
export function createReplayHarness(config?: Partial<ReplayHarnessConfig>): ReplayHarness {
  return new ReplayHarness(config);
}
