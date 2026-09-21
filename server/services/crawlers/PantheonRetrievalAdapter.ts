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
import {
  getPantheonCategoryCapabilities,
  PANTHEON_PRIMARY_CRAWLER_IDS,
  PANTHEON_RAZOR_SKILL_IDS,
  PANTHEON_SECONDARY_CRAWLER_IDS,
  type PantheonCapabilityId,
  type PantheonPrimaryCrawlerId,
  type PantheonTransport,
} from '../pantheon/PantheonCrawlerCapabilityMatrix';
import {
  createPantheonSourceResult,
  type PantheonStructuredSourceResult,
} from '../pantheon/PantheonSourceResult';
import { createPantheonDeadline, throwIfPantheonAborted } from '../pantheon/PantheonDeadline';
import {
  acquirePantheonResource,
  runWithPantheonAcquisitionContext,
  type PublicAcquisitionResult,
} from './PublicAcquisitionInfrastructure';
import { runPortablePantheonCapabilities } from '../pantheon/PantheonPortableCapabilityExecutor';

export type RetrievalEvidence = PantheonStructuredSourceResult;

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
    durationMs?: number;
    sourceOutcomes?: Array<{
      sourceUrl: string;
      status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
      retrievedAt: string;
      durationMs: number;
      error?: string;
    }>;
    route?: 'primary' | 'fallback';
    fallbackFor?: string;
    executionMode?: 'credential-free-equivalent';
    replacementDisclosure?: string;
    capabilityOutput?: Record<string, unknown>;
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
    signal?: AbortSignal;
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
      requestHeaders?: Record<string, string>;
    };
  }): Promise<PantheonRetrievalResponse> {
    throwIfPantheonAborted(request.signal);
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
    const operationDeadline = deadlineAt == null ? undefined : createPantheonDeadline(deadlineAt, request.signal);
    const operationSignal = operationDeadline?.signal || request.signal;
    try {
    const collectionOpen = () => remainingBudgetMs() > 0 && !operationSignal?.aborted;
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
      const specialized = new Set<PantheonPrimaryCrawlerId>(
        (request.capabilityHint || []).filter((capability): capability is PantheonPrimaryCrawlerId =>
          (PANTHEON_PRIMARY_CRAWLER_IDS as readonly string[]).includes(capability)
        ),
      );
      if (specialized.size === 0) {
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
      }
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

    // Reserve category time for canonical acquisition and the independently
    // audited extraction/analysis lanes. A slow primary crawler may not consume
    // the entire category budget and suppress the rest of the roster.
    const totalBudgetMs = Number.isFinite(remainingBudgetMs())
      ? Math.max(1_000, remainingBudgetMs())
      : Math.max(1_000, request.budgetMs || 60_000);
    const primaryBudgetMs = Math.max(1_000, Math.floor(totalBudgetMs * 0.35));
    const searchOptions = {
      depth: plan.depth,
      crawlers: plan.crawlers,
      stormIntensity: plan.depth === 4 ? 'storm' as const : 'snow' as const,
      timeout: primaryBudgetMs,
      signal: operationSignal,
    };
    let results: CrawlerResult[];
    let canonicalAcquisition: PublicAcquisitionResult | undefined;
    let crawlerAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
    if (request.purpose === 'background_report') {
      const acquisitionAuthority = {
        investigationId: request.authority!.investigationId,
        categoryId: request.authority!.categoryId,
        workId: request.authority!.workId!,
        capability: request.authority!.capability!,
        deadlineAt: deadlineAt!,
        canonicalUrl: request.authority!.canonicalUrl!,
        route: 'primary' as const,
        requestHeaders: request.authority!.requestHeaders,
      };
      // Acquire one full canonical snapshot first. Primary crawlers share the
      // gateway cache, while extraction capabilities receive this untruncated
      // live content rather than a crawler-specific excerpt.
      canonicalAcquisition = await acquirePantheonResource(
        request.authority!.canonicalUrl!,
        primaryBudgetMs,
        acquisitionAuthority,
        operationSignal,
      );
      const isolated = await runWithPantheonAcquisitionContext(
        acquisitionAuthority,
        operationSignal,
        () => pantheonOrchestrator.searchAllIsolatedWithAudit(request.targets, searchOptions),
      );
      results = isolated.results;
      crawlerAudit = isolated.audit;

      // A crawler-local retry of the same canonical URL cannot repair a 401,
      // 403, 404, challenge page, or cached network outcome. The category
      // controller performs the useful fallback: reassign the capability to a
      // different compatible URL while preserving the failed source outcome.
    } else {
      results = await pantheonOrchestrator.search(request.targets, searchOptions);
    }
    throwIfPantheonAborted(operationSignal);
    recordCrawlerOutcomes(results);

    const evidence = results
      .filter(result => result.content.trim() && result.confidence > 0)
      .map(result => {
        const audit = crawlerAudit.find(entry => entry.crawler === result.crawler);
        const sourceOutcome = audit?.sourceOutcomes?.find(outcome => outcome.sourceUrl === result.target);
        return normalizeResult(result, {
          categoryLabel: request.categoryLabel,
          transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
          durationMs: Number(sourceOutcome?.durationMs || audit?.durationMs || 0),
          httpStatus: canonicalAcquisition?.status,
          contentType: canonicalAcquisition?.contentType,
          requestedUrl: request.targets[0],
          finalUrl: canonicalAcquisition?.url,
          canonicalContent: canonicalAcquisition?.ok ? canonicalAcquisition.content : undefined,
          redirectChain: canonicalAcquisition?.redirectChain,
          parser: canonicalAcquisition?.parser,
          ocrApplied: canonicalAcquisition?.ocrApplied,
          rawSnapshot: canonicalAcquisition?.snapshot,
          lastModified: canonicalAcquisition?.lastModified,
        });
      });

    if (request.purpose === 'background_report') {
      const permittedCapabilities = new Set(getPantheonCategoryCapabilities(request.categoryLabel || ''));
      const applicableCapabilities = [...new Set(request.capabilityHint || [])]
        .filter((capability): capability is PantheonCapabilityId =>
          permittedCapabilities.has(capability as PantheonCapabilityId));
      const extendedCapabilityIds = applicableCapabilities.filter(capability =>
        (PANTHEON_RAZOR_SKILL_IDS as readonly string[]).includes(capability)
          || (PANTHEON_SECONDARY_CRAWLER_IDS as readonly string[]).includes(capability)
      );
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
      for (let offset = 0; extendedCapabilityIds.length > 0 && offset < extendedTargets.length && collectionOpen(); offset += EXTENDED_CONCURRENCY) {
        const batch = extendedTargets.slice(offset, offset + EXTENDED_CONCURRENCY);
        const extendedLaneBudget = Math.max(1_000, Math.floor(totalBudgetMs * 0.20));
        const perBatchBudget = Math.min(
          extendedLaneBudget,
          Number.isFinite(remainingBudgetMs()) ? Math.max(1, remainingBudgetMs()) : extendedLaneBudget,
        );
        const settled = await Promise.allSettled(
          batch.map((target, batchIndex) => runWithPantheonAcquisitionContext(
            {
              investigationId: request.authority!.investigationId,
              categoryId: request.authority!.categoryId,
              workId: `${request.authority!.workId}:extended:${offset + batchIndex}`,
              capability: 'extended-pantheon',
              deadlineAt: deadlineAt!,
              canonicalUrl: target,
              requestHeaders: request.authority!.requestHeaders,
            },
            operationSignal,
            () => twoStageDeployer.deployBackgroundReport(
              target,
              canonicalAcquisition?.ok && canonicalAcquisition.content.trim()
                ? canonicalAcquisition.content
                : results.find(result => result.target === target && result.content.trim())?.content,
              perBatchBudget,
              extendedCapabilityIds,
              operationSignal,
            ),
          ))
        );
        settled.forEach((run, index) => extendedRuns.push({ target: batch[index], run }));
      }

      for (const entry of extendedRuns) {
        const { run, target } = entry;
        if (run.status !== 'fulfilled') {
          const message = run.reason instanceof Error ? run.reason.message : String(run.reason);
          const status = /timeout|deadline|abort/i.test(message) ? 'timed_out' as const : 'failed' as const;
          const retrievedAt = new Date().toISOString();
          crawlerAudit.push(...extendedCapabilityIds.map(capabilityId => ({
            crawler: capabilityId,
            capabilityClass: (PANTHEON_RAZOR_SKILL_IDS as readonly string[]).includes(capabilityId)
              ? 'razor' as const
              : 'pantheon-secondary' as const,
            status,
            evidenceCount: 0,
            attempts: 1,
            targets: 1,
            error: message,
            durationMs: 0,
            sourceOutcomes: [{
              sourceUrl: target,
              status,
              retrievedAt,
              durationMs: 0,
              error: message,
            }],
          })));
          continue;
        }

        for (const razor of run.value.razorResults) {
          if (!razor.success) continue;
          evidence.push(createPantheonSourceResult({
            crawler: `razor:${razor.razorType}`,
            capabilityId: `razor:${razor.razorType}`,
            categoryLabel: request.categoryLabel,
            sourceUrl: target,
            content: JSON.stringify(razor.data),
            confidence: Number.isFinite(razor.confidence) ? razor.confidence : 0,
            retrievedAt: new Date().toISOString(),
            durationMs: razor.extractionTimeMs,
            transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
            metadata: {
              capabilityClass: 'razor',
              source: razor.source,
              extractionTimeMs: razor.extractionTimeMs,
            },
          }));
        }

        crawlerAudit.push(...run.value.audit);

        for (const secondary of run.value.secondaryResults) {
          for (const signature of secondary.signatures) {
            evidence.push(createPantheonSourceResult({
              crawler: secondary.crawler,
              capabilityId: secondary.crawler,
              categoryLabel: request.categoryLabel,
              sourceUrl: target,
              content: JSON.stringify({
                evidenceHash: signature.hash,
                probability: signature.probability,
                structuralDensity: signature.structuralDensity,
                constraintCount: signature.constraints.length,
              }),
              confidence: Number.isFinite(signature.probability) ? signature.probability : 0,
              retrievedAt: signature.timestamp.toISOString(),
              durationMs: secondary.durationMs,
              transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
              metadata: {
                capabilityClass: 'pantheon-secondary',
                entropySignature: true,
              },
            }));
          }
        }
      }

      // Paid-key, account-bound, and separately hosted capabilities execute as
      // disclosed local/public-source equivalents over the same verified live
      // source content. This preserves their actual function without claiming
      // access to a vendor service or generating substitute evidence.
      for (const target of extendedTargets) {
        const liveResult = results.find(result => result.target === target && result.content.trim());
        const content = canonicalAcquisition?.ok && canonicalAcquisition.content.trim()
          ? canonicalAcquisition.content
          : liveResult?.content || '';
        crawlerAudit.push(...await runPortablePantheonCapabilities({
          capabilityIds: applicableCapabilities,
          sourceUrl: target,
          content,
          subject: request.subject || '',
          location: request.location,
          discoveredCandidates: Array.isArray(liveResult?.metadata?.discoveredCandidates)
            ? liveResult.metadata.discoveredCandidates
            : [],
          signal: operationSignal,
        }));
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
    } finally {
      operationDeadline?.dispose();
    }
  }
}

export function extractPantheonDiscoveredCandidates(
  content: string,
  baseUrl: string,
  inherited: readonly unknown[] = [],
): string[] {
  const linkedCandidates = [...content.matchAll(/href=["']([^"']+)["']/gi)]
    .flatMap(match => {
      try {
        const url = new URL(String(match[1] || ''), baseUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? [url.toString()] : [];
      } catch {
        return [];
      }
    });
  return [...new Set([
    ...inherited.map(value => String(value || '')).filter(Boolean),
    ...linkedCandidates,
    ...(content.match(/https?:\/\/[^\s<>"')\]]+/g) || []),
  ])].slice(0, 100);
}

function normalizeResult(
  result: CrawlerResult,
  context: {
    categoryLabel?: string;
    transport: PantheonTransport;
    durationMs: number;
    httpStatus?: number;
    contentType?: string;
    requestedUrl?: string;
    finalUrl?: string;
    canonicalContent?: string;
    redirectChain?: string[];
    parser?: string;
    ocrApplied?: boolean;
    rawSnapshot?: PublicAcquisitionResult['snapshot'];
    lastModified?: string;
  },
): RetrievalEvidence {
  const discoveryOnly = context.transport === 'search-provider';
  const canonicalContent = context.canonicalContent || result.content;
  const pageTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(canonicalContent)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const discoveredCandidates = discoveryOnly
    ? extractPantheonDiscoveredCandidates(
        canonicalContent,
        context.finalUrl || result.target,
        Array.isArray(result.metadata?.discoveredCandidates) ? result.metadata.discoveredCandidates : [],
      )
    : [];
  return createPantheonSourceResult({
    crawler: result.crawler,
    capabilityId: result.crawler,
    categoryLabel: context.categoryLabel,
    sourceUrl: result.target,
    content: canonicalContent,
    confidence: result.confidence,
    retrievedAt: new Date(result.timestamp).toISOString(),
    durationMs: context.durationMs,
    transport: context.transport,
    httpStatus: context.httpStatus,
    contentType: context.contentType,
    requestedUrl: context.requestedUrl || result.target,
    finalUrl: context.finalUrl || result.target,
    redirectChain: context.redirectChain,
    parser: context.parser,
    ocrApplied: context.ocrApplied,
    rawSnapshot: context.rawSnapshot,
    lastModified: context.lastModified,
    metadata: {
      ...(result.metadata || {}),
      requestedUrl: context.requestedUrl || result.target,
      finalUrl: context.finalUrl || result.target,
      ...(pageTitle ? { pageTitle } : {}),
      ...(discoveryOnly ? { discoveryOnly: true, discoveredCandidates } : {}),
    },
  });
}

export const pantheonRetrievalAdapter = new PantheonRetrievalAdapter();
