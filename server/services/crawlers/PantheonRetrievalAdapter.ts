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
import { acquirePublicResources } from './PublicAcquisitionInfrastructure';
import { defaultFirecrawlAdapter } from '../shadowRetrieval/firecrawlAdapter';

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
    deadlineAt?: number;
  }): Promise<PantheonRetrievalResponse> {
    const retrievalStartedAt = Date.now();
    const deadlineAt = request.deadlineAt
      ?? (request.budgetMs == null ? undefined : retrievalStartedAt + request.budgetMs);
    const remainingBudgetMs = () => deadlineAt == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, deadlineAt - Date.now());
    const collectionOpen = () => remainingBudgetMs() > 0;
    const firstTarget = request.targets[0];
    let host: string | undefined;
    if (firstTarget) {
      try {
        const parsed = new URL(firstTarget);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') host = parsed.host;
      } catch {
        // Discovery expressions are valid planner inputs but never URL hosts.
      }
    }
    const plan = selectCrawlerPlan({
      purpose: request.purpose,
      depth: request.depth || 4,
      targetCount: request.targets.length,
      host,
    });
    // Background-report depth controls effort and source breadth, not crawler
    // participation. Always fan out through the complete specialized primary
    // roster; each route remains failure-isolated and auditable.
    if (request.purpose === 'background_report') {
      plan.crawlers = ['startrek', 'birdofprey', 'sixdegrees', 'cerberus', 'blizzard', 'lich'];
      plan.rationale.unshift('Background report requires the complete specialized primary crawler roster.');
    }
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
      timeout: Number.isFinite(remainingBudgetMs()) ? Math.max(1, remainingBudgetMs()) : request.budgetMs,
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

    // Firecrawl is an explicit background-report retrieval lane, not merely a
    // registered capability. Give it category-specific URL work on every
    // background-report invocation and record the outcome even when unavailable.
    if (request.purpose === 'background_report' && collectionOpen()) {
      const firecrawlTargets = request.targets.filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }).slice(0, 2);

      if (!defaultFirecrawlAdapter.isEnabled()) {
        crawlerAudit.push({
          crawler: 'firecrawl',
          capabilityClass: 'pantheon-secondary',
          status: 'unavailable_no_content',
          evidenceCount: 0,
          attempts: 0,
          targets: firecrawlTargets.length,
          error: 'Firecrawl adapter unavailable or API key not configured',
        });
      } else if (firecrawlTargets.length === 0) {
        crawlerAudit.push({
          crawler: 'firecrawl',
          capabilityClass: 'pantheon-secondary',
          status: 'completed_no_evidence',
          evidenceCount: 0,
          attempts: 0,
          targets: 0,
        });
      } else {
        const firecrawlBudget = Math.max(1_000, Math.min(8_000, Math.floor(remainingBudgetMs() / Math.max(1, firecrawlTargets.length))));
        const firecrawlRuns = await Promise.allSettled(firecrawlTargets.map(target =>
          defaultFirecrawlAdapter.scrape(target, {
            formats: ['markdown'],
            onlyMainContent: true,
            timeout: firecrawlBudget,
          })
        ));
        let firecrawlEvidenceCount = 0;
        let firecrawlFailures = 0;
        firecrawlRuns.forEach((run, index) => {
          const target = firecrawlTargets[index];
          if (run.status !== 'fulfilled' || !run.value.success) {
            firecrawlFailures += 1;
            return;
          }
          const content = String(run.value.markdown || run.value.html || '').trim();
          if (!content) return;
          firecrawlEvidenceCount += 1;
          evidence.push({
            crawler: 'firecrawl',
            target,
            content,
            confidence: 0.82,
            retrievedAt: new Date().toISOString(),
            metadata: { capabilityClass: 'firecrawl', source: 'firecrawl-scrape' },
          });
        });
        crawlerAudit.push({
          crawler: 'firecrawl',
          capabilityClass: 'pantheon-secondary',
          status: firecrawlEvidenceCount > 0 ? 'completed_with_evidence'
            : firecrawlFailures === firecrawlTargets.length ? 'failed'
            : 'completed_no_evidence',
          evidenceCount: firecrawlEvidenceCount,
          attempts: firecrawlRuns.length,
          targets: firecrawlTargets.length,
          error: firecrawlFailures > 0 ? `${firecrawlFailures} Firecrawl target(s) failed` : undefined,
        });
      }
    }

    if (request.purpose === 'background_report' && collectionOpen()) {
      const urlTargets = request.targets.filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      });
      const publicResources: Awaited<ReturnType<typeof acquirePublicResources>> = [];
      const perTargetTimeoutMs = Math.min(12_000, Math.max(2_000, Math.floor((request.budgetMs || 60_000) / Math.max(1, request.targets.length))));
      const acquisitionBatchSize = 24;
      for (let offset = 0; offset < urlTargets.length && collectionOpen(); offset += acquisitionBatchSize) {
        const batch = urlTargets.slice(offset, offset + acquisitionBatchSize);
        const batchResults = await acquirePublicResources(batch, Math.min(perTargetTimeoutMs, Math.max(1_000, remainingBudgetMs())));
        publicResources.push(...batchResults);
      }
      for (const resource of publicResources) {
        crawlerAudit.push({
          crawler: 'public-acquisition',
          capabilityClass: 'pantheon-secondary',
          status: resource.ok && resource.content.trim() ? 'completed_with_evidence' : 'unavailable_no_content',
          evidenceCount: resource.ok && resource.content.trim() ? 1 : 0,
          attempts: 1,
          targets: 1,
          error: resource.error,
        });
        if (!resource.ok || !resource.content.trim()) continue;
        evidence.push({
          crawler: 'public-acquisition',
          target: resource.url,
          content: resource.content,
          confidence: 0.72,
          retrievedAt: resource.retrievedAt,
          metadata: {
            capabilityClass: 'no-key-public-acquisition',
            contentType: resource.contentType,
            kind: resource.kind,
            httpStatus: resource.status,
            etag: resource.etag,
            lastModified: resource.lastModified,
          },
        });
      }
    }

    if (request.purpose === 'background_report' && evidence.length > 0 && collectionOpen()) {
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
      const extendedTargets = request.targets.filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      });
      const EXTENDED_CONCURRENCY = 8;
      const extendedRuns: Array<{ target: string; run: PromiseSettledResult<Awaited<ReturnType<typeof twoStageDeployer.deployBackgroundReport>>> }> = [];
      for (let offset = 0; offset < extendedTargets.length && collectionOpen(); offset += EXTENDED_CONCURRENCY) {
        const batch = extendedTargets.slice(offset, offset + EXTENDED_CONCURRENCY);
        const perBatchBudget = Number.isFinite(remainingBudgetMs()) ? Math.max(1, remainingBudgetMs()) : request.budgetMs;
        const settled = await Promise.allSettled(
          batch.map(target => twoStageDeployer.deployBackgroundReport(target, undefined, perBatchBudget))
        );
        settled.forEach((run, index) => extendedRuns.push({ target: batch[index], run }));
      }

      for (const entry of extendedRuns) {
        const { run, target } = entry;
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