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
  isPantheonCapabilitySourceCompatible,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  PANTHEON_PRIMARY_CRAWLER_IDS,
  PANTHEON_RAZOR_SKILL_IDS,
  PANTHEON_SECONDARY_CRAWLER_IDS,
  type PantheonCapabilityId,
  type PantheonPrimaryCrawlerId,
  type PantheonExecutableSource,
  type PantheonTransport,
} from '../pantheon/PantheonCrawlerCapabilityMatrix';
import {
  createPantheonSourceResult,
  type PantheonStructuredSourceResult,
} from '../pantheon/PantheonSourceResult';
import { createPantheonDeadline, throwIfPantheonAborted } from '../pantheon/PantheonDeadline';
import {
  acquirePantheonResource,
  admitPantheonUrl,
  runWithPantheonAcquisitionContext,
  type PublicAcquisitionResult,
} from './PublicAcquisitionInfrastructure';
import { runPortablePantheonCapabilities } from '../pantheon/PantheonPortableCapabilityExecutor';
import { load } from 'cheerio';
import type {
  PantheonBackgroundCategory,
  PantheonSourceTarget,
} from '../pantheon/PantheonSovereignSourceRegistry';
import type { PantheonIdentifierKind } from '../pantheon/PantheonQueryPlan';

export type RetrievalEvidence = PantheonStructuredSourceResult;

