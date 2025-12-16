/**
 * Tier 1: ZenRows Remote Render Provider
 * 
 * Remote rendering via ZenRows API
 * NO SIDE EFFECTS AT MODULE LOAD - import-safe
 * Only invoked when Tier 0 returns needsRender=true
 */

import type {
  ExtractorProvider,
  FetchResult,
  ExtractionRules,
  ExtractedData,
  RenderOptions,
  RenderResult,
  ProviderHealth,
} from './types';

/**
 * Tier 1 ZenRows Provider - remote browser rendering
 * Requires ZENROWS_API_KEY environment variable
 */
export class ZenRowsProvider implements ExtractorProvider {
  readonly name = 'ZENROWS';
  
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.zenrows.com/v1/';
  private lastHealthCheck: Date | null = null;
  private isHealthy = false;
  
  constructor() {
    this.apiKey = process.env.ZENROWS_API_KEY;
  }
  
  /**
   * Fetch with ZenRows (basic mode, no rendering)
   */
  async fetch(url: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<FetchResult> {
    if (!this.apiKey) {
      throw new Error('ZENROWS_API_KEY not configured');
    }
    
    const startTime = Date.now();
    const params = new URLSearchParams({
      url,
      apikey: this.apiKey,
      // Basic scraping mode (no JS rendering)
      js_render: 'false',
    });
    
    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        method: 'GET',
        headers: options?.headers || {},
        signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
      });
      
      if (!response.ok) {
        throw new Error(`ZenRows fetch failed: ${response.status} ${response.statusText}`);
      }
      
      const content = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      return {
        content,
        headers,
        status: response.status,
        finalUrl: url,
        responseTimeMs: Date.now() - startTime,
        provider: this.name,
      };
    } catch (error: any) {
      throw new Error(`ZenRows fetch failed: ${error.message}`);
    }
  }
  
  /**
   * Extract - not implemented (use HttpProvider.extract on rendered HTML)
   */
  async extract(htmlOrBytes: string | Buffer, rules: ExtractionRules): Promise<ExtractedData> {
    throw new Error('ZenRowsProvider.extract() not implemented - use HttpProvider.extract() on rendered HTML');
  }
  
  /**
   * Render URL with JavaScript execution
   * This is the primary method for Tier 1
   */
  async render(url: string, options?: RenderOptions): Promise<RenderResult> {
    if (!this.apiKey) {
      throw new Error('ZENROWS_API_KEY not configured - cannot render');
    }
    
    const startTime = Date.now();
    const params = new URLSearchParams({
      url,
      apikey: this.apiKey,
      // Enable JS rendering
      js_render: 'true',
      // Wait for content to load
      wait: String(options?.waitTime || 2000),
      // Premium proxy for better success rate
      premium_proxy: 'true',
      // Antibot bypass
      antibot: 'true',
    });
    
    // Add wait_for selector if specified
    if (options?.waitForSelector) {
      params.set('wait_for', options.waitForSelector);
    }
    
    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(30000), // 30s timeout for rendering
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ZenRows render failed: ${response.status} - ${errorText}`);
      }
      
      const html = await response.text();
      
      return {
        html,
        renderTimeMs: Date.now() - startTime,
        provider: this.name,
      };
    } catch (error: any) {
      throw new Error(`ZenRows render failed: ${error.message}`);
    }
  }
  
  /**
   * Health check - verify API key is configured
   */
  async health(): Promise<ProviderHealth> {
    const now = new Date();
    
    // Cache health check for 1 minute
    if (this.lastHealthCheck && (now.getTime() - this.lastHealthCheck.getTime()) < 60000) {
      return {
        ready: this.isHealthy,
        lastCheck: this.lastHealthCheck,
        error: this.isHealthy ? undefined : 'ZENROWS_API_KEY not configured',
      };
    }
    
    this.lastHealthCheck = now;
    this.isHealthy = Boolean(this.apiKey);
    
    return {
      ready: this.isHealthy,
      lastCheck: now,
      error: this.isHealthy ? undefined : 'ZENROWS_API_KEY not configured',
    };
  }
}
