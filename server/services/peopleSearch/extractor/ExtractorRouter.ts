/**
 * Extractor Router
 * 
 * Phase 2: Decision point that selects extraction tier per URL
 * Tier 0 (HTTP) → Tier 1 (Remote Render) escalation
 * 
 * NO SIDE EFFECTS AT MODULE LOAD - import-safe
 */

import { HttpProvider } from './HttpProvider';
import { ZenRowsProvider } from './ZenRowsProvider';
import type {
  ExtractorProvider,
  ExtractionRules,
  ExtractedData,
  RouterDecision,
  ExtractionTier,
} from './types';

/**
 * Extractor Router Configuration
 */
export interface ExtractorConfig {
  /** Enable Tier 1 (remote render) */
  enableRemoteRender?: boolean;
  
  /** Default extraction rules */
  defaultRules?: ExtractionRules;
  
  /** Tier 0 timeout (ms) */
  tier0Timeout?: number;
  
  /** Tier 1 timeout (ms) */
  tier1Timeout?: number;
}

/**
 * Extraction result with router metadata
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
}

/**
 * Extractor Router - selects appropriate extraction tier
 */
export class ExtractorRouter {
  private tier0Provider: HttpProvider;
  private tier1Provider: ZenRowsProvider | null = null;
  private config: ExtractorConfig;
  
  constructor(config: ExtractorConfig = {}) {
    this.config = {
      enableRemoteRender: Boolean(process.env.ZENROWS_API_KEY),
      tier0Timeout: 15000,
      tier1Timeout: 30000,
      ...config,
    };
    
    // Always initialize Tier 0 (no dependencies)
    this.tier0Provider = new HttpProvider();
    
    // Initialize Tier 1 only if enabled and API key present
    if (this.config.enableRemoteRender && process.env.ZENROWS_API_KEY) {
      this.tier1Provider = new ZenRowsProvider();
    }
  }
  
  /**
   * Extract data from URL using tiered approach
   * Tier 0 first → Tier 1 if needed
   */
  async extract(url: string, rules?: ExtractionRules): Promise<ExtractionResult> {
    const startTime = Date.now();
    const extractionRules: ExtractionRules = {
      extractTitle: true,
      extractMainText: true,
      extractLinks: false,
      extractMetadata: true,
      extractCanonical: true,
      ...this.config.defaultRules,
      ...rules,
    };
    
    // Step 1: Try Tier 0 (HTTP + parsing)
    const tier0Result = await this.tryTier0(url, extractionRules);
    
    // Step 2: If Tier 0 says needs render AND Tier 1 available, escalate
    if (tier0Result.needsRender && this.tier1Provider) {
      console.log(`[ExtractorRouter] Tier 0 flagged needsRender for ${url}, escalating to Tier 1`);
      
      try {
        const tier1Result = await this.tryTier1(url, extractionRules);
        return {
          ...tier1Result,
          tier: ExtractionTier.REMOTE_RENDER,
          provider: this.tier1Provider.name,
          decision: {
            tier: ExtractionTier.REMOTE_RENDER,
            reason: 'Tier 0 detected JS-heavy page, escalated to remote render',
            provider: this.tier1Provider.name,
          },
          totalTimeMs: Date.now() - startTime,
        };
      } catch (error: any) {
        console.warn(`[ExtractorRouter] Tier 1 failed: ${error.message}, falling back to Tier 0 result`);
        // Fall through to return Tier 0 result
      }
    }
    
    // Return Tier 0 result (either no render needed, or Tier 1 unavailable/failed)
    return {
      ...tier0Result,
      tier: ExtractionTier.HTTP_ONLY,
      provider: this.tier0Provider.name,
      decision: {
        tier: ExtractionTier.HTTP_ONLY,
        reason: tier0Result.needsRender
          ? 'Needs render but Tier 1 unavailable - returning Tier 0 result'
          : 'Plain HTML, no rendering needed',
        provider: this.tier0Provider.name,
      },
      totalTimeMs: Date.now() - startTime,
    };
  }
  
  /**
   * Try Tier 0 extraction (HTTP + parsing)
   */
  private async tryTier0(url: string, rules: ExtractionRules): Promise<ExtractedData> {
    // Fetch HTML
    const fetchResult = await this.tier0Provider.fetch(url, {
      timeout: this.config.tier0Timeout,
    });
    
    // Parse and extract
    const extracted = await this.tier0Provider.extract(fetchResult.content, rules);
    
    return extracted;
  }
  
  /**
   * Try Tier 1 extraction (remote render)
   */
  private async tryTier1(url: string, rules: ExtractionRules): Promise<ExtractedData> {
    if (!this.tier1Provider) {
      throw new Error('Tier 1 provider not available');
    }
    
    // Render with remote browser
    const renderResult = await this.tier1Provider.render(url, {
      waitTime: 3000,
    });
    
    // Parse rendered HTML with Tier 0 parser
    const extracted = await this.tier0Provider.extract(renderResult.html, rules);
    
    // Override needsRender (we already rendered)
    extracted.needsRender = false;
    extracted.confidence = Math.min(extracted.confidence + 0.2, 1.0); // Boost confidence
    
    return extracted;
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
    tier1Reason?: string;
  }> {
    const tier0Health = await this.tier0Provider.health();
    
    let tier1Health = null;
    if (this.tier1Provider) {
      tier1Health = await this.tier1Provider.health();
    }
    
    return {
      tier0: tier0Health.ready,
      tier1: tier1Health?.ready || false,
      tier1Reason: tier1Health?.error || (this.tier1Provider ? undefined : 'Tier 1 not configured'),
    };
  }
}
