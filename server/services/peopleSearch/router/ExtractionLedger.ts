/**
 * ExtractionLedger - Gap Ledger + Deterministic Confidence Scoring (Step 3)
 * 
 * ARCHITECTURE: Implements Step 3 guardrails:
 * 
 * 1. CONTRACT TYPE: Every extraction emits ExtractionResult with:
 *    - claims: Record<field, {value, source, extractedAt}>
 *    - gaps: string[] (missing required fields)
 *    - confidence: number (0-1, deterministic scoring)
 *    - provenance: full audit trail
 * 
 * 2. DETERMINISTIC CONFIDENCE:
 *    - Pure function based on field coverage and source quality
 *    - Reproducible given same inputs
 *    - No randomness or Monte Carlo (that's step 4)
 * 
 * 3. ESCALATION REQUIRES NAMED FIELDS:
 *    - Cannot escalate to higher tier without specifying which fields are missing
 *    - Gap ledger tracks all attempts and reasons
 * 
 * 4. PROVENANCE:
 *    - Every claim has source attribution
 *    - Full timing and tier audit trail
 */

import type { PersonRecord, SearchQuery } from '../types';
import type { CapabilityTier, RequiredField, TierProvenance, RouterResult } from './CapabilityRouter';

// ============================================
// CLAIM TYPES
// ============================================

/**
 * A single extracted claim about a field
 */
export interface FieldClaim {
  /** The extracted value */
  value: unknown;
  
  /** Where this value came from */
  source: string;
  
  /** When this value was extracted */
  extractedAt: Date;
  
  /** Method used to extract (cache, fetch, api, etc.) */
  method: string;
  
  /** Tier that produced this claim */
  tier: CapabilityTier;
  
  /** Confidence in this specific claim (0-1) */
  fieldConfidence: number;
}

/**
 * Claims dictionary - maps field names to their claims
 */
export type ClaimsRecord = Record<RequiredField, FieldClaim | null>;

// ============================================
// GAP TYPES
// ============================================

/**
 * A gap represents a missing required field
 */
export interface GapEntry {
  /** The field that is missing */
  field: RequiredField;
  
  /** Why it's missing */
  reason: string;
  
  /** Tiers that were attempted */
  attemptedTiers: CapabilityTier[];
  
  /** When the gap was recorded */
  recordedAt: Date;
  
  /** Whether escalation might help */
  escalationCandidate: boolean;
}

/**
 * Gap ledger tracks all unresolved fields
 */
export interface GapLedger {
  /** All gaps with their metadata */
  entries: GapEntry[];
  
  /** Fields that require escalation to resolve */
  escalationRequired: RequiredField[];
  
  /** Summary of gap reasons */
  summary: string;
}

// ============================================
// EXTRACTION RESULT CONTRACT
// ============================================

/**
 * ExtractionResult - The core contract type for Step 3
 * 
 * Every extraction MUST emit this structure with:
 * - claims: What was found
 * - gaps: What wasn't found (named fields)
 * - confidence: Deterministic score
 * - provenance: Full audit trail
 */
export interface ExtractionResult {
  /** Unique ID for this extraction */
  extractionId: string;
  
  /** Original query */
  query: SearchQuery;
  
  /** Required fields that were requested */
  requiredFields: RequiredField[];
  
  /** Claims for each field (null if not found) */
  claims: ClaimsRecord;
  
  /** Gap ledger with all missing fields */
  gaps: GapLedger;
  
  /** Deterministic confidence score (0-1) */
  confidence: number;
  
  /** How confidence was calculated */
  confidenceBreakdown: ConfidenceBreakdown;
  
  /** Full provenance/audit trail */
  provenance: ExtractionProvenance;
  
  /** Whether this extraction is complete (all required fields satisfied) */
  complete: boolean;
  
  /** Timestamp */
  timestamp: Date;
}

// ============================================
// CONFIDENCE SCORING
// ============================================

/**
 * Weights for deterministic confidence calculation
 */
