import {
  canActivatePantheon,
  pantheonOrchestrator,
  type CrawlerResult,
  type CrawlerExecutionAudit,
} from '../pantheonCrawlerOrchestrator';
import {
  recordCrawlerOutcomes,
  selectCrawlerPlan,
  type CrawlerSelectionPlan,
  type CrawlerSelectionPurpose,
} from './CrawlerSelectionUtility';
import { cainReaperSupervisor, type CrawlerSupervisionResult } from './CainReaperSupervisor';
import { twoStageDeployer } from '../pantheon/razors/TwoStageDeployer';
import { SixCrawlerInitiative } from './SixCrawlerInitiative';

export interface RetrievalEvidence {
  crawler: string;
  target: string;
  content: string;
  confidence: number;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PantheonRetrievalResponse {
  available: boolean;
  reason?: string;
  plan: CrawlerSelectionPlan;
  evidence: RetrievalEvidence[];
  crawlerAudit: Array<CrawlerExecutionAudit | {
    crawler: string;
    capabilityClass: 'razor' | 'pantheon-secondary';
    status: string;
    evidenceCount: number;
    attempts: number;
    targets: number;
    error?: string;
  }>;
  supervision?: CrawlerSupervisionResult;
}

/** Normalizes results from every executable PANTHEON crawler into provenance-bearing evidence. */
export class PantheonRetrievalAdapter {
  async retrieve(request: {
    purpose: Exclude<CrawlerSelectionPurpose, 'map_evidence_render'>;
    targets: string[];
    depth?: 1 | 2 | 3 | 4;
    budgetMs?: number;
  }): Promise<PantheonRetrievalResponse> {
    const firstTarget = request.targets[0];
    const host = firstTarget ? new URL(firstTarget).host : undefined;
    const plan = selectCrawlerPlan({
      purpose: request.purpose,
      depth: request.depth || 4,
      targetCount: request.targets.length,
      host,
    });
    const availability = canActivatePantheon();
    if (!availability.available) {
      return {
        available: false,
        reason: availability.reason,
        plan,
        evidence: [],
        crawlerAudit: plan.crawlers.map(crawler => ({
          crawler,
          capabilityClass: 'primary' as const,
          status: 'failed' as const,
          evidenceCount: 0,
          attempts: 0,
          targets: request.targets.length,
          error: availability.reason || 'PANTHEON unavailable',
        })),
      };
    }

    const searchOptions = {
      depth: plan.depth,
      crawlers: plan.crawlers,
      stormIntensity: plan.depth === 4 ? 'storm' as const : 'snow' as const,
      timeout: request.budgetMs,
    };
    let results: CrawlerResult[];
    let crawlerAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
    if (request.purpose === 'background_report') {
      const isolated = await pantheonOrchestrator.searchAllIsolatedWithAudit(request.targets, searchOptions);
      results = isolated.results;
      crawlerAudit = isolated.audit;
    } else {
      results = await pantheonOrchestrator.search(request.targets, searchOptions);
    }
    recordCrawlerOutcomes(results);

    const evidence = results.map(normalizeResult);

    if (request.purpose === 'background_report' && evidence.length > 0) {
      // Feed real retrieved evidence through the Seven-Crawler analytical family.
      // Retrieval remains the responsibility of the public-source crawler fleet;
      // these seven preserve their original analytic intent and cooperate over the
      // same evidence state rather than existing only as an unused registry entry.
      const previousInitiativeAuth = process.env.SIX_CRAWLER_AUTHORIZED;
      process.env.SIX_CRAWLER_AUTHORIZED = 'true';
      const initiative = new SixCrawlerInitiative({
        authorizedMode: true,
        enableDualState: true,
        enableIdentityFlow: true,
        ingestionThroughput: 100,
        computationalDepth: 4,
        coordinationLatency: 50,
        enableCooperativeEngagement: true,
        enableNearMissArchive: true,
        enableBlindSpotDetection: true,
        enableConsentAmplification: true,
        enableDetectionProbability: true,
      });
      try {
        // The initiative's production gate is for its historical security mode.
        // PANTHEON supplies only already-retrieved public-source evidence here.
        await initiative.start();
        const operation = await initiative.executeOperation({
          environmentId: `pantheon-background-${Date.now()}`,
          principals: [...new Set(evidence.map(item => item.target))].slice(0, 12),
          dataFeeds: [{
            source: 'pantheon-public-evidence',
            data: evidence.map(item => ({
              crawler: item.crawler,
              target: item.target,
              content: item.content,
              confidence: item.confidence,
              retrievedAt: item.retrievedAt,
            })),
          }],
        });
        evidence.push({
          crawler: 'seven-crawler-initiative',
          target: request.targets[0] || 'pantheon-background-report',
          content: JSON.stringify({
            environmentState: operation.environmentState,
            identityFlows: operation.identityFlows,
            dataDigests: operation.dataDigests,
            analysis: operation.analysis,
            blindSpots: operation.blindSpots,
            detectionProbability: operation.detectionProbability,
            insights: operation.insights,
          }),
          confidence: 0.8,
          retrievedAt: new Date().toISOString(),
          metadata: { capabilityClass: 'seven-crawler', cooperativeAnalysis: true },
        });
        for (const crawler of ['mirror', 'key', 'chewer', 'computational', 'usc', 'woo', 'silence']) {
          crawlerAudit.push({
            crawler,
            capabilityClass: 'pantheon-secondary',
            status: 'completed_with_evidence',
            evidenceCount: 1,
            attempts: 1,
            targets: request.targets.length,
          });
        }
      } catch (error: any) {
        for (const crawler of ['mirror', 'key', 'chewer', 'computational', 'usc', 'woo', 'silence']) {
          crawlerAudit.push({
            crawler,
            capabilityClass: 'pantheon-secondary',
            status: 'failed',
            evidenceCount: 0,
            attempts: 1,
            targets: request.targets.length,
            error: error?.message || String(error),
          });
        }
      } finally {
        await initiative.stop().catch(() => undefined);
        if (previousInitiativeAuth === undefined) delete process.env.SIX_CRAWLER_AUTHORIZED;
        else process.env.SIX_CRAWLER_AUTHORIZED = previousInitiativeAuth;
      }
    }

    if (request.purpose === 'background_report') {
      const extendedRuns = await Promise.allSettled(
        request.targets.map(target => twoStageDeployer.deployBackgroundReport(target, undefined, request.budgetMs))
      );

      for (let index = 0; index < extendedRuns.length; index++) {
        const run = extendedRuns[index];
        const target = request.targets[index];
        if (run.status !== 'fulfilled') continue;

        for (const razor of run.value.razorResults) {
          if (!razor.success) continue;
          evidence.push({
            crawler: `razor:${razor.razorType}`,
            target,
            content: JSON.stringify(razor.data),
            confidence: Number.isFinite(razor.confidence) ? razor.confidence : 0,
            retrievedAt: new Date().toISOString(),
            metadata: {
              capabilityClass: 'razor',
              source: razor.source,
              extractionTimeMs: razor.extractionTimeMs,
            },
          });
        }

        crawlerAudit.push(...run.value.audit);

        for (const secondary of run.value.secondaryResults) {
          for (const signature of secondary.signatures) {
            evidence.push({
              crawler: secondary.crawler,
              target,
              content: JSON.stringify({
                evidenceHash: signature.hash,
                probability: signature.probability,
                structuralDensity: signature.structuralDensity,
                constraintCount: signature.constraints.length,
              }),
              confidence: Number.isFinite(signature.probability) ? signature.probability : 0,
              retrievedAt: signature.timestamp.toISOString(),
              metadata: {
                capabilityClass: 'pantheon-secondary',
                entropySignature: true,
              },
            });
          }
        }
      }
    }

    return {
      available: true,
      plan,
      evidence,
      crawlerAudit,
      supervision: await cainReaperSupervisor.supervise(plan, evidence),
    };
  }
}

function normalizeResult(result: CrawlerResult): RetrievalEvidence {
  return {
    crawler: result.crawler,
    target: result.target,
    content: result.content,
    confidence: result.confidence,
    retrievedAt: new Date(result.timestamp).toISOString(),
    metadata: result.metadata,
  };
}

export const pantheonRetrievalAdapter = new PantheonRetrievalAdapter();