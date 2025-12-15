/**
 * CapabilityRouter - Cheap-first tier routing for People Search
 * 
 * ARCHITECTURE: Implements Step 2 guardrails:
 * 
 * 1. TIER DEFINITIONS (T0-T3, cheap only, no browser):
 *    - T0: Static/embedded state (cached, pre-known data)
 *    - T1: Fetch/parse (HTTP GET + HTML/JSON parse)
 *    - T2: API replay/light-JS (no full browser; minimal DOM parsing)
 *    - T3: Light JS execution (if available without headless browser)
 * 
 * 2. CHEAP-FIRST ROUTING:
 *    - Routes through cheapest viable tier first
 *    - Stops on success
 *    - Records chosen tier, cost hints, and outcome
 * 
 * 3. NO HAMMER GUARDRAIL:
 *    - Caps retries per tier
 *    - Disallows escalating to browser tier (Playwright comes in later step)
 * 
 * 4. STRUCTURED RESULTS:
 *    - {claims, confidence, provenance: {tier, method, url, timing}, gaps}
 */

import type { PersonRecord, SearchQuery } from '../types';

// ============================================
// TIER DEFINITIONS
// ============================================

/**
 * Capability tiers - cheapest to most expensive
 * NOTE: T4+ (browser/Playwright) are NOT implemented here - they come later
 */
export enum CapabilityTier {
  /** T0: Static/embedded state - cached or pre-known data */
  T0_STATIC = 'T0_STATIC',
  
  /** T1: Fetch/parse - HTTP GET + HTML/JSON parsing */
  T1_FETCH_PARSE = 'T1_FETCH_PARSE',
  
  /** T2: API replay - REST APIs, no browser, minimal JS */
  T2_API_REPLAY = 'T2_API_REPLAY',
  
  /** T3: Light JS - Minimal JS execution without full browser */
  T3_LIGHT_JS = 'T3_LIGHT_JS',
  
  // T4+ (BROWSER/PLAYWRIGHT) - NOT IMPLEMENTED IN THIS STEP
  // These are placeholders to show the full ladder
  // T4_HEADLESS_BROWSER = 'T4_HEADLESS_BROWSER',
  // T5_FULL_BROWSER = 'T5_FULL_BROWSER',
}

/**
 * Cost hints for each tier (relative scale 0-100)
 */
export const TIER_COSTS: Record<CapabilityTier, number> = {
  [CapabilityTier.T0_STATIC]: 0,
  [CapabilityTier.T1_FETCH_PARSE]: 10,
  [CapabilityTier.T2_API_REPLAY]: 25,
  [CapabilityTier.T3_LIGHT_JS]: 40,
};

/**
 * Maximum retries per tier
 */
export const TIER_MAX_RETRIES: Record<CapabilityTier, number> = {
  [CapabilityTier.T0_STATIC]: 1,
  [CapabilityTier.T1_FETCH_PARSE]: 2,
  [CapabilityTier.T2_API_REPLAY]: 2,
  [CapabilityTier.T3_LIGHT_JS]: 1,
};

// ============================================
// REQUEST DESCRIPTOR
// ============================================

/**
 * Required fields that a search result must have
 */
export type RequiredField = 
  | 'fullName'
  | 'age'
  | 'addresses'
  | 'phones'
  | 'emails'
  | 'relatives'
  | 'aliases';

/**
 * Request descriptor for routing
 */
export interface RequestDescriptor {
  /** Goal description for logging/debugging */
  goal: string;
  
  /** Search parameters */
  query: SearchQuery;
  
  /** Fields that must be present in the result */
  requiredFields: RequiredField[];
  
  /** Optional: Maximum tier to try (defaults to T3) */
  maxTier?: CapabilityTier;
  
  /** Optional: Timeout in ms for each tier attempt */
  timeoutMs?: number;
}

// ============================================
// RESULT TYPES
// ============================================

/**
 * Provenance for tracking how data was obtained
 */
export interface TierProvenance {
  tier: CapabilityTier;
  method: 'cache' | 'fetch' | 'api' | 'light-js';
  url?: string;
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
  retryCount: number;
  costHint: number;
}

/**
 * Gap - a required field that couldn't be satisfied
 */
export interface ResultGap {
  field: RequiredField;
  reason: string;
  attemptedTiers: CapabilityTier[];
}

/**
 * Router result with full provenance
 */
export interface RouterResult {
  success: boolean;
  