export const CONFIDENCE_WEIGHTS = {
  // Field coverage weight (0-0.6)
  fieldCoverage: 0.6,
  
  // Source quality weight (0-0.25)
  sourceQuality: 0.25,
  
  // Recency weight (0-0.15)
  recency: 0.15,
} as const;

/**
 * Source quality scores (deterministic)
 */
export const SOURCE_QUALITY_SCORES: Record<string, number> = {
  'cache': 0.7,        // Cached data - slightly lower (may be stale)
  'api': 0.9,          // Direct API - high quality
  'fetch': 0.8,        // HTTP fetch - good quality
  'light-js': 0.75,    // Light JS parsing - moderate quality
  'unknown': 0.5,      // Unknown source - low confidence
};

/**
 * Field-specific confidence adjustments
 */
export const FIELD_CONFIDENCE_ADJUSTMENTS = {
  /** Penalty for single-part names (e.g., "John" vs "John Smith") */
  SINGLE_NAME_PENALTY: 0.8,
  
  /** Penalty for unreasonable age values */
  UNREASONABLE_AGE_PENALTY: 0.6,
  
  /** Maximum reasonable age for validation */
  MAX_REASONABLE_AGE: 120,
  
  /** Penalty for single-value arrays vs multiple values */
  SINGLE_VALUE_PENALTY: 0.9,
} as const;

/**
 * Breakdown of how confidence was calculated
 */
export interface ConfidenceBreakdown {
  /** Score from field coverage (0-1) */
  fieldCoverageScore: number;
  
  /** Score from source quality (0-1) */
  sourceQualityScore: number;
  
  /** Score from recency (0-1) */
  recencyScore: number;
  
  /** Final weighted score */
  finalScore: number;
  
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Calculate deterministic confidence score
 * 
 * PURE FUNCTION: Same inputs always produce same outputs
 * No randomness, no external state
 */
export function calculateDeterministicConfidence(
  claims: ClaimsRecord,
  requiredFields: RequiredField[],
  referenceTime: Date = new Date()
): ConfidenceBreakdown {
  // 1. Field Coverage Score
  const satisfiedCount = Object.values(claims).filter(c => c !== null).length;
  const totalRequired = requiredFields.length;
  const fieldCoverageScore = totalRequired > 0 ? satisfiedCount / totalRequired : 0;
  
  // 2. Source Quality Score (average of all claims)
  const claimsWithValues = Object.values(claims).filter(c => c !== null) as FieldClaim[];
  const sourceQualityScore = claimsWithValues.length > 0
    ? claimsWithValues.reduce((sum, claim) => {
        const quality = SOURCE_QUALITY_SCORES[claim.method] || SOURCE_QUALITY_SCORES['unknown'];
        return sum + quality;
      }, 0) / claimsWithValues.length
    : 0;
  
  // 3. Recency Score (based on age of claims)
  const ONE_HOUR_MS = 3600000;
  const ONE_DAY_MS = 86400000;
  const recencyScore = claimsWithValues.length > 0
    ? claimsWithValues.reduce((sum, claim) => {
        const ageMs = referenceTime.getTime() - claim.extractedAt.getTime();
        // Fresh (< 1 hour): 1.0, Recent (< 1 day): 0.8, Older: 0.5
        if (ageMs < ONE_HOUR_MS) return sum + 1.0;
        if (ageMs < ONE_DAY_MS) return sum + 0.8;
        return sum + 0.5;
      }, 0) / claimsWithValues.length
    : 0;
  
  // 4. Final weighted score
  const finalScore = 
    (fieldCoverageScore * CONFIDENCE_WEIGHTS.fieldCoverage) +
    (sourceQualityScore * CONFIDENCE_WEIGHTS.sourceQuality) +
    (recencyScore * CONFIDENCE_WEIGHTS.recency);
  
  // 5. Generate explanation
  const explanation = generateConfidenceExplanation(
    fieldCoverageScore,
    sourceQualityScore,
    recencyScore,
    finalScore,
    satisfiedCount,
    totalRequired
  );
  
  return {
    fieldCoverageScore,
    sourceQualityScore,
    recencyScore,
    finalScore,
    explanation,
  };
}

/**
 * Generate human-readable confidence explanation
 */
function generateConfidenceExplanation(
  fieldCoverage: number,
  sourceQuality: number,
  recency: number,
  final: number,
  satisfied: number,
  total: number
): string {
  const parts: string[] = [];
  
  // Field coverage explanation
  if (fieldCoverage === 1) {
    parts.push(`All ${total} required fields found`);
  } else if (fieldCoverage > 0) {
    parts.push(`${satisfied}/${total} required fields found (${Math.round(fieldCoverage * 100)}%)`);
  } else {
    parts.push('No required fields found');
  }
  
  // Source quality explanation
  if (sourceQuality >= 0.9) {
    parts.push('high-quality sources');
  } else if (sourceQuality >= 0.7) {
    parts.push('moderate-quality sources');
  } else if (sourceQuality > 0) {
    parts.push('lower-quality sources');
  }
  
  // Recency explanation
  if (recency >= 0.9) {
    parts.push('fresh data');
  } else if (recency >= 0.7) {
    parts.push('recent data');
  } else if (recency > 0) {
    parts.push('older data');
  }
  
  return `Confidence ${Math.round(final * 100)}%: ${parts.join(', ')}`;
}

// ============================================
// PROVENANCE TYPES
// ============================================

/**
 * Full extraction provenance/audit trail
 */
export interface ExtractionProvenance {
  /** Extraction ID for correlation */
  extractionId: string;
  
