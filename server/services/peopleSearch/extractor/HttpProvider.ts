/**
 * Tier 0: HTTP-Only Provider
 * 
 * Ultra-light HTTP extraction without browser tooling
 * Default provider - must succeed without any browser dependencies
 * 
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
 * Tier 0 HTTP Provider - no browser required
 * Uses native fetch + lightweight HTML parsing
 */
export class HttpProvider implements ExtractorProvider {
  readonly name = 'HTTP_ONLY';
  
  private readonly DEFAULT_TIMEOUT = 15000;
  private readonly DEFAULT_MAX_REDIRECTS = 5;
  private readonly DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
  
  /**
   * Fetch raw content using native HTTP
   */
  async fetch(url: string, options?: {
    timeout?: number;
    maxRedirects?: number;
    maxSizeBytes?: number;
    headers?: Record<string, string>;
  }): Promise<FetchResult> {
    const startTime = Date.now();
    const timeout = options?.timeout || this.DEFAULT_TIMEOUT;
    const maxSize = options?.maxSizeBytes || this.DEFAULT_MAX_SIZE;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          ...options?.headers,
        },
        redirect: 'follow',
      });
      
      clearTimeout(timeoutId);
      
      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${maxSize})`);
      }
      
      // Read content with size limit
      const content = await response.text();
      if (content.length > maxSize) {
        throw new Error(`Response too large: ${content.length} bytes (max: ${maxSize})`);
      }
      
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
      throw new Error(`HTTP fetch failed: ${error.message}`);
    }
  }
  
  /**
   * Extract normalized data from HTML
   * Detects if page needs rendering (JS-heavy)
   */
  async extract(htmlOrBytes: string | Buffer, rules: ExtractionRules): Promise<ExtractedData> {
    const html = typeof htmlOrBytes === 'string' ? htmlOrBytes : htmlOrBytes.toString('utf-8');
    
    const result: ExtractedData = {
      needsRender: false,
      confidence: 0.8, // Default confidence for HTML parsing
    };
    
    // Extract title
    if (rules.extractTitle !== false) {
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      result.title = titleMatch ? this.decodeHtml(titleMatch[1]).trim() : undefined;
    }
    
    // Extract canonical URL
    if (rules.extractCanonical) {
      const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      result.canonicalUrl = canonicalMatch ? canonicalMatch[1] : undefined;
    }
    
    // Extract main text (body content, strip scripts/styles)
    if (rules.extractMainText !== false) {
      let text = html
        // Remove script tags and content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        // Remove style tags and content
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        // Remove HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Decode HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
      
      result.mainText = text.substring(0, 10000); // Limit to 10K chars
    }
    
    // Extract links
    if (rules.extractLinks) {
      const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi);
      result.links = Array.from(linkMatches, m => m[1]).slice(0, 100); // Limit to 100 links
    }
    
    // Extract metadata
    if (rules.extractMetadata) {
      result.metadata = {};
      
      // Open Graph tags
      const ogMatches = html.matchAll(/<meta[^>]+property=["']og:([^"']+)["'][^>]+content=["']([^"']+)["']/gi);
      for (const match of ogMatches) {
        result.metadata[`og:${match[1]}`] = this.decodeHtml(match[2]);
      }
      
      // Twitter card tags
      const twitterMatches = html.matchAll(/<meta[^>]+name=["']twitter:([^"']+)["'][^>]+content=["']([^"']+)["']/gi);
      for (const match of twitterMatches) {
        result.metadata[`twitter:${match[1]}`] = this.decodeHtml(match[2]);
      }
      
      // Description
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      if (descMatch) {
        result.metadata['description'] = this.decodeHtml(descMatch[1]);
      }
    }
    
    // Detect if page needs rendering (JS-heavy indicators)
    result.needsRender = this.detectNeedsRender(html, result);
    if (result.needsRender) {
      result.confidence = 0.3; // Low confidence if page needs rendering
    }
    
    return result;
  }
  
  /**
   * Detect if page is JS-heavy and needs rendering
   */
  private detectNeedsRender(html: string, extracted: ExtractedData): boolean {
    // Check for common JS framework markers
    const jsFrameworkMarkers = [
      'data-reactroot',
      'data-react-helmet',
      '__NEXT_DATA__',
      'ng-app',
      'v-app',
      'data-vue-',
      'data-svelte',
    ];
    
    const hasFrameworkMarker = jsFrameworkMarkers.some(marker =>
      html.toLowerCase().includes(marker.toLowerCase())
    );
    
    // Check for minimal meaningful content
    const hasMinimalContent = !extracted.mainText || extracted.mainText.length < 200;
    
    // Check for loading indicators
    const hasLoadingIndicator = /loading|spinner|skeleton/i.test(html);
    
    // Check for high script-to-content ratio
    const scriptMatches = html.match(/<script/gi);
    const scriptCount = scriptMatches ? scriptMatches.length : 0;
    const contentLength = extracted.mainText?.length || 0;
    const highScriptRatio = scriptCount > 10 && contentLength < 500;
    
    // Needs render if: framework marker + minimal content, OR high script ratio + loading
    return (hasFrameworkMarker && hasMinimalContent) || (highScriptRatio && hasLoadingIndicator);
  }
  
  /**
   * Decode HTML entities
   */
  private decodeHtml(html: string): string {
    return html
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-f]+);/i, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
