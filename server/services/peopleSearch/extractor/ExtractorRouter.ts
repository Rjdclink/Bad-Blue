/**
 * Extractor Router
 * 
 * Phase 3 (Updated): Deterministic, observable extraction with PhantomDecision records
 * Tier 0 (HTTP) → Tier 1 (API Discovery) → Tier 2 (Remote Render) escalation
 * 
 * Enforces "Tier 0/1 first" gate: Tier 2 only if explicit escalation eligibility
 * NO SIDE EFFECTS AT MODULE LOAD - import-safe
 */

import { HttpProvider } from './HttpProvider';
import { ApiDiscoveryProvider } from './ApiDiscoveryProvider';
import { ZenRowsProvider } from './ZenRowsProvider';
import { getPhantomConfig, type PhantomConfig } from './PhantomConfig';
import {
  createPhantomDecision,
  logPhantomDecision,
  isEscalationEligible,
  PhantomReasonCode,
  type PhantomDecision,
} from './PhantomDecision';
import type {
  ExtractorProvider,
  ExtractionRules,
  ExtractedData,
  RouterDecision,
  ExtractionTier,
} from './types';

/**
 * Scoring factors for tier selection
 */
export interface ScoringFactors {
  /** Does the page need JavaScript rendering? */
  needsJsRendering: boolean;
  
  /** Requires cookies/session handling? */
  requiresCookiesSession: boolean;
  
  /** Expected latency ceiling (ms) */
  expectedLatencyCeiling: number;
  
  /** Cost ceiling (relative: 1=cheapest, 10=expensive) */
  costCeiling: number;
  
  /** Past success rate for this URL pattern (0-1) */
  pastSuccessRate: number;
}

/**
 * Tier scoring weights (fixed, deterministic)
 */
const TIER_SCORES = {
  // Tier 0: HTTP-only (fastest, cheapest)
  HTTP_ONLY: {
    latency: 200,        // ~200ms average
    cost: 1,             // Free (native fetch)
    successWithoutJs: 0.9, // High success for static HTML
    successWithJs: 0.1,   // Low success for JS-heavy pages
  },
  
  // Tier 1: API Discovery (fast, cheap)
  API_DISCOVERY: {
    latency: 500,        // ~500ms (HTTP + API call)
    cost: 2,             // Minimal cost (extra API call)
    successWithoutJs: 0.7, // Good for sites with exposed APIs
    successWithJs: 0.6,   // Decent for JS apps with APIs
  },
  
  // Tier 2: Remote Render (slow, expensive)
  REMOTE_RENDER: {
    latency: 5000,       // ~5s (full page render)
    cost: 10,            // Expensive (paid service)
    successWithoutJs: 0.95, // Works for everything
    successWithJs: 0.95,   // Works for everything
  },
};

/**
 * Extractor Router Configuration
 */
export interface ExtractorConfig {
  /** Enable Tier 1 (API discovery) */
  enableApiDiscovery?: boolean;
  
  /** Enable Tier 2 (remote render) */
  enableRemoteRender?: boolean;
  
  /** Default extraction rules */
  defaultRules?: ExtractionRules;
  
  /** Tier 0 timeout (ms) */
  tier0Timeout?: number;
  
  /** Tier 1 timeout (ms) */
  tier1Timeout?: number;
  
  /** Tier 2 timeout (ms) */
  tier2Timeout?: number;
}

/**
 * Extraction result with router metadata and PhantomDecision
 */
export interface ExtractionResult extends ExtractedData {
  /** Which tier was used */
  tier: ExtractionTier;
  
  /** Provider name */
  provider: string;
  
  /** Router decision */
  decision: RouterDecision;
  
  /** Total time (ms) */
  totalTimeMs: number;
  
  /** PhantomDecision record (Phase 3) */
  phantomDecision: PhantomDecision;
}

/**
 * Extractor Router - selects appropriate extraction tier with PhantomDecision tracking
 */
export class ExtractorRouter {
  private tier0Provider: HttpProvider;
  private tier1Provider: ApiDiscoveryProvider;
  private tier2Provider: ZenRowsProvider | null = null;
  private config: ExtractorConfig;
  private phantomConfig: PhantomConfig;
  
