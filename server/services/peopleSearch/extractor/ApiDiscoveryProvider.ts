/**
 * Tier 1: API-First Discovery Provider
 * 
 * Finds and extracts data from JSON/GraphQL/XHR endpoints without rendering
 * NO SIDE EFFECTS AT MODULE LOAD - import-safe
 */

import type {
  ExtractorProvider,
  FetchResult,
  ExtractionRules,
  ExtractedData,
  ProviderHealth,
} from './types';

/**
 * Tier 1 API Discovery Provider
 * Analyzes HTML for API endpoints and attempts direct data extraction
 */
export class ApiDiscoveryProvider implements ExtractorProvider {
  readonly name = 'API_DISCOVERY';
  
  private readonly DEFAULT_TIMEOUT = 10000;
  
  /**
   * Fetch HTML to discover API endpoints
   */
  async fetch(url: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<FetchResult> {
    const startTime = Date.now();
    const timeout = options?.timeout || this.DEFAULT_TIMEOUT;
    
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/json,*/*',
          ...options?.headers,
        },
      });
      
      const content = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      return {
        content,
        headers,
        status: response.status,
        finalUrl: response.url,
        responseTimeMs: Date.now() - startTime,
        provider: this.name,
      };
    } catch (error: any) {
      throw new Error(`API Discovery fetch failed: ${error.message}`);
    }
  }
  
  /**
   * Extract data by discovering and calling API endpoints
   */
  async extract(htmlOrBytes: string | Buffer, rules: ExtractionRules): Promise<ExtractedData> {
    const html = typeof htmlOrBytes === 'string' ? htmlOrBytes : htmlOrBytes.toString('utf-8');
    
    // Discover potential API endpoints
    const apiEndpoints = this.discoverApiEndpoints(html);
    
    if (apiEndpoints.length === 0) {
      // No APIs found, return with needsRender flag
      return {
        needsRender: true,
        confidence: 0.2,
      };
    }
    
    // Try to extract data from discovered endpoints
    const extracted = await this.extractFromApis(apiEndpoints, rules, html);
    
    if (extracted.success) {
      return {
        ...extracted.data,
        needsRender: false,
        confidence: 0.85, // High confidence for API data
      };
    }
    
    // API extraction failed, needs rendering
    return {
      needsRender: true,
      confidence: 0.3,
    };
  }
  
  /**
   * Discover API endpoints in HTML
   */
  private discoverApiEndpoints(html: string): string[] {
    const endpoints: string[] = [];
    
    // Look for common API patterns in script tags
    const apiPatterns = [
      // GraphQL endpoints
      /["']https?:\/\/[^"']+\/graphql["']/gi,
      // REST API endpoints
      /["']https?:\/\/[^"']+\/api\/[^"']+["']/gi,
      // JSON endpoints
      /["']https?:\/\/[^"']+\.json["']/gi,
      // XHR/fetch calls
      /fetch\(["']([^"']+)["']/gi,
      /\.get\(["']([^"']+)["']/gi,
      /\.post\(["']([^"']+)["']/gi,
    ];
    
    for (const pattern of apiPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        let endpoint = match[0].replace(/['"]/g, '');
        // Clean up fetch/get/post wrappers
        endpoint = endpoint.replace(/^(fetch|\.get|\.post)\(/, '');
        if (endpoint.startsWith('http')) {
          endpoints.push(endpoint);
        }
      }
    }
    
    // Look for __NEXT_DATA__ (Next.js)
    if (html.includes('__NEXT_DATA__')) {
      const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
      if (nextDataMatch) {
        endpoints.push('inline:__NEXT_DATA__');
      }
    }
    
    // Look for window.__INITIAL_STATE__ (Redux)
    if (html.includes('__INITIAL_STATE__')) {
      endpoints.push('inline:__INITIAL_STATE__');
    }
    
    // Remove duplicates
    return Array.from(new Set(endpoints)).slice(0, 10); // Limit to 10 endpoints
  }
  
  /**
   * Extract data from discovered API endpoints
   */
  private async extractFromApis(
    endpoints: string[],
    rules: ExtractionRules,
    html: string
  ): Promise<{ success: boolean; data?: Partial<ExtractedData> }> {
    // Prefer embedded application state because it is already part of the fetched
    // document and does not require another network request.
    const inlineEndpoint = endpoints.find(e => e.startsWith('inline:'));
    if (inlineEndpoint) {
      const inlineData = this.extractInlineState(html, inlineEndpoint);
      if (inlineData !== undefined) {
        const extracted = this.normalizeStructuredData(inlineData, rules);
        if (extracted) {
          return { success: true, data: extracted };
        }
      }
    }
    
    // For external API endpoints
    // Try first endpoint only (to avoid rate limits)
    if (endpoints.length > 0 && endpoints[0].startsWith('http')) {
      try {
        const response = await fetch(endpoints[0], {
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          const extracted = this.normalizeStructuredData(data, rules);
          if (extracted) {
            return {
              success: true,
              data: extracted,
            };
          }
        }
      } catch (error) {
        // API call failed, continue
      }
    }
    
    return { success: false };
  }

  private extractInlineState(html: string, endpoint: string): unknown {
    if (endpoint === 'inline:__NEXT_DATA__') {
      const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!match?.[1]) return undefined;
      try {
        return JSON.parse(match[1]);
      } catch {
        return undefined;
      }
    }

    if (endpoint === 'inline:__INITIAL_STATE__') {
      const match = html.match(/(?:window\.)?__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*(?:<\/script>|$)/i);
      if (!match?.[1]) return undefined;
      try {
        return JSON.parse(match[1]);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private normalizeStructuredData(data: unknown, rules: ExtractionRules): Partial<ExtractedData> | null {
    if (data === null || data === undefined) return null;

    const root = typeof data === 'object' ? data as Record<string, unknown> : { value: data };
    const metadata: Record<string, string> = {};
    const stringValues: string[] = [];
    const seen = new Set<unknown>();

    const walk = (value: unknown, depth: number, key?: string): void => {
      if (depth > 6 || value === null || value === undefined || seen.has(value)) return;
      if (typeof value === 'string') {
        const clean = value.replace(/\s+/g, ' ').trim();
        if (clean) {
          stringValues.push(clean);
          if (key && /^(description|summary|subtitle|headline)$/i.test(key) && !metadata[key]) {
            metadata[key] = clean.slice(0, 1000);
          }
        }
        return;
      }
      if (typeof value !== 'object') return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, 100).forEach(item => walk(item, depth + 1, key));
        return;
      }
      Object.entries(value as Record<string, unknown>).slice(0, 200).forEach(([childKey, childValue]) => {
        walk(childValue, depth + 1, childKey);
      });
    };

    walk(root, 0);

    const titleCandidate = ['title', 'name', 'headline']
      .map(key => root[key])
      .find(value => typeof value === 'string') as string | undefined;

    const uniqueText = Array.from(new Set(stringValues));
    const mainText = uniqueText.join(' ').slice(0, 10000);
    if (!titleCandidate && !mainText) return null;

    const extracted: Partial<ExtractedData> = {};
    if (rules.extractTitle !== false && titleCandidate) extracted.title = titleCandidate.trim();
    if (rules.extractMainText !== false && mainText) extracted.mainText = mainText;
    if (rules.extractMetadata) extracted.metadata = metadata;
    return extracted;
  }
  
  /**
   * Health check - always ready (no dependencies)
   */
  async health(): Promise<ProviderHealth> {
    return {
      ready: true,
      lastCheck: new Date(),
    };
  }
}