export interface PantheonRetrievalResponse {
  available: boolean;
  reason?: string;
  plan: CrawlerSelectionPlan;
  evidence: RetrievalEvidence[];
  /**
   * Controller-owned candidates parsed from the canonical source snapshot.
   * These are traversal hints only: they never become evidence or satisfy a
   * category's evidence quota until a separately authorized URL is acquired.
   */
  frontierCandidates?: {
    discoveredCandidates: string[];
    sourceNavigationCandidates: string[];
  };
  crawlerAudit: Array<CrawlerExecutionAudit | {
    crawler: string;
    capabilityClass: 'razor' | 'pantheon-secondary';
    status: string;
    evidenceCount: number;
    contentCount?: number;
    attempts: number;
    targets: number;
    error?: string;
    durationMs?: number;
    queueWaitMs?: number;
    sourceOutcomes?: Array<{
      sourceUrl: string;
      status: 'completed_with_content' | 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
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

interface PantheonSupplementalCapabilityRun {
  evidence: RetrievalEvidence[];
  crawlerAudit: PantheonRetrievalResponse['crawlerAudit'];
}

async function runPantheonSupplementalCapabilities(input: {
  target: string;
  canonicalContent: string;
  capabilityIds: readonly PantheonCapabilityId[];
  budgetMs: number;
  deadlineAt: number;
  signal?: AbortSignal;
  investigationId: string;
  categoryId: string;
  workId: string;
  requestHeaders?: Record<string, string>;
  subject: string;
  location?: string;
  categoryLabel?: string;
  transport: PantheonTransport;
  sourceContext: Omit<PantheonExecutableSource, 'sourceUrl'>;
}): Promise<PantheonSupplementalCapabilityRun> {
  const evidence: RetrievalEvidence[] = [];
  const crawlerAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
  const extendedCapabilityIds = input.capabilityIds.filter(capability =>
    (PANTHEON_RAZOR_SKILL_IDS as readonly string[]).includes(capability)
      || (PANTHEON_SECONDARY_CRAWLER_IDS as readonly string[]).includes(capability)
  );
  const portableCapabilityIds = input.capabilityIds.filter(capability =>
    (PANTHEON_PORTABLE_CAPABILITY_IDS as readonly string[]).includes(capability)
  );
  const extendedLaneBudget = Math.max(1_000, Math.floor(input.budgetMs * 0.20));
  const extendedPromise = extendedCapabilityIds.length > 0
    ? runWithPantheonAcquisitionContext(
        {
          investigationId: input.investigationId,
          categoryId: input.categoryId,
          workId: `${input.workId}:extended`,
          capability: 'extended-pantheon',
          deadlineAt: input.deadlineAt,
          canonicalUrl: input.target,
          requestHeaders: input.requestHeaders,
        },
        input.signal,
        () => twoStageDeployer.deployBackgroundReport(
          input.target,
          input.canonicalContent,
          extendedLaneBudget,
          extendedCapabilityIds,
          input.signal,
        ),
      )
    : Promise.resolve(null);
  const portablePromise = runPortablePantheonCapabilities({
    capabilityIds: portableCapabilityIds,
    sourceUrl: input.target,
    content: input.canonicalContent,
    subject: input.subject,
    location: input.location,
    discoveredCandidates: input.canonicalContent
      ? extractPantheonDiscoveredCandidates(input.canonicalContent, input.target, [], input.subject)
      : [],
    sourceContext: input.sourceContext,
    signal: input.signal,
  });
  const [extendedRun, portableRun] = await Promise.allSettled([extendedPromise, portablePromise] as const);

  if (extendedRun.status === 'rejected') {
    const message = extendedRun.reason instanceof Error ? extendedRun.reason.message : String(extendedRun.reason);
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
        sourceUrl: input.target,
        status,
        retrievedAt,
        durationMs: 0,
        error: message,
      }],
    })));
  } else if (extendedRun.value) {
    crawlerAudit.push(...extendedRun.value.audit);
    for (const razor of extendedRun.value.razorResults) {
      if (!razor.success) continue;
      evidence.push(createPantheonSourceResult({
        crawler: `razor:${razor.razorType}`,
        capabilityId: `razor:${razor.razorType}`,
        categoryLabel: input.categoryLabel,
        sourceUrl: input.target,
        content: JSON.stringify(razor.data),
        confidence: Number.isFinite(razor.confidence) ? razor.confidence : 0,
        retrievedAt: new Date().toISOString(),
        durationMs: razor.extractionTimeMs,
        transport: input.transport,
        metadata: {
          capabilityClass: 'razor',
          source: razor.source,
          extractionTimeMs: razor.extractionTimeMs,
        },
      }));
    }
    for (const secondary of extendedRun.value.secondaryResults) {
      for (const signature of secondary.signatures) {
        evidence.push(createPantheonSourceResult({
          crawler: secondary.crawler,
          capabilityId: secondary.crawler,
          categoryLabel: input.categoryLabel,
          sourceUrl: input.target,
          content: JSON.stringify({
            evidenceHash: signature.hash,
            probability: signature.probability,
            structuralDensity: signature.structuralDensity,
            constraintCount: signature.constraints.length,
          }),
          confidence: Number.isFinite(signature.probability) ? signature.probability : 0,
          retrievedAt: signature.timestamp.toISOString(),
          durationMs: secondary.durationMs,
          transport: input.transport,
          metadata: {
            capabilityClass: 'pantheon-secondary',
            entropySignature: true,
          },
        }));
      }
    }
  }

  if (portableRun.status === 'fulfilled') {
    crawlerAudit.push(...portableRun.value);
  } else {
    const message = portableRun.reason instanceof Error ? portableRun.reason.message : String(portableRun.reason);
    const status = /timeout|deadline|abort/i.test(message) ? 'timed_out' as const : 'failed' as const;
    const retrievedAt = new Date().toISOString();
    crawlerAudit.push(...portableCapabilityIds.map(capabilityId => ({
      crawler: capabilityId,
      capabilityClass: 'pantheon-secondary' as const,
      status,
      evidenceCount: 0,
      attempts: 1,
      targets: 1,
      error: message,
      durationMs: 0,
      sourceOutcomes: [{
        sourceUrl: input.target,
        status,
        retrievedAt,
        durationMs: 0,
        error: message,
      }],
      executionMode: 'credential-free-equivalent' as const,
      replacementDisclosure: PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId].replacementDisclosure
        || 'Credential-free local equivalent.',
    })));
  }

  return { evidence, crawlerAudit };
}