  /** When extraction started */
  startedAt: Date;
  
  /** When extraction completed */
  completedAt: Date;
  
  /** Total duration in ms */
  durationMs: number;
  
  /** All tiers that were attempted */
  tiersAttempted: CapabilityTier[];
  
  /** Tier that produced the best result */
  primaryTier: CapabilityTier | null;
  
  /** Per-tier provenance */
  tierProvenance: TierProvenance[];
  
  /** Total cost hint (sum of tier costs) */
  totalCostHint: number;
  
  /** Whether escalation was attempted */
  escalationAttempted: boolean;
  
  /** Reason for final state */
  finalReason: string;
}

// ============================================
// EXTRACTION LEDGER
// ============================================

/**
 * ExtractionLedger - Manages extraction results and gap tracking
 * 
 * Key responsibilities:
 * - Convert RouterResult to ExtractionResult
 * - Calculate deterministic confidence
 * - Build gap ledger with named fields
 * - Track provenance
 */
export class ExtractionLedger {
  private extractionCounter = 0;
  
  /**
   * Generate unique extraction ID
   */
  private generateExtractionId(): string {
    this.extractionCounter++;
    return `ext_${Date.now()}_${this.extractionCounter.toString().padStart(4, '0')}`;
  }
  
  /**
   * Create ExtractionResult from RouterResult
   * 
   * This is the main entry point - converts router output to the
   * Step 3 contract type with deterministic confidence scoring
   */
  createExtractionResult(
    routerResult: RouterResult,
    query: SearchQuery,
    requiredFields: RequiredField[]
  ): ExtractionResult {
    const extractionId = this.generateExtractionId();
    const timestamp = new Date();
    
    // 1. Build claims record from router data
    const claims = this.buildClaimsRecord(routerResult, requiredFields);
    
    // 2. Build gap ledger from router gaps
    const gaps = this.buildGapLedger(routerResult, requiredFields, claims);
    
    // 3. Calculate deterministic confidence
    const confidenceBreakdown = calculateDeterministicConfidence(claims, requiredFields, timestamp);
    
    // 4. Build provenance
    const provenance = this.buildProvenance(extractionId, routerResult, timestamp);
    
    // 5. Determine completeness
    const complete = gaps.entries.length === 0;
    
    return {
      extractionId,
      query,
      requiredFields,
      claims,
      gaps,
      confidence: confidenceBreakdown.finalScore,
      confidenceBreakdown,
      provenance,
      complete,
      timestamp,
    };
  }
  