  constructor(config: ExtractorConfig = {}) {
    // Load Phantom configuration
    this.phantomConfig = getPhantomConfig();
    
    this.config = {
      enableApiDiscovery: true, // Always enable Tier 1 (no dependencies)
      enableRemoteRender: Boolean(process.env.ZENROWS_API_KEY),
      tier0Timeout: this.phantomConfig.timeouts.tier0,
      tier1Timeout: this.phantomConfig.timeouts.tier1,
      tier2Timeout: this.phantomConfig.timeouts.tier2,
      ...config,
    };
    
    // Enforce no local browsers constraint
    if (this.phantomConfig.noLocalBrowsers) {
      this.enforceNoLocalBrowsers();
    }
    
    // Always initialize Tier 0 and Tier 1 (no dependencies)
    this.tier0Provider = new HttpProvider();
    this.tier1Provider = new ApiDiscoveryProvider();
    
    // Initialize Tier 2 only if enabled and API key present
    if (this.config.enableRemoteRender && process.env.ZENROWS_API_KEY) {
      this.tier2Provider = new ZenRowsProvider();
    }
  }
  
  /**
   * Enforce no local browsers constraint
   * Phase 3: Hard constraint that fails if violated
   */
  private enforceNoLocalBrowsers(): void {
    // Check for local browser environment variables
    const localBrowserPaths = [
      process.env.PLAYWRIGHT_BROWSERS_PATH,
      process.env.PUPPETEER_EXECUTABLE_PATH,
    ];
    
    for (const path of localBrowserPaths) {
      if (path && !path.includes('remote') && !path.includes('ws://') && !path.includes('wss://')) {
        throw new Error(
          `[PhantomConfig] VIOLATION: Local browser path detected: ${path}. ` +
          `Phantom requires noLocalBrowsers=true. Use remote browser via BROWSER_WS_ENDPOINT or ZENROWS_API_KEY.`
        );
      }
    }
  }
  
  /**
   * Phase 3: On-demand execution path
   * Called at request-time only, never at startup
   */
  async resolve(url: string, rules?: ExtractionRules): Promise<ExtractionResult> {
    return this.extract(url, rules);
  }
  
