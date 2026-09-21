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
import { CrawlerType, CrawlerTask, EntropySignature, type CrawlerSourceSnapshot } from '../core';
import { acquirePublicResource } from '../../crawlers/PublicAcquisitionInfrastructure';
import { createPantheonDeadline, racePantheonAbort, throwIfPantheonAborted } from '../PantheonDeadline';
import {
  PANTHEON_RAZOR_SKILL_IDS,
  PANTHEON_SECONDARY_CRAWLER_IDS,
  type PantheonCapabilityId,
  type PantheonSecondaryCrawlerId,
} from '../PantheonCrawlerCapabilityMatrix';

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
  durationMs?: number;
  sourceOutcomes?: Array<{
    sourceUrl: string;
    status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
    retrievedAt: string;
    durationMs: number;
    error?: string;
  }>;
  error?: string;
  capabilityOutput?: Record<string, unknown>;
}

export interface BackgroundSecondaryResult {
  crawler: 'hydra' | 'wraith' | 'ice' | 'farm' | 'phantom' | 'nova';
  signatures: EntropySignature[];
  status: BackgroundCapabilityAudit['status'];
  durationMs: number;
  error?: string;
  attempted: boolean;
  capabilityOutput?: Record<string, unknown>;
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
  async deployBackgroundReport(
    target: string,
    html?: string,
    reportBudgetMs?: number,
    capabilityIds?: readonly PantheonCapabilityId[],
    signal?: AbortSignal,
  ): Promise<BackgroundReportDeployment> {
    throwIfPantheonAborted(signal);
    const startedAt = Date.now();
    const boundedBudget = Math.max(500, reportBudgetMs || 60_000);
    // Both local analysis stages must fit inside the adapter's route-local
    // budget. Minimum 5/10-second floors previously guaranteed cancellation
    // before secondary capabilities could report an outcome.
    const razorTimeoutMs = Math.min(STAGE_1_TIMEOUT, Math.max(200, Math.floor(boundedBudget * 0.45)));
    const secondaryTimeoutMs = Math.min(5_000, Math.max(200, Math.floor(boundedBudget * 0.45)));
    // Background execution receives the canonical primary lane's verified live
    // content. It must never start a second acquisition when that content is
    // absent; all capabilities disclose unavailability instead.
    const content = typeof html === 'string' && html.trim() ? html : '';
    const sourceSnapshot = this.createSourceSnapshot(target, content, 'canonical-primary-live-get');
    const allowed = new Set<PantheonCapabilityId>(capabilityIds || [
      ...PANTHEON_RAZOR_SKILL_IDS,
      ...PANTHEON_SECONDARY_CRAWLER_IDS,
    ]);
    const selectedRazors = this.razors.filter(razor => allowed.has(('razor:' + razor.type) as PantheonCapabilityId));
    const selectedSecondary = PANTHEON_SECONDARY_CRAWLER_IDS.filter(id => allowed.has(id));
    const razorResults = content
      ? (await this.deployStage1(content, target, razorTimeoutMs, selectedRazors, signal)).map(result => this.sanitizeBackgroundRazorResult(result))
      : [];
    const secondaryResults = await this.deployAllSecondary(target, sourceSnapshot, secondaryTimeoutMs, selectedSecondary, signal);
    const razorAudit: BackgroundCapabilityAudit[] = selectedRazors.map(razor => {
      const result = razorResults.find(candidate => candidate.razorType === razor.type);
      const status: BackgroundCapabilityAudit['status'] = !content
        ? 'unavailable_no_content'
        : !result || result.outcome === 'timed_out'
          ? 'timed_out'
          : result.outcome === 'failed'
            ? 'failed'
            : result.success
              ? 'completed_with_evidence'
              : 'completed_no_evidence';
      const sourceStatus = status === 'timed_out'
        ? 'timed_out' as const
        : status === 'failed' || status === 'unavailable_no_content'
          ? 'failed' as const
          : status;
      const error = result?.error || (!result && content ? 'Razor execution ended without an attributable outcome' : undefined);
      return {
        crawler: `razor:${razor.type}`,
        capabilityClass: 'razor',
        status,
        evidenceCount: result?.success ? 1 : 0,
        attempts: content ? 1 : 0,
        targets: 1,
        durationMs: Number(result?.extractionTimeMs || 0),
        sourceOutcomes: [{
          sourceUrl: target,
          status: sourceStatus,
          retrievedAt: new Date().toISOString(),
          durationMs: Number(result?.extractionTimeMs || 0),
          ...(error ? { error } : {}),
        }],
        ...(error ? { error } : {}),
      };
    });
    const secondaryAudit: BackgroundCapabilityAudit[] = secondaryResults.map(result => ({
      crawler: result.crawler,
      capabilityClass: 'pantheon-secondary',
      status: result.status,
      evidenceCount: result.signatures.length,
      attempts: result.attempted ? 1 : 0,
      targets: 1,
      durationMs: result.durationMs,
      sourceOutcomes: [{
        sourceUrl: target,
        status: result.status === 'timed_out'
          ? 'timed_out'
          : result.status === 'failed' || result.status === 'unavailable_no_content'
            ? 'failed'
            : result.signatures.length > 0
              ? 'completed_with_evidence'
              : 'completed_no_evidence',
        retrievedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        ...(result.error ? { error: result.error } : {}),
      }],
      ...(result.error ? { error: result.error } : {}),
      ...(result.capabilityOutput ? { capabilityOutput: result.capabilityOutput } : {}),
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

  private async deployAllSecondary(
    target: string,
    sourceSnapshot: Readonly<CrawlerSourceSnapshot> | undefined,
    perCrawlerTimeoutMs: number = 10_000,
    allowedIds: readonly PantheonSecondaryCrawlerId[] = PANTHEON_SECONDARY_CRAWLER_IDS,
    signal?: AbortSignal,
  ): Promise<BackgroundSecondaryResult[]> {
    throwIfPantheonAborted(signal);
    const specs: Array<{
      crawler: PantheonSecondaryCrawlerId;
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

    const selectedSpecs = specs.filter(spec => allowedIds.includes(spec.crawler));
    if (!sourceSnapshot) {
      return selectedSpecs.map(spec => ({
        crawler: spec.crawler,
        signatures: [],
        status: 'unavailable_no_content',
        durationMs: 0,
        attempted: false,
        error: 'Verified canonical source snapshot unavailable',
        capabilityOutput: {
          function: 'snapshot-analysis',
          unavailableReason: 'verified_canonical_source_snapshot_unavailable',
        },
      }));
    }
    const runs = selectedSpecs.map(async spec => {
      const executionStartedAt = Date.now();
      const task: CrawlerTask = {
        id: `background-${spec.crawler}-${Date.now()}`,
        type: spec.type,
        target,
        priority: 10,
        quantum: 10_000,
        entropyBudget: 50,
        sourceSnapshot,
      };
      const crawler = spec.create(task);
      try {
        const routeDeadline = createPantheonDeadline(Date.now() + perCrawlerTimeoutMs, signal);
        let signatures: EntropySignature[];
        try {
          signatures = await racePantheonAbort(crawler.execute(), routeDeadline.signal);
        } finally {
          routeDeadline.dispose();
        }
        return {
          crawler: spec.crawler,
          signatures,
          status: signatures.length > 0 ? 'completed_with_evidence' : 'completed_no_evidence',
          durationMs: Date.now() - executionStartedAt,
          attempted: true,
          capabilityOutput: {
            sourceUrl: sourceSnapshot.sourceUrl,
            provenance: sourceSnapshot.provenance,
            verified: sourceSnapshot.verified,
            signatureCount: signatures.length,
            outputs: signatures.flatMap(signature => signature.capabilityOutput ? [signature.capabilityOutput] : []),
          },
        } satisfies BackgroundSecondaryResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          crawler: spec.crawler,
          signatures: [],
          status: /timeout/i.test(message) ? 'timed_out' : 'failed',
          durationMs: Date.now() - executionStartedAt,
          attempted: true,
          error: message.slice(0, 300),
        } satisfies BackgroundSecondaryResult;
      }
    });

    return Promise.all(runs);
  }

  async healthCheckAllCapabilities(
    target: string,
    html: string,
    timeoutMs: number = 3_000,
  ): Promise<BackgroundCapabilityAudit[]> {
    const startedAt = Date.now();
    const sourceSnapshot = this.createSourceSnapshot(target, html, 'canonical-health-check-live-get');
    const [razorRun, secondaryRun] = await Promise.all([
      this.deployStage1(html, target, timeoutMs, this.razors),
      this.deployAllSecondary(target, sourceSnapshot, timeoutMs, PANTHEON_SECONDARY_CRAWLER_IDS),
    ]);
    const razorAudit: BackgroundCapabilityAudit[] = this.razors.map(razor => {
      const result = razorRun.find(candidate => candidate.razorType === razor.type);
      const status: BackgroundCapabilityAudit['status'] = !result || result.outcome === 'timed_out'
        ? 'timed_out'
        : result.outcome === 'failed'
          ? 'failed'
          : result.success
            ? 'completed_with_evidence'
            : 'completed_no_evidence';
      const error = result?.error || (!result ? 'Razor health check ended without an attributable outcome' : undefined);
      return {
        crawler: 'razor:' + razor.type,
        capabilityClass: 'razor',
        status,
        evidenceCount: result?.success ? 1 : 0,
        attempts: 1,
        targets: 1,
        durationMs: Number(result?.extractionTimeMs || 0),
        sourceOutcomes: [{
          sourceUrl: target,
          status: status === 'timed_out' ? 'timed_out' : status === 'failed' ? 'failed' : status,
          retrievedAt: new Date().toISOString(),
          durationMs: Number(result?.extractionTimeMs || 0),
          ...(error ? { error } : {}),
        }],
        ...(error ? { error } : {}),
      };
    });
    const secondaryAudit: BackgroundCapabilityAudit[] = secondaryRun.map(result => ({
      crawler: result.crawler,
      capabilityClass: 'pantheon-secondary',
      status: result.status,
      evidenceCount: result.signatures.length,
      attempts: result.attempted ? 1 : 0,
      targets: 1,
      durationMs: result.durationMs,
      sourceOutcomes: [{
        sourceUrl: target,
        status: result.status === 'timed_out'
          ? 'timed_out'
          : result.status === 'failed' || result.status === 'unavailable_no_content'
            ? 'failed'
            : result.signatures.length > 0
              ? 'completed_with_evidence'
              : 'completed_no_evidence',
        retrievedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        ...(result.error ? { error: result.error } : {}),
      }],
      ...(result.error ? { error: result.error } : {}),
      ...(result.capabilityOutput ? { capabilityOutput: result.capabilityOutput } : {}),
    }));
    return [...razorAudit, ...secondaryAudit].map(item => ({
      ...item,
      durationMs: item.durationMs || (Date.now() - startedAt),
    }));
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
    this.stage2Results = await this.deployStage2(target, content);
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
  private async deployStage1(
    html: string,
    url: string,
    overallTimeoutMs: number = STAGE_1_TIMEOUT,
    razors: BaseRazor[] = this.razors,
    signal?: AbortSignal,
  ): Promise<RazorResult[]> {
    throwIfPantheonAborted(signal);
    const perRazorTimeout = overallTimeoutMs / Math.max(1, razors.length);
    
    const completed: RazorResult[] = [];
    const promises = razors.map(razor =>
      razor.run(html, url, perRazorTimeout).then(result => {
        completed.push(result);
        return result;
      })
    );
    const stageDeadline = createPantheonDeadline(Date.now() + overallTimeoutMs, signal);
    try {
      return await racePantheonAbort(Promise.all(promises), stageDeadline.signal);
    } catch {
      return completed;
    } finally {
      stageDeadline.dispose();
    }
  }

  /**
   * Stage 2: Deploy secondary crawlers (Hydra, Wraith, Ice)
   */
  private async deployStage2(target: string, content: string): Promise<EntropySignature[]> {
    const sourceSnapshot = this.createSourceSnapshot(target, content, 'canonical-legacy-live-get');
    if (!sourceSnapshot) return [];
    const task: CrawlerTask = {
      id: `stage2-${Date.now()}`,
      type: CrawlerType.HYDRA,
      target,
      priority: 10,
      quantum: STAGE_2_TIMEOUT,
      entropyBudget: 50,
      sourceSnapshot,
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
  private async fetchContent(url: string, timeoutMs: number = 5000, signal?: AbortSignal): Promise<string | null> {
    const result = await acquirePublicResource(url, timeoutMs, undefined, signal);
    return result.ok && result.content.trim() ? result.content : null;
  }

  private createSourceSnapshot(
    target: string,
    content: string | null | undefined,
    provenance: CrawlerSourceSnapshot['provenance'],
  ): Readonly<CrawlerSourceSnapshot> | undefined {
    if (typeof content !== 'string' || !content.trim()) return undefined;
    return Object.freeze({
      sourceUrl: target,
      content,
      contentType: /<\s*!doctype|<\s*html|<\s*body/i.test(content) ? 'text/html' : 'text/plain',
      retrievedAt: new Date().toISOString(),
      provenance,
      verified: true as const,
    });
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