  /**
   * Build claims record from router result
   */
  private buildClaimsRecord(
    routerResult: RouterResult,
    requiredFields: RequiredField[]
  ): ClaimsRecord {
    const claims: ClaimsRecord = {
      fullName: null,
      age: null,
      addresses: null,
      phones: null,
      emails: null,
      relatives: null,
      aliases: null,
    };
    
    if (!routerResult.data) {
      return claims;
    }
    
    const data = routerResult.data;
    const now = new Date();
    const tier = routerResult.provenance.tier;
    const method = routerResult.provenance.method;
    
    // Map data fields to claims
    for (const field of requiredFields) {
      const value = data[field as keyof typeof data];
      
      if (value !== undefined && value !== null) {
        // Check if value is meaningful
        const isMeaningful = Array.isArray(value) ? value.length > 0 : value !== '';
        
        if (isMeaningful) {
          claims[field] = {
            value,
            source: this.getSourceFromClaims(routerResult.claims, field),
            extractedAt: now,
            method,
            tier,
            fieldConfidence: this.calculateFieldConfidence(field, value, method),
          };
        }
      }
    }
    
    return claims;
  }
  
  /**
   * Extract source description from claims
   */
  private getSourceFromClaims(claims: string[], field: RequiredField): string {
    // Try to find a claim that mentions this field
    const relevantClaim = claims.find(c => 
      c.toLowerCase().includes(field.toLowerCase()) ||
      c.toLowerCase().includes('name') && field === 'fullName'
    );
    
    return relevantClaim || claims[0] || 'unknown';
  }
  
  /**
   * Calculate per-field confidence based on value quality
   */
  private calculateFieldConfidence(
    field: RequiredField,
    value: unknown,
    method: string
  ): number {
    const baseConfidence = SOURCE_QUALITY_SCORES[method] || 0.5;
    
    // Adjust based on field type and value quality
    switch (field) {
      case 'fullName':
        // Higher confidence if name has multiple parts
        if (typeof value === 'string') {
          const parts = value.trim().split(/\s+/).length;
          return parts >= 2 ? baseConfidence : baseConfidence * FIELD_CONFIDENCE_ADJUSTMENTS.SINGLE_NAME_PENALTY;
        }
        break;
        
      case 'age':
        // Higher confidence if age is reasonable
        if (typeof value === 'number') {
          const isReasonable = value > 0 && value < FIELD_CONFIDENCE_ADJUSTMENTS.MAX_REASONABLE_AGE;
          return isReasonable ? baseConfidence : baseConfidence * FIELD_CONFIDENCE_ADJUSTMENTS.UNREASONABLE_AGE_PENALTY;
        }
        break;
        
      case 'addresses':
      case 'phones':
      case 'emails':
        // Higher confidence if we have multiple values
        if (Array.isArray(value)) {
          return value.length > 1 ? baseConfidence : baseConfidence * FIELD_CONFIDENCE_ADJUSTMENTS.SINGLE_VALUE_PENALTY;
        }
        break;
    }
    
    return baseConfidence;
  }
  
  /**
   * Build gap ledger from router result
   */
  private buildGapLedger(
    routerResult: RouterResult,
    requiredFields: RequiredField[],
    claims: ClaimsRecord
  ): GapLedger {
    const entries: GapEntry[] = [];
    const escalationRequired: RequiredField[] = [];
    const now = new Date();
    
    // Check each required field
    for (const field of requiredFields) {
      if (claims[field] === null) {
        // Find the router gap for this field
        const routerGap = routerResult.gaps.find(g => g.field === field);
        
        const entry: GapEntry = {
          field,
          reason: routerGap?.reason || `Field '${field}' not found in any tier`,
          attemptedTiers: routerGap?.attemptedTiers || routerResult.tiersAttempted,
          recordedAt: now,
          escalationCandidate: routerResult.higherTierMayHelp,
        };
        
        entries.push(entry);
        
        // Mark for escalation if higher tier might help
        if (routerResult.higherTierMayHelp) {
          escalationRequired.push(field);
        }
      }
    }
    
    // Generate summary
    const summary = this.generateGapSummary(entries, escalationRequired);
    
    return {
      entries,
      escalationRequired,
      summary,
    };
  }
  
