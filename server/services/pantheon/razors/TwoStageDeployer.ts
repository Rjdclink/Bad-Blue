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
import { FarmCrawler, PhantomCrawler, NovaCrawler } from '../crawlers/utility';
import { CrawlerType, CrawlerTask, EntropySignature } from '../core';
import { acquirePublicResource } from '../../crawlers/PublicAcquisitionInfrastructure';

// Configuration
const STAGE_1_TIMEOUT = 5000;           // 5 seconds for all razors
const STAGE_2_TIMEOUT = 30000;          // 30 seconds for secondary
const MIN_CONFIDENCE_THRESHOLD = 0.6;   // 60% confidence to skip stage 2
const MIN_SUCCESS_COUNT = 5;            // At least 5 razors must succeed

export interface BackgroundCapabilityAudit {
  crawler: string;
  capabilityClass: 'razor' | 'pantheon-secondary';
  status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out' | 'unavailable_no_content';
  evidenceCount: number;
  attempts: number;
  targets: number;
  error?: string;
}

export interface BackgroundSecondaryResult {
  crawler: 'hydra' | 'wraith' | 'ice' | 'farm' | 'phantom' | 'nova';
  signatures: EntropySignature[];
  status: BackgroundCapabilityAudit['status'];
  error?: string;
}

export interface BackgroundReportDeployment {
  razorResults: RazorResult[];
  secondaryResults: BackgroundSecondaryResult[];
  audit: BackgroundCapabilityAudit[];
  totalTimeMs: number;
}

export class TwoStageDeployer {
  private razors: BaseRazor[];
  private stage1Results: RazorResult[] = [];
  private stage2Results: EntropySignature[] = [];

  constructor() {
    this.razors = createAllRazors();
  }

  /**
   * Exhaustive public-evidence deployment for background reports.
   *
   * All ten Razors execute, but categories that would expose precise personal
   * contact/location/relationship data are withheld before leaving PANTHEON.
   * All six secondary public-data crawlers execute route-locally in parallel.
   */
  async deployBackgroundReport(target: string, html?: string, reportBudgetMs?: number): Promise<BackgroundReportDeployment> {
    const startedAt = Date.now();
    const boundedBudget = Math.max(30_000, reportBudgetMs || 60_000);
    const fetchTimeoutMs = Math.min(30_000, Math.max(5_000, Math.floor(boundedBudget / 30)));
    const razorTimeoutMs = Math.min(60_000, Math.max(STAGE_1_TIMEOUT, Math.floor(boundedBudget / 20)));
    const secondaryTimeoutMs = Math.min(120_000, Math.max(10_000, Math.floor(boundedBudget / 12)));
    const content = html || await this.fetchContent(target, fetchTimeoutMs);
    const razorResults = content
      ? (await this.deployStage1(content, target, razorTimeoutMs)).map(result => this.sanitizeBackgroundRazorResult(result))
      : [];
    const secondaryResults = await this.deployAllSecondary(target, secondaryTimeoutMs);
    const razorAudit: BackgroundCapabilityAudit[] = this.razors.map(razor => {
      const result = razorResults.find(candidate => candidate.razorType === razor.type);
      return {
        crawler: `razor:${razor.type}`,
        capabilityClass: 'razor',
        status: !content
          ? 'unavailable_no_content'
          : result?.success
            ? 'completed_with_evidence'
            : 'completed_no_evidence',
        evidenceCount: result?.success ? 1 : 0,
        attempts: content ? 1 : 0,
        targets: 1,
      };
    });
    const secondaryAudit: BackgroundCapabilityAudit[] = secondaryResults.map(result => ({
      crawler: result.crawler,
      capabilityClass: 'pantheon-secondary',
      status: result.status,
      evidenceCount: result.signatures.length,
      attempts: 1,
      targets: 1,
      ...(result.error ? { error: result.error } : {}),
    }));

    return {
      razorResults,
      secondaryResults,
      audit: [...razorAudit, ...secondaryAudit],
      totalTimeMs: Date.now() - startedAt,
    };
  }

