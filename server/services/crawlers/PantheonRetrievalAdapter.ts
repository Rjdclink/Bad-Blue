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
import { type CrawlerSupervisionResult } from './CainReaperSupervisor';
import { twoStageDeployer } from '../pantheon/razors/TwoStageDeployer';
import { acquirePublicResources } from './PublicAcquisitionInfrastructure';
import { defaultFirecrawlAdapter } from '../shadowRetrieval/firecrawlAdapter';
import { shadowRetrieval } from '../shadowRetrieval';

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
    categoryLabel?: string;
    capabilityHint?: string[];
    transportHint?: string[];
    authority?: {
      investigationId: string;
      categoryId: string;
      categoryIndex: number;
      categoryLabel: string;
      deadlineAt: number;
      subject: string;
      location?: string;
      workId?: string;
      canonicalUrl?: string;
      capability?: string;
    };
  }): Promise<PantheonRetrievalResponse> {
    if (request.purpose === 'background_report') {
      const authority = request.authority;
      if (!authority?.investigationId || !authority.categoryId || !authority.workId || !authority.canonicalUrl || !authority.capability) {
        throw new Error('Pantheon background retrieval rejected: incomplete canonical work authorization');
      }
      if (request.targets.length !== 1 || request.targets[0] !== authority.canonicalUrl) {
        throw new Error('Pantheon background retrieval rejected: work authorization URL mismatch');
      }
      if (!(request.capabilityHint || []).includes(authority.capability)) {
        throw new Error('Pantheon background retrieval rejected: work authorization capability mismatch');
      }
    }
    const retrievalStartedAt = Date.now();
    if (request.authority && request.authority.deadlineAt <= retrievalStartedAt) {
      throw new Error('Pantheon background retrieval rejected: work authorization deadline expired');
    }
    const requestedDeadlineAt = request.deadlineAt
      ?? (request.budgetMs == null ? undefined : retrievalStartedAt + request.budgetMs);
    const deadlineAt = request.authority
      ? Math.min(request.authority.deadlineAt, requestedDeadlineAt ?? request.authority.deadlineAt)
      : requestedDeadlineAt;
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
    // Every crawler remains available. Category/URL context determines which
    // specialized skills are necessary; broad categories retain the complete
    // primary roster while targeted categories avoid redundant transports.
    if (request.purpose === 'background_report') {
      const category = String(request.categoryLabel || '').toLowerCase();
      // URL ledger capability hints are authoritative. Category inference is a
      // fallback for legacy registry entries that do not yet carry a hint.
      const specialized = new Set<string>((request.capabilityHint || []).filter(Boolean));
      if (/social|username|photo|internet|media|associate|relationship|timeline/.test(category)) {
        specialized.add('sixdegrees');
        specialized.add('birdofprey');
      }
      if (/court|criminal|arrest|warrant|offender|incarceration|probation|parole|public record|government/.test(category)) {
        specialized.add('cerberus');
        specialized.add('birdofprey');
      }
      if (/news|internet|media|business|property|employment|education|credential/.test(category)) {
        specialized.add('blizzard');
      }
      if (/relationship|timeline|corroboration|contradiction/.test(category)) specialized.add('lich');
      if (specialized.size === 0) specialized.add('startrek');
      // Search depth/intensity never removes a capability selected by the URL
      // ledger. It only governs budget and productive-work depth upstream.
      plan.crawlers = [...specialized];
      plan.rationale.unshift(`Background category capability routing: ${request.categoryLabel || 'general'}.`);
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

    // Reserve category time for independent Firecrawl, Puppeteer, public
    // acquisition, and extended PANTHEON lanes. A slow primary crawler may not
    // consume the entire category budget and suppress the rest of the roster.
    const totalBudgetMs = Number.isFinite(remainingBudgetMs())
      ? Math.max(1_000, remainingBudgetMs())
      : Math.max(1_000, request.budgetMs || 60_000);
    const primaryBudgetMs = Math.max(1_000, Math.floor(totalBudgetMs * 0.35));
    const searchOptions = {
      depth: plan.depth,
      crawlers: plan.crawlers,
      stormIntensity: plan.depth === 4 ? 'storm' as const : 'snow' as const,
      timeout: primaryBudgetMs,
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

    const evidence = results.map(normalizeResult).filter(item => item.content.trim() && item.confidence > 0);

    // Specialized extraction providers may enrich content already admitted
    // through the canonical acquisition gateway; they are not independent
    // Pantheon network authorities.
    if (request.purpose === 'background_report') {
      crawlerAudit.push({
        crawler: 'firecrawl',
        capabilityClass: 'pantheon-secondary',
        status: 'completed_no_evidence',
        evidenceCount: 0,
        attempts: 0,
        targets: 0,
        error: 'Independent Firecrawl acquisition disabled; canonical acquisition owns Pantheon networking',
      });
      crawlerAudit.push({
        crawler: 'puppeteer',
        capabilityClass: 'pantheon-secondary',
        status: 'completed_no_evidence',
        evidenceCount: 0,
        attempts: 0,
        targets: 0,
        error: 'Independent Puppeteer acquisition disabled; browser capability requires controller-authorized transport',
      });
    }

    // Simulation-only analytical initiatives are deliberately excluded from
    // production background reports. They neither retrieve public sources nor
    // provide attributable subject evidence.

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
        const extendedLaneBudget = Math.max(1_000, Math.floor(totalBudgetMs * 0.20));
        const perBatchBudget = Math.min(
          extendedLaneBudget,
          Number.isFinite(remainingBudgetMs()) ? Math.max(1, remainingBudgetMs()) : extendedLaneBudget,
        );
        const settled = await Promise.allSettled(
          batch.map(target => twoStageDeployer.deployBackgroundReport(target, undefined, perBatchBudget))
        );
        settled.forEach((run, index) => extendedRuns.push({ target: batch[index], run }));
      }

      for (const entry of extendedRuns) {
        const { run, target } = entry;
        if (run.status !== 'fulfilled') {
          crawlerAudit.push({
            crawler: 'extended-pantheon',
            capabilityClass: 'pantheon-secondary',
            status: 'failed',
            evidenceCount: 0,
            attempts: 1,
            targets: 1,
            error: run.reason instanceof Error ? run.reason.message : String(run.reason),
          });
          continue;
        }

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
      // Background reports retain only attributable source evidence. Supervision
      // telemetry is not a report input and is omitted from this production path.
      supervision: undefined,
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