/** Normalizes results from every executable PANTHEON crawler into provenance-bearing evidence. */
export class PantheonRetrievalAdapter {
  async retrieve(request: {
    purpose: Exclude<CrawlerSelectionPurpose, 'map_evidence_render'>;
    targets: string[];
    depth?: 1 | 2 | 3;
    budgetMs?: number;
    deadlineAt?: number;
    subject?: string;
    startingIdentifierKind?: PantheonIdentifierKind;
    location?: string;
    categoryLabel?: string;
    registryCategory?: PantheonBackgroundCategory;
    sourceKind?: NonNullable<PantheonSourceTarget['sourceKind']>;
    sourceAuthority?: PantheonSourceTarget['authority'];
    sourceJurisdiction?: string;
    workType?: 'authoritative-source' | 'discovery-search' | 'source-navigation' | 'candidate-validation' | 'corroboration';
    subjectScoped?: boolean;
    capabilityHint?: string[];
    /** Explicit need-driven primary crawler roster for conversational retrieval. */
    primaryCrawlers?: PantheonPrimaryCrawlerId[];
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
      const sourceContext: PantheonExecutableSource = {
        sourceUrl: request.targets[0],
        transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
        registryCategory: request.registryCategory,
        sourceKind: request.sourceKind,
        authority: request.sourceAuthority,
        jurisdiction: request.sourceJurisdiction,
        workType: request.workType,
        subjectScoped: request.subjectScoped,
      };
      const incompatibleCapabilities = (request.capabilityHint || [])
        .filter((capability): capability is PantheonCapabilityId =>
          Object.prototype.hasOwnProperty.call(PANTHEON_CRAWLER_CAPABILITY_MATRIX, capability))
        .filter(capability => !isPantheonCapabilitySourceCompatible(capability, sourceContext));
      if (incompatibleCapabilities.length > 0) {
        throw new Error(`Pantheon background retrieval rejected: source-skill authorization mismatch (${incompatibleCapabilities.join(',')})`);
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
      // The public PANTHEON contract has exactly three duration levels:
      // 10, 20, and 30 minutes. Keep an omitted internal depth on the
      // complete, 30-minute roster rather than reintroducing a fourth level.
      depth: request.depth || 3,
      targetCount: request.targets.length,
      host,
    });
    // Every crawler remains available. Callers may supply a capability-derived
    // primary roster; background-report URL-ledger routing remains authoritative.
    if (request.purpose !== 'background_report' && request.primaryCrawlers?.length) {
      plan.crawlers = [...new Set(request.primaryCrawlers)];
      plan.rationale.unshift('Conversational capability routing selected the primary crawler roster.');
    }
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
    // The shared crawler selector also serves legacy four-level consumers.
    // Pantheon's public contract has only the three 10/20/30-minute levels.
    const crawlerDepth: 1 | 2 | 3 = plan.depth === 4 ? 3 : plan.depth;
    const searchOptions = {
      depth: crawlerDepth,
      crawlers: plan.crawlers,
      stormIntensity: crawlerDepth === 3 ? 'storm' as const : 'snow' as const,
      timeout: primaryBudgetMs,
      signal: operationSignal,
    };
    let results: CrawlerResult[];
    let canonicalAcquisition: PublicAcquisitionResult | undefined;
    let crawlerAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
    let applicableCapabilities: PantheonCapabilityId[] = [];
    let supplementalRunPromise: Promise<PantheonSupplementalCapabilityRun> | undefined;
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
      const permittedCapabilities = new Set(getPantheonCategoryCapabilities(request.categoryLabel || ''));
      applicableCapabilities = [...new Set(request.capabilityHint || [])]
        .filter((capability): capability is PantheonCapabilityId =>
          permittedCapabilities.has(capability as PantheonCapabilityId));
      // Start every assigned extraction/analysis skill as soon as the one
      // canonical source snapshot exists. These lanes run alongside the
      // primary crawler instead of waiting behind its network timeout.
      supplementalRunPromise = runPantheonSupplementalCapabilities({
        target: request.authority!.canonicalUrl!,
        canonicalContent: canonicalAcquisition.ok ? canonicalAcquisition.content : '',
        capabilityIds: applicableCapabilities,
        budgetMs: totalBudgetMs,
        deadlineAt: deadlineAt!,
        signal: operationSignal,
        investigationId: request.authority!.investigationId,
        categoryId: request.authority!.categoryId,
        workId: request.authority!.workId!,
        requestHeaders: request.authority!.requestHeaders,
        subject: request.subject || '',
        location: request.location,
        categoryLabel: request.categoryLabel,
        transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
        sourceContext: {
          transport: (request.transportHint?.[0] || 'direct-http') as PantheonTransport,
          registryCategory: request.registryCategory,
          sourceKind: request.sourceKind,
          authority: request.sourceAuthority,
          jurisdiction: request.sourceJurisdiction,
          workType: request.workType,
          subjectScoped: request.subjectScoped,
        },
      });
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
      // Conversational research also gets the full extraction/analysis skill
      // inventory over material actually retrieved. These skills do not create
      // extra network fetches; they help decide whether a page contains the
      // requested fact instead of discarding useful occupation/DOB/custody/etc.
      const conversationalCapabilityIds = [
        ...PANTHEON_RAZOR_SKILL_IDS,
        ...PANTHEON_SECONDARY_CRAWLER_IDS,
        ...PANTHEON_PORTABLE_CAPABILITY_IDS,
      ].filter(capabilityId => capabilityId !== 'firecrawl');
      const conversationalSupplementalPromises = results
        .filter(result => result.content?.trim())
        .slice(0, 4)
        .map(result => runPantheonSupplementalCapabilities({
          target: result.target,
          canonicalContent: result.content,
          capabilityIds: conversationalCapabilityIds,
          budgetMs: Math.max(1_000, Math.min(5_000, remainingBudgetMs())),
          deadlineAt: deadlineAt || (Date.now() + 5_000),
          signal: operationSignal,
          investigationId: `lexara:${retrievalStartedAt}`,
          categoryId: request.categoryLabel || 'conversational',
          workId: `lexara:${result.crawler}:${result.timestamp}`,
          subject: request.subject || '',
          location: request.location,
          categoryLabel: request.categoryLabel,
          transport: 'direct-http',
          sourceContext: { transport: 'direct-http', workType: request.workType, subjectScoped: request.subjectScoped },
        }));
      if (conversationalSupplementalPromises.length) {
        supplementalRunPromise = Promise.allSettled(conversationalSupplementalPromises).then(settled => ({
          evidence: settled.flatMap(item => item.status === 'fulfilled' ? item.value.evidence : []),
          crawlerAudit: settled.flatMap(item => item.status === 'fulfilled' ? item.value.crawlerAudit : []),
        }));
      }
    }
    throwIfPantheonAborted(operationSignal);
    recordCrawlerOutcomes(results);

