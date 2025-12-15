/**
 * Base Razor - Abstract class for all 10 RAZORS
 * Fast, precise, single-purpose extractors
 */

import { RazorType, RazorResult } from './types';

export abstract class BaseRazor {
  abstract readonly type: RazorType;
  abstract readonly patterns: RegExp[];
  
  /**
   * Execute razor extraction - MUST BE FAST
   * Target: < 2 seconds per razor
   */
  abstract extract(html: string, url: string): Promise<Record<string, unknown>>;

  /**
   * Run razor with timeout and confidence scoring
   */
  async run(html: string, url: string, timeout: number = 2000): Promise<RazorResult> {
    const start = Date.now();
    
    try {
      const result = await Promise.race([
        this.extract(html, url),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), timeout)
        )
      ]);
      
      const confidence = this.calculateConfidence(result);
      
      return {
        razorType: this.type,
        success: confidence > 0,
        data: result,
        confidence,
        extractionTimeMs: Date.now() - start,
        source: url,
      };
    } catch {
      // IMMEDIATE SKIP on failure
      return {
        razorType: this.type,
        success: false,
        data: {},
        confidence: 0,
        extractionTimeMs: Date.now() - start,
        source: url,
      };
    }
  }

  /**
   * Calculate confidence based on data completeness
   */
  protected calculateConfidence(data: Record<string, unknown>): number {
    const keys = Object.keys(data);
    if (keys.length === 0) return 0;
    
    let filled = 0;
    for (const key of keys) {
      const val = data[key];
      if (val !== null && val !== undefined && val !== '') {
        if (Array.isArray(val) && val.length > 0) filled++;
        else if (typeof val === 'object' && Object.keys(val).length > 0) filled++;
        else if (typeof val === 'string' && val.length > 0) filled++;
        else if (typeof val === 'number') filled++;
        else if (typeof val === 'boolean') filled++;
      }
    }
    
    return filled / keys.length;
  }

  /**
   * Quick pattern match check
   */
  protected matchPatterns(text: string): string[] {
    const matches: string[] = [];
    for (const pattern of this.patterns) {
      const found = text.match(pattern);
      if (found) matches.push(...found);
    }
    return [...new Set(matches)];
  }
}