  /**
   * Generate human-readable gap summary
   */
  private generateGapSummary(
    entries: GapEntry[],
    escalationRequired: RequiredField[]
  ): string {
    if (entries.length === 0) {
      return 'All required fields satisfied';
    }
    
    const gapFields = entries.map(e => e.field).join(', ');
    
    if (escalationRequired.length > 0) {
      return `Missing fields: [${gapFields}]. Escalation may resolve: [${escalationRequired.join(', ')}]`;
    }
    
    return `Missing fields: [${gapFields}]. No escalation candidates.`;
  }
  
  /**
   * Build provenance from router result
   */
  private buildProvenance(
    extractionId: string,
    routerResult: RouterResult,
    completedAt: Date
  ): ExtractionProvenance {
    const startedAt = routerResult.provenance.timing.startedAt;
    
    return {
      extractionId,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      tiersAttempted: routerResult.tiersAttempted,
      primaryTier: routerResult.success ? routerResult.provenance.tier : null,
      tierProvenance: [routerResult.provenance],
      totalCostHint: routerResult.provenance.costHint,
      escalationAttempted: false, // Will be updated if escalation happens
      finalReason: routerResult.success 
        ? `Successfully extracted via ${routerResult.provenance.tier}`
        : `Extraction incomplete - ${routerResult.gaps.length} gaps remain`,
    };
  }
  
  /**
   * Check if escalation is allowed and required
   * 
   * GUARDRAIL: Escalation requires named missing fields
   */
  canEscalate(result: ExtractionResult): {
    canEscalate: boolean;
    reason: string;
    requiredFields: RequiredField[];
  } {
    if (result.complete) {
      return {
        canEscalate: false,
        reason: 'Extraction complete - no escalation needed',
        requiredFields: [],
      };
    }
    
    if (result.gaps.escalationRequired.length === 0) {
      return {
        canEscalate: false,
        reason: 'No fields identified as escalation candidates',
        requiredFields: [],
      };
    }
    
    return {
      canEscalate: true,
      reason: `Escalation available for fields: [${result.gaps.escalationRequired.join(', ')}]`,
      requiredFields: result.gaps.escalationRequired,
    };
  }
  
  /**
   * Merge multiple extraction results
   * Useful when combining results from multiple sources
   */
  mergeExtractionResults(
    results: ExtractionResult[],
    query: SearchQuery,
    requiredFields: RequiredField[]
  ): ExtractionResult {
    if (results.length === 0) {
      return this.createEmptyResult(query, requiredFields);
    }
    
    if (results.length === 1) {
      return results[0];
    }
    
    const extractionId = this.generateExtractionId();
    const timestamp = new Date();
    
    // Merge claims - take the one with highest field confidence
    const mergedClaims: ClaimsRecord = {
      fullName: null,
      age: null,
      addresses: null,
      phones: null,
      emails: null,
      relatives: null,
      aliases: null,
    };
    
    for (const field of requiredFields) {
      let bestClaim: FieldClaim | null = null;
      
      for (const result of results) {
        const claim = result.claims[field];
        if (claim !== null) {
          if (bestClaim === null || claim.fieldConfidence > bestClaim.fieldConfidence) {
            bestClaim = claim;
          }
        }
      }
      
      mergedClaims[field] = bestClaim;
    }
    
    // Build new gap ledger
    const gaps = this.buildGapLedgerFromClaims(mergedClaims, requiredFields, results);
    
    // Recalculate confidence
    const confidenceBreakdown = calculateDeterministicConfidence(mergedClaims, requiredFields, timestamp);
    
    // Merge provenance
    const provenance = this.mergeProvenance(extractionId, results, timestamp);
    
    return {
      extractionId,
      query,
      requiredFields,
      claims: mergedClaims,
      gaps,
      confidence: confidenceBreakdown.finalScore,
      confidenceBreakdown,
      provenance,
      complete: gaps.entries.length === 0,
      timestamp,
    };
  }
  