  /**
   * Extract data from URL using tiered approach with PhantomDecision tracking
   * Phase 3: Enforces "Tier 0/1 first" gate - Tier 2 only if escalation eligible
   * Tier 0 → Tier 1 (if API endpoints found) → Tier 2 (if escalation eligible)
   */
  async extract(url: string, rules?: ExtractionRules): Promise<ExtractionResult> {
    const startTime = Date.now();
    const tierPath: number[] = [];
    let bytesDownloaded = 0;
    let tier0ReasonCode: PhantomReasonCode | null = null;
    let tier1ReasonCode: PhantomReasonCode | null = null;
    
    const extractionRules: ExtractionRules = {
      extractTitle: true,
      extractMainText: true,
      extractLinks: false,
      extractMetadata: true,
      extractCanonical: true,
      ...this.config.defaultRules,
      ...rules,
    };
    
    // Step 1: Always try Tier 0 (HTTP + parsing)
    tierPath.push(0);
    const tier0Result = await this.tryTier0(url, extractionRules);
    bytesDownloaded += tier0Result.bytesDownloaded || 0;
    
    // Determine Tier 0 reason code
    if (!tier0Result.needsRender) {
      tier0ReasonCode = PhantomReasonCode.T0_OK;
      
      // Success with Tier 0
      const decision = createPhantomDecision({
        url,
        chosenTier: 0,
        reasonCode: tier0ReasonCode,
        elapsedMs: Date.now() - startTime,
        bytesDownloaded,
        success: true,
        tierPath,
      });
      
      logPhantomDecision(decision);
      
      return {
        ...tier0Result,
        tier: ExtractionTier.HTTP_ONLY,
        provider: this.tier0Provider.name,
        decision: {
          tier: ExtractionTier.HTTP_ONLY,
          reason: 'Plain HTML, no rendering needed',
          provider: this.tier0Provider.name,
          score: this.calculateScore(url, { needsJsRendering: false }),
        },
        totalTimeMs: Date.now() - startTime,
        phantomDecision: decision,
      };
    }
    
    tier0ReasonCode = PhantomReasonCode.T0_JS_REQUIRED_HEURISTIC;
    
    // Step 2: If Tier 0 says needs render, try Tier 1 (API Discovery)
    if (tier0Result.needsRender && this.config.enableApiDiscovery) {
      tierPath.push(1);
      console.log(`[ExtractorRouter] Tier 0 flagged needsRender for ${url}, trying Tier 1 (API Discovery)`);
      
      try {
        const tier1Result = await this.tryTier1(url, extractionRules);
        bytesDownloaded += tier1Result.bytesDownloaded || 0;
        
        if (!tier1Result.needsRender) {
          // Tier 1 succeeded
          tier1ReasonCode = PhantomReasonCode.T1_API_ENDPOINT_FOUND;
          
          const decision = createPhantomDecision({
            url,
            chosenTier: 1,
            reasonCode: tier1ReasonCode,
            elapsedMs: Date.now() - startTime,
            bytesDownloaded,
            success: true,
            tierPath,
          });
          
          logPhantomDecision(decision);
          
          return {
            ...tier1Result,
            tier: ExtractionTier.API_DISCOVERY,
            provider: this.tier1Provider.name,
            decision: {
              tier: ExtractionTier.API_DISCOVERY,
              reason: 'Tier 0 detected JS-heavy page, Tier 1 found API endpoints',
              provider: this.tier1Provider.name,
              score: this.calculateScore(url, { needsJsRendering: true }),
            },
            totalTimeMs: Date.now() - startTime,
            phantomDecision: decision,
          };
        }
        
        tier1ReasonCode = PhantomReasonCode.T1_API_MISSING;
      } catch (error: any) {
        tier1ReasonCode = PhantomReasonCode.T1_API_CALL_FAILED;
        console.warn(`[ExtractorRouter] Tier 1 failed: ${error.message}`);
      }
    }
    
    // Step 3: Tier 2 Gate - only escalate if Tier 0/1 codes are escalation-eligible
    const canEscalateToTier2 = 
      (tier0ReasonCode && isEscalationEligible(tier0ReasonCode)) ||
      (tier1ReasonCode && isEscalationEligible(tier1ReasonCode));
    
    if (canEscalateToTier2 && this.tier2Provider) {
      tierPath.push(2);
      console.log(`[ExtractorRouter] Tier 0/1 failed with escalation-eligible codes, escalating to Tier 2`);
      
      try {
        const tier2Result = await this.tryTier2(url, extractionRules);
        bytesDownloaded += tier2Result.bytesDownloaded || 0;
        
        const decision = createPhantomDecision({
          url,
          chosenTier: 2,
          chosenProvider: this.tier2Provider.name,
          reasonCode: PhantomReasonCode.T2_REMOTE_RENDER_SUCCESS,
          elapsedMs: Date.now() - startTime,
          bytesDownloaded,
          success: true,
          tierPath,
        });
        
        logPhantomDecision(decision);
        
        return {
          ...tier2Result,
          tier: ExtractionTier.REMOTE_RENDER,
          provider: this.tier2Provider.name,
          decision: {
            tier: ExtractionTier.REMOTE_RENDER,
            reason: 'Tier 0/1 failed, escalated to remote render',
            provider: this.tier2Provider.name,
            score: this.calculateScore(url, { needsJsRendering: true }),
          },
          totalTimeMs: Date.now() - startTime,
          phantomDecision: decision,
        };
      } catch (error: any) {
        console.warn(`[ExtractorRouter] Tier 2 failed: ${error.message}, falling back to Tier 0 result`);
        
        const decision = createPhantomDecision({
          url,
          chosenTier: 2,
          chosenProvider: this.tier2Provider.name,
          reasonCode: PhantomReasonCode.T2_PROVIDER_FAIL,
          elapsedMs: Date.now() - startTime,
          bytesDownloaded,
          success: false,
          failureCode: PhantomReasonCode.T2_PROVIDER_FAIL,
          tierPath,
        });
        
        logPhantomDecision(decision);
      }
    }
    
    // Return Tier 0 result (best effort)
    const finalReasonCode = tier1ReasonCode || tier0ReasonCode || PhantomReasonCode.UNKNOWN_ERROR;
    const decision = createPhantomDecision({
      url,
      chosenTier: 0,
      reasonCode: finalReasonCode,
      elapsedMs: Date.now() - startTime,
      bytesDownloaded,
      success: false,
      failureCode: finalReasonCode,
      tierPath,
    });
    
    logPhantomDecision(decision);
    
    return {
      ...tier0Result,
      tier: ExtractionTier.HTTP_ONLY,
      provider: this.tier0Provider.name,
      decision: {
        tier: ExtractionTier.HTTP_ONLY,
        reason: tier0Result.needsRender
          ? 'Needs render but higher tiers unavailable/not eligible - returning Tier 0 result'
          : 'Plain HTML, no rendering needed',
        provider: this.tier0Provider.name,
        score: this.calculateScore(url, { needsJsRendering: false }),
      },
      totalTimeMs: Date.now() - startTime,
      phantomDecision: decision,
    };
  }
  
  /**
   * Try Tier 0 extraction (HTTP + parsing)
   * Returns ExtractedData with bytesDownloaded tracking
   */
  private async tryTier0(url: string, rules: ExtractionRules): Promise<ExtractedData & { bytesDownloaded?: number }> {
    // Fetch HTML
    const fetchResult = await this.tier0Provider.fetch(url, {
      timeout: this.config.tier0Timeout,
    });
    
    // Parse and extract
    const extracted = await this.tier0Provider.extract(fetchResult.content, rules);
    
    return {
      ...extracted,
      bytesDownloaded: typeof fetchResult.content === 'string' 
        ? fetchResult.content.length 
        : fetchResult.content.byteLength,
    };
  }
  
