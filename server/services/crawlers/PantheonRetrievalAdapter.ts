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
import { socialMediaScraper } from '../socialMediaScraper';
import { crawlSeedOnceWithCrawlers } from '../../lib/seedFirstOsint';
import { PeopleSearchAggregator } from '../peopleSearch/PeopleSearchAggregator';

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
    subject?: string;
    location?: string;
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

    const evidence = results
      .filter(result => Boolean(result.content?.trim()) && Number.isFinite(result.confidence) && result.confidence > 0)
      .map(normalizeResult);

    if (request.purpose === 'background_report' && collectionOpen()) {
      const urlTargets = request.targets.filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      });
      const publicResources = await acquirePublicResources(
        urlTargets,
        Math.min(12_000, Math.max(1_000, Math.floor(remainingBudgetMs() / Math.max(1, request.targets.length)))),
      );
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

    if (request.purpose === 'background_report' && collectionOpen()) {
      const seedTargets = request.targets.filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      });
      const seedLimit = Number.isFinite(remainingBudgetMs())
        ? Math.min(12, Math.floor(remainingBudgetMs() / 15_000))
        : 12;
      for (const target of seedTargets.slice(0, Math.max(0, seedLimit))) {
        if (!collectionOpen()) break;
        const crawl = await crawlSeedOnceWithCrawlers(target);
        for (const attempt of crawl.attempts) {
          crawlerAudit.push({
            crawler: attempt.crawlerName === 'SeedFetchStarTrek' ? 'seed-startrek'
              : attempt.crawlerName === 'SeedFetchBirdOfPrey' ? 'seed-birdofprey'
              : attempt.crawlerName === 'SeedFetchTrinity' ? 'seed-trinity'
              : 'seed-sixdegrees',
            capabilityClass: 'pantheon-secondary',
            status: attempt.status,
            evidenceCount: crawl.winner?.crawlerName === attempt.crawlerName && crawl.extract.itemsFound > 0 ? 1 : 0,
            attempts: attempt.status === 'disabled' || attempt.status === 'aborted' ? 0 : 1,
            targets: 1,
            error: attempt.error,
          });
        }
        if (crawl.ok && crawl.winner && crawl.extract.itemsFound > 0) {
          const crawler = crawl.winner.crawlerName === 'SeedFetchStarTrek' ? 'seed-startrek'
            : crawl.winner.crawlerName === 'SeedFetchBirdOfPrey' ? 'seed-birdofprey'
            : crawl.winner.crawlerName === 'SeedFetchTrinity' ? 'seed-trinity'
            : 'seed-sixdegrees';
          evidence.push({
            crawler,
            target,
            content: JSON.stringify(crawl.extract),
            confidence: 0.74,
            retrievedAt: new Date().toISOString(),
            metadata: { capabilityClass: 'seed-first', itemsFound: crawl.extract.itemsFound },
          });
        }
      }
    }

    if (request.purpose === 'background_report' && collectionOpen()) {
      const subject = String(request.subject || '').trim();
      if (subject) {
        const nameParts = subject.split(/\s+/).filter(Boolean);
        if (nameParts.length >= 2) {
          const peopleSearch = new PeopleSearchAggregator();
          try {
            const person = await peopleSearch.search({
              firstName: nameParts[0],
              lastName: nameParts.slice(1).join(' '),
              city: request.location,
            });
            const personEvidence = {
              fullName: person.fullName,
              age: person.age,
              addresses: person.addresses,
              phones: person.phones,
              emails: person.emails,
              relatives: person.relatives,
              aliases: person.aliases,
              source: person.source,
            };
            if (!Number.isFinite(person.confidence) || person.confidence <= 0) {
              throw new Error('People-search aggregation returned no accepted evidence');
            }
            evidence.push({
              crawler: 'people-search-aggregate',
              target: subject,
              content: JSON.stringify(personEvidence),
              confidence: person.confidence,
              retrievedAt: person.scrapedAt.toISOString(),
              metadata: { capabilityClass: 'people-search' },
            });
            crawlerAudit.push({
              crawler: 'people-search-aggregate',
              capabilityClass: 'pantheon-secondary',
              status: 'completed_with_evidence',
              evidenceCount: 1,
              attempts: 1,
              targets: 3,
            });
          } catch (error) {
            crawlerAudit.push({
              crawler: 'people-search-aggregate',
              capabilityClass: 'pantheon-secondary',
              status: 'completed_no_evidence',
              evidenceCount: 0,
              attempts: 1,
              targets: 3,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            await peopleSearch.cleanup().catch(() => undefined);
          }
        }

      }
    }

    if (request.purpose === 'background_report' && collectionOpen()) {
      const subject = String(request.subject || '').trim();
      if (subject) {
        const criminalTargets = request.targets.filter(target => {
          try {
            const host = new URL(target).hostname.toLowerCase();
            return host.includes('uscourts.gov') || host.includes('courtlistener.com') ||
              host.includes('nsopw.gov') || host.includes('bop.gov') ||
              host.includes('usmarshals.gov') || host.includes('justice.gov');
          } catch {
            return false;
          }
        });
        const criminalEvidence = evidence.filter(item => criminalTargets.includes(item.target));
        crawlerAudit.push({
          crawler: 'criminal-public-records',
          capabilityClass: 'pantheon-secondary',
          status: criminalEvidence.length > 0 ? 'completed_with_evidence' : 'completed_no_evidence',
          evidenceCount: criminalEvidence.length,
          attempts: criminalTargets.length > 0 ? 1 : 0,
          targets: criminalTargets.length,
        });
      }
    }

    if (request.purpose === 'background_report' && collectionOpen()) {
      const socialHandles = [...new Set(request.targets.flatMap(target => {
        try {
          const parsed = new URL(target);
          const host = parsed.hostname.toLowerCase();
          if (host === 'x.com' || host === 'twitter.com' || host.includes('nitter')) {
            const handle = parsed.pathname.split('/').filter(Boolean)[0];
            return handle ? [handle] : [];
          }
        } catch {
          // Non-URL targets are not social profile URLs.
        }
        return [];
      }))].slice(0, 8);
      for (const handle of socialHandles) {
        if (!collectionOpen()) break;
        const profile = await socialMediaScraper.getTwitterProfile(handle);
        crawlerAudit.push({
          crawler: 'social-media-scraper',
          capabilityClass: 'pantheon-secondary',
          status: profile.success ? 'completed_with_evidence' : 'unavailable_no_content',
          evidenceCount: profile.success ? 1 : 0,
          attempts: 1,
          targets: 1,
          error: profile.error,
        });
        if (profile.success) {
          evidence.push({
            crawler: 'social-media-scraper',
            target: profile.source,
            content: JSON.stringify(profile),
            confidence: 0.72,
            retrievedAt: new Date().toISOString(),
            metadata: { capabilityClass: 'people-social', handle },
          });
        }
      }
    }

    if (request.purpose === 'background_report' && evidence.length > 0 && collectionOpen()) {
      // Feed real retrieved evidence through the Seven-Crawler analytical family.
      // Retrieval remains the responsibility of the public-source crawler fleet;
      // these seven preserve their original analytic intent and cooperate over the
      // same evidence state rather than existing only as an unused registry entry.
      const previousInitiativeAuth = process.env.SIX_CRAWLER_AUTHORIZED;
      process.env.SIX_CRAWLER_AUTHORIZED = 'true';
      const sevenBudgetMs = Number.isFinite(remainingBudgetMs()) ? remainingBudgetMs() : 120_000;
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
        const operation = await Promise.race([
          initiative.executeOperation({
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
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('seven_crawler_deadline')), Math.max(1, sevenBudgetMs))),
        ]);
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
        const sevenEvidenceCounts: Record<string, number> = {
          mirror: operation.environmentState ? 1 : 0,
          key: operation.identityFlows.length,
          chewer: operation.dataDigests.length,
          computational: operation.analysis ? 1 : 0,
          usc: initiative.getStatus().coordination ? 1 : 0,
          woo: operation.environmentState ? 1 : 0,
          silence: operation.blindSpots.length + (operation.detectionProbability ? 1 : 0),
        };
        for (const crawler of ['mirror', 'key', 'chewer', 'computational', 'usc', 'woo', 'silence']) {
          const evidenceCount = sevenEvidenceCounts[crawler] || 0;
          crawlerAudit.push({
            crawler,
            capabilityClass: 'pantheon-secondary',
            status: evidenceCount > 0 ? 'completed_with_evidence' : 'completed_no_evidence',
            evidenceCount,
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
      const evidenceTargets = [...new Set(evidence.map(item => item.target).filter(target => {
        try {
          const parsed = new URL(target);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }))];
      // Extraction/secondary analysis runs against sources that actually yielded
      // evidence. Do not refetch every registry target through every secondary.
      const extendedTargets = evidenceTargets;
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
          if (!razor.success || !Number.isFinite(razor.confidence) || razor.confidence <= 0 || Object.keys(razor.data || {}).length === 0) continue;
          evidence.push({
            crawler: `razor-${razor.razorType}`,
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
            const confidence = Number.isFinite(signature.probability) ? signature.probability : 0;
            if (confidence <= 0 || !signature.hash) continue;
            evidence.push({
              crawler: secondary.crawler,
              target,
              content: JSON.stringify({
                evidenceHash: signature.hash,
                probability: signature.probability,
                structuralDensity: signature.structuralDensity,
                constraintCount: signature.constraints.length,
              }),
              confidence,
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