    const canonicalFrontierCandidates = canonicalAcquisition?.ok && canonicalAcquisition.content.trim()
      ? {
          discoveredCandidates: extractPantheonDiscoveredCandidates(
            canonicalAcquisition.content,
            canonicalAcquisition.url || request.targets[0],
            [],
            request.subject,
            request.location,
            request.startingIdentifierKind,
          ).slice(0, 100),
          sourceNavigationCandidates: extractPantheonSourceNavigationCandidates(
            canonicalAcquisition.content,
            canonicalAcquisition.url || request.targets[0],
          ),
        }
      : undefined;

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
          subject: request.subject,
          location: request.location,
          startingIdentifierKind: request.startingIdentifierKind,
        });
      });

    if (supplementalRunPromise) {
      const supplemental = await supplementalRunPromise;
      evidence.push(...supplemental.evidence);
      crawlerAudit.push(...supplemental.crawlerAudit);
      if (request.purpose !== 'background_report') {
        console.log('[PANTHEON][CONVERSATIONAL-CAPABILITY-BATCH]', JSON.stringify({
          event: 'conversational_skill_outcome',
          selectedPrimaryCrawlers: plan.crawlers,
          supplementalSkillsObserved: [...new Set(supplemental.crawlerAudit.map(item => item.crawler))],
          supplementalEvidence: supplemental.evidence.length,
        }));
      }
      const capabilityOutcomes = applicableCapabilities.map(capabilityId => {
        const audits = crawlerAudit.filter(audit => audit.crawler === capabilityId);
        const clean = audits.find(audit =>
          ['completed_with_content', 'completed_with_evidence', 'completed_no_evidence'].includes(String(audit.status || ''))
        );
        const timedOut = audits.find(audit => audit.status === 'timed_out');
        return {
          capabilityId,
          status: clean?.status || timedOut?.status || audits[0]?.status || 'not_observed',
          attempts: audits.reduce((sum, audit) => sum + Math.max(0, Number(audit.attempts || 0)), 0),
        };
      });
      console.log('[PANTHEON][CAPABILITY-BATCH]', JSON.stringify({
        event: 'authorized_work_outcome',
        investigationId: request.authority!.investigationId,
        categoryIndex: request.authority!.categoryIndex,
        category: request.categoryLabel,
        workId: request.authority!.workId,
        capabilityOutcomes,
      }));
    }

    // Every evidence lane, including local extraction/analysis lanes, carries
    // the originating identifier type.  The entity resolver uses this to
    // forbid a phone, address, business, property, or VIN investigation from
    // falling back to fuzzy name-style matching.
    if (request.startingIdentifierKind) {
      for (const item of evidence) {
        item.metadata = {
          ...(item.metadata || {}),
          startingIdentifierKind: request.startingIdentifierKind,
        };
      }
    }

    return {
      available: true,
      plan,
      evidence,
      ...(canonicalFrontierCandidates ? { frontierCandidates: canonicalFrontierCandidates } : {}),
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
  subject = '',
  location = '',
  startingIdentifierKind: PantheonIdentifierKind = 'name',
): string[] {
  const normalized = (value: unknown) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+-]+/gu, ' ')
    .trim();
  const subjectTokens = normalized(subject).split(/\s+/).filter(token => token.length >= 2);
  const searchProviderHost = (host: string) => /(?:^|\.)(?:bing\.com|google\.com|duckduckgo\.com|search\.brave\.com)$/i.test(host);
  const unwrapSearchRedirect = (raw: string): string => {
    try {
      const parsed = new URL(raw, baseUrl);
      if (!searchProviderHost(parsed.hostname)) return parsed.toString();
      for (const key of ['uddg', 'url', 'target', 'q']) {
        const candidate = parsed.searchParams.get(key);
        if (candidate && /^https?:\/\//i.test(candidate)) return new URL(candidate).toString();
      }
      const bingValue = parsed.searchParams.get('u');
      if (bingValue?.startsWith('a1')) {
        const decoded = Buffer.from(bingValue.slice(2), 'base64url').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return new URL(decoded).toString();
      }
      return parsed.toString();
    } catch {
      return '';
    }
  };
  const relevant = (url: string, context: string): boolean => {
    if (!subjectTokens.length) return true;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    if (searchProviderHost(target.hostname)) return false;
    const haystack = normalized(`${decodeURIComponent(target.pathname)} ${target.search} ${context}`);
    if (subjectTokens.length === 1) return haystack.split(/\s+/).includes(subjectTokens[0]);
    return haystack.includes(subjectTokens.join(' '))
      || (haystack.includes(subjectTokens[0]) && haystack.includes(subjectTokens[subjectTokens.length - 1]));
  };
  const linkedCandidates: Array<{ url: string; context: string }> = [];
  try {
    const $ = load(content);
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href') || '';
      const url = unwrapSearchRedirect(href);
      if (!url) return;
      const context = `${$(element).text()} ${$(element).parent().text()}`.slice(0, 2_000);
      linkedCandidates.push({ url, context });
    });
    // A registry landing page commonly exposes its public lookup through a
    // GET form rather than a record URL.  Build only same-source GET requests
    // from submitted identity fields; POST, credential, and cross-origin
    // forms remain outside Pantheon's public acquisition contract.
    if (subject.trim()) {
      let base: URL | undefined;
      try {
        base = new URL(baseUrl);
      } catch {
        base = undefined;
      }
      if (base) {
        const subjectParts = subject.trim().split(/\s+/).filter(Boolean);
        $('form').each((_, form) => {
          const $form = $(form);
          const method = String($form.attr('method') || 'get').trim().toLowerCase();
          if (method !== 'get') return;
          let action: URL;
          try {
            action = new URL($form.attr('action') || base!.toString(), base);
          } catch {
            return;
          }
          if (!/^https?:$/.test(action.protocol) || action.origin !== base.origin) return;

          const fields: Array<{ name: string; type: string }> = [];
          $form.find('input[name], textarea[name], select[name]').each((__, field) => {
            const $field = $(field);
            if ($field.is('[disabled]')) return;
            const type = String($field.attr('type') || '').toLowerCase();
            if (['button', 'checkbox', 'file', 'hidden', 'image', 'password', 'radio', 'reset', 'submit'].includes(type)) return;
            const name = String($field.attr('name') || '').trim();
            if (name) fields.push({ name, type });
          });
          const fieldFor = (pattern: RegExp) => fields.find(field => pattern.test(field.name));
          const firstName = fieldFor(/(?:^|[_-])(first|given)(?:[_-]?name)?(?:$|[_-])/i);
          const lastName = fieldFor(/(?:^|[_-])(last|family|sur)(?:[_-]?name)?(?:$|[_-])/i);
          const genericQuery = fieldFor(/^(?:q|query|search|searchterm|search_term|keyword|keywords|term|terms)$/i);
          const nameSubject = fieldFor(/^(?:name|full_?name|party|person|defendant|respondent|offender|inmate|licensee|registrant|owner)$/i);
          const identifierFieldPatterns: Record<Exclude<PantheonIdentifierKind, 'name'>, RegExp> = {
            phone: /(?:^|[_-])(?:phone|telephone|tel)(?:[_-]?number)?(?:$|[_-])/i,
            email: /(?:^|[_-])e?mail(?:[_-]?address)?(?:$|[_-])/i,
            username: /(?:^|[_-])(?:user(?:name|_?id)?|handle|screen_?name)(?:$|[_-])/i,
            address: /(?:^|[_-])(?:address|street|location)(?:$|[_-])/i,
            business: /(?:^|[_-])(?:business|company|entity|organization|organisation)(?:[_-]?name)?(?:$|[_-])/i,
            property: /(?:^|[_-])(?:property|parcel|apn|assessor)(?:[_-]?(?:id|number|search))?(?:$|[_-])/i,
            vin: /(?:^|[_-])(?:vin|vehicle_?identification)(?:[_-]?(?:number|id))?(?:$|[_-])/i,
          };
          const locationField = fieldFor(/(?:city|county|jurisdiction|location|state|region|locality)/i);

          const explicitIdentifierField = startingIdentifierKind === 'name'
            ? undefined
            : fieldFor(identifierFieldPatterns[startingIdentifierKind]);
          if (startingIdentifierKind !== 'name' && (explicitIdentifierField || genericQuery)) {
            action.searchParams.set((explicitIdentifierField || genericQuery)!.name, subject.trim());
          } else if (startingIdentifierKind === 'name' && nameSubject) {
            action.searchParams.set(nameSubject.name, subject.trim());
          } else if (startingIdentifierKind === 'name' && firstName && lastName && subjectParts.length >= 2) {
            action.searchParams.set(firstName.name, subjectParts[0]);
            action.searchParams.set(lastName.name, subjectParts.at(-1)!);
          } else if (genericQuery) {
            // A generic query input is deliberately safe for every accepted
            // starting-identifier type.  A name-labelled field is not.
            action.searchParams.set(genericQuery.name, subject.trim());
          } else {
            return;
          }
          if (locationField && location.trim()) action.searchParams.set(locationField.name, location.trim());
          const url = unwrapSearchRedirect(action.toString());
          if (url) linkedCandidates.push({ url, context: `${$form.attr('aria-label') || ''} ${$form.attr('id') || ''} ${subject}` });
        });
      }
    }
  } catch {
    for (const match of content.matchAll(/href=["']([^"']+)["']/gi)) {
      const url = unwrapSearchRedirect(String(match[1] || ''));
      if (url) linkedCandidates.push({ url, context: '' });
    }
  }
  const inheritedCandidates = inherited.map(value => ({ url: unwrapSearchRedirect(String(value || '')), context: '' }));
  const inlineCandidates = (content.match(/https?:\/\/[^\s<>"')\]]+/g) || [])
    .map(value => ({ url: unwrapSearchRedirect(value), context: '' }));
  const locationContext = normalized(location);
  return [...new Set([
    ...inheritedCandidates,
    ...linkedCandidates,
    ...inlineCandidates,
  ]
    .filter(candidate => candidate.url && relevant(candidate.url, `${candidate.context} ${locationContext}`))
    .map(candidate => candidate.url))];
}

/**
 * Finds bounded, same-source public navigation routes that may lead from an
 * authority landing page to its own search or records interface.  These are
 * deliberately separate from subject-result candidates: a navigation page is
 * never evidence and is allowed only one recursive hop before it must yield a
 * subject-scoped URL.
 */
export function extractPantheonSourceNavigationCandidates(
  content: string,
  baseUrl: string,
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  if (/(?:^|\.)(?:bing\.com|google\.com|duckduckgo\.com|search\.brave\.com)$/i.test(base.hostname)) return [];

  const navigationHint = /(?:\bsearch\b|\blookup\b|\bfind\b|\bdirectory\b|\brecords?\b|\bcases?\b|\bdockets?\b|\boffenders?\b|\binmates?\b|\bwarrants?\b|\blicen[cs](?:e|es|ing)?\b|\bregistry\b|\bpublic[ -]?record)/i;
  const candidates = new Set<string>();
  try {
    const $ = load(content);
    $('a[href]').each((_, element) => {
      const $link = $(element);
      const href = String($link.attr('href') || '').trim();
      if (!href || href.startsWith('#')) return;
      let target: URL;
      try {
        target = new URL(href, base);
      } catch {
        return;
      }
      if (!/^https?:$/.test(target.protocol) || target.origin !== base.origin || target.toString() === base.toString()) return;
      const context = `${$link.text()} ${$link.attr('aria-label') || ''} ${$link.attr('title') || ''} ${target.pathname}`;
      if (!navigationHint.test(context)) return;
      const admission = admitPantheonUrl(target.toString());
      if (admission.ok) candidates.add(admission.url);
    });
  } catch {
    return [];
  }
  return [...candidates].slice(0, 12);
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
    subject?: string;
    location?: string;
    startingIdentifierKind?: PantheonIdentifierKind;
  },
): RetrievalEvidence {
  const discoveryOnly = context.transport === 'search-provider';
  const canonicalContent = context.canonicalContent || result.content;
  const pageTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(canonicalContent)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  // Every successfully acquired page may broaden the controller-owned crawl
  // frontier. Search pages remain discovery-only evidence, while attributable
  // public pages can both contribute evidence and yield subject-relevant links.
  const discoveredCandidates = extractPantheonDiscoveredCandidates(
    canonicalContent,
    context.finalUrl || result.target,
    Array.isArray(result.metadata?.discoveredCandidates) ? result.metadata.discoveredCandidates : [],
    context.subject,
    context.location,
    context.startingIdentifierKind,
  ).slice(0, 100);
  const sourceNavigationCandidates = extractPantheonSourceNavigationCandidates(
    canonicalContent,
    context.finalUrl || result.target,
  );
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
      ...(discoveryOnly ? { discoveryOnly: true } : {}),
      ...(discoveredCandidates.length ? { discoveredCandidates } : {}),
      ...(sourceNavigationCandidates.length ? { sourceNavigationCandidates } : {}),
      ...(context.startingIdentifierKind ? { startingIdentifierKind: context.startingIdentifierKind } : {}),
    },
  });
}

export const pantheonRetrievalAdapter = new PantheonRetrievalAdapter();