  /**
   * Try Tier 1 extraction (API Discovery)
   */
  private async tryTier1(url: string, rules: ExtractionRules): Promise<ExtractedData & { bytesDownloaded?: number }> {
    // Fetch HTML first
    const fetchResult = await this.tier1Provider.fetch(url, {
      timeout: this.config.tier1Timeout,
    });
    
    // Discover and extract from APIs
    const extracted = await this.tier1Provider.extract(fetchResult.content, rules);
    
    return {
      ...extracted,
      bytesDownloaded: typeof fetchResult.content === 'string'
        ? fetchResult.content.length
        : fetchResult.content.byteLength,
    };
  }
  
  /**
   * Try Tier 2 extraction (remote render via ZenRows)
   */
  private async tryTier2(url: string, rules: ExtractionRules): Promise<ExtractedData & { bytesDownloaded?: number }> {
    if (!this.tier2Provider) {
      throw new Error('Tier 2 provider not available');
    }
    
    // Render with remote browser
    const renderResult = await this.tier2Provider.render(url, {
      waitTime: 3000,
    });
    
    // Parse rendered HTML with Tier 0 parser
    const extracted = await this.tier0Provider.extract(renderResult.html, rules);
    
    // Override needsRender (we already rendered)
    extracted.needsRender = false;
    extracted.confidence = Math.min(extracted.confidence + 0.2, 1.0); // Boost confidence
    
    return {
      ...extracted,
      bytesDownloaded: renderResult.html.length,
    };
  }
  
  /**
   * Calculate scoring factors for tier selection
   * Fixed, deterministic scoring based on page characteristics
   */
  private calculateScore(url: string, factors: Partial<ScoringFactors>): RouterDecision['score'] {
    const scoringFactors: ScoringFactors = {
      needsJsRendering: factors.needsJsRendering ?? false,
      requiresCookiesSession: factors.requiresCookiesSession ?? false,
      expectedLatencyCeiling: factors.expectedLatencyCeiling ?? 5000,
      costCeiling: factors.costCeiling ?? 5,
      pastSuccessRate: factors.pastSuccessRate ?? 0.5,
    };
    
    // Calculate total score based on tier characteristics
    let totalScore = 0;
    
    // Prefer Tier 0 if no JS needed
    if (!scoringFactors.needsJsRendering) {
      totalScore = TIER_SCORES.HTTP_ONLY.successWithoutJs * 10;
    } else {
      // Prefer Tier 1 (API Discovery) for JS apps with APIs
      if (scoringFactors.expectedLatencyCeiling < 2000 && scoringFactors.costCeiling < 5) {
        totalScore = TIER_SCORES.API_DISCOVERY.successWithJs * 10;
      } else {
        // Use Tier 2 (Remote Render) for complex cases
        totalScore = TIER_SCORES.REMOTE_RENDER.successWithJs * 10;
      }
    }
    
    // Adjust score based on past success rate
    totalScore *= scoringFactors.pastSuccessRate;
    
    return {
      ...scoringFactors,
      totalScore,
    };
  }
  
  /**
   * Make routing decision for URL without executing extraction
   * Useful for testing/debugging
   */
  async decide(url: string): Promise<RouterDecision> {
    // For now, always start with Tier 0
    // Real decision happens after Tier 0 execution based on needsRender flag
    return {
      tier: ExtractionTier.HTTP_ONLY,
      reason: 'Default: start with Tier 0, escalate if needed',
      provider: this.tier0Provider.name,
    };
  }
  
  /**
   * Get router health status
   */
  async health(): Promise<{
    tier0: boolean;
    tier1: boolean;
    tier2: boolean;
    tier0Reason?: string;
    tier1Reason?: string;
    tier2Reason?: string;
  }> {
    const tier0Health = await this.tier0Provider.health();
    const tier1Health = await this.tier1Provider.health();
    
    let tier2Health = null;
    if (this.tier2Provider) {
      tier2Health = await this.tier2Provider.health();
    }
    
    return {
      tier0: tier0Health.ready,
      tier1: tier1Health.ready,
      tier2: tier2Health?.ready || false,
      tier0Reason: tier0Health.error,
      tier1Reason: tier1Health.error,
      tier2Reason: tier2Health?.error || (this.tier2Provider ? undefined : 'Tier 2 not configured'),
    };
  }
}