  /** Partial or complete person record */
  data: Partial<PersonRecord> | null;
  
  /** Claims about the data found */
  claims: string[];
  
  /** Confidence score (0-1), placeholder for step 3 */
  confidence: number | null;
  
  /** How the data was obtained */
  provenance: TierProvenance;
  
  /** Fields that couldn't be satisfied */
  gaps: ResultGap[];
  
  /** All tiers that were attempted */
  tiersAttempted: CapabilityTier[];
  
  /** Whether a higher tier could potentially satisfy gaps */
  higherTierMayHelp: boolean;
}

// ============================================
// TIER HANDLERS
// ============================================

/**
 * Handler for a capability tier
 */
export interface TierHandler {
  tier: CapabilityTier;
  
  /** Which fields this handler can potentially provide */
  providesFields: RequiredField[];
  
  /** Execute the tier's capability */
  execute(
    query: SearchQuery,
    requiredFields: RequiredField[],
    timeoutMs: number
  ): Promise<TierExecutionResult>;
}

/**
 * Result of executing a single tier
 */
export interface TierExecutionResult {
  success: boolean;
  data: Partial<PersonRecord> | null;
  claims: string[];
  satisfiedFields: RequiredField[];
  unsatisfiedFields: RequiredField[];
  error?: string;
}

// ============================================
// BUILT-IN TIER HANDLERS
// ============================================

/**
 * T0: Static/Cache Handler
 * Checks cache for previously fetched data
 */
class T0StaticHandler implements TierHandler {
  tier = CapabilityTier.T0_STATIC;
  providesFields: RequiredField[] = ['fullName', 'age', 'addresses', 'phones', 'emails', 'relatives', 'aliases'];
  
  private cache: Map<string, { data: Partial<PersonRecord>; timestamp: number }> = new Map();
  private cacheTtlMs = 3600000; // 1 hour
  
  async execute(
    query: SearchQuery,
    requiredFields: RequiredField[],
    _timeoutMs: number
  ): Promise<TierExecutionResult> {
    const cacheKey = this.buildCacheKey(query);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      const satisfiedFields = this.checkSatisfiedFields(cached.data, requiredFields);
      const unsatisfiedFields = requiredFields.filter(f => !satisfiedFields.includes(f));
      
      return {
        success: satisfiedFields.length > 0,
        data: cached.data,
        claims: [`Retrieved from cache (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`],
        satisfiedFields,
        unsatisfiedFields,
      };
    }
    
    return {
      success: false,
      data: null,
      claims: [],
      satisfiedFields: [],
      unsatisfiedFields: requiredFields,
      error: 'No cached data available',
    };
  }
  
  /** Add data to cache (called after successful fetches) */
  cacheResult(query: SearchQuery, data: Partial<PersonRecord>): void {
    const cacheKey = this.buildCacheKey(query);
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
  }
  
  private buildCacheKey(query: SearchQuery): string {
    // Use JSON serialization to avoid collisions from delimiter ambiguity
    // e.g., "John-Jane" + "Doe" vs "John" + "Jane-Doe" would collide with simple delimiter
    return JSON.stringify({
      fn: query.firstName.toLowerCase(),
      ln: query.lastName.toLowerCase(),
      city: (query.city || '').toLowerCase(),
      state: (query.state || '').toLowerCase(),
    });
  }
  
  private checkSatisfiedFields(data: Partial<PersonRecord>, required: RequiredField[]): RequiredField[] {
    const satisfied: RequiredField[] = [];
    
    for (const field of required) {
      const value = data[field];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length > 0) {
          satisfied.push(field);
        } else if (!Array.isArray(value) && value !== '') {
          satisfied.push(field);
        }
      }
    }
    
    return satisfied;
  }
}

/**
 * T1: Fetch/Parse Handler
 * Uses HTTP fetch with HTML/JSON parsing (no browser)
 */
class T1FetchParseHandler implements TierHandler {
  tier = CapabilityTier.T1_FETCH_PARSE;
  providesFields: RequiredField[] = ['fullName', 'age', 'addresses', 'phones'];
  