  /**
   * Build gap ledger from merged claims
   */
  private buildGapLedgerFromClaims(
    claims: ClaimsRecord,
    requiredFields: RequiredField[],
    results: ExtractionResult[]
  ): GapLedger {
    const entries: GapEntry[] = [];
    const escalationRequired: RequiredField[] = [];
    const now = new Date();
    
    for (const field of requiredFields) {
      if (claims[field] === null) {
        // Collect all attempted tiers across results
        const attemptedTiers = [...new Set(
          results.flatMap(r => r.provenance.tiersAttempted)
        )];
        
        // Check if any result suggests escalation
        const anyEscalationCandidate = results.some(r => 
          r.gaps.entries.find(g => g.field === field)?.escalationCandidate
        );
        
        entries.push({
          field,
          reason: `Field '${field}' not found after merging ${results.length} results`,
          attemptedTiers,
          recordedAt: now,
          escalationCandidate: anyEscalationCandidate,
        });
        
        if (anyEscalationCandidate) {
          escalationRequired.push(field);
        }
      }
    }
    
    return {
      entries,
      escalationRequired,
      summary: this.generateGapSummary(entries, escalationRequired),
    };
  }
  
  /**
   * Merge provenance from multiple results
   */
  private mergeProvenance(
    extractionId: string,
    results: ExtractionResult[],
    completedAt: Date
  ): ExtractionProvenance {
    const startedAt = results.reduce(
      (earliest, r) => r.provenance.startedAt < earliest ? r.provenance.startedAt : earliest,
      results[0].provenance.startedAt
    );
    
    const tiersAttempted = [...new Set(
      results.flatMap(r => r.provenance.tiersAttempted)
    )];
    
    const tierProvenance = results.flatMap(r => r.provenance.tierProvenance);
    
    const totalCostHint = results.reduce(
      (sum, r) => sum + r.provenance.totalCostHint,
      0
    );
    
    // Find the primary tier (one that produced best confidence)
    const bestResult = results.reduce(
      (best, r) => r.confidence > best.confidence ? r : best,
      results[0]
    );
    
    return {
      extractionId,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      tiersAttempted,
      primaryTier: bestResult.provenance.primaryTier,
      tierProvenance,
      totalCostHint,
      escalationAttempted: results.some(r => r.provenance.escalationAttempted),
      finalReason: `Merged ${results.length} extraction results`,
    };
  }
  
  /**
   * Create an empty result when no data is available
   */
  private createEmptyResult(
    query: SearchQuery,
    requiredFields: RequiredField[]
  ): ExtractionResult {
    const extractionId = this.generateExtractionId();
    const timestamp = new Date();
    
    const claims: ClaimsRecord = {
      fullName: null,
      age: null,
      addresses: null,
      phones: null,
      emails: null,
      relatives: null,
      aliases: null,
    };
    
    const entries: GapEntry[] = requiredFields.map(field => ({
      field,
      reason: 'No extraction results available',
      attemptedTiers: [],
      recordedAt: timestamp,
      escalationCandidate: true,
    }));
    
    return {
      extractionId,
      query,
      requiredFields,
      claims,
      gaps: {
        entries,
        escalationRequired: requiredFields,
        summary: `All ${requiredFields.length} required fields missing - no data available`,
      },
      confidence: 0,
      confidenceBreakdown: {
        fieldCoverageScore: 0,
        sourceQualityScore: 0,
        recencyScore: 0,
        finalScore: 0,
        explanation: 'Confidence 0%: No data extracted',
      },
      provenance: {
        extractionId,
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 0,
        tiersAttempted: [],
        primaryTier: null,
        tierProvenance: [],
        totalCostHint: 0,
        escalationAttempted: false,
        finalReason: 'No extraction results available',
      },
      complete: false,
      timestamp,
    };
  }
}

// Export singleton for convenience
export const extractionLedger = new ExtractionLedger();