  private sanitizeBackgroundRazorResult(result: RazorResult): RazorResult {
    const withheldTypes = new Set<RazorType>([RazorType.CONTACT, RazorType.ADDRESS, RazorType.RELATION]);
    if (withheldTypes.has(result.razorType)) {
      return {
        ...result,
        data: {
          withheld: true,
          category: result.razorType,
          reason: 'sensitive_personal_data',
        },
      };
    }

    if (result.razorType === RazorType.IDENTITY) {
      const { dateOfBirth: _dateOfBirth, ...safeData } = result.data as Record<string, unknown>;
      return { ...result, data: safeData };
    }

    if (result.razorType === RazorType.BUSINESS) {
      const { einNumbers: _einNumbers, ...safeData } = result.data as Record<string, unknown>;
      return { ...result, data: safeData };
    }

    if (result.razorType === RazorType.ASSET) {
      const { propertyIds: _propertyIds, ...safeData } = result.data as Record<string, unknown>;
      return { ...result, data: safeData };
    }

    return result;
  }

  private async deployAllSecondary(target: string, perCrawlerTimeoutMs: number = 10_000): Promise<BackgroundSecondaryResult[]> {
    const specs: Array<{
      crawler: BackgroundSecondaryResult['crawler'];
      type: CrawlerType;
      create: (task: CrawlerTask) => { execute(): Promise<EntropySignature[]> };
    }> = [
      { crawler: 'hydra', type: CrawlerType.HYDRA, create: task => new HydraCrawler(task) },
      { crawler: 'wraith', type: CrawlerType.WRAITH, create: task => new WraithCrawler(task) },
      { crawler: 'ice', type: CrawlerType.ICE, create: task => new IceCrawler(task) },
      { crawler: 'farm', type: CrawlerType.FARM, create: task => new FarmCrawler(task) },
      { crawler: 'phantom', type: CrawlerType.PHANTOM, create: task => new PhantomCrawler(task) },
      { crawler: 'nova', type: CrawlerType.NOVA, create: task => new NovaCrawler(task) },
    ];

    const runs = specs.map(async spec => {
      const task: CrawlerTask = {
        id: `background-${spec.crawler}-${Date.now()}`,
        type: spec.type,
        target,
        priority: 10,
        quantum: 10_000,
        entropyBudget: 50,
      };
      const crawler = spec.create(task);
      try {
        const signatures = await Promise.race([
          crawler.execute(),
          new Promise<EntropySignature[]>((_, reject) =>
            setTimeout(() => reject(new Error(`${spec.crawler}_timeout`)), perCrawlerTimeoutMs)
          ),
        ]);
        return {
          crawler: spec.crawler,
          signatures,
          status: signatures.length > 0 ? 'completed_with_evidence' : 'completed_no_evidence',
        } satisfies BackgroundSecondaryResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          crawler: spec.crawler,
          signatures: [],
          status: /timeout/i.test(message) ? 'timed_out' : 'failed',
          error: message.slice(0, 300),
        } satisfies BackgroundSecondaryResult;
      }
    });

    return Promise.all(runs);
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
  private async deployStage1(html: string, url: string, overallTimeoutMs: number = STAGE_1_TIMEOUT): Promise<RazorResult[]> {
    const perRazorTimeout = overallTimeoutMs / this.razors.length;
    
    const promises = this.razors.map(razor => 
      razor.run(html, url, perRazorTimeout)
    );

    // Execute all razors in parallel with overall timeout
    try {
      const results = await Promise.race([
        Promise.all(promises),
        new Promise<RazorResult[]>((_, reject) => 
          setTimeout(() => reject(new Error('stage1_timeout')), overallTimeoutMs)
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
  private async fetchContent(url: string, timeoutMs: number = 5000): Promise<string | null> {
    const result = await acquirePublicResource(url, timeoutMs);
    return result.ok && result.content.trim() ? result.content : null;
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
