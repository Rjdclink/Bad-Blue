/**
 * TWO-STAGE DEPLOYMENT SYSTEM
 * 
 * Stage 1 (PRIMARY): Deploy 10 RAZORS in parallel
 *   - Fast, specialized extractors
 *   - Target: < 5 seconds total
 *   - If confidence threshold met, STOP
 * 
 * Stage 2 (SECONDARY): Deploy legacy crawlers
 *   - Hydra, Wraith, Ice
 *   - Only if Stage 1 insufficient
 *   - Deeper, more thorough crawling
 */

import { BaseRazor } from './BaseRazor';
import { createAllRazors } from './implementations';
import { RazorResult, RazorTask, StageResult, RazorType } from './types';
import { HydraCrawler } from '../crawlers/hydra';
import { WraithCrawler } from '../crawlers/wraith';
import { IceCrawler } from '../crawlers/ice';
import { CrawlerType, CrawlerTask, EntropySignature } from '../core';

// Configuration
const STAGE_1_TIMEOUT = 5000;           // 5 seconds for all razors
const STAGE_2_TIMEOUT = 30000;          // 30 seconds for secondary
const MIN_CONFIDENCE_THRESHOLD = 0.6;   // 60% confidence to skip stage 2
const MIN_SUCCESS_COUNT = 5;            // At least 5 razors must succeed

export class TwoStageDeployer {
  private razors: BaseRazor[];
  private stage1Results: RazorResult[] = [];
  private stage2Results: EntropySignature[] = [];

  constructor() {
    this.razors = createAllRazors();
  }

  /**
   * Deploy two-stage extraction on target
   */
  async deploy(target: string, html?: string): Promise<StageResult> {
    const startTime = Date.now();
    
    // Fetch HTML if not provided
    const content = html || await this.fetchContent(target);
    if (!content) {
      return {
        stage: 1,
        results: [],
        totalTimeMs: Date.now() - startTime,
        successCount: 0,
        promoted: false,
      };
    }

    // ========================================
    // STAGE 1: Deploy 10 RAZORS (PRIMARY)
    // ========================================
    const stage1Start = Date.now();
    this.stage1Results = await this.deployStage1(content, target);
    const stage1Time = Date.now() - stage1Start;
    
    // Evaluate Stage 1 results
    const successCount = this.stage1Results.filter(r => r.success).length;
    const avgConfidence = this.calculateAverageConfidence(this.stage1Results);
    
    console.log(`[TwoStage] Stage 1 complete: ${successCount}/10 razors, ${(avgConfidence * 100).toFixed(1)}% confidence, ${stage1Time}ms`);

    // Check if Stage 1 is sufficient
    if (successCount >= MIN_SUCCESS_COUNT && avgConfidence >= MIN_CONFIDENCE_THRESHOLD) {
      return {
        stage: 1,
        results: this.stage1Results,
        totalTimeMs: Date.now() - startTime,
        successCount,
        promoted: false,
      };
    }

    // ========================================
    // STAGE 2: Deploy SECONDARY CRAWLERS
    // ========================================
    console.log(`[TwoStage] Promoting to Stage 2 (threshold not met)`);
    const stage2Start = Date.now();
    this.stage2Results = await this.deployStage2(target);
    const stage2Time = Date.now() - stage2Start;
    
    console.log(`[TwoStage] Stage 2 complete: ${this.stage2Results.length} signatures, ${stage2Time}ms`);

    // Merge Stage 2 results into Stage 1 format
    const mergedResults = this.mergeResults();
    
    return {
      stage: 2,
      results: mergedResults,
      totalTimeMs: Date.now() - startTime,
      successCount: mergedResults.filter(r => r.success).length,
      promoted: true,
    };
  }

  /**
   * Stage 1: Deploy all 10 RAZORS in parallel
   */
  private async deployStage1(html: string, url: string): Promise<RazorResult[]> {
    const perRazorTimeout = STAGE_1_TIMEOUT / this.razors.length;
    
    const promises = this.razors.map(razor => 
      razor.run(html, url, perRazorTimeout)
    );

    // Execute all razors in parallel with overall timeout
    try {
      const results = await Promise.race([
        Promise.all(promises),
        new Promise<RazorResult[]>((_, reject) => 
          setTimeout(() => reject(new Error('stage1_timeout')), STAGE_1_TIMEOUT)
        )
      ]);
      return results;
    } catch {
      // Return whatever completed
      const settled = await Promise.allSettled(promises);
      return settled
        .filter((r): r is PromiseFulfilledResult<RazorResult> => r.status === 'fulfilled')
        .map(r => r.value);
    }
  }

  /**
   * Stage 2: Deploy secondary crawlers (Hydra, Wraith, Ice)
   */
  private async deployStage2(target: string): Promise<EntropySignature[]> {
    const task: CrawlerTask = {
      id: `stage2-${Date.now()}`,
      type: CrawlerType.HYDRA,
      target,
      priority: 10,
      quantum: STAGE_2_TIMEOUT,
      entropyBudget: 50,
    };

    const signatures: EntropySignature[] = [];

    // Deploy all secondary crawlers in parallel
    const crawlers = [
      new HydraCrawler(task),
      new WraithCrawler(task),
      new IceCrawler(task),
    ];

    const promises = crawlers.map(async crawler => {
      try {
        return await Promise.race([
          crawler.execute(),
          new Promise<EntropySignature[]>((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), STAGE_2_TIMEOUT / 3)
          )
        ]);
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        signatures.push(...result.value);
      }
    }

    return signatures;
  }

  /**
   * Fetch content from target URL
   */
  private async fetchContent(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PantheonBot/1.0)' },
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  /**
   * Calculate average confidence across results
   */
  private calculateAverageConfidence(results: RazorResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, r) => acc + r.confidence, 0);
    return sum / results.length;
  }

  /**
   * Merge Stage 2 entropy signatures into RazorResult format
   */
  private mergeResults(): RazorResult[] {
    const merged = [...this.stage1Results];
    
    // Convert entropy signatures to razor results
    for (const sig of this.stage2Results) {
      merged.push({
        razorType: RazorType.IDENTITY, // Default type for entropy
        success: sig.probability > 0.5,
        data: {
          hash: sig.hash,
          probability: sig.probability,
          structuralDensity: sig.structuralDensity,
          constraints: sig.constraints,
        },
        confidence: sig.probability,
        extractionTimeMs: 0,
        source: 'stage2_crawler',
      });
    }

    return merged;
  }

  /**
   * Get Stage 1 results only
   */
  getStage1Results(): RazorResult[] {
    return this.stage1Results;
  }

  /**
   * Get Stage 2 results only
   */
  getStage2Results(): EntropySignature[] {
    return this.stage2Results;
  }

  /**
   * Get all razors
   */
  getRazors(): BaseRazor[] {
    return this.razors;
  }
}

// Singleton instance
export const twoStageDeployer = new TwoStageDeployer();