  async execute(
    query: SearchQuery,
    requiredFields: RequiredField[],
    timeoutMs: number
  ): Promise<TierExecutionResult> {
    // NOTE: In production, this would make actual HTTP requests
    // For now, we simulate the capability without external calls
    
    const canProvide = requiredFields.filter(f => this.providesFields.includes(f));
    
    // Simulate basic data that could be fetched from public APIs
    const data: Partial<PersonRecord> = {
      fullName: `${query.firstName} ${query.lastName}`,
    };
    
    // If we have location info, we can potentially provide addresses
    if (query.city && query.state && canProvide.includes('addresses')) {
      data.addresses = [{
        street: '',
        city: query.city,
        state: query.state,
        zip: '',
      }];
    }
    
    const satisfiedFields: RequiredField[] = [];
    if (data.fullName) satisfiedFields.push('fullName');
    if (data.addresses && data.addresses.length > 0) satisfiedFields.push('addresses');
    
    const unsatisfiedFields = requiredFields.filter(f => !satisfiedFields.includes(f));
    
    return {
      success: satisfiedFields.length > 0,
      data,
      claims: [
        `Constructed name from query: ${data.fullName}`,
        ...(data.addresses ? [`Location hint: ${query.city}, ${query.state}`] : []),
      ],
      satisfiedFields,
      unsatisfiedFields,
    };
  }
}

/**
 * T2: API Replay Handler
 * Uses REST APIs without browser (JSON endpoints, etc.)
 */
class T2ApiReplayHandler implements TierHandler {
  tier = CapabilityTier.T2_API_REPLAY;
  providesFields: RequiredField[] = ['fullName', 'age', 'addresses', 'phones', 'emails'];
  
  async execute(
    query: SearchQuery,
    requiredFields: RequiredField[],
    timeoutMs: number
  ): Promise<TierExecutionResult> {
    // NOTE: In production, this would call actual APIs
    // For now, we simulate the capability
    
    const data: Partial<PersonRecord> = {
      fullName: `${query.firstName} ${query.lastName}`,
    };
    
    if (query.age) {
      data.age = query.age;
    }
    
    const satisfiedFields: RequiredField[] = ['fullName'];
    if (data.age) satisfiedFields.push('age');
    
    const unsatisfiedFields = requiredFields.filter(f => !satisfiedFields.includes(f));
    
    return {
      success: satisfiedFields.length > 0,
      data,
      claims: [
        `API lookup for: ${data.fullName}`,
        ...(data.age ? [`Age from query: ${data.age}`] : []),
      ],
      satisfiedFields,
      unsatisfiedFields,
    };
  }
}

/**
 * T3: Light JS Handler
 * Minimal JS execution without full browser
 * NOTE: In practice, this might use a lightweight JS runtime like quickjs
 */
class T3LightJsHandler implements TierHandler {
  tier = CapabilityTier.T3_LIGHT_JS;
  providesFields: RequiredField[] = ['fullName', 'age', 'addresses', 'phones', 'emails', 'relatives'];
  
  async execute(
    query: SearchQuery,
    requiredFields: RequiredField[],
    timeoutMs: number
  ): Promise<TierExecutionResult> {
    // NOTE: This tier is OPTIONAL and cheap
    // It does NOT use Playwright or a full browser
    // In production, it might use a lightweight JS sandbox
    
    const data: Partial<PersonRecord> = {
      fullName: `${query.firstName} ${query.lastName}`,
    };
    
    if (query.age) {
      data.age = query.age;
    }
    
    if (query.city && query.state) {
      data.addresses = [{
        street: '',
        city: query.city,
        state: query.state,
        zip: '',
      }];
    }
    
    const satisfiedFields: RequiredField[] = ['fullName'];
    if (data.age) satisfiedFields.push('age');
    if (data.addresses && data.addresses.length > 0) satisfiedFields.push('addresses');
    
    const unsatisfiedFields = requiredFields.filter(f => !satisfiedFields.includes(f));
    
    return {
      success: satisfiedFields.length > 0,
      data,
      claims: [
        `Light JS processing for: ${data.fullName}`,
        'No browser used - lightweight execution only',
      ],
      satisfiedFields,
      unsatisfiedFields,
    };
  }
}

// ============================================
// CAPABILITY ROUTER
// ============================================

/**
 * Router metrics for monitoring
 */
export interface RouterMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  tierUsage: Record<CapabilityTier, number>;
  averageTierCost: number;
  lastRequestAt: Date | null;
}

/**
 * CapabilityRouter - Routes requests through cheapest viable tier
 * 
 * Key design principles:
 * - No side effects in constructor
 * - Cheap-first routing
 * - No browser/Playwright calls (those come in later steps)
 * - Caps retries - no hammering
 * - Returns gaps instead of throwing
 */
export class CapabilityRouter {
  private handlers: Map<CapabilityTier, TierHandler> = new Map();
  private t0Handler: T0StaticHandler;
  
  private static metrics: RouterMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    tierUsage: {
      [CapabilityTier.T0_STATIC]: 0,
      [CapabilityTier.T1_FETCH_PARSE]: 0,
      [CapabilityTier.T2_API_REPLAY]: 0,
      [CapabilityTier.T3_LIGHT_JS]: 0,
    },
    averageTierCost: 0,
    lastRequestAt: null,
  };
  
  /**
   * Constructor - NO SIDE EFFECTS
   * Registers built-in handlers but doesn't initialize resources
   */
  constructor() {
    // Register built-in handlers
    this.t0Handler = new T0StaticHandler();
    this.handlers.set(CapabilityTier.T0_STATIC, this.t0Handler);
    this.handlers.set(CapabilityTier.T1_FETCH_PARSE, new T1FetchParseHandler());
    this.handlers.set(CapabilityTier.T2_API_REPLAY, new T2ApiReplayHandler());
    this.handlers.set(CapabilityTier.T3_LIGHT_JS, new T3LightJsHandler());
  }
  
  /**
   * Route a request through the capability ladder
   * 
   * @param descriptor - Request descriptor with goal and required fields
   * @returns Structured result with provenance and gaps
   */
  async route(descriptor: RequestDescriptor): Promise<RouterResult> {
    const startedAt = new Date();
    CapabilityRouter.metrics.totalRequests++;
    CapabilityRouter.metrics.lastRequestAt = new Date();
    
    const {
      query,
      requiredFields,
      maxTier = CapabilityTier.T3_LIGHT_JS,
      timeoutMs = 5000,
    } = descriptor;
    
    // Get ordered tiers up to maxTier
    const tiersToTry = this.getTiersUpTo(maxTier);
    const tiersAttempted: CapabilityTier[] = [];
    const allGaps: ResultGap[] = [];
    
    let bestResult: TierExecutionResult | null = null;
    let bestProvenance: TierProvenance | null = null;
    let remainingFields = [...requiredFields];
    
    // Try each tier in order (cheapest first)
    for (const tier of tiersToTry) {
      const handler = this.handlers.get(tier);
      if (!handler) continue;
      
      // Check if this tier can provide any remaining fields
      const canProvide = remainingFields.filter(f => handler.providesFields.includes(f));
      if (canProvide.length === 0 && remainingFields.length > 0) {
        // This tier can't help with remaining fields, skip it
        continue;
      }
      
      tiersAttempted.push(tier);
      const tierStartedAt = new Date();
      const maxRetries = TIER_MAX_RETRIES[tier];
      
      let lastError: string | undefined;
      let retryCount = 0;
      
      // Try with retries (capped - no hammering)
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        retryCount = attempt;
        
        try {
          const result = await handler.execute(query, remainingFields, timeoutMs);
          
          if (result.success && result.data) {
            const tierCompletedAt = new Date();
            
            // Update metrics
            CapabilityRouter.metrics.tierUsage[tier]++;
            
            // Merge data
            if (!bestResult) {
              bestResult = result;
            } else if (result.data) {
              bestResult.data = { ...bestResult.data, ...result.data };
              bestResult.claims = [...bestResult.claims, ...result.claims];
              bestResult.satisfiedFields = [
                ...new Set([...bestResult.satisfiedFields, ...result.satisfiedFields])
              ];
            }
            
            // Update provenance (use first successful tier)
            if (!bestProvenance) {
              bestProvenance = {
                tier,
                method: this.tierToMethod(tier),
                timing: {
                  startedAt: tierStartedAt,
                  completedAt: tierCompletedAt,
                  durationMs: tierCompletedAt.getTime() - tierStartedAt.getTime(),
                },
                retryCount,
                costHint: TIER_COSTS[tier],
              };
            }
            
            // Update remaining fields
            remainingFields = remainingFields.filter(f => !result.satisfiedFields.includes(f));
            
            // Cache successful result for T0 re-use
            // Note: T0 handler has a 1-hour TTL (cacheTtlMs = 3600000) to ensure data freshness
            // Future enhancement: consider different TTLs for different data types
            if (tier !== CapabilityTier.T0_STATIC && result.data) {
              this.t0Handler.cacheResult(query, result.data);
            }
            
            // If all fields satisfied, we're done
            if (remainingFields.length === 0) {
              break;
            }
          }
          
          // Success at this tier, move to next tier for remaining fields
          break;
          
        } catch (error: any) {
          lastError = error.message || 'Unknown error';
          // Continue to next retry
        }
      }
      
      // Record gaps for this tier
      if (remainingFields.length > 0 && canProvide.length > 0) {
        for (const field of canProvide.filter(f => remainingFields.includes(f))) {
          const existingGap = allGaps.find(g => g.field === field);
          if (existingGap) {
            existingGap.attemptedTiers.push(tier);
          } else {
            allGaps.push({
              field,
              reason: lastError || `Tier ${tier} could not provide this field`,
              attemptedTiers: [tier],
            });
          }
        }
      }
      
      // If all fields satisfied, stop early
      if (remainingFields.length === 0) {
        break;
      }
    }
    
    const completedAt = new Date();
    
    // Build final result
    if (bestResult && bestProvenance) {
      CapabilityRouter.metrics.successfulRequests++;
      this.updateAverageCost(bestProvenance.costHint);
      
      // Final gaps are fields that were never satisfied
      const finalGaps = remainingFields.map(field => {
        const existing = allGaps.find(g => g.field === field);
        return existing || {
          field,
          reason: 'No tier could provide this field',
          attemptedTiers: tiersAttempted,
        };
      });
      
      return {
        success: true,
        data: bestResult.data,
        claims: bestResult.claims,
        confidence: null, // Placeholder for step 3
        provenance: bestProvenance,
        gaps: finalGaps,
        tiersAttempted,
        higherTierMayHelp: finalGaps.length > 0, // Browser tier might help
      };
    }
    
    // No tier succeeded
    CapabilityRouter.metrics.failedRequests++;
    
    return {
      success: false,
      data: null,
      claims: [],
      confidence: null,
      provenance: {
        tier: tiersAttempted[tiersAttempted.length - 1] || CapabilityTier.T0_STATIC,
        method: 'cache',
        timing: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        retryCount: 0,
        costHint: 0,
      },
      gaps: requiredFields.map(field => ({
        field,
        reason: 'No tier could provide this field',
        attemptedTiers: tiersAttempted,
      })),
      tiersAttempted,
      higherTierMayHelp: true, // Browser tier might help
    };
  }
  
  /**
   * Get ordered list of tiers up to and including the specified max tier
   */
  private getTiersUpTo(maxTier: CapabilityTier): CapabilityTier[] {
    const allTiers = [
      CapabilityTier.T0_STATIC,
      CapabilityTier.T1_FETCH_PARSE,
      CapabilityTier.T2_API_REPLAY,
      CapabilityTier.T3_LIGHT_JS,
    ];
    
    const maxIndex = allTiers.indexOf(maxTier);
    if (maxIndex === -1) return allTiers;
    
    return allTiers.slice(0, maxIndex + 1);
  }
  
  /**
   * Map tier to method string
   */
  private tierToMethod(tier: CapabilityTier): 'cache' | 'fetch' | 'api' | 'light-js' {
    switch (tier) {
      case CapabilityTier.T0_STATIC:
        return 'cache';
      case CapabilityTier.T1_FETCH_PARSE:
        return 'fetch';
      case CapabilityTier.T2_API_REPLAY:
        return 'api';
      case CapabilityTier.T3_LIGHT_JS:
        return 'light-js';
      default:
        return 'fetch';
    }
  }
  
  /**
   * Update running average tier cost
   */
  private updateAverageCost(cost: number): void {
    const total = CapabilityRouter.metrics.successfulRequests;
    const currentAvg = CapabilityRouter.metrics.averageTierCost;
    CapabilityRouter.metrics.averageTierCost = ((currentAvg * (total - 1)) + cost) / total;
  }
  
  /**
   * Get router metrics
   */
  static getMetrics(): RouterMetrics {
    return { ...CapabilityRouter.metrics };
  }
  
  /**
   * Reset metrics (for testing)
   */
  static resetMetrics(): void {
    CapabilityRouter.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      tierUsage: {
        [CapabilityTier.T0_STATIC]: 0,
        [CapabilityTier.T1_FETCH_PARSE]: 0,
        [CapabilityTier.T2_API_REPLAY]: 0,
        [CapabilityTier.T3_LIGHT_JS]: 0,
      },
      averageTierCost: 0,
      lastRequestAt: null,
    };
  }
}

// Export singleton for convenience
export const capabilityRouter = new CapabilityRouter();
